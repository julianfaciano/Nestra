import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const finePath = process.argv[2];
const simplifiedPath = process.argv[3];
const requestedStep = Number(process.argv[4] ?? 22.5);

if (!finePath || !simplifiedPath) {
  console.error(
    'Uso: node scripts/validate-fine-nesting.mjs <fine.json> <simplified.json> [scanStepMm]',
  );
  process.exit(1);
}

if (!Number.isFinite(requestedStep) || requestedStep <= 0) {
  throw new Error('scanStep inválido');
}

const fineInput = JSON.parse(
  readFileSync(finePath, 'utf8'),
);

const simplifiedInput = JSON.parse(
  readFileSync(simplifiedPath, 'utf8'),
);

if (fineInput.pieces.length !== simplifiedInput.pieces.length) {
  throw new Error(
    `Los inputs no tienen la misma cantidad de piezas: ` +
      `${fineInput.pieces.length} vs ${simplifiedInput.pieces.length}`,
  );
}

if (
  fineInput.canvas.width !== simplifiedInput.canvas.width ||
  fineInput.canvas.height !== simplifiedInput.canvas.height
) {
  throw new Error('Los inputs no usan el mismo canvas.');
}

/*
 * Los IDs cambian entre capturas, por eso emparejamos por posición
 * dentro del input. Verificamos además que las rotaciones permitidas
 * coincidan para detectar cualquier cambio de orden.
 */
for (let index = 0; index < fineInput.pieces.length; index += 1) {
  const finePiece = fineInput.pieces[index];
  const simplifiedPiece = simplifiedInput.pieces[index];

  const fineRotations = JSON.stringify(finePiece.allowedRotations);
  const simplifiedRotations = JSON.stringify(
    simplifiedPiece.allowedRotations,
  );

  if (fineRotations !== simplifiedRotations) {
    throw new Error(
      `El orden de piezas no coincide en índice ${index}: ` +
        `${fineRotations} vs ${simplifiedRotations}`,
    );
  }
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const { nestMultiplePieces } = await server.ssrLoadModule(
    '/src/geometry/multi-piece-nesting-engine.ts',
  );

  const {
    transformPolygon,
    getPolygonBounds,
  } = await server.ssrLoadModule(
    '/src/geometry/polygon-transform.ts',
  );

  const {
    polygonsOverlap,
    boundsOverlapWithArea,
  } = await server.ssrLoadModule(
    '/src/geometry/polygon-collision.ts',
  );

  const result = nestMultiplePieces({
    ...simplifiedInput,
    scanStepMm: requestedStep,
    diagnosticProfiling: false,
  });

  const simplifiedIndexById = new Map();

  simplifiedInput.pieces.forEach((piece, index) => {
    if (simplifiedIndexById.has(piece.id)) {
      throw new Error(`ID simplificado duplicado: ${piece.id}`);
    }

    simplifiedIndexById.set(piece.id, index);
  });

  const outOfCanvas = [];
  const overlaps = [];
  const EPSILON = 1e-7;

  /*
   * Medimos también cuánto cambian los bounds de origen
   * entre 1.5 px y 3 px.
   */
  let maxSourceBoundsDriftMm = 0;

  for (let index = 0; index < fineInput.pieces.length; index += 1) {
    const fineBounds = getPolygonBounds(
      fineInput.pieces[index].polygon,
    );

    const simplifiedBounds = getPolygonBounds(
      simplifiedInput.pieces[index].polygon,
    );

    const drift = Math.max(
      Math.abs(fineBounds.minX - simplifiedBounds.minX),
      Math.abs(fineBounds.minY - simplifiedBounds.minY),
      Math.abs(fineBounds.maxX - simplifiedBounds.maxX),
      Math.abs(fineBounds.maxY - simplifiedBounds.maxY),
    );

    maxSourceBoundsDriftMm = Math.max(
      maxSourceBoundsDriftMm,
      drift,
    );
  }

  for (const layout of result.layouts) {
    const finePlaced = [];

    for (const nestedPiece of layout.pieces) {
      const sourceIndex = simplifiedIndexById.get(
        nestedPiece.pieceId,
      );

      if (sourceIndex === undefined) {
        throw new Error(
          `No se encontró pieceId ${nestedPiece.pieceId}`,
        );
      }

      const fineSource = fineInput.pieces[sourceIndex];

      const polygon = transformPolygon(
        fineSource.polygon,
        nestedPiece.placement,
      );

      const bounds = getPolygonBounds(polygon);

      if (
        bounds.minX < -EPSILON ||
        bounds.minY < -EPSILON ||
        bounds.maxX > fineInput.canvas.width + EPSILON ||
        bounds.maxY > fineInput.canvas.height + EPSILON
      ) {
        outOfCanvas.push({
          layout: layout.index,
          pieceId: nestedPiece.pieceId,
          sourceIndex,
          bounds,
        });
      }

      finePlaced.push({
        pieceId: nestedPiece.pieceId,
        sourceIndex,
        polygon,
        bounds,
      });
    }

    for (
      let firstIndex = 0;
      firstIndex < finePlaced.length;
      firstIndex += 1
    ) {
      const first = finePlaced[firstIndex];

      for (
        let secondIndex = firstIndex + 1;
        secondIndex < finePlaced.length;
        secondIndex += 1
      ) {
        const second = finePlaced[secondIndex];

        if (
          !boundsOverlapWithArea(
            first.bounds,
            second.bounds,
          )
        ) {
          continue;
        }

        if (
          polygonsOverlap(
            first.polygon,
            second.polygon,
            first.bounds,
            second.bounds,
          )
        ) {
          overlaps.push({
            layout: layout.index,
            firstPieceId: first.pieceId,
            firstSourceIndex: first.sourceIndex,
            secondPieceId: second.pieceId,
            secondSourceIndex: second.sourceIndex,
          });
        }
      }
    }
  }

  console.log('');
  console.log(
    '===== NESTRA — VALIDACIÓN FINA DE NESTING =====',
  );
  console.log(`Fine input ................. ${finePath}`);
  console.log(`Fast input ................. ${simplifiedPath}`);
  console.log(
    `Scan step .................. ${requestedStep} mm`,
  );
  console.log('');
  console.log(
    `Layouts rápidos ............ ${result.layouts.length}`,
  );
  console.log(
    `Piezas colocadas ........... ${result.placedCount}`,
  );
  console.log(
    `Sin colocar ................ ${result.unplacedPieceIds.length}`,
  );
  console.log('');
  console.log(
    `Máx drift bounds origen .... ${maxSourceBoundsDriftMm.toFixed(4)} mm`,
  );
  console.log(
    `Fuera de canvas (1.5 px) ... ${outOfCanvas.length}`,
  );
  console.log(
    `Overlaps reales (1.5 px) ... ${overlaps.length}`,
  );

  if (outOfCanvas.length > 0) {
    console.log('');
    console.log('FUERA DE CANVAS:');
    console.table(outOfCanvas.slice(0, 20));
  }

  if (overlaps.length > 0) {
    console.log('');
    console.log('OVERLAPS:');
    console.table(overlaps.slice(0, 20));
  }

  console.log('');

  if (
    result.unplacedPieceIds.length === 0 &&
    outOfCanvas.length === 0 &&
    overlaps.length === 0
  ) {
    console.log(
      'RESULTADO ................... PASS ✓',
    );
    console.log(
      'El nesting de 3 px es válido usando los contornos finos de 1.5 px.',
    );
  } else {
    console.log(
      'RESULTADO ................... FAIL ✗',
    );
    console.log(
      'La solución rápida necesita margen o una segunda etapa de ajuste.',
    );
    process.exitCode = 2;
  }

  console.log(
    '==============================================',
  );
  console.log('');
} finally {
  await server.close();
}