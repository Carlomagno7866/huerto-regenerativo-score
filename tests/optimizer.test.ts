import test from "node:test";
import assert from "node:assert/strict";
import { getCatalog } from "../lib/db.ts";
import { optimize, scoreSingleCrop } from "../lib/score.ts";
import type { Assignment, CropCandidate, NutrientPriority, OptimizationInput } from "../lib/types.ts";

const NUTRIENTS = [
  "protein",
  "fiber",
  "vitaminA",
  "vitaminC",
  "folate",
  "calcium",
  "iron",
  "zinc",
  "potassium",
  "magnesium"
] as const;

const DAILY_TARGETS: Record<string, number> = {
  protein: 50,
  fiber: 28,
  vitaminA: 900,
  vitaminC: 90,
  folate: 400,
  calcium: 1000,
  iron: 18,
  zinc: 11,
  potassium: 3400,
  magnesium: 420,
  energy: 2200
};

const baseInput: OptimizationInput = {
  objective: "balanced",
  years: 1,
  subplots: 4,
  areaM2: 6,
  previousFamilies: [],
  priorityNutrients: [],
  excludedCropIds: [],
  excludedCropNames: []
};

test("la base curada entrega datos suficientes para calcular SCORE, nutrientes y agua", () => {
  const crops = getCatalog("", 120);
  assert.ok(crops.length >= 30, "el catalogo debe contener una muestra amplia de huerta");
  assert.ok(new Set(crops.map((crop) => crop.family)).size >= 10, "debe haber diversidad botanica para rotar");

  for (const crop of crops) {
    assert.ok(crop.family && crop.family !== "Familia no clasificada", `${crop.commonName} debe tener familia botanica`);
    assert.ok(Number.isFinite(crop.yieldKgM2) && crop.yieldKgM2 > 0, `${crop.commonName} debe tener rendimiento calculable`);
    assert.ok(Number.isFinite(crop.waterMmCycle) && crop.waterMmCycle > 0, `${crop.commonName} debe tener agua/ciclo calculable`);
    for (const nutrient of NUTRIENTS) {
      assert.equal(typeof crop.nutrition[nutrient], "number", `${crop.commonName} debe tener ${nutrient}`);
    }
  }
});

test("el planificador respeta la rotacion por familia en cada subparcela", () => {
  const crops = getCatalog("", 120);
  const input: OptimizationInput = {
    ...baseInput,
    years: 4,
    subplots: 4,
    previousFamilies: ["Solanaceae"]
  };
  const assignments = optimize(crops, input);
  assert.equal(assignments.length, input.years * input.subplots);

  for (const assignment of assignments) {
    if (assignment.crop.family === "Solanaceae") {
      assert.equal(assignment.year, 4, "Solanaceae no debe volver antes de tres cultivos intermedios");
    }
  }

  for (let subplot = 1; subplot <= input.subplots; subplot += 1) {
    const history = ["Solanaceae"];
    for (const assignment of assignments.filter((item) => item.subplot === subplot).sort((a, b) => a.year - b.year)) {
      const lastIndex = [...history].reverse().findIndex((family) => family === assignment.crop.family);
      assert.ok(
        lastIndex === -1 || lastIndex + 1 >= familyInterval(assignment.crop.family),
        `${assignment.crop.commonName} repite ${assignment.crop.family} demasiado pronto en subparcela ${subplot}`
      );
      history.push(assignment.crop.family);
    }
  }
});

test("balance selecciona la combinacion con mejor SCORE total bajo restricciones de rotacion", () => {
  const crops = getCatalog("", 120);
  const input: OptimizationInput = { ...baseInput, objective: "balanced" };
  const assignments = optimize(crops, input);
  const expected = greedyExpected(crops, input, (a, b) => {
    const scoreA = scoreSingleCrop(a, crops, input);
    const scoreB = scoreSingleCrop(b, crops, input);
    return (
      scoreB.total - scoreA.total ||
      scoreB.nutrition - scoreA.nutrition ||
      a.waterMmCycle - b.waterMmCycle ||
      a.commonName.localeCompare(b.commonName, "es")
    );
  });

  assert.deepEqual(
    cropIds(assignments),
    cropIds(expected),
    "balance debe elegir el mayor SCORE disponible en cada cupo factible"
  );
  assert.ok(assignments.every((item) => item.score.nutrition > 0.35), "los cultivos balanceados deben cubrir varios nutrientes");
});

test("nutrientes maximiza la produccion de los nutrientes escogidos", () => {
  const crops = getCatalog("", 120);
  const input: OptimizationInput = {
    ...baseInput,
    objective: "max-nutrients",
    priorityNutrients: ["iron", "vitaminC"]
  };
  const assignments = optimize(crops, input);
  const expected = greedyExpected(crops, input, (a, b) => {
    const scoreA = scoreSingleCrop(a, crops, input);
    const scoreB = scoreSingleCrop(b, crops, input);
    return (
      priorityNutrientValue(b, input) - priorityNutrientValue(a, input) ||
      scoreB.nutrition - scoreA.nutrition ||
      scoreB.total - scoreA.total ||
      a.waterMmCycle - b.waterMmCycle ||
      a.commonName.localeCompare(b.commonName, "es")
    );
  });

  assert.deepEqual(cropIds(assignments), cropIds(expected));
  for (const assignment of assignments) {
    assert.ok(
      assignment.score.diagnostics.priorityNutrientValue > 0,
      `${assignment.crop.commonName} debe producir los nutrientes priorizados`
    );
  }
});

test("bajo riego selecciona la combinacion factible que menos agua utiliza", () => {
  const crops = getCatalog("", 120);
  const input: OptimizationInput = { ...baseInput, objective: "low-water", subplots: 6 };
  const assignments = optimize(crops, input);
  const expected = greedyExpected(crops, input, (a, b) => {
    const scoreA = scoreSingleCrop(a, crops, input);
    const scoreB = scoreSingleCrop(b, crops, input);
    return (
      a.waterMmCycle - b.waterMmCycle ||
      scoreB.total - scoreA.total ||
      a.commonName.localeCompare(b.commonName, "es")
    );
  });

  assert.deepEqual(waterProfile(assignments), waterProfile(expected));
  assert.equal(
    totalWater(assignments),
    totalWater(expected),
    "el objetivo bajo riego debe minimizar los mm/ciclo acumulados"
  );
});

test("el SCORE del cultivo no depende del objetivo de optimizacion", () => {
  const crops = getCatalog("", 120);
  const crop = crops.find((item) => item.commonName === "Tomate") ?? crops[0];
  const balanced = scoreSingleCrop(crop, crops, { ...baseInput, objective: "balanced" });
  const nutrients = scoreSingleCrop(crop, crops, {
    ...baseInput,
    objective: "max-nutrients",
    priorityNutrients: ["iron", "vitaminC", "energy"]
  });
  const lowWater = scoreSingleCrop(crop, crops, { ...baseInput, objective: "low-water" });

  assert.equal(nutrients.total, balanced.total, "el SCORE total no debe cambiar por objetivo");
  assert.equal(lowWater.total, balanced.total, "el SCORE total no debe cambiar por objetivo");
  assert.equal(nutrients.nutrition, balanced.nutrition, "la nutricion base del SCORE no debe ponderar prioridades");
  assert.equal(lowWater.resources, balanced.resources, "recursos base del SCORE no debe ponderar objetivos");
});

function greedyExpected(
  crops: CropCandidate[],
  input: OptimizationInput,
  compare: (a: CropCandidate, b: CropCandidate) => number
) {
  const assignments: Assignment[] = [];
  const usedIds = new Set<string>();
  const previousYearIds = new Set<string>();

  for (let year = 1; year <= input.years; year += 1) {
    const yearFamilies: string[] = [];
    const yearIds: string[] = [];
    for (let subplot = 1; subplot <= input.subplots; subplot += 1) {
      const ranked = crops
        .filter((crop) => !usedIds.has(crop.id))
        .filter((crop) => !previousYearIds.has(crop.id))
        .filter((crop) => !yearIds.includes(crop.id))
        .filter((crop) => !yearFamilies.includes(crop.family))
        .sort(compare);
      const crop = ranked[0];
      assert.ok(crop, "debe existir un cultivo factible para cada cupo");
      assignments.push({
        year,
        subplot,
        crop,
        score: scoreSingleCrop(crop, crops, input),
        sowingWindow: "",
        harvestWindow: ""
      });
      usedIds.add(crop.id);
      yearIds.push(crop.id);
      yearFamilies.push(crop.family);
    }
  }

  return assignments;
}

function priorityNutrientValue(crop: CropCandidate, input: OptimizationInput) {
  const gramsHarvest = crop.yieldKgM2 * input.areaM2 * 1000;
  const nutrients = input.priorityNutrients.length ? input.priorityNutrients : (NUTRIENTS as readonly NutrientPriority[]);
  return nutrients.reduce((sum, nutrient) => {
    const amountPer100g = crop.nutrition[nutrient] ?? 0;
    return sum + ((amountPer100g * gramsHarvest) / 100) / DAILY_TARGETS[nutrient];
  }, 0);
}

function cropIds(assignments: Assignment[]) {
  return assignments.map((assignment) => assignment.crop.id);
}

function totalWater(assignments: Assignment[]) {
  return assignments.reduce((sum, assignment) => sum + assignment.crop.waterMmCycle, 0);
}

function waterProfile(assignments: Assignment[]) {
  return assignments.map((assignment) => assignment.crop.waterMmCycle).sort((a, b) => a - b);
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
