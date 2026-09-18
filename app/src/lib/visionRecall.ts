import type { Artifact } from "@/types/artifact";

export interface VisionRecallCandidate {
  id: string;
  name: string;
  score: number;
}

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;
const HASH_BITS = HASH_HEIGHT * (HASH_WIDTH - 1);
const SOURCE_HASH_CACHE = new Map<string, Promise<string>>();

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeImageSrc(src: string): string {
  const raw = safeString(src);
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (typeof window === "undefined") return raw;
  if (raw.startsWith("/")) return `${window.location.origin}${raw}`;
  return `${window.location.origin}/${raw}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("image load timeout"));
    }, 8000);

    const cleanup = () => {
      window.clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("image load failed"));
    };

    img.src = src;
  });
}

async function computeDHash(src: string): Promise<string> {
  const normalized = normalizeImageSrc(src);
  if (!normalized) return "";

  const img = await loadImage(normalized);
  const canvas = document.createElement("canvas");
  canvas.width = HASH_WIDTH;
  canvas.height = HASH_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";

  ctx.drawImage(img, 0, 0, HASH_WIDTH, HASH_HEIGHT);
  const pixels = ctx.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT).data;

  const bits: string[] = [];
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let x = 0; x < HASH_WIDTH - 1; x += 1) {
      const left = (y * HASH_WIDTH + x) * 4;
      const right = (y * HASH_WIDTH + x + 1) * 4;

      const leftGray = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
      const rightGray = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;

      bits.push(leftGray > rightGray ? "1" : "0");
    }
  }

  return bits.join("");
}

function getCachedHash(src: string): Promise<string> {
  const key = normalizeImageSrc(src);
  if (!key) return Promise.resolve("");
  const cached = SOURCE_HASH_CACHE.get(key);
  if (cached) return cached;

  const pending = computeDHash(key).catch(() => "");
  SOURCE_HASH_CACHE.set(key, pending);
  return pending;
}

function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return HASH_BITS;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1;
  }
  return diff;
}

function scoreByDistance(distance: number): number {
  const normalized = 1 - distance / HASH_BITS;
  return Math.max(0, Math.min(1, normalized));
}

function pickCandidateSources(artifact: Artifact): string[] {
  return [artifact.modelImageThumb, artifact.modelImage, artifact.infoImage]
    .map((item) => safeString(item))
    .filter(Boolean)
    .slice(0, 3);
}

export async function recallArtifactsByPhoto(
  imageDataUrl: string,
  artifacts: Artifact[],
  limit = 6
): Promise<VisionRecallCandidate[]> {
  const querySrc = safeString(imageDataUrl);
  if (!querySrc) return [];

  const queryHash = await getCachedHash(querySrc);
  if (!queryHash) return [];

  const rows = await Promise.all(
    artifacts.map(async (artifact) => {
      const sources = pickCandidateSources(artifact);
      if (!sources.length) return null;

      let bestScore = 0;
      for (const source of sources) {
        const sourceHash = await getCachedHash(source);
        if (!sourceHash) continue;
        const distance = hammingDistance(queryHash, sourceHash);
        const score = scoreByDistance(distance);
        if (score > bestScore) {
          bestScore = score;
        }
      }

      if (bestScore <= 0) return null;
      return {
        id: artifact.id,
        name: artifact.name,
        score: Number(bestScore.toFixed(4))
      } satisfies VisionRecallCandidate;
    })
  );

  return rows
    .filter((item): item is VisionRecallCandidate => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .filter((item, index) => {
      if (item.score >= 0.66) return true;
      if (item.score >= 0.56 && index < 3) return true;
      return false;
    })
    .slice(0, Math.max(1, limit));
}
