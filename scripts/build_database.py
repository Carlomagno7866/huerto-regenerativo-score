from __future__ import annotations

import json
import re
import sqlite3
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parents[1]
BIB = ROOT / "bibliografia"
DATA = ROOT / "data"
DB_PATH = DATA / "huerto_regenerativo.sqlite"
FAOSTAT_ZIP = BIB / "03_suelo_clima_agua_rendimiento" / "FAOSTAT_Production_Crops_Livestock_Normalized.zip"


SOURCE_URLS = {
    "USDA_FoodDataCentral_FoundationFoods_2026-04_CSV.zip": "https://test.fdc.inonde.io/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip",
    "USDA_FoodDataCentral_SRLegacy_2018_CSV.zip": "https://test.fdc.inonde.io/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    "USDA_FoodDataCentral_FNDDS_2021-2023_JSON.zip": "https://test.fdc.inonde.io/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
    "Best4Soil_DatabaseScheme_Datamining_2020.xlsx": "https://doi.org/10.5281/zenodo.4333554",
    "FAOSTAT_Production_Crops_Livestock_Normalized.zip": "https://fenixservices.fao.org/faostat/static/bulkdownloads/Production_Crops_Livestock_E_All_Data_(Normalized).zip",
}


def slug(name: str) -> str:
    value = re.sub(r"[^0-9a-zA-Z]+", "_", str(name).strip().lower())
    return re.sub(r"_+", "_", value).strip("_") or "unnamed"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DATA.mkdir(exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def create_core_tables(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT,
            local_path TEXT,
            url TEXT,
            file_type TEXT,
            bytes INTEGER,
            valid_signature INTEGER,
            ingested_at TEXT NOT NULL
        );

        CREATE TABLE api_portal_endpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            url TEXT NOT NULL,
            purpose TEXT,
            access_mode TEXT,
            last_checked_at TEXT,
            status TEXT,
            notes TEXT
        );

        CREATE TABLE ingestion_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            step TEXT NOT NULL,
            status TEXT NOT NULL,
            rows INTEGER,
            message TEXT,
            created_at TEXT NOT NULL
        );
        """
    )


def log(con: sqlite3.Connection, step: str, status: str, rows: int | None = None, message: str = "") -> None:
    con.execute(
        "INSERT INTO ingestion_log(step,status,rows,message,created_at) VALUES (?,?,?,?,?)",
        (step, status, rows, message, now()),
    )
    con.commit()
    print(f"[{status}] {step}: {rows if rows is not None else ''} {message}")


def register_sources(con: sqlite3.Connection) -> None:
    rows = []
    for path in BIB.rglob("*"):
        if not path.is_file():
            continue
        sig = path.read_bytes()[:8]
        suffix = path.suffix.lower().replace(".", "")
        valid = int(
            (suffix == "pdf" and sig.startswith(b"%PDF"))
            or (suffix in {"zip", "xlsx"} and sig.startswith(b"PK"))
            or suffix in {"json", "html"}
        )
        rows.append(
            {
                "name": path.name,
                "category": path.parent.name if path.parent != BIB else "bibliografia",
                "local_path": str(path),
                "url": SOURCE_URLS.get(path.name),
                "file_type": suffix,
                "bytes": path.stat().st_size,
                "valid_signature": valid,
                "ingested_at": now(),
            }
        )
    pd.DataFrame(rows).to_sql("sources", con, if_exists="append", index=False)
    log(con, "register_sources", "ok", len(rows))


def zip_member(zip_path: Path, suffix: str) -> str:
    with zipfile.ZipFile(zip_path) as z:
        matches = [n for n in z.namelist() if Path(n).name == suffix]
    if not matches:
        raise FileNotFoundError(f"{suffix} not found in {zip_path}")
    return matches[0]


def load_csv_from_zip(con: sqlite3.Connection, zip_path: Path, member_suffix: str, table: str) -> int:
    member = zip_member(zip_path, member_suffix)
    total = 0
    with zipfile.ZipFile(zip_path) as z, z.open(member) as fh:
        for chunk in pd.read_csv(fh, dtype=str, chunksize=100_000, low_memory=False):
            chunk.columns = [slug(c) for c in chunk.columns]
            chunk.to_sql(table, con, if_exists="append", index=False)
            total += len(chunk)
    log(con, table, "ok", total, zip_path.name)
    return total


def ingest_fooddata_central(con: sqlite3.Connection) -> None:
    foundation = BIB / "01_nutricion_composicion" / "USDA_FoodDataCentral_FoundationFoods_2026-04_CSV.zip"
    sr = BIB / "01_nutricion_composicion" / "USDA_FoodDataCentral_SRLegacy_2018_CSV.zip"
    fndds = BIB / "01_nutricion_composicion" / "USDA_FoodDataCentral_FNDDS_2021-2023_JSON.zip"

    for zip_path, prefix in [(foundation, "fdc_foundation"), (sr, "fdc_sr_legacy")]:
        for suffix in [
            "food.csv",
            "food_category.csv",
            "nutrient.csv",
            "food_nutrient.csv",
            "food_portion.csv",
            "food_component.csv",
            "retention_factor.csv",
        ]:
            try:
                load_csv_from_zip(con, zip_path, suffix, f"{prefix}_{Path(suffix).stem}")
            except FileNotFoundError:
                continue

    with zipfile.ZipFile(fndds) as z:
        data = json.loads(z.read(z.namelist()[0]))
    foods, nutrients, portions = [], [], []
    for food in data["SurveyFoods"]:
        fdc_id = food.get("fdcId")
        foods.append(
            {
                "fdc_id": fdc_id,
                "description": food.get("description"),
                "food_code": food.get("foodCode"),
                "data_type": food.get("dataType"),
                "publication_date": food.get("publicationDate"),
                "wweia_category": (food.get("wweiaFoodCategory") or {}).get("wweiaFoodCategoryDescription"),
            }
        )
        for n in food.get("foodNutrients", []):
            nutrient = n.get("nutrient") or {}
            nutrients.append(
                {
                    "fdc_id": fdc_id,
                    "nutrient_id": nutrient.get("id"),
                    "nutrient_name": nutrient.get("name"),
                    "unit_name": nutrient.get("unitName"),
                    "amount": n.get("amount"),
                }
            )
        for p in food.get("foodPortions", []):
            unit = p.get("measureUnit") or {}
            portions.append(
                {
                    "fdc_id": fdc_id,
                    "portion_id": p.get("id"),
                    "gram_weight": p.get("gramWeight"),
                    "portion_description": p.get("portionDescription"),
                    "measure_unit": unit.get("name"),
                    "modifier": p.get("modifier"),
                }
            )
    pd.DataFrame(foods).to_sql("fdc_fndds_food", con, if_exists="replace", index=False)
    pd.DataFrame(nutrients).to_sql("fdc_fndds_food_nutrient", con, if_exists="replace", index=False)
    pd.DataFrame(portions).to_sql("fdc_fndds_food_portion", con, if_exists="replace", index=False)
    log(con, "fdc_fndds_json", "ok", len(foods), "survey foods")


def ingest_best4soil(con: sqlite3.Connection) -> None:
    path = BIB / "04_rotacion_sanidad_malezas" / "Best4Soil_DatabaseScheme_Datamining_2020.xlsx"
    df = pd.read_excel(path, sheet_name="data collection", header=4, dtype=str)
    df = df.dropna(how="all")
    df.columns = [slug(c) for c in df.columns]
    df.to_sql("best4soil_raw_records", con, if_exists="replace", index=False)

    latin_col = "crop_latin_name"
    rows = []
    for _, r in df.iterrows():
        crop_latin = str(r.get(latin_col, "") or "").strip()
        crop_latin_clean = re.sub(r"^[FG]-", "", crop_latin).strip()
        for agent_col, agent_type in [("nematode_species", "nematode"), ("fungus_species_main_name_new_list", "fungus")]:
            agent = str(r.get(agent_col, "") or "").strip()
            if not agent or agent.lower() == "nan":
                continue
            rows.append(
                {
                    "crop_latin_name": crop_latin_clean,
                    "crop_common_name": r.get("crop_english_name"),
                    "agent_type": agent_type,
                    "agent_name": agent,
                    "host_status": r.get("host_status_decision"),
                    "host_tolerance": r.get("host_tolerance_decision"),
                    "disease_reduction": r.get("reduction_of_disease"),
                    "green_manure_yield_effect": r.get("effect_of_green_manure_on_yield_of_fellow_crop"),
                    "source_title": r.get("title"),
                    "source_authors": r.get("authors"),
                    "source_type": r.get("type_of_source"),
                }
            )
    pd.DataFrame(rows).drop_duplicates().to_sql("best4soil_crop_agent_risk", con, if_exists="replace", index=False)
    log(con, "best4soil", "ok", len(df), "raw records")


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with dest.open("wb") as fh:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    fh.write(chunk)


def ingest_faostat_chile(con: sqlite3.Connection) -> None:
    url = SOURCE_URLS["FAOSTAT_Production_Crops_Livestock_Normalized.zip"]
    download(url, FAOSTAT_ZIP)
    target_cols = [
        "Area Code",
        "Area",
        "Item Code",
        "Item",
        "Element",
        "Year",
        "Unit",
        "Value",
        "Flag",
    ]
    total = 0
    with zipfile.ZipFile(FAOSTAT_ZIP) as z:
        member = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
        with z.open(member) as fh:
            for chunk in pd.read_csv(fh, dtype=str, chunksize=200_000, low_memory=False):
                cols = [c for c in target_cols if c in chunk.columns]
                chunk = chunk.loc[chunk["Area"].eq("Chile"), cols]
                if chunk.empty:
                    continue
                chunk.columns = [slug(c) for c in chunk.columns]
                chunk.to_sql("faostat_chile_crop_livestock_production", con, if_exists="append", index=False)
                total += len(chunk)
    log(con, "faostat_chile_crop_livestock_production", "ok", total)


def ingest_soilgrids_metadata(con: sqlite3.Connection) -> None:
    url = "https://rest.isric.org/soilgrids/v2.0/properties/layers"
    r = requests.get(url, timeout=30)
    status = f"HTTP {r.status_code}"
    rows = []
    if r.ok:
        for layer in r.json().get("layers", []):
            for depth in layer.get("layer_structure", []):
                rows.append(
                    {
                        "property": layer.get("property"),
                        "depth_range": depth.get("range"),
                        "values_available": ",".join(depth.get("values", [])),
                    }
                )
        pd.DataFrame(rows).to_sql("soilgrids_available_layers", con, if_exists="replace", index=False)
    con.execute(
        "INSERT INTO api_portal_endpoints(name,provider,url,purpose,access_mode,last_checked_at,status,notes) VALUES (?,?,?,?,?,?,?,?)",
        ("SoilGrids REST layers", "ISRIC", url, "Metadata for soil properties to query by lat/lon", "REST API", now(), status, "Use point query once the user provides garden coordinates."),
    )
    log(con, "soilgrids_metadata", "ok" if r.ok else "failed", len(rows), status)


def gbif_match(name: str) -> dict:
    url = "https://api.gbif.org/v1/species/match?" + urlencode({"name": name, "kingdom": "Plantae"})
    r = requests.get(url, timeout=20)
    if not r.ok:
        return {"query_name": name, "status": f"HTTP {r.status_code}"}
    data = r.json()
    return {
        "query_name": name,
        "usage_key": data.get("usageKey"),
        "scientific_name": data.get("scientificName"),
        "canonical_name": data.get("canonicalName"),
        "rank": data.get("rank"),
        "status": data.get("status") or data.get("matchType"),
        "confidence": data.get("confidence"),
        "kingdom": data.get("kingdom"),
        "family": data.get("family"),
        "genus": data.get("genus"),
        "species": data.get("species"),
    }


def ingest_gbif_taxonomy(con: sqlite3.Connection) -> None:
    names = set()
    for (name,) in con.execute("SELECT DISTINCT crop_latin_name FROM best4soil_crop_agent_risk WHERE crop_latin_name IS NOT NULL"):
        cleaned = re.sub(r"\bspp?\.?$", "", str(name)).strip()
        if cleaned and len(cleaned) > 3:
            names.add(cleaned)
    try:
        for (name,) in con.execute("SELECT DISTINCT scientific_name FROM fdc_foundation_food WHERE scientific_name IS NOT NULL"):
            if name and len(str(name)) > 3:
                names.add(str(name).strip())
    except sqlite3.OperationalError:
        pass
    rows = []
    for i, name in enumerate(sorted(names), 1):
        rows.append(gbif_match(name))
        if i % 25 == 0:
            time.sleep(0.3)
    pd.DataFrame(rows).to_sql("gbif_crop_taxon_matches", con, if_exists="replace", index=False)
    con.execute(
        "INSERT INTO api_portal_endpoints(name,provider,url,purpose,access_mode,last_checked_at,status,notes) VALUES (?,?,?,?,?,?,?,?)",
        ("GBIF species match", "GBIF", "https://api.gbif.org/v1/species/match", "Taxonomic normalization for crop scientific names", "REST API", now(), "ok", f"{len(rows)} names queried"),
    )
    log(con, "gbif_crop_taxon_matches", "ok", len(rows))


def create_indexes_and_views(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_fdc_foundation_food_fdc ON fdc_foundation_food(fdc_id);
        CREATE INDEX IF NOT EXISTS idx_fdc_foundation_nutrient_fdc ON fdc_foundation_food_nutrient(fdc_id);
        CREATE INDEX IF NOT EXISTS idx_fdc_sr_food_fdc ON fdc_sr_legacy_food(fdc_id);
        CREATE INDEX IF NOT EXISTS idx_fdc_sr_nutrient_fdc ON fdc_sr_legacy_food_nutrient(fdc_id);
        CREATE INDEX IF NOT EXISTS idx_best4soil_crop ON best4soil_crop_agent_risk(crop_latin_name);
        CREATE INDEX IF NOT EXISTS idx_best4soil_agent ON best4soil_crop_agent_risk(agent_name);
        CREATE INDEX IF NOT EXISTS idx_gbif_query ON gbif_crop_taxon_matches(query_name);

        CREATE VIEW crop_catalog_seed AS
        SELECT DISTINCT
            b.crop_latin_name,
            b.crop_common_name,
            g.family,
            g.genus,
            g.species,
            g.usage_key AS gbif_usage_key,
            g.confidence AS gbif_confidence
        FROM best4soil_crop_agent_risk b
        LEFT JOIN gbif_crop_taxon_matches g
          ON g.query_name = b.crop_latin_name
        WHERE b.crop_latin_name IS NOT NULL;

        CREATE VIEW fdc_core_food_nutrients AS
        SELECT
            f.fdc_id,
            f.description,
            f.data_type,
            NULL AS scientific_name,
            n.nutrient_id,
            nu.name AS nutrient_name,
            nu.unit_name,
            n.amount
        FROM fdc_foundation_food f
        JOIN fdc_foundation_food_nutrient n ON n.fdc_id = f.fdc_id
        LEFT JOIN fdc_foundation_nutrient nu ON nu.id = n.nutrient_id
        UNION ALL
        SELECT
            f.fdc_id,
            f.description,
            f.data_type,
            NULL AS scientific_name,
            n.nutrient_id,
            nu.name AS nutrient_name,
            nu.unit_name,
            n.amount
        FROM fdc_sr_legacy_food f
        JOIN fdc_sr_legacy_food_nutrient n ON n.fdc_id = f.fdc_id
        LEFT JOIN fdc_sr_legacy_nutrient nu ON nu.id = n.nutrient_id;

        CREATE VIEW IF NOT EXISTS chile_soilgrids_static_topsoil AS
        SELECT
            p.point_id,
            p.lon,
            p.lat,
            MAX(CASE WHEN v.property = 'phh2o' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS ph_h2o_0_5cm,
            MAX(CASE WHEN v.property = 'clay' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS clay_pct_0_5cm,
            MAX(CASE WHEN v.property = 'sand' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS sand_pct_0_5cm,
            MAX(CASE WHEN v.property = 'silt' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS silt_pct_0_5cm,
            MAX(CASE WHEN v.property = 'soc' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS soc_g_kg_0_5cm,
            MAX(CASE WHEN v.property = 'nitrogen' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS nitrogen_g_kg_0_5cm,
            MAX(CASE WHEN v.property = 'bdod' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS bulk_density_kg_dm3_0_5cm,
            MAX(CASE WHEN v.property = 'cec' AND v.depth_label = '0-5cm' AND v.value_type = 'mean' THEN v.converted_value END) AS cec_cmol_kg_0_5cm
        FROM chile_soilgrids_static_points p
        LEFT JOIN chile_soilgrids_static_values v ON v.point_id = p.point_id
        GROUP BY p.point_id, p.lon, p.lat;
        """
    )
    log(con, "indexes_views", "ok")


def main() -> None:
    con = connect()
    try:
        create_core_tables(con)
        register_sources(con)
        ingest_fooddata_central(con)
        ingest_best4soil(con)
        ingest_faostat_chile(con)
        ingest_soilgrids_metadata(con)
        ingest_gbif_taxonomy(con)
        create_indexes_and_views(con)
    finally:
        con.close()
    print(f"Database created: {DB_PATH}")


if __name__ == "__main__":
    main()
