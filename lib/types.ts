export type CropCandidate = {
  id: string;
  scientificName: string;
  commonName: string;
  family: string;
  genus: string | null;
  species: string | null;
  nutrition: Record<string, number>;
  matchedFood: string | null;
  yieldKgM2: number;
  cycleDays: number;
  waterMmCycle: number;
  soilFit: number;
  riskAgents: RotationAgent[];
  evidence: CropEvidence;
  confidence: ScoreConfidence;
};

export type ScoreBreakdown = {
  version: "SCORE_V2";
  total: number;
  nutrition: number;
  resources: number;
  resilience: number;
  soil: number;
  diversity: number;
  rotation: number;
  agentBreak: number;
  cost: number;
  confidence: number;
  confidenceDetail: ScoreConfidence;
  explanation: string[];
  evidenceNotes: string[];
  nutrients: Record<string, number>;
  diagnostics: {
    kgHarvest: number;
    waterLiters: number;
    cycleDays: number;
    usefulNutrientPoints: number;
    nutrientsPerM2Day: number;
    nutrientsPerLiter: number;
  };
};

export type EvidenceLevel =
  | "observed"
  | "proxy"
  | "family-estimate"
  | "generic"
  | "missing";

export type EvidenceDescriptor = {
  level: EvidenceLevel;
  label: string;
  source: string;
  matchedItem?: string;
};

export type ScoreConfidence = {
  nutrition: EvidenceDescriptor;
  yield: EvidenceDescriptor;
  water: EvidenceDescriptor;
  cycle: EvidenceDescriptor;
  rotation: EvidenceDescriptor;
  soil: EvidenceDescriptor;
  price: EvidenceDescriptor;
};

export type CropEvidence = {
  yieldKgM2: EvidenceDescriptor & {
    value: number;
    years?: string;
  };
  waterMmCycle: EvidenceDescriptor & {
    value: number;
    range?: [number, number];
  };
  cycleDays: EvidenceDescriptor & {
    value: number;
    range?: [number, number];
  };
  nutrition: EvidenceDescriptor & {
    matchedFood: string | null;
  };
  priceClpKg: (EvidenceDescriptor & { value: number }) | null;
};

export type RotationAgent = {
  name: string;
  type: string;
  hostStatus: string;
  diseaseReduction: string;
  risk: number;
};

export type ScoreObjective = "balanced" | "max-nutrients" | "low-water";

export type NutrientPriority =
  | "protein"
  | "fiber"
  | "vitaminA"
  | "vitaminC"
  | "folate"
  | "calcium"
  | "iron"
  | "zinc"
  | "potassium"
  | "magnesium"
  | "energy";

export type OptimizationInput = {
  objective: ScoreObjective;
  years: number;
  subplots: number;
  areaM2: number;
  previousFamilies: string[];
  priorityNutrients: NutrientPriority[];
  excludedCropIds: string[];
  excludedCropNames: string[];
};

export type ChileRegion = {
  slug: string;
  name: string;
  centroidLon: number;
  centroidLat: number;
  communeCount: number;
};

export type ChileCommuneSoil = {
  slug: string;
  name: string;
  regionSlug: string;
  regionName: string;
  representativeLon: number;
  representativeLat: number;
  soilSource: string;
  queryStatus: string;
  queriedAt: string;
  phH2o0_5cm: number | null;
  clayPct0_5cm: number | null;
  sandPct0_5cm: number | null;
  siltPct0_5cm: number | null;
  socGKg0_5cm: number | null;
  nitrogenGKg0_5cm: number | null;
  bulkDensityKgDm3_0_5cm: number | null;
  cecCmolKg0_5cm: number | null;
  soilLocalityScore: number;
};

export type Assignment = {
  year: number;
  subplot: number;
  crop: CropCandidate;
  score: ScoreBreakdown;
  sowingWindow: string;
  harvestWindow: string;
};
