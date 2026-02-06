export interface ImageAttachment {
  dataUrl: string;
  mime: string;
  name: string;
  bytes: number;
  width: number;
  height: number;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function estimateDataUrlBytes(dataUrl: string): number {
  // data:[mime];base64,<payload>
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToCompressedImageAttachment(
  file: File,
  options?: {
    maxEdge?: number;
    quality?: number;
  }
): Promise<ImageAttachment> {
  const maxEdge = options?.maxEdge ?? 1024;
  const quality = options?.quality ?? 0.78;

  const img = await loadImageFromFile(file);
  const srcWidth = Math.max(1, img.naturalWidth || img.width || 1);
  const srcHeight = Math.max(1, img.naturalHeight || img.height || 1);

  const scale = Math.min(1, maxEdge / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("canvas not supported");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const mime = "image/jpeg";
  const dataUrl = canvas.toDataURL(mime, quality);

  return {
    dataUrl,
    mime,
    name: safeString(file.name) || "photo.jpg",
    bytes: estimateDataUrlBytes(dataUrl),
    width,
    height
  };
}

