import type { CulturalIntelligenceProvider } from "./interfaces/contracts";

export class ProviderRegistry {
  private readonly providers = new Map<string, CulturalIntelligenceProvider>();

  register(provider: CulturalIntelligenceProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): CulturalIntelligenceProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): CulturalIntelligenceProvider[] {
    return [...this.providers.values()];
  }
}
