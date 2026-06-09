import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCatalog } from "@/lib/db";
import { summarizeProduction } from "@/lib/production";
import { optimize } from "@/lib/score";

export const runtime = "nodejs";

const schema = z.object({
  objective: z.enum(["balanced", "max-nutrients", "low-water"]).default("balanced"),
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
  const crops = getCatalog("", 120);
  const assignments = optimize(crops, input);

  return NextResponse.json({
    assignments,
    summary: summarize(assignments, input.areaM2)
  });
}

function summarize(assignments: ReturnType<typeof optimize>, areaM2: number) {
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
    })),
    production: summarizeProduction(assignments, areaM2)
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
