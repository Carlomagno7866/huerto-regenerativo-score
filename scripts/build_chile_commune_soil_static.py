from __future__ import annotations

import argparse
import json
import math
import sqlite3
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DB_PATH = DATA / "huerto_regenerativo.sqlite"
REGIONS_GEOJSON_PATH = DATA / "geoBoundaries_CHL_ADM1.geojson"
COMMUNES_GEOJSON_PATH = DATA / "geoBoundaries_CHL_ADM3.geojson"

GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/CHL/{adm}/"
SOILGRIDS_QUERY = "https://rest.isric.org/soilgrids/v2.0/properties/query"

PROPERTIES = ["phh2o", "clay", "sand", "silt", "soc", "nitrogen", "bdod", "cec"]
DEPTHS = ["0-5cm", "5-15cm", "15-30cm"]
VALUES = ["mean", "Q0.05", "Q0.95"]
API_DONE_PREFIXES = ("ok", "ok_no_values")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(value: str) -> str:
    value = fix_text(value)
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    chars = [c.lower() if c.isalnum() else "-" for c in normalized]
    return "-".join(part for part in "".join(chars).split("-") if part)


def fix_text(value: str) -> str:
    try:
        return value.encode("latin1").decode("utf-8")
    except UnicodeError:
        return value


def download_boundary(adm: str, target: Path) -> dict:
    if target.exists() and target.stat().st_size > 0:
        return json.loads(target.read_text(encoding="utf-8"))
    meta = requests.get(GEOBOUNDARIES_API.format(adm=adm), timeout=30).json()
    url = meta["gjDownloadURL"]
    response = requests.get(url, timeout=90)
    response.raise_for_status()
    target.write_bytes(response.content)
    return response.json()


def iter_polygons(geometry: dict):
    kind = geometry["type"]
    coords = geometry["coordinates"]
    if kind == "Polygon":
        yield coords
    elif kind == "MultiPolygon":
        yield from coords
    else:
        raise ValueError(f"Unsupported geometry type: {kind}")


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-15) + xi
        if intersects:
            inside = not inside
        j = i
    return inside


def point_in_polygon(lon: float, lat: float, polygon: list) -> bool:
    outer = polygon[0]
    if not point_in_ring(lon, lat, outer):
        return False
    return not any(point_in_ring(lon, lat, hole) for hole in polygon[1:])


def point_in_geometry(lon: float, lat: float, geometry: dict) -> bool:
    return any(point_in_polygon(lon, lat, polygon) for polygon in iter_polygons(geometry))


def geometry_bbox(geometry: dict) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for polygon in iter_polygons(geometry):
        for point in polygon[0]:
            xs.append(point[0])
            ys.append(point[1])
    return min(xs), min(ys), max(xs), max(ys)


def ring_area_and_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    area = 0.0
    cx = 0.0
    cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[i + 1][0], ring[i + 1][1]
        cross = x0 * y1 - x1 * y0
        area += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    area *= 0.5
    if abs(area) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return area, cx / (6 * area), cy / (6 * area)


def representative_point(geometry: dict) -> tuple[float, float]:
    polygons = list(iter_polygons(geometry))
    polygon = max(polygons, key=lambda p: abs(ring_area_and_centroid(p[0])[0]))
    _, lon, lat = ring_area_and_centroid(polygon[0])
    if point_in_polygon(lon, lat, polygon):
        return round(lon, 6), round(lat, 6)
    # Some coastal and island communes have centroids outside the shape. Use an
    # existing vertex as a stable representative point for SoilGrids lookup.
    vertex = polygon[0][max(0, len(polygon[0]) // 2)]
    return round(vertex[0], 6), round(vertex[1], 6)


def query_soilgrids(lon: float, lat: float) -> tuple[str, dict[str, float | None]]:
    params = {
        "lon": lon,
        "lat": lat,
        "property": PROPERTIES,
        "depth": DEPTHS,
        "value": VALUES,
    }
    response = requests.get(SOILGRIDS_QUERY, params=params, timeout=45)
    if not response.ok:
        return f"HTTP {response.status_code}", {}
    values: dict[str, float | None] = {}
    for layer in response.json().get("properties", {}).get("layers", []):
        unit = layer.get("unit_measure") or {}
        d_factor = unit.get("d_factor") or 1
        prop = layer.get("name")
        for depth in layer.get("depths", []):
            label = depth.get("label")
            for value_type, raw_value in (depth.get("values") or {}).items():
                key = f"{prop}_{label}_{value_type}".replace("-", "_")
                values[key] = None if raw_value is None else raw_value / d_factor
    non_null = sum(1 for value in values.values() if value is not None and math.isfinite(value))
    return ("ok" if non_null else "ok_no_values"), values


def nearest_existing_soil(con: sqlite3.Connection, lat: float, lon: float) -> dict:
    row = con.execute(
        """
        SELECT *
        FROM chile_soilgrids_static_topsoil
        WHERE ph_h2o_0_5cm IS NOT NULL
        ORDER BY ((lat - ?) * (lat - ?) + (lon - ?) * (lon - ?))
        LIMIT 1
        """,
        (lat, lat, lon, lon),
    ).fetchone()
    return dict(row) if row else {}


def create_tables(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS chile_admin_regions (
            region_slug TEXT PRIMARY KEY,
            region_name TEXT NOT NULL,
            centroid_lon REAL NOT NULL,
            centroid_lat REAL NOT NULL,
            source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chile_commune_soil_static (
            commune_slug TEXT PRIMARY KEY,
            commune_name TEXT NOT NULL,
            region_slug TEXT NOT NULL,
            region_name TEXT NOT NULL,
            representative_lon REAL NOT NULL,
            representative_lat REAL NOT NULL,
            soil_source TEXT NOT NULL,
            query_status TEXT NOT NULL,
            queried_at TEXT NOT NULL,
            ph_h2o_0_5cm REAL,
            clay_pct_0_5cm REAL,
            sand_pct_0_5cm REAL,
            silt_pct_0_5cm REAL,
            soc_g_kg_0_5cm REAL,
            nitrogen_g_kg_0_5cm REAL,
            bulk_density_kg_dm3_0_5cm REAL,
            cec_cmol_kg_0_5cm REAL,
            soil_locality_score REAL NOT NULL,
            FOREIGN KEY(region_slug) REFERENCES chile_admin_regions(region_slug)
        );

        CREATE INDEX IF NOT EXISTS idx_chile_commune_region
            ON chile_commune_soil_static(region_slug, commune_name);
        """
    )


def commune_soil_columns() -> str:
    return """
        commune_slug, commune_name, region_slug, region_name,
        representative_lon, representative_lat, soil_source, query_status, queried_at,
        ph_h2o_0_5cm, clay_pct_0_5cm, sand_pct_0_5cm, silt_pct_0_5cm,
        soc_g_kg_0_5cm, nitrogen_g_kg_0_5cm, bulk_density_kg_dm3_0_5cm,
        cec_cmol_kg_0_5cm, soil_locality_score
    """


def upsert_commune_soil(con: sqlite3.Connection, rows: list[tuple]) -> None:
    con.executemany(
        f"""
        INSERT INTO chile_commune_soil_static({commune_soil_columns()})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(commune_slug) DO UPDATE SET
            commune_name = excluded.commune_name,
            region_slug = excluded.region_slug,
            region_name = excluded.region_name,
            representative_lon = excluded.representative_lon,
            representative_lat = excluded.representative_lat,
            soil_source = excluded.soil_source,
            query_status = excluded.query_status,
            queried_at = excluded.queried_at,
            ph_h2o_0_5cm = excluded.ph_h2o_0_5cm,
            clay_pct_0_5cm = excluded.clay_pct_0_5cm,
            sand_pct_0_5cm = excluded.sand_pct_0_5cm,
            silt_pct_0_5cm = excluded.silt_pct_0_5cm,
            soc_g_kg_0_5cm = excluded.soc_g_kg_0_5cm,
            nitrogen_g_kg_0_5cm = excluded.nitrogen_g_kg_0_5cm,
            bulk_density_kg_dm3_0_5cm = excluded.bulk_density_kg_dm3_0_5cm,
            cec_cmol_kg_0_5cm = excluded.cec_cmol_kg_0_5cm,
            soil_locality_score = excluded.soil_locality_score
        """,
        rows,
    )


def map_soil_values(values: dict[str, float | None], fallback: dict) -> dict[str, float | None]:
    def value_or_fallback(key: str, fallback_key: str) -> float | None:
        value = values.get(key)
        return fallback.get(fallback_key) if value is None else value

    return {
        "ph_h2o_0_5cm": value_or_fallback("phh2o_0_5cm_mean", "ph_h2o_0_5cm"),
        "clay_pct_0_5cm": value_or_fallback("clay_0_5cm_mean", "clay_pct_0_5cm"),
        "sand_pct_0_5cm": value_or_fallback("sand_0_5cm_mean", "sand_pct_0_5cm"),
        "silt_pct_0_5cm": value_or_fallback("silt_0_5cm_mean", "silt_pct_0_5cm"),
        "soc_g_kg_0_5cm": value_or_fallback("soc_0_5cm_mean", "soc_g_kg_0_5cm"),
        "nitrogen_g_kg_0_5cm": value_or_fallback("nitrogen_0_5cm_mean", "nitrogen_g_kg_0_5cm"),
        "bulk_density_kg_dm3_0_5cm": value_or_fallback("bdod_0_5cm_mean", "bulk_density_kg_dm3_0_5cm"),
        "cec_cmol_kg_0_5cm": value_or_fallback("cec_0_5cm_mean", "cec_cmol_kg_0_5cm"),
    }


def soil_locality_score(row: dict[str, float | None]) -> float:
    ph = row.get("ph_h2o_0_5cm")
    clay = row.get("clay_pct_0_5cm")
    soc = row.get("soc_g_kg_0_5cm")
    nitrogen = row.get("nitrogen_g_kg_0_5cm")
    cec = row.get("cec_cmol_kg_0_5cm")
    ph_fit = 0.72 if ph is None else 1 - min(abs(ph - 6.4) / 2.8, 0.5)
    clay_fit = 0.72 if clay is None else 1 - min(abs(clay - 28) / 80, 0.3)
    organic_fit = 0.72 if soc is None else max(0.35, min(1, soc / 35))
    nitrogen_fit = 0.72 if nitrogen is None else max(0.35, min(1, nitrogen / 2.5))
    cec_fit = 0.72 if cec is None else max(0.35, min(1, cec / 20))
    return round(max(0.25, min(0.98, ph_fit * 0.38 + clay_fit * 0.18 + organic_fit * 0.24 + nitrogen_fit * 0.1 + cec_fit * 0.1)), 4)


def build_commune_soil_layer(query_api: bool = True) -> None:
    regions = download_boundary("ADM1", REGIONS_GEOJSON_PATH)
    communes = download_boundary("ADM3", COMMUNES_GEOJSON_PATH)

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        create_tables(con)
        con.execute("DELETE FROM chile_admin_regions")
        con.execute("DELETE FROM chile_commune_soil_static")

        region_rows = []
        indexed_regions = []
        region_features = regions["features"]
        for feature in region_features:
            name = fix_text(feature["properties"]["shapeName"])
            lon, lat = representative_point(feature["geometry"])
            min_lon, min_lat, max_lon, max_lat = geometry_bbox(feature["geometry"])
            indexed_regions.append(
                {
                    "feature": feature,
                    "name": name,
                    "slug": slug(name),
                    "lon": lon,
                    "lat": lat,
                    "bbox": (min_lon, min_lat, max_lon, max_lat),
                }
            )
            region_rows.append((slug(name), name, lon, lat, "geoBoundaries CHL ADM1"))
        con.executemany(
            """
            INSERT INTO chile_admin_regions(region_slug, region_name, centroid_lon, centroid_lat, source)
            VALUES (?, ?, ?, ?, ?)
            """,
            region_rows,
        )

        rows = []
        for index, feature in enumerate(communes["features"], 1):
            commune_name = feature["properties"]["shapeName"]
            commune_name = fix_text(commune_name)
            lon, lat = representative_point(feature["geometry"])
            bbox_matches = [
                r
                for r in indexed_regions
                if r["bbox"][0] <= lon <= r["bbox"][2] and r["bbox"][1] <= lat <= r["bbox"][3]
            ]
            region = next((r for r in bbox_matches if point_in_geometry(lon, lat, r["feature"]["geometry"])), None)
            if region is None:
                candidates = bbox_matches or indexed_regions
                region = min(candidates, key=lambda r: (r["lon"] - lon) ** 2 + (r["lat"] - lat) ** 2)
            region_name = fix_text(region["name"])
            region_slug = region["slug"]

            fallback = nearest_existing_soil(con, lat, lon)
            status, values = query_soilgrids(lon, lat) if query_api else ("nearest_grid", {})
            mapped = map_soil_values(values, fallback)
            source = "SoilGrids v2.0 commune representative point" if status.startswith("ok") else "Nearest existing SoilGrids Chile grid point"
            rows.append(
                (
                    slug(f"{region_name}-{commune_name}"),
                    commune_name,
                    region_slug,
                    region_name,
                    lon,
                    lat,
                    source,
                    status,
                    now(),
                    mapped["ph_h2o_0_5cm"],
                    mapped["clay_pct_0_5cm"],
                    mapped["sand_pct_0_5cm"],
                    mapped["silt_pct_0_5cm"],
                    mapped["soc_g_kg_0_5cm"],
                    mapped["nitrogen_g_kg_0_5cm"],
                    mapped["bulk_density_kg_dm3_0_5cm"],
                    mapped["cec_cmol_kg_0_5cm"],
                    soil_locality_score(mapped),
                )
            )
            if query_api and index % 25 == 0:
                print(f"{index}/{len(communes['features'])} communes queried")
                time.sleep(0.25)

        upsert_commune_soil(con, rows)
        con.execute(
            """
            INSERT INTO api_portal_endpoints(name,provider,url,purpose,access_mode,last_checked_at,status,notes)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                "SoilGrids static Chile communes",
                "ISRIC + geoBoundaries",
                SOILGRIDS_QUERY,
                "Commune-level static soil layer for Chile selector and crop optimization",
                "Precomputed API cache",
                now(),
                "ok",
                f"{len(rows)} communes from geoBoundaries ADM3, representative-point soil values",
            ),
        )
        con.execute(
            "INSERT INTO ingestion_log(step,status,rows,message,created_at) VALUES (?,?,?,?,?)",
            ("chile_commune_soil_static", "ok", len(rows), "commune representative SoilGrids layer", now()),
        )
        con.commit()
    finally:
        con.close()
    print(f"Commune soil layer added to: {DB_PATH}")


def status() -> None:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        create_tables(con)
        total = con.execute("SELECT COUNT(*) AS n FROM chile_commune_soil_static").fetchone()["n"]
        api_done = con.execute(
            """
            SELECT COUNT(*) AS n
            FROM chile_commune_soil_static
            WHERE query_status LIKE 'ok%'
            """
        ).fetchone()["n"]
        nearest = con.execute(
            "SELECT COUNT(*) AS n FROM chile_commune_soil_static WHERE query_status = 'nearest_grid'"
        ).fetchone()["n"]
        failed = con.execute(
            """
            SELECT COUNT(*) AS n
            FROM chile_commune_soil_static
            WHERE query_status NOT LIKE 'ok%' AND query_status <> 'nearest_grid'
            """
        ).fetchone()["n"]
        print(f"Total comunas: {total}")
        print(f"Consultadas SoilGrids API: {api_done}")
        print(f"Pendientes con grilla local: {nearest}")
        print(f"Fallidas o pendientes de reintento: {failed}")
        print()
        for row in con.execute(
            """
            SELECT query_status, COUNT(*) AS n
            FROM chile_commune_soil_static
            GROUP BY query_status
            ORDER BY n DESC, query_status
            """
        ):
            print(f"{row['query_status']}: {row['n']}")
        missing = con.execute(
            """
            SELECT COUNT(*) AS n
            FROM chile_commune_soil_static
            WHERE ph_h2o_0_5cm IS NULL OR clay_pct_0_5cm IS NULL OR soc_g_kg_0_5cm IS NULL
            """
        ).fetchone()["n"]
        print()
        print(f"Comunas con valores edaficos principales incompletos: {missing}")
    finally:
        con.close()


def row_to_fallback(row: sqlite3.Row) -> dict[str, float | None]:
    return {
        "ph_h2o_0_5cm": row["ph_h2o_0_5cm"],
        "clay_pct_0_5cm": row["clay_pct_0_5cm"],
        "sand_pct_0_5cm": row["sand_pct_0_5cm"],
        "silt_pct_0_5cm": row["silt_pct_0_5cm"],
        "soc_g_kg_0_5cm": row["soc_g_kg_0_5cm"],
        "nitrogen_g_kg_0_5cm": row["nitrogen_g_kg_0_5cm"],
        "bulk_density_kg_dm3_0_5cm": row["bulk_density_kg_dm3_0_5cm"],
        "cec_cmol_kg_0_5cm": row["cec_cmol_kg_0_5cm"],
    }


def pending_communes(
    con: sqlite3.Connection,
    limit: int,
    phase: int | None = None,
    total_phases: int | None = None,
    retry_failed: bool = False,
) -> list[sqlite3.Row]:
    where = "query_status = 'nearest_grid'"
    if retry_failed:
        where = "(query_status = 'nearest_grid' OR query_status NOT LIKE 'ok%')"
    rows = con.execute(
        f"""
        SELECT *
        FROM chile_commune_soil_static
        WHERE {where}
        ORDER BY region_name, commune_name
        """
    ).fetchall()
    if phase is not None and total_phases is not None:
        rows = [row for index, row in enumerate(rows) if index % total_phases == phase - 1]
    return rows[:limit]


def update_communes_from_api(
    limit: int = 25,
    phase: int | None = None,
    total_phases: int | None = None,
    retry_failed: bool = False,
    sleep_seconds: float = 0.35,
) -> None:
    if (phase is None) != (total_phases is None):
        raise ValueError("--phase y --total-phases deben usarse juntos")
    if phase is not None and (phase < 1 or total_phases is None or phase > total_phases):
        raise ValueError("--phase debe estar entre 1 y --total-phases")

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        create_tables(con)
        rows = pending_communes(con, limit=limit, phase=phase, total_phases=total_phases, retry_failed=retry_failed)
        if not rows:
            print("No hay comunas pendientes para esta fase.")
            return

        phase_label = f" fase {phase}/{total_phases}" if phase is not None else ""
        print(f"Consultando {len(rows)} comunas pendientes{phase_label}...")
        updated = 0
        failed = 0
        for index, row in enumerate(rows, 1):
            lon = row["representative_lon"]
            lat = row["representative_lat"]
            try:
                query_status, values = query_soilgrids(lon, lat)
            except requests.RequestException as exc:
                query_status = f"request_error:{type(exc).__name__}"
                values = {}
            mapped = map_soil_values(values, row_to_fallback(row))
            source = (
                "SoilGrids v2.0 commune representative point"
                if query_status.startswith(API_DONE_PREFIXES)
                else row["soil_source"]
            )
            con.execute(
                """
                UPDATE chile_commune_soil_static
                SET soil_source = ?,
                    query_status = ?,
                    queried_at = ?,
                    ph_h2o_0_5cm = ?,
                    clay_pct_0_5cm = ?,
                    sand_pct_0_5cm = ?,
                    silt_pct_0_5cm = ?,
                    soc_g_kg_0_5cm = ?,
                    nitrogen_g_kg_0_5cm = ?,
                    bulk_density_kg_dm3_0_5cm = ?,
                    cec_cmol_kg_0_5cm = ?,
                    soil_locality_score = ?
                WHERE commune_slug = ?
                """,
                (
                    source,
                    query_status,
                    now(),
                    mapped["ph_h2o_0_5cm"],
                    mapped["clay_pct_0_5cm"],
                    mapped["sand_pct_0_5cm"],
                    mapped["silt_pct_0_5cm"],
                    mapped["soc_g_kg_0_5cm"],
                    mapped["nitrogen_g_kg_0_5cm"],
                    mapped["bulk_density_kg_dm3_0_5cm"],
                    mapped["cec_cmol_kg_0_5cm"],
                    soil_locality_score(mapped),
                    row["commune_slug"],
                ),
            )
            con.commit()
            if query_status.startswith(API_DONE_PREFIXES):
                updated += 1
            else:
                failed += 1
            print(f"{index}/{len(rows)} {row['region_name']} - {row['commune_name']}: {query_status}")
            time.sleep(sleep_seconds)

        con.execute(
            "INSERT INTO ingestion_log(step,status,rows,message,created_at) VALUES (?,?,?,?,?)",
            (
                "chile_commune_soil_static_phase",
                "ok" if failed == 0 else "partial",
                updated,
                f"limit={limit}; phase={phase}; total_phases={total_phases}; failed={failed}",
                now(),
            ),
        )
        con.commit()
        print(f"Fase terminada: {updated} comunas consultadas, {failed} fallidas.")
    finally:
        con.close()


def repair_missing_from_grid() -> None:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        create_tables(con)
        rows = con.execute(
            """
            SELECT *
            FROM chile_commune_soil_static
            WHERE ph_h2o_0_5cm IS NULL OR clay_pct_0_5cm IS NULL OR soc_g_kg_0_5cm IS NULL
            ORDER BY region_name, commune_name
            """
        ).fetchall()
        if not rows:
            print("No hay comunas con valores principales incompletos.")
            return
        repaired = 0
        for row in rows:
            fallback = nearest_existing_soil(con, row["representative_lat"], row["representative_lon"])
            mapped = map_soil_values({}, fallback)
            con.execute(
                """
                UPDATE chile_commune_soil_static
                SET soil_source = ?,
                    ph_h2o_0_5cm = ?,
                    clay_pct_0_5cm = ?,
                    sand_pct_0_5cm = ?,
                    silt_pct_0_5cm = ?,
                    soc_g_kg_0_5cm = ?,
                    nitrogen_g_kg_0_5cm = ?,
                    bulk_density_kg_dm3_0_5cm = ?,
                    cec_cmol_kg_0_5cm = ?,
                    soil_locality_score = ?
                WHERE commune_slug = ?
                """,
                (
                    "SoilGrids API returned no values; nearest existing SoilGrids Chile grid point fallback",
                    mapped["ph_h2o_0_5cm"],
                    mapped["clay_pct_0_5cm"],
                    mapped["sand_pct_0_5cm"],
                    mapped["silt_pct_0_5cm"],
                    mapped["soc_g_kg_0_5cm"],
                    mapped["nitrogen_g_kg_0_5cm"],
                    mapped["bulk_density_kg_dm3_0_5cm"],
                    mapped["cec_cmol_kg_0_5cm"],
                    soil_locality_score(mapped),
                    row["commune_slug"],
                ),
            )
            repaired += 1
        con.execute(
            "INSERT INTO ingestion_log(step,status,rows,message,created_at) VALUES (?,?,?,?,?)",
            ("chile_commune_soil_repair_missing", "ok", repaired, "nearest grid fallback for null API values", now()),
        )
        con.commit()
        print(f"Comunas reparadas con respaldo de grilla local: {repaired}")
    finally:
        con.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Construye y actualiza suelo comunal estatico para Chile.")
    parser.add_argument("--init-nearest", action="store_true", help="Reconstruye comunas usando la grilla local ya cacheada, sin API.")
    parser.add_argument("--init-api", action="store_true", help="Reconstruye comunas consultando SoilGrids API en una sola corrida larga.")
    parser.add_argument("--run-next", action="store_true", help="Consulta el siguiente lote pendiente en SoilGrids API.")
    parser.add_argument("--status", action="store_true", help="Muestra avance por estado de consulta.")
    parser.add_argument("--limit", type=int, default=25, help="Cantidad maxima de comunas por corrida o fase.")
    parser.add_argument("--phase", type=int, help="Numero de fase a ejecutar, empezando en 1.")
    parser.add_argument("--total-phases", type=int, help="Total de fases en que se divide la corrida.")
    parser.add_argument("--retry-failed", action="store_true", help="Incluye estados fallidos en el lote pendiente.")
    parser.add_argument("--repair-missing", action="store_true", help="Repara valores edaficos nulos usando la grilla local.")
    parser.add_argument("--sleep", type=float, default=0.35, help="Pausa entre llamadas a SoilGrids, en segundos.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.status:
        status()
        return
    if args.repair_missing:
        repair_missing_from_grid()
        return
    if args.init_nearest:
        build_commune_soil_layer(query_api=False)
        return
    if args.init_api:
        build_commune_soil_layer(query_api=True)
        return
    if args.run_next or args.phase is not None:
        update_communes_from_api(
            limit=args.limit,
            phase=args.phase,
            total_phases=args.total_phases,
            retry_failed=args.retry_failed,
            sleep_seconds=args.sleep,
        )
        return
    status()


if __name__ == "__main__":
    main()
