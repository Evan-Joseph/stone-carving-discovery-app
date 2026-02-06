import dataset from "../../../src/data/artifacts.json";

type Scope = "artifact" | "museum";

export interface Env {
  BIGMODEL_API_KEY?: string;
  BIGMODEL_BASE_URL?: string;
  BIGMODEL_MODEL?: string;
  BIGMODEL_ENABLE_WEB_SEARCH?: string;
  BIGMODEL_WEB_SEARCH_ENGINE?: string;
  BIGMODEL_WEB_SEARCH_COUNT?: string;
  BIGMODEL_WEB_SEARCH_CONTENT_SIZE?: string;
  AI_MAX_RETRIES?: string;
  AI_TIMEOUT_MS?: string;
  AI_HISTORY_MAX_ITEMS?: string;
  AI_HISTORY_ITEM_MAX_CHARS?: string;
}

interface ArtifactDataset {
  artifacts: Artifact[];
}

interface Artifact {
  id: string;
  name: string;
  series: string;
  tags: string[];
  pdfTopic?: string;
  infoText?: string;
  linkedPdf?: { page: number; title: string; content: string }[];
}

interface ArtifactCatalogItem {
  id: string;
  name: string;
  series: string;
  tags: string[];
  pdfTopic: string;
  summary: string;
  nameNorm: string;
  seriesNorm: string;
  topicNorm: string;
  tagsNorm: string[];
  aliasNorm: string[];
  summaryNorm: string;
  richness: number;
}

interface GroundingResult {
  candidates: CandidateRef[];
  candidateRefs: string;
  ambiguityHint: string;
  allowedArtifactIds: Set<string>;
  primaryArtifactId: string;
  primaryArtifactScore: number;
}

export interface CandidateRef {
  id: string;
  name: string;
  series: string;
  tags: string[];
  pdfTopic?: string;
  summary?: string;
  rankScore?: number;
}

type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

const ARTIFACT_DATASET = dataset as unknown as ArtifactDataset;
const ARTIFACT_CATALOG: ArtifactCatalogItem[] = buildArtifactCatalog(ARTIFACT_DATASET.artifacts || []);

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers || {})
    }
  });
}

export function ndjsonStream(headers?: HeadersInit): { response: Response; write: (event: unknown) => Promise<void>; close: () => Promise<void> } {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const response = new Response(stream.readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...(headers || {})
    }
  });

  return {
    response,
    write: async (event) => {
      await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
    },
    close: async () => {
      await writer.close();
    }
  };
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function readJsonBody(request: Request, maxBytes = 2 * 1024 * 1024): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new Error("request body too large");
  }
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error("invalid json body");
  }
}

export function requireApiKey(env: Env): string {
  const key = safeString(env.BIGMODEL_API_KEY);
  if (!key) throw new Error("BIGMODEL_API_KEY is missing");
  return key;
}

export function getConfig(env: Env) {
  const baseUrl = (safeString(env.BIGMODEL_BASE_URL) || "https://open.bigmodel.cn/api/paas/v4").replace(/\/+$/, "");
  const model = safeString(env.BIGMODEL_MODEL) || "glm-4.7-flash";
  const maxRetries = clampInt(env.AI_MAX_RETRIES, 3, 1, 5);
  const timeoutMs = clampInt(env.AI_TIMEOUT_MS, 45000, 5000, 120000);
  const webSearchEnabled = parseBool(env.BIGMODEL_ENABLE_WEB_SEARCH, true);
  const webSearchEngine = safeString(env.BIGMODEL_WEB_SEARCH_ENGINE) || "search_pro";
  const webSearchCount = clampInt(env.BIGMODEL_WEB_SEARCH_COUNT, 5, 1, 10);
  const webSearchContentSize = safeString(env.BIGMODEL_WEB_SEARCH_CONTENT_SIZE) || "medium";
  const historyMaxItems = clampInt(env.AI_HISTORY_MAX_ITEMS, 10, 2, 20);
  const historyItemMaxChars = clampInt(env.AI_HISTORY_ITEM_MAX_CHARS, 800, 120, 2000);

  return {
    baseUrl,
    model,
    maxRetries,
    timeoutMs,
    webSearchEnabled,
    webSearchEngine,
    webSearchCount,
    webSearchContentSize,
    historyMaxItems,
    historyItemMaxChars
  };
}

export function buildChatPayload(
  env: Env,
  input: Record<string, unknown>,
  grounding: GroundingResult
): Record<string, unknown> {
  const cfg = getConfig(env);
  const scope: Scope = safeString(input.scope) === "artifact" ? "artifact" : "museum";
  const artifactName = safeString(input.artifactName);
  const contextText = clipText(safeString(input.contextText), 6000);
  const question = safeString(input.question);
  const history = normalizeHistory(input.history, cfg.historyMaxItems, cfg.historyItemMaxChars);

  const groundingBrief = buildGroundingBrief(grounding.candidates);
  const ambiguityHint = grounding.ambiguityHint || "";
  const userQuestion =
    scope === "artifact"
      ? buildArtifactUserQuestion(artifactName, contextText, question, groundingBrief, ambiguityHint)
      : [question, `候选展品索引（用于消歧，不是全部馆藏）：\n${groundingBrief || "暂无"}`, ambiguityHint].filter(Boolean).join("\n\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(scope, grounding.candidateRefs || "暂无")
    },
    ...history,
    { role: "user", content: userQuestion }
  ];

  const payload: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.5,
    top_p: 0.9,
    stream: false
  };

  if (scope === "museum" && cfg.webSearchEnabled && shouldUseWebSearch(question, grounding)) {
    payload.tools = [
      {
        type: "web_search",
        web_search: {
          enable: true,
          search_engine: cfg.webSearchEngine,
          search_result: true,
          count: cfg.webSearchCount,
          content_size: cfg.webSearchContentSize
        }
      }
    ];
  }

  return payload;
}

export function resolveArtifactGrounding(input: Record<string, unknown>, env: Env): GroundingResult {
  const cfg = getConfig(env);
  const scope: Scope = safeString(input.scope) === "artifact" ? "artifact" : "museum";
  const artifactId = safeString(input.artifactId);
  const artifactName = safeString(input.artifactName);
  const question = safeString(input.question);
  const history = normalizeHistory(input.history, cfg.historyMaxItems, cfg.historyItemMaxChars);
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
    primaryArtifactScore: Number.isFinite(primaryArtifact?.rankScore) ? (primaryArtifact.rankScore as number) : 0
  };
}

export function sanitizeAnswerContent(
  answer: string,
  context: {
    allowedArtifactIds: Set<string>;
    question: string;
    primaryArtifactId?: string;
    primaryArtifactScore?: number;
  }
): string {
  const raw = canonicalizeCardMarkerSyntax(safeString(answer));
  if (!raw) return "";

  const allowedSet = context.allowedArtifactIds;
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

  if (!markerCount && shouldForceMarkerByIntent(context.question || "")) {
    const fallbackId =
      context.primaryArtifactId && allowedSet.has(context.primaryArtifactId) && Number(context.primaryArtifactScore || 0) >= 120
        ? context.primaryArtifactId
        : "";
    if (fallbackId) {
      normalized = `${normalized}\n\n[展品卡片:${fallbackId}|系统补充：候选匹配展品]`.trim();
    }
  }

  return normalized;
}

export function canonicalizeCardMarkerSyntax(text: string): string {
  return safeString(text).replace(
    /[【\[]\s*展品卡片[：:]\s*(artifact-[a-zA-Z0-9_-]+)\s*(?:[|｜]\s*([^\]】]+))?\s*[】\]]/g,
    (_full, artifactId, note = "") => {
      const noteText = safeString(note);
      return `[展品卡片:${artifactId}${noteText ? `|${noteText}` : ""}]`;
    }
  );
}

function shouldForceMarkerByIntent(question: string): boolean {
  const text = safeString(question);
  if (!text) return false;
  return /(哪块|哪一块|哪件|哪个展品|先看|推荐|哪些|对应|是哪一石|哪一石)/.test(text);
}

export function extractAssistantText(response: unknown): string {
  const data = response as Record<string, unknown>;
  const choices = Array.isArray(data?.choices) ? (data.choices as unknown[]) : [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  const message = (choice?.message as Record<string, unknown> | undefined) || undefined;
  const content = message?.content as unknown;

  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return String((part as { text: string }).text);
        return "";
      })
      .join("\n")
      .trim();
  }
  if (typeof (data as { answer?: unknown }).answer === "string") return String((data as { answer: string }).answer).trim();
  return "";
}

function extractDeltaTextFromChunk(event: unknown): string {
  const data = event as Record<string, unknown>;
  const choices = Array.isArray(data?.choices) ? (data.choices as unknown[]) : [];
  if (!choices.length) return "";

  const first = choices[0] as Record<string, unknown>;
  const deltaObj = (first.delta as Record<string, unknown> | undefined) || undefined;
  const delta = deltaObj?.content as unknown;
  if (typeof delta === "string") return delta;
  if (Array.isArray(delta)) {
    return delta
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") return String((item as { text: string }).text);
        return "";
      })
      .join("");
  }
  return "";
}

function processSseBuffer(buffer: string, onEvent: (event: unknown) => void): string {
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

export async function callBigModel(env: Env, payload: Record<string, unknown>): Promise<unknown> {
  const cfg = getConfig(env);
  const apiKey = requireApiKey(env);
  const url = `${cfg.baseUrl}/chat/completions`;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), cfg.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        if (retryable && attempt < cfg.maxRetries) {
          await sleep(attempt * 350);
          continue;
        }
        throw new Error(`bigmodel_http_${response.status}: ${text.slice(0, 900)}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < cfg.maxRetries) await sleep(attempt * 350);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("bigmodel request failed");
}

export async function callBigModelStream(
  env: Env,
  payload: Record<string, unknown>,
  handlers: { onDelta?: (delta: string) => void; onMeta?: (meta: Record<string, unknown>) => void }
): Promise<void> {
  const cfg = getConfig(env);
  const apiKey = requireApiKey(env);
  const url = `${cfg.baseUrl}/chat/completions`;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), cfg.timeoutMs);
    let receivedAnyChunk = false;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        if (retryable && attempt < cfg.maxRetries) {
          await sleep(attempt * 350);
          continue;
        }
        throw new Error(`bigmodel_http_${response.status}: ${text.slice(0, 900)}`);
      }

      if (!response.body) throw new Error("empty stream body");

      handlers.onMeta?.({ model: safeString(response.headers.get("x-model")) || cfg.model });
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        receivedAnyChunk = true;
        buffer += decoder.decode(value, { stream: true });
        buffer = processSseBuffer(buffer, (event) => {
          handlers.onMeta?.((event || {}) as Record<string, unknown>);
          const delta = extractDeltaTextFromChunk(event);
          if (delta) handlers.onDelta?.(delta);
        });
      }

      const tail = decoder.decode();
      if (tail) buffer += tail;
      if (buffer.trim()) {
        processSseBuffer(`${buffer}\n`, (event) => {
          handlers.onMeta?.((event || {}) as Record<string, unknown>);
          const delta = extractDeltaTextFromChunk(event);
          if (delta) handlers.onDelta?.(delta);
        });
      }
      return;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < cfg.maxRetries && !receivedAnyChunk) {
        await sleep(attempt * 350);
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("bigmodel stream failed");
}

export async function pickWishByModel(env: Env, wish: string, candidates: CandidateRef[]): Promise<{ id: string; reason: string }> {
  const cfg = getConfig(env);
  const compactCandidates = candidates.map((item) => ({
    id: safeString(item.id),
    name: safeString(item.name),
    series: safeString(item.series),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    pdfTopic: safeString(item.pdfTopic)
  }));

  const systemPrompt =
    "你是文物匹配助手。你必须从候选列表中只选一个id，并返回JSON对象：{\"id\":\"...\",\"reason\":\"...\"}。id必须来自候选列表。";
  const userPrompt = JSON.stringify({ wish, candidates: compactCandidates }, null, 2);

  const response = await callBigModel(env, {
    model: cfg.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    stream: false
  });

  const answer = extractAssistantText(response);
  const parsed = parseJsonObject(answer) as { id?: unknown; reason?: unknown } | null;
  const pickedId = safeString(parsed?.id);
  const reason = safeString(parsed?.reason) || "AI已按许愿内容匹配。";
  if (pickedId && compactCandidates.some((item) => item.id === pickedId)) {
    return { id: pickedId, reason };
  }
  throw new Error("model returned invalid wish id");
}

export function pickWishByFallback(wish: string, candidates: CandidateRef[]): { id: string; reason: string } {
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

  if (scored[0] && scored[0].score > 0) return { id: scored[0].id, reason: "已按关键词进行本地匹配。" };
  const random = candidates[Math.floor(Math.random() * candidates.length)];
  return { id: safeString(random.id), reason: "未命中关键词，已随机抽取盲盒。" };
}

function normalizeHistory(history: unknown, maxItems: number, maxChars: number): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-maxItems)
    .map((item) => {
      const msg = item as Record<string, unknown>;
      return {
        role: msg?.role === "assistant" ? "assistant" : "user",
        content: clipText(safeString(msg?.content), maxChars)
      } satisfies ChatMessage;
    })
    .filter((item) => item.content);
}

function shouldUseWebSearch(question: string, grounding: GroundingResult): boolean {
  const q = safeString(question);
  if (!q) return true;
  const artifactLookupIntent = /(哪块|哪一块|哪件|哪个展品|第几石|第几室|对应|是哪一石|是哪块|是哪件)/.test(q);
  if (!artifactLookupIntent) return true;
  const confidence = Number(grounding?.primaryArtifactScore || 0);
  return confidence < 120;
}

function buildSystemPrompt(scope: Scope, candidateRefs: string): string {
  const baseRules = [
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

function buildArtifactUserQuestion(
  artifactName: string,
  contextText: string,
  question: string,
  groundingBrief: string,
  ambiguityHint: string
): string {
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

function buildArtifactReferenceSnippet(candidates: CandidateRef[]): string {
  if (!candidates.length) return "暂无";
  return candidates
    .map(
      (item, index) =>
        `${index + 1}. ${item.id} | ${item.name} | ${item.series} | 关键词：${(item.tags || []).slice(0, 4).join("、") || "无"} | 摘要：${
          item.summary || "暂无"
        }`
    )
    .join("\n");
}

function buildGroundingBrief(candidates: CandidateRef[]): string {
  if (!candidates.length) return "";
  return candidates
    .slice(0, 6)
    .map((item, index) => {
      const summary = clipText(safeString(item.summary) || "暂无摘要", 84);
      return `${index + 1}. ${item.id} ${item.name}（${item.series}）- ${summary}`;
    })
    .join("\n");
}

function buildAmbiguityHint(question: string, candidates: CandidateRef[]): string {
  if (!candidates.length) return "";
  const normalizedQuestion = sanitizeLookupQuestionText(normalizeSearchText(question));
  if (!normalizedQuestion) return "";

  const terms = tokenizeSearchTerms(normalizedQuestion).filter((token) => token.length >= 2).slice(0, 10);
  if (!terms.length) return "";

  const lines: string[] = [];
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

function buildArtifactCatalog(artifacts: Artifact[]): ArtifactCatalogItem[] {
  return (artifacts || [])
    .map((item) => {
      const id = safeString(item?.id);
      const name = safeString(item?.name);
      if (!id || !name) return null;

      const series = safeString(item?.series);
      const tags = Array.isArray(item?.tags) ? (item.tags as unknown[]).map((t) => safeString(t)).filter(Boolean) : [];
      const pdfTopic = safeString(item?.pdfTopic);
      const infoText = toPlainText(safeString(item?.infoText));
      const linkedPdf = Array.isArray(item?.linkedPdf) ? (item.linkedPdf as unknown[]) : [];
      const linkedText = linkedPdf
        .map((page) => toPlainText(safeString((page as { content?: unknown })?.content)))
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
      } satisfies ArtifactCatalogItem;
    })
    .filter(Boolean) as ArtifactCatalogItem[];
}

function pickArtifactCandidates(queryText: string, preferredId: string, limit = 10): CandidateRef[] {
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

    if (structuredHitCount === 0 && summaryHitCount > 0) score -= 40;
    if (structuredHitCount >= 2) score += 24;
    if (structuredHitCount >= 4) score += 18;

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

function tokenizeSearchTerms(text: string): string[] {
  const normalized = normalizeSearchText(text);
  if (!normalized) return [];
  const rawTokens = normalized.split(" ").filter(Boolean);
  const tokens = new Set<string>();
  for (const token of rawTokens) {
    if (token.length < 2) continue;
    tokens.add(token);
    if (token.length >= 4) {
      tokens.add(token.slice(0, 3));
    }
  }
  return Array.from(tokens);
}

function buildSearchPhrases(text: string, tokens: string[]): string[] {
  const normalized = normalizeSearchText(text);
  if (!normalized) return tokens;
  const phrases = new Set(tokens);
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length >= 3) phrases.add(compact);
  const maybeQuoted = Array.from(normalized.matchAll(/["“”‘’'「」《》【】](.+?)["“”‘’'「」《》【】]/g)).map((m) => normalizeSearchText(m[1]));
  for (const q of maybeQuoted) {
    if (q && q.length >= 3) phrases.add(q.replace(/\s+/g, ""));
  }
  return Array.from(phrases);
}

function sanitizeLookupQuestionText(text: string): string {
  return safeString(text)
    .replace(/[？?！!。,.，:：；;（）()【】\[\]<>《》"'“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(text: string): string {
  const raw = safeString(text).toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/[·•]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAliases(values: string[]): string[] {
  const aliases = new Set<string>();
  for (const value of values) {
    const v = safeString(value);
    if (!v) continue;
    aliases.add(v);
    const compact = v.replace(/\s+/g, "");
    if (compact && compact.length !== v.length) aliases.add(compact);
    const stripped = v.replace(/[（）()【】\[\]《》"'“”‘’]/g, " ").replace(/\s+/g, " ").trim();
    if (stripped && stripped !== v) aliases.add(stripped);
  }
  return Array.from(aliases).slice(0, 10);
}

function toPlainText(markdown: string): string {
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

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clipText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  const text = safeString(raw).toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

