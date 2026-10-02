# Auditoría de nombres de assets — .fanaticotas

Fecha local: 1 de octubre de 2026 (America/Buenos_Aires). Raíz: `C:\Users\julian\Documents\.fanaticotas`. Workspace: `S:\Nestra`.

Auditoría de sólo lectura sobre originales. Se generan únicamente estos reportes en docs. No se ejecutó renombrado, movimiento, importación, Moldes, build, release ni suite completa.

## RESUMEN

| Métrica | Resultado |
| --- | --- |
| Directorios recorridos (incluye ocultos, proyecto web y dependencias) | 3161 |
| Diseños reales con PNG reconocibles directos | 86 |
| PNG en todo el árbol | 2120 |
| PNG directos en diseños reales | 1607 |
| Desglose de PNG de diseños | 1451 canónicos + 108 maestros + 45 nom + 3 otros no reconocidos |
| PNG fuera de carpetas de diseño | 513 |
| Códigos lógicos actuales / prefijos literales actuales | 85 / 105 |
| Códigos propuestos únicos / colisiones propuestas | 86 / 0 |
| Colisiones actuales de código / grupos de filenames actuales duplicados | 2 / 42 |
| Diseños completos / incompletos por slots canónicos | 58 / 28 |
| Diseños con conflicto de naming (unión de conflictos locales/globales) | 7 |
| Inconsistencias locales / carpetas con varias variantes literales de prefijo | 4 / 21 |
| Diseños con código lógico que incumple máximo 5 | 6 |
| Carpetas reales con clasificación REVISAR o SUGERENCIA | 14 |
| Carpetas con PSD pero sin PNG reconocibles directos | 5 |
| nom total / válido / inválido | 45 / 43 / 2 |
| PNG a renombrar según propuesta, excluye nom | 1220 (1194 canónicos + 26 maestros) |
| nom con cambio condicional / conservar / MANUAL sin propuesta | 25 / 18 / 2 |
| Destinos ocupados por otro archivo / filas sin cambio | 0 / 339 |
| Duplicados de filenames/rutas finales propuestos | 0 / 0 |
| Errores de lectura / enlaces omitidos / errores de parser propuesto | 0 / 0 / 0 |
| Verificación final del árbol original | Sin diferencias de paths, tamaños ni mtime |

Un diseño se identifica exclusivamente por al menos un PNG directo reconocido por `isRecognizableDesignAssetFilename`. Se recorrieron todos los descendientes, incluidos los ocultos; `catalog-render/front.png` y `back.png` no convierten una carpeta en diseño.

Los 105 prefijos literales incluyen el 00 inicial de los nombres; los 85 códigos lógicos agrupan esa decoración y el marcador de maestro. Esta agrupación sirve para comparar identidades y no es una regla nueva del parser. Las 21 carpetas con variantes literales no implican por sí solas 21 diseños diferentes. Hay 4 inconsistencias locales y 4 diseños implicados en 2 colisiones globales; su unión abarca 7 diseños.

Completitud significa 20 slots T1–T10 × FRONT/BACK, sin duplicados. Maestros y nom no reemplazan slots faltantes. Se leyeron cabeceras PNG/IHDR, sin decodificar todo el raster ni confirmar visualmente el diseño. Los dos archivos con cabecera incompatible están en .rsc, fuera de los diseños; se enumeran más abajo.

### Compatibilidad exacta con el parser

Fuentes consultadas: `src/domain/design-asset-filename.ts`, `src/domain/design-collection.ts`, `src/app/design-collection-state.ts` y `src/app/bulk-design-discovery.ts`. Se usaron sus funciones reales transpileadas en memoria; no se modificó código ni se ejecutó generación.

- Canónico legacy: `CODIGO_0000_T1-FRENTE.png`. La secuencia es obligatoria y debe ser (talle−1)×2 para FRONT o +1 para BACK; no cambiar números ni sufijos.
- Formato humano: nombre seguido por tokens terminales T1–T10 y FRENTE/DORSO. El cambio de nombre puede cambiar designName en escaneos genéricos; la importación masiva identifica la colección por la carpeta real. Todos los canónicos encontrados usan el formato legacy.
- Maestro: `00CODIGO (F).png` / `00CODIGO (D).png`. El 00 inicial es obligatorio para reconocerlo. Se conserva el marcador y se limita a 5 caracteres el CODIGO; la cadena 00CODIGO puede medir 7. Exigir 5 al basename completo sería incompatible con el reconocimiento actual para códigos de 4–5.
- `nom` en cualquier parte del basename activa reposición BACK si hay un único token de talle válido. Incluso un sufijo FRENTE sigue siendo BACK en nom. Ningún código propuesto contiene NOM.
- Ningún cambio propuesto corrige secuencias, talles, lado, extensión ni archivos ignorados. Todos los mappings canónicos/maestros y las propuestas nom válidas conservaron su interpretación con el parser real.

### Convenciones por familia

| Familia | Sistema propuesto |
| --- | --- |
| Argentina | ARG+año base; AR+E/M/S+año Especial/Messi/Suplente; ACM26 conserva CM literal, AE226 conserva E2, ASC26 conserva S+C de CM. Identidades CM/SM pendientes. |
| Boca | BJ+año; BJ+variante 12, AM, AZ, F, Q, RET, ROS, SM. BJS26 reservado. |
| River | RIV+año; RPS26 reservado; RIVVI Violeta. |
| San Lorenzo | SLO+año; SLE Escudo. |
| Racing | RAC+año. |
| Tigre | TIG+año. |
| Independiente | IND+año. |
| Buenos Aires | BA, BA2, BA3. |

RPS26 y BJS26 se conservan exactamente según el usuario. Los códigos de identidades dudosas son reservas provisionales, pendientes de confirmar el arte; no son autorización para ejecutar cambios.

## TABLA PRINCIPAL DE RENOMBRES

Una fila por diseño real. Rutas relativas a la raíz indicada arriba; el JSON contiene path absoluto, parent, profundidad, archivos directos, mapping por archivo y destinos condicionales de carpeta. PNG afectados cuenta únicamente nombres que cambiarían en canónicos/maestros; nom se audita aparte.

| Carpeta | Actual (código lógico) | Propuesto | PNG directos / afectados | ANTES | DESPUÉS | Estado / conflictos / observaciones |
| --- | --- | --- | --- | --- | --- | --- |
| Adoptame | ADO | ADO | 20 / 20 | 00ADO_0000_T1-FRENTE.png | ADO_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Aldosivi | ALD | ALD | 2 / 2 | 00ALD_0008_T5-FRENTE.png | ALD_0008_T5-FRENTE.png | OK; INCOMPLETO 18; INCOMPLETO: faltan 18 slots canónicos; maestros/nom no completan slots. |
| Almirante Brown | ALMB | ALMB | 22 / 20 | 00ALMB_0000_T1-FRENTE.png | ALMB_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Argentina\Argentina 1994 | ARG94 | ARG94 | 22 / 20 | 00ARG94_0000_T1-FRENTE.png | ARG94_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Argentina\Argentina 2006 | ARG06 | ARG06 | 2 / 0 | 00ARG06 (D).png | 00ARG06 (D).png | OK; INCOMPLETO 20; INCOMPLETO: faltan 20 slots canónicos; maestros/nom no completan slots. |
| Argentina\Argentina 2024 | ARG24 | ARG24 | 22 / 20 | 00ARG24_0000_T1-FRENTE.png | ARG24_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Argentina\Argentina 2026 | ARG26 | ARG26 | 22 / 20 | 00ARG26_0000_T1-FRENTE.png | ARG26_0000_T1-FRENTE.png | REVISAR; COMPLETO; CONFLICTO DE NAMING; PSD llamado "00000000mold Argentina 2026 SM.psd": significado de SM e identidad respecto de CM requieren revisión humana. ARG26 reservado provisionalmente a esta carpeta. Código actual global compartido: ARG26. |
| Argentina\Argentina 2026 CM | ARG26 | ACM26 | 27 / 22 | 00ARG26_0000_T1-FRENTE.png | ACM26_0000_T1-FRENTE.png | REVISAR; COMPLETO; CONFLICTO DE NAMING; nom 5 (5 cambios condicionales); Comparte ARG26 con Argentina 2026; PSD omite CM. ACM26 conserva literalmente CM sin expandir su significado. Confirmar diseños distintos. Código actual global compartido: ARG26. |
| Argentina\Argentina 2026 Especial | ARG26E | ARE26 | 24 / 22 | 00ARG26E_0000_T1-FRENTE.png | ARE26_0000_T1-FRENTE.png | OK; COMPLETO; código >5; nom 2 (2 cambios condicionales); Sin conflictos; normalizar prefijo. |
| Argentina\Argentina 2026 Especial 2 | ARG26E2 | AE226 | 18 / 18 | 00ARG26E2_0000_T1-FRENTE.png | AE226_0000_T1-FRENTE.png | REVISAR; INCOMPLETO 4; código >5; AE226 = Argentina + Especial 2 + 26; confirmar que 2 es una variante independiente. INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Argentina\Argentina 2026 Messi | ARGM | ARM26 | 22 / 22 | ARGM_0000_T1-FRENTE.png | ARM26_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Argentina\Argentina 2026 Suplente | ARG26S | ARS26 | 24 / 22 | 00ARG26S_0000_T1-FRENTE.png | ARS26_0000_T1-FRENTE.png | OK; COMPLETO; código >5; nom 2 (2 cambios condicionales); Sin conflictos; normalizar prefijo. |
| Argentina\Argentina 2026 Suplente CM | ARG26SM | ASC26 | 23 / 22 | ARG26SM_0000_T1-FRENTE.png | ASC26_0000_T1-FRENTE.png | REVISAR; COMPLETO; código >5; nom 1 (1 cambios condicionales); ASC26 = Argentina + Suplente + C de CM + 26. PSD omite CM. Confirmar identidad antes de adoptar código. |
| Argentina\Argentina Prematch | ARPM | ARPM | 5 / 5 | 00ARPM_0001_T1-DORSO.png | ARPM_0001_T1-DORSO.png | OK; INCOMPLETO 15; INCOMPLETO: faltan 15 slots canónicos; maestros/nom no completan slots. |
| Argentinos Juniors\Argentinos Juniors Clasica | AJCL | AJCL | 16 / 16 | 00AJCL_0000_T1-FRENTE.png | AJCL_0000_T1-FRENTE.png | OK; INCOMPLETO 4; INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Arsenal | AS25 | ASL25 | 16 / 16 | 00AS25_0000_T1-FRENTE.png | ASL25_0000_T1-FRENTE.png | SUGERENCIA DE RENOMBRE; INCOMPLETO 4; AS25 y PSD Arsenal 2025 sugieren año ausente; confirmar. ASL25 distingue de Argentina Suplente. INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Atlanta | ATL | ATL | 22 / 20 | 00ATL_0000_T1-FRENTE.png | ATL_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Banfield | BANF | BANF | 22 / 20 | 00BANF_0000_T1-FRENTE.png | BANF_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Batman | BAT | BAT | 22 / 20 | 00BAT_0000_T1-FRENTE.png | BAT_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Boca\Boca 12 | B12 | BJ12 | 22 / 22 | 00B12_0000_T1-FRENTE.png | BJ12_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Boca\Boca 2023 | BJ23 | BJ23 | 12 / 12 | 00BJ23_0000_T1-FRENTE.png | BJ23_0000_T1-FRENTE.png | OK; INCOMPLETO 8; INCOMPLETO: faltan 8 slots canónicos; maestros/nom no completan slots. |
| Boca\Boca 2024 | BJ24 | BJ24 | 16 / 16 | 00BJ24_0000_T1-FRENTE.png | BJ24_0000_T1-FRENTE.png | OK; INCOMPLETO 4; INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Boca\Boca 2025 | BJ25 | BJ25 | 19 / 16 | 00BJ25_0000_T1-FRENTE.png | BJ25_0000_T1-FRENTE.png | OK; INCOMPLETO 4; nom 3 (0 cambios condicionales); INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Boca\Boca 2026 | BJ26 | BJ26 | 24 / 20 | 00BJ26_0000_T1-FRENTE.png | BJ26_0000_T1-FRENTE.png | REVISAR; COMPLETO; CONFLICTO DE NAMING; nom 2 (0 cambios condicionales); Dos nom con TX no tienen talle válido; no inferir talle ni lado desde el texto. |
| Boca\Boca Amarilla | BOCAM | BJAM | 22 / 22 | 00BOCAM_0000_T1-FRENTE.png | BJAM_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Boca\Boca Azul | BJAZ | BJAZ | 22 / 0 | 00BJAZ (D).png | 00BJAZ (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Boca\Boca Firma | BJF | BJF | 18 / 16 | 00BJF_0000_T1-FRENTE.png | BJF_0000_T1-FRENTE.png | REVISAR; INCOMPLETO 4; CONFLICTO DE NAMING; BJF (F)/(D).png carecen de 00: no se reconocen como maestros. Reparación manual adicional, fuera del cambio de código. INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Boca\Boca Quilmes | BOQ, BJ26S | BJQ | 22 / 22 | BJ26S_0000_T1-FRENTE.png | BJQ_0000_T1-FRENTE.png | REVISAR; COMPLETO; CONFLICTO DE NAMING; Maestros BOQ y PSD Boca Quilmes; 20 canónicos BJ26S, compartido con Boca Suplente 2026. BJQ condicionado a revisar el arte. Múltiples códigos lógicos: BOQ, BJ26S. Código actual global compartido: BJ26S. |
| Boca\Boca Retro | BRET | BJRET | 16 / 16 | 00BRET_0000_T1-FRENTE.png | BJRET_0000_T1-FRENTE.png | OK; INCOMPLETO 4; INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Boca\Boca Rosa | BROS | BJROS | 16 / 16 | 00BROS_0000_T1-FRENTE.png | BJROS_0000_T1-FRENTE.png | OK; INCOMPLETO 4; INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Boca\Boca Siempre Mono | BSM | BJSM | 2 / 2 | 00BSM (D).png | 00BJSM (D).png | OK; INCOMPLETO 20; INCOMPLETO: faltan 20 slots canónicos; maestros/nom no completan slots. |
| Boca\Boca Suplente 2026 | BJ26S | BJS26 | 22 / 22 | BJ26S_0000_T1-FRENTE.png | BJS26_0000_T1-FRENTE.png | OK; COMPLETO; CONFLICTO DE NAMING; BJS26 definido por usuario, reservado sin cambios. Código actual global compartido: BJ26S. |
| Buenos Aires\Buenos Aires | BA | BA | 22 / 20 | 00BA_0000_T1-FRENTE.png | BA_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Buenos Aires\Buenos Aires 2 | BA2 | BA2 | 22 / 20 | 00BA2_0000_T1-FRENTE.png | BA2_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Buenos Aires\Buenos Aires 3 | BA3 | BA3 | 22 / 16 | 00BA3_0000_T1-FRENTE.png | BA3_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Bugs Bunny | BBUG | BBUG | 20 / 20 | 00BBUG_0000_T1-FRENTE.png | BBUG_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Capitan America | CAPA | CAPA | 20 / 20 | 00CAPA_0000_T1-FRENTE.png | CAPA_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Claypole | CLA | CLA | 22 / 0 | 00CLA (D).png | 00CLA (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Coraje | COR | COR | 22 / 0 | 00COR (D).png | 00COR (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Dragon Ball\Dragon Ball Z | DBZ | DBZ | 22 / 0 | 00DBZ (D).png | 00DBZ (D).png | REVISAR; COMPLETO; DBZ ya correcto; revisar estructura contenedor/diseño en sección Dragon Ball. |
| Estudiantes | EST | EST | 22 / 0 | 00EST (D).png | 00EST (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Frase | FRA | FRA | 22 / 20 | 00FRA_0000_T1-FRENTE.png | FRA_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Gimnasia | GIM | GIM | 2 / 0 | 00GIM (D).png | 00GIM (D).png | OK; INCOMPLETO 20; INCOMPLETO: faltan 20 slots canónicos; maestros/nom no completan slots. |
| Huracan | HUR | HUR | 22 / 0 | 00HUR (D).png | 00HUR (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Independiente\Independiente 2025 | IND25 | IND25 | 24 / 0 | 00IND25 (D).png | 00IND25 (D).png | OK; COMPLETO; nom 2 (0 cambios condicionales); Sin conflictos; conservar nombres. |
| Independiente\Independiente 2026 | IND26 | IND26 | 22 / 0 | 00IND26 (D).png | 00IND26 (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Inter Miami | IM | IM | 19 / 19 | 00IM_0001_T1-DORSO.png | IM_0001_T1-DORSO.png | OK; INCOMPLETO 1; INCOMPLETO: faltan 1 slots canónicos; maestros/nom no completan slots. |
| La Renga | LREN | LREN | 22 / 16 | 00LREN_0000_T1-FRENTE.png | LREN_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Laferrere | LAFE | LAFE | 16 / 16 | 00LAFE_0000_T1-FRENTE.png | LAFE_0000_T1-FRENTE.png | OK; INCOMPLETO 4; INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Los Andes | LAN | LAN | 22 / 0 | 00LAN (D).png | 00LAN (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Los Redondos | REDO | REDO | 22 / 16 | 00REDO_0000_T1-FRENTE.png | REDO_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Mafalda | MAF | MAF | 22 / 20 | 00MAF_0000_T1-FRENTE.png | MAF_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Malvinas | MLV | MLV | 22 / 16 | 00MLV_0000_T1-FRENTE.png | MLV_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| MandalasA | MAND | MANDA | 16 / 16 | 00MAND_0000_T1-FRENTE.png | MANDA_0000_T1-FRENTE.png | REVISAR; INCOMPLETO 4; Confirmar significado de A. MANDA conserva A final en código; no quitar A de carpeta ni inferir otra variante. INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Maradona | MDO | MDO | 22 / 0 | 00MDO (D).png | 00MDO (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Maria Becerra | MBE | MBE | 4 / 1 | 00MBE_0008_T5-FRENTE.png | MBE_0008_T5-FRENTE.png | OK; INCOMPLETO 19; nom 1 (0 cambios condicionales); INCOMPLETO: faltan 19 slots canónicos; maestros/nom no completan slots. |
| Moron | MOR | MOR | 22 / 0 | 00MOR (D).png | 00MOR (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Mujer Maravilla | MMAR | MMAR | 20 / 20 | 00MMAR_0000_T1-FRENTE.png | MMAR_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Naruto | NAR | NAR | 22 / 20 | 00NAR_0000_T1-FRENTE.png | NAR_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Navidad | NAV | NAV | 20 / 20 | 00NAV_0000_T1-FRENTE.png | NAV_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Newells | NEW | NEW | 7 / 5 | 00NEW_0004_T3-FRENTE.png | NEW_0004_T3-FRENTE.png | OK; INCOMPLETO 15; nom 2 (0 cambios condicionales); INCOMPLETO: faltan 15 slots canónicos; maestros/nom no completan slots. |
| Nueva Chicago | NCHI | NCHI | 10 / 10 | 00NCHI_0006_T4-FRENTE.png | NCHI_0006_T4-FRENTE.png | OK; INCOMPLETO 10; INCOMPLETO: faltan 10 slots canónicos; maestros/nom no completan slots. |
| One Piece\One Piece G5 | OPG5 | OPG5 | 22 / 20 | 00OPG5_0000_T1-FRENTE.png | OPG5_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Pantera Rosa | PROS | PROS | 20 / 20 | 00PROS_0000_T1-FRENTE.png | PROS_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Pantera Rosa Boca | PRB | PRB | 22 / 0 | 00PRB (D).png | 00PRB (D).png | OK; COMPLETO; Sin conflictos; conservar nombres. |
| Pink Floyd | PNK | PNK | 22 / 20 | 00PNK_0000_T1-FRENTE.png | PNK_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Platense | PLAT26 | PLA26 | 29 / 22 | 00PLAT26_0000_T1-FRENTE.png | PLA26_0000_T1-FRENTE.png | SUGERENCIA DE RENOMBRE; COMPLETO; código >5; nom 7 (7 cambios condicionales); PLAT26 sugiere 2026, PSD omite año. PLA26 conserva año provisional; confirmar carpeta. |
| Racing\Racing 2024 | RA24 | RAC24 | 22 / 20 | 00RA24_0000_T1-FRENTE.png | RAC24_0000_T1-FRENTE.png | OK; COMPLETO; nom 2 (2 cambios condicionales); Sin conflictos; normalizar prefijo. |
| Racing\Racing 2026 | RAC26 | RAC26 | 23 / 20 | 00RAC26_0000_T1-FRENTE.png | RAC26_0000_T1-FRENTE.png | OK; COMPLETO; nom 1 (0 cambios condicionales); Sin conflictos; normalizar prefijo. |
| River\River 2023 | RI23 | RIV23 | 3 / 2 | 00RI23_0010_T6-FRENTE.png | RIV23_0010_T6-FRENTE.png | OK; INCOMPLETO 18; nom 1 (1 cambios condicionales); INCOMPLETO: faltan 18 slots canónicos; maestros/nom no completan slots. |
| River\River 2024 | RI24 | RIV24 | 16 / 15 | 00RI24_0000_T1-FRENTE.png | RIV24_0000_T1-FRENTE.png | OK; INCOMPLETO 5; nom 1 (1 cambios condicionales); INCOMPLETO: faltan 5 slots canónicos; maestros/nom no completan slots. |
| River\River 2025 | RI25 | RIV25 | 17 / 16 | 00RI25_0000_T1-FRENTE.png | RIV25_0000_T1-FRENTE.png | OK; INCOMPLETO 4; nom 1 (1 cambios condicionales); INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| River\River 2026 | RIV26 | RIV26 | 22 / 20 | 00RIV26_0000_T1-FRENTE.png | RIV26_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| River\River Suplente 2026 | RIV26S | RPS26 | 22 / 22 | 00RIV26S_0000_T1-FRENTE.png | RPS26_0000_T1-FRENTE.png | OK; COMPLETO; código >5; RPS26 definido por usuario, reservado sin cambios; no exige agregar Plate a carpeta. |
| River\River Violeta | RVIO | RIVVI | 4 / 4 | 00RVIO_0002_T2-FRENTE.png | RIVVI_0002_T2-FRENTE.png | OK; INCOMPLETO 16; INCOMPLETO: faltan 16 slots canónicos; maestros/nom no completan slots. |
| Rolling Stones | RLS | RLS | 22 / 20 | 00RLS_0000_T1-FRENTE.png | RLS_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Rosario Central | RC26 | RC26 | 22 / 20 | 00RC26_0000_T1-FRENTE.png | RC26_0000_T1-FRENTE.png | REVISAR; COMPLETO; PNG RC26; PSD Rosario Central 2025; pedido Rosario Central 2026 (1 al 6).jpg. Año contradictorio: RC26 provisional, no renombrar carpeta todavía. |
| San Lorenzo\San Lorenzo 2025 | SL25 | SLO25 | 9 / 6 | 00SL25_0006_T4-FRENTE.png | SLO25_0006_T4-FRENTE.png | OK; INCOMPLETO 14; nom 3 (3 cambios condicionales); INCOMPLETO: faltan 14 slots canónicos; maestros/nom no completan slots. |
| San Lorenzo\San Lorenzo 2026 | SLO26 | SLO26 | 27 / 20 | 00SLO26_0000_T1-FRENTE.png | SLO26_0000_T1-FRENTE.png | OK; COMPLETO; nom 5 (0 cambios condicionales); Sin conflictos; normalizar prefijo. |
| San Lorenzo\San Lorenzo Escudo | SLE | SLE | 24 / 19 | 00SLE_0000_T1-FRENTE.png | SLE_0000_T1-FRENTE.png | REVISAR; COMPLETO; CONFLICTO DE NAMING; nom 1 (0 cambios condicionales); SLE_F_T4.png no es canónico ni nom. No convertir: ya existe FRONT T4 reconocido, se duplicaría el slot. |
| Spiderman | SPID | SPID | 20 / 20 | 00SPID_0000_T1-FRENTE.png | SPID_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Tasmania | TASM | TASM | 20 / 20 | 00TASM_0000_T1-FRENTE.png | TASM_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Tigre\Tigre 2024 | TI24 | TIG24 | 16 / 16 | 00TI24_0000_T1-FRENTE.png | TIG24_0000_T1-FRENTE.png | OK; INCOMPLETO 4; INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Tigre\Tigre 2026 | TIG26 | TIG26 | 22 / 20 | 00TIG26_0000_T1-FRENTE.png | TIG26_0000_T1-FRENTE.png | OK; COMPLETO; Sin conflictos; normalizar prefijo. |
| Velez | VEL | VEL | 19 / 16 | 00VEL_0000_T1-FRENTE.png | VEL_0000_T1-FRENTE.png | OK; INCOMPLETO 4; nom 3 (0 cambios condicionales); INCOMPLETO: faltan 4 slots canónicos; maestros/nom no completan slots. |
| Venezuela | VE26 | VEN26 | 2 / 2 | 00VE26_0008_T5-FRENTE.png | VEN26_0008_T5-FRENTE.png | SUGERENCIA DE RENOMBRE; INCOMPLETO 18; VE26 sugiere 2026, PSD omite año. VEN26 provisional; confirmar. INCOMPLETO: faltan 18 slots canónicos; maestros/nom no completan slots. |

## CASOS PARA REVISIÓN MANUAL

### Colisiones actuales e identidad del arte

- `ARG26`: `Argentina\Argentina 2026` y `Argentina\Argentina 2026 CM`. Se compararon 20 pares canónicos por SHA-256: 0 idénticos byte a byte. Son fuentes distintas; este resultado no determina por sí solo el diseño visual.
- `BJ26S`: `Boca\Boca Quilmes` y `Boca\Boca Suplente 2026`. Se compararon 20 pares canónicos por SHA-256: 0 idénticos byte a byte. Son fuentes distintas; este resultado no determina por sí solo el diseño visual.

Argentina 2026 contiene un PSD con SM; Argentina 2026 CM tiene un PSD sin CM. Confirmar qué significan CM/SM y qué arte pertenece a cada carpeta. En Boca Quilmes, confirmar correspondencia de los canónicos BJ26S con los maestros BOQ antes de adoptar BJQ. No mezclar, eliminar ni deduplicar estas carpetas por compartir código.

### Clasificación de nombres de carpeta

| Carpeta | Clasificación | Sugerencia, evidencia y decisión |
| --- | --- | --- |
| Argentina\Argentina 2026 | REVISAR | PSD llamado "00000000mold Argentina 2026 SM.psd": significado de SM e identidad respecto de CM requieren revisión humana. ARG26 reservado provisionalmente a esta carpeta. |
| Argentina\Argentina 2026 CM | REVISAR | Comparte ARG26 con Argentina 2026; PSD omite CM. ACM26 conserva literalmente CM sin expandir su significado. Confirmar diseños distintos. |
| Argentina\Argentina 2026 Especial 2 | REVISAR | AE226 = Argentina + Especial 2 + 26; confirmar que 2 es una variante independiente. |
| Argentina\Argentina 2026 Suplente CM | REVISAR | ASC26 = Argentina + Suplente + C de CM + 26. PSD omite CM. Confirmar identidad antes de adoptar código. |
| Arsenal | SUGERENCIA DE RENOMBRE | Posible nombre: Arsenal 2025. AS25 y PSD Arsenal 2025 sugieren año ausente; confirmar. ASL25 distingue de Argentina Suplente. |
| Boca\Boca 2026 | REVISAR | Dos nom con TX no tienen talle válido; no inferir talle ni lado desde el texto. |
| Boca\Boca Firma | REVISAR | BJF (F)/(D).png carecen de 00: no se reconocen como maestros. Reparación manual adicional, fuera del cambio de código. |
| Boca\Boca Quilmes | REVISAR | Maestros BOQ y PSD Boca Quilmes; 20 canónicos BJ26S, compartido con Boca Suplente 2026. BJQ condicionado a revisar el arte. |
| Dragon Ball\Dragon Ball Z | REVISAR | DBZ ya correcto; revisar estructura contenedor/diseño en sección Dragon Ball. |
| MandalasA | REVISAR | Confirmar significado de A. MANDA conserva A final en código; no quitar A de carpeta ni inferir otra variante. |
| Platense | SUGERENCIA DE RENOMBRE | Posible nombre: Platense 2026. PLAT26 sugiere 2026, PSD omite año. PLA26 conserva año provisional; confirmar carpeta. |
| Rosario Central | REVISAR | PNG RC26; PSD Rosario Central 2025; pedido Rosario Central 2026 (1 al 6).jpg. Año contradictorio: RC26 provisional, no renombrar carpeta todavía. |
| San Lorenzo\San Lorenzo Escudo | REVISAR | SLE_F_T4.png no es canónico ni nom. No convertir: ya existe FRONT T4 reconocido, se duplicaría el slot. |
| Venezuela | SUGERENCIA DE RENOMBRE | Posible nombre: Venezuela 2026. VE26 sugiere 2026, PSD omite año. VEN26 provisional; confirmar. |

Los demás diseños se clasifican OK por evidencia textual disponible. No se confirmaron imágenes visualmente; no se propone un renombrado general de carpetas ni quitar espacios/tildes. La restricción ASCII aplica al código. No hay colisiones de identidad normalizada entre las 86 carpetas de diseño.

Contenedores sin assets directos: `Argentina`, `Argentinos Juniors`, `Boca`, `Buenos Aires`, `Dragon Ball`, `Independiente`, `One Piece`, `Racing`, `River`, `San Lorenzo`, `Tigre`. `Buenos Aires\Buenos Aires` es un diseño dentro del contenedor homónimo. No hay evidencia de importación incorrecta del padre: esta auditoría no consulta Biblioteca/IndexedDB.

| Carpeta candidata fuera de los 86 diseños | Estado | Archivos directos |
| --- | --- | --- |
| All Boys | REVISAR | 00000000mold All Boys 2.psd; 00000000mold All Boys.psd |
| Argentinos Juniors\Argentinos Juniors 2025 | REVISAR | 00000000mold Argentinos Juniors 2025.psd |
| Boca\Boca Blanca | REVISAR | 00000000mold Boca Blanca.psd |
| Chacarita | REVISAR | 00000000mold Chacarita.psd |
| Merlo | REVISAR | 00000000mold Merlo.psd |

Estas cinco carpetas tienen PSD pero ningún PNG reconocible directo; no se les asigna código ni se generan assets. No se infieren diseños adicionales a partir de pedidos, logos, PSD o renders.

### PNG directos que no siguen la convención

| Carpeta | Archivo | Decisión |
| --- | --- | --- |
| Boca\Boca 2026 | 00aanomSAM BJ26-TX-FRENTE.png | MANUAL: TX sin talle válido; conservar. |
| Boca\Boca 2026 | 0nomSAM BJ26_0005_TX-DORSO.png | MANUAL: TX sin talle válido; conservar. |
| Boca\Boca Firma | BJF (D).png | MANUAL: maestro aparente sin 00; conservar. |
| Boca\Boca Firma | BJF (F).png | MANUAL: maestro aparente sin 00; conservar. |
| San Lorenzo\San Lorenzo Escudo | SLE_F_T4.png | MANUAL: SLE_F_T4 no reconocido; ya hay FRONT T4, conservar. |

En Boca Firma, si el usuario confirma que son maestros, una reparación adicional posible es `BJF (F).png → 00BJF (F).png` y su equivalente D; los destinos están libres en esta instantánea. No forma parte del mapping de prefijo ni se incluyó en los PNG afectados.

### Personalizados nom

Todos los nom permanecen fuera de los slots canónicos. Las filas PROPUESTA MANUAL SEGURA POR PARSER cambian sólo el token explícito entre el nombre personalizado y su sufijo; cada propuesta requiere revisión humana del archivo. CONSERVAR mantiene el basename completo. Las dos filas MANUAL no tienen destino propuesto.

| Carpeta | ANTES | DESPUÉS / conservar | Talle / semántica | Estado |
| --- | --- | --- | --- | --- |
| Argentina\Argentina 2026 CM | 0nomARIAS ARG26_0001_T1-DORSO.png | 0nomARIAS ACM26_0001_T1-DORSO.png | T1 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 CM | 0nomBONI ARG26_0015_T8-DORSO.png | 0nomBONI ACM26_0015_T8-DORSO.png | T8 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 CM | 0nomDINA ARG26_0005_T3-DORSO.png | 0nomDINA ACM26_0005_T3-DORSO.png | T3 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 CM | 0nomPOTTER ARG26_0015_T8-DORSO.png | 0nomPOTTER ACM26_0015_T8-DORSO.png | T8 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 CM | 0nomROCCO ARG26_0013_T7-DORSO.png | 0nomROCCO ACM26_0013_T7-DORSO.png | T7 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 Especial | 0nomBENJI ARG26E_0019_T10-DORSO.png | 0nomBENJI ARE26_0019_T10-DORSO.png | T10 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 Especial | 0nomCHICHA ARG26E_0009_T5-DORSO.png | 0nomCHICHA ARE26_0009_T5-DORSO.png | T5 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 Suplente | 0nomBILLY ARG26S_0013_T7-DORSO.png | 0nomBILLY ARS26_0013_T7-DORSO.png | T7 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 Suplente | 0nomOSO ARG26S_0011_T6-DORSO.png | 0nomOSO ARS26_0011_T6-DORSO.png | T6 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Argentina\Argentina 2026 Suplente CM | 00aanomINDIO ARG26SM_0011_T6-DORSO.png | 00aanomINDIO ASC26_0011_T6-DORSO.png | T6 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Boca\Boca 2025 | 0nomNERON BJ25_0005_T3-DORSO.png | 0nomNERON BJ25_0005_T3-DORSO.png | T3 / BACK reposición | CONSERVAR |
| Boca\Boca 2025 | 0nomPAREDES BJ25_0009_T5-DORSO.png | 0nomPAREDES BJ25_0009_T5-DORSO.png | T5 / BACK reposición | CONSERVAR |
| Boca\Boca 2025 | 0nomPATAN BJ25_0011_T6-DORSO.png | 0nomPATAN BJ25_0011_T6-DORSO.png | T6 / BACK reposición | CONSERVAR |
| Boca\Boca 2026 | 00aanomSAM BJ26-TX-FRENTE.png | Sin propuesta | Inválido: TX | MANUAL |
| Boca\Boca 2026 | 0nomSAM BJ26_0005_TX-DORSO.png | Sin propuesta | Inválido: TX | MANUAL |
| Independiente\Independiente 2025 | 00aanomHECTOR IND25_XXXX_T10-DORSO.png | 00aanomHECTOR IND25_XXXX_T10-DORSO.png | T10 / BACK reposición | CONSERVAR |
| Independiente\Independiente 2025 | 00aanomPOTTER IND25_XXXX_T8-DORSO.png | 00aanomPOTTER IND25_XXXX_T8-DORSO.png | T8 / BACK reposición | CONSERVAR |
| Maria Becerra | 0nomCHICHA MBE_0009_T5-DORSO.png | 0nomCHICHA MBE_0009_T5-DORSO.png | T5 / BACK reposición | CONSERVAR |
| Newells | 0nomMAXIMO NEW_0007_T4-DORSO.png | 0nomMAXIMO NEW_0007_T4-DORSO.png | T4 / BACK reposición | CONSERVAR |
| Newells | 0nomUMA NEW_0005_T3-DORSO.png | 0nomUMA NEW_0005_T3-DORSO.png | T3 / BACK reposición | CONSERVAR |
| Platense | 0nomBIANCA PLAT26_0011_T6-DORSO.png | 0nomBIANCA PLA26_0011_T6-DORSO.png | T6 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Platense | 0nomPIPA PLAT26_0011_T6-DORSO.png | 0nomPIPA PLA26_0011_T6-DORSO.png | T6 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Platense | 0nomPIPO PLAT26_0011_T6-DORSO.png | 0nomPIPO PLA26_0011_T6-DORSO.png | T6 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Platense | 0nomROCKY PLAT26_0019_T10-DORSO.png | 0nomROCKY PLA26_0019_T10-DORSO.png | T10 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Platense | 0nomSTITCH PLAT26_0005_T3-DORSO.png | 0nomSTITCH PLA26_0005_T3-DORSO.png | T3 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Platense | 0nomTINA PLAT26_0013_T7-DORSO.png | 0nomTINA PLA26_0013_T7-DORSO.png | T7 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Platense | 0nomZOE PLAT26_0013_T7-DORSO.png | 0nomZOE PLA26_0013_T7-DORSO.png | T7 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Racing\Racing 2024 | 0nomPEPITA RA24_0013_T7-DORSO.png | 0nomPEPITA RAC24_0013_T7-DORSO.png | T7 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Racing\Racing 2024 | 0nomPITUKA RA24_0009_T5-DORSO.png | 0nomPITUKA RAC24_0009_T5-DORSO.png | T5 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| Racing\Racing 2026 | 00aanomAINHOA RAC26_0013_T7-DORSO.png | 00aanomAINHOA RAC26_0013_T7-DORSO.png | T7 / BACK reposición | CONSERVAR |
| River\River 2023 | 0nomALBI RI23_0011_T6-DORSO.png | 0nomALBI RIV23_0011_T6-DORSO.png | T6 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| River\River 2024 | 0nomTHOMAS RI24_0007_T4-DORSO.png | 0nomTHOMAS RIV24_0007_T4-DORSO.png | T4 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| River\River 2025 | 0nomTEO RI25_0005_T3-DORSO.png | 0nomTEO RIV25_0005_T3-DORSO.png | T3 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| San Lorenzo\San Lorenzo 2025 | 0nomADOLFITO SL25_0007_T4-DORSO.png | 0nomADOLFITO SLO25_0007_T4-DORSO.png | T4 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| San Lorenzo\San Lorenzo 2025 | 0nomCONNIE SL25_0001_T1-DORSO.png | 0nomCONNIE SLO25_0001_T1-DORSO.png | T1 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| San Lorenzo\San Lorenzo 2025 | 0nomCONNIE SL25_0009_T5-DORSO.png | 0nomCONNIE SLO25_0009_T5-DORSO.png | T5 / BACK reposición | PROPUESTA MANUAL SEGURA POR PARSER |
| San Lorenzo\San Lorenzo 2026 | 0nomCHICHA SLO26_0009_T5-DORSO.png | 0nomCHICHA SLO26_0009_T5-DORSO.png | T5 / BACK reposición | CONSERVAR |
| San Lorenzo\San Lorenzo 2026 | 0nomFIRULAIS SLO26_0007_T4-DORSO.png | 0nomFIRULAIS SLO26_0007_T4-DORSO.png | T4 / BACK reposición | CONSERVAR |
| San Lorenzo\San Lorenzo 2026 | 0nomHAKU SLO26_0013_T7-DORSO.png | 0nomHAKU SLO26_0013_T7-DORSO.png | T7 / BACK reposición | CONSERVAR |
| San Lorenzo\San Lorenzo 2026 | 0nomPICHU SLO26_0015_T8-DORSO.png | 0nomPICHU SLO26_0015_T8-DORSO.png | T8 / BACK reposición | CONSERVAR |
| San Lorenzo\San Lorenzo 2026 | 0nomTANGUITO SLO26_0011_T6-DORSO.png | 0nomTANGUITO SLO26_0011_T6-DORSO.png | T6 / BACK reposición | CONSERVAR |
| San Lorenzo\San Lorenzo Escudo | 0nomFIRULAIS SLE_0007_T4-DORSO.png | 0nomFIRULAIS SLE_0007_T4-DORSO.png | T4 / BACK reposición | CONSERVAR |
| Velez | 0nomARIAS VEL_0000_T1-FRENTE.png | 0nomARIAS VEL_0000_T1-FRENTE.png | T1 / BACK reposición | CONSERVAR |
| Velez | 0nomARIAS VEL_0001_T1-DORSO.png | 0nomARIAS VEL_0001_T1-DORSO.png | T1 / BACK reposición | CONSERVAR |
| Velez | 0nomARIAS VEL_0003_T2-DORSO.png | 0nomARIAS VEL_0003_T2-DORSO.png | T2 / BACK reposición | CONSERVAR |

Se conserva `XXXX` en los personalizados de Independiente 2025 porque nom usa el token de talle, no exige la secuencia canónica. Se conserva el texto FRENTE del nom de Velez aunque la semántica productiva sea BACK; no se corrige contenido a partir del nombre.

### Incompletos y talles

| Carpeta | Talles encontrados (canónico o nom válido) | FRONT / BACK canónicos | Slots faltantes |
| --- | --- | --- | --- |
| Aldosivi | T5 | 1 / 1 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T6-F, T6-D, T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |
| Argentina\Argentina 2006 | Ninguno | 0 / 0 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T5-F, T5-D, T6-F, T6-D, T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |
| Argentina\Argentina 2026 Especial 2 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Argentina\Argentina Prematch | T1, T7, T8 | 2 / 3 | T1-F, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T5-F, T5-D, T6-F, T6-D, T9-F, T9-D, T10-F, T10-D |
| Argentinos Juniors\Argentinos Juniors Clasica | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Arsenal | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Boca\Boca 2023 | T1, T2, T3, T4, T5, T6 | 6 / 6 | T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |
| Boca\Boca 2024 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Boca\Boca 2025 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Boca\Boca Firma | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Boca\Boca Retro | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Boca\Boca Rosa | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Boca\Boca Siempre Mono | Ninguno | 0 / 0 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T5-F, T5-D, T6-F, T6-D, T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |
| Gimnasia | Ninguno | 0 / 0 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T5-F, T5-D, T6-F, T6-D, T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |
| Inter Miami | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 9 / 10 | T1-F |
| Laferrere | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| MandalasA | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Maria Becerra | T5 | 1 / 0 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T5-D, T6-F, T6-D, T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |
| Newells | T3, T4, T8 | 3 / 2 | T1-F, T1-D, T2-F, T2-D, T4-D, T5-F, T5-D, T6-F, T6-D, T7-F, T7-D, T9-F, T9-D, T10-F, T10-D |
| Nueva Chicago | T4, T5, T6, T8, T10 | 5 / 5 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T7-F, T7-D, T9-F, T9-D |
| River\River 2023 | T6, T8 | 2 / 0 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T5-F, T5-D, T6-D, T7-F, T7-D, T8-D, T9-F, T9-D, T10-F, T10-D |
| River\River 2024 | T1, T2, T3, T4, T5, T6, T7, T8 | 7 / 8 | T8-F, T9-F, T9-D, T10-F, T10-D |
| River\River 2025 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| River\River Violeta | T2, T5 | 2 / 2 | T1-F, T1-D, T3-F, T3-D, T4-F, T4-D, T6-F, T6-D, T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |
| San Lorenzo\San Lorenzo 2025 | T1, T4, T5, T6, T8 | 4 / 2 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-D, T5-D, T7-F, T7-D, T9-F, T9-D, T10-F, T10-D |
| Tigre\Tigre 2024 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Velez | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | T9-F, T9-D, T10-F, T10-D |
| Venezuela | T5 | 1 / 1 | T1-F, T1-D, T2-F, T2-D, T3-F, T3-D, T4-F, T4-D, T6-F, T6-D, T7-F, T7-D, T8-F, T8-D, T9-F, T9-D, T10-F, T10-D |

Renombrar no completa estos diseños. En JSON se listan por separado FRONT, BACK, maestros y nom, para evitar atribuir talles a maestros sin T.

### PNG fuera de diseños y legados

| Rama | Carpetas con PNG no reconocibles directos | PNG |
| --- | --- | --- |
| .assets | 15 | 94 |
| .bolsas | 1 | 1 |
| .fanaticotas | 20 | 108 |
| .gomitas | 9 | 9 |
| .pedidos | 1 | 1 |
| .rsc | 1 | 149 |
| .zabanicos | 1 | 1 |
| Adoptame | 1 | 2 |
| Aldosivi | 1 | 2 |
| Almirante Brown | 1 | 2 |
| Argentina | 10 | 20 |
| Argentinos Juniors | 1 | 2 |
| Arsenal | 1 | 2 |
| Atlanta | 1 | 2 |
| Banfield | 1 | 2 |
| Batman | 1 | 2 |
| Boca | 11 | 22 |
| Buenos Aires | 3 | 6 |
| Capitan America | 1 | 2 |
| Dragon Ball | 1 | 2 |
| Estudiantes | 1 | 2 |
| Frase | 1 | 2 |
| Gimnasia | 1 | 2 |
| Huracan | 1 | 2 |
| Independiente | 1 | 2 |
| Inter Miami | 1 | 2 |
| La Renga | 1 | 2 |
| Laferrere | 1 | 2 |
| Los Redondos | 1 | 2 |
| Mafalda | 1 | 2 |
| Malvinas | 1 | 2 |
| MandalasA | 1 | 2 |
| Maria Becerra | 1 | 2 |
| Moron | 1 | 2 |
| Mujer Maravilla | 1 | 2 |
| Naruto | 1 | 2 |
| Navidad | 1 | 2 |
| Newells | 1 | 2 |
| Nueva Chicago | 1 | 2 |
| One Piece | 1 | 2 |
| Pantera Rosa | 1 | 2 |
| Pink Floyd | 1 | 2 |
| Platense | 1 | 2 |
| Racing | 2 | 4 |
| River | 6 | 12 |
| Rolling Stones | 1 | 2 |
| Rosario Central | 1 | 2 |
| San Lorenzo | 2 | 4 |
| Spiderman | 1 | 2 |
| Tasmania | 1 | 2 |
| Tigre | 2 | 4 |
| Velez | 1 | 2 |
| Venezuela | 1 | 2 |

No se renombran estos 513 recursos. El JSON incluye su inventario completo. La carpeta oculta `.fanaticotas` dentro de la raíz es un proyecto web con dependencias/renders; se recorrió y no aporta diseños reconocibles según la convención.

Cabeceras incompatibles con PNG/IHDR (sólo recursos externos a diseños):

- `C:\Users\julian\Documents\.fanaticotas\.rsc\mujer maravilla corona.png`
- `C:\Users\julian\Documents\.fanaticotas\.rsc\rollingstones3.png`

### Validación de colisiones Windows

Se compararon códigos, basenames finales y rutas sin distinción de mayúsculas; también los destinos ocupados por cualquier archivo directo existente. Resultado: 0 códigos propuestos repetidos, 0 filenames finales repetidos, 0 rutas repetidas y 0 destinos ocupados por otro archivo. 339 filas ya tienen exactamente el nombre destino: conservar, no ejecutar un renombrado hacia sí mismas.

También se validaron destinos futuros de las tres sugerencias de carpeta y Dragon Ball: 0 colisiones. Las propuestas nom válidas no duplican entre sí sus basenames finales. Los 42 grupos actuales de filenames repetidos aparecen en JSON y corresponden a las familias ARG26/BJ26S; no son choques de path mientras estén en carpetas distintas.

## DRAGON BALL

Estructura real, sin otras carpetas que contengan Dragon Ball en el nombre:

```text
C:\Users\julian\Documents\.fanaticotas\
└── Dragon Ball\                       [contenedor: 0 archivos directos]
    └── Dragon Ball Z\                 [único diseño real]
        ├── 00000000mold Dragon Ball Z.psd
        ├── 00DBZ (F).png
        ├── 00DBZ (D).png
        ├── DBZ_0000_T1-FRENTE.png … DBZ_0019_T10-DORSO.png [20]
        └── catalog-render\
            ├── front.png
            └── back.png
```

| Dato | Resultado |
| --- | --- |
| Padre | C:\Users\julian\Documents\.fanaticotas\Dragon Ball |
| Hijo | C:\Users\julian\Documents\.fanaticotas\Dragon Ball\Dragon Ball Z |
| Destino solicitado | C:\Users\julian\Documents\.fanaticotas\Dragon Ball Z |
| Destino ya existe | No |
| Destino temporal ya existe | No |
| Directos en diseño | 22 PNG + 1 PSD; 20 canónicos completos + 2 maestros |
| Total recursivo | 24 PNG + 1 PSD = 25 archivos |
| Archivos duplicados por SHA-256 dentro de la rama | 0 |
| Assets en ambos niveles | No; únicamente en el hijo (renders en descendiente) |

**Ambigüedad:** Un único diseño dentro de un contenedor sin assets directos. Mover hijo a raíz ocupa Dragon Ball Z; renombrar luego padre al mismo nombre colisiona. Las dos instrucciones literales requieren decidir qué hacer con el contenedor. No se puede afirmar que ambas carpetas sean diseños ni que deban fusionarse.

### Plan manual recomendado, condicionado a confirmar un único diseño en raíz

1. Confirmar objetivo de un único diseño en raíz: C:\Users\julian\Documents\.fanaticotas\Dragon Ball Z.
2. Recomprobar que C:\Users\julian\Documents\.fanaticotas\Dragon Ball Z y C:\Users\julian\Documents\.fanaticotas\Dragon Ball - contenedor pendiente no existen.
3. Renombrar manualmente el contenedor C:\Users\julian\Documents\.fanaticotas\Dragon Ball a C:\Users\julian\Documents\.fanaticotas\Dragon Ball - contenedor pendiente. No es un diseño.
4. Mover íntegramente C:\Users\julian\Documents\.fanaticotas\Dragon Ball - contenedor pendiente\Dragon Ball Z a C:\Users\julian\Documents\.fanaticotas\Dragon Ball Z. Incluir PSD, 22 PNG y catalog-render.
5. Verificar 23 archivos directos (22 PNG + 1 PSD), catalog-render con 2 PNG y los 25 SHA-256; conservar código DBZ y filenames.
6. Conservar contenedor ahora vacío como pendiente. No renombrarlo a Dragon Ball Z, destino ocupado; decidir retiro o archivo por separado.
7. Revisar la nueva ruta en Biblioteca durante la actualización posterior.

Este plan mueve la carpeta de diseño íntegra una carpeta arriba y conserva el antiguo contenedor con un nombre pendiente. No cumple literalmente el segundo renombrado del contenedor a Dragon Ball Z: ese nombre quedaría ocupado por el diseño. La decisión humana necesaria es aceptar ese resultado o elegir la alternativa siguiente. No se proponen comandos ejecutables en esta auditoría.

### Alternativa si debe renombrarse el contenedor original

1. Si el contenedor original debe recibir el nombre: renombrar Dragon Ball a Dragon Ball Z (raíz libre).
2. Diseño temporalmente en C:\Users\julian\Documents\.fanaticotas\Dragon Ball Z\Dragon Ball Z.
3. Verificar que los 23 archivos directos y catalog-render del hijo no tengan destinos ocupados en el padre.
4. Subir esas 24 entradas completas al padre sin fusionar/sobrescribir; conservar subdirectorio hijo vacío como pendiente.
5. Verificar 25 hashes. Esta alternativa sube el contenido; no mueve literalmente la carpeta hijo.

En ambas alternativas se mantienen los 25 archivos, se conserva catalog-render y no se copian/mezclan assets. Antes de cada movimiento repetir la comprobación de destinos. Los 25 paths actuales y SHA-256 están en dragonBall.allFiles del JSON. El destino de renombre del padre y el de movimiento del hijo son el mismo: ése es el conflicto estructural a resolver.

## ORDEN DE EJECUCIÓN SUGERIDO

1. Resolver estructura Dragon Ball y confirmar identidades en colisiones ARG26/BJ26S. No ejecutar filas condicionadas hasta resolverlas.
2. Renombrar sólo carpetas cuya sugerencia se confirme: Arsenal/Platense/Venezuela. Revisar Rosario Central, CM/SM y MandalasA; no renombrar automáticamente.
3. Renombrar canónicos por el mapping JSON: cambiar únicamente código; conservar sequence/id, T1–T10, FRENTE/DORSO y sufijo exacto.
4. Renombrar maestros por su mapping separado: mantener 00 y (F)/(D). No añadir 00 a BJF (F)/(D) sin la decisión manual correspondiente.
5. Revisar los 45 nom individualmente. Aplicar sólo cambios de token explícito confirmados; conservar texto personalizado y talle; resolver TX sin adivinar.
6. Reimportar/actualizar Biblioteca después del trabajo manual. Revisar sourceFolderPath e identidad, especialmente después de mover/renombrar carpetas; rutas anteriores pueden requerir reconciliación.
7. Verificar con el parser actual que cada canónico mantiene mismo talle/lado, cada maestro sigue reconocido y cada nom válido sigue BACK de reposición.
8. Ejecutar auditoría final: unicidad global, destinos Windows sin distinción de mayúsculas, 20 slots esperados, maestros, nom, rutas y hashes de Dragon Ball.

Este orden es una propuesta posterior. No se ejecutó ninguno de los pasos. Verificación final de esta auditoría: 30246 archivos y 3161 directorios sin diferencias de path/tamaño/mtime respecto del recorrido inicial. Esto no equivale a un hash de contenido de todo el árbol.

## INVENTARIO POR DISEÑO

Parent y profundidad: la raíz tiene profundidad 0. El JSON contiene todas las listas PNG directas y sus prefijos literales, que complementan esta tabla compacta.

| Carpeta exacta | Path absoluto | Parent | Prof. | Prefijos literales actuales | Talles | FRONT / BACK | Maestros F / D | Completo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Adoptame | C:\Users\julian\Documents\.fanaticotas\Adoptame | C:\Users\julian\Documents\.fanaticotas | 1 | 00ADO | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Aldosivi | C:\Users\julian\Documents\.fanaticotas\Aldosivi | C:\Users\julian\Documents\.fanaticotas | 1 | 00ALD | T5 | 1 / 1 | 0 / 0 | No |
| Almirante Brown | C:\Users\julian\Documents\.fanaticotas\Almirante Brown | C:\Users\julian\Documents\.fanaticotas | 1 | 00ALMB | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 1994 | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 1994 | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG94 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 2006 | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2006 | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG06 | — | 0 / 0 | 1 / 1 | No |
| Argentina 2024 | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2024 | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG24 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 2026 | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 2026 CM | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 CM | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 2026 Especial | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Especial | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG26E | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 2026 Especial 2 | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Especial 2 | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG26E2 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 1 / 1 | No |
| Argentina 2026 Messi | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Messi | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARGM, ARGM | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 2026 Suplente | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Suplente | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG26S | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina 2026 Suplente CM | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina 2026 Suplente CM | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARG26SM, ARG26SM | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Argentina Prematch | C:\Users\julian\Documents\.fanaticotas\Argentina\Argentina Prematch | C:\Users\julian\Documents\.fanaticotas\Argentina | 2 | 00ARPM | T1, T7, T8 | 2 / 3 | 0 / 0 | No |
| Argentinos Juniors Clasica | C:\Users\julian\Documents\.fanaticotas\Argentinos Juniors\Argentinos Juniors Clasica | C:\Users\julian\Documents\.fanaticotas\Argentinos Juniors | 2 | 00AJCL | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Arsenal | C:\Users\julian\Documents\.fanaticotas\Arsenal | C:\Users\julian\Documents\.fanaticotas | 1 | 00AS25 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Atlanta | C:\Users\julian\Documents\.fanaticotas\Atlanta | C:\Users\julian\Documents\.fanaticotas | 1 | 00ATL | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Banfield | C:\Users\julian\Documents\.fanaticotas\Banfield | C:\Users\julian\Documents\.fanaticotas | 1 | 00BANF | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Batman | C:\Users\julian\Documents\.fanaticotas\Batman | C:\Users\julian\Documents\.fanaticotas | 1 | 00BAT | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Boca 12 | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 12 | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00B12 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Boca 2023 | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2023 | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BJ23 | T1, T2, T3, T4, T5, T6 | 6 / 6 | 0 / 0 | No |
| Boca 2024 | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2024 | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BJ24 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Boca 2025 | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2025 | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BJ25 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Boca 2026 | C:\Users\julian\Documents\.fanaticotas\Boca\Boca 2026 | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BJ26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Boca Amarilla | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Amarilla | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BOCAM | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Boca Azul | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Azul | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BJAZ, BJAZ | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Boca Firma | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Firma | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BJF | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Boca Quilmes | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Quilmes | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BOQ, BJ26S | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Boca Retro | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Retro | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BRET | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Boca Rosa | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Rosa | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BROS | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Boca Siempre Mono | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Siempre Mono | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BSM | — | 0 / 0 | 1 / 1 | No |
| Boca Suplente 2026 | C:\Users\julian\Documents\.fanaticotas\Boca\Boca Suplente 2026 | C:\Users\julian\Documents\.fanaticotas\Boca | 2 | 00BJ26S, BJ26S | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Buenos Aires | C:\Users\julian\Documents\.fanaticotas\Buenos Aires\Buenos Aires | C:\Users\julian\Documents\.fanaticotas\Buenos Aires | 2 | 00BA | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Buenos Aires 2 | C:\Users\julian\Documents\.fanaticotas\Buenos Aires\Buenos Aires 2 | C:\Users\julian\Documents\.fanaticotas\Buenos Aires | 2 | 00BA2 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Buenos Aires 3 | C:\Users\julian\Documents\.fanaticotas\Buenos Aires\Buenos Aires 3 | C:\Users\julian\Documents\.fanaticotas\Buenos Aires | 2 | 00BA3, BA3 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Bugs Bunny | C:\Users\julian\Documents\.fanaticotas\Bugs Bunny | C:\Users\julian\Documents\.fanaticotas | 1 | 00BBUG | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Capitan America | C:\Users\julian\Documents\.fanaticotas\Capitan America | C:\Users\julian\Documents\.fanaticotas | 1 | 00CAPA | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Claypole | C:\Users\julian\Documents\.fanaticotas\Claypole | C:\Users\julian\Documents\.fanaticotas | 1 | 00CLA, CLA | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Coraje | C:\Users\julian\Documents\.fanaticotas\Coraje | C:\Users\julian\Documents\.fanaticotas | 1 | 00COR, COR | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Dragon Ball Z | C:\Users\julian\Documents\.fanaticotas\Dragon Ball\Dragon Ball Z | C:\Users\julian\Documents\.fanaticotas\Dragon Ball | 2 | 00DBZ, DBZ | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Estudiantes | C:\Users\julian\Documents\.fanaticotas\Estudiantes | C:\Users\julian\Documents\.fanaticotas | 1 | 00EST, EST | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Frase | C:\Users\julian\Documents\.fanaticotas\Frase | C:\Users\julian\Documents\.fanaticotas | 1 | 00FRA | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Gimnasia | C:\Users\julian\Documents\.fanaticotas\Gimnasia | C:\Users\julian\Documents\.fanaticotas | 1 | 00GIM | — | 0 / 0 | 1 / 1 | No |
| Huracan | C:\Users\julian\Documents\.fanaticotas\Huracan | C:\Users\julian\Documents\.fanaticotas | 1 | 00HUR, HUR | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Independiente 2025 | C:\Users\julian\Documents\.fanaticotas\Independiente\Independiente 2025 | C:\Users\julian\Documents\.fanaticotas\Independiente | 2 | 00IND25, IND25 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Independiente 2026 | C:\Users\julian\Documents\.fanaticotas\Independiente\Independiente 2026 | C:\Users\julian\Documents\.fanaticotas\Independiente | 2 | 00IND26, IND26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Inter Miami | C:\Users\julian\Documents\.fanaticotas\Inter Miami | C:\Users\julian\Documents\.fanaticotas | 1 | 00IM | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 9 / 10 | 0 / 0 | No |
| La Renga | C:\Users\julian\Documents\.fanaticotas\La Renga | C:\Users\julian\Documents\.fanaticotas | 1 | 00LREN, LREN | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Laferrere | C:\Users\julian\Documents\.fanaticotas\Laferrere | C:\Users\julian\Documents\.fanaticotas | 1 | 00LAFE | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Los Andes | C:\Users\julian\Documents\.fanaticotas\Los Andes | C:\Users\julian\Documents\.fanaticotas | 1 | 00LAN, LAN | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Los Redondos | C:\Users\julian\Documents\.fanaticotas\Los Redondos | C:\Users\julian\Documents\.fanaticotas | 1 | 00REDO, REDO | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Mafalda | C:\Users\julian\Documents\.fanaticotas\Mafalda | C:\Users\julian\Documents\.fanaticotas | 1 | 00MAF | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Malvinas | C:\Users\julian\Documents\.fanaticotas\Malvinas | C:\Users\julian\Documents\.fanaticotas | 1 | 00MLV, MLV | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| MandalasA | C:\Users\julian\Documents\.fanaticotas\MandalasA | C:\Users\julian\Documents\.fanaticotas | 1 | 00MAND | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Maradona | C:\Users\julian\Documents\.fanaticotas\Maradona | C:\Users\julian\Documents\.fanaticotas | 1 | 00MDO, MDO | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Maria Becerra | C:\Users\julian\Documents\.fanaticotas\Maria Becerra | C:\Users\julian\Documents\.fanaticotas | 1 | 00MBE | T5 | 1 / 0 | 1 / 1 | No |
| Moron | C:\Users\julian\Documents\.fanaticotas\Moron | C:\Users\julian\Documents\.fanaticotas | 1 | 00MOR, MOR | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Mujer Maravilla | C:\Users\julian\Documents\.fanaticotas\Mujer Maravilla | C:\Users\julian\Documents\.fanaticotas | 1 | 00MMAR | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Naruto | C:\Users\julian\Documents\.fanaticotas\Naruto | C:\Users\julian\Documents\.fanaticotas | 1 | 00NAR | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Navidad | C:\Users\julian\Documents\.fanaticotas\Navidad | C:\Users\julian\Documents\.fanaticotas | 1 | 00NAV | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Newells | C:\Users\julian\Documents\.fanaticotas\Newells | C:\Users\julian\Documents\.fanaticotas | 1 | 00NEW | T3, T4, T8 | 3 / 2 | 0 / 0 | No |
| Nueva Chicago | C:\Users\julian\Documents\.fanaticotas\Nueva Chicago | C:\Users\julian\Documents\.fanaticotas | 1 | 00NCHI | T4, T5, T6, T8, T10 | 5 / 5 | 0 / 0 | No |
| One Piece G5 | C:\Users\julian\Documents\.fanaticotas\One Piece\One Piece G5 | C:\Users\julian\Documents\.fanaticotas\One Piece | 2 | 00OPG5 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Pantera Rosa | C:\Users\julian\Documents\.fanaticotas\Pantera Rosa | C:\Users\julian\Documents\.fanaticotas | 1 | 00PROS | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Pantera Rosa Boca | C:\Users\julian\Documents\.fanaticotas\Pantera Rosa Boca | C:\Users\julian\Documents\.fanaticotas | 1 | 00PRB, PRB | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Pink Floyd | C:\Users\julian\Documents\.fanaticotas\Pink Floyd | C:\Users\julian\Documents\.fanaticotas | 1 | 00PNK | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Platense | C:\Users\julian\Documents\.fanaticotas\Platense | C:\Users\julian\Documents\.fanaticotas | 1 | 00PLAT26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Racing 2024 | C:\Users\julian\Documents\.fanaticotas\Racing\Racing 2024 | C:\Users\julian\Documents\.fanaticotas\Racing | 2 | 00RA24 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Racing 2026 | C:\Users\julian\Documents\.fanaticotas\Racing\Racing 2026 | C:\Users\julian\Documents\.fanaticotas\Racing | 2 | 00RAC26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| River 2023 | C:\Users\julian\Documents\.fanaticotas\River\River 2023 | C:\Users\julian\Documents\.fanaticotas\River | 2 | 00RI23 | T6, T8 | 2 / 0 | 0 / 0 | No |
| River 2024 | C:\Users\julian\Documents\.fanaticotas\River\River 2024 | C:\Users\julian\Documents\.fanaticotas\River | 2 | 00RI24 | T1, T2, T3, T4, T5, T6, T7, T8 | 7 / 8 | 0 / 0 | No |
| River 2025 | C:\Users\julian\Documents\.fanaticotas\River\River 2025 | C:\Users\julian\Documents\.fanaticotas\River | 2 | 00RI25 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| River 2026 | C:\Users\julian\Documents\.fanaticotas\River\River 2026 | C:\Users\julian\Documents\.fanaticotas\River | 2 | 00RIV26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| River Suplente 2026 | C:\Users\julian\Documents\.fanaticotas\River\River Suplente 2026 | C:\Users\julian\Documents\.fanaticotas\River | 2 | 00RIV26S | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| River Violeta | C:\Users\julian\Documents\.fanaticotas\River\River Violeta | C:\Users\julian\Documents\.fanaticotas\River | 2 | 00RVIO | T2, T5 | 2 / 2 | 0 / 0 | No |
| Rolling Stones | C:\Users\julian\Documents\.fanaticotas\Rolling Stones | C:\Users\julian\Documents\.fanaticotas | 1 | 00RLS | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Rosario Central | C:\Users\julian\Documents\.fanaticotas\Rosario Central | C:\Users\julian\Documents\.fanaticotas | 1 | 00RC26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| San Lorenzo 2025 | C:\Users\julian\Documents\.fanaticotas\San Lorenzo\San Lorenzo 2025 | C:\Users\julian\Documents\.fanaticotas\San Lorenzo | 2 | 00SL25 | T1, T4, T5, T6, T8 | 4 / 2 | 0 / 0 | No |
| San Lorenzo 2026 | C:\Users\julian\Documents\.fanaticotas\San Lorenzo\San Lorenzo 2026 | C:\Users\julian\Documents\.fanaticotas\San Lorenzo | 2 | 00SLO26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| San Lorenzo Escudo | C:\Users\julian\Documents\.fanaticotas\San Lorenzo\San Lorenzo Escudo | C:\Users\julian\Documents\.fanaticotas\San Lorenzo | 2 | 00SLE, SLE | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Spiderman | C:\Users\julian\Documents\.fanaticotas\Spiderman | C:\Users\julian\Documents\.fanaticotas | 1 | 00SPID | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Tasmania | C:\Users\julian\Documents\.fanaticotas\Tasmania | C:\Users\julian\Documents\.fanaticotas | 1 | 00TASM | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 0 / 0 | Sí |
| Tigre 2024 | C:\Users\julian\Documents\.fanaticotas\Tigre\Tigre 2024 | C:\Users\julian\Documents\.fanaticotas\Tigre | 2 | 00TI24 | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Tigre 2026 | C:\Users\julian\Documents\.fanaticotas\Tigre\Tigre 2026 | C:\Users\julian\Documents\.fanaticotas\Tigre | 2 | 00TIG26 | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10 | 10 / 10 | 1 / 1 | Sí |
| Velez | C:\Users\julian\Documents\.fanaticotas\Velez | C:\Users\julian\Documents\.fanaticotas | 1 | 00VEL | T1, T2, T3, T4, T5, T6, T7, T8 | 8 / 8 | 0 / 0 | No |
| Venezuela | C:\Users\julian\Documents\.fanaticotas\Venezuela | C:\Users\julian\Documents\.fanaticotas | 1 | 00VE26 | T5 | 1 / 1 | 0 / 0 | No |

## ARCHIVOS DEL REPORTE

- `docs/asset-naming-audit.md`: guía manual, tabla de 86 propuestas, casos, nom, estructura y orden.
- `docs/asset-naming-audit.json`: inventario exacto del árbol, archivos por diseño, prefijos, slots, mappings, conflictos, hashes y validaciones.
- `docs/asset-naming-audit.csv`: una fila por diseño, sin expandir un registro por PNG. png_count = total directo; afectados y nom están en notes.
