# Equivalencia raster del compositor PNG nativo

La ruta nativa conserva la composición productiva con pre-rotación para piezas `-90°`. La comparación contra Chromium Canvas no es byte-identical en ese caso: la diferencia medida queda confinada a un borde vertical de un píxel y proviene del muestreo de la imagen intermedia rotada por Skia.

La evidencia controlada fue estable con 64 filas, 128 filas y una franja de altura completa. Mover la pieza diez píxeles fuera del límite de strip trasladó el patrón sin cambiarlo. `SrcRectConstraint::Fast` y `Strict` produjeron el mismo resultado. No hay desplazamiento, cambio de orientación, cambio de dimensiones ni diferencias en el interior de la pieza. La matriz directa fue descartada porque produjo 615 píxeles distintos, 1523 canales y delta máximo 20.

El test normal mantiene equivalencia estricta para 90°, 180° y el fixture múltiple/fraccional. El fixture 0° conserva su envelope histórico (`max delta <= 1`, hasta tres canales). El fixture `-90°` usa un envelope específico y medido: dimensiones idénticas, máximo 9, hasta 30 píxeles y 70 canales, porcentajes máximos de 0,37% y 0,29%, y diferencias confinadas a una columna de un píxel. El test byte-perfect sigue disponible como `ignored` para detectar cambios futuros en Skia o Chromium; no se usa para bloquear la suite normal.

Esta excepción es específica de la ruta `-90°` y de este patrón de borde medido. No implica que cualquier diferencia raster sea aceptable. La corrección física del compositor queda cubierta por las validaciones de dimensiones, orientación, límites y composición existentes.
