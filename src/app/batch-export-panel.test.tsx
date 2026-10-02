import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ExportLayout, PreflightReport } from '../export/export-plan';
import { BatchExportPanel } from './batch-export-panel';

interface ObservedTarget {
  readonly targets: Set<Element>;
  notify(target: Element, isIntersecting: boolean): void;
}

const observers: ObservedTarget[] = [];

class TestIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string;
  readonly scrollMargin: string;
  readonly thresholds: readonly number[] = [0];
  readonly targets = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? '0px';
    this.scrollMargin = options?.scrollMargin ?? '0px';
    observers.push(this);
  }

  observe(target: Element): void { this.targets.add(target); }
  unobserve(target: Element): void { this.targets.delete(target); }
  disconnect(): void { this.targets.clear(); }
  takeRecords(): IntersectionObserverEntry[] { return []; }

  notify(target: Element, isIntersecting: boolean): void {
    const entry: IntersectionObserverEntry = {
      target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: performance.now(),
    };
    this.callback([entry], this);
  }
}

function createLayouts(count: number): ExportLayout[] {
  return Array.from({ length: count }, (_, index) => {
    const heightMm = 4990 - index;
    return {
      name: `polar_1_copia${String(index + 1).padStart(2, '0')}.png`,
      fabric: 'polar',
      widthMm: 1560,
      heightMm,
      widthPx: 18425,
      heightPx: Math.round(heightMm * 300 / 25.4),
      offsetX: 0,
      offsetY: 0,
      pieces: [],
    };
  });
}

function reportFor(layouts: ExportLayout[]): PreflightReport {
  return { errors: [], warnings: [], layouts, boundsIssues: [] };
}

afterEach(() => {
  observers.splice(0);
  vi.unstubAllGlobals();
});

it('muestra los 24 canvases en orden con metadata y reserva espacio mientras difiere los SVG lejanos', async () => {
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  const layouts = createLayouts(24);
  const { container } = render(
    <BatchExportPanel
      report={reportFor(layouts)}
      onExport={() => {}}
      onCancel={() => {}}
      busy={false}
      exporting={false}
      exported={false}
      status={null}
      error={null}
    />,
  );

  const figures = [...container.querySelectorAll<HTMLElement>('.batch-export-layout')];
  expect(figures).toHaveLength(24);
  expect(screen.queryByRole('combobox', { name: 'Canvas a previsualizar' })).not.toBeInTheDocument();
  expect(figures.map(figure => figure.dataset.canvasIndex)).toEqual(Array.from({ length: 24 }, (_, index) => String(index)));
  expect([...container.querySelectorAll('figcaption')].map(caption => caption.textContent?.trim())).toEqual(
    layouts.map(layout => `${layout.name} · 156.00 × ${(layout.heightMm / 10).toFixed(2)} cm · ${layout.widthPx} × ${layout.heightPx} px`),
  );
  expect(container.querySelectorAll('.batch-export-preview-placeholder')).toHaveLength(24);
  expect(container.querySelectorAll('svg.batch-export-artwork')).toHaveLength(0);

  const firstSlot = figures[0]!.querySelector<HTMLElement>('.batch-export-preview-slot')!;
  expect(firstSlot.style.aspectRatio).toBe(`${layouts[0]!.widthMm} / ${layouts[0]!.heightMm}`);
  await waitFor(() => expect(observers).toHaveLength(24));

  const makeNear = (index: number, isIntersecting: boolean) => {
    const figure = figures[index]!;
    const observer = observers.find(candidate => candidate.targets.has(figure));
    expect(observer).toBeDefined();
    act(() => observer!.notify(figure, isIntersecting));
  };

  makeNear(0, true);
  makeNear(1, true);
  expect(container.querySelectorAll('svg.batch-export-artwork')).toHaveLength(2);
  expect(container.querySelectorAll('.batch-export-preview-placeholder')).toHaveLength(22);

  const secondCanvas = figures[1]!;
  fireOpenPreview(secondCanvas, layouts[1]!.name);
  expect(screen.getByRole('dialog', { name: `Ampliar ${layouts[1]!.name}` })).toBeInTheDocument();

  makeNear(0, false);
  expect(container.querySelectorAll('svg.batch-export-artwork')).toHaveLength(1);
  expect(within(figures[1]!).getByRole('button', { name: `Ampliar ${layouts[1]!.name}` })).toBeInTheDocument();
});

it('mantiene visible el error técnico después de que la exportación vuelve al estado inactivo', () => {
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  render(
    <BatchExportPanel
      report={reportFor(createLayouts(24))}
      onExport={() => {}}
      onCancel={() => {}}
      busy={false}
      exporting={false}
      exported={false}
      status={null}
      error={{
        message: 'Etapa «validación de metadata» · canvas 1/24 · sourceId=front-T1: Chunk PNG truncado.',
        details: 'Error: Chunk PNG truncado.\n at exportPdfPrototype',
      }}
    />,
  );

  expect(screen.getByRole('button', { name: /Exportar 24 archivos/ })).toBeEnabled();
  expect(screen.getByRole('alert', { name: 'Error de exportación PDF' })).toHaveTextContent(
    'Etapa «validación de metadata» · canvas 1/24 · sourceId=front-T1: Chunk PNG truncado.',
  );
  fireEvent.click(screen.getByText('Detalles técnicos'));
  expect(screen.getByText(/at exportPdfPrototype/)).toBeInTheDocument();
});

function fireOpenPreview(figure: HTMLElement, name: string): void {
  fireEvent.click(within(figure).getByRole('button', { name: `Ampliar ${name}` }));
}
