import type { CulturalEntity, EntityCategory, GeographicContext } from "@/core/entities/types";
import type { CulturalEvidence } from "@/core/evidence/types";

export type ProviderCapabilities = Readonly<{
  entitySearch: boolean;
  affinityDiscovery: boolean;
  geographicFiltering: boolean;
  explainability: boolean;
}>;

export type EntitySearchRequest = {
  query: string;
  category?: string;
  geography?: GeographicContext;
  limit?: number;
};

export type AffinityDiscoveryRequest = {
  entityId: string;
  sourceEntityCategory: EntityCategory;
  sourceEntityName?: string;
  targetType: string;
  locationQuery?: string;
  geography?: GeographicContext;
  limit?: number;
  explainability?: boolean;
};

export type ExplainabilityRequest = { evidenceId: string };

export type ProviderErrorCode =
  | "UNSUPPORTED_CAPABILITY"
  | "CONFIGURATION_ERROR"
  | "NETWORK_ERROR"
  | "AUTHENTICATION_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE";

export type ProviderError = {
  code: ProviderErrorCode;
  providerId: string;
  message: string;
  status?: number;
  retryAfterMs?: number;
};

export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ProviderError };

export interface CulturalIntelligenceProvider {
  readonly id: string;
  getCapabilities(): ProviderCapabilities;
  searchEntities(request: EntitySearchRequest): Promise<ProviderResult<CulturalEntity[]>>;
  discoverAffinity(
    request: AffinityDiscoveryRequest,
  ): Promise<ProviderResult<CulturalEvidence[]>>;
  explainEvidence(
    request: ExplainabilityRequest,
  ): Promise<ProviderResult<string>>;
}

export function unsupportedCapability(
  providerId: string,
  capability: keyof ProviderCapabilities,
): ProviderResult<never> {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_CAPABILITY",
      providerId,
      message: `Provider does not support capability: ${capability}`,
    },
  };
}
