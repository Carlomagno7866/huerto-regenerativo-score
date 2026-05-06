# Huerto Regenerativo SCORE

Aplicacion web para priorizar productos agricolas en huertos plurianuales. Usa la base SQLite local del proyecto y calcula un SCORE explicable con tres subindices:

- salida nutricional por superficie y ciclo;
- costo de recursos, especialmente agua y area-tiempo;
- resiliencia agronomica por rotacion, diversidad y ajuste edafico.

## Ejecutar

```powershell
npm install
npm run dev
```

Abrir `http://127.0.0.1:3000`.

## Backend

- `GET /api/catalog`: lista cultivos candidatos desde `data/huerto_regenerativo.sqlite`.
- `GET /api/soil?lat=-33.45&lon=-70.66`: busca el punto SoilGrids Chile mas cercano.
- `POST /api/optimize`: devuelve el plan por ano y subparcela con SCORE, familia, ventanas y explicacion.

## Metodologia

El motor esta en `lib/score.ts`. Primero calcula nutricion, recursos, resiliencia y suelo por separado; despues combina los subindices con ponderaciones configurables desde la interfaz. El optimizador usa una heuristica plurianual: selecciona el mejor cultivo disponible por subparcela, evita repetir la misma especie dentro del ano y penaliza rotaciones de familias sensibles.

La capa de datos esta en `lib/db.ts`. La base SQLite incluye USDA FoodData Central, Best4Soil, FAOSTAT Chile, SoilGrids Chile y normalizacion taxonomica GBIF.
