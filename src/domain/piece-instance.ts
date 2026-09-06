import {
  pieceDefinitionLabel,
  type BatchPieceDefinition,
} from './production-batch';

export interface PieceInstance {
  readonly id: string;
  readonly definitionId: string;
  readonly copyIndex: number;
  readonly definition: BatchPieceDefinition;
}

export function expandPieceDefinitions(
  definitions: readonly BatchPieceDefinition[],
): PieceInstance[] {
  const instances: PieceInstance[] = [];

  for (const definition of definitions) {
    if (
      !Number.isInteger(definition.quantity) ||
      definition.quantity < 0 ||
      (definition.kind === 'free-png' &&
        (!Number.isSafeInteger(definition.quantity) || definition.quantity < 1))
    ) {
      throw new Error(
        definition.kind === 'garment'
          ? `La cantidad de ${definition.model} ${definition.size} debe ser un entero mayor o igual a cero.`
          : `La cantidad de ${pieceDefinitionLabel(definition)} debe ser un entero mayor que cero.`,
      );
    }

    for (let copyIndex = 0; copyIndex < definition.quantity; copyIndex += 1) {
      instances.push({
        id: `${definition.id}-${copyIndex + 1}`,
        definitionId: definition.id,
        copyIndex,
        definition,
      });
    }
  }

  return instances;
}
