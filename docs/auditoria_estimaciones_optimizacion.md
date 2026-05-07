# Auditoria de estimaciones y optimizacion

Fecha: 2026-05-06  
Proyecto: Huerto Regenerativo SCORE

## 1. Alcance auditado

Se reviso el flujo completo de seleccion Region -> Comuna -> suelo comunal -> optimizacion de cultivos. La base SQLite ahora contiene 16 regiones y 345 comunas de Chile en `chile_admin_regions` y `chile_commune_soil_static`. La pagina consulta `/api/locations` y envia `communeSlug` a `/api/optimize`; el backend recupera el suelo estatico comunal y modifica el subindice `soil` de cada cultivo.

La capa comunal fue construida con limites geoBoundaries ADM1/ADM3 y valores de SoilGrids. La consulta directa a SoilGrids se dividio en fases reanudables de 25 comunas. Resultado final: 345 comunas procesadas; 309 con valores directos `ok` y 36 con respuesta `ok_no_values`, conservando respaldo desde la grilla SoilGrids local. No quedan comunas pendientes ni valores edaficos principales incompletos.

## 2. Verificacion de diferencias comunales

Casos revisados contra `/api/optimize`:

| Escenario | Comuna | pH | SCORE suelo | SCORE medio | Primeros cultivos |
|---|---:|---:|---:|---:|---|
| Balance | Santiago | 6.8 | 91 | 82 | Betarraga, Tomate, Espinaca, Soya |
| Bajo riego | Arica | 8.1 | 58 | 81 | Espinaca, Betarraga, Tomate, Soya |
| Rotacion sana con Solanaceae previa | Temuco | 5.8 | 88 | 80 | Espinaca, Soya, Zanahoria, Facelia |

Resultado: el suelo ya genera diferencias entre comunas. Arica penaliza suelo por pH alcalino y menor carbono organico; Santiago y Temuco quedan mejor ajustadas. La diferencia se refleja en el subindice `soil` visible en las tarjetas.

## 3. Auditoria de reglas agronomicas

### Ciclos

El algoritmo respeta los dias de ciclo al calcular eficiencia por m2-dia y ventanas de cosecha simples. Sin embargo, las ventanas son reglas generales fijas: septiembre-octubre para siembra y enero-marzo para cosecha segun duracion. No incorporan clima comunal, heladas, grados-dia, estacion local ni disponibilidad de multiples ciclos por temporada.

Riesgo: una comuna extrema puede recibir un cultivo factible en SCORE pero mal calendarizado para su clima real.

Mejora prioritaria: agregar perfil agroclimatico por comuna o macrozona y validar meses aptos de siembra/cosecha por cultivo.

### Rotaciones

El algoritmo penaliza repetir familia y agentes sanitarios compartidos. En el escenario "Temuco con Solanaceae previa", no selecciono Solanaceae en el primer ano; recien aparece Tomate en ano 4 con rotacion 61/100 y advertencia sanitaria por agente compartido.

Resultado: la rotacion se respeta como penalizacion fuerte, pero no como restriccion dura. Esto es razonable para un ranking flexible, pero no suficiente si el usuario exige rotacion sanitaria estricta.

Mejora prioritaria: agregar modo "rotacion estricta" que bloquee familias antes de su intervalo recomendado, por ejemplo Solanaceae y Brassicaceae antes de 4 anos.

### Preferencias del usuario

Se probo `excludedCropNames: ["tomate", "papa"]`. La salida elimino ambos cultivos del ranking inicial. Las preferencias nutricionales si cambian el orden, pero de manera moderada: proteina/hierro, vitamina C/folato y energia mantienen varios cultivos en comun porque el rendimiento y la eficiencia siguen pesando bastante.

Resultado: bloqueos de cultivo funcionan como regla dura; prioridades funcionan como ponderacion, no como filtro.

Mejora prioritaria: permitir intensidad de preferencia: suave, media o estricta. En modo estricto, exigir que el cultivo aporte sobre un umbral al nutriente priorizado.

### Localidad del cultivo

La localidad afecta el subindice de suelo por comuna. Aun no existe una matriz cultivo-comuna especifica; todos los cultivos usan el mismo ideal general de pH/textura/carbono organico. Por eso Arica baja el suelo de todos los cultivos de forma parecida, en vez de favorecer cultivos tolerantes a alcalinidad/salinidad o penalizar sensibles.

Mejora prioritaria: crear `crop_soil_preferences` con rangos por cultivo o familia: pH minimo/optimo/maximo, textura preferida, sensibilidad a salinidad, tolerancia a suelos pesados y requerimiento de materia organica.

## 4. Aspectos a mejorar en estimaciones

1. Suelo comunal: densificar SoilGrids por comuna con 3-5 puntos por comuna grande, no solo un punto representativo o grilla cercana.
2. Clima: integrar macrozona, heladas, precipitacion y temperatura media estacional para ajustar calendario y factibilidad.
3. Agua: convertir `waterMmCycle` a demanda neta segun lluvia comunal y tipo de riego.
4. Ciclo: reemplazar ventanas genericas por ventanas por cultivo y zona.
5. Rendimiento: guardar perfil derivado por cultivo con fuente, item FAOSTAT, proxy y desviacion historica.
6. Nutricion: mejorar match USDA con alias en espanol/ingles y distinguir crudo, cocido, hoja, fruto, raiz y parte comestible.
7. Costos: conectar ODEPA o una tabla local de precios; hoy el subindice de ahorro usa proxies y lo reporta con baja confianza.
8. Sanidad: pasar de penalizacion por familia/agentes a restricciones configurables por severidad.
9. Biodiversidad: agregar cobertura minima de familias y servicios ecosistemicos por ano.
10. Incertidumbre: mostrar intervalos y confianza por cultivo, no solo un puntaje unico.

## 5. Recomendacion de optimizacion

El optimizador actual es util como recomendador multicriterio, pero todavia no debe presentarse como plan agronomico cerrado. La siguiente version deberia separar:

- restricciones duras: cultivos excluidos, familia bloqueada por rotacion estricta, ciclo fuera de temporada, incompatibilidad edafica severa;
- penalizaciones: baja confianza, uso de agua alto, agente sanitario compartido leve, preferencia nutricional secundaria;
- objetivos: nutrientes, bajo riego, ahorro, rotacion o balance.

Esto permitiria auditar cada seleccion con una razon clara: "fue elegido porque maximiza nutrientes" y "fue permitido porque cumple ciclo, rotacion y suelo".

## 6. Veredicto

El sistema ya diferencia comunas a nivel de suelo y usa esa diferencia en el diseno de cultivos. Tambien respeta cultivos bloqueados y penaliza rotaciones riesgosas. Aun falta convertir ciclos, rotaciones estrictas y preferencias fuertes en restricciones verificables. La brecha principal no esta en la interfaz, sino en la calidad agronomica de los perfiles por cultivo y comuna.
