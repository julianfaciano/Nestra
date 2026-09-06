# Sprint de performance de nesting

## Ejecución reproducible

Desde la raíz: `node scripts/benchmark-nesting.mjs` (usa Vite instalado; no agrega dependencias).
El script ejecuta 582 piezas en Calandra 1480 × 5000 mm, scanStep 10 mm, con rotaciones front [0, 90, -90, 180] y back [0, 180]. Imprime tiempo y diagnostics. Verifica todos los pares de polígonos y canvas fuera del tiempo medido. Fixtures sintéticos, no los polígonos del pedido real de 291 prendas.

Medición local de referencia:

| Métrica                     | 582 cuadrados 100 × 100 | 582 piezas textiles sintéticas (8 vértices) |
| --------------------------- | ----------------------: | ------------------------------------------: |
| Tiempo motor (ms)           |                  186.53 |                                      287.26 |
| candidatePlacementsTested   |                    3232 |                                       12904 |
| polygonTransforms           |                       4 |                                           4 |
| polygonTranslations         |                    3068 |                                        9540 |
| broadPhaseChecks            |                   20165 |                                       21169 |
| exactPolygonCollisionChecks |                    2486 |                                        8958 |
| layoutsCreated              |                       1 |                                          19 |
| placedCount                 |                     582 |                                         582 |
| candidateCacheHits          |                  575120 |                                     2055488 |
| unplaced                    |                       0 |                                           0 |

Para cuadrados, el bucle anterior probaría exactamente 52.892.202 candidatos: se calcula analíticamente a partir de 14 cuadrados por fila, 149 posiciones X por fila de grilla y las rotaciones de cada instancia. No es un tiempo medido del motor anterior. El nuevo motor valida 3232 candidatos (más de 16.000 veces menos); incluyendo accesos a rechazos cacheados, procesa 578.352 alternativas (unas 91 veces menos). CI exige una reducción de al menos 100 veces en candidatos validados y checks exactos para la variante de cuatro rotaciones, sin umbrales de tiempo.

## Algoritmo

Antes: orden estable por área AABB, primera posición válida al recorrer Y/X cada 10 mm y rotaciones en orden del input. Cada candidato rotaba y normalizaba todos los vértices, obtenía bounds y recorría las piezas colocadas. Un layout fallido podía recorrer los cinco metros completos.

Ahora se mantiene el orden estable por área y el orden de rotaciones. Por valor exacto de las coordenadas se cachea geometría dentro de cada ejecución, incluyendo instancias con arrays distintos. Cada rotación se normaliza una sola vez. Se conservan bounds/dimensiones y se trasladan los vértices precalculados. Se descartan variantes que no caben antes de buscar layouts.

Los candidatos cruzan coordenadas de límites AABB de las piezas colocadas, sus alineaciones con el ancho/alto de las variantes, el origen y el límite derecho del canvas. Floor/ceil normalizan a scanStep sin relajar las comprobaciones geométricas. Se prueban por Y ascendente, X ascendente y orden de rotación. Y sólo llega al alto usado redondeado hacia arriba: por encima ya existe una fila sin obstáculos. No hay fallback a grilla exhaustiva.

Un índice de buckets de 200 mm devuelve vecinos; incluye celdas de frontera para no perder contactos. Se deduplican vecinos, se comprueba área AABB positiva con la tolerancia existente, y sólo entonces se ejecuta el mismo algoritmo poligonal anterior con bounds precalculados. Cada aceptación comprueba el polígono trasladado contra el canvas. No hay simplificación de polígonos ni aceptación basada únicamente en AABB.

Los rechazos de una variante/posición se conservan por layout. Sólo se cachean resultados inválidos: añadir piezas no puede hacer válida una colisión anterior. Las posiciones aceptadas se vuelven a comprobar al intentar otra instancia. Los caches se liberan al terminar la ejecución y no forman parte del resultado.

## Diagnostics e interfaces

`MultiNestingResult.diagnostics` es aditivo y opcional en el tipo para mantener consumidores que construyen resultados. El motor lo devuelve siempre. Worker y cliente ya transmiten el resultado completo y no requieren cambios.

- `candidatePlacementsTested`: posiciones/rotaciones efectivamente validadas, incluidas las rechazadas por canvas; excluye hits de caché.
- `polygonTransforms`: rotaciones/normalizaciones completas por geometría y rotación.
- `polygonTranslations`: polígonos trasladados para candidatos que pasan bounds.
- `broadPhaseChecks`: comparaciones AABB con vecinos únicos del índice.
- `exactPolygonCollisionChecks`: llamadas al detector poligonal tras pasar AABB.
- `candidateCacheHits`: alternativas omitidas por rechazo previo.
- `layoutsCreated`, `placedCount`: contadores finales.

`polygonsOverlap` conserva la llamada de dos argumentos y permite aportar bounds como tercero/cuarto; deben corresponder exactamente a sus polígonos. No cambia el algoritmo exacto ni las tolerancias previas.

## Tradeoffs y alcance

La selección de candidatos es una heurística bottom-left: puede cambiar posiciones, aprovechamiento y cantidad de canvases frente a la grilla exhaustiva, especialmente en huecos cóncavos cuyas posiciones útiles no provienen de estos límites. No garantiza packing óptimo ni la misma distribución. La seguridad de una posición aceptada sigue comprobándose con geometría completa.

El cruce de coordenadas puede crecer mucho con geometrías heterogéneas; el caché aporta más cuando hay repetición. El detector exacto existente conserva su costo cuadrático en vértices y sus tolerancias numéricas. Los nuevos caches consumen memoria proporcional a geometrías, piezas y posiciones rechazadas por layout. No se infiere un tiempo para el pedido real sin sus polígonos.

No se modifican reglas de front/back, límites de perfiles, UI ni exportador PNG. El motor de una sola pieza se mantiene sin cambios.

## Validación

Tests agregados: touching axial y diagonal, overlap positivo, equivalencia de colisión con bounds, polígonos vacíos, rotaciones y origen desplazado, geometrías cóncavas/fraccionales entre buckets, todos los pares del batch de 582, múltiples canvases, imposibles, determinismo, reutilización entre arrays distintos, independencia del alto no usado y serialización de diagnostics.

Resultados finales:

- `npm run typecheck`: exit 0, sin errores.
- `npm run lint`: exit 0, sin errores ni warnings. Se corrigió un `no-undef` inicial del script importando `process` desde `node:process`.
- `npm test`: exit 0; 20 archivos, 111 tests aprobados; duración reportada 5.24 s.
- `node scripts/benchmark-nesting.mjs`: exit 0; ambos fixtures con `exactSafetyVerified: true`.
