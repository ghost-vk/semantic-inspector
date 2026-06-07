import type { IncomingMessage, ServerResponse } from 'node:http';
import { ANNOTATION_ENDPOINT } from './annotationEndpoint';
import { readAnnotations, upsert, writeAnnotations } from './annotationStore';
import type { AnnotationAnchor, AnnotationInput, AnnotationLastSeen } from './types';

type Next = () => void;
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

const NAME_CAP = 200;
const NOTE_CAP = 2000;
const TAG_CAP = 60;
const TAGS_MAX = 30;
const TEXT_CAP = 200;
const PATH_MAX = 8;
const BODY_CAP = 256 * 1024;
const ATTR_KEYS = ['id', 'data-testid', 'name', 'href', 'type'];
const PROTO_KEYS = ['__proto__', 'constructor', 'prototype'];

const isStr = (v: unknown): v is string => typeof v === 'string';

function parseAnchor(v: unknown): AnnotationAnchor | null {
  if (typeof v !== 'object' || v === null) return null;
  const a = v as Record<string, unknown>;
  if (!isStr(a.comp) || a.comp.length > TEXT_CAP) return null;
  const out: AnnotationAnchor = { comp: a.comp };
  if (a.path !== undefined) {
    if (!Array.isArray(a.path) || a.path.length > PATH_MAX) return null;
    if (!a.path.every((p) => isStr(p) && p.length <= TEXT_CAP)) return null;
    out.path = a.path as string[];
  }
  if (a.text !== undefined) {
    if (!isStr(a.text) || a.text.length > TEXT_CAP) return null;
    out.text = a.text;
  }
  if (a.index !== undefined) {
    if (typeof a.index !== 'number' || !Number.isInteger(a.index) || a.index < 0) return null;
    out.index = a.index;
  }
  if (a.total !== undefined) {
    if (typeof a.total !== 'number' || !Number.isInteger(a.total) || a.total < 0) return null;
    out.total = a.total;
  }
  if (a.attrs !== undefined) {
    if (typeof a.attrs !== 'object' || a.attrs === null) return null;
    const attrs: Record<string, string> = {};
    for (const [k, val] of Object.entries(a.attrs as Record<string, unknown>)) {
      if (!ATTR_KEYS.includes(k)) continue; // drop anything not whitelisted
      if (!isStr(val) || val.length > TEXT_CAP) return null;
      attrs[k] = val;
    }
    out.attrs = attrs;
  }
  return out;
}

function parseLastSeen(v: unknown): AnnotationLastSeen | null {
  if (typeof v !== 'object' || v === null) return null;
  const l = v as Record<string, unknown>;
  const file = l.file === null ? null : isStr(l.file) && l.file.length <= TEXT_CAP ? l.file : undefined;
  const loc = l.loc === null ? null : isStr(l.loc) && l.loc.length <= TEXT_CAP ? l.loc : undefined;
  if (file === undefined || loc === undefined) return null;
  return { file, loc };
}

/** Validate an untrusted request body into an AnnotationInput, or null if invalid. */
export function parseInput(body: unknown): AnnotationInput | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!isStr(b.name) || b.name.trim() === '' || b.name.length > NAME_CAP) return null;
  if (PROTO_KEYS.includes(b.name.trim())) return null;
  let tags: string[] | undefined;
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > TAGS_MAX) return null;
    if (!b.tags.every((t) => isStr(t) && t.length <= TAG_CAP)) return null;
    tags = b.tags as string[];
  }
  let note: string | undefined;
  if (b.note !== undefined) {
    if (!isStr(b.note) || b.note.length > NOTE_CAP) return null;
    note = b.note;
  }
  const anchor = parseAnchor(b.anchor);
  if (!anchor) return null;
  const lastSeen = parseLastSeen(b.lastSeen);
  if (!lastSeen) return null;
  return { name: b.name.trim(), tags, note, anchor, lastSeen };
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > BODY_CAP) throw new Error('body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export interface MiddlewareOptions {
  endpoint?: string;
  /** Injectable clock for tests. */
  now?: () => string;
}

/**
 * Connect-style middleware that persists annotations on POST. The output path is derived ONLY from
 * `rootDir` (never from the request body or URL), so a malicious `name` cannot escape the directory.
 * Mounted via `configureServer`, so it exists only on the dev server.
 */
export function createAnnotationMiddleware(rootDir: string, options: MiddlewareOptions = {}): Handler {
  const endpoint = options.endpoint ?? ANNOTATION_ENDPOINT;
  const now = options.now ?? (() => new Date().toISOString());
  return (req, res, next) => {
    if ((req.url ?? '').split('?')[0] !== endpoint || req.method !== 'POST') {
      next();
      return;
    }
    readBody(req)
      .then((raw) => {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          send(res, 400, { error: 'invalid JSON' });
          return;
        }
        const input = parseInput(body);
        if (!input) {
          send(res, 400, { error: 'invalid annotation' });
          return;
        }
        try {
          const updated = upsert(readAnnotations(rootDir), input, now());
          writeAnnotations(rootDir, updated);
          send(res, 200, updated.annotations[input.name]);
        } catch {
          send(res, 500, { error: 'failed to persist annotation' });
        }
      })
      .catch(() => send(res, 400, { error: 'bad request body' }));
  };
}
