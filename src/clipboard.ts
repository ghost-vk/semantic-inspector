/** Copy text to the clipboard. Requires a secure context (https or localhost). */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard API unavailable (needs a secure context: https or localhost)');
  }
  await navigator.clipboard.writeText(text);
}

/**
 * Copy a PNG screenshot of ONLY the given element to the clipboard (image/png).
 * Must be called from a user gesture (click), or the browser blocks the image write.
 *
 * `modern-screenshot` is imported lazily so it is emitted as a separate chunk and never lands
 * in a consumer's production bundle through the runtime entry.
 */
export async function copyElementShot(el: Element): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image write unsupported (needs a secure context: https or localhost)');
  }
  const { domToBlob } = await import('modern-screenshot');
  // scale: 1 avoids the 4x rasterization cost of devicePixelRatio on Retina displays.
  const blob = await domToBlob(el as HTMLElement, { scale: 1 });
  if (!blob) throw new Error('screenshot produced empty blob');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
