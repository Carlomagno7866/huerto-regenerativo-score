import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dbPath = process.env.HUERTO_DB_PATH ?? path.join(root, "data", "huerto_regenerativo.sqlite");
const outDir = path.join(root, "data", "derived");
const outPath = path.join(outDir, "crop_evidence_profiles.json");

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma("query_only = ON");

const crops = db
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
  .all();

const yieldStmt = db.prepare(
  `
  SELECT item, AVG(CAST(value AS REAL)) / 10000 AS yieldKgM2, COUNT(*) AS observations
  FROM faostat_chile_crop_livestock_production
  WHERE element = 'Yield'
    AND unit = 'kg/ha'
    AND item = ?
    AND CAST(year AS INTEGER) BETWEEN 2020 AND 2024
    AND value IS NOT NULL
  GROUP BY item
`
);

const agentStmt = db.prepare(
  `
  SELECT agent_type AS type, agent_name AS name, host_status AS hostStatus, disease_reduction AS diseaseReduction
  FROM best4soil_crop_agent_risk
  WHERE TRIM(REPLACE(REPLACE(crop_latin_name, 'V-', ''), 'F-', '')) = ?
    AND agent_name IS NOT NULL
  ORDER BY agent_name
`
);

const nutritionStmt = db.prepare(
  `
  SELECT fdc_id AS fdcId, description, data_type AS dataType, COUNT(*) AS nutrientCount
  FROM fdc_core_food_nutrients
  WHERE lower(description) LIKE ?
  GROUP BY fdc_id, description, data_type
  ORDER BY
    CASE
      WHEN lower(description) LIKE '%raw%' THEN 0
      WHEN lower(description) LIKE '%fresh%' THEN 1
      WHEN lower(description) LIKE '%cooked%' THEN 2
      ELSE 3
    END,
    nutrientCount DESC,
    LENGTH(description)
  LIMIT 1
`
);

const profiles = crops.map((crop) => {
  const faostatItem = faostatItemFor(crop.scientificName, crop.commonName ?? "");
  const yieldProfile = faostatItem ? yieldStmt.get(faostatItem) : null;
  const aliases = buildAliases(crop.commonName ?? crop.scientificName, crop.scientificName);
  const nutritionMatch = aliases.map((alias) => nutritionStmt.get(`%${alias}%`)).find(Boolean) ?? null;
  const agents = agentStmt.all(crop.scientificName);

  return {
    scientificName: crop.scientificName,
    commonName: crop.commonName,
    family: crop.family,
    genus: crop.genus,
    species: crop.species,
    nutritionMatch: nutritionMatch
      ? {
          quality: "candidate",
          source: "USDA FoodData Central local",
          ...nutritionMatch
        }
      : {
          quality: "missing",
          source: "USDA FoodData Central local"
        },
    yieldProfile: yieldProfile
      ? {
          level: "observed",
          source: "FAOSTAT Chile local",
          years: "2020-2024",
          ...yieldProfile
        }
      : {
          level: "missing",
          source: "FAOSTAT Chile local",
          item: faostatItem
        },
    rotationProfile: {
      source: "Best4Soil local",
      agentCount: agents.length,
      agents: agents.slice(0, 24)
    }
  };
});

mkdirSync(outDir, { recursive: true });
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      method: "Derived evidence profile seed from local SQLite tables; scoring still hydrates live records in lib/db.ts.",
      profiles
    },
    null,
    2
  )}\n`
);

console.log(`Wrote ${profiles.length} crop evidence profiles to ${outPath}`);
db.close();

function faostatItemFor(scientificName, commonName) {
  const text = `${scientificName} ${commonName}`.toLowerCase();
  const exact = [
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
    ["lactuca", "Lettuce and chicory"],
    ["vicia faba", "Broad beans and horse beans, green"],
    ["pisum", "Peas, green"],
    ["phaseolus", "Other beans, green"],
    ["spinacia", "Spinach"],
    ["fragaria", "Strawberries"],
    ["zea", "Green corn (maize)"]
  ];
  return exact.find(([key]) => text.includes(key))?.[1] ?? null;
}

function buildAliases(commonName, scientificName) {
  const raw = [commonName, scientificName.split(" ")[0], scientificName.split(" ")[1] ?? ""]
    .map((value) => value.toLowerCase().replace(/[^a-z ]/g, " ").trim())
    .filter(Boolean);
  const parts = raw.flatMap((value) => value.split(/\s+|\/|,/)).filter((value) => value.length > 3);
  return Array.from(new Set([...raw, ...parts])).slice(0, 6);
}
