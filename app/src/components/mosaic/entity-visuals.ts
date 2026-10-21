export type MosaicEntityVisualCategory =
  | "place"
  | "brand"
  | "person"
  | "media"
  | "food"
  | "organization"
  | "event"
  | "unknown";

const CATEGORY_ARTWORK: Record<MosaicEntityVisualCategory, string> = {
  place: "/design-assets/category-icons/location-neutral.svg",
  brand: "/design-assets/category-icons/lifestyle.png",
  person: "/design-assets/category-icons/art-culture.png",
  media: "/design-assets/category-icons/art-culture.png",
  food: "/design-assets/category-icons/dining.png",
  organization: "/design-assets/category-icons/lifestyle.png",
  event: "/design-assets/category-icons/art-culture.png",
  unknown: "/design-assets/category-icons/art-culture.png",
};

export function entityVisualForCategory(category: string): string {
  return (
    CATEGORY_ARTWORK[category as MosaicEntityVisualCategory] ??
    CATEGORY_ARTWORK.unknown
  );
}

/** Stable, display-only visual variation. Never changes Qloo categorization or evidence. */
export function entityVisualForEntity(
  category: string,
  providerId: string | undefined,
  entityId: string,
): string {
  if (category !== "place") return entityVisualForCategory(category);
  const identity = `${providerId ?? "unknown"}:${entityId}`;
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619);
  }
  return `/design-assets/category-icons/location-paper-${hash >>> 0 & 7}.svg`;
}
