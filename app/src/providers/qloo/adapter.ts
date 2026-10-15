import type { CulturalEntity, EntityCategory, GeographicContext } from "@/core/entities/types";
import { AffinityEvidenceSchema, type CulturalEvidence } from "@/core/evidence/types";
import {
  unsupportedCapability,
  type AffinityDiscoveryRequest,
  type CulturalIntelligenceProvider,
  type EntitySearchRequest,
  type ExplainabilityRequest,
  type ProviderCapabilities,
  type ProviderError,
  type ProviderResult,
} from "@/providers/interfaces/contracts";
import { qlooConfigFromEnvironment, type QlooConfig } from "./config";

export type QlooHttpRequest = (url: string, init: RequestInit) => Promise<Response>;

export class QlooTimeoutError extends Error {
  constructor() {
    super("Qloo request timed out");
    this.name = "QlooTimeoutError";
  }
}

/** Server-side HTTP boundary. It owns authentication headers and request timeouts. */
export class QlooHttpClient {
  private readonly request: QlooHttpRequest;
  private readonly timeoutMs: number;

  constructor(
    request: QlooHttpRequest = fetch,
    timeoutMs = 10_000,
  ) {
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async get(url: string, apiKey: string): Promise<Response> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const requestPromise = this.request(url, {
      signal: controller.signal,
      headers: { "X-Api-Key": apiKey, accept: "application/json" },
    });
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new QlooTimeoutError());
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

type QlooEntityPayload = {
  entity_id?: unknown;
  id?: unknown;
  name?: unknown;
  types?: unknown;
  properties?: unknown;
  popularity?: unknown;
  location?: unknown;
  tags?: unknown;
};

type QlooSearchPayload = { entities?: unknown; results?: unknown };
type QlooInsightsEntity = QlooEntityPayload & {
  query?: { affinity?: unknown; explainability?: unknown };
};
type QlooInsightsPayload = { success?: unknown; results?: { entities?: unknown }; query?: unknown };

const SUPPORTED_INSIGHT_TYPES = new Set([
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:videogame",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEntityId(item: QlooEntityPayload): string | undefined {
  const id = typeof item.entity_id === "string" ? item.entity_id : item.id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

function toTypes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toCategory(types: string[]): EntityCategory {
  const type = types.find((item) => item.startsWith("urn:entity:"))?.replace("urn:entity:", "");
  if (type === "place" || type === "destination") return "place";
  if (type === "brand") return "brand";
  if (type === "person" || type === "artist") return "person";
  if (["movie", "book", "podcast", "tv_show", "videogame"].includes(type ?? "")) return "media";
  return "unknown";
}

function toGeography(item: QlooEntityPayload): GeographicContext | undefined {
  const source = isRecord(item.properties) && isRecord(item.properties.geocode)
    ? item.properties.geocode
    : isRecord(item.location) ? item.location : undefined;
  if (!source) return undefined;
  const context = {
    countryCode: typeof source.country_code === "string" ? source.country_code : undefined,
    region: typeof source.admin1_region === "string" ? source.admin1_region : undefined,
    city: typeof source.name === "string" ? source.name : typeof source.city === "string" ? source.city : undefined,
    latitude: typeof source.latitude === "number" ? source.latitude : undefined,
    longitude: typeof source.longitude === "number" ? source.longitude : undefined,
  };
  return Object.values(context).some((value) => value !== undefined) ? context : undefined;
}

function normalizeEntity(item: QlooEntityPayload, retrievedAt: string): CulturalEntity | undefined {
  const id = toEntityId(item);
  if (!id || typeof item.name !== "string" || !item.name.trim()) return undefined;
  const types = toTypes(item.types);
  return {
    id,
    providerId: "qloo",
    name: item.name,
    category: toCategory(types),
    geographicContext: toGeography(item),
    sourceReference: `qloo:entity:${id}`,
    metadata: {
      normalizedAt: retrievedAt,
      types,
      properties: isRecord(item.properties) ? item.properties : undefined,
      popularity: typeof item.popularity === "number" ? item.popularity : undefined,
      tags: Array.isArray(item.tags) ? item.tags : undefined,
    },
  };
}

export function normalizeQlooEntities(payload: QlooSearchPayload, retrievedAt: string): CulturalEntity[] {
  if (!isRecord(payload)) return [];
  const candidates = Array.isArray(payload.entities)
    ? payload.entities
    : isRecord(payload.results) && Array.isArray(payload.results.entities)
      ? payload.results.entities
      : Array.isArray(payload.results) ? payload.results : [];
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const entity = normalizeEntity(candidate, retrievedAt);
    return entity ? [entity] : [];
  });
}

function asExplainability(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function normalizeQlooAffinity(
  payload: QlooInsightsPayload,
  request: AffinityDiscoveryRequest,
  queryParameters: Record<string, string>,
  retrievedAt: string,
): CulturalEvidence[] {
  if (!isRecord(payload) || !isRecord(payload.results) || !Array.isArray(payload.results.entities)) return [];
  return payload.results.entities.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const item = candidate as QlooInsightsEntity;
    const objectEntityId = toEntityId(item);
    const score = isRecord(item.query) && typeof item.query.affinity === "number" ? item.query.affinity : undefined;
    if (!objectEntityId || score === undefined || !Number.isFinite(score)) return [];
    const parsed = AffinityEvidenceSchema.safeParse({
      kind: "affinity",
      subjectEntityId: request.entityId,
      objectEntityId,
      objectEntityName: typeof item.name === "string" && item.name.trim() ? item.name : undefined,
      providerScore: score,
      providerScoreScale: "qloo:affinity",
      explainability: request.explainability && isRecord(item.query)
        ? asExplainability(item.query.explainability)
        : undefined,
      geographicContext: request.geography,
      queryParameters,
      provenance: {
        providerId: "qloo",
        sourceReference: `qloo:insights:${request.entityId}:${objectEntityId}`,
        retrievedAt,
      },
    });
    return parsed.success ? [parsed.data] : [];
  });
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function responseError(providerId: string, response: Response): ProviderError {
  if (response.status === 401 || response.status === 403) {
    return { code: "AUTHENTICATION_ERROR", providerId, status: response.status, message: "Qloo authentication failed" };
  }
  if (response.status === 429) {
    return { code: "RATE_LIMITED", providerId, status: response.status, retryAfterMs: retryAfterMs(response), message: "Qloo rate limit exceeded" };
  }
  return {
    code: response.status >= 500 ? "UPSTREAM_ERROR" : "INVALID_RESPONSE",
    providerId,
    status: response.status,
    message: `Qloo request failed with status ${response.status}`,
  };
}

export class QlooProvider implements CulturalIntelligenceProvider {
  readonly id = "qloo";
  private readonly config: QlooConfig;
  private readonly httpClient: QlooHttpClient;
  private readonly clock: () => string;
  private readonly capabilities: ProviderCapabilities = {
    entitySearch: true,
    affinityDiscovery: true,
    geographicFiltering: true,
    explainability: false,
  };

  constructor(
    config: QlooConfig,
    httpClient: QlooHttpClient | QlooHttpRequest = new QlooHttpClient(undefined, config.timeoutMs),
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.config = config;
    this.httpClient = httpClient instanceof QlooHttpClient ? httpClient : new QlooHttpClient(httpClient, config.timeoutMs);
    this.clock = clock;
  }

  static fromEnvironment(httpClient?: QlooHttpRequest): QlooProvider {
    return new QlooProvider(qlooConfigFromEnvironment(), httpClient);
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  async searchEntities(request: EntitySearchRequest): Promise<ProviderResult<CulturalEntity[]>> {
    const url = new URL(this.config.searchPath, this.config.baseUrl);
    url.searchParams.set("query", request.query);
    if (request.category) url.searchParams.append("types", `urn:entity:${request.category}`);
    if (request.limit) url.searchParams.set("take", String(request.limit));
    if (request.geography?.latitude !== undefined && request.geography.longitude !== undefined) {
      url.searchParams.set("filter.location", `${request.geography.latitude},${request.geography.longitude}`);
    }
    return this.requestEntities(url);
  }

  async discoverAffinity(request: AffinityDiscoveryRequest): Promise<ProviderResult<CulturalEvidence[]>> {
    if (!SUPPORTED_INSIGHT_TYPES.has(request.targetType)) {
      return { ok: false, error: { code: "CONFIGURATION_ERROR", providerId: this.id, message: `Unsupported Qloo insight target type: ${request.targetType}` } };
    }
    const url = new URL(this.config.insightsPath, this.config.baseUrl);
    url.searchParams.set("filter.type", request.targetType);
    url.searchParams.set("signal.interests.entities", request.entityId);
    url.searchParams.set("feature.explainability", String(request.explainability ?? false));
    url.searchParams.set("sort_by", "affinity");
    url.searchParams.set("take", String(request.limit ?? 20));
    const locationQuery = request.locationQuery ?? request.geography?.city ?? request.geography?.region;
    if (locationQuery) url.searchParams.set("filter.location.query", locationQuery);
    return this.requestAffinity(url, request);
  }

  async explainEvidence(request: ExplainabilityRequest): Promise<ProviderResult<string>> {
    void request;
    return unsupportedCapability(this.id, "explainability");
  }

  private async requestEntities(url: URL): Promise<ProviderResult<CulturalEntity[]>> {
    try {
      const response = await this.httpClient.get(url.toString(), this.config.apiKey);
      if (!response.ok) return { ok: false, error: responseError(this.id, response) };
      const payload: unknown = await response.json();
      if (!isRecord(payload)) return { ok: false, error: { code: "INVALID_RESPONSE", providerId: this.id, message: "Qloo search response was not an object" } };
      return { ok: true, data: normalizeQlooEntities(payload, this.clock()) };
    } catch (error) {
      return { ok: false, error: this.errorFromException(error) };
    }
  }

  private async requestAffinity(url: URL, request: AffinityDiscoveryRequest): Promise<ProviderResult<CulturalEvidence[]>> {
    try {
      const response = await this.httpClient.get(url.toString(), this.config.apiKey);
      if (!response.ok) return { ok: false, error: responseError(this.id, response) };
      const payload: unknown = await response.json();
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.results) ||
        !Array.isArray(payload.results.entities) ||
        !isRecord(payload.query)
      ) {
        return { ok: false, error: { code: "INVALID_RESPONSE", providerId: this.id, message: "Qloo insights response did not contain success, results.entities, and query" } };
      }
      return {
        ok: true,
        data: normalizeQlooAffinity(payload, request, Object.fromEntries(url.searchParams.entries()), this.clock()),
      };
    } catch (error) {
      return { ok: false, error: this.errorFromException(error) };
    }
  }

  private errorFromException(error: unknown): ProviderError {
    if (error instanceof QlooTimeoutError || (error instanceof DOMException && error.name === "AbortError")) {
      return { code: "TIMEOUT", providerId: this.id, message: "Qloo request timed out" };
    }
    if (error instanceof SyntaxError) {
      return { code: "INVALID_RESPONSE", providerId: this.id, message: "Qloo returned malformed JSON" };
    }
    return { code: "NETWORK_ERROR", providerId: this.id, message: error instanceof Error ? error.message : "Unable to reach Qloo" };
  }
}
