# Huerto Regenerativo SCORE

Aplicacion web para priorizar productos agricolas en huertos plurianuales. Usa la base SQLite local del proyecto y calcula un SCORE explicable con tres subindices:

- salida nutricional por superficie y ciclo;
- costo de recursos, especialmente agua y area-tiempo;
- resiliencia agronomica por rotacion sanitaria, diversidad y presencia de leguminosas.

## Ejecutar

```powershell
npm install
npm run dev
```

Abrir `http://127.0.0.1:3000`.

## Backend

- `GET /api/catalog`: lista cultivos candidatos desde `data/huerto_regenerativo.sqlite`.
- `POST /api/optimize`: devuelve el plan por ano y subparcela con SCORE, familia, ventanas y explicacion.

## Metodologia

El motor esta en `lib/score.ts`. Primero calcula nutricion, recursos y resiliencia por separado; despues combina los subindices con ponderaciones configurables desde la interfaz. El optimizador usa una heuristica plurianual con restricciones duras: evita repetir cultivos dentro del ano, respeta intervalos por familia cuando hay alternativas e incorpora leguminosas en la rotacion.

La capa de datos esta en `lib/db.ts`. La base SQLite incluye USDA FoodData Central, Best4Soil, FAOSTAT Chile, SoilGrids Chile y normalizacion taxonomica GBIF; la app expone un catalogo curado de cultivos de huerta.
