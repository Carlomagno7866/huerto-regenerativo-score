import Database from "better-sqlite3";
import path from "node:path";
import type { CropCandidate, CropEvidence, EvidenceDescriptor, RotationAgent, ScoreConfidence } from "./types";

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
  fdc_id: string;
  description: string;
  data_type: string | null;
  nutrient_name: string;
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
    soilFit: 0.72,
    riskAgents,
    evidence,
    confidence
  };
}

function findNutrition(commonName: string, scientificName: string) {
  const aliases = buildAliases(commonName, scientificName);
  const rows: NutrientRow[] = [];
  let matchedFood: string | null = null;
  const statement = getDb().prepare(
    `
    SELECT fdc_id, description, data_type, nutrient_name, CAST(amount AS REAL) AS amount
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
  const rows = getDb()
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
      label: "Ajuste edafico generico por pH y textura",
      source: "SoilGrids Chile local"
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
    ["phaseolus", "Other beans, green"],
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
    "helianthus spp.": "Maravilla",
    "hordeum vulgare": "Cebada",
    "lactuca sativa": "Lechuga",
    "lathyrus sativus": "Arveja almorta",
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
