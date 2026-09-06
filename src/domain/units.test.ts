import { describe, expect, it } from 'vitest';
import {
  cm,
  inchesFromMillimeters,
  millimetersFromCentimeters,
  millimetersFromInches,
  mm,
  pixelsFromMillimeters,
  inches,
} from './units';

describe('unidades físicas', () => {
  it('convierte centímetros a milímetros', () => {
    expect(millimetersFromCentimeters(cm(148))).toBe(1480);
    expect(millimetersFromCentimeters(cm(100))).toBe(1000);
    expect(millimetersFromCentimeters(cm(500))).toBe(5000);
  });

  it('convierte pulgadas y milímetros correctamente', () => {
    expect(millimetersFromInches(inches(1))).toBe(25.4);
    expect(inchesFromMillimeters(mm(25.4))).toBe(1);
  });

  it('convierte una medida física a píxeles usando PPI', () => {
    expect(pixelsFromMillimeters(mm(25.4), 300)).toBe(300);
  });

  it('calcula correctamente 148 cm a 300 PPI', () => {
    expect(pixelsFromMillimeters(mm(1480), 300)).toBe(17480);
  });

  it('rechaza valores negativos', () => {
    expect(() => mm(-1)).toThrow();
    expect(() => cm(-1)).toThrow();
  });

  it('rechaza valores no finitos', () => {
    expect(() => mm(Number.NaN)).toThrow();
    expect(() => mm(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('rechaza PPI inválido', () => {
    expect(() => pixelsFromMillimeters(mm(100), 0)).toThrow();
    expect(() => pixelsFromMillimeters(mm(100), -300)).toThrow();
  });
});
