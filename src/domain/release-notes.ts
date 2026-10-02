export type ReleaseStage = 'alpha' | 'beta' | 'stable';

export type ReleaseNote = {
  readonly version: string;
  readonly stage: ReleaseStage;
  readonly date: string;
  readonly title: string;
  readonly changes: readonly string[];
};

export function releaseStageLabel(stage: ReleaseStage): string {
  return `${stage[0]!.toUpperCase()}${stage.slice(1)}`;
}

export const RELEASE_NOTES = [
  {
    version: '0.3.0',
    stage: 'beta',
    date: '2026-10-01',
    title: 'Moldes, Biblioteca y nuevos flujos productivos',
    changes: [
      'Generá los talles T1–T10 a partir de masters T8 desde Moldes.',
      'Importá carpetas en lote con búsqueda recursiva y diagnóstico de diseños incompletos.',
      'Creá batches desde un pedido y trabajá con hasta 5.000 piezas.',
      'Mejoramos las vistas previas de Producción, Biblioteca e Historial y sumamos soporte inicial para corte láser.',
    ],
  },
  {
    version: '0.2.0',
    stage: 'beta',
    date: '2026-09-30',
    title: 'Reposiciones y dorsos personalizados',
    changes: [
      'Agregá piezas independientes de reposición al batch de producción.',
      'Configurá cada reposición por separado y especificá si usa FRONT o BACK.',
      'La Biblioteca reconoce dorsos personalizados con “nom” y los integra como alternativas de reposición.',
    ],
  },
  {
    version: '0.1.1',
    stage: 'beta',
    date: '2026-09-25',
    title: 'Optimización de colisiones PNG',
    changes: [
      'Reducimos trabajo repetido al procesar componentes de colisión en siluetas PNG.',
      'Sumamos comprobaciones de equivalencia geométrica y benchmarks específicos para esta ruta.',
    ],
  },
  {
    version: '0.1.0',
    stage: 'beta',
    date: '2026-09-22',
    title: 'Producción, Historial y exportación',
    changes: [
      'Producción organiza el batch y muestra el avance de optimización.',
      'El Historial permite revisar trabajos guardados e importar historiales.',
      'Las exportaciones PDF y PNG respetan mejor los límites transparentes del arte.',
    ],
  },
  {
    version: '0.0.0',
    stage: 'alpha',
    date: '2026-09-06',
    title: 'Baseline funcional',
    changes: [
      'Primera base funcional para preparar batches y distribuir piezas en el lienzo.',
      'Incluye perfiles de producción, Biblioteca de diseños e Historial local.',
      'Ofrece exportación inicial en PDF y PNG.',
    ],
  },
] as const satisfies readonly ReleaseNote[];

export const CURRENT_RELEASE = RELEASE_NOTES[0];
export const CURRENT_RELEASE_VERSION = CURRENT_RELEASE.version;
export const RECENT_RELEASE_COUNT = 3;
