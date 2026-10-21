import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Redis } from "@upstash/redis";

export const MAX_REQUEST_BYTES = 16_384;
export const MAX_ACTIVE_RESEARCH_REQUESTS = 4;
export const RESEARCH_LEASE_TTL_MS = 210_000;

export type ProtectedEndpoint = "counterfactual" | "analyze";
type RedisLike = { eval<T = unknown>(script: string, keys: string[], args: string[]): Promise<T> };
type Clock = () => number;
type IdFactory = () => string;

const RATE_LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local client_window = tonumber(ARGV[2])
local global_window = tonumber(ARGV[3])
local client_limit = tonumber(ARGV[4])
local global_limit = tonumber(ARGV[5])
local member = ARGV[6]
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - client_window)
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now - global_window)
local client_count = redis.call('ZCARD', KEYS[1])
local global_count = redis.call('ZCARD', KEYS[2])
if client_count >= client_limit or global_count >= global_limit then
  local retry_ms = 1000
  local client_oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local global_oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  if client_count >= client_limit and #client_oldest > 1 then retry_ms = math.max(retry_ms, tonumber(client_oldest[2]) + client_window - now) end
  if global_count >= global_limit and #global_oldest > 1 then retry_ms = math.max(retry_ms, tonumber(global_oldest[2]) + global_window - now) end
  return {0, retry_ms}
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('ZADD', KEYS[2], now, member)
redis.call('PEXPIRE', KEYS[1], client_window + 1000)
redis.call('PEXPIRE', KEYS[2], global_window + 1000)
return {1, math.min(client_window, global_window)}
`;

const LEASE_ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local lease_id = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)
local active = redis.call('ZCARD', KEYS[1])
if active >= capacity then return {0, 15000} end
redis.call('ZADD', KEYS[1], now + ttl, lease_id)
redis.call('PEXPIRE', KEYS[1], ttl + 1000)
return {1, ttl}
`;

const LEASE_RELEASE_SCRIPT = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`;

const POLICY: Record<ProtectedEndpoint, { clientLimit: number; globalLimit: number; clientWindowMs: number; globalWindowMs: number }> = {
  counterfactual: { clientLimit: 5, globalLimit: 30, clientWindowMs: 600_000, globalWindowMs: 60_000 },
  analyze: { clientLimit: 3, globalLimit: 15, clientWindowMs: 600_000, globalWindowMs: 60_000 },
};

export type AdmissionFailure = {
  ok: false;
  status: 429 | 503;
  code: "RATE_LIMITED" | "REQUEST_PROTECTION_UNAVAILABLE";
  retryAfterSeconds?: number;
};

export type Admission =
  | { ok: true; lease: { release: () => Promise<void> } }
  | AdmissionFailure;

export function protectionFailureResponse(failure: AdmissionFailure): { status: 429 | 503; retryAfterSeconds?: number; body: { error: { code: AdmissionFailure["code"]; message: string } } } {
  return {
    status: failure.status,
    retryAfterSeconds: failure.retryAfterSeconds,
    body: {
      error: {
        code: failure.code,
        message: failure.code === "RATE_LIMITED" ? "Research request limit reached. Try again later." : "Request protection is temporarily unavailable.",
      },
    },
  };
}

export type RequestProtectionOptions = {
  redis: RedisLike;
  hmacSecret: string;
  now?: Clock;
  idFactory?: IdFactory;
  leaseKey?: string;
};

function secondsFromMilliseconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

function validForwardedIdentity(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const candidate = forwarded || real;
  return candidate && isIP(candidate) ? candidate : undefined;
}

export function clientIdentity(request: Request): string {
  return validForwardedIdentity(request) ?? "anonymous";
}

export function hashedClientIdentity(request: Request, hmacSecret: string): string {
  return createHmac("sha256", hmacSecret).update(clientIdentity(request)).digest("hex");
}

export class RequestProtection {
  private readonly redis: RedisLike;
  private readonly hmacSecret: string;
  private readonly now: Clock;
  private readonly idFactory: IdFactory;
  private readonly leaseKey: string;

  constructor(options: RequestProtectionOptions) {
    this.redis = options.redis;
    this.hmacSecret = options.hmacSecret;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? randomUUID;
    this.leaseKey = options.leaseKey ?? "mosaic:research:leases:v1";
  }

  async admit(request: Request, endpoint: ProtectedEndpoint): Promise<Admission> {
    const policy = POLICY[endpoint];
    const now = this.now();
    const identity = hashedClientIdentity(request, this.hmacSecret);
    const member = `${now}:${this.idFactory()}`;
    const rateResult = await this.safeEval<number[]>(RATE_LIMIT_SCRIPT, [`mosaic:rate:${endpoint}:client:${identity}`, `mosaic:rate:${endpoint}:global`], [String(now), String(policy.clientWindowMs), String(policy.globalWindowMs), String(policy.clientLimit), String(policy.globalLimit), member]);
    if (!rateResult || Number(rateResult[0]) !== 1) {
      return { ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: secondsFromMilliseconds(Number(rateResult?.[1]) || policy.globalWindowMs) };
    }

    const leaseId = this.idFactory();
    const leaseResult = await this.safeEval<number[]>(LEASE_ACQUIRE_SCRIPT, [this.leaseKey], [String(now), String(RESEARCH_LEASE_TTL_MS), String(MAX_ACTIVE_RESEARCH_REQUESTS), leaseId]);
    if (!leaseResult || Number(leaseResult[0]) !== 1) {
      return { ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 15 };
    }
    return { ok: true, lease: { release: async () => { await this.release(leaseId); } } };
  }

  private async release(leaseId: string): Promise<void> {
    try {
      await this.redis.eval<number>(LEASE_RELEASE_SCRIPT, [this.leaseKey], [leaseId]);
    } catch {
      // Lease expiration is the recovery mechanism if release reaches a dead instance.
    }
  }

  private async safeEval<T>(script: string, keys: string[], args: string[]): Promise<T> {
    try {
      return await this.redis.eval<T>(script, keys, args);
    } catch {
      throw new RequestProtectionUnavailableError();
    }
  }
}

export class RequestProtectionUnavailableError extends Error {
  constructor() {
    super("Request protection is unavailable");
    this.name = "RequestProtectionUnavailableError";
  }
}

export function createRequestProtection(environment: NodeJS.ProcessEnv = process.env): RequestProtection | undefined {
  if (environment.REQUEST_PROTECTION_MODE === "disabled" && environment.NODE_ENV !== "production") return undefined;
  const url = environment.UPSTASH_REDIS_REST_URL;
  const token = environment.UPSTASH_REDIS_REST_TOKEN;
  const hmacSecret = environment.RATE_LIMIT_HMAC_SECRET;
  if (!url || !token || !hmacSecret) throw new RequestProtectionUnavailableError();
  return new RequestProtection({ redis: new Redis({ url, token }), hmacSecret });
}

export async function readBoundedBody(request: Request, maximumBytes = MAX_REQUEST_BYTES): Promise<{ ok: true; body: string } | { ok: false }> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return { ok: false };
  if (!request.body) return { ok: true, body: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false };
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, body: new TextDecoder().decode(body) };
}
