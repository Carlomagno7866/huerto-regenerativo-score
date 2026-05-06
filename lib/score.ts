import type { Assignment, CropCandidate, OptimizationInput, ScoreBreakdown } from "./types";

const DAILY_TARGETS: Record<string, { label: string; amount: number; weight: number }> = {
  protein: { label: "proteina", amount: 50, weight: 0.9 },
  fiber: { label: "fibra", amount: 28, weight: 1.1 },
  vitaminA: { label: "vitamina A", amount: 900, weight: 0.8 },
  vitaminC: { label: "vitamina C", amount: 90, weight: 1.0 },
  folate: { label: "folato", amount: 400, weight: 0.9 },
  calcium: { label: "calcio", amount: 1000, weight: 0.7 },
  iron: { label: "hierro", amount: 18, weight: 1.0 },
  zinc: { label: "zinc", amount: 11, weight: 0.8 },
  potassium: { label: "potasio", amount: 3400, weight: 0.7 },
  magnesium: { label: "magnesio", amount: 420, weight: 0.7 }
};

export function scoreCrop(
  crop: CropCandidate,
  input: OptimizationInput,
  historyFamilies: string[],
  yearFamilies: string[]
): ScoreBreakdown {
  const gramsHarvest = crop.yieldKgM2 * input.areaM2 * 1000;
  const nutrition = scoreNutrition(crop, gramsHarvest);
  const resources = clamp01(1 - (0.55 * crop.waterMmCycle) / 520 - (0.45 * crop.cycleDays) / 180);
  const rotation = scoreRotation(crop.family, historyFamilies);
  const diversity = yearFamilies.includes(crop.family) ? 0.55 : 0.92;
  const resilience = clamp01(rotation * 0.75 + diversity * 0.25);
  const soil = crop.soilFit;
  const speciesScore = clamp01(nutrition.value * 0.68 + resources * 0.32);
  const total = clamp01(speciesScore * 0.72 + resilience * 0.2 + soil * 0.08);

  const explanation = [
    `SCORE especie ${Math.round(speciesScore * 100)}: balance entre aporte nutricional adulto promedio y consumo de agua/tiempo.`,
    `Aporta ${Math.round(nutrition.value * 100)}% del subindice nutricional promedio para ${input.areaM2} m2.`,
    rotation < 0.7
      ? `Rotacion tensionada por repetir ${crop.family}; se penaliza por riesgo sanitario y malezas.`
      : `Buena distancia rotacional para ${crop.family}; favorece menor presion potencial de plagas y malezas.`
  ];

  return {
    total,
    nutrition: nutrition.value,
    resources,
    resilience,
    soil,
    diversity,
    confidence: crop.confidence,
    explanation,
    nutrients: nutrition.contributions
  };
}

export function optimize(crops: CropCandidate[], input: OptimizationInput): Assignment[] {
  const assignments: Assignment[] = [];
  const historyByPlot = Array.from({ length: input.subplots }, () => [...input.previousFamilies]);
  const familyGroups = groupByFamily(crops);

  for (let year = 1; year <= input.years; year += 1) {
    const yearFamilies: string[] = [];
    const yearCropIds: string[] = [];
    for (let subplot = 1; subplot <= input.subplots; subplot += 1) {
      const history = historyByPlot[subplot - 1];
      const familyRank = Array.from(familyGroups.keys())
        .map((family) => ({
          family,
          score: scoreFamilyRotation(family, history, yearFamilies)
        }))
        .sort((a, b) => b.score - a.score);
      const candidateFamilies = familyRank.length ? familyRank : [{ family: "", score: 0 }];
      const preferredFamily = candidateFamilies[0].family;
      const familyPool = familyGroups.get(preferredFamily) ?? crops;
      const ranked = familyPool
        .filter((crop) => !yearCropIds.includes(crop.id) || yearCropIds.length >= familyPool.length)
        .map((crop) => ({
          crop,
          score: scoreCrop(crop, input, history, yearFamilies)
        }))
        .sort((a, b) => b.score.total - a.score.total);
      const selected = ranked[0];
      assignments.push({
        year,
        subplot,
        crop: selected.crop,
        score: selected.score,
        ...windowsForYear(year, selected.crop.cycleDays)
      });
      history.push(selected.crop.family);
      yearFamilies.push(selected.crop.family);
      yearCropIds.push(selected.crop.id);
    }
  }

  return assignments;
}

function scoreNutrition(crop: CropCandidate, gramsHarvest: number) {
  let weighted = 0;
  let totalWeight = 0;
  const contributions: Record<string, number> = {};

  for (const [key, target] of Object.entries(DAILY_TARGETS)) {
    const amountPer100g = crop.nutrition[key] ?? 0;
    const delivered = (amountPer100g * gramsHarvest) / 100;
    const weight = target.weight;
    const adequacy = clamp01(delivered / (target.amount * 30));
    contributions[key] = adequacy;
    weighted += adequacy * weight;
    totalWeight += weight;
  }

  return { value: totalWeight ? weighted / totalWeight : 0.25, contributions };
}

function scoreRotation(family: string, historyFamilies: string[]) {
  const lastIndex = [...historyFamilies].reverse().findIndex((item) => item === family);
  if (lastIndex === -1) return 0.95;
  const yearsSince = lastIndex + 1;
  const ideal = familyInterval(family);
  return clamp01(0.25 + (yearsSince / ideal) * 0.7);
}

function scoreFamilyRotation(family: string, historyFamilies: string[], yearFamilies: string[]) {
  const rotation = scoreRotation(family, historyFamilies);
  const annualDiversity = yearFamilies.includes(family) ? 0.35 : 1;
  return clamp01(rotation * 0.8 + annualDiversity * 0.2);
}

function familyInterval(family: string) {
  const lower = family.toLowerCase();
  if (lower.includes("solanaceae")) return 4;
  if (lower.includes("brassicaceae")) return 4;
  if (lower.includes("cucurbitaceae")) return 3;
  if (lower.includes("fabaceae")) return 3;
  if (lower.includes("poaceae")) return 2;
  return 3;
}

function windowsForYear(year: number, cycleDays: number) {
  const harvestMonth = cycleDays > 105 ? "marzo-abril" : cycleDays > 80 ? "febrero-marzo" : "enero-febrero";
  return {
    sowingWindow: `Ano ${year}: septiembre-octubre`,
    harvestWindow: `Ano ${year}: ${harvestMonth}`
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function groupByFamily(crops: CropCandidate[]) {
  const map = new Map<string, CropCandidate[]>();
  for (const crop of crops) {
    map.set(crop.family, [...(map.get(crop.family) ?? []), crop]);
  }
  return map;
}
