import type { Polygon } from './polygon';
import { polygonsOverlap } from './polygon-collision';
import {
  getPolygonBounds,
  transformPolygon,
  type PieceRotation,
  type PolygonPlacement,
} from './polygon-transform';
import { polygonFitsInsideCanvas } from './canvas-geometry';

export interface NestingCanvas {
  readonly width: number;
  readonly height: number;
}

export interface NestingInput {
  readonly polygon: Polygon;
  readonly quantity: number;
  readonly allowedRotations: readonly PieceRotation[];
  readonly canvas: NestingCanvas;
  readonly scanStepMm?: number;
}

export interface NestedPiece {
  readonly index: number;
  readonly placement: PolygonPlacement;
  readonly polygon: Polygon;
}

export interface NestingResult {
  readonly placed: readonly NestedPiece[];
  readonly unplacedCount: number;
  readonly usedWidth: number;
  readonly usedHeight: number;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validateInput(input: NestingInput): void {
  if (input.polygon.length < 3) {
    throw new Error('El polígono debe tener al menos 3 puntos.');
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new Error(
      'La cantidad debe ser un número entero mayor o igual a cero.',
    );
  }

  if (input.allowedRotations.length === 0) {
    throw new Error('Debe existir al menos una rotación permitida.');
  }

  if (
    !isPositiveFinite(input.canvas.width) ||
    !isPositiveFinite(input.canvas.height)
  ) {
    throw new Error('Las dimensiones del canvas deben ser mayores que cero.');
  }

  const scanStep = input.scanStepMm ?? 10;

  if (!isPositiveFinite(scanStep)) {
    throw new Error('La resolución de búsqueda debe ser mayor que cero.');
  }
}

function collidesWithPlaced(
  candidate: Polygon,
  placed: readonly NestedPiece[],
): boolean {
  return placed.some((piece) => polygonsOverlap(candidate, piece.polygon));
}

function findPlacement(
  polygon: Polygon,
  allowedRotations: readonly PieceRotation[],
  canvas: NestingCanvas,
  placed: readonly NestedPiece[],
  scanStepMm: number,
): {
  readonly placement: PolygonPlacement;
  readonly polygon: Polygon;
} | null {
  for (let y = 0; y <= canvas.height; y += scanStepMm) {
    for (let x = 0; x <= canvas.width; x += scanStepMm) {
      for (const rotation of allowedRotations) {
        const placement: PolygonPlacement = {
          x,
          y,
          rotation,
        };

        const transformed = transformPolygon(polygon, placement);

        if (!polygonFitsInsideCanvas(transformed, canvas)) {
          continue;
        }

        if (collidesWithPlaced(transformed, placed)) {
          continue;
        }

        return {
          placement,
          polygon: transformed,
        };
      }
    }
  }

  return null;
}

function calculateUsedBounds(placed: readonly NestedPiece[]): {
  readonly width: number;
  readonly height: number;
} {
  if (placed.length === 0) {
    return {
      width: 0,
      height: 0,
    };
  }

  let maxX = 0;
  let maxY = 0;

  for (const piece of placed) {
    const bounds = getPolygonBounds(piece.polygon);

    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  return {
    width: maxX,
    height: maxY,
  };
}

export function nestSinglePolygon(input: NestingInput): NestingResult {
  validateInput(input);

  const scanStepMm = input.scanStepMm ?? 10;
  const placed: NestedPiece[] = [];

  for (let index = 0; index < input.quantity; index += 1) {
    const result = findPlacement(
      input.polygon,
      input.allowedRotations,
      input.canvas,
      placed,
      scanStepMm,
    );

    if (!result) {
      break;
    }

    placed.push({
      index,
      placement: result.placement,
      polygon: result.polygon,
    });
  }

  const used = calculateUsedBounds(placed);

  return {
    placed,
    unplacedCount: input.quantity - placed.length,
    usedWidth: used.width,
    usedHeight: used.height,
  };
}
