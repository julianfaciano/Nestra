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
