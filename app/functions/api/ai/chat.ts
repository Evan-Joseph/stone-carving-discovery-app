import type { Env } from "./_shared";
import { callBigModel, extractAssistantText, json, prepareChatRequest, readJsonBody, sanitizeAnswerContent, withCors } from "./_shared";

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

    const prepared = await prepareChatRequest(context.env, body);
    const response = await callBigModel(context.env, prepared.payload);
    const answer = sanitizeAnswerContent(extractAssistantText(response), {
      allowedArtifactIds: prepared.grounding.allowedArtifactIds,
      question,
      primaryArtifactId: prepared.grounding.primaryArtifactId,
      primaryArtifactScore: prepared.grounding.primaryArtifactScore
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
        intent: prepared.intent,
        web_search: prepared.webSearch,
        web_search_error: prepared.webSearchError || undefined
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const status = /invalid json|required|too large/.test(message) ? 400 : 500;
    return withCors(json({ error: message }, { status }));
  }
};
