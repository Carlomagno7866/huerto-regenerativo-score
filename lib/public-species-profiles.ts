import { getFullCatalog } from "./db";
import { scoreSingleCrop } from "./score";
import type { CropCandidate, OptimizationInput, ScoreBreakdown } from "./types";

const PUBLIC_INPUT: OptimizationInput = {
  gardenType: "natural-soil",
  objective: "balanced",
  mode: "home-garden",
  years: 1,
  subplots: 1,
  areaM2: 6,
  previousFamilies: [],
  priorityNutrients: ["protein", "fiber", "vitaminC", "iron"],
  excludedCropIds: [],
  excludedCropNames: []
};

export function getPublicSpeciesProfiles() {
  const seen = new Set<string>();
  const crops = getFullCatalog().filter((crop) => {
    if (seen.has(crop.id)) return false;
    seen.add(crop.id);
    return true;
  });

  return crops
    .map((crop) => toPublicSpecies(crop, scoreSingleCrop(crop, crops, PUBLIC_INPUT)))
    .sort((a, b) => a.commonName.localeCompare(b.commonName, "es"));
}

export function toPublicSpecies(crop: CropCandidate, score: ScoreBreakdown) {
  return {
    id: crop.id,
    commonName: crop.commonName,
    scientificName: crop.scientificName,
    family: crop.family,
    score,
    publicScore: Math.round(score.total * 100),
    exchangeValue: Number(score.total.toFixed(4)),
    yieldKgM2: crop.yieldKgM2,
    cycleDays: crop.cycleDays,
    waterMmCycle: crop.waterMmCycle,
    matchedFood: crop.matchedFood,
    nutrition: pickNutrients(crop.nutrition),
    evidence: crop.evidence,
    confidence: crop.confidence,
    riskAgents: crop.riskAgents.slice(0, 6),
    summary: score.explanation,
    evidenceNotes: score.evidenceNotes
  };
}

function pickNutrients(nutrition: Record<string, number>) {
  const labels: Record<string, string> = {
    energy: "Energia",
    protein: "Proteina",
    fiber: "Fibra",
    vitaminC: "Vitamina C",
    vitaminA: "Vitamina A",
    folate: "Folato",
    calcium: "Calcio",
    iron: "Hierro",
    potassium: "Potasio",
    magnesium: "Magnesio",
    zinc: "Zinc"
  };

  return Object.entries(labels)
    .map(([key, label]) => ({ key, label, value: nutrition[key] }))
    .filter((item) => typeof item.value === "number" && Number.isFinite(item.value));
}
