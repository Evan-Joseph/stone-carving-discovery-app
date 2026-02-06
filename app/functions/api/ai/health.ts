import type { Env } from "./_shared";
import { getConfig, json, withCors } from "./_shared";

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (context.request.method !== "GET") {
    return withCors(json({ error: "method not allowed" }, { status: 405 }));
  }

  const cfg = getConfig(context.env);
  return withCors(
    json({
      ok: true,
      configured: {
        hasApiKey: Boolean(String(context.env.BIGMODEL_API_KEY || "").trim()),
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        visionModel: cfg.visionModel
      }
    })
  );
};
