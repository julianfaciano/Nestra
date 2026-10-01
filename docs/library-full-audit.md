# Auditoría completa de Biblioteca

Fecha: 2026-10-01T10:20:25.661Z

Raíz: `C:\Users\julian\Documents\.fanaticotas`. Resuelta desde 17 rutas fuente persistidas y existentes.

## Discovery y dry run

```json
{
  "directories": 3160,
  "containers": 868,
  "noAssets": 3074,
  "candidates": 86,
  "complete": 58,
  "incomplete": 28,
  "conflicts": 0,
  "nom": 43,
  "safe": 86,
  "new": 25,
  "updates": 61,
  "incompleteImportable": 28,
  "libraryBefore": 70,
  "libraryPlanned": 95,
  "decodedPng": 1602
}
```

La recursión descubre carpetas a cualquier profundidad. Cada colección usa exclusivamente archivos directos de su carpeta real. Se incluyen carpetas con punto y hidden; se omiten enlaces/reparse points. Los roots solapados y paths físicos se deduplican.

Los incompletos sin conflictos se importan en Biblioteca y quedan excluidos de prendas completas en Producción. La identidad prioriza sourceFolderPath, luego un nombre inequívoco (incluyendo rutas antiguas verificadas como inexistentes). Las identidades ambiguas y slots canónicos duplicados quedan bloqueados.

## Carpetas candidatas

| Colección | Canónicos | nom | Estado | Plan | Path absoluto |
|---|---:|---:|---|---|---|
| Adoptame | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Adoptame |
| Aldosivi | 2 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Aldosivi |
| Almirante Brown | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Almirante Brown |
| Arsenal | 16 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Arsenal |
| Atlanta | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Atlanta |
| Banfield | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Banfield |
| Batman | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Batman |
| Bugs Bunny | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Bugs Bunny |
| Capitan America | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Capitan America |
| Claypole | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Claypole |
| Coraje | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Coraje |
| Estudiantes | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Estudiantes |
| Frase | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Frase |
| Gimnasia | 0 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Gimnasia |
| Huracan | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Huracan |
| Inter Miami | 19 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Inter Miami |
| La Renga | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\La Renga |
| Laferrere | 16 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Laferrere |
| Los Andes | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Los Andes |
| Los Redondos | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Los Redondos |
| Mafalda | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Mafalda |
| Malvinas | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Malvinas |
| MandalasA | 16 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\MandalasA |
| Maradona | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Maradona |
| Maria Becerra | 1 | 1 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Maria Becerra |
| Moron | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Moron |
| Mujer Maravilla | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Mujer Maravilla |
| Naruto | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Naruto |
| Navidad | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Navidad |
| Newells | 5 | 2 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Newells |
| Nueva Chicago | 10 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Nueva Chicago |
| Pantera Rosa | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Pantera Rosa |
| Pantera Rosa Boca | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Pantera Rosa Boca |
| Pink Floyd | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Pink Floyd |
| Platense | 20 | 7 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Platense |
| Rolling Stones | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Rolling Stones |
| Rosario Central | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Rosario Central |
| Spiderman | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Spiderman |
| Tasmania | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Tasmania |
| Velez | 16 | 3 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Velez |
| Venezuela | 2 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Venezuela |
| Argentina 1994 | 20 | 0 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 1994 |
| Argentina 2006 | 0 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2006 |
| Argentina 2024 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2024 |
| Argentina 2026 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 |
| Argentina 2026 CM | 20 | 5 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 CM |
| Argentina 2026 Especial | 20 | 2 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Especial |
| Argentina 2026 Especial 2 | 16 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Especial 2 |
| Argentina 2026 Messi | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Messi |
| Argentina 2026 Suplente | 20 | 2 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Suplente |
| Argentina 2026 Suplente CM | 20 | 1 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Suplente CM |
| Argentina Prematch | 5 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina Prematch |
| Argentinos Juniors Clasica | 16 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Argentinos Juniors\Argentinos Juniors Clasica |
| Boca 12 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 12 |
| Boca 2023 | 12 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2023 |
| Boca 2024 | 16 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2024 |
| Boca 2025 | 16 | 3 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2025 |
| Boca 2026 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2026 |
| Boca Amarilla | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Amarilla |
| Boca Azul | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Azul |
| Boca Firma | 16 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Firma |
| Boca Quilmes | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Quilmes |
| Boca Retro | 16 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Retro |
| Boca Rosa | 16 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Rosa |
| Boca Siempre Mono | 0 | 0 | Incompleto | update · incomplete | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Siempre Mono |
| Boca Suplente 2026 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Suplente 2026 |
| Buenos Aires | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Buenos Aires\Buenos Aires |
| Buenos Aires 2 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Buenos Aires\Buenos Aires 2 |
| Buenos Aires 3 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Buenos Aires\Buenos Aires 3 |
| Dragon Ball Z | 20 | 0 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Dragon Ball\Dragon Ball Z |
| Independiente 2025 | 20 | 2 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Independiente\Independiente 2025 |
| Independiente 2026 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Independiente\Independiente 2026 |
| One Piece G5 | 20 | 0 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\One Piece\One Piece G5 |
| Racing 2024 | 20 | 2 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Racing\Racing 2024 |
| Racing 2026 | 20 | 1 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\Racing\Racing 2026 |
| River 2023 | 2 | 1 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\River\River 2023 |
| River 2024 | 15 | 1 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\River\River 2024 |
| River 2025 | 16 | 1 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\River\River 2025 |
| River 2026 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\River\River 2026 |
| River Suplente 2026 | 20 | 0 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\River\River Suplente 2026 |
| River Violeta | 4 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\River\River Violeta |
| San Lorenzo 2025 | 6 | 3 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\San Lorenzo\San Lorenzo 2025 |
| San Lorenzo 2026 | 20 | 5 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\San Lorenzo\San Lorenzo 2026 |
| San Lorenzo Escudo | 20 | 1 | Completo | update · update | C:\Users\julian\Documents\.fanaticotas\San Lorenzo\San Lorenzo Escudo |
| Tigre 2024 | 16 | 0 | Incompleto | new · incomplete | C:\Users\julian\Documents\.fanaticotas\Tigre\Tigre 2024 |
| Tigre 2026 | 20 | 0 | Completo | new · new | C:\Users\julian\Documents\.fanaticotas\Tigre\Tigre 2026 |

El JSON registra cada asset y su SHA-256, slots faltantes, duplicados, parser ignores, identidad y paths en conflicto; no contiene bytes de imágenes.



## Importación real y verificación posterior

Importación ejecutada por el diálogo nativo y los botones reales de la Release, en el origen http://tauri.localhost; las lecturas de IndexedDB se usaron únicamente para comprobar el resultado.

- 25 nuevos, 61 actualizados, 28 incompletos importados/actualizados y 0 conflictos bloqueados.
- Biblioteca final: 95 colecciones; 60 completas (58 diseños reales y 2 registros históricos) y 35 incompletas o con diagnósticos.
- 43 alternativas nom en diseños reales; 70 incluyendo legacy preservados.
- 1602 assets comparados contra SHA-256 originales, 0 mismatches; 1602 hashes originales releídos sin cambios.
- Las 86 colecciones importadas usan únicamente archivos directos y mantienen identidades estables. 9 legacy/orphans anteriores se conservaron sin cambios.
- Reimportación: 95 registros, snapshot idéntico=true, 0 nuevos y 86 actualizaciones.

### Nombres comprobados

| Nombre solicitado | Carpeta real | Verificado |
|---|---|---|
| Boca 2026 Suplente | Boca Suplente 2026 | Sí |
| San Lorenzo Escudo | San Lorenzo Escudo | Sí |
| Independiente 2025 | Independiente 2025 | Sí |
| Racing 2026 | Racing 2026 | Sí |
| River 2026 | River 2026 | Sí |
| River 2026 Suplente | River Suplente 2026 | Sí |
| Argentina 2026 Suplente | Argentina 2026 Suplente | Sí |

### Legacy / orphan candidates conservados

| Nombre | Assets + alternativas | Cobertura en diseños reales | Clasificación |
|---|---:|---|---|
| Tigre | 20 + 8 | 30/30 | SAFE TO REVIEW/DELETE |
| San Lorenzo | 20 + 21 | 43/43 | SAFE TO REVIEW/DELETE |
| River | 20 + 31 | 53/53 | SAFE TO REVIEW/DELETE |
| Racing | 20 + 13 | 35/35 | SAFE TO REVIEW/DELETE |
| One Piece | 20 + 0 | 22/22 | LEGACY / ORPHAN CANDIDATE |
| Independiente | 20 + 12 | 24/34 | LEGACY / ORPHAN CANDIDATE |
| Dragon Ball | 20 + 0 | 22/22 | LEGACY / ORPHAN CANDIDATE |
| Argentinos Juniors | 16 + 0 | 16/16 | LEGACY / ORPHAN CANDIDATE |
| Argentina | 20 + 91 | 103/113 | LEGACY / ORPHAN CANDIDATE |

Los registros legacy con mezcla conocida siguen en Biblioteca para revisión; no se borró ninguno. El JSON conserva paths relativos, paths correctos, cobertura por hash, source path y motivo. No se eliminó IndexedDB, no se modificaron originales, no se hizo commit ni push.

### Diseños incompletos que requieren completar talles

- **Aldosivi**: 1 FRONT, 1 BACK; faltan 18 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Aldosivi`.
- **Arsenal**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Arsenal`.
- **Gimnasia**: 0 FRONT, 0 BACK; faltan 20 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Gimnasia`.
- **Inter Miami**: 9 FRONT, 10 BACK; faltan 1 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Inter Miami`.
- **Laferrere**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Laferrere`.
- **MandalasA**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\MandalasA`.
- **Maria Becerra**: 1 FRONT, 0 BACK; faltan 19 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Maria Becerra`.
- **Newells**: 3 FRONT, 2 BACK; faltan 15 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Newells`.
- **Nueva Chicago**: 5 FRONT, 5 BACK; faltan 10 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Nueva Chicago`.
- **Velez**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Velez`.
- **Venezuela**: 1 FRONT, 1 BACK; faltan 18 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Venezuela`.
- **Argentina 2006**: 0 FRONT, 0 BACK; faltan 20 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2006`.
- **Argentina 2026 Especial 2**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Especial 2`.
- **Argentina Prematch**: 2 FRONT, 3 BACK; faltan 15 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina Prematch`.
- **Argentinos Juniors Clasica**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Argentinos Juniors\Argentinos Juniors Clasica`.
- **Boca 2023**: 6 FRONT, 6 BACK; faltan 8 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2023`.
- **Boca 2024**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2024`.
- **Boca 2025**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2025`.
- **Boca Firma**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Boca\Boca Firma`.
- **Boca Retro**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Boca\Boca Retro`.
- **Boca Rosa**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Boca\Boca Rosa`.
- **Boca Siempre Mono**: 0 FRONT, 0 BACK; faltan 20 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Boca\Boca Siempre Mono`.
- **River 2023**: 2 FRONT, 0 BACK; faltan 18 slots. Path: `C:\Users\julian\Documents\.fanaticotas\River\River 2023`.
- **River 2024**: 7 FRONT, 8 BACK; faltan 5 slots. Path: `C:\Users\julian\Documents\.fanaticotas\River\River 2024`.
- **River 2025**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\River\River 2025`.
- **River Violeta**: 2 FRONT, 2 BACK; faltan 16 slots. Path: `C:\Users\julian\Documents\.fanaticotas\River\River Violeta`.
- **San Lorenzo 2025**: 4 FRONT, 2 BACK; faltan 14 slots. Path: `C:\Users\julian\Documents\.fanaticotas\San Lorenzo\San Lorenzo 2025`.
- **Tigre 2024**: 8 FRONT, 8 BACK; faltan 4 slots. Path: `C:\Users\julian\Documents\.fanaticotas\Tigre\Tigre 2024`.

### Validación técnica

- 60 archivos de tests aprobados: 462 tests; 5 archivos / 10 tests omitidos por configuración existente.
- npm run typecheck, npm run build, git diff --check: aprobados.
- cargo fmt --check, cargo check y cargo test design_import::tests: aprobados; 3 tests Rust.
- /Moldes no se modificó en este bloque.
- npm run build:windows: aprobado (Release final, 2m 19s). EXE: `S:\Nestra\src-tauri\target\release\nestra.exe`, 9.525.760 bytes, 2026-10-01T07:36:28.2975997-03:00.

Errores de verificación: 0.

## Verificación en la Release

- Selección real simultánea de `C:\Users\julian\Documents\.fanaticotas` y `C:\Users\julian\Documents\.fanaticotas\River`: mismos 3.160 directorios y 86 candidatos; no se importó River dos veces.
- Producción: 60 diseños completos seleccionables; 35 incompletos/con diagnósticos excluidos. El selector de reposiciones conserva las 95 colecciones. Verificación contra IndexedDB: 0 diferencias.
- Buenos Aires corresponde actualmente a una carpeta de diseño real con archivos directos, por eso se actualizó su registro desde esa carpeta. Boca no existe como registro padre. Los restantes nombres legacy señalados se conservaron y están clasificados arriba.
- Argentina e Independiente requieren especial cuidado: 10 dorsos legacy de cada uno no coinciden por hash con las fuentes actuales. No se marcaron como seguros para borrar.

## Lanzamiento final

- EXE: `S:\Nestra\src-tauri\target\release\nestra.exe`.
- PID: **26160**, **Responding=True**, ventana **Nestra**.
- Verificado: 2026-10-01T07:39:37.7488978-03:00. Biblioteca visible y maximizada; **95 colecciones** cargadas después del reinicio.
- La Release final muestra “Diseños de Biblioteca” y la ayuda “Seleccioná carpetas de diseños o carpetas que las contengan.”
- Sin commit, sin push; originales e IndexedDB completa preservados.
