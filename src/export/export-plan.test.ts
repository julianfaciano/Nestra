import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPRENTA_PROFILE, DEFAULT_CALANDRA_PROFILE } from '../domain/canvas-profile';
import type { BatchPieceDefinition } from '../domain/production-batch';
import { mm } from '../domain/units';
import { transformPolygon } from '../geometry/polygon-transform';
import {
  deduplicateExportLayouts,
  fabricSlug,
  letterSuffix,
  physicalArtworkHeight,
  preflightBatch,
  type PreparedBatch,
} from './export-plan';

const polygon = [{x:0,y:0},{x:10,y:0},{x:10,y:20},{x:0,y:20}];
const definition = (id:string, side:'front'|'back'): BatchPieceDefinition => ({
  kind: 'garment',
  id, side, model:'River', size:'T8', fabric:'polar', quantity:1, fileName:id+'.png',
  imageUrl:'blob:'+id, sourceWidthPx:100, sourceHeightPx:200,
  physicalWidthMm:mm(10), physicalHeightMm:mm(20), alphaThreshold:16, simplificationTolerancePx:1.5,
});
function batch(): PreparedBatch {
  return { profile:DEFAULT_IMPRENTA_PROFILE, definitions:[definition('front','front'),definition('back','back')],
    polygons:new Map([['front',polygon],['back',polygon]]),
    results:[{ fabric:'polar', elapsedMs:0, unplacedPieceIds:[], layouts:[{
      index:0, usedWidth:20, usedHeight:20, pieces:[
        {pieceId:'front-1',placement:{x:0,y:0,rotation:0},polygon},
        {pieceId:'back-1',placement:{x:10,y:0,rotation:0},polygon:transformPolygon(polygon,{x:10,y:0,rotation:0})},
      ],
    }]}],
  };
}
function withPlacement(x:number, rotation:0|90|-90|180 = 0): PreparedBatch {
  const b=batch(), r=b.results[0]!, l=r.layouts[0]!;
  return {...b, results:[{...r, layouts:[{...l, pieces:[l.pieces[0]!, {...l.pieces[1]!, placement:{x,y:0,rotation}}]}]}]};
}
describe('Preflight y plan de exportación', () => {
  it('permite contacto exacto y conserva los 1480 mm productivos', () => {
    const report=preflightBatch(batch());
    expect(report.errors).toEqual([]);
    expect(report.layouts[0]).toMatchObject({widthMm:1480,heightMm:20,widthPx:17480,heightPx:236,offsetX:0,name:'polar_1_copia.png'});
  });
  it('conserva 1480 mm cuando el margen transparente rebasa el origen del nesting', () => {
    const b = batch();
    const inset = [{x:2,y:2},{x:8,y:2},{x:8,y:18},{x:2,y:18}];
    const result = preflightBatch({
      ...b,
      polygons: new Map([['front', inset], ['back', inset]]),
      results: [{
        ...b.results[0]!,
        layouts: [{
          ...b.results[0]!.layouts[0]!,
          pieces: [
            {pieceId:'front-1',placement:{x:0,y:0,rotation:0},polygon:transformPolygon(inset,{x:0,y:0,rotation:0})},
            {pieceId:'back-1',placement:{x:6,y:0,rotation:0},polygon:transformPolygon(inset,{x:6,y:0,rotation:0})},
          ],
        }],
      }],
    });
    expect(result.errors).toEqual([]);
    expect(result.layouts[0]).toMatchObject({widthMm:1480,offsetX:-2});
  });
  it('rechaza colisión real', () => expect(preflightBatch(withPlacement(9)).errors.join()).toContain('colisión'));
  it('rechaza fuera del canvas', () => expect(preflightBatch(withPlacement(1480)).errors.join()).toContain('fuera'));
  it('rechaza dorso a 90 grados', () => expect(preflightBatch(withPlacement(10,90)).errors.join()).toContain('rotación'));
  it('detecta pieza faltante, duplicada y no solicitada', () => {
    const b=batch(), r=b.results[0]!, l=r.layouts[0]!, p=l.pieces[0]!;
    const report=preflightBatch({...b,results:[{...r,layouts:[{...l,pieces:[p,p,{...p,pieceId:'extra'}]}]}]});
    expect(report.errors.join()).toContain('duplicada'); expect(report.errors.join()).toContain('no solicitada'); expect(report.errors.join()).toContain('Falta pieza');
  });
  it('no permite sustituir una tela', () => {
    const b=batch(); expect(preflightBatch({...b,results:[{...b.results[0]!,fabric:'deportiva'}]}).errors.join()).toContain('Mezcla');
  });
  it('bloquea frentes sin dorsos', () => {
    const b=batch(); expect(preflightBatch({...b,definitions:[b.definitions[0]!]}).errors.join()).toContain('Frente/dorso');
  });
  it('permite frente y dorso en canvases distintos', () => {
    const b=batch(),r=b.results[0]!,l=r.layouts[0]!;
    const result=preflightBatch({...b,results:[{...r,layouts:l.pieces.map((p,index)=>({...l,index,pieces:[p]}))}]});
    expect(result.errors).toEqual([]); expect(result.layouts.map(l=>l.name)).toEqual(['polar_1_copia.png','polar_1_copia_b.png']);
  });
  it('rechaza dimensiones no finitas y calandra de más de 5000 mm', () => {
    const b=batch(); expect(preflightBatch({...b,profile:{...DEFAULT_CALANDRA_PROFILE,maxHeight:mm(5001)}}).errors.length).toBeGreaterThan(0);
    expect(preflightBatch({...b,definitions:[{...b.definitions[0]!,sourceWidthPx:NaN},b.definitions[1]!]}).errors.length).toBeGreaterThan(0);
  });
  it('no confunde geometría normalizada con origen del arte al rotar', () => {
    const b=batch(), d=b.definitions[0]!, shifted=polygon.map(p=>({x:p.x+2,y:p.y+3})), r=b.results[0]!,l=r.layouts[0]!;
    const result=preflightBatch({...b, definitions:[d,b.definitions[1]!],polygons:new Map([['front',shifted],['back',polygon]]),
      results:[{...r,layouts:[{...l,pieces:[{...l.pieces[0]!,placement:{x:0,y:0,rotation:90}},{...l.pieces[1]!,placement:{x:30,y:0,rotation:0}}]}]}]});
    expect(result.errors).toEqual([]);
    expect(result.layouts[0]!.pieces[0]).toMatchObject({translateX:23,translateY:-2});
    expect(result.layouts[0]!.offsetY).toBe(-2);
  });
  it('no advierte por la resolución fuente', () =>
  expect(preflightBatch(batch()).warnings.join()).not.toContain('PPI'),
);
  it('genera sufijos alfabéticos también después de z',()=>{
    expect([0,1,2,25,26].map(letterSuffix)).toEqual(['','_b','_c','_z','_aa']);
    expect(fabricSlug(' Polar / Deportivo Á ')).toBe('polar_deportivo_a');
  });
  it('usa cualquier texto de tela como prefijo de exportación', () => {
    const b = batch();
    const report = preflightBatch({
      ...b,
      definitions: b.definitions.map((definition) => ({ ...definition, fabric: 'set' })),
      results: [{ ...b.results[0]!, fabric: 'set' }],
    });
    expect(report.errors).toEqual([]);
    expect(report.layouts[0]!.name).toBe('set_1_copia.png');
  });
  it('rechaza deformación y admite redondeo mediante escala uniforme',()=>{
    expect(physicalArtworkHeight(100, 80, 100, 100)).toBe(80);
expect(physicalArtworkHeight(100, 100.1, 100, 100)).toBe(100.1);
  });
  it('no permite imágenes no referenciadas ni resultados vacíos',()=>{
    const b=batch();
    expect(preflightBatch({...b,definitions:[{...b.definitions[0]!,imageUrl:''},b.definitions[1]!]}).errors.join()).toContain('Falta imagen');
    expect(preflightBatch({...b,results:[]}).errors.join()).toContain('Falta pieza');
  });
  it('deduplica layouts idénticos y expresa las copias en el nombre', () => {
  const first = preflightBatch(batch()).layouts[0];

  if (!first) {
    throw new Error(
      'Falta layout para la prueba.',
    );
  }

  const duplicated =
    deduplicateExportLayouts([
      first,
      {
        ...first,
        name: 'temporal_b.png',
      },
      {
        ...first,
        name: 'temporal_c.png',
      },
    ]);

  expect(duplicated).toHaveLength(1);

  expect(duplicated[0]?.name).toBe(
    'polar_3_copias.png',
  );
});

it('no deduplica layouts con diferente contenido', () => {
  const first = preflightBatch(batch()).layouts[0];

  if (!first) {
    throw new Error(
      'Falta layout para la prueba.',
    );
  }

  const originalPiece = first.pieces[0];

  if (!originalPiece) {
    throw new Error(
      'Falta pieza para la prueba.',
    );
  }

  const different = {
    ...first,
    name: 'otro.png',
    pieces: [
      {
        ...originalPiece,
        definition: {
          ...originalPiece.definition,
          id: 'arte-distinto',
          fileName: 'otro-arte.png',
        },
      },
      ...first.pieces.slice(1),
    ],
  };

  const result =
    deduplicateExportLayouts([
      first,
      different,
    ]);

  expect(result).toHaveLength(2);

  expect(result.map((layout) => layout.name)).toEqual([
  'polar_1_copia.png',
  'polar_1_copia_b.png',
]);
});
});
