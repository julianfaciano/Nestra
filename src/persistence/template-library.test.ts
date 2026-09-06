import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { loadLibrary, saveLibrary, serializeLibrary, validateStoredLibrary } from './template-library';

describe('Biblioteca persistente',()=>{
  it('persiste calibración y Blob sin guardar Object URLs',async()=>{
    const input=[{size:'T8' as const,side:'front' as const,physicalWidthMm:254,physicalHeightMm:508,
      alphaThreshold:16,simplificationTolerancePx:1.5}];
    await saveLibrary(input);
    expect(await loadLibrary()).toEqual(input);
    const file=new File(['fixture'],'arte.png',{type:'image/png'});
    const stored=serializeLibrary([{...input[0]!,file,previewUrl:'blob:temporal'}]);
    expect(stored.templates[0]!.image).toBe(file);
    expect(JSON.stringify(stored)).not.toContain('blob:temporal');
  });
  it('rechaza registros corruptos, duplicados y versiones desconocidas',()=>{
    expect(()=>validateStoredLibrary({version:2,templates:[]})).toThrow();
    expect(()=>validateStoredLibrary({version:1,templates:[{size:'T11',side:'front'}]})).toThrow();
    expect(()=>validateStoredLibrary({version:1,templates:[{size:'T8',side:'front',physicalWidthMm:NaN}]})).toThrow();
    expect(()=>validateStoredLibrary({version:1,templates:[{size:'T8',side:'front',alphaThreshold:256}]})).toThrow();
    expect(()=>validateStoredLibrary({version:1,templates:[{size:'T8',side:'front'},{size:'T8',side:'front'}]})).toThrow();
  });
  it('no reemplaza una calibración válida al intentar guardar datos inválidos',async()=>{
    await saveLibrary([{size:'T1',side:'back',physicalWidthMm:100}]);
    await expect(saveLibrary([{size:'T1',side:'back',physicalWidthMm:-1}])).rejects.toThrow();
    expect((await loadLibrary())[0]!.physicalWidthMm).toBe(100);
  });
});

