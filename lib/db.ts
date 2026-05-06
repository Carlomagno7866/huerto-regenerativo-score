import Database from "better-sqlite3";
import path from "node:path";
import type { CropCandidate } from "./types";

const DB_PATH = process.env.HUERTO_DB_PATH ?? path.join(process.cwd(), "data", "huerto_regenerativo.sqlite");

let db: Database.Database | null = null;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
  }
  return db;
}

type CatalogRow = {
  scientificName: string;
  commonName: string | null;
  family: string | null;
  genus: string | null;
  species: string | null;
};

type NutrientRow = {
  description: string;
  nutrient_name: string;
  amount: number;
};

export function getCatalog(search = "", limit = 80): CropCandidate[] {
  const term = `%${search.trim().toLowerCase()}%`;
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
        AND (? = '%%'
          OR lower(crop_latin_name) LIKE ?
          OR lower(COALESCE(crop_common_name, '')) LIKE ?
          OR lower(COALESCE(family, '')) LIKE ?)
      GROUP BY TRIM(REPLACE(REPLACE(crop_latin_name, 'V-', ''), 'F-', '')), COALESCE(family, 'Familia no clasificada')
      ORDER BY commonName
      LIMIT ?
    `
    )
    .all(term, term, term, term, limit) as CatalogRow[];

  return rows.map(hydrateCrop);
}

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

function hydrateCrop(row: CatalogRow): CropCandidate {
  const nutritionMatch = findNutrition(row.commonName ?? row.scientificName, row.scientificName);
  const physiology = estimatePhysiology(row.family, row.commonName ?? row.scientificName);
  return {
    id: slug(row.scientificName),
    scientificName: row.scientificName,
    commonName: title(row.commonName ?? row.scientificName),
    family: inferFamily(row.family, row.scientificName),
    genus: row.genus,
    species: row.species,
    nutrition: nutritionMatch.nutrients,
    matchedFood: nutritionMatch.description,
    ...physiology,
    soilFit: 0.72,
    confidence: nutritionMatch.description ? 0.78 : 0.52
  };
}

function findNutrition(commonName: string, scientificName: string) {
  const aliases = buildAliases(commonName, scientificName);
  const rows: NutrientRow[] = [];
  let matchedFood: string | null = null;
  const statement = getDb().prepare(
    `
    SELECT description, nutrient_name, CAST(amount AS REAL) AS amount
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

  const nutrients: Record<string, number> = {};
  for (const row of rows) {
    const key = nutrientKey(row.nutrient_name);
    if (key && nutrients[key] === undefined && Number.isFinite(row.amount)) {
      nutrients[key] = row.amount;
    }
  }

  return { description: matchedFood, nutrients };
}

function buildAliases(commonName: string, scientificName: string) {
  const raw = [commonName, scientificName.split(" ")[0], scientificName.split(" ")[1] ?? ""]
    .map((value) => value.toLowerCase().replace(/[^a-z ]/g, " ").trim())
    .filter(Boolean);
  const parts = raw.flatMap((value) => value.split(/\s+|\/|,/)).filter((value) => value.length > 3);
  return Array.from(new Set([...raw, ...parts])).slice(0, 6);
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

function inferFamily(family: string | null, scientificName: string) {
  if (family && family !== "Familia no clasificada") return family;
  const genus = scientificName.toLowerCase().split(/\s+/)[0];
  const map: Record<string, string> = {
    lupinus: "Fabaceae",
    asparagus: "Asparagaceae",
    ocimum: "Lamiaceae",
    petroselinum: "Apiaceae",
    daucus: "Apiaceae",
    lactuca: "Asteraceae",
    allium: "Amaryllidaceae",
    cucumis: "Cucurbitaceae",
    cucurbita: "Cucurbitaceae",
    solanum: "Solanaceae",
    brassica: "Brassicaceae"
  };
  return map[genus] ?? family ?? "Familia no clasificada";
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
