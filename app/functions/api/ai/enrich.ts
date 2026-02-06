import type { Env, CandidateRef } from "./_shared";
import { callBigModel, extractAssistantText, getConfig, json, readJsonBody, resolveArtifactGrounding, withCors } from "./_shared";

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clipText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function parseJsonObject(text: string): unknown | null {
  const raw = safeString(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildSourceExcerpts(candidates: CandidateRef[], contextText: string, artifactId: string) {
  const excerpts: { sourceType: string; artifactId?: string; title: string; snippet: string }[] = [];

  if (contextText) {
    excerpts.push({
      sourceType: "artifact",
      artifactId: artifactId || "",
      title: "当前展品资料",
      snippet: clipText(contextText, 220)
    });
  }

  for (const item of candidates.slice(0, 6)) {
    if (!item.summary) continue;
    excerpts.push({
      sourceType: "artifact",
      artifactId: item.id,
      title: `${item.name}（${item.series}）`,
      snippet: clipText(item.summary, 220)
    });
  }

  return excerpts.slice(0, 8);
}

function buildFallback(candidates: CandidateRef[], artifactId: string) {
  const preferred = candidates.find((item) => item.id === artifactId);
  const ranked = preferred ? [preferred, ...candidates.filter((item) => item.id !== artifactId)] : candidates;
  const recommendations = ranked.slice(0, 3).map((item, index) => ({
    id: item.id,
    reason: index === 0 ? "与当前问题最相关" : "主题和关键词匹配",
    score: Math.max(50, 85 - index * 10)
  }));

  const citations = ranked
    .slice(0, 2)
    .map((item) => ({
      title: `${item.name}（${item.series}）`,
      snippet: item.summary || "",
      artifactId: item.id,
      sourceType: "artifact"
    }))
    .filter((item) => item.snippet);

  return { recommendations, citations };
}

function normalizeOutput(raw: unknown, candidates: CandidateRef[]) {
  const candidateIds = new Set(candidates.map((item) => item.id));
  const obj = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};

  const recommendations = Array.isArray(obj.recommendations)
    ? obj.recommendations
        .map((item) => {
          const rec = item as Record<string, unknown>;
          const id = safeString(rec.id);
          if (!candidateIds.has(id)) return null;
          const reason = clipText(safeString(rec.reason) || "相关展品推荐", 48);
          const scoreRaw = Number.parseInt(String(rec.score ?? ""), 10);
          const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, scoreRaw)) : 68;
          return { id, reason, score };
        })
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const citations = Array.isArray(obj.citations)
    ? obj.citations
        .map((item) => {
          const cite = item as Record<string, unknown>;
          const title = clipText(safeString(cite.title) || "资料依据", 42);
          const snippet = clipText(safeString(cite.snippet), 90);
          if (!snippet) return null;
          const artifactId = safeString(cite.artifactId);
          const sourceTypeRaw = safeString(cite.sourceType);
          const sourceType = ["artifact", "pdf", "museum", "web"].includes(sourceTypeRaw) ? sourceTypeRaw : "artifact";
          return { title, snippet, artifactId: candidateIds.has(artifactId) ? artifactId : undefined, sourceType };
        })
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return { recommendations, citations };
}

function buildEnrichSystemPrompt(): string {
  return [
    "你是“展品推荐与引用整理器”。",
    "输入包含：用户问题、AI回答、候选展品、可引用资料片段。",
    "你必须仅输出JSON对象，字段结构：",
    "{",
    '  "recommendations":[{"id":"artifact-001","reason":"...","score":0}],',
    '  "citations":[{"title":"...","snippet":"...","artifactId":"artifact-001","sourceType":"artifact"}]',
    "}",
    "规则：",
    "1) recommendations 返回1-3项，id必须来自候选展品，reason简短，score为0-100整数。",
    "2) citations 返回1-4项，snippet必须来自给定source_excerpts，不能编造；每条snippet不超过90字。",
    "3) sourceType仅允许：artifact、pdf、museum、web。",
    "4) 如果信息不足，citations可为空数组，但recommendations仍需给出。",
    "5) 严格不要输出除JSON外的任何文字。"
  ].join("\n");
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }
  if (context.request.method !== "POST") {
    return withCors(json({ error: "method not allowed" }, { status: 405 }));
  }

  try {
    const body = await readJsonBody(context.request);
    const question = safeString(body.question);
    const answer = safeString(body.answer);
    const scope = safeString(body.scope) === "artifact" ? "artifact" : "museum";
    const artifactId = safeString(body.artifactId);
    const artifactName = safeString(body.artifactName);
    const contextText = clipText(safeString(body.contextText), 6000);

    if (!question || !answer) {
      return withCors(json({ error: "question and answer are required" }, { status: 400 }));
    }

    const grounding = resolveArtifactGrounding(
      {
        scope,
        artifactId,
        artifactName,
        question: `${question}\n${answer}`
      },
      context.env
    );

    const candidates = grounding.candidates || [];
    const fallback = buildFallback(candidates, artifactId);
    if (!candidates.length) {
      return withCors(json(fallback));
    }

    const cfg = getConfig(context.env);
    const sourceExcerpts = buildSourceExcerpts(candidates, contextText, artifactId);

    try {
      const response = await callBigModel(context.env, {
        model: cfg.model,
        messages: [
          { role: "system", content: buildEnrichSystemPrompt() },
          {
            role: "user",
            content: JSON.stringify(
              {
                task: "recommend_and_cite",
                scope,
                question,
                assistant_answer: answer,
                current_artifact: artifactId ? { id: artifactId, name: artifactName } : null,
                candidates,
                source_excerpts: sourceExcerpts
              },
              null,
              2
            )
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        top_p: 0.9,
        stream: false
      });

      const parsed = parseJsonObject(extractAssistantText(response));
      const normalized = normalizeOutput(parsed, candidates);
      return withCors(
        json({
          recommendations: normalized.recommendations.length ? normalized.recommendations : fallback.recommendations,
          citations: normalized.citations.length ? normalized.citations : fallback.citations
        })
      );
    } catch {
      return withCors(json(fallback));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const status = /invalid json|required|too large/.test(message) ? 400 : 500;
    return withCors(json({ error: message }, { status }));
  }
};

