# Instrumentación temporal del motor

Activada por defecto en `nesting-worker.ts`. El motor directo mantiene el perfil apagado;
`diagnosticProfiling: true/false` permite comparaciones y desactivarlo también en el Worker.
El resultado agrega `diagnostics.profile?`; los ocho contadores anteriores y sus valores
se conservan. El cliente transmite el resultado completo sin cambios. El panel muestra
un perfil por tela, sin promediar estimaciones entre geometrías diferentes.

## Pipeline y alcance

Batch extrae contornos, convierte a mm, expande instancias y agrupa por tela antes de
invocar un Worker por grupo. Esas etapas siguen usando las mediciones anteriores del
panel. Dentro del motor: validación, preparación/orden estable por área AABB, búsqueda
por layout, construcción X/Y, recorrido Y/X/rotación, rejection cache, bounds, traducción,
canvas, buckets, broad phase y colisión exacta; luego inserción y materialización del resultado.

No se modificaron scanStep, orden, variantes, tolerancias, touching, decisiones de búsqueda,
buckets, política del rejection cache ni operaciones geométricas. Se conserva el rechazo
AABB de segmentos. No se agregó caché histórica ni persistente.

## Tiempos (`profile.timings`)

Cada bloque expone `calls`, `samples`, `sampledMs` (suma observada) y `estimatedMs`.

| Bloque | Incluye |
| --- | --- |
| preparation | Serialización de geometría, lookup local, bounds, rotación/normalización, filtrado de variantes y orden estable de piezas |
| candidateCoordinates | Construcción de sets X/Y, floor/ceil, alineaciones y ordenamiento de ambos arrays |
| rejectionCache | Lookup/creación del Set por variante, Map.set existente, string de posición y Set.has; no Set.add de rechazos |
| candidateBounds | Construcción del objeto AABB por candidato no cacheado |
| candidatePolygon | map de todos los vértices para trasladar el polígono |
| canvasFit | polygonFitsInsideCanvas completo, incluido su recorrido getPolygonBounds |
| neighborLookup | Set de vecinos, generación de cellKeys, lookup de buckets e inserciones deduplicadas |
| boundsOverlap | boundsOverlapWithArea contra cada vecino visitado |
| polygonsOverlap | Llamada completa: AABB poligonal interno, recorrido de segmentos, AABB por par, intersección exacta, colinealidad y contención |

`totalMs`: tiempo de pared desde antes de validar hasta materializar el resultado.
Excluye crear/finalizar el perfil, postMessage y transporte. `workerMs` continúa siendo
el tiempo exterior completo de la llamada; no debe sumarse a los bloques.
`unclassifiedMs = totalMs - suma(estimatedMs)`, **con signo**: incluye control de loops,
rechazos/Set.add, inserciones de piezas e índice, salida, bookkeeping y error de muestreo.
GC, JIT y desalojo del hilo pueden caer en cualquier bloque; esto no es CPU del proceso
medida por el sistema operativo. No se recorta ni normaliza el residual para forzar 100%.

## Contadores exactos (`profile.counters`)

| Métrica | Definición |
| --- | --- |
| coordinateSets | Pares de sets X/Y construidos, uno por intento pieza/layout |
| xCoordinates / yCoordinates | Suma de tamaños únicos finales de X/Y; incluye el origen; no cantidad de intentos de Set.add ni producto cartesiano |
| rejectionCacheLookups | Alternativas X/Y/rotación consultadas, incluyendo hits |
| rejectionCacheHits | Hits, igual al candidateCacheHits existente |
| cellKeys / bucketLookups | Keys generadas y buckets consultados al buscar vecinos; excluye indexación de piezas aceptadas |
| neighborCandidates | Referencias recuperadas desde buckets, incluyendo repetidas |
| uniqueNeighbors | Tamaños de los sets deduplicados acumulados, incluso vecinos no visitados por early exit de colisión |
| neighborDuplicates | neighborCandidates menos uniqueNeighbors; no se agrega un Set.has extra |
| segmentPairs | Pares válidos efectivamente visitados antes de cualquier early exit |
| segmentAabbRejected | Pares rechazados por el AABB de segmentos existente |
| exactSegmentTests | Pares que llegan a segmentsProperlyIntersect; segmentPairs = segmentAabbRejected + exactSegmentTests |
| collinearTests | Llamadas a collinearEdgesCreateAreaOverlap tras no hallar intersección propia |
| pointInPolygonCalls | Llamadas reales, incluidas muestras de colinealidad y contención; respeta cortocircuitos && |

## Sampling y overhead

Preparación y coordenadas se cronometran completas. Los demás bloques muestrean
aproximadamente 1/128 llamadas, con hash determinista del ordinal y primera llamada
siempre medida. Cada bloque tiene su propio ordinal; no se altera el RNG ni el input.
Estimación = sampledMs × calls / samples. Se muestra la cobertura en el panel.
No hay closures ni asignaciones nuevas por operación del profiler. El estado es local
a la ejecución y de tamaño fijo. Hay llamadas a helpers/branches, incrementos y hash;
cuando se toma muestra hay dos consultas de reloj. El reloj no se consulta dentro del
loop de pares de segmentos ni dentro del loop de aristas de point-in-polygon.

No se atribuyen microsegundos separados a AABB/exacta/colinealidad/point-in-polygon:
son operaciones cortas y anidadas; cronometrarlas por par sesgaría precisamente el
hotspot buscado. Se entregan sus contadores exactos y el tiempo agregado de polygonsOverlap.
Los contadores sí tienen costo en ese loop. La primera muestra, resolución del reloj,
GC/JIT y correlación entre ordinal y geometría introducen sesgo/varianza: no usar las
estimaciones como una contabilidad exacta ni como tiempos netos sin instrumentación.

## Ejecución reproducible

`node scripts/benchmark-nesting-profile.mjs` ejecuta un fixture **sintético** de 96 piezas
con 96 vértices, IMPRENTA 1480 × 1000, step 10, rotaciones front/back. Calienta ambos modos,
alterna el orden on/off en seis rondas y compara todos los placements, polígonos, layouts,
unplaced y contadores anteriores. Imprime corridas individuales, medianas y último perfil.
También acepta una ruta a JSON `MultiNestingInput` preparado en mm de **una sola tela**.
El script usa Node/Vite, no simula transporte ni tiempos del Worker de WebView2.

Medición local 2026-09-05, Node 24.19.0: mediana sin perfil 1638,29 ms; con perfil
1746,09 ms; **+6,58%**. Es overhead incremental frente al mismo motor instrumentado con
perfil apagado, no frente al binario anterior. No extrapolar este porcentaje al batch real.
En la última corrida: total 1745,49 ms, polygonsOverlap estimado 1772,54 ms y residual
−191,42 ms. Esto evidencia error de muestreo; el residual negativo se conserva a propósito.
Se visitaron 101.410.772 pares de segmentos, de los cuales 101.380.521 fueron rechazados
por AABB; hubo 30.251 tests exactos, 14.984 tests colineales y 1.179.738 point-in-polygon.

El batch real de referencia (96 piezas, 11 layouts, ~7,5 s Worker) **no fue ejecutado**:
no se proporcionó su input geométrico. Para medirlo, repetir el batch en la app y leer
los perfiles por tela del panel. Comparar también los contadores anteriores suministrados
por el usuario: 410632 candidatos, 1051653 hits, 288685 traducciones, 427999 broad phase,
312937 colisiones exactas. Las mediciones nuevas ya están conectadas al Worker.

## Regresión y expectativas

`nesting-profiling-baseline.json` contiene SHA-256 del resultado completo, incluidos
contadores antiguos, obtenido con copias del motor y colisión **anteriores a la edición**.
Los tests comparan esos hashes en tres fixtures (582 cuadrados, 40 cóncavas fraccionales,
96 polígonos densos), comparan perfil on/off y repetición, y verifican canvas, rotaciones,
seguridad exhaustiva por pares, identidades de contadores y serialización. Sólo se excluye
el nuevo profile del chequeo de resultado anterior: sus tiempos no son deterministas.
El fixture denso tiene timeout de 20 s por ejecutar tres nestings más seguridad exhaustiva.
El test del Worker verifica activación por defecto y desactivación explícita.

Hipótesis hasta medir geometrías reales:

1. polygonsOverlap: producto de aristas y contención repetida, aun con rechazo AABB seguro.
2. Construcción/recorrido de candidatos y rejection cache: muchos hits evitan colisión,
   pero conservan iteraciones, strings y lookups; construcción X/Y se repite por layout.
3. Traducción y polygonFitsInsideCanvas: asignación de puntos y nuevo recorrido completo
   de vértices; los buckets/deduplicación compiten con este costo y también se miden.

## Validación ejecutada

- `npm run typecheck`: verde.
- `npm test -- --run src/geometry/nesting-performance.test.ts`: 10/10.
- Tests existentes de polygon-collision: 10/10; multi-piece-nesting-engine: 6/6.
- `npm test`: 23 archivos, 128 tests verdes (incluye regresión, Worker y preflight de tela/rotaciones).
- Benchmark on/off: 12 resultados completos iguales, más warmup; medición arriba.
- ESLint de los archivos nuevos y motor: verde. El panel conserva cinco reportes
  preexistentes de react-hooks/purity y react-hooks/refs en la medición de preflight
  dentro de useMemo/render; no se alteró ese mecanismo en esta tarea.

La suite completa inicialmente encontró un selector desactualizado en `App.test.tsx`
(`Biblioteca` frente al botón existente `BIBLIOTECA`); se corrigió solamente ese literal
del test, sin cambiar la navegación. La prueba densa inicialmente excedió 5 s y pasó
con el timeout específico de 20 s. No se relajaron assertions geométricas ni de resultado.
