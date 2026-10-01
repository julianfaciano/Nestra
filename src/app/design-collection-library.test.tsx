import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { DesignCollectionLibrary, fitCollectionNameFontSize } from './design-collection-library';
import { buildDesignCollection, findCollectionAsset, findCollectionPreviewAsset, type DesignCollection } from './design-collection-state';
import { BatchPage } from './batch-page';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => false }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function folderFile(path: string): File {
  const name = path.split('/').at(-1)!;
  const file = new File([pngSignature], name, { type: 'image/png' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

function nativeBulkSelection(path: string, name: string, files: readonly File[]) {
  return {
    sourceFolderPath: path,
    ignoredFileCount: 0,
    files: files.map(file => ({ fileName: file.name, relativePath: `${name}/${file.name}`, bytes: [...pngSignature] })),
  };
}

function mockNativeFolders(folders: readonly { path: string; name: string; files: readonly File[]; children?: readonly { path: string; name: string }[] }[], roots = folders.map(folder => folder.path)) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'choose_design_folders') return roots;
    if (command === 'design_source_paths_status') return [];
    const folder = folders.find(item => item.path === (args as { path: string }).path);
    if (!folder) throw new Error(`Unexpected directory: ${JSON.stringify(args)}`);
    if (command === 'inspect_design_directory') return { path: folder.path, name: folder.name, pngFileNames: folder.files.map(file => file.name), directFileCount: folder.files.length, children: folder.children ?? [], skippedLinkPaths: [] };
    if (command === 'read_design_folder_direct_from_path') return nativeBulkSelection(folder.path, folder.name, folder.files);
    throw new Error(`Unexpected command: ${command}`);
  });
}

async function chooseAndAnalyzeFolders(folders: readonly { path: string; name: string; files: readonly File[] }[]) {
  mockNativeFolders(folders);
  fireEvent.click(screen.getByRole('button', { name: 'Importar diseños' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agregar carpetas' }));
  await screen.findByText(`${folders.length} carpetas seleccionadas`);
  fireEvent.click(screen.getByRole('button', { name: 'Analizar diseños' }));
}

it('adapts collection names within readable size limits and exposes the full name as a tooltip', () => {
  expect(fitCollectionNameFontSize(180, 100)).toBe(15);
  expect(fitCollectionNameFontSize(90, 500)).toBe(10);
  const collection = { ...buildDesignCollection([], 'long-name'), name: 'very-long-design-name' };
  render(<DesignCollectionLibrary collections={[collection]} onImport={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'very-long-design-name' })).toHaveAttribute('title', 'very-long-design-name');
});

it('shows imported named backs in Library with their existing filename labels and exact source previews', async () => {
  const files = ['BENJI', 'CHICHA'].map(name => new File([name], `aanom${name} ARG26E_0019_T10-DORSO.png`, { type: 'image/png' }));
  const collection = buildDesignCollection(files, 'names');
  const createObjectURL = vi.fn(() => 'blob:named-back');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
  render(<DesignCollectionLibrary collections={[collection]} onImport={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  const replacementDetails = screen.getByText('Dorsos para reposición (2)').closest('details')!;
  expect(replacementDetails).toHaveClass('library-replacement-assets');
  expect(replacementDetails).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('Dorsos para reposición (2)'));
  await waitFor(() => expect(replacementDetails.querySelectorAll('.image-lightbox-trigger')).toHaveLength(2));
  for (const file of files) {
    expect(screen.getByText(`T10 · ${file.name}`)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledWith(file);
  }
  expect(findCollectionPreviewAsset(collection, 'back')?.file).toBe(files[0]);
  expect(findCollectionAsset(collection, 'T10', 'back')).toBeUndefined();
});

it('marks only a complete, duplicate-free T1–T10 collection with the trailing check', () => {
  const files = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].flatMap(size =>
    ['frente', 'dorso'].map(side => new File(['png'], `Boca ${size} ${side}.png`, { type: 'image/png' })),
  );
  const collection = buildDesignCollection(files, 'complete');
  expect(collection.missing).toEqual([]);
  expect(collection.duplicateSlots).toEqual([]);
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:complete'), revokeObjectURL: vi.fn() }));
  render(<DesignCollectionLibrary collections={[collection]} onImport={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  expect(screen.getByText('T1–T10 · ✓')).toBeInTheDocument();
});

it('keeps replacement backs out of the normal card and inside a bounded disclosure', async () => {
  const canonical = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].flatMap((size, index) => [
    new File(['front'], `Boca_${String(index * 2).padStart(4, '0')}_${size}-FRENTE.png`, { type: 'image/png' }),
    new File(['back'], `Boca_${String(index * 2 + 1).padStart(4, '0')}_${size}-DORSO.png`, { type: 'image/png' }),
  ]);
  const replacements = Array.from({ length: 50 }, (_, index) => {
    const file = new File(['nom'], `aanom${index}_T${index % 10 + 1}-DORSO.png`, { type: 'image/png' });
    Object.defineProperty(file, 'webkitRelativePath', { value: `Boca/${file.name}` });
    return file;
  });
  const collection = buildDesignCollection([...canonical, ...replacements], 'many-backs');
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }));
  const view = render(<DesignCollectionLibrary collections={[collection]} onImport={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);

  const details = screen.getByText('Dorsos para reposición (50)').closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(details.querySelector('.library-card-previews')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Dorsos para reposición (50)'));
  await waitFor(() => expect(details.querySelectorAll('.library-replacement-assets .image-lightbox-trigger')).toHaveLength(50));
  expect(view.container.querySelector('.library-replacement-assets .library-card-previews')).toBeInTheDocument();
});

it('shows legacy duplicate diagnostics as a unique, compact disclosure and flags a mixed parent for review', () => {
  const files = [
    ...['Argentina 2024', 'Argentina 2026'].flatMap((season, seasonIndex) => ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'].flatMap((size, index) => [
      folderFile(`Pedido/Argentina/${season}/ARG${seasonIndex}_${String(index * 2).padStart(4, '0')}_${size}-FRENTE.png`),
      folderFile(`Pedido/Argentina/${season}/ARG${seasonIndex}_${String(index * 2 + 1).padStart(4, '0')}_${size}-DORSO.png`),
    ])),
  ];
  const merged = { ...buildDesignCollection(files, 'legacy'), name: 'Argentina', duplicateSlots: Array(80).fill('T1:front') };
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:legacy'), revokeObjectURL: vi.fn() }));
  render(<DesignCollectionLibrary collections={[merged]} onImport={vi.fn()} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  expect(screen.getByText('⚠ 1 slots duplicados')).toBeInTheDocument();
  expect(screen.getByText('⚠ Revisar posible mezcla de subcarpetas')).toBeInTheDocument();
  expect(screen.queryByText(/Hay archivos duplicados para:/)).not.toBeInTheDocument();
  const duplicateDetails = screen.getByText('⚠ 1 slots duplicados').closest('details')!;
  expect(duplicateDetails.querySelectorAll('.design-collection-warning-details span')).toHaveLength(1);
});

it('imports incomplete candidates and blocks duplicate canonical slots', async () => {
  const png = (path: string) => folderFile(path);
  const sizes = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];
  const duplicateFolder = sizes.flatMap((size, index) => [
    png(`Pedido/Duplicado/BOCA_${String(index * 2).padStart(4, '0')}_${size}-FRENTE.png`),
    png(`Pedido/Duplicado/BOCA_${String(index * 2 + 1).padStart(4, '0')}_${size}-DORSO.png`),
  ]);
  duplicateFolder.push(png('Pedido/Duplicado/OTRO_0000_T1-FRENTE.png'));
  const files = [png('Pedido/Incompleto/BOCA_0000_T1-FRENTE.png'), ...duplicateFolder];
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 20, close: vi.fn() })));
  const onImportMany = vi.fn();
  render(<DesignCollectionLibrary collections={[]} onImport={vi.fn()} onImportMany={onImportMany} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  const incomplete = files.slice(0, 1);
  const duplicate = files.slice(1).map(file => {
    const copied = new File([file], file.name, { type: 'image/png' });
    Object.defineProperty(copied, 'webkitRelativePath', { value: `Duplicado/${file.name}` });
    return copied;
  });
  await chooseAndAnalyzeFolders([
    { path: 'S:/Pedido/Incompleto', name: 'Incompleto', files: incomplete },
    { path: 'S:/Pedido/Duplicado', name: 'Duplicado', files: duplicate },
  ]);
  expect(await screen.findByText('Incompleto · se importará')).toBeInTheDocument();
  expect(screen.getByText('Slots duplicados')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Importar 1 diseño' }));
  await waitFor(() => expect(onImportMany).toHaveBeenCalledOnce());
  expect(onImportMany.mock.calls[0]![0]).toEqual([expect.objectContaining({ name: 'Incompleto', missing: expect.any(Array) })]);
  expect(onImportMany.mock.calls[0]![0][0].assets).toHaveLength(1);
});

const realNamedFile = 'aanomFIRULAIS SLE_D_T4.png';
const realFolder = 'San Lorenzo Escudo';
const sourceFolderPath = 'S:\\Biblioteca\\San Lorenzo Escudo';
const nativeFolderSelection = {
  sourceFolderPath,
  ignoredFileCount: 0,
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
    expect(within(screen.getByLabelText('Archivo de Biblioteca')).getAllByRole('option')).toHaveLength(1);
    // Initial side is FRONT, then explicitly select the productive T4 BACK slot.
    fireEvent.change(screen.getByLabelText('Lado'), { target: { value: 'back' } });
    expect(within(screen.getByLabelText('Archivo de Biblioteca')).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: `Actualizar ${realFolder} desde carpeta` }));
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Importar carpeta de diseño' }));
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
  expect(screen.getByLabelText('Diseño')).toHaveValue(updated.id);
  await waitFor(() => expect(screen.getByLabelText('Talle')).toHaveValue('T4'));
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

it('keeps an incomplete design visible in Library and replacement selection but out of complete garments', () => {
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:incomplete'), revokeObjectURL: vi.fn() }));
  const collection = buildDesignCollection([folderFile('Incompleto/TEST_0000_T8-FRENTE.png'), folderFile('Incompleto/TEST_0001_T8-DORSO.png')], 'partial');
  const view = render(<LibraryAndReplacementSelector initial={[collection]} onChange={vi.fn()} />);
  expect(screen.getByText('T1–T10 · incompleto')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Incompleto' })).toBeInTheDocument();
  expect(view.container.querySelectorAll('.collection-batch-card')).toHaveLength(0);
  expect(screen.getByLabelText('Diseño')).toHaveValue(collection.id);
});

it('previews a bulk design import before writing and updates an existing identity in place', async () => {
  const sizes = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];
  const fullFolder = (folder: string) => sizes.flatMap((size, index) => [
    folderFile(`${folder}/BOCA_${String(index * 2).padStart(4, '0')}_${size}-FRENTE.png`),
    folderFile(`${folder}/BOCA_${String(index * 2 + 1).padStart(4, '0')}_${size}-DORSO.png`),
  ]);
  const existing = { ...buildDesignCollection(fullFolder('Boca 2026'), 'boca-id'), name: 'Boca 2026' };
  const incoming = fullFolder('boca 2026');
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 20, close: vi.fn() })));
  const onImport = vi.fn();
  let finishSave!: () => void;
  const onImportMany = vi.fn((_collections: readonly DesignCollection[]) => new Promise<void>(resolve => { finishSave = resolve; }));
  render(<DesignCollectionLibrary collections={[existing]} onImport={onImport} onImportMany={onImportMany} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  await chooseAndAnalyzeFolders([{ path: 'S:/Pedido/boca 2026', name: 'boca 2026', files: incoming }]);
  expect(await screen.findByText('Actualizar existente')).toBeInTheDocument();
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Importar 1 diseño' }));
  await waitFor(() => expect(onImportMany).toHaveBeenCalledOnce());
  expect(await screen.findByText('Guardando 1 diseño en Biblioteca…')).toBeInTheDocument();
  expect(screen.queryByText(/1 actualizados/)).not.toBeInTheDocument();
  expect(onImport).not.toHaveBeenCalled();
  expect(onImportMany.mock.calls[0]?.[0][0]).toMatchObject({ id: 'boca-id', name: 'boca 2026' });
  finishSave();
  expect(await screen.findByText(/1 actualizados/)).toBeInTheDocument();
});

it('lets the user remove one selected folder before analysis and only imports the remaining folders', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 20, close: vi.fn() })));
  const sizes = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];
  const complete = (name: string, code: string) => sizes.flatMap((size, index) => [
    folderFile(`${name}/${code}_${String(index * 2).padStart(4, '0')}_${size}-FRENTE.png`),
    folderFile(`${name}/${code}_${String(index * 2 + 1).padStart(4, '0')}_${size}-DORSO.png`),
  ]);
  const folders = [
    { path: 'S:/Boca', name: 'Boca', files: complete('Boca', 'BOCA') },
    { path: 'S:/Racing', name: 'Racing', files: complete('Racing', 'RAC') },
    { path: 'S:/River', name: 'River', files: complete('River', 'RIV') },
  ];
  mockNativeFolders(folders);
  const onImportMany = vi.fn();
  render(<DesignCollectionLibrary collections={[]} onImport={vi.fn()} onImportMany={onImportMany} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Importar diseños' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agregar carpetas' }));
  await screen.findByText('3 carpetas seleccionadas');
  fireEvent.click(screen.getByRole('button', { name: 'Quitar Racing' }));
  expect(screen.getByText('2 carpetas seleccionadas')).toBeInTheDocument();
  expect(vi.mocked(invoke)).toHaveBeenCalledWith('choose_design_folders');
  vi.mocked(invoke).mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Analizar diseños' }));
  expect(await screen.findByRole('button', { name: 'Importar 2 diseños' })).toBeEnabled();
  expect(vi.mocked(invoke)).toHaveBeenCalledWith('inspect_design_directory', { path: folders[0]!.path });
  expect(vi.mocked(invoke)).toHaveBeenCalledWith('read_design_folder_direct_from_path', { path: folders[2]!.path, fileNames: folders[2]!.files.map(file => file.name) });
  expect(vi.mocked(invoke).mock.calls.some(([, args]) => (args as { path?: string })?.path === folders[1]!.path)).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Importar 2 diseños' }));
  await waitFor(() => expect(onImportMany).toHaveBeenCalledOnce());
  expect(onImportMany.mock.calls[0]?.[0].map((collection: DesignCollection) => collection.name)).toEqual(['Boca', 'River']);
});

it('walks nested master folders and keeps sibling design assets in separate collections', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20, height: 20, close: vi.fn() })));
  const sizes = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10'];
  const complete = (name: string, code: string) => sizes.flatMap((size, index) => [
    folderFile(`${name}/${code}_${String(index * 2).padStart(4, '0')}_${size}-FRENTE.png`),
    folderFile(`${name}/${code}_${String(index * 2 + 1).padStart(4, '0')}_${size}-DORSO.png`),
  ]);
  const root = { path: 'S:/.fanaticotas', name: '.fanaticotas' };
  const parent = { path: 'S:/.fanaticotas/River', name: 'River' };
  const children = [
    { path: 'S:/.fanaticotas/River/River 2023', name: 'River 2023' },
    { path: 'S:/.fanaticotas/River/River 2024', name: 'River 2024' },
  ];
  mockNativeFolders([
    { ...root, files: [], children: [parent] },
    { ...parent, files: [], children },
    { ...children[0]!, files: complete(children[0]!.name, 'RIV23') },
    { ...children[1]!, files: complete(children[1]!.name, 'RIV24') },
  ], [root.path]);
  const onImportMany = vi.fn();
  render(<DesignCollectionLibrary collections={[]} onImport={vi.fn()} onImportMany={onImportMany} onRemove={vi.fn()} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Importar diseños' }));
  fireEvent.click(screen.getByRole('button', { name: 'Agregar carpetas' }));
  await screen.findByText('1 carpetas seleccionadas');
  fireEvent.click(screen.getByRole('button', { name: 'Analizar diseños' }));
  expect(await screen.findByRole('button', { name: 'Importar 2 diseños' })).toBeEnabled();
  expect(screen.getByText('River 2023')).toBeInTheDocument();
  expect(screen.getByText('River 2024')).toBeInTheDocument();
  expect(screen.queryByText('.fanaticotas')).not.toBeInTheDocument();
  expect(vi.mocked(invoke)).toHaveBeenCalledWith('inspect_design_directory', { path: root.path });
  expect(vi.mocked(invoke)).toHaveBeenCalledWith('inspect_design_directory', { path: parent.path });
  fireEvent.click(screen.getByRole('button', { name: 'Importar 2 diseños' }));
  await waitFor(() => expect(onImportMany).toHaveBeenCalledOnce());
  const imported = onImportMany.mock.calls[0]?.[0] as readonly DesignCollection[];
  expect(imported.map(collection => collection.name)).toEqual(['River 2023', 'River 2024']);
  expect(imported.map(collection => collection.assets.length)).toEqual([20, 20]);
  expect(imported[0]?.assets.every(asset => asset.fileName.startsWith('RIV23_'))).toBe(true);
  expect(imported[1]?.assets.every(asset => asset.fileName.startsWith('RIV24_'))).toBe(true);
});
