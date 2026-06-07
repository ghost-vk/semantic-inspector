import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAnnotation } from './annotationClient';
import type { AnnotationInput } from './types';

const input: AnnotationInput = {
  name: 'пилюля',
  anchor: { comp: 'NavItem' },
  lastSeen: { file: null, loc: null }
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saveAnnotation', () => {
  it('POSTs JSON and returns the saved annotation on 200', async () => {
    const saved = { ...input, createdAt: 'x', updatedAt: 'x' };
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => saved }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await saveAnnotation('/ep', input);

    expect(out).toEqual(saved);
    expect(fetchMock).toHaveBeenCalledWith('/ep', expect.objectContaining({ method: 'POST' }));
    const sentBody = JSON.parse((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1].body as string);
    expect(sentBody.name).toBe('пилюля');
  });

  it('rejects on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    );
    await expect(saveAnnotation('/ep', input)).rejects.toThrow('500');
  });
});
