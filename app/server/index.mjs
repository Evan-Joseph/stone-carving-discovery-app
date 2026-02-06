import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
loadEnvFile(path.join(__dirname, ".env"));
loadEnvFile(path.join(ROOT, ".env.server"));

const PORT = parseInt(process.env.PORT || "8787", 10);
const BASE_URL = (process.env.BIGMODEL_BASE_URL || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
const MODEL = process.env.BIGMODEL_MODEL || "glm-4.7-flash";
const API_KEY = process.env.BIGMODEL_API_KEY || "";
const MAX_RETRIES = clampInt(process.env.AI_MAX_RETRIES, 3, 1, 5);
const TIMEOUT_MS = clampInt(process.env.AI_TIMEOUT_MS, 45000, 5000, 120000);
const WEB_SEARCH_ENABLED = parseBool(process.env.BIGMODEL_ENABLE_WEB_SEARCH, true);
const WEB_SEARCH_ENGINE = process.env.BIGMODEL_WEB_SEARCH_ENGINE || "search_pro";
const WEB_SEARCH_COUNT = clampInt(process.env.BIGMODEL_WEB_SEARCH_COUNT, 5, 1, 10);
const WEB_SEARCH_CONTENT_SIZE = process.env.BIGMODEL_WEB_SEARCH_CONTENT_SIZE || "medium";
const ARTIFACT_DATA_PATH = path.join(ROOT, "src", "data", "artifacts.json");
const ARTIFACT_CATALOG = loadArtifactCatalog();
const HISTORY_MAX_ITEMS = clampInt(process.env.AI_HISTORY_MAX_ITEMS, 10, 2, 20);
const HISTORY_ITEM_MAX_CHARS = clampInt(process.env.AI_HISTORY_ITEM_MAX_CHARS, 800, 120, 2000);

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/ai/health" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      configured: {
        hasApiKey: Boolean(API_KEY),
        baseUrl: BASE_URL,
        model: MODEL
      }
    });
  }

  if (req.url === "/api/ai/chat" && req.method === "POST") {
    try {
      requireApiKey();
      const body = await readJsonBody(req);
      const question = safeString(body.question);
      if (!question) {
        return sendJson(res, 400, { error: "question is required" });
      }

      const grounding = resolveArtifactGrounding(body);
      const payload = buildChatPayload(body, grounding);
      const response = await callBigModel(payload);
      const answer = sanitizeAnswerContent(extractAssistantText(response), {
        allowedArtifactIds: grounding.allowedArtifactIds,
        question,
        primaryArtifactId: grounding.primaryArtifactId,
        primaryArtifactScore: grounding.primaryArtifactScore
      });

      if (!answer) {
        return sendJson(res, 502, { error: "empty model answer", raw: response });
      }

      return sendJson(res, 200, {
        answer,
        model: safeString(response.model) || MODEL,
        usage: response.usage || null,
        web_search: Array.isArray(response.web_search) ? response.web_search : []
      });
    } catch (error) {
      return handleError(res, error);
    }
  }

  if (req.url === "/api/ai/chat-stream" && req.method === "POST") {
    try {
      requireApiKey();
      const body = await readJsonBody(req);
      const question = safeString(body.question);
      if (!question) {
        return sendJson(res, 400, { error: "question is required" });
      }

      const grounding = resolveArtifactGrounding(body);
      const payload = buildChatPayload(body, grounding);
      payload.stream = true;
      return await handleChatStream(res, payload, {
        allowedArtifactIds: grounding.allowedArtifactIds,
        question,
        primaryArtifactId: grounding.primaryArtifactId,
        primaryArtifactScore: grounding.primaryArtifactScore
      });
    } catch (error) {
      return handleError(res, error);
    }
  }

  if (req.url === "/api/ai/enrich" && req.method === "POST") {
    try {
      requireApiKey();
      const body = await readJsonBody(req);
      const question = safeString(body.question);
      const answer = safeString(body.answer);
      const scope = safeString(body.scope) === "artifact" ? "artifact" : "museum";
      const artifactId = safeString(body.artifactId);
      const artifactName = safeString(body.artifactName);
      const contextText = clipText(safeString(body.contextText), 6000);

      if (!question || !answer) {
        return sendJson(res, 400, { error: "question and answer are required" });
      }

      const enrichment = await enrichGuideAnswerByModel({
        question,
        answer,
        scope,
        artifactId,
        artifactName,
        contextText
      });

      return sendJson(res, 200, enrichment);
    } catch (error) {
      return handleError(res, error);
    }
  }

  if (req.url === "/api/ai/wish" && req.method === "POST") {
    let body = null;
    try {
      requireApiKey();
      body = await readJsonBody(req);
      const wish = safeString(body.wish);
      const candidates = Array.isArray(body.candidates) ? body.candidates : [];
      if (!wish) {
        return sendJson(res, 400, { error: "wish is required" });
      }
      if (!candidates.length) {
        return sendJson(res, 400, { error: "candidates is required" });
      }

      const picked = await pickWishByModel(wish, candidates);
      return sendJson(res, 200, picked);
    } catch (error) {
      const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
      const wish = safeString(body?.wish);
      if (wish && candidates.length) {
        const fallback = pickWishByFallback(wish, candidates);
        return sendJson(res, 200, fallback);
      }
      return handleError(res, error);
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[ai-server] listening on http://0.0.0.0:${PORT}`);
  console.log(`[ai-server] model=${MODEL}, base=${BASE_URL}`);
});

function buildChatPayload(input, grounding) {
  const scope = safeString(input.scope) === "artifact" ? "artifact" : "museum";
  const artifactName = safeString(input.artifactName);
  const contextText = clipText(safeString(input.contextText), 6000);
  const question = safeString(input.question);
  const imageDataUrl = normalizeImageDataUrl(input.imageDataUrl);
  const history = normalizeHistory(input.history);
  const candidateRefs = grounding.candidateRefs || "暂无";
  const groundingBrief = buildGroundingBrief(grounding.candidates);
  const ambiguityHint = grounding.ambiguityHint || "";
  const userQuestion =
    scope === "artifact"
      ? buildArtifactUserQuestion(artifactName, contextText, question, groundingBrief, ambiguityHint)
      : [question, `候选展品索引（用于消歧，不是全部馆藏）：\n${groundingBrief || "暂无"}`, ambiguityHint].filter(Boolean).join("\n\n");

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(scope, candidateRefs)
    },
    ...history,
    { role: "user", content: buildUserContent(userQuestion, imageDataUrl) }
  ];

  const payload = {
    model: MODEL,
    messages,
    temperature: 0.5,
    top_p: 0.9,
    stream: false
  };

  if (scope === "museum" && WEB_SEARCH_ENABLED && shouldUseWebSearch(question, grounding)) {
    payload.tools = [
      {
        type: "web_search",
        web_search: {
          enable: true,
          search_engine: WEB_SEARCH_ENGINE,
          search_result: true,
          count: WEB_SEARCH_COUNT,
          content_size: WEB_SEARCH_CONTENT_SIZE
        }
      }
    ];
  }

  return payload;
}

function resolveArtifactGrounding(input) {
  const scope = safeString(input.scope) === "artifact" ? "artifact" : "museum";
  const artifactId = safeString(input.artifactId);
  const artifactName = safeString(input.artifactName);
  const question = safeString(input.question);
  const history = normalizeHistory(input.history);
  const historyText = history.map((item) => item.content).join("\n");
  const query = `${historyText}\n${question}\n${artifactName}`;
  const candidates = pickArtifactCandidates(query, artifactId, scope === "artifact" ? 12 : 10);
  const candidateRefs = buildArtifactReferenceSnippet(candidates);
  const allowedArtifactIds = new Set(candidates.map((item) => item.id));
  const primaryArtifact = candidates[0];
  const ambiguityHint = buildAmbiguityHint(question, candidates);

  return {
    candidates,
    candidateRefs,
    ambiguityHint,
    allowedArtifactIds,
    primaryArtifactId: primaryArtifact?.id || artifactId || "",
    primaryArtifactScore: Number.isFinite(primaryArtifact?.rankScore) ? primaryArtifact.rankScore : 0
  };
}

function shouldUseWebSearch(question, grounding) {
  const q = safeString(question);
  if (!q) return true;

  const artifactLookupIntent = /(哪块|哪一块|哪件|哪个展品|第几石|第几室|对应|是哪一石|是哪块|是哪件)/.test(q);
  if (!artifactLookupIntent) return true;

  const confidence = Number(grounding?.primaryArtifactScore || 0);
  return confidence < 120;
}

function buildSystemPrompt(scope, candidateRefs) {
  const baseRules = [
    "如果用户提供了现场照片/图片，请优先结合图片内容回答；不确定就明确写“图片信息不足/无法确认”。",
    "如果你要明确指向某件展品，请在对应段落紧跟一行固定标记：`[展品卡片:artifact-xxx|一句话理由]`。",
    "卡片标记必须单独占一行，前后不加其他文字。",
    "标记里的 artifact-xxx 必须来自“可引用展品清单”。",
    "不能编造展品名称、室号、石号；不确定时必须明确写“暂无法确认具体展品”。",
    "若多个候选展品都匹配同一典故，请先给“候选A/B”并说明差异，不要武断只报一个。",
    "引用依据直接写在正文里，不要把推荐汇总放在文末。"
  ].join("\n");

  if (scope === "artifact") {
    return [
      "你是武氏墓群石刻博物馆 AI 导游，负责展品即时讲解。",
      "回答目标：先给结论，再给依据；语气自然、专业、克制。",
      "严格优先使用用户提供的展品资料；资料不足时必须明确写出“资料未提及/暂不确定”，不要臆造事实。",
      "输出用简洁 Markdown：可使用小标题、列表、表格；默认不使用代码块，除非用户明确要求。",
      "当用户在问“是哪块/哪些比较好/先看哪件”时，请在结论段直接给出具体展品并就地解释，且至少引用1个展品卡片标记。",
      baseRules,
      `可引用展品清单（仅可从这里选ID）：\n${candidateRefs}`,
      "建议结构：`### 结论` + `### 细节解读` + `### 延伸观看建议`（按问题需要裁剪）。"
    ].join("\n");
  }

  return [
    "你是武氏墓群石刻博物馆 AI 导游，负责全馆问询。",
    "可以结合联网检索，但必须优先给出可核实信息，避免绝对化表述和无来源断言。",
    "若信息存在不确定性，请明确标注“可能/尚待核实”，并给出下一步可验证方向。",
    "当用户提问“哪块/哪些比较好/先看什么”时，先给出1-3个推荐展品名称，再说明原因和观看重点，并在对应段落给出展品卡片标记。",
    baseRules,
    `可引用展品清单（仅可从这里选ID）：\n${candidateRefs}`,
    "输出用简洁 Markdown：先结论后展开，优先列表化，控制在 3-6 个关键点。",
    "当引用外部信息时，在句末追加简短来源提示，例如“（来源：xxx）”。"
  ].join("\n");
}

function normalizeImageDataUrl(value) {
  const raw = safeString(value);
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw;
  if (raw.startsWith("https://") || raw.startsWith("http://")) return raw;
  return "";
}

function buildUserContent(text, imageUrl) {
  if (!imageUrl) return text;
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: imageUrl } }
  ];
}

function buildArtifactUserQuestion(artifactName, contextText, question, groundingBrief, ambiguityHint) {
  return [
    artifactName ? `当前展品：${artifactName}` : "",
    contextText ? `展品资料：\n${contextText}` : "展品资料：暂无结构化资料。",
    groundingBrief ? `候选展品索引（用于消歧，不是全部馆藏）：\n${groundingBrief}` : "",
    ambiguityHint,
    "请基于上述资料回答下列问题，并给出最有价值的观察点。",
    `用户问题：${question}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildArtifactReferenceSnippet(candidates) {
  if (!candidates.length) return "暂无";
  return candidates
    .map(
      (item, index) =>
        `${index + 1}. ${item.id} | ${item.name} | ${item.series} | 关键词：${item.tags.slice(0, 4).join("、") || "无"} | 摘要：${item.summary || "暂无"}`
    )
    .join("\n");
}

function buildGroundingBrief(candidates) {
  if (!candidates.length) return "";
  return candidates
    .slice(0, 6)
    .map((item, index) => {
      const summary = clipText(item.summary || "暂无摘要", 84);
      return `${index + 1}. ${item.id} ${item.name}（${item.series}）- ${summary}`;
    })
    .join("\n");
}

function buildAmbiguityHint(question, candidates) {
  if (!candidates.length) return "";
  const normalizedQuestion = sanitizeLookupQuestionText(normalizeSearchText(question));
  if (!normalizedQuestion) return "";

  const terms = tokenizeSearchTerms(normalizedQuestion).filter((token) => token.length >= 2).slice(0, 10);
  if (!terms.length) return "";

  const lines = [];
  for (const term of terms) {
    const matched = candidates.filter((candidate) => {
      const combined = normalizeSearchText(`${candidate.name} ${candidate.pdfTopic || ""} ${(candidate.tags || []).join(" ")}`);
      return combined.includes(term);
    });
    if (matched.length >= 2) {
      lines.push(`${term}：${matched.slice(0, 3).map((item) => `${item.id} ${item.name}`).join("；")}`);
    }
    if (lines.length >= 3) break;
  }

  if (!lines.length) return "";
  return `候选歧义提示（仅供判别）：\n${lines.join("\n")}\n若用户问“是哪一块”，请先给候选并解释差异，再给你的首选。`;
}

async function enrichGuideAnswerByModel(input) {
  const queryText = `${input.question}\n${input.answer}\n${input.artifactName || ""}`;
  const candidates = pickArtifactCandidates(queryText, input.artifactId, 10);
  const sourceExcerpts = buildSourceExcerpts(candidates, input.contextText, input.artifactId);

  const fallback = buildFallbackEnrichment(candidates, input.artifactId);
  if (!candidates.length) {
    return fallback;
  }

  try {
    const response = await callBigModel({
      model: MODEL,
      messages: [
        { role: "system", content: buildEnrichSystemPrompt() },
        {
          role: "user",
          content: JSON.stringify(
            {
              task: "recommend_and_cite",
              scope: input.scope,
              question: input.question,
              assistant_answer: input.answer,
              current_artifact: input.artifactId
                ? {
                    id: input.artifactId,
                    name: input.artifactName || ""
                  }
                : null,
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
    const normalized = normalizeEnrichmentOutput(parsed, candidates);
    return {
      recommendations: normalized.recommendations.length ? normalized.recommendations : fallback.recommendations,
      citations: normalized.citations.length ? normalized.citations : fallback.citations
    };
  } catch {
    return fallback;
  }
}

function buildEnrichSystemPrompt() {
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

function normalizeEnrichmentOutput(raw, candidates) {
  const candidateIds = new Set(candidates.map((item) => item.id));
  const recommendations = Array.isArray(raw?.recommendations)
    ? raw.recommendations
        .map((item) => {
          const id = safeString(item?.id);
          if (!candidateIds.has(id)) return null;
          const reason = clipText(safeString(item?.reason) || "相关展品推荐", 48);
          const scoreRaw = Number.parseInt(String(item?.score ?? ""), 10);
          const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(100, scoreRaw)) : 68;
          return { id, reason, score };
        })
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const citations = Array.isArray(raw?.citations)
    ? raw.citations
        .map((item) => {
          const title = clipText(safeString(item?.title) || "资料依据", 42);
          const snippet = clipText(safeString(item?.snippet), 90);
          if (!snippet) return null;
          const artifactId = safeString(item?.artifactId);
          const sourceTypeRaw = safeString(item?.sourceType);
          const sourceType = ["artifact", "pdf", "museum", "web"].includes(sourceTypeRaw) ? sourceTypeRaw : "artifact";
          return {
            title,
            snippet,
            artifactId: candidateIds.has(artifactId) ? artifactId : undefined,
            sourceType
          };
        })
        .filter(Boolean)
        .slice(0, 4)
    : [];

  return {
    recommendations,
    citations
  };
}

function buildFallbackEnrichment(candidates, artifactId) {
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
      snippet: item.summary || "暂无详细资料片段。",
      artifactId: item.id,
      sourceType: "artifact"
    }))
    .filter((item) => item.snippet && item.snippet !== "暂无详细资料片段。");

  return { recommendations, citations };
}

function buildSourceExcerpts(candidates, contextText, artifactId) {
  const excerpts = [];

  if (contextText) {
    excerpts.push({
      sourceType: "artifact",
      artifactId: artifactId || "",
      title: "当前展品资料",
      snippet: clipText(toPlainText(contextText), 220)
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

function pickArtifactCandidates(queryText, preferredId, limit = 10) {
  if (!ARTIFACT_CATALOG.length) return [];
  const normalizedQuery = normalizeSearchText(queryText);
  const tokens = tokenizeSearchTerms(queryText);
  const phrases = buildSearchPhrases(queryText, tokens);

  const scored = ARTIFACT_CATALOG.map((item) => {
    let score = Math.round(item.richness * 0.6);
    let structuredHitCount = 0;
    let summaryHitCount = 0;

    if (preferredId && item.id === preferredId) {
      score += 120;
      structuredHitCount += 1;
    }

    for (const phrase of phrases) {
      if (phrase.length < 3) continue;
      if (item.nameNorm.includes(phrase)) {
        score += 240;
        structuredHitCount += 2;
      }
      if (item.topicNorm.includes(phrase)) {
        score += 230;
        structuredHitCount += 2;
      }
      if (item.tagsNorm.some((tag) => tag.includes(phrase))) {
        score += 210;
        structuredHitCount += 2;
      }
      if (item.aliasNorm.some((alias) => alias.includes(phrase))) {
        score += 190;
        structuredHitCount += 1;
      }
      if (item.summaryNorm.includes(phrase)) {
        score += 32;
        summaryHitCount += 1;
      }
    }

    for (const token of tokens) {
      if (item.nameNorm.includes(token)) {
        score += 38;
        structuredHitCount += 1;
      }
      if (item.seriesNorm.includes(token)) {
        score += 20;
        structuredHitCount += 1;
      }
      if (item.topicNorm.includes(token)) {
        score += 34;
        structuredHitCount += 1;
      }
      if (item.tagsNorm.some((tag) => tag.includes(token))) {
        score += 30;
        structuredHitCount += 1;
      }
      if (item.aliasNorm.some((alias) => alias.includes(token))) {
        score += 28;
        structuredHitCount += 1;
      }
      if (item.summaryNorm.includes(token)) {
        score += Math.min(8, token.length * 2);
        summaryHitCount += 1;
      }
    }

    if (normalizedQuery && item.summaryNorm.includes(normalizedQuery) && !item.nameNorm.includes(normalizedQuery)) {
      score += 8;
      summaryHitCount += 1;
    }

    if (structuredHitCount === 0 && summaryHitCount > 0) {
      score -= 40;
    }
    if (structuredHitCount >= 2) {
      score += 24;
    }
    if (structuredHitCount >= 4) {
      score += 18;
    }

    return { item, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, limit));

  return scored.map(({ item, score }) => ({
    id: item.id,
    name: item.name,
    series: item.series,
    tags: item.tags.slice(0, 6),
    pdfTopic: item.pdfTopic,
    summary: item.summary,
    rankScore: score
  }));
}

async function pickWishByModel(wish, candidates) {
  const compactCandidates = candidates.map((item) => ({
    id: safeString(item.id),
    name: safeString(item.name),
    series: safeString(item.series),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    pdfTopic: safeString(item.pdfTopic)
  }));

  const systemPrompt =
    "你是文物匹配助手。你必须从候选列表中只选一个id，并返回JSON对象：{\"id\":\"...\",\"reason\":\"...\"}。id必须来自候选列表。";
  const userPrompt = JSON.stringify(
    {
      wish,
      candidates: compactCandidates
    },
    null,
    2
  );

  const response = await callBigModel({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    stream: false
  });

  const answer = extractAssistantText(response);
  const parsed = parseJsonObject(answer);
  const pickedId = safeString(parsed?.id);
  const reason = safeString(parsed?.reason) || "AI已按许愿内容匹配。";

  if (pickedId && compactCandidates.some((item) => item.id === pickedId)) {
    return { id: pickedId, reason };
  }

  throw new Error("model returned invalid wish id");
}

function pickWishByFallback(wish, candidates) {
  const normalizedWish = safeString(wish).replace(/\s+/g, "");
  const scored = candidates
    .map((item) => {
      const fields = [item.name, item.series, item.pdfTopic || "", ...(Array.isArray(item.tags) ? item.tags : [])]
        .map((value) => safeString(value))
        .filter(Boolean);
      const score = fields.reduce((sum, field) => {
        const token = field.replace(/[（）()、，。\s]/g, "");
        if (!token || token.length < 2) return sum;
        return normalizedWish.includes(token) ? sum + token.length : sum;
      }, 0);
      return { id: safeString(item.id), score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored[0] && scored[0].score > 0) {
    return { id: scored[0].id, reason: "已按关键词进行本地匹配。" };
  }

  const random = candidates[Math.floor(Math.random() * candidates.length)];
  return { id: safeString(random.id), reason: "未命中关键词，已随机抽取盲盒。" };
}

async function handleChatStream(res, payload, answerContext) {
  sendStreamHeaders(res);

  let fullAnswer = "";
  let modelName = MODEL;

  try {
    await callBigModelStream(payload, {
      onDelta: (delta) => {
        if (!delta) return;
        fullAnswer += delta;
        sendStreamEvent(res, { type: "delta", delta, answer: fullAnswer });
      },
      onMeta: (meta) => {
        const maybeModel = safeString(meta?.model);
        if (maybeModel) modelName = maybeModel;
      }
    });

    const normalizedAnswer = sanitizeAnswerContent(fullAnswer, answerContext);
    sendStreamEvent(res, { type: "done", answer: normalizedAnswer, model: modelName });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "stream error";
    sendStreamEvent(res, { type: "error", error: message });
    res.end();
  }
}

async function callBigModelStream(payload, handlers) {
  const url = `${BASE_URL}/chat/completions`;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);
    let receivedAnyChunk = false;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(attempt * 350);
          continue;
        }
        throw new Error(`bigmodel_http_${response.status}: ${text.slice(0, 900)}`);
      }

      if (!response.body) {
        throw new Error("empty stream body");
      }

      handlers?.onMeta?.({ model: safeString(response.headers.get("x-model")) || MODEL });
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        receivedAnyChunk = true;
        buffer += decoder.decode(value, { stream: true });
        buffer = processSseBuffer(buffer, (event) => {
          handlers?.onMeta?.(event);
          const delta = extractDeltaTextFromChunk(event);
          if (delta) handlers?.onDelta?.(delta);
        });
      }

      const tail = decoder.decode();
      if (tail) {
        buffer += tail;
      }
      if (buffer.trim()) {
        processSseBuffer(`${buffer}\n`, (event) => {
          handlers?.onMeta?.(event);
          const delta = extractDeltaTextFromChunk(event);
          if (delta) handlers?.onDelta?.(delta);
        });
      }
      return;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < MAX_RETRIES && !receivedAnyChunk) {
        await sleep(attempt * 350);
        continue;
      }
      break;
    }
  }

  throw lastError || new Error("bigmodel stream failed");
}

async function callBigModel(payload) {
  const url = `${BASE_URL}/chat/completions`;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(attempt * 350);
          continue;
        }
        throw new Error(`bigmodel_http_${response.status}: ${text.slice(0, 900)}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 350);
      }
    }
  }

  throw lastError || new Error("bigmodel request failed");
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-HISTORY_MAX_ITEMS)
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: clipText(safeString(item?.content), HISTORY_ITEM_MAX_CHARS)
    }))
    .filter((item) => item.content);
}

function sanitizeAnswerContent(answer, context) {
  const raw = canonicalizeCardMarkerSyntax(safeString(answer));
  if (!raw) return "";

  const allowedSet = context?.allowedArtifactIds instanceof Set ? context.allowedArtifactIds : new Set();
  const markerPattern = /\[展品卡片:(artifact-[a-zA-Z0-9_-]+)(\|[^\]]*)?]/g;
  let markerCount = 0;
  let normalized = raw.replace(markerPattern, (full, artifactId, noteSegment = "") => {
    if (!allowedSet.size) return "";
    if (!allowedSet.has(artifactId)) return "";
    markerCount += 1;
    if (markerCount > 3) return "";
    const note = safeString(noteSegment.replace(/^\|/, ""));
    return `[展品卡片:${artifactId}${note ? `|${clipText(note, 28)}` : ""}]`;
  });

  normalized = normalized.replace(/\s*\[展品卡片:(artifact-[a-zA-Z0-9_-]+)(\|[^\]]*)?]\s*/g, (_full, artifactId, note = "") => {
    return `\n[展品卡片:${artifactId}${note}]\n`;
  });
  normalized = normalized.replace(/\n{3,}/g, "\n\n").trim();

  if (!markerCount && shouldForceMarkerByIntent(context?.question || "")) {
    const fallbackId =
      context?.primaryArtifactId && allowedSet.has(context.primaryArtifactId) && Number(context?.primaryArtifactScore || 0) >= 120
        ? context.primaryArtifactId
        : "";
    if (fallbackId) {
      normalized = `${normalized}\n\n[展品卡片:${fallbackId}|系统补充：候选匹配展品]`.trim();
    }
  }

  return normalized;
}

function canonicalizeCardMarkerSyntax(text) {
  return safeString(text).replace(/[【\[]\s*展品卡片[：:]\s*(artifact-[a-zA-Z0-9_-]+)\s*(?:[|｜]\s*([^\]】]+))?\s*[】\]]/g, (_full, artifactId, note = "") => {
    const noteText = safeString(note);
    return `[展品卡片:${artifactId}${noteText ? `|${noteText}` : ""}]`;
  });
}

function shouldForceMarkerByIntent(question) {
  const text = safeString(question);
  if (!text) return false;
  return /(哪块|哪一块|哪件|哪个展品|先看|推荐|哪些|对应|是哪一石|哪一石)/.test(text);
}

function extractAssistantText(response) {
  const choice = Array.isArray(response?.choices) ? response.choices[0] : null;
  const content = choice?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n")
      .trim();
  }
  if (typeof response?.answer === "string") {
    return response.answer.trim();
  }
  return "";
}

function extractDeltaTextFromChunk(event) {
  const choices = Array.isArray(event?.choices) ? event.choices : [];
  if (!choices.length) return "";

  const delta = choices[0]?.delta?.content;
  if (typeof delta === "string") {
    return delta;
  }
  if (Array.isArray(delta)) {
    return delta
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof item.text === "string") return item.text;
        return "";
      })
      .join("");
  }
  return "";
}

function processSseBuffer(buffer, onEvent) {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      onEvent(event);
    } catch {
      // skip malformed chunk
    }
  }
  return rest;
}

function parseJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendStreamHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
}

function sendStreamEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 6 * 1024 * 1024) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid json body");
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function handleError(res, error) {
  const message = error instanceof Error ? error.message : "unknown error";
  const status = /invalid json|required|too large/.test(message) ? 400 : 500;
  return sendJson(res, status, { error: message });
}

function requireApiKey() {
  if (!API_KEY) {
    throw new Error("BIGMODEL_API_KEY is missing");
  }
}

function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clipText(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function loadArtifactCatalog() {
  try {
    if (!existsSync(ARTIFACT_DATA_PATH)) return [];
    const raw = readFileSync(ARTIFACT_DATA_PATH, "utf8");
    const dataset = JSON.parse(raw);
    const list = Array.isArray(dataset?.artifacts) ? dataset.artifacts : [];
    return list
      .map((item) => {
        const id = safeString(item?.id);
        const name = safeString(item?.name);
        if (!id || !name) return null;

        const series = safeString(item?.series);
        const tags = Array.isArray(item?.tags) ? item.tags.map((tag) => safeString(tag)).filter(Boolean) : [];
        const pdfTopic = safeString(item?.pdfTopic);
        const infoText = toPlainText(safeString(item?.infoText));
        const linkedPdf = Array.isArray(item?.linkedPdf) ? item.linkedPdf : [];
        const linkedText = linkedPdf
          .map((page) => toPlainText(safeString(page?.content)))
          .filter(Boolean)
          .join(" ");
        const summary = clipText([infoText, linkedText].filter(Boolean).join(" ").trim(), 220);
        const aliases = extractAliases([name, pdfTopic, ...tags]);

        return {
          id,
          name,
          series,
          tags,
          pdfTopic,
          summary,
          nameNorm: normalizeSearchText(name),
          seriesNorm: normalizeSearchText(series),
          topicNorm: normalizeSearchText(pdfTopic),
          tagsNorm: tags.map((tag) => normalizeSearchText(tag)),
          aliasNorm: aliases.map((alias) => normalizeSearchText(alias)).filter(Boolean),
          summaryNorm: normalizeSearchText(summary),
          richness: (infoText ? 4 : 0) + linkedPdf.length * 3 + tags.length
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function toPlainText(markdown) {
  return safeString(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAliases(fields) {
  const raw = fields
    .map((item) => safeString(item))
    .filter(Boolean);
  if (!raw.length) return [];

  const stopwords = new Set(["系列", "画像", "石室", "祠", "石", "第", "层", "壁"]);
  const aliases = new Set();

  for (const entry of raw) {
    aliases.add(entry);
    const parts = entry.split(/[、，,；;：:（）()·\/|\s]+/).map((part) => part.trim());
    for (const part of parts) {
      if (part.length < 2) continue;
      if (stopwords.has(part)) continue;
      aliases.add(part);
    }
  }

  return Array.from(aliases).slice(0, 40);
}

function normalizeSearchText(text) {
  return safeString(text)
    .toLowerCase()
    .replace(/[`*_#>[\](){}<>"'“”‘’|/\\\-:：，。！？!?；;、,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchTerms(text) {
  const normalized = sanitizeLookupQuestionText(normalizeSearchText(text));
  const set = new Set();
  const stopwords = new Set([
    "这个",
    "那个",
    "哪些",
    "哪块",
    "哪个",
    "什么",
    "怎么",
    "可以",
    "一下",
    "介绍",
    "展品",
    "文物",
    "石刻",
    "石头",
    "博物馆",
    "推荐",
    "比较",
    "请问",
    "看看",
    "问题",
    "回答",
    "先看"
  ]);

  for (const token of normalized.split(" ")) {
    if (token.length >= 2 && !stopwords.has(token) && !/^\d+$/.test(token)) {
      set.add(token);
    }
  }

  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of chineseRuns) {
    if (run.length >= 2 && !stopwords.has(run)) {
      set.add(run);
    }
    for (let length = 2; length <= 6; length += 1) {
      if (run.length < length) continue;
      for (let index = 0; index <= run.length - length; index += 1) {
        const part = run.slice(index, index + length);
        if (part.length >= 2 && !stopwords.has(part)) {
          set.add(part);
        }
      }
    }
  }

  return Array.from(set).slice(0, 60);
}

function buildSearchPhrases(text, tokens) {
  const raw = safeString(text);
  const normalized = sanitizeLookupQuestionText(normalizeSearchText(raw));
  const phrases = new Set();

  if (normalized.length >= 3) {
    phrases.add(normalized);
  }

  const quoted = raw.match(/“([^”]{2,})”|"([^"]{2,})"|'([^']{2,})'/g) || [];
  for (const token of quoted) {
    const t = normalizeSearchText(token.replace(/[“”"'']/g, ""));
    if (t.length >= 2) phrases.add(t);
  }

  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{3,}/g) || [];
  for (const run of chineseRuns) {
    phrases.add(run);
    if (run.length > 6) {
      phrases.add(run.slice(0, 6));
    }
  }

  for (const token of tokens) {
    if (token.length >= 3) {
      phrases.add(token);
    }
  }

  return Array.from(phrases).slice(0, 20);
}

function sanitizeLookupQuestionText(normalizedText) {
  return safeString(normalizedText)
    .replace(/(是哪一块|是哪块|哪一块|哪块|哪件|哪个展品|推荐哪些|推荐|先看什么|先看哪件|是什么|对应的是哪)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampInt(raw, fallback, min, max) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseBool(raw, fallback) {
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!key || process.env[key] != null) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
