// node-only: uses node:http (and node:fs/path transitively via annotationStore). Import ONLY from
// src/vite.ts — never from the browser entry (src/index.ts), or node built-ins leak into the bundle.
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
  // index/total are a pair everywhere they are produced and consumed: reject a half-populated
  // anchor (and a nonsensical "index > total") rather than persisting meaningless data.
  if ((out.index === undefined) !== (out.total === undefined)) return null;
  if (out.index !== undefined && out.total !== undefined && out.index > out.total) return null;
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

/**
 * CSRF / cross-origin guard for the file-writing endpoint. The browser is an untrusted client here:
 * any page the developer visits while the dev server runs could try to POST. Two checks:
 *
 *  1. Require `Content-Type: application/json`. A cross-origin `fetch` with this content type is NOT
 *     a CORS "simple request", so the browser must first send a preflight — which this endpoint never
 *     answers with CORS headers, so the write is blocked. This closes the drive-by vector.
 *  2. When an `Origin` header is present, require it to match the request `Host`. Blocks cross-origin
 *     writes as defense in depth, independent of which address the dev server is bound to (so it does
 *     not break `vite --host` LAN development the way a loopback-only Host allowlist would).
 *
 * Returns an error to send, or null when the request may proceed.
 */
function csrfReject(req: IncomingMessage): { status: number; error: string } | null {
  const contentType = req.headers?.['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { status: 415, error: 'content-type must be application/json' };
  }
  const origin = req.headers?.origin;
  if (origin !== undefined) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return { status: 403, error: 'invalid origin' };
    }
    if (originHost !== req.headers?.host) {
      return { status: 403, error: 'cross-origin request forbidden' };
    }
  }
  return null;
}

export interface MiddlewareOptions {
  endpoint?: string;
  /** Injectable clock for tests. */
  now?: () => string;
}

// Serialize the read-modify-write of annotations.json across concurrent requests. Each save chains
// onto the previous one, so two overlapping POSTs cannot both read the same snapshot and lose a
// write (the read + upsert + write run synchronously inside one link, with no await between them).
let saveChain: Promise<unknown> = Promise.resolve();

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
    const rejection = csrfReject(req);
    if (rejection) {
      send(res, rejection.status, { error: rejection.error });
      return;
    }
    readBody(req)
      .then((raw) => {
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          send(res, 400, { error: 'invalid JSON' });
          return undefined;
        }
        const input = parseInput(body);
        if (!input) {
          send(res, 400, { error: 'invalid annotation' });
          return undefined;
        }
        // Chain the read-modify-write onto the serialization queue, then keep the queue alive
        // regardless of outcome so one failed save cannot poison subsequent ones.
        const job = saveChain.then(() => {
          const updated = upsert(readAnnotations(rootDir), input, now());
          writeAnnotations(rootDir, updated);
          return updated.annotations[input.name];
        });
        saveChain = job.then(
          () => undefined,
          () => undefined
        );
        return job.then(
          (saved) => send(res, 200, saved),
          (err: unknown) => {
            // Surface the real cause to the dev server console; the wire response stays generic.
            console.warn(
              `[semantic-inspector] failed to persist annotation: ${err instanceof Error ? err.message : String(err)}`
            );
            send(res, 500, { error: 'failed to persist annotation' });
          }
        );
      })
      .catch(() => send(res, 400, { error: 'bad request body' }));
  };
}
