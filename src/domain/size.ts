export const GARMENT_SIZES = [
  'T1',
  'T2',
  'T3',
  'T4',
  'T5',
  'T6',
  'T7',
  'T8',
  'T9',
  'T10',
] as const;

export type GarmentSize = (typeof GARMENT_SIZES)[number];

export function isGarmentSize(value: string): value is GarmentSize {
  return GARMENT_SIZES.includes(value as GarmentSize);
}
