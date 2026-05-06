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
  const weights = normalizeWeights(input.priorities);
  const gramsHarvest = crop.yieldKgM2 * input.areaM2 * 1000;
  const nutrition = scoreNutrition(crop, gramsHarvest, input.focusNutrients);
  const resources = clamp01(1 - (0.55 * crop.waterMmCycle) / 520 - (0.45 * crop.cycleDays) / 180);
  const rotation = scoreRotation(crop.family, historyFamilies);
  const diversity = yearFamilies.includes(crop.family) ? 0.55 : 0.92;
  const resilience = clamp01(rotation * 0.75 + diversity * 0.25);
  const soil = crop.soilFit;
  const total = clamp01(
    nutrition.value * weights.nutrition +
      resources * weights.resources +
      resilience * weights.resilience +
      soil * 0.08
  );

  const explanation = [
    `Aporta ${Math.round(nutrition.value * 100)}% del subindice nutricional para ${input.areaM2} m2.`,
    resources > 0.65 ? "Uso de agua y tiempo competitivo." : "Demanda de agua o duracion relativamente alta.",
    rotation < 0.7 ? `Rotacion tensionada por familia ${crop.family}.` : `Buena distancia rotacional para ${crop.family}.`
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

  for (let year = 1; year <= input.years; year += 1) {
    const yearFamilies: string[] = [];
    const yearCropIds: string[] = [];
    for (let subplot = 1; subplot <= input.subplots; subplot += 1) {
      const history = historyByPlot[subplot - 1];
      const ranked = crops
        .filter((crop) => !yearCropIds.includes(crop.id) || yearCropIds.length >= crops.length)
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

function scoreNutrition(crop: CropCandidate, gramsHarvest: number, focus: string[]) {
  let weighted = 0;
  let totalWeight = 0;
  const contributions: Record<string, number> = {};

  for (const [key, target] of Object.entries(DAILY_TARGETS)) {
    const amountPer100g = crop.nutrition[key] ?? 0;
    const delivered = (amountPer100g * gramsHarvest) / 100;
    const focusBoost = focus.includes(key) ? 1.45 : 1;
    const weight = target.weight * focusBoost;
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

function familyInterval(family: string) {
  const lower = family.toLowerCase();
  if (lower.includes("solanaceae")) return 4;
  if (lower.includes("brassicaceae")) return 4;
  if (lower.includes("cucurbitaceae")) return 3;
  if (lower.includes("fabaceae")) return 3;
  if (lower.includes("poaceae")) return 2;
  return 3;
}

function normalizeWeights(priorities: OptimizationInput["priorities"]) {
  const total = priorities.nutrition + priorities.resources + priorities.resilience || 1;
  return {
    nutrition: priorities.nutrition / total,
    resources: priorities.resources / total,
    resilience: priorities.resilience / total
  };
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
