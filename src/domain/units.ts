export type Millimeters = number & { readonly __brand: 'Millimeters' };
export type Centimeters = number & { readonly __brand: 'Centimeters' };
export type Inches = number & { readonly __brand: 'Inches' };
export type Pixels = number & { readonly __brand: 'Pixels' };

const MM_PER_CM = 10;
const MM_PER_INCH = 25.4;

function assertFiniteNonNegative(
  value: number,
  label: string,
): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} debe ser un número finito.`);
  }

  if (value < 0) {
    throw new Error(`${label} no puede ser negativo.`);
  }
}

export function mm(value: number): Millimeters {
  assertFiniteNonNegative(value, 'Milímetros');
  return value as Millimeters;
}

export function cm(value: number): Centimeters {
  assertFiniteNonNegative(value, 'Centímetros');
  return value as Centimeters;
}

export function inches(value: number): Inches {
  assertFiniteNonNegative(value, 'Pulgadas');
  return value as Inches;
}

export function millimetersFromCentimeters(value: Centimeters): Millimeters {
  return mm(value * MM_PER_CM);
}

export function centimetersFromMillimeters(value: Millimeters): Centimeters {
  return cm(value / MM_PER_CM);
}

export function millimetersFromInches(value: Inches): Millimeters {
  return mm(value * MM_PER_INCH);
}

export function inchesFromMillimeters(value: Millimeters): Inches {
  return inches(value / MM_PER_INCH);
}

export function pixelsFromMillimeters(value: Millimeters, ppi: number): Pixels {
  if (!Number.isFinite(ppi) || ppi <= 0) {
    throw new Error('PPI debe ser un número finito mayor que cero.');
  }

  const inchesValue = inchesFromMillimeters(value);

  return Math.round(inchesValue * ppi) as Pixels;
}
