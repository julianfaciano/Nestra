import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { DesignCollectionLibrary } from './design-collection-library';
import { buildDesignCollection, findCollectionAsset, findCollectionPreviewAsset, type DesignCollection } from './design-collection-state';
import { BatchPage } from './batch-page';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('shows imported named backs in Library with their existing filename labels and exact source previews', () => {
  const files = ['BENJI', 'CHICHA'].map(name => new File([name], `aanom${name} ARG26E_0019_T10-DORSO.png`, { type: 'image/png' }));
  const collection = buildDesignCollection(files, 'names');
  const createObjectURL = vi.fn(() => 'blob:named-back');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
  render(<DesignCollectionLibrary collections={[collection]} onImport={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  expect(screen.getByText('Dorsos para reposición (2)')).toBeInTheDocument();
  for (const file of files) {
    expect(screen.getByText(`T10 · ${file.name}`)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(file);
  }
  expect(findCollectionPreviewAsset(collection, 'back')?.file).toBe(files[0]);
  expect(findCollectionAsset(collection, 'T10', 'back')).toBeUndefined();
});

const realNamedFile = 'aanomFIRULAIS SLE_D_T4.png';
const realFolder = 'San Lorenzo Escudo';
const sourceFolderPath = 'S:\\Biblioteca\\San Lorenzo Escudo';
const nativeFolderSelection = {
  sourceFolderPath,
  files: [
    { fileName: realNamedFile, relativePath: `${realFolder}/${realNamedFile}`, bytes: [31, 32, 33] },
    { fileName: 'SLE_0006_T4-FRENTE.png', relativePath: `${realFolder}/SLE_0006_T4-FRENTE.png`, bytes: [11, 12] },
    { fileName: 'SLE_0007_T4-DORSO.png', relativePath: `${realFolder}/SLE_0007_T4-DORSO.png`, bytes: [21, 22] },
  ],
};

function LibraryAndReplacementSelector({ initial = [], onChange }: {
  initial?: DesignCollection[];
  onChange: (collection: DesignCollection) => void;
}) {
  const [collections, setCollections] = useState(initial);
  return <>
    <DesignCollectionLibrary collections={collections}
      onImport={collection => { onChange(collection); setCollections(current => [...current, collection]); }}
      onUpdate={collection => { onChange(collection); setCollections(current => current.map(item => item.id === collection.id ? collection : item)); }}
      onRemove={vi.fn()} />
    <BatchPage templates={[]} collections={collections} />
  </>;
}

it.each(['import', 'refresh'] as const)('%s incorporates the exact nom filename and exposes it beside the canonical BACK in the replacement selector', async mode => {
  window.sessionStorage.removeItem('nestra.batch.collection-quantities');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => 'blob:library-file'), revokeObjectURL: vi.fn(),
  }));
  const onChange = vi.fn();
  const legacyFiles = nativeFolderSelection.files.slice(1).map(entry => {
    const file = new File([new Uint8Array(entry.bytes)], entry.fileName, { type: 'image/png' });
    Object.defineProperty(file, 'webkitRelativePath', { value: entry.relativePath });
    return file;
  });
  const previous = { ...buildDesignCollection(legacyFiles, 'san-lorenzo', sourceFolderPath), ignoredFileNames: [realNamedFile] };
  vi.mocked(invoke).mockResolvedValueOnce(nativeFolderSelection);
  render(<LibraryAndReplacementSelector initial={mode === 'refresh' ? [previous] : []} onChange={onChange} />);
  if (mode === 'refresh') {
    fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
    expect(within(screen.getByLabelText('Archivo de Biblioteca')).getAllByRole('option')).toHaveLength(1);
    // Initial side is FRONT, then explicitly select the productive T4 BACK slot.
    fireEvent.change(screen.getByLabelText('Lado'), { target: { value: 'back' } });
    expect(within(screen.getByLabelText('Archivo de Biblioteca')).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: `Actualizar ${realFolder} desde carpeta` }));
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Importar colección' }));
  }
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(invoke).toHaveBeenCalledWith(mode === 'refresh' ? 'read_design_folder_from_path' : 'choose_design_folder',
    ...(mode === 'refresh' ? [{ path: sourceFolderPath }] : []));
  const updated = onChange.mock.calls[0]![0] as DesignCollection;
  expect(updated.name).toBe(realFolder);
  expect(updated.sourceFolderPath).toBe(sourceFolderPath);
  if (mode === 'refresh') expect(updated.id).toBe(previous.id);
  expect(updated.ignoredFileNames).not.toContain(realNamedFile);
  expect(updated.replacementAssets).toEqual([expect.objectContaining({ fileName: realNamedFile, size: 'T4', side: 'back' })]);
  expect(findCollectionAsset(updated, 'T4', 'back')?.fileName).toBe('SLE_0007_T4-DORSO.png');
  expect(updated.duplicateSlots).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Agregar reposición' }));
  expect(screen.getByLabelText('Diseño')).toHaveValue(updated.id);
  expect(screen.getByLabelText('Talle')).toHaveValue('T4');
  fireEvent.change(screen.getByLabelText('Lado'), { target: { value: 'back' } });
  const selector = screen.getByLabelText('Archivo de Biblioteca');
  expect(within(selector).getAllByRole('option').map(option => option.textContent)).toEqual([
    `${realFolder}/SLE_0007_T4-DORSO.png`, `${realFolder}/${realNamedFile}`,
  ]);
  fireEvent.change(selector, { target: { value: `${realFolder}/${realNamedFile}` } });
  expect(selector).toHaveValue(`${realFolder}/${realNamedFile}`);
});

it('preserves canonical Library previews and pairing when additional edited backs exist', () => {
  const files = [
    new File(['front'], 'ARG26E_0014_T8-FRENTE.png', { type: 'image/png' }),
    new File(['back'], 'ARG26E_0015_T8-DORSO.png', { type: 'image/png' }),
    new File(['edited'], 'aanomBENJI ARG26E_0015_T8-DORSO.png', { type: 'image/png' }),
  ];
  const collection = buildDesignCollection(files, 'names');
  expect(findCollectionPreviewAsset(collection, 'front')?.file).toBe(files[0]);
  expect(findCollectionPreviewAsset(collection, 'back')?.file).toBe(files[1]);
  expect(findCollectionAsset(collection, 'T8', 'back')?.file).toBe(files[1]);
});
