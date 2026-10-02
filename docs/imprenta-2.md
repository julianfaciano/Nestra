# Imprenta 2: preparación productiva

Validación: 1 de octubre de 2026. Se preservaron los cambios previos de Home/versionado y los reportes de naming. No se modificó `.fanaticotas`, no se importó Biblioteca, no se borró IndexedDB y no se hizo commit/push.

## Perfil y dimensiones

Imprenta 2 usa **1560 × 5000 mm**, mostrado como **156 × 500 cm**. Perfil, validación, nesting, worker, preview y exportación comparten la configuración del dominio. Calandra e Imprenta conservan su ancho de 1480 mm y sus reglas anteriores; el orden del selector no cambia.

El raster productivo mantiene 300 PPI: 18425 px de ancho equivalen a 1559,983333 mm. Nesting reserva esa fracción inferior a un píxel para evitar recortes. El PDF recibe además el tamaño físico exacto: ancho **1560 mm**, con altura útil recortada al contenido, hasta **5000 mm**, como en el pipeline existente. Las coordenadas raster y el grosor no se reescalan para completar la fracción de ancho.

## Borde, separación y preflight

El borde es una capa derivada exclusiva de Imprenta 2. Se trazan los contornos alpha exteriores de cada componente, conservando threshold, rotaciones, pairing y geometría existentes. FRONT/BACK, reposiciones y free-PNG reciben la misma política. No se unen islas artificialmente ni se agregan bordes permanentes a los maestros o a Moldes.

- Negro `#000000`, opacidad 1, stroke **3 mm total**, centrado: **1,5 mm interior + 1,5 mm exterior**, con joins redondos.
- Hueco vacío visible mínimo: **3 mm**. Clearance entre siluetas alpha nominales: **6 mm**, derivado de `3 mm gap + 3 mm stroke`.
- Margen nominal mínimo contra izquierda, derecha, arriba y abajo: **1,5 mm**, más la reserva raster necesaria. Preflight rechaza cualquier recorte del stroke.
- Preview Canvas/SVG y PDF comparten contornos y medida física. PDF usa stroke vectorial negro de `3 × 72 / 25,4 = 8,503937 pt`, dibujado después del artwork. El raster nativo desactiva antialiasing del contorno negro; no altera los colores del artwork.
- Geometría y preflight mantienen los límites exactos: visible 2,999 mm / nominal 5,999 mm rechaza; 3,000 / 6,000 acepta; 3,001 / 6,001 acepta.

Los tests cubren cuatro bordes, una pieza que aprovecha el ancho mayor que 1480 mm, islas, concavidades, rotaciones, pairing, fillers y preflight. No se reescribió el optimizer ni se relajó clearance/scoring/geometría. El test raster legacy del triángulo se corrigió para usar un nombre de salida válido y ahora pasa.

## Moldes

/Moldes mantiene T1–T10 FRONT/BACK, naming y dimensiones estándar. Cada PNG generado incorpora únicamente **1–10**, blanco puro RGB 255, sin fondo/caja/sombra/borde/stroke. Antes de generar hay que confirmar que ambos maestros T8 no tengan ya un número; cambiar un maestro reinicia esa confirmación.

Se rasteriza el glifo, se mide su bbox de tinta visible y se recorta/reescala a **20 px de altura** a 72 PPI: **7,055556 mm**, error de cuantización **+0,055556 mm** respecto de 7 mm. Tanto `1` como `10` conservan esa altura; el ancho varía proporcionalmente. La máscara final es binaria y sólo escribe RGB blanco, sin modificar ningún byte de alpha del molde ya escalado.

Ubicación: primero centro inferior del bbox opaco. Se exige que todo el rectángulo del número y su margen de **6 px = 2,116667 mm** tengan alpha 255. Si no cabe, una tabla de sumas permite explorar posiciones interiores y elegir la más cercana; empates: fila inferior y después columna izquierda. Si no existe interior válido, ese output falla explícitamente antes de estamparlo. No cambia width/height, alpha bounds, transparencia, semántica física ni FRONT/BACK. Moldes no hornea el stroke láser.

16 tests específicos comprueban los 20 outputs, altura real, blanco puro, alpha idéntico, fallback, huecos/bordes semitransparentes y fallo seguro. Edge comprobó también generación y round-trip PNG de los 20 outputs sintéticos, con cero diferencias de alpha. No se generaron moldes sobre los originales del usuario.

## Pedido y Boca Quilmes

La fixture de tests contiene el pedido de hoy, sin insertarlo en la UI. Parser: **30 líneas, 638 prendas, 1276 piezas FRONT/BACK**, sin errores. El benchmark comparable comprobó que los slots solicitados existen en los metadatos auditados; esto no reemplaza el preflight final de Biblioteca sobre el batch real.

Preflight read-only de `C:\Users\julian\Documents\.fanaticotas\Boca\Boca Quilmes`: **22 PNG decodificados**, **20 canonical T1–T10**, todos los FRONT/BACK T1–T8 solicitados presentes, cero slots duplicados, dimensiones y alpha válidos. Los 20 hashes canonical coinciden con `asset-naming-audit.json`; los dos masters BOQ no tenían hash histórico comparable. Tamaños y mtimes coinciden con la auditoría usando tolerancia de 1 ms para evitar falsos cambios por representación decimal. Hash, bytes, fecha, dimensiones y alpha bounds de cada archivo están en `imprenta-2-preflight.json`.

**Los hashes no validan el azul.** Biblioteca/IndexedDB conserva snapshots Blob, no referencias vivas al filesystem. Antes de optimizar hay que reimportar idempotentemente `.fanaticotas` (preferido), o al menos Boca Quilmes, y revisar el azul visualmente en Nestra. No se ejecutó esa importación ni se tocaron datos de Biblioteca.

## Performance

Benchmark dirigido de 32 contornos sintéticos, warmup y mediana de tres ejecuciones:

| Métrica | Calandra | Imprenta 2 |
| --- | ---: | ---: |
| Required ms | 4419,715 | 5658,322 |
| Candidates | 85059 | 136494 |
| Broad | 172195 | 331864 |
| Exact | 114459 | 177186 |
| Layouts | 1 | 1 |
| UsedHeight mm | 3052,984 | 3082,984 |

Datos: `imprenta-2-benchmark.json`. Imprenta 2 tarda aproximadamente 1,28× Calandra en esta fixture; los contadores muestran más evaluación de candidatos/distancias, sin un perfil de CPU que permita atribuir todo el tiempo a una función.

Prueba comparable del pedido: **1276 piezas**, cantidades reales y dimensiones auditadas, siluetas sintéticas de 8 vértices. Se canceló limpiamente al límite de **90 s** (nesting medido **89,780 s**), con **592/1276 piezas** en fase REQUIRED. No había resultado final ni cantidad final de canvases disponible. No se dejó worker colgado. Este resultado no reproduce los contornos alpha reales ni constituye un layout listo para imprimir. Registro: `imprenta-2-production-benchmark.json`; runner: `scripts/benchmark-production-imprenta-2.mjs`.

## Validación y Release

- Tests dirigidos de perfil, geometría, preflight, preview y pedido: **80 aprobados**. Moldes: **16 aprobados**. Benchmark dirigido: **1 aprobado**.
- `npm run typecheck`: aprobado.
- `npm test -- --run --testTimeout=20000`: **487 aprobados, 10 omitidos**, 64 archivos aprobados y 5 omitidos.
- `npm run build`: aprobado.
- `cargo fmt --manifest-path .\src-tauri\Cargo.toml -- --check`: aprobado.
- `cargo check --manifest-path .\src-tauri\Cargo.toml --locked`: aprobado.
- `cargo test --manifest-path .\src-tauri\Cargo.toml --locked`: **31 aprobados, 4 diagnósticos/benchmarks manuales omitidos**, cero fallos; incluye PDF físico, stroke negro, dimensiones y escritura de Moldes.
- `git diff --check`: aprobado. `npm run build:windows`: aprobado (`tauri build --no-bundle`, compilación Rust Release 2 min 17 s).

Antes de producir quedan la reimportación de Biblioteca, la aprobación visual del azul y el preflight/preview del batch real y su PDF. El pedido completo todavía no tiene una medición final de nesting ni un PDF productivo exportado por esta tarea.

## Archivos de esta tarea

- Dominio y validación: `src/domain/canvas-profile.ts`, `src/domain/canvas-profile-validation.ts`, `src/domain/canvas-profile.test.ts`.
- Moldes: `src/app/molds-page.tsx`, `src/domain/molds-generation-browser.ts`, `src/domain/molds-generation-raster.ts`, `src/domain/molds-generation-raster.test.ts`.
- UI: `src/app/batch-page.tsx`, `src/app/free-png-batch.test.tsx`.
- Exportación y geometría: `src/export/export-plan.ts`, `src/export/native-png-export.ts`, `src/export/laser-outline.ts`, `src/export/imprenta-2.test.tsx`, `src/geometry/imprenta-2.test.ts`.
- Pedido: `src/test/production-order-2026-10-01.ts`, `src/domain/production-order.test.ts`.
- Rust: `src-tauri/src/native_png.rs`, `src-tauri/src/pdf_prototype.rs`, `src-tauri/src/png_export.rs`.
- Informes y benchmark: `docs/imprenta-2.md`, `docs/imprenta-2-benchmark.json`, `docs/imprenta-2-preflight.json`, `docs/imprenta-2-production-benchmark.json`, `scripts/benchmark-production-imprenta-2.mjs`.

Se compararon hashes de los 16 archivos con cambios previos y documentación de auditoría/versionado: todos preservados byte por byte. Los archivos package/Cargo, Home, theme, release-updates y release-notes siguen con sus cambios previos; no pertenecen a esta implementación.
## Release Windows verificado

EXE: `S:\Nestra\src-tauri\target\release\nestra.exe`, **9.529.344 bytes**, última escritura **2026-10-01 19:36:05.8709347 -03:00**. Se cerró la instancia anterior y se lanzó el nuevo Release. Verificación: **PID 21800**, proceso activo, **Responding=True**, título **Nestra**, handle de ventana 264970. No se generó instalador ni Release de GitHub.