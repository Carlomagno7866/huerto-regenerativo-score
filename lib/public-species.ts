import type { CropEvidence, RotationAgent, ScoreBreakdown, ScoreConfidence } from "./types";

export type PublicSpecies = {
  id: string;
  commonName: string;
  scientificName: string;
  family: string;
  score: ScoreBreakdown;
  publicScore: number;
  exchangeValue: number;
  yieldKgM2: number;
  cycleDays: number;
  waterMmCycle: number;
  matchedFood: string | null;
  nutrition: Array<{
    key: string;
    label: string;
    value: number;
  }>;
  evidence: CropEvidence;
  confidence: ScoreConfidence;
  riskAgents: RotationAgent[];
  summary: string[];
  evidenceNotes: string[];
};
