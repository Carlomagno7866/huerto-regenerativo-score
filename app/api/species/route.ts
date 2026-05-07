import { NextRequest, NextResponse } from "next/server";
import { getFullCatalog } from "@/lib/db";
import { scoreSingleCrop } from "@/lib/score";
import type { CropCandidate, OptimizationInput, ScoreBreakdown } from "@/lib/types";

export const runtime = "nodejs";

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

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  const search = params.get("search") ?? "";
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 16), 1), 80);
  const crops = getFullCatalog();

  if (id) {
    const crop = crops.find((item) => item.id === id);
    if (!crop) {
      return NextResponse.json({ error: "Especie no encontrada" }, { status: 404 });
    }
    const score = scoreSingleCrop(crop, crops, PUBLIC_INPUT);
    return NextResponse.json({ species: toPublicSpecies(crop, score) });
  }

  const term = normalize(search);
  const seen = new Set<string>();
  const matches = crops
    .filter((crop) => {
      const text = normalize(`${crop.commonName} ${crop.scientificName} ${crop.family}`);
      return !term || text.includes(term);
    })
    .sort((a, b) => a.commonName.localeCompare(b.commonName, "es"))
    .filter((crop) => {
      if (seen.has(crop.id)) return false;
      seen.add(crop.id);
      return true;
    })
    .slice(0, limit)
    .map((crop) => ({
      id: crop.id,
      commonName: crop.commonName,
      scientificName: crop.scientificName,
      family: crop.family
    }));

  return NextResponse.json({ species: matches });
}

function toPublicSpecies(crop: CropCandidate, score: ScoreBreakdown) {
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

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
