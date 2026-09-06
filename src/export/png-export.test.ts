import { describe, expect, it, vi } from 'vitest';
import { drawStrip, STRIP_ROWS } from './png-export';
import { mm } from '../domain/units';
import { PX_PER_MM, type ExportLayout } from './export-plan';

describe('Render por franjas',()=>{
  it('usa blanco y mantiene una transformación global idéntica entre franjas',()=>{
    const context={resetTransform:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),drawImage:vi.fn(),fillStyle:'',imageSmoothingEnabled:false,imageSmoothingQuality:'low'};
    const image={} as CanvasImageSource;
    const layout: ExportLayout={name:'polar_1_copia.png',fabric:'polar',widthMm:10,heightMm:20,widthPx:118,heightPx:236,offsetX:-2,offsetY:3,pieces:[{
      definition:{kind:'garment',id:'f',model:'a',size:'T8',side:'front',fabric:'polar',quantity:1,fileName:'a.png',imageUrl:'blob:a',sourceWidthPx:100,sourceHeightPx:200,physicalWidthMm:mm(10),physicalHeightMm:mm(20),alphaThreshold:16,simplificationTolerancePx:1.5},
      placement:{x:0,y:0,rotation:90},translateX:23,translateY:-2,
    }]};
    drawStrip(context as unknown as CanvasRenderingContext2D,layout,new Map([['f',image]]),STRIP_ROWS,STRIP_ROWS);
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.translate).toHaveBeenNthCalledWith(1,2*PX_PER_MM,-3*PX_PER_MM-STRIP_ROWS);
    expect(context.translate).toHaveBeenNthCalledWith(2,23*PX_PER_MM,-2*PX_PER_MM);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI/2);
    expect(context.drawImage).toHaveBeenCalledWith(image,0,0,10*PX_PER_MM,20*PX_PER_MM);
    expect(()=>drawStrip(context as unknown as CanvasRenderingContext2D,layout,new Map(),0,STRIP_ROWS)).toThrow('Imagen no disponible');
  });
});

