import type { Env } from "./_shared";
import { buildChatPayload, callBigModel, extractAssistantText, json, readJsonBody, resolveArtifactGrounding, sanitizeAnswerContent, withCors } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (context.request.method !== "POST") {
    return withCors(json({ error: "method not allowed" }, { status: 405 }));
  }

  try {
    const body = await readJsonBody(context.request);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return withCors(json({ error: "question is required" }, { status: 400 }));
    }

    const grounding = resolveArtifactGrounding(body, context.env);
    const payload = buildChatPayload(context.env, body, grounding);
    const response = await callBigModel(context.env, payload);
    const answer = sanitizeAnswerContent(extractAssistantText(response), {
      allowedArtifactIds: grounding.allowedArtifactIds,
      question,
      primaryArtifactId: grounding.primaryArtifactId,
      primaryArtifactScore: grounding.primaryArtifactScore
    });

    if (!answer) {
      return withCors(json({ error: "empty model answer" }, { status: 502 }));
    }

    const modelName = typeof (response as { model?: unknown })?.model === "string" ? String((response as { model: string }).model) : undefined;
    return withCors(
      json({
        answer,
        model: modelName || undefined,
        usage: (response as { usage?: unknown })?.usage ?? null,
        web_search: Array.isArray((response as { web_search?: unknown })?.web_search) ? (response as { web_search: unknown[] }).web_search : []
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const status = /invalid json|required|too large/.test(message) ? 400 : 500;
    return withCors(json({ error: message }, { status }));
  }
};

