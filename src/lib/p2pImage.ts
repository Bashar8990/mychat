// P2P image helper - compress + base64 + broadcast (ephemeral)
export async function compressImageToBase64(
  file: File,
  maxWidth = 800,
  quality = 0.6
): Promise<string> {
  // Try createImageBitmap first, fallback to Image element for mobile compatibility
  let w: number, h: number;
  let draw: (ctx: CanvasRenderingContext2D) => void;

  try {
    if (typeof createImageBitmap !== "undefined") {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxWidth / bitmap.width);
      w = Math.round(bitmap.width * scale);
      h = Math.round(bitmap.height * scale);
      draw = (ctx) => ctx.drawImage(bitmap, 0, 0, w, h);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      draw(ctx);
      bitmap.close?.();
      return canvas.toDataURL("image/webp", quality);
    }
  } catch {}

  // Fallback: use Image + FileReader
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxWidth / img.width);
  w = Math.round(img.width * scale);
  h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  // webp may not be supported on old browsers, fallback to jpeg
  let out: string;
  try {
    out = canvas.toDataURL("image/webp", quality);
    if (out.startsWith("data:image/webp")) return out;
  } catch {}
  return canvas.toDataURL("image/jpeg", quality);
}

export function downloadBase64Image(dataUrl: string, filename = "image.webp") {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
