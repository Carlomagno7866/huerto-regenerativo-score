import { getFullCatalog } from "./db";

export function getSpeciesOptions() {
  const seen = new Set<string>();
  return getFullCatalog()
    .filter((crop) => {
      if (seen.has(crop.id)) return false;
      seen.add(crop.id);
      return true;
    })
    .sort((a, b) => a.commonName.localeCompare(b.commonName, "es"))
    .map((crop) => ({
      id: crop.id,
      commonName: crop.commonName,
      scientificName: crop.scientificName,
      family: crop.family
    }));
}
