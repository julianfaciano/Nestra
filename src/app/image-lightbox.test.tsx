import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ImageLightbox } from './image-lightbox';

it('abre el visor y lo cierra con Escape, backdrop y botón', () => {
  render(
    <ImageLightbox label="Ampliar frente" trigger={<img src="front.png" alt="Frente" />}>
      <img src="front.png" alt="Frente ampliado" />
    </ImageLightbox>,
  );

  const trigger = screen.getByRole('button', { name: 'Ampliar frente' });
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Ampliar frente' })).toBeInTheDocument();
  expect(document.body.style.overflow).toBe('hidden');

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(trigger);
  fireEvent.mouseDown(screen.getByRole('presentation'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar vista previa' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
