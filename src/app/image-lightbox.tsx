import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export function ImageLightbox({
  label,
  trigger,
  children,
}: {
  readonly label: string;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => closeRef.current?.focus());

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="image-lightbox-trigger"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </button>
      {open
        ? createPortal(
            <div
              className="image-lightbox-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div
                className="image-lightbox-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={label}
              >
                <button
                  ref={closeRef}
                  type="button"
                  className="image-lightbox-close"
                  aria-label="Cerrar vista previa"
                  title="Cerrar"
                  onClick={() => setOpen(false)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m5 5 10 10M15 5 5 15" />
                  </svg>
                </button>
                <div className="image-lightbox-content">{children}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

