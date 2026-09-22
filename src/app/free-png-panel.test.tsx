import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FreePngPanel } from './free-png-panel';

it('no muestra cantidad global y selecciona la cantidad individual con doble click', () => {
  const select = vi.spyOn(HTMLInputElement.prototype, 'select');
  render(
    <FreePngPanel
      pieces={[
        {
          kind: 'free-png',
          id: 'logo',
          fabric: 'set',
          quantity: 6,
          file: new File(['png'], 'logo.png', { type: 'image/png' }),
          imageUrl: 'blob:logo',
          sourceWidthPx: 72,
          sourceHeightPx: 72,
        },
      ]}
      onImport={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={vi.fn()}
      onToggleFill={vi.fn()}
    />,
  );

  expect(screen.queryByLabelText('Cantidad inicial de PNG libre')).not.toBeInTheDocument();
  const quantity = screen.getByLabelText('Cantidad de logo.png');
  fireEvent.doubleClick(quantity);
  expect(select).toHaveBeenCalledOnce();
});
