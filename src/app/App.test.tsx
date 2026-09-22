import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('muestra Inicio por defecto', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Nestra' })).toBeInTheDocument();

    expect(
      screen.getByText('Prepará, optimizá y exportá layouts listos para producción.'),
    ).toBeInTheDocument();
  });

  it('permite abrir la Biblioteca de siluetas', () => {
    render(<App />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Biblioteca',
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Biblioteca',
      }),
    ).toBeInTheDocument();

    expect(screen.getByText('0 diseños importados')).toBeInTheDocument();
  });
});
