import { describe, expect, it } from 'vitest';
import { parseOrderText, quantitiesFromOrder } from './order-import';

const designs = [
  { id: 'boca', name: 'Boca 2026' },
  { id: 'racing', name: 'Racing 2026' },
  { id: 'san-lorenzo', name: 'San Lorenzo 2026' },
];

describe('parseOrderText', () => {
  it('parses semicolon-separated entries, tolerant spaces, case, accents and T10; omitted sizes are zero', () => {
    const preview = parseOrderText('  boca   2026  t1 = 3, T10=2; RACING 2026 T7=1, t8 = 2; San Lorénzo 2026 t4=1;', designs);
    expect(preview.confirmable).toBe(true);
    expect(preview.lines[0]?.quantities).toMatchObject({ T1: 3, T2: 0, T10: 2 });
    expect(preview.lines[1]?.quantities).toMatchObject({ T7: 1, T8: 2 });
    expect(preview.lines[2]?.collectionId).toBe('san-lorenzo');
  });

  it.each(['t1=-1', 't1=1.5', 'basura t1=3', 't11=1', 't1=999999999999999999999999'])('rejects invalid token %s', token => {
    expect(parseOrderText(`Boca 2026 ${token}`, designs).confirmable).toBe(false);
  });

  it('rejects unknown, ambiguous and duplicate designs, and duplicate or empty sizes', () => {
    expect(parseOrderText('Desconocido 2026 t1=1', designs).lines[0]?.errors[0]).toContain('Diseño no encontrado');
    expect(parseOrderText('Boca t1=1', [...designs, { id: 'boca-2', name: 'Boca' }, { id: 'boca-3', name: 'boca' }]).lines[0]?.errors[0]).toContain('Nombre ambiguo');
    expect(parseOrderText('Boca 2026 t1=1; boca 2026 t2=1', designs).errors.join(' ')).toContain('Diseño duplicado');
    expect(parseOrderText('Boca 2026 t1=1, T1=2', designs).errors.join(' ')).toContain('Talle duplicado');
    expect(parseOrderText('Boca 2026 t1=1;;Racing 2026 t2=1', designs).errors.join(' ')).toContain('Entrada vacía');
    expect(parseOrderText('Boca 2026 t1=1,', designs).confirmable).toBe(false);
  });

  it('rejects an empty order, missing sizes, malformed separators and the former pipe format', () => {
    expect(parseOrderText('\n ', designs).confirmable).toBe(false);
    expect(parseOrderText('Boca 2026', designs).confirmable).toBe(false);
    expect(parseOrderText('Boca 2026 | T1=2', designs).confirmable).toBe(false);
  });

  it('allows 5000 physical pieces and rejects 5001 using the existing batch limit', () => {
    expect(parseOrderText('Boca 2026 t1=2500', designs).totalPieces).toBe(5000);
    expect(parseOrderText('Boca 2026 t1=2501', designs).errors).toContain('Máximo 5000 piezas por batch en esta versión.');
    expect(parseOrderText('Boca 2026 t1=2499', designs, 2).totalPieces).toBe(5000);
    expect(parseOrderText('Boca 2026 t1=2500', designs, 2).confirmable).toBe(false);
  });

  it('replaces all garment quantities while leaving caller-owned non-garment state separate', () => {
    const preview = parseOrderText('Boca 2026 t2=4', designs);
    const next = quantitiesFromOrder(preview, designs);
    expect(next.boca).toMatchObject({ T1: 0, T2: 4, T10: 0 });
    expect(next.racing).toMatchObject({ T1: 0, T10: 0 });
  });
});
