import type { Annotation, AnnotationInput } from './types';

/** POST an annotation to the dev-server endpoint. Resolves with the saved record, rejects on failure. */
export async function saveAnnotation(endpoint: string, input: AnnotationInput): Promise<Annotation> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(`annotation save failed: ${res.status}`);
  return (await res.json()) as Annotation;
}
