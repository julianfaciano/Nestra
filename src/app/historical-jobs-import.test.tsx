import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { HistoricalJobs } from './historical-jobs';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('imports a directly selected 06-Sep-26 folder through the Historial action', async () => {
  invokeMock.mockResolvedValue([
    {
      name: '06-Sep-26',
      path: 'C:\\historial\\06-Sep-26',
      files: [
        {
          name: 'TELA DEPORTIVA 1 copia.pdf',
          path: 'C:\\historial\\06-Sep-26\\TELA DEPORTIVA 1 copia.pdf',
          size: 100,
          type: 'pdf',
        },
      ],
    },
  ]);

  render(<HistoricalJobs />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Importar historial' }),
  );

  expect(await screen.findByText('(06-Sep-26)')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Importados 1. Actualizados 0.',
  );
  expect(invokeMock).toHaveBeenCalledWith('choose_historical_jobs');

  await waitFor(() => {
    const stored = JSON.parse(
      localStorage.getItem('nestra.historical-jobs') ?? '[]',
    ) as { name: string; createdAt: number }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('06-Sep-26');
    expect(stored[0]?.createdAt).toBeGreaterThan(0);
  });
});

it('rehydrates a high-resolution preview from an imported original only when its lightbox opens', async () => {
  invokeMock
    .mockResolvedValueOnce([{
      name: '06-Sep-26',
      path: 'C:\\historial\\06-Sep-26',
      files: [{
        name: 'canvas.jpg',
        path: 'C:\\historial\\06-Sep-26\\canvas.jpg',
        size: 100,
        type: 'jpg',
        thumbnailKey: '0123456789abcdef.jpg',
      }],
    }])
    .mockResolvedValueOnce([1, 2, 3])
    .mockResolvedValueOnce([4, 5, 6]);
  const createObjectURL = vi.fn(() => 'blob:history');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));

  render(<HistoricalJobs />);
  fireEvent.click(screen.getByRole('button', { name: 'Importar historial' }));
  const preview = await screen.findByRole('button', { name: 'Ampliar canvas.jpg' });
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('load_historical_thumbnail', { key: '0123456789abcdef.jpg' }));
  expect(invokeMock).not.toHaveBeenCalledWith('load_historical_source_preview', expect.anything());

  fireEvent.click(preview);
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('load_historical_source_preview', {
    root: 'C:\\historial\\06-Sep-26',
    path: 'C:\\historial\\06-Sep-26\\canvas.jpg',
    thumbnailKey: '0123456789abcdef.jpg',
  }));
});
