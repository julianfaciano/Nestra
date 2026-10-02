# Imprenta 2 — resumen de performance

Fecha de medición: 2026-10-02. Los perfiles grandes usan exclusivamente los PNG reales del fixture y no escriben ni modifican los archivos fuente.

## Baseline histórico — 638 prendas / 1276 piezas

| Métrica | Resultado |
| --- | ---: |
| `totalPieces` | 1276 copias físicas |
| `logicalPieceTypes` | 372 combinaciones diseño+talle+lado |
| Pares diseño+talle FRONT/BACK | 186 |
| PNG fuente identificados por SHA-256 | 372 |
| `uniqueRealGeometries` | 217 |
| `uniqueGeometryRotationVariants` | 608 |

La identidad geométrica compara fast contour, fine contour, islas de corte y anchor después de convertirlos a milímetros. Las 372 fuentes produjeron 217 geometrías; no se usaron siluetas sintéticas para estas cifras. Esta tabla conserva la medición anterior al ajuste pedido por el usuario.

## Preparación read-only de assets

| Fase | Tiempo |
| --- | ---: |
| Leer PNG | 0,063 s |
| Decodificar PNG | 8,504 s |
| Bounds alpha | 0,911 s |
| Contornos fast/fine | 7,524 s |
| Componentes alpha | 3,126 s |
| Conversión a mm | 0,064 s |
| Preparación de rotaciones | 0,032 s |
| **Total medido** | **20,224 s** |

Los 372 PNG tuvieron hash distinto, así que no hubo cache hit de archivo. La deduplicación de 372 fuentes a 217 geometrías ocurrió tras derivar la geometría real.

## Comparación histórica de chunks — modo Rápida

Las tres variantes colocaron las 1276 piezas con geometría exacta. Los tiempos de 150/200 se midieron antes de compartir el cache de variantes entre chunks; el resultado de 100 se repitió después. La corrida compartida conservó los mismos 75 canvases, alturas, candidatos y validación del primer 100; su tiempo fue más lento en esa pasada, así que no atribuyo una mejora de wall time al cache.

| Tamaño de chunk | Nesting | Wall total del benchmark¹ | Canvases | Metros usados² | Diferencia vs. 100 | Validación |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 182,49 s | 284,66 s | 75 | 118,027 m | — | PASS |
| 150 | 227,48 s | 326,14 s | 67 | 115,961 m | −1,75% | PASS |
| 200 | 262,45 s | 363,76 s | 66 | 115,596 m | −2,06% | PASS |

¹ Incluye la auditoría exacta final independiente, que tomó aproximadamente 95–101 s; no forma parte del tiempo normal hasta obtener el layout. Sumando los 20,224 s medidos de preparación de assets, el preflight real más nesting de 100 fue aproximadamente **202,72 s (3 min 23 s)**. El layout queda disponible al terminar los **182,49 s de nesting**.

² Suma la altura real de cada layout hasta su contorno de corte más los 1,5 mm exteriores de stroke. La utilización aproximada fue 60,83% del rectángulo de ancho × altura usada; contra la capacidad completa de 5000 mm de los 75 canvases, 19,15%. El área se calcula sobre los contornos exteriores y no resta huecos alpha.

La estrategia productiva se fijó después en chunks de **150** para batches mayores a 150 piezas; los batches de hasta 150 van en una corrida. Los valores de 100/150/200 de esta tabla son la comparación histórica del pedido anterior.

## Chunks históricos de tamaño 100

Cada chunk cierra sus canvases anteriores y termina en el canvas parcial mostrado aquí. El JSON enlazado debajo contiene la altura de los 75 canvases individualmente.

| Chunk | Copias | Tiempo | Canvases (cerrados) | Último canvas: copias / altura usada |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1–100 | 5,05 s | 5 (4) | 13 / 414,6 mm |
| 2 | 101–200 | 16,35 s | 6 (5) | 7 / 236,1 mm |
| 3 | 201–300 | 11,65 s | 6 (5) | 2 / 205,4 mm |
| 4 | 301–400 | 15,23 s | 6 (5) | 6 / 236,1 mm |
| 5 | 401–500 | 10,02 s | 6 (5) | 1 / 205,1 mm |
| 6 | 501–600 | 7,53 s | 6 (5) | 5 / 205,1 mm |
| 7 | 601–700 | 14,24 s | 6 (5) | 8 / 238,9 mm |
| 8 | 701–800 | 12,22 s | 5 (4) | 17 / 683,1 mm |
| 9 | 801–900 | 6,70 s | 6 (5) | 7 / 205,1 mm |
| 10 | 901–1000 | 31,35 s | 6 (5) | 10 / 403,6 mm |
| 11 | 1001–1100 | 18,05 s | 6 (5) | 2 / 205,1 mm |
| 12 | 1101–1200 | 23,57 s | 6 (5) | 5 / 205,1 mm |
| 13 | 1201–1276 | 10,40 s | 5 (4) | 5 / 307,4 mm |

La capacidad vertical que queda libre en esos 13 finales parciales suma 61,23 m si se contaran como paneles fijos de 5000 mm. Es un límite superior de capacidad vacía, no metros de tela consumidos: exportación calcula la altura útil de cada layout y los 118,027 m ya suman esas alturas recortadas.

## Bottleneck y deduplicación

En la corrida final de 100:

- `candidatePlacementsTested`: 19.035.281; cache hits: 6.650.940 de 25.686.221 lookups.
- Broad phase: 27.836.807 checks; exact polygon collision: 18.028.083.
- Lookup de vecinos: 97.800.391 bucket lookups, 187.038.061 referencias candidatas, 66.321.500 vecinos únicos.
- Clearance index: 11.537 consultas; 114.406.390 candidatos/AABB y 7.451 tests exactos de segmentos.
- `polygonsOverlap` fue el mayor bloque estimado: 146,04 s de 182,36 s perfilados. El profiler estima bloques solapados; no deben sumarse como tiempos exclusivos.
- Reutilización final del batch: 608 transformaciones de variantes para las 608 variantes geométricas únicas y 1059 hits de identidad entre copias.
- Sin límite de candidatos alcanzado; no hay métrica de peak frontier implementada.

La búsqueda sin chunks se canceló a 180 s con 452/1276 piezas y sin layout final. El índice de segmentos mejoró un subconjunto real de 25 piezas de 4,62 s a 1,02 s; mantuvo 60.001 candidate attempts y, en la pasada indexada, hizo 136 tests exactos de segmentos frente a 1.725.882 checks AABB.

## Correctness histórica del layout real de 100

La auditoría independiente recorrió el output completo y pasó:

- 1276 IDs esperados y colocados; 0 duplicados, faltantes o inesperados.
- FRONT/BACK válido en 186 pares diseño+talle; rotaciones permitidas.
- Stroke exterior de 1,5 mm dentro del canvas efectivo raster-safe 1559,9833 × 4999,99 mm, derivado del perfil nominal 1560 × 5000 mm a 300 PPI.
- 10.946 pares quedaron fuera del clearance por lower bound AABB seguro; los 1.428 pares restantes se probaron contra contornos exactos: 0 violaciones de clearance de 6 mm.
- Equivale a stroke negro de 3 mm total y gap visible mínimo de 3 mm.

## Fixture definitivo — 641 prendas / 1282 piezas

Las tres prendas adicionales quedaron incorporadas al mismo pedido: Boca 2026 T3 +1, T5 +1 y T7 +1. Cada prenda agrega FRONT y BACK, así que el total pasa de 638/1276 a **641/1282**. Ningún otro diseño/talle cambió. Esto sólo actualiza cantidades del preflight; no agrega líneas comerciales ni ingresos.

| Métrica | Fixture definitivo |
| --- | ---: |
| `totalPieces` | 1282 copias físicas |
| `logicalPieceTypes` | 372 diseño+talle+lado |
| Pares diseño+talle FRONT/BACK | 186 |
| `uniqueRealGeometries` | 217 |
| `uniqueGeometryRotationVariants` | 608 |

Los assets/contornos siguen siendo los 372 PNG reales ya perfilados read-only. Agregar copias no agrega geometrías. Preparación anterior medida para esos 372 archivos: 20,224 s; no se volvió a decodificar ni modificar `.fanaticotas` para cambiar el fixture.

### Benchmark real de Rápida, chunk 150

| Medida | Resultado |
| --- | ---: |
| Nesting | 226,533 s |
| Benchmark completo con auditoría exacta offline | 327,580 s |
| Chunks | 8 × 150 + 1 × 82 |
| Canvases internos | 67 |
| Altura interna con stroke | 117,356678 m |
| Candidate placements | 26.064.173 |
| Rejection-cache hits | 6.773.703 |
| Broad-phase checks | 37.739.234 |
| Checks exactos de colisión | 24.709.621 |
| Índice clearance: consultas / AABB candidatos / segmentos exactos | 12.230 / 112.019.987 / 7.709 |
| Auditoría exacta offline: pares bbox omitidos / pares exactos | 11.918 / 1.487 |

La auditoría pasó con 1282/1282, 0 duplicadas, 0 faltantes, 0 inesperadas, 0 rotaciones inválidas, 0 clipping y 0 violaciones de clearance. Perfil efectivo raster-safe: 1559,9833 × 4999,99 mm a 300 PPI; stroke extent 1,5 mm y separación nominal mínima 6 mm. El benchmark CLI tarda 327,580 s porque agrega la auditoría independiente; ésta no corre en la ruta productiva.

| Chunk | Copias | Nesting | Canvases internos |
| ---: | ---: | ---: | ---: |
| 1 | 1–150 | 14,214 s | 8 |
| 2 | 151–300 | 27,693 s | 8 |
| 3 | 301–450 | 30,649 s | 8 |
| 4 | 451–600 | 13,632 s | 7 |
| 5 | 601–750 | 27,907 s | 8 |
| 6 | 751–900 | 15,157 s | 7 |
| 7 | 901–1050 | 51,853 s | 8 |
| 8 | 1051–1200 | 34,441 s | 8 |
| 9 | 1201–1282 | 10,862 s | 5 |

### Consolidación de strips y exportación

El flujo productivo apila los 67 canvases internos como strips inmutables con best-fit decreasing. El packing de las alturas reales dio **24 canvases finales** de ancho 1560 mm; ninguno supera 5000 mm. Suma interna: 117,356678 m. Suma final: **117,557678 m**. El costo físico de seams/márgenes suma 0,201 m (0,171%); cada unión conserva 3 mm visibles y 6 mm nominales, con 1,5 mm libres fuera del stroke arriba/abajo. La prueba de consolidación también cubre origen X distinto entre crops: se normaliza la coordenada de render a la hoja completa y se conserva `placement.x` del nesting.

La ruta de exportación/preview mostró un solo resultado con “Exportar 24 archivos”. El test PDF existente recorrió todos los canvases concatenados y conservó counts/metadata. Las alturas usadas para estimar y ejecutar el packing vienen de los 67 envelopes stroke-inclusive del benchmark real; el helper de producción hizo el best-fit decreasing sobre esas alturas.

### Reproducción de UI real: Web Worker → preflight → preview

Se ejecutó la estrategia rápida en un browser local con los contornos, componentes de clearance, anchors y rotaciones del perfil PNG real. Sólo las miniaturas eran SVG neutros; no se importó Biblioteca ni se usaron siluetas sintéticas para nesting.

| Métrica UI | Resultado |
| --- | ---: |
| Nesting Worker | 203,636 ms (worker 203,477 ms; overhead 159 ms) |
| Preflight + consolidación | 355,1 ms; 28 yields |
| Tarea máxima de finalización en main thread | 12,4 ms |
| Finalización → resultado visible | 33,4 ms |
| Tarea larga máxima observada durante la ruta | 115 ms |
| Mayor separación observada entre frames | 116,7 ms |
| Clics “UI activa” respondidos durante nesting | 3 |
| Canvases visibles/exportables | 24 |

El preflight anterior reportado por el usuario tardó 1.013.057,2 ms (~16 min 53 s). Se ejecutaba después del Worker en el main thread y volvía a recorrer todos los pares por canvas para colisión y clearance, incluidos componentes/contornos que el nesting ya había validado; no tenía broad-phase. En esta corrida real hay 13.405 pares dentro de los canvases internos; el camino anterior hacía dos recorridos geométricos completos sobre estos pares, antes del costo de comparar componentes/segmentos. Ahora el batch generado por nesting se certifica una sola vez, el preflight omite esa segunda auditoría exacta ya hecha por el Worker, y el camino de batches no certificados conserva barrido por Y + cotas AABB y test exacto sólo de pares próximos. Las invariantes de conteo, bounds, rotación y export siguen en preflight.

El preflight UI grande sintético usa las cantidades/372 tipos exactos, geometría rectangular explícitamente marcada como sintética, el motor rápido en chunks150 y el panel React. Midió 20,496 ms, máximo de tarea 8,005 ms, un yield y montó un solo canvas inicial. Métricas detalladas en [`imprenta-2-ui-preflight-1282.json`](imprenta-2-ui-preflight-1282.json) y reproducción Worker real en [`imprenta-2-ui-run-real-1282.json`](imprenta-2-ui-run-real-1282.json).

Comparado con el baseline 1276/chunk150 (227,480 s de nesting, 326,140 s de benchmark completo, 67 canvases y 115,961097 m), el run definitivo de 1282 quedó en 226,533 s/327,580 s y 67 canvases internos. Las diferencias temporales están dentro de la variación entre corridas; la altura interna aumenta 1,395581 m con las seis piezas añadidas. Tras consolidación, son 24 hojas y 117,557678 m.

Contra la medición del usuario anterior al fix (149,966 s de Worker + 1.013,057 s de preflight, 169,859 s antes del preflight), el Worker del browser nuevo fue 203,477 s —aprox. 35,7% más lento en esa comparación de corridas—, pero la finalización bajó de ~1013 s a 0,355 s. El resultado quedó visible 204,025 s después de iniciar el Worker; agregando los 18–20 s de preparación de assets medida en la corrida read-only, el flujo completo estimado queda en ~222–224 s frente a ~1183 s antes (aprox. 5,3× más rápido en total). El benchmark browser empieza con los contornos reales ya preparados; no incluye decodificación de PNG.

## Synthetic benchmark — separado del pedido real

Para 200 piezas con 22 geometrías sintéticas de 8 vértices: Rápida 4,68 s, 11 canvases y 17,955 m; Exprimir material 44,90 s, 4 canvases y 16,569 m. Rápida usó 8,37% más altura. Estas geometrías no se reportan como las geometrías reales del fixture.

El benchmark pequeño existente también se repitió al final. Usa 32 contornos sintéticos de 64 vértices, warm-up y mediana de 3 ejecuciones; no son PNG alpha del pedido.

| Perfil | Antes | Después | Layout hash |
| --- | ---: | ---: | --- |
| Calandra | 4,420 s | 4,717 s | Igual |
| Imprenta 2 | 5,658 s | 6,046 s | Igual |

La relación Imprenta 2/Calandra se mantuvo en ~1,28×. El benchmark corrió en sesiones distintas y el tiempo de ambos perfiles subió ~6,8% en esta última pasada; cantidades, candidatos y hash de layout confirman el mismo caso geométrico. Ver [`imprenta-2-benchmark-after.json`](imprenta-2-benchmark-after.json).

## UX, export y límites medidos

- Selector Rápida/Exprimir material exclusivo de Imprenta 2; Rápida default. Exprimir primero publica el layout rápido completo y conserva ese resultado al cancelar la pasada exhaustiva.
- Progreso de chunks continuo en un solo resultado multi-canvas.
- Test de export recorrió el renderer PDF existente con un harness de 201 piezas en 3 chunks: conservó cantidades, múltiples canvases y stroke; backend Tauri simulado en el test.
- El proceso Node del benchmark usó 1,23 GiB de heap al terminar la auditoría; se observó un working set Windows de aproximadamente 2,25 GB durante esa verificación. El segundo valor es una muestra, no un pico instrumentado.

## Validación y Release

- Tests dirigidos de bounds/Imprenta 2/PDF tras el ajuste de coordenadas: **38 PASS**; suite completa: **504 PASS, 10 SKIP**.
- `npm run typecheck`, `npm run build`, `git diff --check`, `cargo fmt --check`, `cargo check` y suite Rust: PASS (**31 PASS, 4 ignorados**).
- `npm run build:windows`: PASS. EXE `src-tauri/target/release/nestra.exe`, **9.534.976 bytes**.
- Nestra quedó activo: PID **3216**, `Responding=True`, ventana `Nestra`.
- No se hizo commit ni push.

## Artefactos detallados

- [`imprenta-2-real-production-1282-chunk150.json`](imprenta-2-real-production-1282-chunk150.json)
- [`imprenta-2-real-production-1282-consolidation.json`](imprenta-2-real-production-1282-consolidation.json)
- [`imprenta-2-ui-run-real-1282.json`](imprenta-2-ui-run-real-1282.json)
- [`imprenta-2-ui-preflight-1282.json`](imprenta-2-ui-preflight-1282.json)
- [`imprenta-2-real-production-chunked-100-shared-cache.json`](imprenta-2-real-production-chunked-100-shared-cache.json)
- [`imprenta-2-real-production-chunked-100.json`](imprenta-2-real-production-chunked-100.json)
- [`imprenta-2-real-production-chunked-150.json`](imprenta-2-real-production-chunked-150.json)
- [`imprenta-2-real-production-chunked-200.json`](imprenta-2-real-production-chunked-200.json)
- [`imprenta-2-real-geometry-profile.json`](imprenta-2-real-geometry-profile.json)
