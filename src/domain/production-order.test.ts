import { expect, it } from 'vitest';
import { parseOrderText, quantitiesFromOrder } from './order-import';
import { PRODUCTION_ORDER } from '../test/production-order-2026-10-01';

it('parses the October 1 productive order as 641 garments / 1282 pieces with actual folder spellings', () => {
  const names = ['Argentina 2024', 'Argentina 2026 Messi', 'Banfield', 'Batman', 'Boca 2026', 'Boca Amarilla', 'Boca Azul', 'Boca Quilmes', 'Boca Suplente 2026', 'Buenos Aires', 'Buenos Aires 2', 'Buenos Aires 3', 'Claypole', 'Coraje', 'Frase', 'Huracan', 'Independiente 2026', 'La Renga', 'Los Andes', 'Los Redondos', 'Mafalda', 'Malvinas', 'Maradona', 'Moron', 'Mujer Maravilla', 'Pantera Rosa Boca', 'River 2026', 'Rolling Stones', 'San Lorenzo 2026', 'Spiderman'];
  const parsed = parseOrderText(PRODUCTION_ORDER, names.map((name, index) => ({ name, id: String(index) })));
  expect(parsed.errors).toEqual([]);
  expect(parsed.confirmable).toBe(true);
  expect(parsed.lines).toHaveLength(30);
  expect(parsed.totalGarments).toBe(641);
  expect(parsed.totalPieces).toBe(1282);
  expect(parsed.lines.reduce((total, line) => total + Object.values(line.quantities).filter(quantity => quantity > 0).length * 2, 0)).toBe(372);
  expect(parsed.lines.find(line => line.designName === 'Boca 2026')?.quantities).toEqual({ T1: 5, T2: 5, T3: 7, T4: 5, T5: 7, T6: 6, T7: 7, T8: 6, T9: 0, T10: 0 });
  expect(parsed.lines.find(line => line.designName === 'Boca Quilmes')?.quantities).toEqual({ T1: 1, T2: 1, T3: 1, T4: 1, T5: 1, T6: 1, T7: 1, T8: 1, T9: 0, T10: 0 });
});

it('replaces pre-existing garment quantities with exactly the imported 641-garment order', () => {
  const names = ['Argentina 2024', 'Argentina 2026 Messi', 'Banfield', 'Batman', 'Boca 2026', 'Boca Amarilla', 'Boca Azul', 'Boca Quilmes', 'Boca Suplente 2026', 'Buenos Aires', 'Buenos Aires 2', 'Buenos Aires 3', 'Claypole', 'Coraje', 'Frase', 'Huracan', 'Independiente 2026', 'La Renga', 'Los Andes', 'Los Redondos', 'Mafalda', 'Malvinas', 'Maradona', 'Moron', 'Mujer Maravilla', 'Pantera Rosa Boca', 'River 2026', 'Rolling Stones', 'San Lorenzo 2026', 'Spiderman'];
  const designs = names.map((name, index) => ({ name, id: String(index) }));
  const preview = parseOrderText(PRODUCTION_ORDER, designs);
  const priorBatch = Object.fromEntries(designs.map(design => [design.id, Object.fromEntries(
    ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].map(size => [size, 1]),
  )]));

  expect(Object.values(priorBatch).flatMap(sizes => Object.values(sizes as object)).reduce((total, quantity) => total + Number(quantity), 0)).toBe(300);
  const next = quantitiesFromOrder(preview, designs);
  const garmentCount = Object.values(next).flatMap(sizes => Object.values(sizes)).reduce((total, quantity) => total + quantity, 0);

  expect(preview.totalGarments).toBe(641);
  expect(garmentCount).toBe(641);
  expect(garmentCount * 2).toBe(1282);
  for (const design of designs) {
    const imported = preview.lines.find(line => line.collectionId === design.id);
    expect(next[design.id]).toEqual(imported?.quantities ?? Object.fromEntries(
      ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].map(size => [size, 0]),
    ));
  }
});
