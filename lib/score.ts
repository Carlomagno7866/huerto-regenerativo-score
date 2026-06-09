import type {
  Assignment,
  CropCandidate,
  EvidenceLevel,
  NutrientPriority,
  OptimizationInput,
  RotationAgent,
  ScoreBreakdown,
  ScoreConfidence
} from "./types";

const DAILY_TARGETS: Record<string, { label: string; amount: number; weight: number }> = {
  protein: { label: "proteina", amount: 50, weight: 0.95 },
  fiber: { label: "fibra", amount: 28, weight: 1.1 },
  vitaminA: { label: "vitamina A", amount: 900, weight: 0.75 },
  vitaminC: { label: "vitamina C", amount: 90, weight: 1.0 },
  folate: { label: "folato", amount: 400, weight: 0.9 },
  calcium: { label: "calcio", amount: 1000, weight: 0.7 },
  iron: { label: "hierro", amount: 18, weight: 1.0 },
  zinc: { label: "zinc", amount: 11, weight: 0.8 },
  potassium: { label: "potasio", amount: 3400, weight: 0.7 },
  magnesium: { label: "magnesio", amount: 420, weight: 0.7 }
};

const SCORE_WEIGHTS = {
  nutrition: 0.6,
  resources: 0.4
};

const CONFIDENCE_PENALTY_SHARE = 0.03;

type Benchmarks = {
  nutrientsPerM2Day: [number, number];
  nutrientsPerLiter: [number, number];
  nutritionScore: [number, number];
};

export function scoreCrop(
  crop: CropCandidate,
  input: OptimizationInput,
  previousCrops: CropCandidate[],
  previousFamilies: string[],
  yearFamilies: string[],
  benchmarks: Benchmarks
): ScoreBreakdown {
  const diagnostics = nutrientDiagnostics(crop, input);
  const nutrition = normalizeRange(diagnostics.nutritionScore, benchmarks.nutritionScore);
  const waterEfficiency = normalizeRange(diagnostics.nutrientsPerLiter, benchmarks.nutrientsPerLiter);
  const spaceTimeEfficiency = normalizeRange(diagnostics.nutrientsPerM2Day, benchmarks.nutrientsPerM2Day);
  const waterBurden = clamp01(1 - (crop.waterMmCycle - 250) / 650);
  const cycleEfficiency = clamp01(1 - (crop.cycleDays - 45) / 145);
  const resources = clamp01(waterEfficiency * 0.44 + spaceTimeEfficiency * 0.34 + waterBurden * 0.12 + cycleEfficiency * 0.1);
  const rotation = scoreRotationV2(crop, previousCrops, previousFamilies, yearFamilies);
  const soil = crop.soilFit;
  const cost = 0;
  const evidenceScore = clamp01(nutrition * SCORE_WEIGHTS.nutrition + resources * SCORE_WEIGHTS.resources);
  const confidence = confidenceScore(crop.confidence);
  const total = clamp01(evidenceScore * (1 - CONFIDENCE_PENALTY_SHARE + CONFIDENCE_PENALTY_SHARE * confidence));
  const leadingNutrients = topNutrients(diagnostics.contributions);
  const sharedAgent = rotation.sharedAgents[0];

  const explanation = [
    `${crop.commonName} logra SCORE v2 ${Math.round(total * 100)} por rendimiento ${crop.yieldKgM2.toFixed(2)} kg/m2, ciclo de ${crop.cycleDays} dias y ${Math.round(crop.waterMmCycle)} mm de agua.`,
    leadingNutrients.length
      ? `Aporta mejor en ${leadingNutrients.join(", ")}; el subindice nutricional queda en ${Math.round(nutrition * 100)}.`
      : `No hay suficientes nutrientes USDA trazables; el componente nutricional se conserva bajo.`,
    sharedAgent
      ? `Restriccion sanitaria: comparte ${sharedAgent.name} con cultivos previos; el planificador debe evitarlo si hay alternativas.`
      : rotation.familyPenalty
        ? `La familia ${crop.family} aparece cerca en la rotacion; el planificador la trata como restriccion.`
        : `La rotacion queda fuera del SCORE y se aplica como restriccion obligatoria de planificacion.`
  ];

  const evidenceNotes = [
    `Rendimiento: ${crop.evidence.yieldKgM2.label}${crop.evidence.yieldKgM2.matchedItem ? ` (${crop.evidence.yieldKgM2.matchedItem})` : ""}.`,
    `Agua/ciclo: ${crop.evidence.waterMmCycle.label}.`,
    `Nutricion: ${crop.evidence.nutrition.matchedFood ?? crop.evidence.nutrition.label}.`,
    `SCORE independiente del objetivo: nutricion ${Math.round(SCORE_WEIGHTS.nutrition * 100)}%, recursos ${Math.round(SCORE_WEIGHTS.resources * 100)}%, confianza como penalizacion maxima ${Math.round(CONFIDENCE_PENALTY_SHARE * 100)}%.`
  ];

  return {
    version: "SCORE_V2",
    total,
    nutrition,
    resources,
    resilience: rotation.value,
    soil,
    diversity: rotation.diversity,
    rotation: rotation.value,
    agentBreak: rotation.agentBreak,
    cost,
    confidence,
    confidenceDetail: crop.confidence,
    explanation,
    evidenceNotes,
    nutrients: diagnostics.contributions,
    diagnostics: {
      kgHarvest: diagnostics.kgHarvest,
      waterLiters: diagnostics.waterLiters,
      cycleDays: crop.cycleDays,
      usefulNutrientPoints: diagnostics.usefulNutrientPoints,
      priorityNutrientValue: diagnostics.priorityNutrientValue,
      nutrientYieldByTarget: diagnostics.nutrientYieldByTarget,
      nutrientsPerM2Day: diagnostics.nutrientsPerM2Day,
      nutrientsPerLiter: diagnostics.nutrientsPerLiter
    }
  };
}

export function optimize(crops: CropCandidate[], input: OptimizationInput): Assignment[] {
  const assignments: Assignment[] = [];
  const historyByPlot = Array.from({ length: input.subplots }, () => [] as CropCandidate[]);
  const candidates = crops.filter((crop) => isAllowedCrop(crop, input));
  const benchmarks = buildBenchmarks(candidates, input);
  const usedCropIds = new Set<string>();
  let previousYearCropIds = new Set<string>();

  for (let year = 1; year <= input.years; year += 1) {
    const yearFamilies: string[] = [];
    const yearCropIds: string[] = [];
    for (let subplot = 1; subplot <= input.subplots; subplot += 1) {
      const history = historyByPlot[subplot - 1];
      const selected = selectCropForSlot(
        candidates,
        input,
        history,
        input.previousFamilies,
        yearFamilies,
        yearCropIds,
        usedCropIds,
        previousYearCropIds,
        benchmarks
      );
      if (!selected) break;
      assignments.push({
        year,
        subplot,
        crop: selected.crop,
        score: selected.score,
        ...windowsForYear(year, selected.crop.cycleDays)
      });
      history.push(selected.crop);
      usedCropIds.add(selected.crop.id);
      yearFamilies.push(selected.crop.family);
      yearCropIds.push(selected.crop.id);
    }
    previousYearCropIds = new Set(yearCropIds);
  }

  return assignments;
}

function selectCropForSlot(
  candidates: CropCandidate[],
  input: OptimizationInput,
  history: CropCandidate[],
  previousFamilies: string[],
  yearFamilies: string[],
  yearCropIds: string[],
  usedCropIds: Set<string>,
  previousYearCropIds: Set<string>,
  benchmarks: Benchmarks
) {
  const basePredicates = [
    (crop: CropCandidate) => !isDuplicateInYear(crop, candidates, yearCropIds),
    (crop: CropCandidate) => !history.some((item) => item.id === crop.id),
    (crop: CropCandidate) => !usedCropIds.has(crop.id),
    (crop: CropCandidate) => !previousYearCropIds.has(crop.id),
    (crop: CropCandidate) => passesFamilyRotation(crop, history, previousFamilies),
    (crop: CropCandidate) => !yearFamilies.includes(crop.family)
  ];
  const attempts = [
    basePredicates,
    basePredicates.slice(0, 5),
    basePredicates.slice(0, 4),
    basePredicates.slice(0, 3),
    [basePredicates[0]],
    []
  ];

  for (const predicates of attempts) {
    const ranked = candidates
      .filter((crop) => predicates.every((predicate) => predicate(crop)))
      .map((crop) => ({
        crop,
        score: scoreCrop(crop, input, history, previousFamilies, yearFamilies, benchmarks)
      }))
      .sort((a, b) => compareRankedCrops(a, b, input));
    if (ranked[0]) return ranked[0];
  }

  return null;
}

function compareRankedCrops(
  a: { crop: CropCandidate; score: ScoreBreakdown },
  b: { crop: CropCandidate; score: ScoreBreakdown },
  input: OptimizationInput
) {
  if (input.objective === "low-water") {
    return (
      a.crop.waterMmCycle - b.crop.waterMmCycle ||
      b.score.total - a.score.total ||
      a.crop.commonName.localeCompare(b.crop.commonName, "es")
    );
  }

  if (input.objective === "max-nutrients") {
    return (
      b.score.diagnostics.priorityNutrientValue - a.score.diagnostics.priorityNutrientValue ||
      b.score.nutrition - a.score.nutrition ||
      b.score.total - a.score.total ||
      a.crop.waterMmCycle - b.crop.waterMmCycle ||
      a.crop.commonName.localeCompare(b.crop.commonName, "es")
    );
  }

  return (
    b.score.total - a.score.total ||
    b.score.nutrition - a.score.nutrition ||
    a.crop.waterMmCycle - b.crop.waterMmCycle ||
    a.crop.commonName.localeCompare(b.crop.commonName, "es")
  );
}

export function scoreSingleCrop(crop: CropCandidate, crops: CropCandidate[], input: OptimizationInput): ScoreBreakdown {
  const benchmarks = buildBenchmarks(crops, input);
  return scoreCrop(crop, input, [], input.previousFamilies, [], benchmarks);
}

function nutrientDiagnostics(crop: CropCandidate, input: OptimizationInput) {
  const kgHarvest = crop.yieldKgM2 * input.areaM2;
  const gramsHarvest = kgHarvest * 1000;
  const waterLiters = Math.max(1, crop.waterMmCycle * input.areaM2);
  const activePriorities = input.objective === "max-nutrients" ? input.priorityNutrients : [];
  let weighted = 0;
  let totalWeight = 0;
  let usefulNutrientPoints = 0;
  let priorityNutrientValue = 0;
  const contributions: Record<string, number> = {};
  const nutrientYieldByTarget: Record<string, number> = {};

  for (const [key, target] of Object.entries(DAILY_TARGETS)) {
    const amountPer100g = crop.nutrition[key] ?? 0;
    const delivered = (amountPer100g * gramsHarvest) / 100;
    const nutrientDays = delivered / target.amount;
    const adequacy = clamp01(nutrientDays / Math.max(30, crop.cycleDays));
    contributions[key] = adequacy;
    nutrientYieldByTarget[key] = nutrientDays;
    if (input.objective === "max-nutrients" && activePriorities.includes(key as NutrientPriority)) {
      priorityNutrientValue += nutrientDays;
    }
    weighted += adequacy * target.weight;
    totalWeight += target.weight;
    usefulNutrientPoints += Math.min(nutrientDays, crop.cycleDays) * target.weight;
  }

  if (activePriorities.includes("energy")) {
    const energyKcal = crop.nutrition.energy ?? 0;
    const deliveredEnergy = (energyKcal * gramsHarvest) / 100;
    const energyDays = deliveredEnergy / 2200;
    const energyAdequacy = clamp01(energyDays / Math.max(30, crop.cycleDays));
    contributions.energy = energyAdequacy;
    nutrientYieldByTarget.energy = energyDays;
    priorityNutrientValue += energyDays;
  }

  if (input.objective === "max-nutrients" && !activePriorities.length) {
    priorityNutrientValue = Object.values(nutrientYieldByTarget).reduce((sum, value) => sum + value, 0);
  }

  const nutritionScore = totalWeight ? weighted / totalWeight : 0;
  return {
    kgHarvest,
    waterLiters,
    nutritionScore,
    usefulNutrientPoints,
    priorityNutrientValue,
    nutrientYieldByTarget,
    nutrientsPerM2Day: usefulNutrientPoints / Math.max(1, input.areaM2 * crop.cycleDays),
    nutrientsPerLiter: usefulNutrientPoints / waterLiters,
    contributions
  };
}

function isAllowedCrop(crop: CropCandidate, input: OptimizationInput) {
  if (input.excludedCropIds.includes(crop.id)) return false;
  if (!input.excludedCropNames.length) return true;
  return !input.excludedCropNames.some((name) => isExcludedByName(crop, name));
}

function isExcludedByName(crop: CropCandidate, rawName: string) {
  const name = normalizeText(rawName);
  if (!name) return false;
  const commonName = normalizeText(crop.commonName);
  const scientificName = normalizeText(crop.scientificName);
  const family = normalizeText(crop.family);
  return commonName.includes(name) || family === name || (name.includes(" ") && scientificName.includes(name));
}

function isDuplicateInYear(crop: CropCandidate, candidates: CropCandidate[], yearCropIds: string[]) {
  return yearCropIds.includes(crop.id) && yearCropIds.length < Math.min(candidates.length, yearCropIds.length + 1);
}

function passesFamilyRotation(crop: CropCandidate, history: CropCandidate[], previousFamilies: string[]) {
  const historyFamilies = [...previousFamilies, ...history.map((item) => item.family)];
  const lastIndex = [...historyFamilies].reverse().findIndex((family) => family === crop.family);
  if (lastIndex === -1) return true;
  return lastIndex + 1 >= familyInterval(crop.family);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreRotationV2(crop: CropCandidate, previousCrops: CropCandidate[], previousFamilies: string[], yearFamilies: string[]) {
  const historyFamilies = [...previousFamilies, ...previousCrops.map((item) => item.family)];
  const familyInterval = scoreFamilyInterval(crop.family, historyFamilies);
  const sharedAgents = sharedHostAgents(previousCrops.flatMap((item) => item.riskAgents), crop.riskAgents);
  const sharedRisk = sharedAgents.reduce((sum, agent) => sum + agent.risk, 0);
  const agentBreak = clamp01(1 - sharedRisk / 2);
  const serviceBonus = serviceCropBonus(crop);
  const diversity = yearFamilies.includes(crop.family) ? 0.45 : 0.95;
  const sameCropPenalty = previousCrops.some((item) => item.id === crop.id) ? 0.72 : 1;
  const value = clamp01((familyInterval * 0.42 + agentBreak * 0.3 + diversity * 0.16 + serviceBonus * 0.12) * sameCropPenalty);
  return {
    value,
    diversity,
    agentBreak,
    sharedAgents,
    familyPenalty: familyInterval < 0.75
  };
}

function scoreFamilyInterval(family: string, historyFamilies: string[]) {
  const lastIndex = [...historyFamilies].reverse().findIndex((item) => item === family);
  if (lastIndex === -1) return 1;
  const yearsSince = lastIndex + 1;
  const ideal = familyInterval(family);
  return clamp01(0.1 + ((yearsSince - 1) / Math.max(1, ideal - 1)) * 0.85);
}

function sharedHostAgents(previous: RotationAgent[], current: RotationAgent[]) {
  const previousByName = new Map(previous.filter((agent) => agent.risk > 0.3).map((agent) => [agent.name, agent]));
  return current
    .filter((agent) => agent.risk > 0.3 && previousByName.has(agent.name))
    .map((agent) => ({ ...agent, risk: Math.max(agent.risk, previousByName.get(agent.name)?.risk ?? 0) }))
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 4);
}

function serviceCropBonus(crop: CropCandidate) {
  const text = `${crop.family} ${crop.scientificName} ${crop.commonName}`.toLowerCase();
  let bonus = 0.25;
  if (text.includes("fabaceae") || text.includes("trifolium") || text.includes("vicia") || text.includes("lupinus")) bonus += 0.35;
  if (crop.riskAgents.some((agent) => agent.diseaseReduction.toLowerCase().includes("effective"))) bonus += 0.25;
  if (text.includes("avena") || text.includes("secale") || text.includes("phacelia")) bonus += 0.15;
  return clamp01(bonus);
}

function buildBenchmarks(crops: CropCandidate[], input: OptimizationInput): Benchmarks {
  const diagnostics = crops.map((crop) => nutrientDiagnostics(crop, input));
  return {
    nutrientsPerM2Day: percentileRange(diagnostics.map((item) => item.nutrientsPerM2Day)),
    nutrientsPerLiter: percentileRange(diagnostics.map((item) => item.nutrientsPerLiter)),
    nutritionScore: percentileRange(diagnostics.map((item) => item.nutritionScore))
  };
}

function percentileRange(values: number[]): [number, number] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [0, 1];
  const low = sorted[Math.floor((sorted.length - 1) * 0.1)] ?? sorted[0];
  const high = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? sorted[sorted.length - 1];
  return high > low ? [low, high] : [0, high || 1];
}

function normalizeRange(value: number, range: [number, number]) {
  return clamp01((value - range[0]) / Math.max(0.000001, range[1] - range[0]));
}

function confidenceScore(confidence: ScoreConfidence) {
  const weights: Record<keyof ScoreConfidence, number> = {
    nutrition: 1,
    yield: 1,
    water: 0.85,
    cycle: 0.75,
    rotation: 0.9,
    soil: 0,
    price: 0
  };
  let score = 0;
  let weight = 0;
  for (const key of Object.keys(weights) as Array<keyof ScoreConfidence>) {
    score += levelValue(confidence[key].level) * weights[key];
    weight += weights[key];
  }
  return score / weight;
}

function levelValue(level: EvidenceLevel) {
  const values: Record<EvidenceLevel, number> = {
    observed: 1,
    proxy: 0.74,
    "family-estimate": 0.48,
    generic: 0.52,
    missing: 0.15
  };
  return values[level];
}

function topNutrients(contributions: Record<string, number>) {
  return Object.entries(contributions)
    .filter(([, value]) => value > 0.08)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => DAILY_TARGETS[key]?.label ?? key);
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
  const harvestMonth = cycleDays > 120 ? "marzo-abril" : cycleDays > 80 ? "febrero-marzo" : "enero-febrero";
  return {
    sowingWindow: `Ano ${year}: septiembre-octubre`,
    harvestWindow: `Ano ${year}: ${harvestMonth}`
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
