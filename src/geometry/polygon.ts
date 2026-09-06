export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export type Polygon = readonly Point2D[];
