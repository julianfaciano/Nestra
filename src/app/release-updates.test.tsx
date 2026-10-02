import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReleaseUpdates } from './release-updates';

describe('ReleaseUpdates', () => {
  it('shows only the three latest releases on Home by default', () => {
    render(<ReleaseUpdates />);

    expect(
      screen.getByRole('heading', { name: 'Actualizaciones' }),
    ).toBeInTheDocument();
    expect(screen.getByText('v0.3.0')).toBeInTheDocument();
    expect(screen.getByText('v0.2.0')).toBeInTheDocument();
    expect(screen.getByText('v0.1.1')).toBeInTheDocument();
    expect(screen.queryByText('v0.1.0')).not.toBeInTheDocument();
    expect(screen.queryByText('v0.0.0')).not.toBeInTheDocument();
  });

  it('opens the full history with five releases newest first', () => {
    render(<ReleaseUpdates />);
    fireEvent.click(
      screen.getByRole('button', { name: /Ver todas las actualizaciones/i }),
    );

    const dialog = screen.getByRole('dialog', {
      name: 'Todas las actualizaciones',
    });
    expect(dialog).toBeInTheDocument();
    expect(
      [...dialog.querySelectorAll('.release-version')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['v0.3.0', 'v0.2.0', 'v0.1.1', 'v0.1.0', 'v0.0.0']);
  });

  it('closes from the close button, Escape, and the backdrop', () => {
    const { container } = render(<ReleaseUpdates />);
    const open = () =>
      fireEvent.click(
        screen.getByRole('button', { name: /Ver todas las actualizaciones/i }),
      );

    open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Cerrar actualizaciones' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    open();
    const backdrop = container.querySelector('.release-dialog-backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
