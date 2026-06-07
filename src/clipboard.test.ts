import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('modern-screenshot', () => ({
  domToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
}));

import { domToBlob } from 'modern-screenshot';
import { copyElementShot, copyText } from './clipboard';

const writeText = vi.fn(async () => {});
const write = vi.fn(async () => {});
const mockedDomToBlob = domToBlob as Mock;

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

beforeEach(() => {
  writeText.mockClear();
  write.mockClear();
  mockedDomToBlob.mockReset();
  mockedDomToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  setClipboard({ writeText, write });
  // happy-dom may not provide ClipboardItem.
  (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
    constructor(public readonly items: Record<string, Blob>) {}
  };
});

describe('clipboard', () => {
  it('copyText writes plain text', async () => {
    await copyText('Foo — src/Foo.tsx:1:1');
    expect(writeText).toHaveBeenCalledWith('Foo — src/Foo.tsx:1:1');
  });

  it('copyElementShot writes an image/png ClipboardItem', async () => {
    await copyElementShot(document.createElement('div'));
    expect(write).toHaveBeenCalledOnce();
    const [items] = write.mock.calls[0] as unknown as [unknown[]];
    expect(items[0]).toBeInstanceOf(ClipboardItem);
  });

  it('copyElementShot rasterizes at scale 1', async () => {
    await copyElementShot(document.createElement('div'));
    expect(mockedDomToBlob).toHaveBeenCalledWith(expect.anything(), { scale: 1 });
  });

  it('copyElementShot throws on an empty blob', async () => {
    mockedDomToBlob.mockResolvedValueOnce(null);
    await expect(copyElementShot(document.createElement('div'))).rejects.toThrow('empty blob');
  });

  it('copyElementShot rejects on a tainted canvas', async () => {
    mockedDomToBlob.mockRejectedValueOnce(new Error('Tainted canvases may not be exported'));
    await expect(copyElementShot(document.createElement('div'))).rejects.toThrow(/Tainted/);
  });

  it('copyText rejects without a secure context (no navigator.clipboard)', async () => {
    setClipboard(undefined);
    await expect(copyText('x')).rejects.toThrow(/secure context/);
  });
});
