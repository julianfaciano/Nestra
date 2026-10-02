import { useEffect, useRef, useState } from 'react';
import {
  CURRENT_RELEASE,
  RECENT_RELEASE_COUNT,
  RELEASE_NOTES,
  releaseStageLabel,
  type ReleaseNote,
} from '../domain/release-notes';

function ReleaseEntry({ release }: { readonly release: ReleaseNote }) {
  const date = new Date(`${release.date}T00:00:00Z`).toLocaleDateString(
    'es-AR',
    { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' },
  );

  return (
    <article className="release-entry">
      <div className="release-entry-meta">
        <span className="release-version">v{release.version}</span>
        <span className="release-stage" data-stage={release.stage}>
          {releaseStageLabel(release.stage)}
        </span>
        <time dateTime={release.date}>{date}</time>
      </div>
      <h3>{release.title}</h3>
      <ul>
        {release.changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
    </article>
  );
}

export function ReleaseUpdates() {
  const [showAll, setShowAll] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!showAll) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowAll(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    closeRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
      else previouslyFocused?.focus();
    };
  }, [showAll]);

  const recentReleases = RELEASE_NOTES.slice(0, RECENT_RELEASE_COUNT);

  return (
    <section className="home-updates" aria-labelledby="home-updates-title">
      <div className="home-updates-heading">
        <div>
          <p className="home-index-label">HISTORIAL DE VERSIONES</p>
          <h2 id="home-updates-title">Actualizaciones</h2>
        </div>
        <span className="home-updates-current">
          Actual · v{CURRENT_RELEASE.version}
        </span>
      </div>

      <div className="release-grid">
        {recentReleases.map((release) => (
          <ReleaseEntry key={release.version} release={release} />
        ))}
      </div>

      <button
        ref={triggerRef}
        className="release-all-button"
        type="button"
        onClick={() => setShowAll(true)}
      >
        Ver todas las actualizaciones <span aria-hidden="true">→</span>
      </button>

      {showAll ? (
        <div
          className="release-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowAll(false);
          }}
        >
          <section
            className="release-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-dialog-title"
          >
            <header className="release-dialog-header">
              <div>
                <p className="home-index-label">NESTRA · VERSIONES</p>
                <h2 id="release-dialog-title">Todas las actualizaciones</h2>
              </div>
              <button
                ref={closeRef}
                className="release-dialog-close"
                type="button"
                aria-label="Cerrar actualizaciones"
                onClick={() => setShowAll(false)}
              >
                ×
              </button>
            </header>
            <div className="release-dialog-scroll">
              {RELEASE_NOTES.map((release) => (
                <ReleaseEntry key={release.version} release={release} />
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
