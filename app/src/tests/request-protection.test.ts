import assert from "node:assert/strict";
import test from "node:test";
import { createRequestProtection, hashedClientIdentity, protectionFailureResponse, readBoundedBody, RequestProtection, RequestProtectionUnavailableError, MAX_ACTIVE_RESEARCH_REQUESTS, RESEARCH_LEASE_TTL_MS } from "@/lib/request-protection";

type Entry = { score: number; member: string };

class MockRedis {
  readonly values = new Map<string, Entry[]>();
  unavailable = false;

  async eval<T>(script: string, keys: string[], args: string[]): Promise<T> {
    if (this.unavailable) throw new Error("redis unavailable");
    if (script.includes("client_window")) return this.rateLimit(keys, args) as T;
    if (script.includes("capacity")) return this.acquireLease(keys, args) as T;
    if (script.includes("ZREM")) {
      const entries = this.values.get(keys[0]!) ?? [];
      this.values.set(keys[0]!, entries.filter((entry) => entry.member !== args[0]));
      return 1 as T;
    }
    throw new Error("unknown script");
  }

  private rateLimit(keys: string[], args: string[]): number[] {
    const now = Number(args[0]);
    const clientWindow = Number(args[1]);
    const globalWindow = Number(args[2]);
    const clientLimit = Number(args[3]);
    const globalLimit = Number(args[4]);
    const member = args[5]!;
    const client = this.active(keys[0]!, now, clientWindow);
    const global = this.active(keys[1]!, now, globalWindow);
    if (client.length >= clientLimit || global.length >= globalLimit) return [0, 1_000];
    client.push({ score: now, member });
    global.push({ score: now, member });
    this.values.set(keys[0]!, client);
    this.values.set(keys[1]!, global);
    return [1, Math.min(clientWindow, globalWindow)];
  }

  private acquireLease(keys: string[], args: string[]): number[] {
    const now = Number(args[0]);
    const ttl = Number(args[1]);
    const capacity = Number(args[2]);
    const leaseId = args[3]!;
    const active = this.active(keys[0]!, now, Number.MAX_SAFE_INTEGER);
    if (active.length >= capacity) return [0, 15_000];
    active.push({ score: now + ttl, member: leaseId });
    this.values.set(keys[0]!, active);
    return [1, ttl];
  }

  private active(key: string, now: number, window: number): Entry[] {
    const entries = (this.values.get(key) ?? []).filter((entry) => window === Number.MAX_SAFE_INTEGER ? entry.score > now : entry.score > now - window);
    this.values.set(key, entries);
    return entries;
  }
}

function request(ip = "203.0.113.10") {
  return new Request("https://mosaic.test/api/counterfactual", { headers: { "x-forwarded-for": ip } });
}

function makeProtection(redis = new MockRedis(), now = 1_000) {
  return { protection: new RequestProtection({ redis, hmacSecret: "test-secret", now: () => now, idFactory: (() => { let value = 0; return () => `id-${++value}`; })() }), redis };
}

test("admits a valid request and uses hashed client identity", async () => {
  const { protection } = makeProtection();
  const admission = await protection.admit(request(), "counterfactual");
  assert.equal(admission.ok, true);
  assert.equal(hashedClientIdentity(request(), "test-secret").length, 64);
  assert.notEqual([...((protection as unknown as { redis: MockRedis }).redis?.values.keys() ?? [])].join(""), "203.0.113.10");
});

test("enforces the endpoint client limit atomically", async () => {
  const { protection } = makeProtection();
  const admissions = [];
  for (let index = 0; index < 6; index += 1) {
    const admission = await protection.admit(request(), "counterfactual");
    admissions.push(admission);
    if (admission.ok) await admission.lease.release();
  }
  assert.equal(admissions.filter((item) => item.ok).length, 5);
  const rejected = admissions.find((item) => !item.ok);
  assert.equal(rejected?.status, 429);
  assert.equal(rejected?.code, "RATE_LIMITED");
  assert.equal(rejected?.retryAfterSeconds, 1);
});

test("enforces the analyze policy separately from counterfactual", async () => {
  const { protection } = makeProtection();
  const admissions = await Promise.all(Array.from({ length: 4 }, () => protection.admit(request(), "analyze")));
  assert.equal(admissions.filter((item) => item.ok).length, 3);
});

test("enforces four active leases across both endpoints", async () => {
  const { protection } = makeProtection();
  const first = await Promise.all(Array.from({ length: MAX_ACTIVE_RESEARCH_REQUESTS }, (_, index) => protection.admit(request(`203.0.113.${index + 10}`), index % 2 ? "analyze" : "counterfactual")));
  assert.equal(first.filter((item) => item.ok).length, MAX_ACTIVE_RESEARCH_REQUESTS);
  const full = await protection.admit(request("203.0.113.99"), "counterfactual");
  assert.deepEqual(full, { ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 15 });
});

test("releases leases after success or failure and permits the next request", async () => {
  const { protection } = makeProtection();
  const admission = await protection.admit(request(), "counterfactual");
  assert.equal(admission.ok, true);
  if (admission.ok) await admission.lease.release();
  const next = await protection.admit(request(), "counterfactual");
  assert.equal(next.ok, true);
});

test("expired leases are removed before capacity is evaluated", async () => {
  let now = 1_000;
  const redis = new MockRedis();
  const { protection } = protectionAt(redis, () => now);
  for (let index = 0; index < MAX_ACTIVE_RESEARCH_REQUESTS; index += 1) assert.equal((await protection.admit(request(`203.0.113.${index + 10}`), "counterfactual")).ok, true);
  now += RESEARCH_LEASE_TTL_MS + 1;
  assert.equal((await protection.admit(request("203.0.113.99"), "counterfactual")).ok, true);
});

function protectionAt(redis: MockRedis, now: () => number) {
  let value = 0;
  return { protection: new RequestProtection({ redis, hmacSecret: "test-secret", now, idFactory: () => `lease-${++value}` }), redis };
}

test("fails closed when Redis is unavailable", async () => {
  const redis = new MockRedis();
  redis.unavailable = true;
  await assert.rejects(() => makeProtection(redis).protection.admit(request(), "counterfactual"), RequestProtectionUnavailableError);
});

test("requires production Redis configuration but allows explicit local disablement", () => {
  assert.throws(() => createRequestProtection({ NODE_ENV: "production" }), RequestProtectionUnavailableError);
  assert.equal(createRequestProtection({ NODE_ENV: "development", REQUEST_PROTECTION_MODE: "disabled" }), undefined);
});

test("invalid forwarded identity falls back to an anonymous protected bucket", () => {
  const invalid = new Request("https://mosaic.test", { headers: { "x-forwarded-for": "not-an-ip" } });
  assert.equal(hashedClientIdentity(invalid, "test-secret"), hashedClientIdentity(new Request("https://mosaic.test"), "test-secret"));
});

test("protection failures expose only sanitized 429 and 503 payloads", () => {
  assert.deepEqual(protectionFailureResponse({ ok: false, status: 429, code: "RATE_LIMITED", retryAfterSeconds: 15 }), {
    status: 429,
    retryAfterSeconds: 15,
    body: { error: { code: "RATE_LIMITED", message: "Research request limit reached. Try again later." } },
  });
  assert.deepEqual(protectionFailureResponse({ ok: false, status: 503, code: "REQUEST_PROTECTION_UNAVAILABLE" }), {
    status: 503,
    retryAfterSeconds: undefined,
    body: { error: { code: "REQUEST_PROTECTION_UNAVAILABLE", message: "Request protection is temporarily unavailable." } },
  });
});

test("bounded body reading rejects oversized streams without parsing or provider work", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(16_384));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  const oversized = new Request("https://mosaic.test", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.deepEqual(await readBoundedBody(oversized), { ok: false });
  const valid = new Request("https://mosaic.test", { method: "POST", body: JSON.stringify({ ok: true }) });
  const body = await readBoundedBody(valid);
  assert.equal(body.ok, true);
  if (body.ok) assert.deepEqual(JSON.parse(body.body), { ok: true });
});
