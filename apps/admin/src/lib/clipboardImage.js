const isImage = (type) => /^image\//.test(String(type || ''));

/** The first image file in a paste event's clipboardData, or null. */
export function pastedImage(clipboardData) {
  if (!clipboardData) return null;
  for (const item of Array.from(clipboardData.items || [])) {
    if (item.kind === 'file' && isImage(item.type)) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return Array.from(clipboardData.files || []).find((file) => isImage(file.type)) || null;
}

/** Reads an image copied to the system clipboard (button click, no paste event). */
export async function readClipboardImage(name, clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard?.read) throw new Error('This browser cannot read images from the clipboard. Press ⌘V / Ctrl+V instead.');
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find(isImage);
    if (!type) continue;
    const blob = await item.getType(type);
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
    return new File([blob], `${name}.${ext}`, { type });
  }
  return null;
}
