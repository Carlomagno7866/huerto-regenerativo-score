import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ChileCommuneSoil,
  ChileRegion,
  CropCandidate,
  CropEvidence,
  EvidenceDescriptor,
  RotationAgent,
  ScoreConfidence
} from "./types";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolveDbPath();

let db: Database.Database | null = null;
let fullCatalogCache: CropCandidate[] | null = null;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
  }
  return db;
}

function resolveDbPath() {
  if (process.env.HUERTO_DB_PATH) return process.env.HUERTO_DB_PATH;
  const candidates = [
    path.join(process.cwd(), "data", "huerto_regenerativo.sqlite"),
    path.join(process.cwd(), "..", "data", "huerto_regenerativo.sqlite"),
    path.join(process.cwd(), "..", "..", "data", "huerto_regenerativo.sqlite"),
    path.join(process.env.LAMBDA_TASK_ROOT ?? "", "data", "huerto_regenerativo.sqlite"),
    path.join(MODULE_DIR, "..", "..", "..", "..", "..", "data", "huerto_regenerativo.sqlite")
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? candidates[0];
}

type CatalogRow = {
  scientificName: string;
  commonName: string | null;
  family: string | null;
  genus: string | null;
  species: string | null;
};

type NutrientRow = {
  fdc_id: string;
  description: string;
  data_type: string | null;
  nutrient_id: string;
  nutrient_name: string;
  unit_name: string;
  amount: number;
};

type FaostatYieldRow = {
  item: string;
  value: number;
  n: number;
};

type AgentRow = {
  agent_type: string;
  agent_name: string;
  host_status: string | null;
  disease_reduction: string | null;
};

export function getCatalog(search = "", limit = 80): CropCandidate[] {
  const rows = getDb()
    .prepare(
      `
      SELECT
        TRIM(REPLACE(REPLACE(crop_latin_name, 'V-', ''), 'F-', '')) AS scientificName,
        COALESCE(MIN(crop_common_name), crop_latin_name) AS commonName,
        COALESCE(family, 'Familia no clasificada') AS family,
        MIN(genus) AS genus,
        MIN(species) AS species
      FROM crop_catalog_seed
      WHERE crop_latin_name IS NOT NULL
        AND lower(crop_latin_name) NOT LIKE '%cannabis%'
      GROUP BY TRIM(REPLACE(REPLACE(crop_latin_name, 'V-', ''), 'F-', '')), COALESCE(family, 'Familia no clasificada')
      ORDER BY commonName
    `
    )
    .all() as CatalogRow[];

  return mergeCuratedCatalogRows(rows)
    .filter((row) => isCuratedGardenCrop(row.scientificName))
    .filter((row) => matchesCatalogSearch(row, search))
    .sort((a, b) => (a.commonName ?? a.scientificName).localeCompare(b.commonName ?? b.scientificName, "es"))
    .slice(0, limit)
    .map(hydrateCrop);
}

export function getFullCatalog() {
  if (!fullCatalogCache) {
    fullCatalogCache = getCatalog("", 120);
  }
  return fullCatalogCache;
}

function mergeCuratedCatalogRows(rows: CatalogRow[]) {
  const byId = new Map<string, CatalogRow>();
  for (const row of [...rows, ...CURATED_EXTRA_CROPS]) {
    const key = slug(row.scientificName);
    if (!byId.has(key) || CURATED_EXTRA_CROPS.some((crop) => slug(crop.scientificName) === key)) {
      byId.set(key, row);
    }
  }
  return Array.from(byId.values());
}

function isCuratedGardenCrop(scientificName: string) {
  return CURATED_GARDEN_CROPS.has(normalizeCatalogKey(scientificName));
}

function matchesCatalogSearch(row: CatalogRow, search: string) {
  const term = normalizeCatalogText(search);
  if (!term) return true;
  return normalizeCatalogText(`${row.commonName ?? ""} ${row.scientificName} ${row.family ?? ""}`).includes(term);
}

function normalizeCatalogKey(value: string) {
  return normalizeCatalogText(value).replace(/^v |^f /, "");
}

function normalizeCatalogText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[vf]-/, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CURATED_GARDEN_CROPS = new Set([
  "allium ampeloprasum",
  "allium sativum",
  "allium spp",
  "anethum graveolens",
  "apium graveolens",
  "asparagus offininalis",
  "beta vulgaris",
  "brassica oleracea",
  "brassica rapa",
  "capsicum annum",
  "cichorium intybus",
  "cicer arietinum",
  "citrullus lanatus",
  "coriandrum sativum",
  "cucumis melo",
  "cucumis sativus",
  "cucurbita spp",
  "daucus carota",
  "eruca vesicaria subsp sativa",
  "fragaria x ananassa",
  "lactuca sativa",
  "lens culinaris",
  "lycopersicon esculentum",
  "ocimum basilicum",
  "petroselinum crispum",
  "phaseolus spp",
  "phaseolus vulgaris",
  "pisum spp",
  "raphanus sativus",
  "solanum melongena",
  "solanum tuberosum",
  "spinacia oleracea",
  "vicia faba",
  "zea mais"
]);

const CURATED_EXTRA_CROPS: CatalogRow[] = [
  {
    scientificName: "Phaseolus vulgaris",
    commonName: "Poroto seco o granado",
    family: "Fabaceae",
    genus: "Phaseolus",
    species: "Phaseolus vulgaris"
  },
  {
    scientificName: "Lens culinaris",
    commonName: "Lenteja",
    family: "Fabaceae",
    genus: "Lens",
    species: "Lens culinaris"
  },
  {
    scientificName: "Cicer arietinum",
    commonName: "Garbanzo",
    family: "Fabaceae",
    genus: "Cicer",
    species: "Cicer arietinum"
  }
];

export function getNearestSoil(latitude: number, longitude: number) {
  return getDb()
    .prepare(
      `
      SELECT point_id, lon, lat, ph_h2o_0_5cm, clay_pct_0_5cm, sand_pct_0_5cm,
             silt_pct_0_5cm, soc_g_kg_0_5cm, nitrogen_g_kg_0_5cm,
             bulk_density_kg_dm3_0_5cm, cec_cmol_kg_0_5cm
      FROM chile_soilgrids_static_topsoil
      WHERE ph_h2o_0_5cm IS NOT NULL
      ORDER BY ((lat - ?) * (lat - ?) + (lon - ?) * (lon - ?))
      LIMIT 1
    `
    )
    .get(latitude, latitude, longitude, longitude);
}

type RegionRow = {
  region_slug: string;
  region_name: string;
  centroid_lon: number;
  centroid_lat: number;
  commune_count: number;
};

type CommuneRow = {
  commune_slug: string;
  commune_name: string;
  region_slug: string;
  region_name: string;
  representative_lon: number;
  representative_lat: number;
  soil_source: string;
  query_status: string;
  queried_at: string;
  ph_h2o_0_5cm: number | null;
  clay_pct_0_5cm: number | null;
  sand_pct_0_5cm: number | null;
  silt_pct_0_5cm: number | null;
  soc_g_kg_0_5cm: number | null;
  nitrogen_g_kg_0_5cm: number | null;
  bulk_density_kg_dm3_0_5cm: number | null;
  cec_cmol_kg_0_5cm: number | null;
  soil_locality_score: number;
};

export function getChileRegions(): ChileRegion[] {
  const rows = getDb()
    .prepare(
      `
      SELECT
        r.region_slug,
        r.region_name,
        r.centroid_lon,
        r.centroid_lat,
        COUNT(c.commune_slug) AS commune_count
      FROM chile_admin_regions r
      LEFT JOIN chile_commune_soil_static c ON c.region_slug = r.region_slug
      GROUP BY r.region_slug, r.region_name, r.centroid_lon, r.centroid_lat
      ORDER BY r.centroid_lat DESC, r.region_name
      `
    )
    .all() as RegionRow[];
  return rows.map((row) => ({
    slug: row.region_slug,
    name: row.region_name,
    centroidLon: row.centroid_lon,
    centroidLat: row.centroid_lat,
    communeCount: row.commune_count
  }));
}

export function getChileCommunes(regionSlug?: string): ChileCommuneSoil[] {
  const where = regionSlug ? "WHERE region_slug = ?" : "";
  const rows = getDb()
    .prepare(
      `
      SELECT *
      FROM chile_commune_soil_static
      ${where}
      ORDER BY region_name, commune_name
      `
    )
    .all(...(regionSlug ? [regionSlug] : [])) as CommuneRow[];
  return rows.map(mapCommuneRow);
}

export function getCommuneSoil(communeSlug: string): ChileCommuneSoil | null {
  const row = getDb()
    .prepare(
      `
      SELECT *
      FROM chile_commune_soil_static
      WHERE commune_slug = ?
      LIMIT 1
      `
    )
    .get(communeSlug) as CommuneRow | undefined;
  return row ? mapCommuneRow(row) : null;
}

function mapCommuneRow(row: CommuneRow): ChileCommuneSoil {
  return {
    slug: row.commune_slug,
    name: row.commune_name,
    regionSlug: row.region_slug,
    regionName: row.region_name,
    representativeLon: row.representative_lon,
    representativeLat: row.representative_lat,
    soilSource: row.soil_source,
    queryStatus: row.query_status,
    queriedAt: row.queried_at,
    phH2o0_5cm: row.ph_h2o_0_5cm,
    clayPct0_5cm: row.clay_pct_0_5cm,
    sandPct0_5cm: row.sand_pct_0_5cm,
    siltPct0_5cm: row.silt_pct_0_5cm,
    socGKg0_5cm: row.soc_g_kg_0_5cm,
    nitrogenGKg0_5cm: row.nitrogen_g_kg_0_5cm,
    bulkDensityKgDm3_0_5cm: row.bulk_density_kg_dm3_0_5cm,
    cecCmolKg0_5cm: row.cec_cmol_kg_0_5cm,
    soilLocalityScore: row.soil_locality_score
  };
}

function hydrateCrop(row: CatalogRow): CropCandidate {
  const nutritionMatch = findNutrition(row.commonName ?? row.scientificName, row.scientificName);
  const yieldProfile = findYieldProfile(row.scientificName, row.commonName ?? "");
  const waterCycleProfile = findWaterCycleProfile(row.scientificName, row.commonName ?? "", row.family);
  const riskAgents = findRiskAgents(row.scientificName);
  const family = inferFamily(row.family, row.scientificName);
  const confidence = buildConfidence(nutritionMatch.evidence, yieldProfile.evidence, waterCycleProfile.waterEvidence, waterCycleProfile.cycleEvidence, riskAgents);
  const evidence: CropEvidence = {
    yieldKgM2: {
      value: yieldProfile.yieldKgM2,
      years: yieldProfile.years,
      ...yieldProfile.evidence
    },
    waterMmCycle: {
      value: waterCycleProfile.waterMmCycle,
      range: waterCycleProfile.waterRange,
      ...waterCycleProfile.waterEvidence
    },
    cycleDays: {
      value: waterCycleProfile.cycleDays,
      range: waterCycleProfile.cycleRange,
      ...waterCycleProfile.cycleEvidence
    },
    nutrition: {
      matchedFood: nutritionMatch.description,
      ...nutritionMatch.evidence
    },
    priceClpKg: null
  };

  return {
    id: slug(row.scientificName),
    scientificName: row.scientificName,
    commonName: localChileanName(row.commonName, row.scientificName),
    family,
    genus: row.genus,
    species: row.species,
    nutrition: nutritionMatch.nutrients,
    matchedFood: nutritionMatch.description,
    yieldKgM2: yieldProfile.yieldKgM2,
    cycleDays: waterCycleProfile.cycleDays,
    waterMmCycle: waterCycleProfile.waterMmCycle,
    soilFit: 0.92,
    riskAgents,
    evidence,
    confidence
  };
}

function findNutrition(commonName: string, scientificName: string) {
  const curated = curatedNutritionFor(scientificName, commonName);
  if (curated) {
    if (curated.foodCrop === false) {
      const evidence: EvidenceDescriptor = {
        level: "missing",
        label: curated.label,
        source: curated.source
      };
      return { description: null, nutrients: {}, evidence };
    }

    const rows = getDb()
      .prepare(
        `
        SELECT fdc_id, description, data_type, nutrient_id, nutrient_name, unit_name, CAST(amount AS REAL) AS amount
        FROM fdc_core_food_nutrients
        WHERE fdc_id = ?
          AND nutrient_name IN (
            'Protein', 'Fiber, total dietary', 'Vitamin C, total ascorbic acid',
            'Vitamin A, RAE', 'Folate, total', 'Calcium, Ca', 'Iron, Fe',
            'Zinc, Zn', 'Potassium, K', 'Magnesium, Mg', 'Energy'
          )
        ORDER BY nutrient_name
      `
      )
      .all(curated.fdcId) as NutrientRow[];

    if (rows.length >= 4) {
      const nutrients = nutrientsFromRows(rows);
      const matchedFood = rows[0].description;
      const evidence: EvidenceDescriptor = {
        level: curated.level,
        label: curated.label,
        source: curated.source,
        matchedItem: `${matchedFood} (FDC ${curated.fdcId})`
      };
      return { description: matchedFood, nutrients, evidence };
    }
  }

  const aliases = buildAliases(commonName, scientificName);
  const rows: NutrientRow[] = [];
  let matchedFood: string | null = null;
  const statement = getDb().prepare(
    `
    SELECT fdc_id, description, data_type, nutrient_id, nutrient_name, unit_name, CAST(amount AS REAL) AS amount
    FROM fdc_core_food_nutrients
    WHERE lower(description) LIKE ?
      AND nutrient_name IN (
        'Protein', 'Fiber, total dietary', 'Vitamin C, total ascorbic acid',
        'Vitamin A, RAE', 'Folate, total', 'Calcium, Ca', 'Iron, Fe',
        'Zinc, Zn', 'Potassium, K', 'Magnesium, Mg', 'Energy'
      )
    ORDER BY
      CASE
        WHEN lower(description) LIKE '%raw%' THEN 0
        WHEN lower(description) LIKE '%fresh%' THEN 1
        WHEN lower(description) LIKE '%cooked%' THEN 2
        ELSE 3
      END,
      LENGTH(description)
    LIMIT 80
  `
  );

  for (const alias of aliases) {
    const found = statement.all(`%${alias}%`) as NutrientRow[];
    if (found.length >= 4) {
      rows.push(...found);
      matchedFood = found[0].description;
      break;
    }
  }

  const nutrients = nutrientsFromRows(rows);

  const evidence: EvidenceDescriptor = matchedFood
    ? {
        level: "observed",
        label: "USDA FDC crudo/fresco o mejor match disponible",
        source: "USDA FoodData Central local",
        matchedItem: matchedFood
      }
    : {
        level: "missing",
        label: "Sin match nutricional local",
        source: "USDA FoodData Central local"
      };

  return { description: matchedFood, nutrients, evidence };
}

function nutrientsFromRows(rows: NutrientRow[]) {
  const nutrients: Record<string, number> = {};
  for (const row of rows) {
    const key = nutrientKey(row.nutrient_name);
    if (key === "energy" && row.unit_name !== "KCAL") continue;
    if (key && nutrients[key] === undefined && Number.isFinite(row.amount)) {
      nutrients[key] = row.amount;
    }
  }
  return nutrients;
}

function findYieldProfile(scientificName: string, commonName: string) {
  const item = faostatItemFor(scientificName, commonName);
  if (item) {
    const row = getDb()
      .prepare(
        `
        SELECT item, AVG(CAST(value AS REAL)) / 10000 AS value, COUNT(*) AS n
        FROM faostat_chile_crop_livestock_production
        WHERE element = 'Yield'
          AND unit = 'kg/ha'
          AND item = ?
          AND CAST(year AS INTEGER) BETWEEN 2020 AND 2024
          AND value IS NOT NULL
        GROUP BY item
      `
      )
      .get(item) as FaostatYieldRow | undefined;

    if (row && Number.isFinite(row.value)) {
      return {
        yieldKgM2: row.value,
        years: "2020-2024",
        evidence: {
          level: "observed" as const,
          label: "Rendimiento observado Chile 2020-2024",
          source: "FAOSTAT Chile local",
          matchedItem: row.item
        }
      };
    }
  }

  const proxy = faostatProxyItemFor(scientificName, commonName);
  if (proxy) {
    const row = getDb()
      .prepare(
        `
        SELECT item, AVG(CAST(value AS REAL)) / 10000 AS value, COUNT(*) AS n
        FROM faostat_chile_crop_livestock_production
        WHERE element = 'Yield'
          AND unit = 'kg/ha'
          AND item = ?
          AND CAST(year AS INTEGER) BETWEEN 2020 AND 2024
          AND value IS NOT NULL
        GROUP BY item
      `
      )
      .get(proxy.item) as FaostatYieldRow | undefined;
    if (row && Number.isFinite(row.value)) {
      return {
        yieldKgM2: row.value * proxy.factor,
        years: "2020-2024",
        evidence: {
          level: "proxy" as const,
          label: proxy.label,
          source: "FAOSTAT Chile local",
          matchedItem: row.item
        }
      };
    }
  }

  const fallback = estimatePhysiology(null, scientificName);
  return {
    yieldKgM2: fallback.yieldKgM2,
    evidence: {
      level: "family-estimate" as const,
      label: "Estimacion por familia botanica",
      source: "Reglas locales v1"
    }
  };
}

function findWaterCycleProfile(scientificName: string, commonName: string, family: string | null) {
  const profile = WATER_CYCLE_PROFILES.find((item) => item.match(scientificName, commonName));
  if (profile) {
    return {
      waterMmCycle: midpoint(profile.waterRange),
      cycleDays: midpoint(profile.cycleRange),
      waterRange: profile.waterRange,
      cycleRange: profile.cycleRange,
      waterEvidence: {
        level: profile.level,
        label: profile.waterLabel,
        source: profile.source,
        matchedItem: profile.name
      },
      cycleEvidence: {
        level: profile.level,
        label: profile.cycleLabel,
        source: profile.source,
        matchedItem: profile.name
      }
    };
  }

  const fallback = estimatePhysiology(family, commonName || scientificName);
  return {
    waterMmCycle: fallback.waterMmCycle,
    cycleDays: fallback.cycleDays,
    waterEvidence: {
      level: "family-estimate" as const,
      label: "Agua estimada por familia botanica",
      source: "Reglas locales v1"
    },
    cycleEvidence: {
      level: "family-estimate" as const,
      label: "Ciclo estimado por familia botanica",
      source: "Reglas locales v1"
    }
  };
}

function findRiskAgents(scientificName: string): RotationAgent[] {
  let rows = getDb()
    .prepare(
      `
      SELECT agent_type, agent_name, host_status, disease_reduction
      FROM best4soil_crop_agent_risk
      WHERE TRIM(REPLACE(REPLACE(crop_latin_name, 'V-', ''), 'F-', '')) = ?
        AND agent_name IS NOT NULL
      ORDER BY agent_name
    `
    )
    .all(scientificName) as AgentRow[];

  if (!rows.length) {
    const genus = scientificName.split(/\s+/)[0];
    rows = getDb()
      .prepare(
        `
        SELECT agent_type, agent_name, host_status, disease_reduction
        FROM best4soil_crop_agent_risk
        WHERE lower(TRIM(REPLACE(REPLACE(crop_latin_name, 'V-', ''), 'F-', ''))) LIKE lower(?)
          AND agent_name IS NOT NULL
        ORDER BY agent_name
      `
      )
      .all(`${genus}%`) as AgentRow[];
  }

  const map = new Map<string, RotationAgent>();
  for (const row of rows) {
    const key = `${row.agent_type}:${row.agent_name}`;
    const current = map.get(key);
    const candidate: RotationAgent = {
      name: row.agent_name,
      type: row.agent_type,
      hostStatus: row.host_status ?? "n.i",
      diseaseReduction: row.disease_reduction ?? "n.i",
      risk: hostRisk(row.host_status)
    };
    if (!current || candidate.risk > current.risk) {
      map.set(key, candidate);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.risk - a.risk || a.name.localeCompare(b.name)).slice(0, 18);
}

function buildConfidence(
  nutrition: EvidenceDescriptor,
  yieldEvidence: EvidenceDescriptor,
  water: EvidenceDescriptor,
  cycle: EvidenceDescriptor,
  riskAgents: RotationAgent[]
): ScoreConfidence {
  return {
    nutrition,
    yield: yieldEvidence,
    water,
    cycle,
    rotation: riskAgents.length
      ? {
          level: "observed",
          label: "Agentes sanitarios Best4Soil disponibles",
          source: "Best4Soil local"
        }
      : {
          level: "generic",
          label: "Rotacion solo por familia botanica",
          source: "Best4Soil local + regla agronomica"
        },
    soil: {
      level: "generic",
      label: "Bancal optimizado: suelo ajustable, no lectura local directa",
      source: "Supuesto de manejo del usuario"
    },
    price: {
      level: "missing",
      label: "Precio/costo preparado para ODEPA; no activo",
      source: "Sin serie ODEPA conectada"
    }
  };
}

function faostatItemFor(scientificName: string, commonName: string) {
  const text = `${scientificName} ${commonName}`.toLowerCase();
  const exact: Array<[string, string]> = [
    ["lycopersicon", "Tomatoes"],
    ["solanum lycopersicum", "Tomatoes"],
    ["solanum tuberosum", "Potatoes"],
    ["allium cepa", "Onions and shallots, dry (excluding dehydrated)"],
    ["allium spp", "Onions and shallots, dry (excluding dehydrated)"],
    ["daucus carota", "Carrots and turnips"],
    ["raphanus", "Carrots and turnips"],
    ["capsicum", "Chillies and peppers, green (Capsicum spp. and Pimenta spp.)"],
    ["brassica oleracea", "Cabbages"],
    ["cucurbita", "Pumpkins, squash and gourds"],
    ["cucumis sativus", "Cucumbers and gherkins"],
    ["cucumis melo", "Cantaloupes and other melons"],
    ["citrullus", "Watermelons"],
    ["lactuca", "Lettuce and chicory"],
    ["cichorium", "Lettuce and chicory"],
    ["vicia faba", "Broad beans and horse beans, green"],
    ["pisum", "Peas, green"],
    ["phaseolus vulgaris", "Beans, dry"],
    ["phaseolus", "Other beans, green"],
    ["lens culinaris", "Lentils, dry"],
    ["cicer arietinum", "Chick peas, dry"],
    ["spinacia", "Spinach"],
    ["fragaria", "Strawberries"],
    ["zea", "Green corn (maize)"],
    ["asparagus", "Asparagus"],
    ["avena", "Oats"],
    ["hordeum", "Barley"],
    ["triticum", "Wheat"],
    ["secale", "Rye"],
    ["oryza", "Rice"],
    ["brassica napus", "Rape or colza seed"],
    ["helianthus", "Sunflower seed"],
    ["lupinus", "Lupins"],
    ["linum", "Linseed"],
    ["beta vulgaris", "Sugar beet"]
  ];
  return exact.find(([key]) => text.includes(key))?.[1] ?? null;
}

function faostatProxyItemFor(scientificName: string, commonName: string) {
  const text = `${scientificName} ${commonName}`.toLowerCase();
  if (text.includes("brassica")) {
    return {
      item: "Cauliflowers and broccoli",
      factor: 1,
      label: "Proxy FAOSTAT para Brassica horticola"
    };
  }
  if (text.includes("allium")) {
    return {
      item: "Green garlic",
      factor: 1,
      label: "Proxy FAOSTAT para Allium fresco"
    };
  }
  if (text.includes("apiaceae") || text.includes("apium") || text.includes("petroselinum") || text.includes("coriandrum")) {
    return {
      item: "Other vegetables, fresh n.e.c.",
      factor: 0.75,
      label: "Proxy FAOSTAT para hortaliza fresca sin item directo"
    };
  }
  return null;
}

function buildAliases(commonName: string, scientificName: string) {
  const stopAliases = new Set([
    "incl",
    "leafy",
    "black",
    "white",
    "green",
    "sweet",
    "italian",
    "japanese",
    "perennial",
    "red",
    "sp",
    "spp",
    "subsp",
    "sativa",
    "sativum"
  ]);
  const raw = [commonName, scientificName.split(" ")[0], scientificName.split(" ")[1] ?? ""]
    .map((value) => value.toLowerCase().replace(/[^a-z ]/g, " ").trim())
    .filter((value) => value.length > 3 && !stopAliases.has(value));
  const parts = raw
    .flatMap((value) => value.split(/\s+|\/|,/))
    .filter((value) => value.length > 3 && !stopAliases.has(value));
  return Array.from(new Set([...raw, ...parts])).slice(0, 8);
}

type CuratedNutritionProfile =
  | {
      fdcId: string;
      level: "observed" | "proxy";
      label: string;
      source: string;
      foodCrop?: true;
      match: string[];
    }
  | {
      foodCrop: false;
      label: string;
      source: string;
      match: string[];
    };

const CURATED_NUTRITION_PROFILES: CuratedNutritionProfile[] = [
  exactFood("allium ampeloprasum", "169246", "Leek crudo; match taxonomico curado"),
  exactFood("allium sativum", "169230", "Ajo crudo; match taxonomico curado"),
  exactFood("allium spp", "170000", "Cebolla cruda; proxy de especie Allium hortícola"),
  exactFood("anethum graveolens", "172233", "Eneldo fresco; corrige nombre comun ambiguo del catalogo"),
  exactFood("apium graveolens", "169988", "Apio crudo; match taxonomico curado"),
  exactFood("asparagus offininalis", "168389", "Esparrago crudo; match por genero con correccion ortografica"),
  exactFood("avena sativa", "173904", "Avena seca no fortificada; proxy de grano entero disponible en FDC"),
  exactFood("avena strigosa", "173904", "Avena negra; proxy por Avena sativa disponible en FDC"),
  exactFood("beta vulgaris", "169145", "Betarraga cruda; match de especie hortícola"),
  exactFood("brassica napus", "170929", "Semilla de mostaza molida; proxy para semilla oleaginosa Brassica"),
  exactFood("brassica oleracea", "169975", "Repollo crudo; representante para Brassica oleracea mixta"),
  exactFood("brassica rapa", "170465", "Nabo crudo; match taxonomico curado"),
  exactFood("brassica spp", "170061", "Hojas de nabo crudas; proxy para Brassica de hoja/abono verde"),
  exactFood("capsicum annum", "170108", "Pimenton rojo crudo; corrige alias generico 'sweet'"),
  exactFood("cichorium intybus", "169992", "Hojas de achicoria crudas; match taxonomico curado"),
  exactFood("citrullus lanatus", "167765", "Sandia cruda; corrige ortografia Watermelone"),
  exactFood("coriandrum sativum", "169997", "Cilantro fresco crudo; match nacional usado como coriander/cilantro"),
  exactFood("cucumis melo", "169092", "Melon cantalupo crudo; proxy para Cucumis melo"),
  exactFood("cucumis sativus", "169225", "Pepino crudo; match taxonomico curado"),
  exactFood("cucurbita spp", "168448", "Zapallo/calabaza crudo; proxy de genero Cucurbita"),
  exactFood("daucus carota", "170393", "Zanahoria cruda; match taxonomico curado"),
  exactFood("eruca vesicaria", "169387", "Rucula/arugula cruda; agrega especie sin match previo"),
  exactFood("fagopyrum esculentum", "170286", "Trigo sarraceno cocido; mejor alimento disponible en FDC local"),
  exactFood("fragaria x ananassa", "167762", "Frutilla cruda; corrige match a topping de frutilla"),
  exactFood("cicer arietinum", "173756", "Garbanzo maduro crudo; leguminosa alimentaria agregada al catalogo curado"),
  exactFood("glycine max", "169282", "Soya verde cruda; match taxonomico curado"),
  exactFood("guizotia abyssinica", "170558", "Semilla oleaginosa; proxy por semilla de cartamo ante ausencia de ramtil/niger en FDC local", "proxy"),
  exactFood("helianthus spp", "170562", "Semilla de maravilla cruda; proxy de genero Helianthus"),
  exactFood("hordeum vulgare", "170284", "Cebada perlada cruda; match de cereal disponible en FDC"),
  exactFood("lactuca sativa", "169247", "Lechuga cruda; match taxonomico curado"),
  exactFood("lathyrus sativus", "170419", "Arveja seca partida; proxy para almorta/chickling pea sin perfil FDC directo", "proxy"),
  exactFood("lens culinaris", "172420", "Lenteja cruda; leguminosa alimentaria agregada al catalogo curado"),
  exactFood("linum usitatissiumum", "169414", "Linaza/flaxseed; agrega especie sin match previo"),
  exactFood("lupinus spp", "172423", "Lupino maduro crudo; proxy por genero Lupinus"),
  exactFood("lycopersicon esculentum", "170457", "Tomate crudo; match taxonomico curado"),
  exactFood("medigaco sativa", "168384", "Brotes de alfalfa crudos; proxy comestible de alfalfa"),
  exactFood("ocimum basilicum", "172232", "Albahaca fresca; match taxonomico curado"),
  exactFood("oryza sativa", "169703", "Arroz integral crudo; evita match a arroz silvestre"),
  exactFood("pastinaca sativa", "170417", "Chirivia cruda; match taxonomico curado"),
  exactFood("petroselinum crispum", "170416", "Perejil fresco; match taxonomico curado"),
  exactFood("phaseolus spp", "169961", "Poroto verde crudo; proxy hortícola de Phaseolus"),
  exactFood("phaseolus vulgaris", "175199", "Poroto maduro crudo; proxy por poroto pinto USDA para poroto seco/granado"),
  exactFood("pisum spp", "170419", "Arveja verde/seca; proxy de Pisum disponible en FDC local"),
  exactFood("raphanus sativus", "169276", "Rabano crudo; match taxonomico curado"),
  exactFood("rheum rhabarbarum", "167758", "Ruibarbo crudo; match taxonomico curado"),
  exactFood("scorzonera hispanica", "169277", "Salsifi negro; corrige falso match con berries"),
  exactFood("secale cereale", "168884", "Grano de centeno; corrige falso match con chicken fryers"),
  exactFood("sinapis alba", "170929", "Semilla de mostaza molida; agrega mostaza blanca"),
  exactFood("solanum melongena", "169228", "Berenjena cruda; match taxonomico curado"),
  exactFood("solanum tuberosum", "170026", "Papa cruda; match taxonomico curado"),
  exactFood("sorghum spp", "169716", "Sorgo grano entero crudo; proxy por genero Sorghum"),
  exactFood("spinacia oleracea", "168462", "Espinaca cruda; match taxonomico curado"),
  exactFood("triticum aestivum", "168889", "Trigo duro rojo de primavera; proxy de grano de trigo disponible en FDC"),
  exactFood("triticosecale", "169718", "Triticale; match de cereal disponible en FDC"),
  exactFood("valerianella sp", "169219", "Canonigo/cornsalad crudo; corrige falso match por 'sp'"),
  exactFood("vicia faba", "170377", "Haba verde cruda; match taxonomico curado"),
  exactFood("vicia sp", "168574", "Vicia; proxy por haba verde para especie de Vicia sin perfil FDC directo", "proxy"),
  exactFood("zea mais", "169998", "Maiz dulce amarillo crudo; corrige falso match por Zea"),
  nonFood("lolium multiflorum", "Cultivo forrajero/cobertura: sin perfil alimentario humano confiable en FDC/INFOODS"),
  nonFood("lolium perenne", "Cultivo forrajero/cobertura: sin perfil alimentario humano confiable en FDC/INFOODS"),
  nonFood("nicotiana tabacum", "No se modela como alimento por uso no alimentario y riesgo sanitario"),
  nonFood("phacelia sp", "Cultivo de servicio para polinizadores/cobertura: sin perfil alimentario humano confiable"),
  nonFood("tagetes sp", "Cultivo de servicio/ornamental: sin perfil alimentario humano confiable"),
  nonFood("trifolium alexandrinum", "Trebol forrajero/cobertura: sin perfil alimentario humano confiable"),
  nonFood("trifolium incarnatum", "Trebol forrajero/cobertura: sin perfil alimentario humano confiable"),
  nonFood("trifolium pratense", "Trebol forrajero/cobertura: sin perfil alimentario humano confiable"),
  nonFood("trifolium repens", "Trebol forrajero/cobertura: sin perfil alimentario humano confiable"),
  nonFood("trifolium resupinatum", "Trebol forrajero/cobertura: sin perfil alimentario humano confiable"),
  nonFood("trifolium spp", "Trebol forrajero/cobertura: sin perfil alimentario humano confiable")
];

function curatedNutritionFor(scientificName: string, commonName: string) {
  const normalized = `${scientificName} ${commonName}`.toLowerCase().replace(/×/g, "x").replace(/[^a-z0-9 ]/g, " ");
  return CURATED_NUTRITION_PROFILES.find((profile) => profile.match.some((item) => normalized.includes(item)));
}

function exactFood(match: string, fdcId: string, label: string, level: "observed" | "proxy" = "observed"): CuratedNutritionProfile {
  return {
    fdcId,
    level,
    label,
    source: "USDA FoodData Central local; criterio de match FAO/INFOODS; contraste nacional Tabla de Composicion Quimica de Alimentos Chilenos",
    match: [match.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim()]
  };
}

function nonFood(match: string, label: string): CuratedNutritionProfile {
  return {
    foodCrop: false,
    label,
    source: "Revision curada FDC/FAO INFOODS/Tabla chilena; se conserva valor nutricional humano como ausente",
    match: [match.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim()]
  };
}

function estimatePhysiology(family: string | null, name: string) {
  const text = `${inferFamily(family, name)} ${name}`.toLowerCase();
  if (text.includes("fabaceae") || text.includes("pea") || text.includes("bean")) {
    return { yieldKgM2: 1.4, cycleDays: 95, waterMmCycle: 330 };
  }
  if (text.includes("brassicaceae") || text.includes("cabbage") || text.includes("turnip")) {
    return { yieldKgM2: 2.7, cycleDays: 85, waterMmCycle: 270 };
  }
  if (text.includes("solanaceae") || text.includes("tomato") || text.includes("potato")) {
    return { yieldKgM2: 3.2, cycleDays: 115, waterMmCycle: 410 };
  }
  if (text.includes("poaceae") || text.includes("oat") || text.includes("maize")) {
    return { yieldKgM2: 1.1, cycleDays: 125, waterMmCycle: 360 };
  }
  if (text.includes("amaranthaceae") || text.includes("beet")) {
    return { yieldKgM2: 2.4, cycleDays: 75, waterMmCycle: 250 };
  }
  return { yieldKgM2: 1.8, cycleDays: 90, waterMmCycle: 300 };
}

const WATER_CYCLE_PROFILES: Array<{
  name: string;
  source: string;
  level: "observed" | "proxy" | "generic";
  waterLabel: string;
  cycleLabel: string;
  waterRange: [number, number];
  cycleRange: [number, number];
  match: (scientificName: string, commonName: string) => boolean;
}> = [
  profile("Tomate", "FAO Crop Water Needs", "proxy", [400, 800], [90, 140], includesAny("lycopersicon", "solanum lycopersicum", "tomato")),
  profile("Papa", "FAO Crop Water Needs", "proxy", [500, 700], [90, 150], includesAny("solanum tuberosum", "potato")),
  profile("Cebolla/ajo", "FAO Crop Water Needs", "proxy", [350, 550], [90, 150], includesAny("allium")),
  profile("Pimenton", "FAO Crop Water Needs", "proxy", [600, 900], [120, 180], includesAny("capsicum", "pepper")),
  profile("Zanahoria/nabo", "FAO Crop Water Needs", "proxy", [350, 550], [90, 120], includesAny("daucus", "raphanus", "carrot", "turnip")),
  profile("Brassica hoja/flor", "FAO Crop Water Needs", "proxy", [350, 500], [70, 120], includesAny("brassica", "cabbage", "broccoli", "cauliflower")),
  profile("Lechuga/achicoria", "FAO Crop Water Needs", "proxy", [250, 400], [45, 80], includesAny("lactuca", "cichorium", "lettuce", "chicory")),
  profile("Zapallo/calabaza", "FAO Crop Water Needs", "proxy", [400, 700], [100, 150], includesAny("cucurbita", "pumpkin", "squash")),
  profile("Pepino/melon/sandia", "FAO Crop Water Needs", "proxy", [400, 650], [80, 125], includesAny("cucumis", "citrullus", "cucumber", "melon", "watermelon")),
  profile("Leguminosas secas", "FAO Crop Water Needs", "proxy", [300, 500], [90, 130], includesAny("lens", "cicer", "lentil", "chickpea", "garbanzo")),
  profile("Leguminosas verdes", "FAO Crop Water Needs", "proxy", [300, 500], [70, 110], includesAny("phaseolus", "pisum", "vicia faba", "bean", "pea")),
  profile("Cereales", "FAO Crop Water Needs", "proxy", [350, 650], [110, 150], includesAny("avena", "hordeum", "triticum", "secale", "zea", "oryza", "oat", "wheat", "maize", "barley", "rice")),
  profile("Espinaca", "FAO Crop Water Needs", "proxy", [250, 400], [45, 70], includesAny("spinacia", "spinach")),
  profile("Frutilla", "FAO Crop Water Needs", "proxy", [350, 550], [90, 140], includesAny("fragaria", "strawberry"))
];

function profile(
  name: string,
  source: string,
  level: "observed" | "proxy" | "generic",
  waterRange: [number, number],
  cycleRange: [number, number],
  match: (scientificName: string, commonName: string) => boolean
) {
  return {
    name,
    source,
    level,
    waterLabel: "Requerimiento hidrico por rango FAO, usando punto medio",
    cycleLabel: "Duracion de ciclo por rango agronomico, usando punto medio",
    waterRange,
    cycleRange,
    match
  };
}

function includesAny(...needles: string[]) {
  return (scientificName: string, commonName: string) => {
    const text = `${scientificName} ${commonName}`.toLowerCase();
    return needles.some((needle) => text.includes(needle));
  };
}

function midpoint(range: [number, number]) {
  return Math.round((range[0] + range[1]) / 2);
}

function hostRisk(status: string | null) {
  const value = (status ?? "").toLowerCase();
  if (value.includes("good") || value === "host") return 1;
  if (value.includes("moderate")) return 0.7;
  if (value.includes("poor")) return 0.35;
  if (value.includes("non")) return 0;
  return 0.15;
}

function inferFamily(family: string | null, scientificName: string) {
  if (family && family !== "Familia no clasificada") return family;
  const genus = scientificName.toLowerCase().split(/\s+/)[0];
  const map: Record<string, string> = {
    anethum: "Apiaceae",
    apium: "Apiaceae",
    lupinus: "Fabaceae",
    asparagus: "Asparagaceae",
    beta: "Amaranthaceae",
    capsicum: "Solanaceae",
    cichorium: "Asteraceae",
    coriandrum: "Apiaceae",
    ocimum: "Lamiaceae",
    petroselinum: "Apiaceae",
    daucus: "Apiaceae",
    eruca: "Brassicaceae",
    helianthus: "Asteraceae",
    lactuca: "Asteraceae",
    allium: "Amaryllidaceae",
    cucumis: "Cucurbitaceae",
    cucurbita: "Cucurbitaceae",
    citrullus: "Cucurbitaceae",
    fragaria: "Rosaceae",
    lathyrus: "Fabaceae",
    lens: "Fabaceae",
    cicer: "Fabaceae",
    lycopersicon: "Solanaceae",
    medicago: "Fabaceae",
    medigaco: "Fabaceae",
    phaseolus: "Fabaceae",
    pisum: "Fabaceae",
    raphanus: "Brassicaceae",
    rheum: "Polygonaceae",
    scorzonera: "Asteraceae",
    solanum: "Solanaceae",
    spinacia: "Amaranthaceae",
    tagetes: "Asteraceae",
    valerianella: "Caprifoliaceae",
    vicia: "Fabaceae",
    brassica: "Brassicaceae"
  };
  return map[genus] ?? family ?? "Familia no clasificada";
}

function localChileanName(commonName: string | null, scientificName: string) {
  const scientific = scientificName.toLowerCase().replace(/^v-|^f-/, "").trim();
  const common = (commonName ?? "").toLowerCase().trim();
  const text = `${common} ${scientific}`;

  const scientificMap: Record<string, string> = {
    "allium ampeloprasum": "Puerro",
    "allium sativum": "Ajo",
    "allium spp.": "Cebolla",
    "anethum graveolens": "Eneldo",
    "apium graveolens": "Apio",
    "asparagus offininalis": "Espárrago",
    "avena sativa": "Avena",
    "avena strigosa": "Avena negra",
    "beta vulgaris": "Betarraga",
    "brassica napus": "Raps",
    "brassica oleracea": "Repollo, brócoli o coliflor",
    "brassica rapa": "Nabo",
    "brassica spp.": "Mostaza",
    "capsicum annum": "Pimentón",
    "cichorium intybus": "Achicoria",
    "citrullus lanatus": "Sandía",
    "coriandrum sativum": "Cilantro",
    "cucumis melo": "Melón",
    "cucumis sativus": "Pepino",
    "cucurbita spp.": "Zapallo",
    "daucus carota": "Zanahoria",
    "eruca vesicaria subsp. sativa": "Rúcula",
    "fagopyrum esculentum": "Trigo sarraceno",
    "fragaria x ananassa": "Frutilla",
    "glycine max": "Soya",
    "cicer arietinum": "Garbanzo",
    "helianthus spp.": "Maravilla",
    "hordeum vulgare": "Cebada",
    "lactuca sativa": "Lechuga",
    "lathyrus sativus": "Arveja almorta",
    "lens culinaris": "Lenteja",
    "linum usitatissiumum": "Linaza",
    "lolium multiflorum": "Ballica italiana",
    "lolium perenne": "Ballica perenne",
    "lupinus spp.": "Lupino",
    "lycopersicon esculentum": "Tomate",
    "medigaco sativa": "Alfalfa",
    "nicotiana tabacum": "Tabaco",
    "ocimum basilicum": "Albahaca",
    "oryza sativa": "Arroz",
    "pastinaca sativa": "Chirivía",
    "petroselinum crispum": "Perejil",
    "phaseolus spp.": "Poroto",
    "phaseolus vulgaris": "Poroto seco o granado",
    "phacelia sp.": "Facelia",
    "pisum spp.": "Arveja",
    "raphanus sativus": "Rábano",
    "rheum rhabarbarum": "Ruibarbo",
    "secale cereale": "Centeno",
    "sinapis alba": "Mostaza blanca",
    "solanum melongena": "Berenjena",
    "solanum tuberosum": "Papa",
    "sorghum spp.": "Sorgo",
    "spinacia oleracea": "Espinaca",
    "tagetes sp.": "Clavelón",
    "trifolium alexandrinum": "Trébol alejandrino",
    "trifolium incarnatum": "Trébol encarnado",
    "trifolium pratense": "Trébol rosado",
    "trifolium repens": "Trébol blanco",
    "trifolium resupinatum": "Trébol persa",
    "trifolium spp.": "Trébol",
    "triticum aestivum": "Trigo",
    "valerianella sp.": "Canónigo",
    "vicia faba": "Haba",
    "vicia sp.": "Vicia",
    "zea mais": "Maíz"
  };

  if (scientificMap[scientific]) return scientificMap[scientific];
  if (text.includes("beans")) return "Poroto";
  if (text.includes("beet")) return "Betarraga";
  if (text.includes("cabbage") || text.includes("broccoli") || text.includes("cauliflower")) return "Repollo, brócoli o coliflor";
  if (text.includes("sweet pepper")) return "Pimentón";
  if (text.includes("watermel")) return "Sandía";
  if (text.includes("maize") || text.includes("corn")) return "Maíz";
  return title(commonName ?? scientificName);
}

function nutrientKey(name: string) {
  const map: Record<string, string> = {
    Protein: "protein",
    "Fiber, total dietary": "fiber",
    "Vitamin C, total ascorbic acid": "vitaminC",
    "Vitamin A, RAE": "vitaminA",
    "Folate, total": "folate",
    "Calcium, Ca": "calcium",
    "Iron, Fe": "iron",
    "Zinc, Zn": "zinc",
    "Potassium, K": "potassium",
    "Magnesium, Mg": "magnesium",
    Energy: "energy"
  };
  return map[name];
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function title(value: string) {
  return value.replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}
