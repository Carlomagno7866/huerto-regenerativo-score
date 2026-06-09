# Investigacion nutricional de especies del huerto regenerativo

Fecha de actualizacion: 2026-06-08

## Objetivo

Ampliar y depurar los datos nutricionales usados por el catalogo de cultivos del proyecto. La base ya contenia nutrientes USDA FoodData Central, pero el emparejamiento por texto permitia falsos positivos y dejaba especies sin datos cuando el nombre local, el nombre cientifico o una falta ortografica no coincidian con la descripcion alimentaria.

## Fuentes usadas

- USDA FoodData Central, especialmente SR Legacy y Foundation Foods, como fuente internacional principal de energia, proteina, fibra, vitaminas y minerales por 100 g.
- FAO/INFOODS Standards and Guidelines, como criterio metodologico para hacer food matching, distinguir matches directos, proxies y casos no comparables.
- FAO/INFOODS Chile y la Tabla de Composicion Quimica de Alimentos Chilenos de la Universidad de Chile, como respaldo nacional para nomenclatura y pertinencia local de alimentos chilenos.

## Criterio de curaduria

- `observed`: alimento equivalente o muy directo en USDA FDC, por ejemplo tomate crudo para `Lycopersicon esculentum`.
- `proxy`: alimento cercano cuando la especie del catalogo es amplia o no tiene entrada directa, por ejemplo melon cantalupo para `Cucumis melo`.
- `missing`: no se fuerza valor nutricional cuando no hay evidencia suficiente.
- `not-human-food-crop`: cultivo de servicio, forrajero, ornamental o no alimentario. Estos registros quedan disponibles para rotacion y resiliencia, pero no reciben nutrientes humanos inventados.

## Cambios principales

- Se agrego un mapa curado especie-alimento FDC para corregir y ampliar nutrientes en cultivos como cilantro, rucula, linaza, sandia, canonigo, salsifi negro, centeno, maiz, avena negra, mostaza blanca, trigo, triticale y ramtil.
- Se restringio el catalogo publico a cultivos pertinentes para huerta. Se excluyeron cultivos de servicio, forrajeros, ornamentales, cereales extensivos y especies poco realistas para el contexto del encargo.
- Se agregaron leguminosas alimentarias faltantes y trazables: poroto seco o granado (`Phaseolus vulgaris`), lenteja (`Lens culinaris`) y garbanzo (`Cicer arietinum`). Se mantienen poroto verde (`Phaseolus spp.`), arveja (`Pisum spp.`) y haba (`Vicia faba`) como leguminosas frescas de huerta.
- Se agrego magnesio como nutriente priorizable en la interfaz y se mantiene en `DAILY_TARGETS` del motor SCORE.
- Se corrigio el tratamiento de energia en USDA FDC: cuando aparece `Energy` en kcal y kJ, el SCORE usa solo `unit_name = KCAL` para evitar sobreestimar energia.
- Se actualizo haba desde `Beans, fava, in pod, raw` a `Broadbeans, immature seeds, raw`, que representa mejor la parte comestible fresca de huerta.
- Se corrigieron falsos positivos de matching textual:
  - `Secale cereale` ya no coincide con alimentos que contienen `fryers`.
  - `Scorzonera hispanica` ya no coincide con berries por el alias `black`.
  - `Lolium` ya no coincide con alimentos por `italian`.
  - `Zea mais` ya no coincide con `New Zealand`.
  - `Valerianella sp.` ya no cae en espinaca por el alias `sp`.
- Se bloqueo el uso de aliases demasiado genericos como `sp`, `spp`, colores y terminos descriptivos que contaminaban el match.
- Se regenero `data/derived/crop_evidence_profiles.json` con notas de metodo, calidad y fuente por cultivo.

## Resultado operativo

El SCORE nutricional ahora usa primero matches curados por `fdc_id` exacto y solo despues recurre al buscador textual. Esto aumenta la cobertura confiable y, sobre todo, evita que cultivos de cobertura o especies mal nombradas reciban nutrientes de alimentos no relacionados.

La rotacion usa un catalogo mas realista para huerta y tiene suficientes Fabaceae alimentarias para recomendar leguminosas aunque el usuario bloquee cultivos no pertinentes como vicia, treboles o canonigo.

## Ampliacion 2026-06-09

Se aumento el catalogo publico de 34 a 73 cultivos evaluables. La ampliacion abre cultivos alimentarios que ya estaban en la base oficial local o que fueron agregados como filas curadas con taxonomia, nombre local y `fdc_id` oficial. Se exigio que cada cultivo expuesto tuviera valores numericos para proteina, fibra, vitamina A, vitamina C, folato, calcio, hierro, zinc, potasio y magnesio. Los candidatos con perfiles incompletos en la copia local de FoodData Central quedaron fuera del catalogo publico, aunque su match curado puede conservarse para investigacion posterior.

Cultivos agregados o habilitados en esta revision incluyen acelga, aji verde, alcachofa, arveja china, brocoli, caupi, endivia, guandu, hierbabuena, hojas de mostaza, jicama, mani, menta piperita, okra, poroto mung, sesamo, taro, yuca, zapallo italiano, avena, cebada, trigo, arroz, centeno, sorgo, soya, lupino, linaza, maravilla, raps, mostaza blanca, trigo sarraceno, ruibarbo, chirivia, salsifi negro y otros cultivos alimentarios trazables.

Para nutricion se uso USDA FoodData Central local por `fdc_id` exacto. Para rendimiento se prioriza FAOSTAT Chile 2020-2024 cuando existe item directo; si no existe, se declara proxy FAOSTAT o estimacion por familia. Para agua/ciclo se mantienen rangos FAO Crop Water Needs por grupos agronomicos y se agregaron perfiles para hierbas culinarias, hojas de ciclo corto, raices/tuberculos tropicales, leguminosas ampliadas, alcachofa y okra.

Verificacion local: `npm.cmd test` confirma 73 cultivos, 19 familias botanicas y perfil nutricional completo para todos los cultivos expuestos.

## Referencias

- USDA FoodData Central. U.S. Department of Agriculture, Agricultural Research Service, Beltsville Human Nutrition Research Center. https://fdc.nal.usda.gov/
- FAO/INFOODS Standards and Guidelines. https://www.fao.org/infoods/infoods/standards-guidelines/en/
- FAO/INFOODS Food composition tables for Chile. https://www.fao.org/infoods/infoods/tables-and-databases/chile/en/
- Schmidt-Hebbel H., Pennacchiotti I., Masson L., Mella M. A. Tabla de composicion quimica de alimentos chilenos. Universidad de Chile, 1990. https://repositorio.uchile.cl/handle/2250/121427
- Ministerio de Salud de Chile. Composicion de alimentos y proyecto FAO/INFOODS para actualizar tablas de Argentina, Chile y Paraguay. https://www.minsal.cl/composicion-de-alimentos/
- INIA Chile. Arvejas y habas para consumo en fresco. https://biblioteca.inia.cl/items/2f7bcbb4-2f67-4a35-837f-d716ae2a9faa
- INIA Plan Predial. Ranking de hortalizas con fuente ODEPA; incluye arveja verde, haba y poroto verde. https://planpredial.inia.cl/ranking/
