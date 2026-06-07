import { domToBlob } from 'modern-screenshot';

/** Текст в буфер. */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/**
 * PNG-скриншот ТОЛЬКО переданного элемента в буфер (image/png).
 * Должен вызываться из user-gesture (клик), иначе браузер блокит image-копию.
 */
export async function copyElementShot(el: Element): Promise<void> {
  const blob = await domToBlob(el as HTMLElement);
  if (!blob) throw new Error('screenshot produced empty blob');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
