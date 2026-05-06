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
  confidence: number;
};

export type ScoreBreakdown = {
  total: number;
  nutrition: number;
  resources: number;
  resilience: number;
  soil: number;
  diversity: number;
  confidence: number;
  explanation: string[];
  nutrients: Record<string, number>;
};

export type OptimizationInput = {
  latitude?: number;
  longitude?: number;
  gardenType: "optimized-bed" | "natural-soil";
  years: number;
  subplots: number;
  areaM2: number;
  previousFamilies: string[];
};

export type Assignment = {
  year: number;
  subplot: number;
  crop: CropCandidate;
  score: ScoreBreakdown;
  sowingWindow: string;
  harvestWindow: string;
};
