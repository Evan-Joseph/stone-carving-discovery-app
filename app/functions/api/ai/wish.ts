import type { Env, CandidateRef } from "./_shared";
import { json, pickWishByFallback, pickWishByModel, readJsonBody, withCors } from "./_shared";

function normalizeCandidates(input: unknown): CandidateRef[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id.trim() : "";
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      const series = typeof obj.series === "string" ? obj.series.trim() : "";
      const tags = Array.isArray(obj.tags) ? (obj.tags as unknown[]).map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean) : [];
      const pdfTopic = typeof obj.pdfTopic === "string" ? obj.pdfTopic.trim() : "";
      if (!id || !name) return null;
      return { id, name, series, tags, pdfTopic };
    })
    .filter(Boolean) as CandidateRef[];
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (context.request.method !== "POST") {
    return withCors(json({ error: "method not allowed" }, { status: 405 }));
  }

  let body: Record<string, unknown> = {};
  try {
    body = await readJsonBody(context.request);
    const wish = typeof body.wish === "string" ? body.wish.trim() : "";
    const candidates = normalizeCandidates(body.candidates);
    if (!wish) return withCors(json({ error: "wish is required" }, { status: 400 }));
    if (!candidates.length) return withCors(json({ error: "candidates is required" }, { status: 400 }));

    try {
      const picked = await pickWishByModel(context.env, wish, candidates);
      return withCors(json(picked));
    } catch {
      const fallback = pickWishByFallback(wish, candidates);
      return withCors(json(fallback));
    }
  } catch (error) {
    const wish = typeof body.wish === "string" ? body.wish.trim() : "";
    const candidates = normalizeCandidates(body.candidates);
    if (wish && candidates.length) {
      return withCors(json(pickWishByFallback(wish, candidates)));
    }
    const message = error instanceof Error ? error.message : "unknown error";
    const status = /invalid json|required|too large/.test(message) ? 400 : 500;
    return withCors(json({ error: message }, { status }));
  }
};
