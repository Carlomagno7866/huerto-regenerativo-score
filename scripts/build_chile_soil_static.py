from __future__ import annotations

import json
import math
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DB_PATH = DATA / "huerto_regenerativo.sqlite"
GEOJSON_PATH = DATA / "geoBoundaries_CHL_ADM0.geojson"

GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/CHL/ADM0/"
SOILGRIDS_QUERY = "https://rest.isric.org/soilgrids/v2.0/properties/query"

# A half-degree grid keeps the national layer small and free to host.
# The web can use nearest-neighbor lookup for first-pass garden planning.
GRID_STEP_DEGREES = 0.5

PROPERTIES = ["phh2o", "clay", "sand", "silt", "soc", "nitrogen", "bdod", "cec"]
DEPTHS = ["0-5cm", "5-15cm", "15-30cm"]
VALUES = ["mean", "Q0.05", "Q0.95"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def download_boundary() -> None:
    DATA.mkdir(exist_ok=True)
    if GEOJSON_PATH.exists() and GEOJSON_PATH.stat().st_size > 0:
        return
    meta = requests.get(GEOBOUNDARIES_API, timeout=30).json()
    url = meta["gjDownloadURL"]
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    GEOJSON_PATH.write_bytes(r.content)


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


def ring_bbox(ring: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def stepped_values(start: float, end: float, step: float):
    value = math.floor(start / step) * step
    while value <= end:
        yield round(value, 6)
        value += step


def generate_grid_points() -> list[tuple[float, float]]:
    download_boundary()
    gj = json.loads(GEOJSON_PATH.read_text(encoding="utf-8"))
    points = set()
    for feature in gj["features"]:
        for polygon in iter_polygons(feature["geometry"]):
            min_lon, min_lat, max_lon, max_lat = ring_bbox(polygon[0])
            for lat in stepped_values(min_lat, max_lat, GRID_STEP_DEGREES):
                for lon in stepped_values(min_lon, max_lon, GRID_STEP_DEGREES):
                    # Use cell centers, not grid intersections.
                    plon = round(lon + GRID_STEP_DEGREES / 2, 6)
                    plat = round(lat + GRID_STEP_DEGREES / 2, 6)
                    if min_lon <= plon <= max_lon and min_lat <= plat <= max_lat and point_in_polygon(plon, plat, polygon):
                        points.add((plon, plat))
    return sorted(points, key=lambda p: (p[1], p[0]))


def create_tables(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS chile_soilgrids_static_points (
            point_id INTEGER PRIMARY KEY AUTOINCREMENT,
            lon REAL NOT NULL,
            lat REAL NOT NULL,
            grid_step_degrees REAL NOT NULL,
            source TEXT NOT NULL,
            query_status TEXT,
            queried_at TEXT,
            UNIQUE(lon, lat, grid_step_degrees)
        );

        CREATE TABLE IF NOT EXISTS chile_soilgrids_static_values (
            point_id INTEGER NOT NULL,
            property TEXT NOT NULL,
            depth_label TEXT NOT NULL,
            value_type TEXT NOT NULL,
            raw_value REAL,
            converted_value REAL,
            target_unit TEXT,
            mapped_unit TEXT,
            d_factor REAL,
            FOREIGN KEY(point_id) REFERENCES chile_soilgrids_static_points(point_id)
        );

        CREATE INDEX IF NOT EXISTS idx_chile_soil_points_lat_lon
            ON chile_soilgrids_static_points(lat, lon);
        CREATE INDEX IF NOT EXISTS idx_chile_soil_values_point_property
            ON chile_soilgrids_static_values(point_id, property, depth_label);
        """
    )


def query_soilgrids(lon: float, lat: float) -> tuple[str, list[dict]]:
    params = {
        "lon": lon,
        "lat": lat,
        "property": PROPERTIES,
        "depth": DEPTHS,
        "value": VALUES,
    }
    r = requests.get(SOILGRIDS_QUERY, params=params, timeout=45)
    if not r.ok:
        return f"HTTP {r.status_code}", []
    rows = []
    for layer in r.json().get("properties", {}).get("layers", []):
        unit = layer.get("unit_measure") or {}
        d_factor = unit.get("d_factor") or 1
        for depth in layer.get("depths", []):
            label = depth.get("label")
            for value_type, raw_value in (depth.get("values") or {}).items():
                converted = None if raw_value is None else raw_value / d_factor
                rows.append(
                    {
                        "property": layer.get("name"),
                        "depth_label": label,
                        "value_type": value_type,
                        "raw_value": raw_value,
                        "converted_value": converted,
                        "target_unit": unit.get("target_units"),
                        "mapped_unit": unit.get("mapped_units"),
                        "d_factor": d_factor,
                    }
                )
    non_null = sum(1 for row in rows if row["converted_value"] is not None)
    return ("ok" if non_null else "ok_no_values"), rows


def build_static_soil_layer() -> None:
    points = generate_grid_points()
    con = sqlite3.connect(DB_PATH)
    try:
        create_tables(con)
        con.executemany(
            """
            INSERT OR IGNORE INTO chile_soilgrids_static_points(lon, lat, grid_step_degrees, source)
            VALUES (?, ?, ?, ?)
            """,
            [(lon, lat, GRID_STEP_DEGREES, "SoilGrids v2.0 point API") for lon, lat in points],
        )
        con.commit()

        point_rows = con.execute(
            """
            SELECT point_id, lon, lat
            FROM chile_soilgrids_static_points
            WHERE grid_step_degrees = ? AND query_status IS NULL
            ORDER BY point_id
            """,
            (GRID_STEP_DEGREES,),
        ).fetchall()
        for idx, (point_id, lon, lat) in enumerate(point_rows, 1):
            status, values = query_soilgrids(lon, lat)
            con.execute(
                "UPDATE chile_soilgrids_static_points SET query_status=?, queried_at=? WHERE point_id=?",
                (status, now(), point_id),
            )
            con.executemany(
                """
                INSERT INTO chile_soilgrids_static_values(
                    point_id, property, depth_label, value_type, raw_value,
                    converted_value, target_unit, mapped_unit, d_factor
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        point_id,
                        row["property"],
                        row["depth_label"],
                        row["value_type"],
                        row["raw_value"],
                        row["converted_value"],
                        row["target_unit"],
                        row["mapped_unit"],
                        row["d_factor"],
                    )
                    for row in values
                ],
            )
            if idx % 25 == 0:
                con.commit()
                print(f"{idx}/{len(point_rows)} points queried")
                time.sleep(0.4)
        con.commit()
        con.execute(
            """
            INSERT INTO api_portal_endpoints(name,provider,url,purpose,access_mode,last_checked_at,status,notes)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                "SoilGrids static Chile half-degree grid",
                "ISRIC",
                SOILGRIDS_QUERY,
                "One-time static soil layer for nearest-neighbor lookup in the web app",
                "Precomputed API cache",
                now(),
                "ok",
                f"{len(point_rows)} Chile grid points at {GRID_STEP_DEGREES} degrees",
            ),
        )
        con.execute(
            "INSERT INTO ingestion_log(step,status,rows,message,created_at) VALUES (?,?,?,?,?)",
            ("chile_soilgrids_static", "ok", len(point_rows), f"{GRID_STEP_DEGREES} degree grid", now()),
        )
        con.commit()
    finally:
        con.close()
    print(f"Static Chile soil layer added to: {DB_PATH}")


if __name__ == "__main__":
    build_static_soil_layer()
