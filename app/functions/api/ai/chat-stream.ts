import type { Env } from "./_shared";
import {
  buildChatPayload,
  callBigModelStream,
  ndjsonStream,
  readJsonBody,
  resolveArtifactGrounding,
  sanitizeAnswerContent,
  withCors,
  json
} from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (context.request.method !== "POST") {
    return withCors(json({ error: "method not allowed" }, { status: 405 }));
  }

  let question = "";
  try {
    const body = await readJsonBody(context.request);
    question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return withCors(json({ error: "question is required" }, { status: 400 }));
    }

    const grounding = resolveArtifactGrounding(body, context.env);
    const payload = buildChatPayload(context.env, body, grounding);
    payload.stream = true;

    const stream = ndjsonStream();
    const response = withCors(stream.response);

    // Kick off streaming work and return immediately.
    context.waitUntil(
      (async () => {
        let fullAnswer = "";
        let modelName = "";
        try {
          await callBigModelStream(context.env, payload, {
            onDelta: async (delta) => {
              if (!delta) return;
              fullAnswer += delta;
              await stream.write({ type: "delta", delta, answer: fullAnswer });
            },
            onMeta: (meta) => {
              const maybeModel = typeof meta?.model === "string" ? String(meta.model).trim() : "";
              if (maybeModel) modelName = maybeModel;
            }
          });

          const normalized = sanitizeAnswerContent(fullAnswer, {
            allowedArtifactIds: grounding.allowedArtifactIds,
            question,
            primaryArtifactId: grounding.primaryArtifactId,
            primaryArtifactScore: grounding.primaryArtifactScore
          });
          await stream.write({ type: "done", answer: normalized, model: modelName || undefined });
        } catch (error) {
          const message = error instanceof Error ? error.message : "stream error";
          await stream.write({ type: "error", error: message });
        } finally {
          await stream.close();
        }
      })()
    );

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const status = /invalid json|required|too large/.test(message) ? 400 : 500;
    return withCors(json({ error: message }, { status }));
  }
};

