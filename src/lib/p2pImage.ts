// P2P image helper - compress + base64 + broadcast (ephemeral)
export async function compressImageToBase64(
  file: File,
  maxWidth = 800,
  quality = 0.6
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/webp", quality);
}

export function downloadBase64Image(dataUrl: string, filename = "image.webp") {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
