import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface PanPointer {
  readonly id: number;
  x: number;
  y: number;
}

export function ImageLightbox({
  label,
  trigger,
  children,
  triggerStyle,
}: {
  readonly label: string;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly triggerStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [returnFlash, setReturnFlash] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const spacePressed = useRef(false);
  const panPointer = useRef<PanPointer | null>(null);
  const returnFlashTimer = useRef<number | null>(null);

  function close(restoreFocus: boolean): void {
    setOpen(false);
    panPointer.current = null;
    setIsPanning(false);
    spacePressed.current = false;
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } else {
      triggerRef.current?.blur();
      setReturnFlash(true);
      if (returnFlashTimer.current !== null) window.clearTimeout(returnFlashTimer.current);
      returnFlashTimer.current = window.setTimeout(() => setReturnFlash(false), 690);
    }
  }

  useEffect(() => {
    if (!open) return;
    setZoom(1);
    setReturnFlash(false);
    spacePressed.current = false;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
        return;
      }
      const target = event.target as Element | null;
      const isInteractive = Boolean(target?.closest('button, input, select, textarea, [contenteditable="true"]'));
      if ((event.code === 'Space' || event.key === ' ') && !isInteractive) {
        event.preventDefault();
        spacePressed.current = true;
        contentRef.current?.classList.add('is-space-panning');
      }
      if (event.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [tabindex="0"]',
        );
        if (!focusable?.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        spacePressed.current = false;
        contentRef.current?.classList.remove('is-space-panning');
      }
    };
    const handleWindowBlur = () => {
      spacePressed.current = false;
      contentRef.current?.classList.remove('is-space-panning');
    };

    const content = contentRef.current;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const step = Math.min(0.5, Math.max(0.05, Math.abs(event.deltaY) * 0.002));
      const direction = event.deltaY < 0 ? 1 : -1;
      setZoom(current => Math.min(8, Math.max(0.25, Math.round((current + step * direction) * 100) / 100)));
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    content?.addEventListener('wheel', handleWheel, { passive: false });
    window.requestAnimationFrame(() => contentRef.current?.focus({ preventScroll: true }));

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      content?.removeEventListener('wheel', handleWheel);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  useEffect(() => () => {
    if (returnFlashTimer.current !== null) window.clearTimeout(returnFlashTimer.current);
  }, []);

  function beginPan(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.target === event.currentTarget || (zoom <= 1 && !spacePressed.current)) return;
    event.preventDefault();
    panPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setIsPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function continuePan(event: ReactPointerEvent<HTMLDivElement>): void {
    const pointer = panPointer.current;
    const content = contentRef.current;
    if (!pointer || pointer.id !== event.pointerId || !content) return;
    content.scrollLeft -= event.clientX - pointer.x;
    content.scrollTop -= event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }

  function finishPan(event: ReactPointerEvent<HTMLDivElement>): void {
    if (panPointer.current?.id !== event.pointerId) return;
    panPointer.current = null;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`image-lightbox-trigger${returnFlash ? ' is-returning' : ''}`}
        aria-label={label}
        title={label}
        style={triggerStyle}
        onClick={() => {
          setZoom(1);
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      {open
        ? createPortal(
            <div
              className="image-lightbox-backdrop"
              role="presentation"
              onMouseDown={event => {
                if (event.target === event.currentTarget) close(false);
              }}
            >
              <div
                ref={dialogRef}
                className="image-lightbox-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={label}
              >
                <button
                  type="button"
                  className="image-lightbox-close"
                  aria-label="Cerrar vista previa"
                  title="Cerrar"
                  onClick={event => close(event.detail === 0)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m5 5 10 10M15 5 5 15" />
                  </svg>
                </button>
                <div className="image-lightbox-controls" aria-label="Controles de zoom">
                  <button type="button" aria-label="Alejar imagen" title="Alejar" disabled={zoom <= 0.25} onClick={() => setZoom(current => Math.max(0.25, Math.round((current - 0.25) * 100) / 100))}>−</button>
                  <span aria-live="polite">{Math.round(zoom * 100)}%</span>
                  <button type="button" aria-label="Acercar imagen" title="Acercar" disabled={zoom >= 8} onClick={() => setZoom(current => Math.min(8, Math.round((current + 0.25) * 100) / 100))}>+</button>
                  <button type="button" aria-label="Restablecer zoom" title="Restablecer" onClick={() => setZoom(1)}>1:1</button>
                </div>
                <div
                  ref={contentRef}
                  className={`image-lightbox-content${zoom > 1 ? ' is-zoomed' : ''}${isPanning ? ' is-panning' : ''}`}
                  tabIndex={0}
                  aria-label="Imagen ampliada. Ctrl y rueda para cambiar el zoom; arrastrá para desplazar."
                  onPointerDown={beginPan}
                  onPointerMove={continuePan}
                  onPointerUp={finishPan}
                  onPointerCancel={finishPan}
                >
                  <div className="image-lightbox-stage" style={{ zoom }}>{children}</div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
