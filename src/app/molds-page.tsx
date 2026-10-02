import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GARMENT_SIZES } from '../domain/size';
import { createMoldOutputPlan, validateMoldPrefix, type MoldOutputSpec } from '../domain/molds-generation';
import { renderMoldOutput } from '../domain/molds-generation-browser';
import { physicalSizeFromSourcePixels } from '../domain/source-image-size';
import type { PieceSide } from '../domain/piece-side';

interface MoldMaster {
  readonly file: File;
  readonly url: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

interface OutputFolder {
  readonly path: string;
  readonly name: string;
}

interface MoldWriteResult {
  readonly status: 'created' | 'replaced' | 'skipped';
  readonly fileName: string;
  readonly path: string;
}

interface MoldFileResult {
  readonly fileName: string;
  readonly status: 'created' | 'replaced' | 'skipped' | 'error';
  readonly detail?: string;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function loadMaster(file: File): Promise<Omit<MoldMaster, 'url'>> {
  if (file.type !== 'image/png' || file.size > 32 * 1024 * 1024) {
    throw new Error('Elegí un PNG de hasta 32 MiB.');
  }
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (signature.length !== 8 || signature.some((byte, index) => byte !== PNG_SIGNATURE[index])) {
    throw new Error('El archivo no tiene una firma PNG válida.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width * bitmap.height > 16_000_000) {
      throw new Error('El master debe tener dimensiones válidas y no superar 16 MP.');
    }
    return { file, widthPx: bitmap.width, heightPx: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function encodeUtf8Hex(value: string): string {
  return [...new TextEncoder().encode(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function MoldsPage() {
  const [masters, setMasters] = useState<Partial<Record<PieceSide, MoldMaster>>>({});
  const [prefix, setPrefix] = useState('');
  const [outputFolder, setOutputFolder] = useState<OutputFolder | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [confirmedNoPrintedSizeText, setConfirmedNoPrintedSizeText] = useState(false);
  const [masterErrors, setMasterErrors] = useState<Partial<Record<PieceSide, string>>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<readonly MoldFileResult[] | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const masterUrls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const url of masterUrls.current) URL.revokeObjectURL(url);
    masterUrls.current.clear();
  }, []);

  const prefixError = validateMoldPrefix(prefix);
  const planState = useMemo(() => {
    if (!masters.front || !masters.back) return { plan: [] as MoldOutputSpec[], error: undefined as string | undefined };
    try {
      return {
        plan: createMoldOutputPlan(prefix, {
          front: { widthPx: masters.front.widthPx, heightPx: masters.front.heightPx },
          back: { widthPx: masters.back.widthPx, heightPx: masters.back.heightPx },
        }),
        error: undefined,
      };
    } catch (error) {
      return { plan: [] as MoldOutputSpec[], error: error instanceof Error ? error.message : String(error) };
    }
  }, [masters.front, masters.back, prefix]);

  async function selectMaster(side: PieceSide, file?: File): Promise<void> {
    if (!file || busy) return;
    try {
      const loaded = await loadMaster(file);
      const url = URL.createObjectURL(file);
      const previousUrl = masters[side]?.url;
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
        masterUrls.current.delete(previousUrl);
      }
      masterUrls.current.add(url);
      setConfirmedNoPrintedSizeText(false);
      setMasters(current => ({ ...current, [side]: { ...loaded, url } }));
      setMasterErrors(current => ({ ...current, [side]: undefined }));
      setResults(null);
      setOperationError(null);
    } catch (error) {
      const previousUrl = masters[side]?.url;
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
        masterUrls.current.delete(previousUrl);
      }
      setMasters(current => {
        const next = { ...current };
        delete next[side];
        return next;
      });
      setConfirmedNoPrintedSizeText(false);
      setMasterErrors(current => ({ ...current, [side]: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function chooseOutputFolder(): Promise<void> {
    if (busy) return;
    try {
      const selected = await invoke<OutputFolder | null>('choose_molds_output_folder');
      if (selected) {
        setOutputFolder(selected);
        setResults(null);
        setOperationError(null);
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  }

  async function generate(): Promise<void> {
    if (busy || !masters.front || !masters.back || !outputFolder || !confirmedNoPrintedSizeText || prefixError || planState.error || planState.plan.length !== 20) return;
    setBusy(true);
    setResults([]);
    setOperationError(null);
    const completed: MoldFileResult[] = [];
    try {
      for (const [index, spec] of planState.plan.entries()) {
        setProgress(`Generando ${index + 1} de ${planState.plan.length}: ${spec.fileName}`);
        try {
          const master = masters[spec.sourceSide]!;
          const blob = await renderMoldOutput(master.file, spec);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const result = await invoke<MoldWriteResult>('write_mold_png', bytes, {
            headers: {
              'x-nestra-folder-utf8-hex': encodeUtf8Hex(outputFolder.path),
              'x-nestra-file-name': spec.fileName,
              'x-nestra-replace': replaceExisting ? '1' : '0',
            },
          });
          completed.push({ fileName: result.fileName, status: result.status });
        } catch (error) {
          completed.push({ fileName: spec.fileName, status: 'error', detail: error instanceof Error ? error.message : String(error) });
        }
        setResults([...completed]);
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  const createdCount = results?.filter(result => result.status === 'created').length ?? 0;
  const replacedCount = results?.filter(result => result.status === 'replaced').length ?? 0;
  const skippedCount = results?.filter(result => result.status === 'skipped').length ?? 0;
  const errorCount = results?.filter(result => result.status === 'error').length ?? 0;

  return (
    <section className="molds-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">HERRAMIENTA DE ESCALADO</span>
          <h1>Moldes</h1>
          <p className="muted">Generá los PNG T1–T10 a partir de un master T8 de frente y otro de dorso.</p>
        </div>
        <span className="template-progress">Master base · T8</span>
      </header>

      <div className="molds-workspace">
        <div className="molds-inputs">
          {(['front', 'back'] as const).map(side => {
            const master = masters[side];
            const label = side === 'front' ? 'FRENTE' : 'DORSO';
            return (
              <section className="molds-master-card" key={side}>
                <div className="molds-master-heading"><h2>Master {label}</h2><span>T8</span></div>
                <label className="field">
                  <span>PNG master {label.toLowerCase()}</span>
                  <input type="file" accept="image/png,.png" disabled={busy} onChange={event => void selectMaster(side, event.currentTarget.files?.[0])} />
                </label>
                {master ? (
                  <>
                    <div className="molds-master-preview"><img src={master.url} alt={`Master T8 ${label.toLowerCase()}`} /></div>
                    <p className="image-metadata">{master.widthPx} × {master.heightPx} px · {(physicalSizeFromSourcePixels(master.widthPx, master.heightPx).widthMm / 10).toFixed(2)} × {(physicalSizeFromSourcePixels(master.widthPx, master.heightPx).heightMm / 10).toFixed(2)} cm a 72 PPI</p>
                  </>
                ) : <div className="molds-master-preview empty">Elegí el PNG T8 de {label.toLowerCase()}.</div>}
                {masterErrors[side] ? <p className="molds-error" role="alert">{masterErrors[side]}</p> : null}
              </section>
            );
          })}
        </div>

        <section className="molds-settings">
          <label className="field">
            <span>Prefijo/código de archivos</span>
            <input value={prefix} maxLength={32} disabled={busy} placeholder="Ej.: BOCA26" onChange={event => setPrefix(event.target.value)} />
          </label>
          {prefixError ? <p className="molds-help">{prefixError}</p> : null}

          <div className="molds-folder-control">
            <div><strong>Carpeta del diseño</strong><span>{outputFolder?.path ?? 'Elegí la carpeta donde se guardarán los 20 PNG.'}</span></div>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseOutputFolder()}>{outputFolder ? 'Cambiar carpeta' : 'Elegir carpeta'}</button>
          </div>
          {outputFolder ? <p className="molds-help">El nombre visible en Biblioteca será el nombre de esta carpeta: <b>{outputFolder.name}</b>.</p> : null}

          <label className="molds-check-row">
            <input type="checkbox" checked={replaceExisting} disabled={busy} onChange={event => setReplaceExisting(event.target.checked)} />
            <span>Reemplazar los archivos existentes (si no, se omiten).</span>
          </label>
          <label className="molds-check-row molds-check-row--ack">
            <input type="checkbox" checked={confirmedNoPrintedSizeText} disabled={busy} onChange={event => setConfirmedNoPrintedSizeText(event.target.checked)} />
            <span>Confirmo que ambos masters no tienen texto ni número de talle dibujado, para evitar un doble número.</span>
          </label>
          <p className="molds-help">Nestra agrega sólo el número 1–10 en #8aff00, con 19 px visibles a 72 PPI (6,70 mm), sin fondo, sombra ni borde. Conserva exactamente el canal alpha del molde escalado. Lo ubica centrado y pegado al borde superior local, lo más arriba posible dentro de la silueta opaca; si no existe un lugar válido dentro del límite de 19 px, ese archivo falla. El texto ya rasterizado no se puede detectar con fiabilidad: revisá ambos masters antes de continuar.</p>
        </section>
      </div>

      <section className="molds-scale-section">
        <div className="molds-section-heading"><div><h2>Escala por talle</h2><p>Grada global medida en colecciones completas. Se ajusta cada eje según las dimensiones productivas; no depende de la Biblioteca ni de que el diseño destino ya tenga T1–T10.</p></div></div>
        <div className="molds-size-table" role="table" aria-label="Dimensiones de generación por talle">
          <div className="molds-size-row molds-size-row--header" role="row"><span>Talle</span><span>FRENTE generado</span><span>DORSO generado</span></div>
          {GARMENT_SIZES.map(size => (
            <div className="molds-size-row" role="row" key={size}>
              <strong>{size}</strong>
              {(['front', 'back'] as const).map(side => {
                const spec = planState.plan.find(item => item.size === size && item.side === side);
                return <span className="molds-size-cell" key={side}>{spec ? <><b>{spec.widthPx} × {spec.heightPx} px</b><small>{(spec.physicalWidthMm / 10).toFixed(2)} × {(spec.physicalHeightMm / 10).toFixed(2)} cm a 72 PPI · X {Math.round(spec.scaleX * 1000) / 10}% / Y {Math.round(spec.scaleY * 1000) / 10}%</small></> : 'Elegí ambos masters T8'}</span>;
              })}
            </div>
          ))}
        </div>
        <p className="molds-help">La tabla fija la proporción por talle y lado; la medida física final depende de los píxeles del master T8 elegido. BACK T9/T10 tienen una proporción X/Y distinta observada en los PNG productivos.</p>
        {planState.error ? <p className="molds-error" role="alert">{planState.error}</p> : null}
      </section>

      {operationError ? <p className="molds-error" role="alert">{operationError}</p> : null}
      {progress ? <p className="molds-progress" role="status">{progress}</p> : null}
      <div className="molds-actions">
        <button type="button" className="batch-primary-button" disabled={busy || !masters.front || !masters.back || !outputFolder || !confirmedNoPrintedSizeText || Boolean(prefixError) || Boolean(planState.error) || planState.plan.length !== 20} onClick={() => void generate()}>
          {busy ? 'Generando…' : 'Generar y guardar 20 archivos'}
        </button>
      </div>

      {results ? (
        <section className="molds-results" aria-live="polite">
          <div><h2>{busy ? 'Progreso de generación' : 'Resultado de generación'}</h2><p>{createdCount} creados · {replacedCount} reemplazados · {skippedCount} omitidos por conflicto · {errorCount} errores</p></div>
          {outputFolder ? <p className="molds-help">Salida: {outputFolder.path}</p> : null}
          <div className="molds-result-list">
            {results.map(result => <details key={result.fileName}><summary><b>{result.status === 'created' ? 'CREADO' : result.status === 'replaced' ? 'REEMPLAZADO' : result.status === 'skipped' ? 'OMITIDO' : 'ERROR'}</b> · {result.fileName}</summary>{result.detail ? <p>{result.detail}</p> : null}</details>)}
          </div>
        </section>
      ) : null}
    </section>
  );
}
