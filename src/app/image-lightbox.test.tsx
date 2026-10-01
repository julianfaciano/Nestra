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

it('cierra sólo al clickear afuera, conserva los controles y aplica zoom limitado con reset', () => {
  render(
    <ImageLightbox label="Ampliar frente" trigger={<img src="front.png" alt="Frente" />}>
      <img src="front.png" alt="Frente ampliado" />
    </ImageLightbox>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar frente' }));
  const stage = document.querySelector('.image-lightbox-stage')!;
  const content = document.querySelector('.image-lightbox-content')!;
  fireEvent.click(screen.getByRole('button', { name: 'Acercar imagen' }));
  expect(stage).toHaveStyle({ zoom: '1.25' });
  fireEvent.mouseDown(screen.getByAltText('Frente ampliado'));
  fireEvent.mouseDown(content);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restablecer zoom' }));
  expect(stage).toHaveStyle({ zoom: '1' });

  for (let index = 0; index < 40; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Acercar imagen' }));
  expect(screen.getByRole('button', { name: 'Acercar imagen' })).toBeDisabled();
  expect(screen.getByText('800%')).toBeInTheDocument();
  for (let index = 0; index < 40; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Alejar imagen' }));
  expect(screen.getByRole('button', { name: 'Alejar imagen' })).toBeDisabled();
  expect(screen.getByText('25%')).toBeInTheDocument();

  fireEvent.mouseDown(screen.getByRole('presentation'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ampliar frente' })).toHaveClass('is-returning');
});

it('hace zoom con Ctrl+rueda y permite pan con Space+arrastre', () => {
  render(
    <ImageLightbox label="Ampliar frente" trigger={<img src="front.png" alt="Frente" />}>
      <img src="front.png" alt="Frente ampliado" />
    </ImageLightbox>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ampliar frente' }));

  const content = document.querySelector('.image-lightbox-content')!;
  const stage = document.querySelector('.image-lightbox-stage')!;
  const image = screen.getByAltText('Frente ampliado');
  fireEvent.wheel(content, { ctrlKey: true, deltaY: -100 });
  expect(stage).toHaveStyle({ zoom: '1.2' });

  Object.defineProperties(content, {
    scrollLeft: { configurable: true, writable: true, value: 80 },
    scrollTop: { configurable: true, writable: true, value: 60 },
  });
  fireEvent.keyDown(content, { key: ' ', code: 'Space' });
  expect(content).toHaveClass('is-space-panning');
  fireEvent.pointerDown(image, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(image, { pointerId: 7, clientX: 75, clientY: 90 });
  expect(content.scrollLeft).toBe(105);
  expect(content.scrollTop).toBe(70);
  fireEvent.pointerUp(image, { pointerId: 7, clientX: 75, clientY: 90 });
  fireEvent.keyUp(content, { key: ' ', code: 'Space' });
  expect(content).not.toHaveClass('is-space-panning');
});
