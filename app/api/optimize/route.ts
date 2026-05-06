import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCatalog, getNearestSoil } from "@/lib/db";
import { optimize } from "@/lib/score";
import type { CropCandidate } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
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
  const soil =
    Number.isFinite(input.latitude) && Number.isFinite(input.longitude)
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
  const ph = Number((soil as Record<string, unknown>).ph_h2o_0_5cm);
  const clay = Number((soil as Record<string, unknown>).clay_pct_0_5cm);
  const soc = Number((soil as Record<string, unknown>).soc_g_kg_0_5cm);
  const phFit = Number.isFinite(ph) ? 1 - Math.min(Math.abs(ph - 6.4) / 2.8, 0.45) : 0.72;
  const clayFit = Number.isFinite(clay) ? 1 - Math.min(Math.abs(clay - 28) / 80, 0.25) : 0.72;
  const organicFit = Number.isFinite(soc) ? Math.max(0.45, Math.min(1, soc / 35)) : 0.72;
  return {
    ...crop,
    soilFit: Math.max(0.35, Math.min(0.98, phFit * 0.55 + clayFit * 0.25 + organicFit * 0.2)),
    confidence: {
      ...crop.confidence,
      soil: {
        level: "generic",
        label: "SoilGrids cercano: pH, textura y carbono organico superficial",
        source: "SoilGrids Chile local"
      }
    }
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
