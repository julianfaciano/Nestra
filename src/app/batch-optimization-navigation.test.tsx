import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const batchHarness = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  starts: 0,
  complete: undefined as undefined | (() => void),
  completeExport: undefined as undefined | (() => void),
}));

vi.mock('./batch-page', async () => {
  const React = await import('react');

  return {
    BatchPage: ({ onOptimizationChange, onExportChange }: {
      onOptimizationChange?: (state: {
        status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
        progress: number;
        phase: string;
        resultAvailable: boolean;
      }) => void;
      onExportChange?: (state: {
        status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
        phase: string;
        error?: string;
      }) => void;
    }) => {
      const [status, setStatus] = React.useState<'idle' | 'running' | 'completed' | 'cancelled'>('idle');

      React.useEffect(() => {
        batchHarness.mounts++;
        onOptimizationChange?.({
          status: 'idle',
          progress: 0,
          phase: 'Preparando',
          resultAvailable: false,
        });
        return () => {
          batchHarness.unmounts++;
        };
      }, [onOptimizationChange]);

      batchHarness.complete = () => {
        setStatus('completed');
        onOptimizationChange?.({
          status: 'completed',
          progress: 100,
          phase: 'Listo',
          resultAvailable: true,
        });
      };

      batchHarness.completeExport = () => {
        onExportChange?.({
          status: 'completed',
          phase: 'Exportación terminada',
        });
      };

      return (
        <section>
          <h1>Producción</h1>
          <button
            type="button"
            disabled={status === 'running'}
            onClick={() => {
              batchHarness.starts++;
              setStatus('running');
              onOptimizationChange?.({
                status: 'running',
                progress: 63,
                phase: 'Acomodando piezas',
                resultAvailable: false,
              });
            }}
          >
            INICIAR JOB DE PRUEBA
          </button>
          <button
            type="button"
            onClick={() => onExportChange?.({
              status: 'running',
              phase: 'Exportando archivos',
            })}
          >
            INICIAR EXPORTACIÓN DE PRUEBA
          </button>
          {status === 'running' ? (
            <>
              <p>JOB RUNNING</p>
              <button
                type="button"
                onClick={() => {
                  setStatus('cancelled');
                  onOptimizationChange?.({
                    status: 'cancelled',
                    progress: 63,
                    phase: 'Cancelado',
                    resultAvailable: false,
                  });
                }}
              >
                CANCELAR JOB DE PRUEBA
              </button>
            </>
          ) : null}
          {status === 'completed' ? <p>RESULTADO CONSERVADO</p> : null}
        </section>
      );
    },
  };
});

import App from './App';

beforeEach(() => {
  batchHarness.mounts = 0;
  batchHarness.unmounts = 0;
  batchHarness.starts = 0;
  batchHarness.complete = undefined;
  batchHarness.completeExport = undefined;
  window.sessionStorage.clear();
});

describe('optimización persistente entre secciones', () => {
  it('no muestra el indicador global cuando el job está idle', () => {
    render(<App />);

    expect(screen.queryByText('OPTIMIZANDO')).not.toBeInTheDocument();
    expect(screen.queryByText('Ver resultado')).not.toBeInTheDocument();
  });

  it('conserva un único job y su progreso al navegar fuera y volver', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Producción' }));
    fireEvent.click(screen.getByRole('button', { name: 'INICIAR JOB DE PRUEBA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inicio' }));

    expect(screen.getByText('OPTIMIZANDO')).toBeInTheDocument();
    expect(screen.getByText('63%')).toBeInTheDocument();
    expect(screen.getByText('Acomodando piezas')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '63');
    expect(batchHarness.mounts).toBe(1);
    expect(batchHarness.unmounts).toBe(0);

    fireEvent.click(screen.getByText('OPTIMIZANDO').closest('button')!);

    expect(screen.getByText('JOB RUNNING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'INICIAR JOB DE PRUEBA' })).toBeDisabled();
    expect(batchHarness.starts).toBe(1);
    expect(batchHarness.mounts).toBe(1);
  });

  it('muestra 100% y conserva el resultado cuando termina en otra sección', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Producción' }));
    fireEvent.click(screen.getByRole('button', { name: 'INICIAR JOB DE PRUEBA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }));

    act(() => batchHarness.complete?.());

    expect(screen.getByText('LISTO')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Ver resultado')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ver resultado').closest('button')!);
    expect(screen.getByText('RESULTADO CONSERVADO')).toBeInTheDocument();
  });

  it('mantiene disponible la cancelación del job activo', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Producción' }));
    fireEvent.click(screen.getByRole('button', { name: 'INICIAR JOB DE PRUEBA' }));
    fireEvent.click(screen.getByRole('button', { name: 'CANCELAR JOB DE PRUEBA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inicio' }));

    expect(screen.queryByText('OPTIMIZANDO')).not.toBeInTheDocument();
    expect(batchHarness.starts).toBe(1);
  });

  it('colapsa, restaura y conserva la navegación y la actividad global', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar barra lateral' }));
    expect(screen.getByRole('button', { name: 'Mostrar barra lateral' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.querySelector('.app-shell')).toHaveClass(
      'app-shell--sidebar-collapsed',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Producción' }));
    expect(screen.getByRole('heading', { name: 'Producción' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'INICIAR JOB DE PRUEBA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inicio' }));
    expect(screen.getByText('OPTIMIZANDO')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '63');

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar barra lateral' }));
    expect(screen.getByRole('button', { name: 'Ocultar barra lateral' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(batchHarness.mounts).toBe(1);
    expect(batchHarness.starts).toBe(1);
  });

  it('mantiene una exportación como actividad global sin crear otro BatchPage', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Producción' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'INICIAR EXPORTACIÓN DE PRUEBA' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Biblioteca' }));

    expect(screen.getByText('EXPORTANDO')).toBeInTheDocument();
    expect(screen.getByText('Exportando archivos')).toBeInTheDocument();
    expect(batchHarness.mounts).toBe(1);

    act(() => batchHarness.completeExport?.());
    expect(screen.getByText('EXPORTADO')).toBeInTheDocument();
    expect(screen.getByText('Exportación terminada')).toBeInTheDocument();
    expect(batchHarness.mounts).toBe(1);
  });
});
