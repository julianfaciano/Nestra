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
    expect(screen.getByLabelText('Versión actual: Nestra v0.3.0 Beta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Actualizaciones' })).toBeInTheDocument();
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

  it('permite abrir Moldes desde la navegación principal', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Moldes' }));

    expect(screen.getByRole('heading', { name: 'Moldes' })).toBeInTheDocument();
    expect(screen.getByText('Master base · T8')).toBeInTheDocument();
    expect(screen.getByText(/no depende de la Biblioteca ni de que el diseño destino ya tenga T1–T10/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar y guardar 20 archivos' })).toBeDisabled();
  });
});
