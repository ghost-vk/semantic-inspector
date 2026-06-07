import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('modern-screenshot', () => ({
  domToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' }))
}));

import { copyElementShot, copyText } from './clipboard';

const writeText = vi.fn(async () => {});
const write = vi.fn(async () => {});

beforeEach(() => {
  writeText.mockClear();
  write.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, write },
    configurable: true
  });
  // happy-dom может не иметь ClipboardItem.
  (globalThis as unknown as { ClipboardItem: unknown }).ClipboardItem = class {
    constructor(public readonly items: Record<string, Blob>) {}
  };
});

describe('clipboard', () => {
  it('copyText writes plain text', async () => {
    await copyText('Foo — src/Foo.tsx:1');
    expect(writeText).toHaveBeenCalledWith('Foo — src/Foo.tsx:1');
  });

  it('copyElementShot writes an image/png ClipboardItem', async () => {
    await copyElementShot(document.createElement('div'));
    expect(write).toHaveBeenCalledOnce();
    const [items] = write.mock.calls[0] as unknown as [{ items: Record<string, Blob> }[]];
    expect(items[0].items['image/png']).toBeInstanceOf(Blob);
  });
});
