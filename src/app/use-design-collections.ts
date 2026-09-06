import {
  useEffect,
  useRef,
  useState,
} from 'react';
import type { DesignCollection } from './design-collection-state';
import {
  loadDesignCollections,
  saveDesignCollections,
} from '../persistence/design-collections';

export function useDesignCollections() {
  const [collections, setCollections] = useState<
    DesignCollection[]
  >([]);

  const [ready, setReady] = useState(false);

  const [status, setStatus] = useState(
    'Cargando diseños guardados…',
  );

  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;

    void loadDesignCollections()
      .then((loaded) => {
        if (cancelled) {
          return;
        }

        setCollections(loaded);
        setReady(true);

        setStatus(
          loaded.length > 0
            ? `${loaded.length} diseño(s) guardado(s) cargado(s).`
            : 'Biblioteca de diseños lista.',
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(
            'No se pudieron cargar los diseños guardados: ' +
              String(error),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }

    let current = true;

    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(() =>
        saveDesignCollections(collections),
      );

    void saveQueue.current
      .then(() => {
        if (current) {
          setStatus(
            'Diseños guardados en este equipo.',
          );
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setStatus(
            'No se pudieron guardar los diseños: ' +
              String(error),
          );
        }
      });

    return () => {
      current = false;
    };
  }, [collections, ready]);

  return {
    collections,
    setCollections,
    ready,
    status,
  };
}