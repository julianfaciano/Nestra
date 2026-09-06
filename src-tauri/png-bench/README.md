# Benchmark interno PNG lossless

**Última prueba técnica cerrada:** [libdeflate con archivos mapeados](forensic-report/LIBDEFLATE-DECISION.md)
logró 38.123 MiB en 55.33 s, pero el working set alcanzó 572.82 MiB.
Decisión: **NO INTEGRAR**, por falta de RAM residente acotada para Calandra.
El candidato queda opt-in con `libdeflate-disk`; no cambia producción.

**Actualización forense:** ver [conclusión Original vs Oxipng](forensic-report/CONCLUSION.md).
El nuevo caso opt-in `bigrams` reproduce los filtros de Oxipng, pero solo logra
41.22 MiB con zlib-rs. La recomendación actual es no integrarlo. Este resultado
reemplaza la selección provisional de la medición inicial al final de esta página.
La matriz predeterminada de seis casos permanece igual.

Crate independiente, sin Tauri, Skia ni cambios al exportador. Su propio
`Cargo.lock` fija las dependencias. Ejecutar desde la raíz de Nestra en PowerShell:

```powershell
$png = 'path/to/input.png' # Reemplazar por el PNG que se desea analizar.
cargo run --release --locked --manifest-path src-tauri/png-bench/Cargo.toml -- $png
cargo run --release --locked --manifest-path src-tauri/png-bench/Cargo.toml --features png-zlib-rs -- $png
```

Ejecutar secuencialmente, sin otras cargas pesadas. Cada comando prueba seis casos.
Agregar un índice después de `$png` permite medir un solo caso. Por ejemplo,
`-- $png 0` mide la configuración actual; `-- $png 2` mide Adaptive nivel 9.
No usar builds debug para decidir. Para reproducir en esta máquina sin red se
puede agregar `--offline`. La compilación queda fuera del tiempo informado.

| Índice | Nivel | Filtro |
| --- | --- | --- |
| 0 | 9 | MinEntropy |
| 1 | 8 | MinEntropy |
| 2 | 9 | Adaptive |
| 3 | 9 | Sub |
| 4 | 9 | Up |
| 5 | 9 | Paeth |

API inspeccionada en el registry local: `png 0.18.1`, `flate2 1.1.10`.
`Filter::MinSum` no existe: `Adaptive` usa la suma de valores absolutos.
`DeflateCompression::Level` y `StreamWriter` usan flate2. El caso sin features
usa miniz_oxide, como el grafo actual de Nestra. La feature `png-zlib-rs` activa
`png/zlib-rs` → `flate2/zlib-rs`; el lock resuelve `zlib-rs 0.6.7`.
Aunque Cargo conserva la feature transitiva `rust_backend`, los `cfg` de
`flate2/src/ffi/mod.rs` seleccionan exclusivamente zlib-rs cuando `any_zlib`
está activo y no hay backend C. No hay dos backends ejecutándose ni selección
ambigua. El crate aislado evita unificación con features de la aplicación.

No se incluye zlib-ng: `flate2/zlib-ng` existe, pero requiere `libz-ng-sys`,
ausente del registry local, y una nueva cadena de compilación C/CMake.
Los backends incluidos usan licencias MIT/Apache-2.0; no hay binarios externos,
Oxipng, Pingo ni ECT.

## Memoria, integridad y alcance

- `Reader::next_row()` → `StreamWriter::write_all()`, sin `next_frame`, buffers
  de frame, cuantización ni cambios de píxeles. Solo PNG estático RGB8 sin Adam7.
- Se exige ancho ≤ 17480, alto ≤ 59055 y pHYs de 11811 × 11811, `Unit::Meter`.
  Entradas interlazadas, animadas, con transparencia tRNS o chunks no admitidos
  se rechazan explícitamente. No se intenta corregir un input incompatible.
- Los chunks admitidos están enumerados en `metadata()`: pHYs, perfiles/color,
  texto, EXIF y fecha. Se conservan sus payloads y posición antes/después de IDAT.
  CRC de metadatos verificado. Metadatos limitados a 4 MiB / 1024 chunks;
  ICC/texto se copian sin descomprimir. Chunks desconocidos, incluso PLTE
  opcional en RGB, provocan rechazo para evitar pérdida silenciosa.
- Buffers de archivo: 2 × 1 MiB. IDAT: 4096 bytes, igual al default productivo.
  Filas internas del codec: O(ancho), independientes del alto. Cada decoder
  recibe un presupuesto de 16 MiB; no es una medición de RSS ni una garantía
  sobre todas las asignaciones internas. La verificación abre dos decoders.
  Los metadatos del candidato pueden duplicar temporalmente los del input.
- Original abierto solo para lectura. Un `NamedTempFile` distinto por candidato
  en el directorio temporal del sistema; se borra al terminar/verificar o ante
  un error normal. Un cierre forzado del proceso puede dejar un temporal.
  Espacio en disco: un candidato comprimido por vez. No publica resultados PNG.
- Verificación obligatoria posterior: dimensiones, RGB8, ambos ejes/unidad
  de pHYs, todos los bytes de cada fila, metadatos y cierre de ambos streams.
  Cualquier diferencia informa INVALID y termina con código distinto de cero.
- CSV en stdout; progreso en stderr. `recompress_s` incluye lectura, decode,
  filtros, encode y flush (sin fsync); `verify_s` es separado. No equivale al
  tiempo de encode puro del exportador. El escaneo inicial de metadatos queda
  fuera del cronómetro. No hay timeout automático: usar un índice permite
  acotar cada ejecución. Los seis casos juntos pueden sumar varios minutos.

## Comprobaciones

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib png_export::tests
cargo test --manifest-path src-tauri/Cargo.toml --lib native_png::tests
cargo test --locked --manifest-path src-tauri/png-bench/Cargo.toml
cargo test --locked --manifest-path src-tauri/png-bench/Cargo.toml --features png-zlib-rs
```

Los tests nuevos recorren toda la matriz en un fixture chico con filas variadas,
gamma y texto posterior a IDAT; verifican rechazo de píxeles distintos, PPI
incorrecto y truncamiento, además de que el original permanece intacto.
Los tests existentes recibieron únicamente ajustes a la API 0.18 y el conteo
de franjas esperado según `STRIP_ROWS`; la configuración productiva no cambió.

## Medición inicial, 2026-09-06

Windows, rustc 1.98.1, release. Input indicado arriba: 45.968.800 bytes,
15817 × 11545 RGB8, fila de 47.451 bytes, pHYs correcto. Una pasada por caso:

| Backend | Nivel / filtro | Bytes | MiB | Reducción | Recompress s | Verify s |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| miniz_oxide | 9 / MinEntropy | 45968800 | 43.8393 | 0.0000% | 46.349 | 1.410 |
| zlib-rs | 9 / MinEntropy | 44121271 | 42.0773 | 4.0191% | 45.564 | 1.421 |
| zlib-rs | 9 / Adaptive | 44235251 | 42.1860 | 3.7711% | 46.331 | 16.197 |

Todos VALID, igualdad exacta de filas y metadatos. Los casos restantes están
implementados y cubiertos por fixtures, pero no medidos sobre este canvas.
Son tiempos preliminares: hubo compilaciones/tests durante parte de estas
ejecuciones; repetir secuencialmente sin otras cargas para comparar latencia
fina. No se midió RSS ni se ensayó el canvas máximo de ~3 GiB.

Selección provisional para una futura evaluación productiva: **zlib-rs nivel 9
con MinEntropy**, por la reducción de 4.02%, y **miniz_oxide nivel 9 con
MinEntropy** como control/fallback actual. Adaptive no mejoró el tamaño frente
a MinEntropy con zlib-rs. No afirmar un ganador global sin completar la matriz
y repetir sobre los otros canvases. Aún lejos de los 37.90 MiB de Oxipng -o2
reportados; no se agregó ningún post-pass ni se cambió producción.
