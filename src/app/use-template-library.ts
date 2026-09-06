import { useEffect, useRef, useState } from 'react';
import type { SizeTemplateDraft } from './size-template-state';
import { loadLibrary, saveLibrary } from '../persistence/template-library';

export function useTemplateLibrary() {
  const [templates, setTemplates] = useState<SizeTemplateDraft[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Cargando biblioteca local…');
  const saveQueue = useRef(Promise.resolve());
  const allUrls = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    const urls = allUrls.current;
    void loadLibrary().then(loaded => {
      if (cancelled) { loaded.forEach(t => {if (t.previewUrl) URL.revokeObjectURL(t.previewUrl);}); return; }
      loaded.forEach(t => {if (t.previewUrl) urls.add(t.previewUrl);});
      setTemplates(loaded); setReady(true); setStatus('Biblioteca local cargada.');
    }).catch(error => {
      if (!cancelled) setStatus('No se pudo cargar la biblioteca; no se sobrescribirá: ' + String(error));
    });
    return () => { cancelled = true; for (const url of urls) URL.revokeObjectURL(url); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    templates.forEach(t => {if (t.previewUrl) allUrls.current.add(t.previewUrl);});
    let current = true;
    // Queue every edit immediately so closing a view cannot discard a debounce timer.
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() => saveLibrary(templates));
    void saveQueue.current.then(() => { if (current) setStatus('Biblioteca guardada en este equipo.'); })
      .catch(error => { if (current) setStatus('No se pudo guardar: ' + String(error)); });
    return () => { current = false; };
  }, [templates, ready]);
  return { templates, setTemplates, ready, status };
}

