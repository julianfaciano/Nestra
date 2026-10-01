# Imprenta 2: implementación y validación

Fecha: 30 de septiembre de 2026.

El código agrega Imprenta 2 como perfil productivo con límites de 1480 × 5000 mm. La especificación productiva corregida requiere un contorno negro centrado de 3 mm y 3 mm libres entre los bordes exteriores de dos contornos. Por eso el nesting y el preflight aplican 6 mm entre siluetas nominales. La UI de Producción exporta PDF; el renderer PNG queda como ruta legacy, aunque comparte el contrato `NativePlan` y su validación.

En la implementación inicial se comprobó master, checkout limpio y sincronización con origin/master en HEAD `d201030995e761f8e6952e4aa3b40c8ebc3231cd`. Esta corrección conserva los cambios existentes en el working tree; no crea commit ni altera la rama.

1. **Arquitectura del perfil.** `src/domain/canvas-profile.ts` centraliza id, nombre, dimensiones, separación, activación del contorno, ancho del contorno, color y configuración enviada al nesting. `CANVAS_PROFILES` alimenta el selector en el orden Calandra / Imprenta / Imprenta 2. Los perfiles anteriores conservan su configuración. La política se transmite dentro de `MultiNestingCanvas`; el worker ya transportaba ese objeto y no necesitó otro protocolo.

2. **Separación visible y distancia nominal.** `minimumVisibleGapMm = 3` y `laserCutOutlineWidthMm = 3` son las fuentes de verdad. Como las dos líneas están centradas, cada una aporta la mitad de su ancho al espacio compartido: `gap visible = distancia nominal - ancho total del stroke`. El mínimo nominal se deriva como `minimumVisibleGapMm + laserCutOutlineWidthMm = 6 mm`; no se codifica como un tercer valor. La búsqueda usa esos 6 mm para proponer y validar ubicaciones contra contornos reales.

3. **Definición exacta de distancia.** Distancia euclidiana mínima entre contornos exteriores nominales de corte. Cruces, contacto y contención entre siluetas llenas dan cero. Se consideran todos los pares de componentes de piezas diferentes. El rechazo compara con 6 mm nominales usando tolerancia `1e-9` mm. Preflight comunica tanto el hueco medido entre strokes como los 3 mm visibles exigidos.

4. **Borde del canvas.** Se reservan 1,5 mm para la mitad exterior del stroke en los cuatro bordes. El contorno negro completo queda dentro del perfil; los límites nominales utilizables descuentan 1,5 mm, además del pequeño redondeo raster de 300 DPI. El preflight bloquea cualquier exceso físico o raster. Los máximos del perfil siguen en 1480 × 5000 mm.

5. **Contorno negro.** Se extraen todos los contornos exteriores de alpha con el threshold actual y reducción collinear existente. Se conservan por separado como `cutComponents`, independientemente de la geometría fast/fine o del envelope conservador de una reposición. Cada isla produce una curva cerrada propia. No se dibujan rectángulos del source ni conexiones artificiales entre islas. No se trazan agujeros internos arbitrarios. Se usa negro `#000000` y uniones redondas.

6. **Grosor centralizado.** `LASER_CUT_OUTLINE_WIDTH_MM = 3` y `DEFAULT_IMPRENTA_2_PROFILE.laserCutOutlineWidthMm` están en `src/domain/canvas-profile.ts`. Canvas/SVG reciben el ancho en mm y el plan nativo en píxeles; PDF lo convierte a puntos con la escala de 300 DPI. Preview y PDF consumen la misma medida centralizada.

7. **Relación stroke/clearance.** El stroke centrado de 3 mm ocupa 1,5 mm hacia adentro y 1,5 mm hacia afuera. Con 6 mm entre siluetas nominales queda exactamente `6 - 3 = 3 mm` entre los bordes negros exteriores. Preview y PDF usan un stroke negro de 3 mm, centrado sobre la silueta.

8. **Garments.** FRONT/BACK conservan sus rotaciones, pairing, geometrías fast/fine y fórmulas de score. Imprenta 2 agrega la validación de distancia sobre los contornos completos. Los contornos se rotan alrededor del mismo anclaje físico del source placement. Hay un test de UI que comprueba FRONT/BACK, política del worker, selección del perfil, diagnóstico y preview negro.

9. **Reposiciones.** FRONT aislado, BACK aislado y dorsos personalizados siguen siendo reposiciones con semántica garment. El envelope conservador existente continúa reservado para nesting; los contornos de corte separados siguen las islas reales, incluyendo letras visibles. No se modifica el parser de nombres personalizados ni se convierten reposiciones en free-PNG.

10. **Free-PNG.** Conserva threshold, rotaciones y collisionComponents. Las islas distantes siguen separadas. La distancia se comprueba con cualquier otra pieza, y el contorno se exporta por isla. Los tests cubren islas cercanas, lejanas, huecos entre islas, concavidades, triángulos, curvas aproximadas y rotaciones.

11. **Fillers.** La fase de relleno recibe la misma política que REQUIRED. NORMAL y MAX respetan distancia y límites del stroke. OFF sigue omitiendo fillers. Los tests comprueban que no aumentan usedHeight ni crean layouts adicionales. No se cambian prioridades ni fórmulas de score.

12. **Preflight.** Conserva colisiones, required faltantes, identidad, pairing, tela, rotaciones y límites visibles. Agrega mensajes específicos con Canvas, identidad de las dos piezas, distancia medida y mínimo requerido. Detecta el contorno fuera del perfil y del ancho raster. Incluye el stroke en el envelope del plan de exportación. Valida también la configuración y los contornos suministrados.

13. **PNG legacy.** La UI de Producción no llama a `render_native_png`. El test `laser_triangle_is_black_not_a_source_rectangle_and_is_strip_invariant` sigue fallando antes del render con `Nombre o dimensiones PNG inválidos.` No se modificó ni se volvió a ejecutar en la validación PDF. No afecta la salida PDF; ambas rutas comparten los tipos y la validación del outline.

14. **PDF.** La UI llama `exportPdfPrototype`, que envía el plan compartido a `begin_pdf_prototype`, `upload_pdf_source` y `finish_pdf_prototype`. PDF importa `NativePiece`, `NativePlan` y `validate_outline` desde `native_png.rs`, pero no llama `render_native_png` ni consume su output. Rust dibuja las fuentes como XObjects con alpha y luego cada contorno vectorial cerrado. La prueba dirigida verifica trazo negro de `3 × 72 / 25,4 = 8,50394 pt`, join redondo, camino triangular independiente del rectángulo source y artwork antes del trazo.

15. **History y persistencia.** El estado de selección era local a BatchPage; no existía persistencia del id de perfil ni restauración de un batch completo desde History. History guarda métricas, piezas y archivos/previews. No se agregó un modelo nuevo. El constructor de previews históricos usa la misma pasada de contorno. Las pruebas existentes de History/persistencia pasaron en la suite completa. El perfil y su política sobreviven a la serialización que usa el worker. Para Imprenta 2 se recalculan los contornos alpha completos: el caché legacy sólo contiene fast/fine, sin todas las islas de corte.

16. **Umbrales exactos.** Tanto geometría como preflight verifican el hueco visible y su distancia nominal equivalente:

    | Gap visible | Siluetas nominales | Imprenta 2 |
    | ---: | ---: | --- |
    | 2,999 mm | 5,999 mm | Rechaza |
    | 3,000 mm | 6,000 mm | Acepta |
    | 3,001 mm | 6,001 mm | Acepta |

    Calandra e Imprenta mantienen contacto válido. También se verifica que el nesting del mismo input introduce separación al activar la política láser.

17. **Equivalencia legacy.** Pasaron los hashes existentes de squares, concave y dense, y las pruebas actuales de collision-components, required, fillers, PNG, PDF, origen físico y History. La capa de clearance queda desactivada con valores cero para los perfiles anteriores. No se cambiaron scoring, pairing, threshold, BVH, frontier ni fixes de source placement. Los tests nuevos de crop asimétrico verifican Imprenta 2 en 0°, 90°, -90° y 180°.

18. **Performance histórica.** Los datos guardados en `docs/imprenta-2-benchmark.json` corresponden al criterio anterior de 3 mm nominales y stroke de 0,3 mm; no representan ni validan la nueva distribución a 6 mm nominales. No se repitió el benchmark en esta corrección.

    | Métrica anterior | Calandra | Imprenta 2 |
    | --- | ---: | ---: |
    | Required ms | 4410,88 | 7514,82 |
    | Candidates | 85059 | 150506 |
    | Broad | 172195 | 363646 |
    | Exact | 114459 | 203160 |
    | Layouts | 1 | 1 |
    | UsedHeight nominal mm | 3052,984 | 3252,984 |

    Los números son históricos, anteriores al requisito vigente de stroke/gap de 3 mm.

19. **Archivos modificados y agregados.**

    - Perfiles: `src/domain/canvas-profile.ts`, `src/domain/canvas-profile-validation.ts`.
    - Geometría: `src/geometry/multi-piece-nesting-engine.ts`, `src/geometry/polygon-clearance.ts`, `src/geometry/polygon-collision.ts`, `src/geometry/nesting-input-capture.ts`.
    - UI y previews: `src/app/batch-page.tsx`, `src/app/batch-export-panel.tsx`, `src/app/historical-preview-builder.ts`.
    - Exportación: `src/export/export-plan.ts`, `src/export/laser-outline.ts`, `src/export/native-png-export.ts`, `src/export/png-export.ts`.
    - Renderers nativos y sus tests: `src-tauri/src/native_png.rs`, `src-tauri/src/pdf_prototype.rs`.
    - Tests TypeScript: `src/geometry/imprenta-2.test.ts`, `src/geometry/imprenta-2-benchmark.test.ts`, `src/export/imprenta-2.test.tsx`, `src/export/export-source-bounds.test.ts`, `src/export/native-png-export.test.ts`, `src/export/free-png-pdf.test.ts`, `src/app/free-png-batch.test.tsx`.
    - Fixture: `src/test/imprenta-2-fixture.ts`.
    - Informe y datos: `docs/imprenta-2.md`, `docs/imprenta-2-benchmark.json`.

20. **Validación de la corrección productiva.** Tests dirigidos de geometría, preflight, preview y crops: 42/42 aprobados. `npm run typecheck`: aprobado. `npm test -- --run --testTimeout=20000`: 403 aprobados y 10 omitidos. `npm run build`: aprobado. `git diff --check`: aprobado. `cargo fmt --manifest-path .\src-tauri\Cargo.toml -- --check` y `cargo check --manifest-path .\src-tauri\Cargo.toml`: aprobados. `cargo test --manifest-path .\src-tauri\Cargo.toml pdf_prototype::tests::`: 3/3 aprobados; no se ejecutó el renderer PNG legacy. No se generó Release ni se hizo commit o push.

21. **Validación manual / Release.** Esta corrección no genera ni abre un ejecutable Release. Queda pendiente inspeccionar en la app un PDF de un batch real de Imprenta 2; no se usaron assets del usuario en las pruebas automáticas.
