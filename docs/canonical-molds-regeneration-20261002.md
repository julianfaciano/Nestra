# Regeneración canónica desde masters — 2026-10-02

## Corrección posterior del marcador — especificación vigente

Este addendum supersede la medida de 20 filas visibles registrada en el informe histórico de abajo **para los 30 diseños del pedido de hoy**. Según la especificación final, todos los talles usan un glifo visible de exactamente 19 px: a 72 PPI son 6.7027778 mm (0.6702778 cm). El redondeo a píxeles se resuelve uniformemente usando 19 filas para T1–T10.

El marcador #8aff00 se coloca centrado horizontalmente en la ubicación interior más alta que mantiene el margen local requerido; queda completamente dentro del alpha original con un píxel de resguardo. No altera dimensiones ni alpha. Los 30 diseños seleccionados se reprocesaron desde masters actuales; ningún otro diseño, master, PSD, personalizado ni archivo vecino se modificó.

- Staging y validación independiente: 600/600 PNG, 30 diseños, sin errores ni excepciones. Altura 19 px, color exacto, alpha y dimensiones idénticos, sin píxeles alterados fuera del glifo y roundtrip PNG exacto.
- Separación al borde superior local: min 1 px (0.3528 mm), promedio 1.525 px (0.5378 mm), máximo 5 px (1.7639 mm); 0 por encima de 19 px / 7 mm. No hubo fallback horizontal ni deriva hacia hombros.
- Aplicación: 600 PNG; 600 originales guardados y verificados en `C:\Users\julian\Documents\Nestra-backups\canonical-molds-gap19-20261002`; 0 canónicos antiguos adicionales retirados.
- Postflight: 600 hashes aplicados y 600 hashes de backup coinciden; 20 canónicos por carpeta; 133 archivos protegidos conservan su hash.
- Validación final: **508 PASS, 10 SKIP, 0 FAIL**; 13 tests dirigidos del marcador PASS; typecheck PASS; build Windows PASS. EXE `S:\Nestra\src-tauri\target\release\nestra.exe`, 9535488 bytes. Ventana `Nestra` activa y `Responding=True` (PID 16180).

La reimportación de Biblioteca debe hacerse desde `C:\Users\julian\Documents\.fanaticotas` para actualizar snapshots antes de recalcular el pedido. El registro histórico posterior describe el lote anterior de 20 px; esta corrección es la fuente de verdad para los 30 diseños del fixture productivo.

La ejecución productiva terminó: 56 carpetas, 1120 PNG y 1033 originales respaldados. No se realizó commit ni push.

## Runner y fuente de verdad

El fallo `handleApi is not defined` ocurría porque el callback del middleware estaba fuera del bloque `try` donde se declaraba `handleApi`. Se eliminó el servidor HTTP de generación y su página: el runner ejecuta Node directamente. Vite sólo carga los módulos TypeScript compartidos mediante SSR, sin navegador ni Computer Use.

La grada, lados, nombres y dimensiones salen de `createMoldOutputPlan`; los glifos, bbox, posición, color y contención salen de `size-mark-raster.ts`, compartido con /Moldes. Pillow 12.3.0 se utiliza únicamente para PNG y remuestreo Lanczos con alpha premultiplicado. /Moldes usa Canvas de alta calidad: las reglas y dimensiones son comunes, pero no se afirma igualdad binaria entre los interpoladores. No se agregó dependencia npm.

Objetivo físico 7.0 mm: round(7 × 72 / 25.4) = 20 filas visibles. A 72 PPI son 7.0555556 mm, error +0.0555556 mm. Se mantiene para todos los talles, incluido 10. El pipeline de Nestra usa 72 PPI como escala física; el campo pHYs PNG también se escribe con redondeo entero de píxeles/metro.

## Validación

- Muestra previa: 60/60 PNG; inspección visual de T1/T8/T10 FRONT/BACK en Argentina 2026 Messi, Boca 2026 y Mafalda.
- Recuperación PSD: 40/40 PNG; misma inspección visual en Mujer Maravilla y Spiderman.
- Dry-run general: 1080/1080 PNG; combinado con PSD: 1120/1120.
- Cada archivo: parser real, dimensiones, glifo correcto, #8aff00, 20 filas visibles, bbox interior, alpha idéntico antes/después del número, RGB exterior al glifo sin cambios y roundtrip PNG exacto.
- Una sola aplicación del glifo desde la fuente limpia. Los números propios del arte (por ejemplo la camiseta de Messi) se conservan.
- 0 píxeles nuevos fuera del alpha; 0 colocaciones en mitad inferior.
- Post-escritura: 1120 hashes coinciden con staging validado, decodificación PNG válida y exactamente 20 canónicos por carpeta.
- 108 masters PNG y 2 PSD fuente intactos. Snapshot de 185 archivos directos protegidos (masters, PSD, personalizados y otros) sin cambios de hash.

## Inventario final

86 carpetas relevantes. 55 pares PNG existentes: 54 aceptados y uno exceptuado por prefijo. Se recuperaron dos pares adicionales desde PSD. Total: 57 pares de fuentes identificados, 56 carpetas regeneradas, 1120 PNG. Las 30 carpetas exceptuadas no se modificaron.

Los prefijos 00BA3, 00LREN, 00REDO y 00MLV fueron confirmados por ambos masters y los 16 archivos T1–T8. Los cuatro archivos T9–T10 sólo omitían 00; el parser confirma una colección completa sin duplicados. Se retiraron esos 16 nombres antiguos después del backup para dejar exactamente 20 canónicos. La auditoría histórica ya registra esos mismos dos prefijos; no se aplicaron sus propuestas de normalización general.

Mujer Maravilla y Spiderman contienen un PSD inequívoco cada uno con grupos T8 frente/T8 dorso. Se compusieron esos grupos, limitados al viewport original del documento y recortados al alpha visible. En Mujer Maravilla el bloque rojo extra está enteramente fuera del documento (y=-2912..0); dentro queda el dorso 1245×1801. Ambos frentes son 985×1226 y ambos dorsos 1245×1801. No se usaron canónicos viejos ni catalog-render como fuentes. PSD originales sin cambios; fuentes derivadas conservadas en backup/recovered-sources. El lector psd-tools/scipy se instaló sólo en un directorio temporal, fuera del proyecto.

## Pedido de hoy

Fixture: 641 prendas, 1282 piezas, 30 diseños. No se modificaron cantidades ni se persistió el pedido.

A. Diseños del pedido regenerados automáticamente:

- Argentina 2024
- Argentina 2026 Messi
- Banfield
- Batman
- Boca 2026
- Boca Amarilla
- Boca Azul
- Boca Quilmes
- Boca Suplente 2026
- Buenos Aires
- Buenos Aires 2
- Claypole
- Coraje
- Frase
- HuracÃƒÂ¡n
- Independiente 2026
- Los Andes
- Mafalda
- Maradona
- MorÃƒÂ³n
- Pantera Rosa Boca
- River 2026
- Rolling Stones
- San Lorenzo 2026

B. Diseños resueltos tras inspección dirigida:

- Buenos Aires 3
- La Renga
- Los Redondos
- Malvinas
- Mujer Maravilla
- Spiderman

C. Excepciones reales entre las 641 prendas: ninguna.

**Dos reposiciones:** lectura de sólo lectura del LevelDB vigente de Local Storage encontró el Historial 108: 641 prendas, 24 canvases, 116.3207 m, `freePngPieces=null` y `extraPieces=null`. Es el registro más reciente guardado; no contiene las reposiciones y sus metros no coinciden con el resultado manual reportado (116.197 m), así que no es inequívocamente el batch que incluye las reposiciones. Session Storage vigente no conserva un draft del batch. El batch React en memoria ya no estaba disponible tras el reinicio para build. No se modificó ninguna reposición/PNG nom. Queda pendiente conocer para cada una: diseño/colección exacta, talle, lado (FRONT/BACK), nombre exacto del PNG en Biblioteca y nombre/persona codificada en el archivo si es un nom personalizado. No inferir estos campos ni declarar la preparación de producción real completa.

## Excepciones no usadas por las 641 prendas

| Carpeta | Motivo |
|---|---|
| Adoptame | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Aldosivi | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Argentina/Argentina Prematch | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Argentinos Juniors/Argentinos Juniors Clasica | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Arsenal | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Boca/Boca 2023 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Boca/Boca 2024 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Boca/Boca 2025 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Boca/Boca Retro | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Boca/Boca Rosa | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Bugs Bunny | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Capitan America | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Inter Miami | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Laferrere | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| MandalasA | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Navidad | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Newells | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Nueva Chicago | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Pantera Rosa | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Racing/Racing 2024 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| River/River 2023 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| River/River 2024 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| River/River 2025 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| River/River Violeta | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| San Lorenzo/San Lorenzo 2025 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| San Lorenzo/San Lorenzo Escudo | Prefijo ambiguo: 00SLE (19) / SLE (1); conservado sin normalizar |
| Tasmania | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Tigre/Tigre 2024 | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Velez | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |
| Venezuela | Faltan ambos masters PNG; sin recuperación PSD realizada en este alcance |

## Backup y manifest

Backup permanente: `C:\Users\julian\Documents\Nestra-backups\canonical-molds-20261002`.

- `originals/`: 1033 canónicos anteriores con hashes verificados antes de escribir.
- `manifest-before.json`, `manifest-backups-verified.json`, `manifest-applied.json`: carpetas, masters, prefix, hash anterior/nuevo, dimensiones, validaciones y 16 nombres retirados.
- `protected-before.json`, `postflight.json`: comprobaciones posteriores.
- `recovered-sources/`: cuatro masters derivados y `sources.json` reutilizable.

Staging completo: `C:\Users\julian\AppData\Local\Temp\nestra-molds-cli-full-20261002`.

## Tests y release

- Helper/Moldes: 16 PASS.
- Runner CLI: 5 PASS (`node --test scripts/check-canonical-molds.mjs`).
- Typecheck: PASS.
- Primera suite completa: 507 PASS, 10 SKIP, un archivo de pruebas fallido porque Vitest recogía el test Node. Se separó el nombre del chequeo CLI.
- Suite final: **507 PASS, 10 SKIP, 0 FAIL**.
- `git diff --check`: PASS (avisos existentes de LF/CRLF).
- `npm run build:windows`: PASS. EXE: `S:\Nestra\src-tauri\target\release\nestra.exe`, 9535488 bytes, 2026-10-02 03:33:17 local.

## Reimportación

Los canónicos regenerados están listos para reimportar desde `C:\Users\julian\Documents\.fanaticotas`. Reimportar Biblioteca para renovar snapshots y recalcular el pedido antes de exportarlo: las dimensiones se normalizaron a la grada de /Moldes. Confirmar 641 prendas y revisar las dos reposiciones pendientes de identificación. No reutilizar un layout anterior calculado con los PNG previos.
