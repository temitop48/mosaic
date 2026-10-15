// DEVELOPMENT-ONLY: makes exactly one search request and one Insights request.
// It reads only process environment variables; it never loads .env.local.
import { QlooProvider } from "../src/providers/qloo/adapter.ts";

if (!process.env.QLOO_API_KEY) {
  console.error("Qloo smoke test skipped: QLOO_API_KEY is not present in the process environment.");
  console.error("Run it locally with the server-side environment loaded, for example:");
  console.error("  QLOO_API_KEY=<value> npm run qloo:smoke");
  process.exit(2);
}

const provider = QlooProvider.fromEnvironment();
const search = await provider.searchEntities({ query: "Starbucks", category: "brand", limit: 10 });
if (!search.ok) {
  console.error(`Qloo entity search failed: ${search.error.code} (${search.error.message})`);
  process.exit(1);
}

const seed = search.data.find((entity) => entity.category === "brand") ?? search.data[0];
if (!seed) {
  console.error("Qloo entity search returned no usable Starbucks seed entity.");
  process.exit(1);
}

console.log("DEVELOPMENT-ONLY Qloo smoke test");
console.log(`Entity search count: ${search.data.length}`);
console.log(`Seed entity name: ${seed.name}`);
console.log(`Seed entity category: ${seed.category}`);

const affinity = await provider.discoverAffinity({
  entityId: seed.id,
  targetType: "urn:entity:place",
  locationQuery: "London",
  geography: { city: "London" },
  limit: 20,
  explainability: true,
});
if (!affinity.ok) {
  console.error(`Qloo Insights request failed: ${affinity.error.code} (${affinity.error.message})`);
  process.exit(1);
}

console.log(`London affinity evidence count: ${affinity.data.length}`);
console.log("Affinity samples:");
for (const evidence of affinity.data.slice(0, 5)) {
  console.log(JSON.stringify({
    targetName: evidence.objectEntityName,
    targetEntityId: evidence.objectEntityId,
    affinity: evidence.providerScore,
    hasExplainability: Boolean(evidence.explainability),
    locationQuery: evidence.queryParameters["filter.location.query"],
  }));
}
