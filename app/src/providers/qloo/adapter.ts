import type { CulturalEntity } from "@/core/entities/types";
import { AffinityEvidenceSchema, type CulturalEvidence } from "@/core/evidence/types";
import {
  unsupportedCapability,
  type AffinityDiscoveryRequest,
  type CulturalIntelligenceProvider,
  type EntitySearchRequest,
  type ExplainabilityRequest,
  type ProviderCapabilities,
  type ProviderResult,
} from "@/providers/interfaces/contracts";
import { qlooConfigFromEnvironment, type QlooConfig } from "./config";

export type QlooHttpClient = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

type QlooEntityPayload = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  location?: { country_code?: unknown; region?: unknown; city?: unknown };
  source?: unknown;
};

type QlooSearchPayload = { results?: unknown; entities?: unknown };

type QlooAffinityPayload = { affinities?: unknown };

export function normalizeQlooEntities(
  payload: QlooSearchPayload,
  retrievedAt: string,
): CulturalEntity[] {
  const candidates = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.entities)
      ? payload.entities
      : [];

  return candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as QlooEntityPayload;
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    const parsed = {
      id: item.id,
      providerId: "qloo",
      name: item.name,
      category: typeof item.category === "string" ? item.category : "unknown",
      geographicContext: item.location
        ? {
            countryCode:
              typeof item.location.country_code === "string"
                ? item.location.country_code
                : undefined,
            region: typeof item.location.region === "string" ? item.location.region : undefined,
            city: typeof item.location.city === "string" ? item.location.city : undefined,
          }
        : undefined,
      sourceReference: typeof item.source === "string" ? item.source : `qloo:entity:${item.id}`,
      metadata: { normalizedAt: retrievedAt },
    };
    // Qloo category taxonomies may be broader than MOSAIC's domain categories.
    const category = ["person", "place", "brand", "media", "organization", "event", "food"].includes(
      parsed.category,
    )
      ? parsed.category
      : "unknown";
    return [{ ...parsed, category } as CulturalEntity];
  });
}

export function normalizeQlooAffinity(
  payload: QlooAffinityPayload,
  subjectEntityId: string,
  retrievedAt: string,
): CulturalEvidence[] {
  if (!Array.isArray(payload.affinities)) return [];
  return payload.affinities.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const objectEntityId = typeof item.entity_id === "string" ? item.entity_id : item.id;
    if (typeof objectEntityId !== "string") return [];
    const parsed = AffinityEvidenceSchema.safeParse({
      kind: "affinity",
      subjectEntityId,
      objectEntityId,
      providerScore: typeof item.score === "number" ? item.score : undefined,
      providerScoreLabel: typeof item.score_label === "string" ? item.score_label : undefined,
      providerScoreScale: typeof item.score_scale === "string" ? item.score_scale : undefined,
      provenance: {
        providerId: "qloo",
        sourceReference:
          typeof item.source === "string" ? item.source : `qloo:affinity:${subjectEntityId}:${objectEntityId}`,
        retrievedAt,
      },
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export class QlooProvider implements CulturalIntelligenceProvider {
  readonly id = "qloo";
  private readonly config: QlooConfig;
  private readonly httpClient: QlooHttpClient;
  private readonly clock: () => string;
  private readonly capabilities: ProviderCapabilities = {
    entitySearch: true,
    affinityDiscovery: false,
    geographicFiltering: true,
    explainability: false,
  };

  constructor(
    config: QlooConfig,
    httpClient: QlooHttpClient = fetch,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.config = config;
    this.httpClient = httpClient;
    this.clock = clock;
  }

  static fromEnvironment(
    httpClient?: QlooHttpClient,
  ): QlooProvider {
    return new QlooProvider(qlooConfigFromEnvironment(), httpClient);
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  async searchEntities(request: EntitySearchRequest): Promise<ProviderResult<CulturalEntity[]>> {
    return this.requestEntities(this.config.searchPath, request);
  }

  async discoverAffinity(
    request: AffinityDiscoveryRequest,
  ): Promise<ProviderResult<CulturalEvidence[]>> {
    void request;
    return unsupportedCapability(this.id, "affinityDiscovery");
  }

  async explainEvidence(
    request: ExplainabilityRequest,
  ): Promise<ProviderResult<string>> {
    void request;
    return unsupportedCapability(this.id, "explainability");
  }

  private async requestEntities(
    path: string,
    request: EntitySearchRequest,
  ): Promise<ProviderResult<CulturalEntity[]>> {
    try {
      const url = new URL(path, this.config.baseUrl);
      url.searchParams.set("query", request.query);
      if (request.category) url.searchParams.set("category", request.category);
      if (request.limit) url.searchParams.set("limit", String(request.limit));
      if (request.geography?.countryCode) {
        url.searchParams.set("country_code", request.geography.countryCode);
      }
      if (request.geography?.region) url.searchParams.set("region", request.geography.region);
      if (request.geography?.city) url.searchParams.set("city", request.geography.city);
      if (request.geography?.latitude !== undefined) {
        url.searchParams.set("latitude", String(request.geography.latitude));
      }
      if (request.geography?.longitude !== undefined) {
        url.searchParams.set("longitude", String(request.geography.longitude));
      }
      const response = await this.httpClient(url.toString(), {
        headers: { authorization: `Bearer ${this.config.apiKey}`, accept: "application/json" },
      });
      if (!response.ok) {
        return { ok: false, error: { code: "NETWORK_ERROR", providerId: this.id, message: `Qloo request failed with status ${response.status}` } };
      }
      const payload = (await response.json()) as QlooSearchPayload;
      return { ok: true, data: normalizeQlooEntities(payload, this.clock()) };
    } catch (error) {
      return { ok: false, error: { code: "INVALID_RESPONSE", providerId: this.id, message: error instanceof Error ? error.message : "Unable to read Qloo response" } };
    }
  }
}
