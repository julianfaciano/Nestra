# Reposición de dorsos editados — auditoría y entrega

Fecha: 30 de septiembre de 2026. Workspace: `S:\Nestra`.

Actualización: corregida la convención productiva real `nom`, incluyendo el nombre exacto `aanomFIRULAIS SLE_D_T4.png`. La primera ampliación sólo cubría nombres prefijados seguidos de un sufijo canónico; esa restricción quedó reemplazada por la regla indicada en la sección 3.

## 1. Cómo representaba Biblioteca los dorsos editados

La auditoría se realizó antes de editar código, con `rg`, lectura del parser, scanner, estado, persistencia, selector, preparación geométrica, preview y preflight, y revisión de los tests existentes.

`parseDesignAssetFilename` reconoce el formato legacy con secuencia validada (`ARG26E_0019_T10-DORSO.png`) y el formato humano con talle/lado terminales (`Adoptame T10 DORSO.png`). El modelo guarda `size`, `side`, `fileName`, `relativePath` y el `File` real. El nombre de colección viene de la carpeta o del nombre humano reconocido. Los maestros `00…(D).png` sólo proporcionan lado para preview: no tienen talle y no son elegibles como reposición por sí solos.

El scanner retenía un único asset por talle/lado. Otros assets reconocidos del mismo slot quedaban en `duplicateSlots`, sin guardar su PNG. Los nombres personalizados concretos ya documentados en los tests, `aanomBENJI ARG26E_0019_T10-DORSO.png` y `aanomCHICHA ARG26E_0009_T5-DORSO.png`, eran rechazados expresamente y terminaban en `ignoredFileNames`, también sin su PNG. No había metadata de variantes ni soporte específico para esos nombres. Por tanto, la premisa de que esos archivos ya se importaban/visualizaban no se cumple para ese formato en el código auditado; un archivo editado que conserva un nombre reconocido sí podía ocupar el slot normal.

## 2. Por qué no aparecían en Agregar reposición

El formulario llamaba a `findCollectionAsset(collection, size, side)`, que devolvía sólo el primer asset canónico. No había elección de source. Los duplicados y los personalizados rechazados no estaban almacenados como assets seleccionables. Un BACK canónico sin FRONT ya era admisible: el problema era conservar y seleccionar las variantes, no exigir un compañero.

La primera ampliación conservaba variantes pero su regex exigía `aanom…`, un espacio y el filename canónico completo con secuencia, talle y `-DORSO.png`. `aanomFIRULAIS SLE_D_T4.png` no tiene esa secuencia ni ese sufijo: tanto el parser canónico como el de reposición lo rechazaban y el scanner lo enviaba a `ignoredFileNames`. Por ello nunca alcanzaba la deduplicación de alternativas ni el dropdown. La corrección está en el parser y scanner, no en la UI.

## 3. Cambio implementado

Se añadió `replacementAssets` como lista opcional de assets adicionales de Biblioteca, con el mismo modelo de archivo, talle y lado. No duplica nombres estampados ni crea entidades de prenda. El scanner conserva allí los dorsos duplicados reconocidos y cualquier PNG cuyo basename contenga `nom`, case-insensitive, y tenga un talle identificable. No exige prefijo, secuencia, token DORSO ni FRONT compañero. El lado se fija a BACK por la convención explícita del usuario.

El talle se lee como token `T` seguido de dígitos, delimitado por inicio/final, espacio, guion o underscore. Se valida contra los talles existentes T1–T10. Se rechazan T0, T04, T11, T40, números incrustados sin delimitador y combinaciones con talles conflictivos. T4 y T10 conservan su valor completo. No se extrae un diseño desde el filename personalizado: se mantiene la asociación a la carpeta de Biblioteca, en el caso real `San Lorenzo Escudo`.

El parser canónico no cambia. El scanner intercepta primero los archivos `nom` y evita que ocupen un slot de garment, incluso si el resto del nombre parece canónico o dice FRENTE. Standard y personalizado coexisten, independientemente del orden de lectura de la carpeta. El reader nativo conserva todos los PNG y sus rutas; importar y actualizar usan el mismo `buildDesignCollection`/scanner corregido. Se verificaron ambos flujos mediante sus comandos nativos mockeados, sin intervenir la Biblioteca del usuario.

`findCollectionReplacementAssets` reúne los assets canónicos y adicionales del talle/lado elegido, valida los valores conocidos y elimina repeticiones de ruta. Los assets adicionales se persisten con sus blobs, con validación de BACK, talle y ruta; las bibliotecas antiguas sin el campo continúan cargando.

## 4. Side, talle, source e invalidación

Al agregar se busca la ruta específica elegida dentro de la colección/talle/lado y se captura su `File`. El draft toma `size` y `side` del asset. La definición, URL del preview, lectura alfa, geometría y preflight/export proceden de ese mismo archivo. No se vuelve a resolver el PNG por slot ni se sustituye por el BACK estándar durante la optimización.

La pieza conserva `kind = replacement-piece`, es required e independiente, admite cantidad mayor a uno, no exige FRONT, tiene únicamente rotaciones 0/180 cuando es BACK, se cuenta como REPOSICIÓN y no como PRENDA. Comparte grupo con garments y free-PNG de la misma tela. Cambiar cantidad/tela o eliminar conserva la invalidación ya existente; eliminar libera la URL.

## 5. Ruta garment y performance

Se mantienen fast/fine y el caché de contornos. El worker recibe `kind = garment`, dos rotaciones para BACK y ningún `collisionComponents`. La ampliación no modifica el motor, scoring, orden de candidatos, fillers, BVH/frontier, threshold alfa, semántica free-PNG, History ni implementación PDF.

## 6. Geometría del archivo editado y contenido visible

El caché existente ya identifica el contenido mediante SHA-256, parámetros alfa/simplificación y dimensiones físicas. Se añadió un modo de geometría a la clave de reposición, para evitar cargar pares antiguos calculados con la regla de la isla más grande. Dos archivos con el mismo nombre pero bytes diferentes tienen claves diferentes; renombrar o compartir talle/lado no hace que se use la geometría del BACK estándar.

Fast/fine y `sourceAlphaBounds` se calculan leyendo el PNG seleccionado. Cuando la reposición tiene varias islas alfa externas, se reserva un único rectángulo conservador que contiene todos sus píxeles visibles. Ese polígono alimenta fast/fine y `sourcePlacementBounds` toma los bounds alfa completos. Así se conserva un nombre desconectado que sobresale de la silueta sin activar collisionComponents. Para una única isla sigue funcionando el contorno fast/fine habitual, calculado sobre ese archivo.

La reserva rectangular puede ocupar más área que el contorno de las islas por separado: es una decisión conservadora de preparación de reposiciones, sin cambios en el motor de collision. Se verificaron los casos con nombre dentro y fuera de la silueta; preflight conserva el crop visible completo.

## 7. UX resultante

El formulario existente conserva diseño, talle, lado, cantidad y tela, y añade “Archivo de Biblioteca”. Sus opciones usan la ruta/nombre que Biblioteca ya posee. Permite distinguir BACK estándar, BENJI y CHICHA en el mismo talle. La lista de reposiciones muestra el filename seleccionado junto al preview real. Biblioteca muestra los dorsos adicionales en un detalle expandible con sus previews; el preview canónico sigue teniendo prioridad.

Los PNG descartados por una importación antigua no tienen blobs recuperables en la persistencia. Para incorporarlos una vez se usa “Actualizar desde carpeta” en Biblioteca, o se vuelve a importar la colección si no tiene carpeta fuente. Después se seleccionan desde Agregar reposición. No requieren Importar PNG.

## 8. Tests añadidos y cobertura requerida

La primera ampliación añadió 23 casos. La corrección de `nom` aumenta la suite en 35 casos, de 337 a 372 aprobados: ejemplo exacto con espacio, cuatro ejemplos productivos, todos los talles válidos, delimitadores/ambigüedad, orden de lectura, importación inicial, refresh y persistencia. El caso real también recorre selección, preview, geometría, preflight y entrada a exportación, standalone y mezclado con garment canónico y free-PNG. Se usan parser/scanner/estado y preflight reales, persistencia IndexedDB de prueba, raster de prueba y motor de nesting real. La entrada a la función de exportación se inspecciona mediante mock; no se ejecutó una exportación nativa ni una nueva release para esta corrección.

| Caso solicitado | Cobertura |
| --- | --- |
| 1. BACK estándar sigue apareciendo | Estado y mezcla UI: opción canónica presente. |
| 2. BACK personalizado aparece | Parser, construcción de colección, UI y Biblioteca. |
| 3. Puede agregarse sin FRONT | Estado standalone y dos casos UI. |
| 4. Talle correcto | Parser T5/T10, estado y definición UI T8. |
| 5. Side BACK | Parser, estado y definición exportada. |
| 6. Sólo 0/180 | Entrada real al worker en ambos casos UI. |
| 7. Qty > 1 | Dos instancias requeridas, cambio posterior a tres. |
| 8. Source exportado exacto | File seleccionado, object URL y definición entregada a export. |
| 9. No sustituir por estándar | Mezcla de fuentes, URLs distintas y bytes persistidos. |
| 10. Preview editado | Imagen de lista y `href` SVG del arte preparado. |
| 11. Summary REPOSICIONES | 2/2, 3/3 y mezcla de tres reposiciones. |
| 12. No contar como PRENDA | 0/0 prendas standalone; 1/1 en mezcla con garment. |
| 13. Qty invalida resultado | Desaparición de preview/export y reoptimización. |
| 14. Eliminar funciona | Eliminación tras optimizar, resultado invalidado y URL liberada. |
| 15. BACK estándar + editados | Mezcla UI con estándar, BENJI y CHICHA. |
| 16. Reposición + garment | Misma mezcla, pairing canónico verificado. |
| 17. Reposición + free-PNG | Misma tela; sólo el logo recibe ruta free-PNG. |
| 18. PNG arbitrario no aparece | Rechazos de parser, archivo JUAN.png ignorado y ausente del selector. |
| 19. Nombre visible conservado | Bounds, polígono, crop y preflight con isla fuera de silueta. |
| 20. Biblioteca existente igual | Colección completa, previews/pairing canónicos y carga legacy. |

También se verificó que cambiar tela invalida el resultado, que el cache distingue contenido y modo de geometría, y que la persistencia rechaza metadata suplementaria inválida.

## 9. Contadores y rotaciones

El test pequeño usa dos instancias del BACK personalizado y el motor real con `diagnosticProfiling`. Se ejecuta en la suite normal; no depende del benchmark grande opt-in existente.

| Fixture | Fast/fine | Rotaciones BACK | componentsOverlapCalls | componentPairExactChecks |
| --- | --- | --- | --- | --- |
| Nombre dentro de silueta | Presentes | 2: 0/180 | 0 | 0 |
| Nombre separado fuera de silueta | Presentes | 2: 0/180 | 0 | 0 |
| `aanomFIRULAIS SLE_D_T4.png`, nombre separado fuera de silueta | Presentes | 2: 0/180 | 0 | 0 |

Estos resultados verifican la ruta utilizada; no se hizo una nueva investigación de tiempos de performance.

## 10. Archivos modificados por esta ampliación

Implementación:

- `src/domain/design-asset-filename.ts`: parser exclusivo de reposiciones para la convención productiva `nom` y talle delimitado.
- `src/domain/design-collection.ts`: conservación de dorsos adicionales fuera del pairing; evita que un duplicado cambie el nombre de la colección.
- `src/app/design-collection-state.ts`: assets adicionales y selección por metadata/ruta.
- `src/app/design-collection-library.tsx`: visualización de dorsos adicionales.
- `src/app/batch-page.tsx`: selector de source, preview identificado y preparación geométrica del contenido real.
- `src/persistence/design-collections.ts`: guardar/cargar/validar blobs adicionales.
- `src/persistence/contour-cache.ts`: modo geométrico de reposición en la clave.
- `src/ui/theme.css`: ubicación del nuevo selector dentro del formulario existente.

Tests modificados: `src/domain/design-asset-filename.test.ts`, `src/app/design-collection-state.test.ts`, `src/app/free-png-batch.test.tsx`, `src/persistence/design-collections.test.ts`.

Tests nuevos: `src/app/design-collection-library.test.tsx`, `src/persistence/design-collection-replacements.test.ts`, `src/persistence/contour-cache.test.ts`.

Informe nuevo: `docs/replacement-edited-backs-audit.md`.

Se preservaron los cambios de la feature base que ya estaban sin commit al comenzar, incluidos los modelos de reposición, summary, export-plan y tests/benchmark previos. No se atribuyen aquí como cambios nuevos de esta ampliación.

La corrección puntual de la convención `nom` modifica sólo dos archivos de implementación: `src/domain/design-asset-filename.ts` y `src/domain/design-collection.ts`. Actualiza cinco archivos de tests: `src/domain/design-asset-filename.test.ts`, `src/domain/design-collection.test.ts`, `src/app/design-collection-library.test.tsx`, `src/app/free-png-batch.test.tsx`, `src/persistence/design-collection-replacements.test.ts`; también actualiza este informe. No modifica dropdown, geometría, caché, exportadores ni motor.

## 11. Validación

- Tests dirigidos de la corrección: 91/91 en seis archivos de parser/importación, refresh, selector, source y persistencia; 4/4 de Biblioteca repetidos después de corregir una opción de tipado del test.
- `npm run typecheck`: aprobado.
- `npm test -- --run --testTimeout=20000`: 372 aprobados, 9 omitidos; 52 archivos aprobados, 4 omitidos.
- `npm run build`: aprobado, incluyendo su typecheck.
- `git diff --check`: aprobado.
- No Cargo, release, commit ni push.
