import { describe, expect, it } from 'vitest';
import { appendSizeMarkPngMetadata, readSizeMarkPngMetadata } from './size-mark-metadata';

const ONE_PIXEL_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nS8AAAAASUVORK5CYII='), c => c.charCodeAt(0));

describe('canonical size marker PNG metadata', () => {
  it('round-trips the source pixel rectangle in an ancillary tEXt chunk', async () => {
    const metadata = { version: 1 as const, size: 'T10' as const, x: 27, y: 43, width: 26, height: 18 };
    expect(readSizeMarkPngMetadata(ONE_PIXEL_PNG)).toBeUndefined();
    const output = await appendSizeMarkPngMetadata(new Blob([ONE_PIXEL_PNG], { type: 'image/png' }), metadata);
    const bytes = new Uint8Array(await output.arrayBuffer());
    expect(output.type).toBe('image/png');
    expect(readSizeMarkPngMetadata(bytes)).toEqual(metadata);
    expect([...bytes.subarray(0, 8)]).toEqual([...ONE_PIXEL_PNG.subarray(0, 8)]);
  });

  it('rejects duplicate marker chunks and malformed marker metadata', async () => {
    const metadata = { version: 1 as const, size: 'T1' as const, x: 2, y: 3, width: 10, height: 18 };
    const once = await appendSizeMarkPngMetadata(new Blob([ONE_PIXEL_PNG]), metadata);
    await expect(appendSizeMarkPngMetadata(once, metadata)).rejects.toThrow(/ya contiene/);
    const bytes = new Uint8Array(await once.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('NestraSizeMark');
  });
});
