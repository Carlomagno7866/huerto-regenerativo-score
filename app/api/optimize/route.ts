import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCatalog, getCommuneSoil, getNearestSoil } from "@/lib/db";
import { optimize } from "@/lib/score";
import type { ChileCommuneSoil, CropCandidate } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  regionSlug: z.string().optional(),
  communeSlug: z.string().optional(),
  gardenType: z.enum(["optimized-bed", "natural-soil"]).default("natural-soil"),
  objective: z
    .enum(["balanced", "max-nutrients", "low-water", "healthy-rotation", "family-savings"])
    .default("balanced"),
  mode: z.enum(["home-garden", "small-farmer"]).default("home-garden"),
  years: z.number().int().min(1).max(8).default(4),
  subplots: z.number().int().min(1).max(12).default(4),
  areaM2: z.number().min(0.5).max(500).default(6),
  previousFamilies: z.array(z.string()).default([]),
  priorityNutrients: z
    .array(
      z.enum([
        "protein",
        "fiber",
        "vitaminA",
        "vitaminC",
        "folate",
        "calcium",
        "iron",
        "zinc",
        "potassium",
        "magnesium",
        "energy"
      ])
    )
    .default([]),
  excludedCropIds: z.array(z.string()).default([]),
  excludedCropNames: z.array(z.string()).default([])
});

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;
  const soil = input.communeSlug
    ? getCommuneSoil(input.communeSlug)
    : Number.isFinite(input.latitude) && Number.isFinite(input.longitude)
      ? getNearestSoil(input.latitude!, input.longitude!)
      : null;
  const crops = getCatalog("", 120).map((crop) => applySoilFit(crop, soil, input.gardenType));
  const assignments = optimize(crops, input);

  return NextResponse.json({
    soil,
    assignments,
    summary: summarize(assignments)
  });
}

function applySoilFit(crop: CropCandidate, soil: unknown, gardenType: "optimized-bed" | "natural-soil"): CropCandidate {
  if (gardenType === "optimized-bed") {
    return {
      ...crop,
      soilFit: 0.92,
      confidence: {
        ...crop.confidence,
        soil: {
          level: "generic",
          label: "Bancal optimizado: suelo ajustable, no lectura local directa",
          source: "Supuesto de manejo del usuario"
        }
      }
    };
  }
  if (!soil || typeof soil !== "object") return crop;
  const normalized = normalizeSoil(soil);
  const ph = Number(normalized.ph);
  const clay = Number(normalized.clay);
  const soc = Number(normalized.soc);
  const locality = Number(normalized.localityScore);
  const phFit = Number.isFinite(ph) ? 1 - Math.min(Math.abs(ph - 6.4) / 2.8, 0.45) : 0.72;
  const clayFit = Number.isFinite(clay) ? 1 - Math.min(Math.abs(clay - 28) / 80, 0.25) : 0.72;
  const organicFit = Number.isFinite(soc) ? Math.max(0.45, Math.min(1, soc / 35)) : 0.72;
  const baseFit = Math.max(0.35, Math.min(0.98, phFit * 0.55 + clayFit * 0.25 + organicFit * 0.2));
  return {
    ...crop,
    soilFit: Number.isFinite(locality) ? Math.max(0.35, Math.min(0.98, baseFit * 0.68 + locality * 0.32)) : baseFit,
    confidence: {
      ...crop.confidence,
      soil: {
        level: "generic",
        label: normalized.commune
          ? `Suelo comunal ${normalized.commune}: pH, textura y carbono organico superficial`
          : "SoilGrids cercano: pH, textura y carbono organico superficial",
        source: "SoilGrids Chile local"
      }
    }
  };
}

function normalizeSoil(soil: unknown) {
  const row = soil as Partial<ChileCommuneSoil> & Record<string, unknown>;
  return {
    commune: typeof row.name === "string" ? row.name : null,
    ph: row.phH2o0_5cm ?? row.ph_h2o_0_5cm,
    clay: row.clayPct0_5cm ?? row.clay_pct_0_5cm,
    soc: row.socGKg0_5cm ?? row.soc_g_kg_0_5cm,
    localityScore: row.soilLocalityScore ?? row.soil_locality_score
  };
}

function summarize(assignments: ReturnType<typeof optimize>) {
  const average =
    assignments.reduce((sum, item) => sum + item.score.total, 0) / Math.max(assignments.length, 1);
  const families = new Set(assignments.map((item) => item.crop.family));
  const water = assignments.reduce((sum, item) => sum + item.crop.waterMmCycle, 0);
  return {
    averageScore: average,
    familyDiversity: families.size,
    estimatedWaterMm: water,
    topConfidenceGaps: confidenceGaps(assignments),
    recommendations: assignments.slice(0, 4).map((item) => ({
      crop: item.crop.commonName,
      score: item.score.total,
      confidence: item.score.confidence,
      reason: item.score.explanation[0],
      evidence: item.score.evidenceNotes[0]
    }))
  };
}

function confidenceGaps(assignments: ReturnType<typeof optimize>) {
  const counts = new Map<string, number>();
  for (const item of assignments) {
    for (const [domain, descriptor] of Object.entries(item.score.confidenceDetail)) {
      if (descriptor.level === "missing" || descriptor.level === "family-estimate" || descriptor.level === "generic") {
        const key = `${domain}: ${descriptor.label}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label);
}
