export interface ExtraPieceIdentity {
  readonly definitionId: string;
  /** Zero-based, across all layouts of this fabric. Independent of required copies. */
  readonly copyIndex: number;
}

export interface FillerRequest {
  readonly definitionId: string;
  readonly requiredPieceId: string;
  readonly priority: number;
  readonly mode: 'normal' | 'max';
}

export function extraPieceId(definitionId: string, copyIndex: number): string {
  return `extra:${encodeURIComponent(definitionId)}:${copyIndex + 1}`;
}
