import type { Assignment, NutrientPriority, ProductionSummary } from "./types";

const NUTRIENT_OUTPUTS: Array<{
  key: NutrientPriority;
  label: string;
  unit: string;
  dailyTarget: number;
  targetUnit: string;
}> = [
  { key: "protein", label: "Proteina", unit: "kg", dailyTarget: 50, targetUnit: "g/dia" },
  { key: "fiber", label: "Fibra", unit: "kg", dailyTarget: 28, targetUnit: "g/dia" },
  { key: "vitaminC", label: "Vitamina C", unit: "g", dailyTarget: 90, targetUnit: "mg/dia" },
  { key: "folate", label: "Folato", unit: "g", dailyTarget: 400, targetUnit: "ug/dia" },
  { key: "iron", label: "Hierro", unit: "g", dailyTarget: 18, targetUnit: "mg/dia" },
  { key: "magnesium", label: "Magnesio", unit: "g", dailyTarget: 420, targetUnit: "mg/dia" },
  { key: "potassium", label: "Potasio", unit: "kg", dailyTarget: 3400, targetUnit: "mg/dia" },
  { key: "calcium", label: "Calcio", unit: "kg", dailyTarget: 1000, targetUnit: "mg/dia" },
  { key: "zinc", label: "Zinc", unit: "g", dailyTarget: 11, targetUnit: "mg/dia" },
  { key: "vitaminA", label: "Vitamina A", unit: "g", dailyTarget: 900, targetUnit: "ug RAE/dia" },
  { key: "energy", label: "Energia", unit: "kcal", dailyTarget: 2200, targetUnit: "kcal/dia" }
];

export function summarizeProduction(assignments: Assignment[], areaM2: number): ProductionSummary {
  const totalKg = assignments.reduce((sum, item) => sum + harvestKg(item, areaM2), 0);
  const cropTotals = new Map<string, number>();
  const years = new Set(assignments.map((item) => item.year));
  const subplots = new Set(assignments.map((item) => item.subplot));

  for (const item of assignments) {
    const kg = harvestKg(item, areaM2);
    cropTotals.set(item.crop.commonName, (cropTotals.get(item.crop.commonName) ?? 0) + kg);
  }

  const nutrients = NUTRIENT_OUTPUTS.map((nutrient) => {
    const rawAmount = assignments.reduce((sum, item) => {
      const amountPer100g = item.crop.nutrition[nutrient.key] ?? 0;
      return sum + (amountPer100g * harvestKg(item, areaM2) * 1000) / 100;
    }, 0);
    const amount = convertRawAmount(rawAmount, nutrient.unit);
    const dailyPortions = rawAmount / nutrient.dailyTarget;
    return {
      ...nutrient,
      amount,
      dailyPortions,
      share: 0
    };
  })
    .filter((item) => item.amount > 0 && item.dailyPortions > 0)
    .sort((a, b) => b.dailyPortions - a.dailyPortions);

  const maxDailyPortions = nutrients[0]?.dailyPortions ?? 1;

  return {
    totalKg,
    totalAreaM2: assignments.length * areaM2,
    bedCount: subplots.size,
    years: years.size,
    topNutrients: nutrients.slice(0, 6).map((item) => ({
      ...item,
      share: item.dailyPortions / maxDailyPortions
    })),
    cropShares: Array.from(cropTotals.entries())
      .map(([crop, kg]) => ({
        crop,
        kg,
        share: totalKg > 0 ? kg / totalKg : 0
      }))
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 5)
  };
}

function harvestKg(item: Assignment, areaM2: number) {
  return item.crop.yieldKgM2 * areaM2;
}

function convertRawAmount(value: number, unit: string) {
  if (unit === "kg") return value / 1000;
  if (unit === "g") return value / 1000;
  return value;
}
