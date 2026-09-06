# Captura temporal para aislar 11 → 10 layouts

No existe commit/reflog ni input guardado que vincule inequívocamente un código
con los 11 layouts observados. Las referencias sintéticas existentes NO son ese batch.
No se cambió el motor ni se declaró correcto el resultado actual.

## Capturar el batch real

En DevTools de la app que ejecuta este source (Console, contexto de la página principal), antes de optimizar:

```js
globalThis.__nestraNestingCapture = { enabled: true, runs: [] };
```

Ejecutar la misma colección: T1–T8 = 5 cada talle, T9–T10 = 4 cada talle,
IMPRENTA 1480 × 1000 mm, step 10, 96 piezas incluyendo frente/dorso.
Repetir sin cambiar selección ni configuración. No recargar la página entre ambas corridas.

```js
globalThis.__nestraNestingCapture.runs.map(({ json, ...comparison }) => ({
  ...comparison, pieces: JSON.parse(json).pieces.length
}));
globalThis.__nestraNestingCapture.error;
```

`sameInputAsPrevious` compara el JSON exacto, incluidos IDs, orden y rotaciones.
`sameGeometryAndOrderAsPrevious` compara canvas, step, polígonos y orden de piezas/rotaciones,
excluyendo solamente IDs y el flag del profiler. Esto distingue IDs regenerados de cambios
geométricos; no reordena ni redondea puntos. El primer resultado tiene comparaciones null.
Se retienen las últimas cuatro invocaciones al Worker; cada tela produce una invocación.
Para el batch de una tela, comparar las dos últimas capturas.

Guardar cada input por separado usando el helper `copy` de la consola de DevTools:

```js
copy(globalThis.__nestraNestingCapture.runs.at(-2).json);
// Pegar en un archivo de texto y guardarlo como batch-real-run-1.json.
copy(globalThis.__nestraNestingCapture.runs.at(-1).json);
// Pegar en otro archivo y guardarlo como batch-real-run-2.json.
globalThis.__nestraNestingCapture.enabled = false;
```

La captura es opt-in, en memoria, fuera del Worker y antes del reloj de round-trip.
Serializa el input preparado en mm; el cliente sigue enviando el MISMO objeto a postMessage.
No retiene referencias a los polígonos, no cambia caches ni toca el hot loop. La serialización
consume tiempo/memoria del hilo principal: no usar el tiempo total de UI como benchmark
sin considerar ese costo. El Worker conserva su medición propia. Recargar borra la captura.

Con los JSON disponibles, comparar primero su estabilidad y luego ejecutar el mismo input
contra las versiones históricas recuperadas y la actual. El benchmark existente acepta:

```text
node scripts/benchmark-nesting-profile.mjs ruta/al/batch-real-run-1.json
```

Ese benchmark compara on/off del motor actual en Node; por sí solo NO prueba restauración
del baseline real ni reproduce el tiempo de WebView2. No actualizar los hashes existentes
para congelar los 10 layouts. Falta localizar la primera decisión divergente y corroborar
los 11 layouts y todos sus contadores antes de declarar restauración.
