# Base de datos inicial del proyecto

Archivo principal: `data/huerto_regenerativo.sqlite`

Constructor reproducible: `scripts/build_database.py`

## Fuentes ingestas

- USDA FoodData Central: Foundation Foods, SR Legacy, FNDDS, porciones, nutrientes y factores de retencion.
- Best4Soil: matriz cultivo-hospedante para nematodos y hongos, con estado hospedante y efectos de abonos verdes.
- FAOSTAT: produccion agricola/ganadera normalizada filtrada para Chile.
- SoilGrids: metadatos de propiedades edaficas consultables por coordenadas.
- SoilGrids Chile estatico: grilla nacional de 0.5 grados consultada una vez y guardada en SQLite.
- GBIF: normalizacion taxonomica de cultivos detectados en Best4Soil.

## Tablas principales

- `sources`: archivos locales y procedencia.
- `fdc_core_food_nutrients`: vista unificada de nutrientes USDA por alimento.
- `fdc_fndds_food`, `fdc_fndds_food_nutrient`, `fdc_fndds_food_portion`: alimentos de encuesta, nutrientes y porciones.
- `fdc_sr_legacy_retention_factor`: factores de retencion de nutrientes por preparacion.
- `best4soil_crop_agent_risk`: riesgo cultivo-agente para rotaciones y bioseguridad.
- `crop_catalog_seed`: catalogo inicial de cultivos con familia, genero, especie y clave GBIF cuando existe.
- `faostat_chile_crop_livestock_production`: rendimiento, area y produccion historica para Chile.
- `soilgrids_available_layers`: propiedades edaficas disponibles para autocompletado por latitud/longitud.
- `chile_soilgrids_static_points`: puntos de la grilla estatica de Chile.
- `chile_soilgrids_static_values`: propiedades SoilGrids por punto, profundidad y tipo de valor.
- `chile_soilgrids_static_topsoil`: vista simple de capa superficial 0-5 cm para busqueda rapida por punto cercano.
- `api_portal_endpoints`: endpoints usados o preparados para la futura aplicacion.
- `ingestion_log`: bitacora de cada paso de construccion.

## Reconstruccion

Ejecutar desde la carpeta raiz del proyecto:

```powershell
python .\scripts\build_database.py
```

La reconstruccion reemplaza la base SQLite y vuelve a procesar los archivos locales. Si falta el ZIP de FAOSTAT, el script lo descarga desde el portal oficial de FAOSTAT.

Para reconstruir o completar la capa estatica de suelos de Chile:

```powershell
python .\scripts\build_chile_soil_static.py
```

Esta capa no consulta SoilGrids durante el uso normal de la web. La consulta a SoilGrids ocurre solo al construir o actualizar la base. La web puede buscar el punto mas cercano en `chile_soilgrids_static_topsoil`.

## Consulta rapida

```sql
SELECT description, nutrient_name, amount, unit_name
FROM fdc_core_food_nutrients
WHERE lower(description) LIKE '%tomato%'
LIMIT 20;
```

```sql
SELECT crop_latin_name, crop_common_name, agent_type, agent_name, host_status
FROM best4soil_crop_agent_risk
WHERE lower(crop_common_name) LIKE '%potato%';
```

```sql
-- Ejemplo: suelo mas cercano a Santiago aproximado.
SELECT point_id, lon, lat, ph_h2o_0_5cm, clay_pct_0_5cm, sand_pct_0_5cm
FROM chile_soilgrids_static_topsoil
WHERE ph_h2o_0_5cm IS NOT NULL
ORDER BY ((lat - -33.45) * (lat - -33.45) + (lon - -70.66) * (lon - -70.66))
LIMIT 1;
```

## Limitacion de la capa estatica de suelo

La grilla es de 0.5 grados, aproximadamente decenas de kilometros. Es suficiente para una primera factibilidad nacional gratuita, pero no reemplaza un analisis local de suelo ni un muestreo de laboratorio. Para una version mas fina se puede densificar solo en las regiones objetivo.
