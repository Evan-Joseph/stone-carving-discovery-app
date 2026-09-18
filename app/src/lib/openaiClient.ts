import type { ArtifactRecommendation } from "@/lib/artifactRecommend";
import { artifacts } from "@/data";
import { resolveOfflineGuideAnswer } from "@/lib/offlineKnowledge";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AskGuideInput {
  question: string;
  contextText?: string;
  imageDataUrl?: string;
  history?: ChatMessage[];
  scope?: "artifact" | "museum";
  artifactId?: string;
  artifactName?: string;
  visionCandidates?: {
    id: string;
    name?: string;
    score: number;
  }[];
}

interface AskGuideStreamHandlers {
  onDelta?: (delta: string, fullText: string) => void;
  signal?: AbortSignal;
}

interface WishCandidate {
  id: string;
  name: string;
  series: string;
  tags: string[];
  pdfTopic?: string;
}

interface PickByWishInput {
  wish: string;
  candidates: WishCandidate[];
}

export interface AnswerCitation {
  title: string;
  snippet: string;
  sourceType: "artifact" | "pdf" | "museum" | "web";
  artifactId?: string;
}

interface EnrichGuideInput {
  question: string;
  answer: string;
  scope?: "artifact" | "museum";
  artifactId?: string;
  artifactName?: string;
  contextText?: string;
}

export interface EnrichGuideResult {
  recommendations: ArtifactRecommendation[];
  citations: AnswerCitation[];
}

export interface AiHealthStatus {
  ok: boolean;
  configured?: {
    provider?: string;
    hasApiKey?: boolean;
    hasBochaKey?: boolean;
    baseUrl?: string;
    model?: string;
    visionModel?: string;
  };
  error?: string;
}

const rawAiApiBase = String(import.meta.env.VITE_AI_API_BASE || "").trim();
const AI_API_BASE = rawAiApiBase ? rawAiApiBase.replace(/\/+$/, "") : "/api/ai";

function buildFriendlyApiError(status: number, rawBody: string): string {
  const text = rawBody.trim();
  let detail = text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const parsedError = typeof parsed.error === "string" ? parsed.error.trim() : "";
    if (parsedError) detail = parsedError;
  } catch {
    // keep raw text
  }

  if (status === 401 || status === 403) {
    return "AI 服务认证失败，请稍后再试。";
  }
  if (/SILICONFLOW_API_KEY|API_KEY is missing/i.test(detail)) {
    return "AI 服务暂未完成配置，请稍后再试。";
  }
  if (/bocha key missing/i.test(detail)) {
    return "联网资料暂不可用，已自动改为馆内资料讲解。";
  }
  if (/timeout/i.test(detail)) {
    return "AI 响应超时，请稍后重试。";
  }

  return detail ? `AI 服务异常（${status}）：${detail}` : `AI 服务异常（${status}）`;
}

function inferAutoScope(input: AskGuideInput): "artifact" | "museum" | "" {
  if (input.scope === "artifact" || input.scope === "museum") return input.scope;

  const question = typeof input.question === "string" ? input.question : "";
  if (input.imageDataUrl) return "artifact";
  if (input.artifactId || input.artifactName) {
    if (/(全馆|整体|参观路线|动线|整个博物馆)/.test(question)) return "museum";
    return "artifact";
  }
  return "";
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

async function requestBackend(path: string, payload: Record<string, unknown>): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${AI_API_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(buildFriendlyApiError(response.status, await response.text()));
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI 服务调用失败");
}

async function requestBackendStream(
  path: string,
  payload: Record<string, unknown>,
  handlers?: AskGuideStreamHandlers
): Promise<string> {
  const response = await fetch(`${AI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: handlers?.signal
  });

  if (!response.ok) {
    throw new Error(buildFriendlyApiError(response.status, await response.text()));
  }

  if (!response.body) {
    const fallbackPayload = await response.json();
    const fallbackAnswer = readAnswerFromPayload(fallbackPayload);
    if (!fallbackAnswer) throw new Error("AI 返回为空");
    return fallbackAnswer;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line) {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          newlineIndex = buffer.indexOf("\n");
          continue;
        }
        const type = typeof event.type === "string" ? event.type : "";

        if (type === "delta") {
          const delta = typeof event.delta === "string" ? event.delta : "";
          if (delta) {
            answer += delta;
            handlers?.onDelta?.(delta, answer);
          }
        } else if (type === "done") {
          const finalAnswer = typeof event.answer === "string" ? event.answer : answer;
          if (!finalAnswer.trim()) {
            throw new Error("AI 返回为空");
          }
          return finalAnswer;
        } else if (type === "error") {
          const message = typeof event.error === "string" ? event.error : "AI 服务调用失败";
          throw new Error(message);
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }

  if (!answer.trim()) {
    throw new Error("AI 返回为空");
  }
  return answer;
}

export async function getAiHealth(signal?: AbortSignal): Promise<AiHealthStatus> {
  try {
    const response = await fetch(`${AI_API_BASE}/health`, { method: "GET", signal });
    if (!response.ok) {
      return { ok: false, error: `AI health ${response.status}: ${await response.text()}` };
    }
    const payload = (await response.json()) as AiHealthStatus;
    if (!payload || typeof payload !== "object") return { ok: false, error: "AI health payload invalid" };
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI health request failed";
    return { ok: false, error: message };
  }
}

function readAnswerFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as Record<string, unknown>;

  if (typeof data.answer === "string" && data.answer.trim()) {
    return data.answer.trim();
  }

  const maybeContent = (data.choices as unknown[] | undefined)?.[0];
  if (maybeContent && typeof maybeContent === "object") {
    const message = (maybeContent as Record<string, unknown>).message as Record<string, unknown> | undefined;
    if (message) {
      const content = extractTextContent(message.content);
      if (content) return content;
    }
  }

  if (typeof data.content === "string" && data.content.trim()) {
    return data.content.trim();
  }

  return "";
}

export async function askGuide(input: AskGuideInput): Promise<string> {
  const scope = inferAutoScope(input);
  const payload = await requestBackend("/chat", {
    question: input.question,
    scope,
    artifactId: input.artifactId || "",
    contextText: input.contextText || "",
    artifactName: input.artifactName || "",
    imageDataUrl: input.imageDataUrl || "",
    history: input.history || [],
    visionCandidates: input.visionCandidates || []
  });

  const answer = readAnswerFromPayload(payload);
  if (!answer) {
    throw new Error("AI 返回为空");
  }
  return answer;
}

export async function askGuideStream(input: AskGuideInput, handlers?: AskGuideStreamHandlers): Promise<string> {
  const scope = inferAutoScope(input);
  try {
    return await requestBackendStream(
      "/chat-stream",
      {
        question: input.question,
        scope,
        artifactId: input.artifactId || "",
        contextText: input.contextText || "",
        artifactName: input.artifactName || "",
        imageDataUrl: input.imageDataUrl || "",
        history: input.history || [],
        visionCandidates: input.visionCandidates || []
      },
      handlers
    );
  } catch (error) {
    if (handlers?.signal?.aborted) throw error;

    const target = input.artifactId ? artifacts.find((item) => item.id === input.artifactId) : undefined;
    const { answer } = resolveOfflineGuideAnswer(input.question, target, input.contextText);

    if (handlers?.onDelta) {
      const parts = answer.split("");
      let buffer = "";
      for (const char of parts) {
        buffer += char;
        handlers.onDelta(char, buffer);
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
    }
    return answer;
  }
}

function readEnrichResult(payload: unknown): EnrichGuideResult {
  if (!payload || typeof payload !== "object") {
    return { recommendations: [], citations: [] };
  }

  const data = payload as Record<string, unknown>;
  const recommendations: ArtifactRecommendation[] = Array.isArray(data.recommendations)
    ? data.recommendations
        .map((item) => {
          const rec = item as Record<string, unknown>;
          const id = typeof rec.id === "string" ? rec.id : "";
          const reason = typeof rec.reason === "string" ? rec.reason : "";
          if (!id || !reason) return null;
          const scoreRaw = Number(rec.score ?? 0);
          const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;
          return { id, reason, score };
        })
        .filter((item): item is ArtifactRecommendation => Boolean(item))
        .slice(0, 3)
    : [];

  const citationsRaw: AnswerCitation[] = Array.isArray(data.citations)
    ? data.citations
        .map((item): AnswerCitation | null => {
          const citation = item as Record<string, unknown>;
          const title = typeof citation.title === "string" ? citation.title : "";
          const snippet = typeof citation.snippet === "string" ? citation.snippet : "";
          if (!snippet) return null;
          const sourceTypeRaw = typeof citation.sourceType === "string" ? citation.sourceType : "artifact";
          const sourceType: AnswerCitation["sourceType"] =
            sourceTypeRaw === "pdf" || sourceTypeRaw === "museum" || sourceTypeRaw === "web"
              ? sourceTypeRaw
              : "artifact";
          const artifactId = typeof citation.artifactId === "string" ? citation.artifactId : undefined;
          return { title, snippet, sourceType, ...(artifactId ? { artifactId } : {}) };
        })
        .filter((item): item is AnswerCitation => item !== null)
        .slice(0, 4)
    : [];

  return { recommendations, citations: citationsRaw };
}

export async function enrichGuide(input: EnrichGuideInput): Promise<EnrichGuideResult> {
  const scope = input.scope || (input.artifactId ? "artifact" : "museum");
  try {
    const payload = await requestBackend("/enrich", {
      question: input.question,
      answer: input.answer,
      scope,
      artifactId: input.artifactId || "",
      artifactName: input.artifactName || "",
      contextText: input.contextText || ""
    });

    return readEnrichResult(payload);
  } catch {
    const target = input.artifactId ? artifacts.find((item) => item.id === input.artifactId) : undefined;
    const { recommendedIds } = resolveOfflineGuideAnswer(input.question, target, input.contextText);
    const recs: ArtifactRecommendation[] = recommendedIds
      .map((id) => {
        const a = artifacts.find((item) => item.id === id);
        return a ? { id: a.id, reason: `${a.museum || "鲁西南石刻"}核心馆藏`, score: 95 } : null;
      })
      .filter((item): item is ArtifactRecommendation => Boolean(item));

    return {
      recommendations: recs,
      citations: [
        {
          title: target ? target.name : "鲁西南汉代石刻考据志",
          snippet: (target?.infoText || "汇聚嘉祥武氏墓群、济宁市博、巨野县博三馆田野考据实录。").slice(0, 100),
          sourceType: "museum",
          artifactId: target?.id
        }
      ]
    };
  }
}

export async function pickArtifactByWish(input: PickByWishInput): Promise<{ id: string; reason: string }> {
  const payload = (await requestBackend("/wish", {
    wish: input.wish,
    candidates: input.candidates
  })) as Record<string, unknown>;

  const pickedId = typeof payload.id === "string" ? payload.id : "";
  const reason = typeof payload.reason === "string" ? payload.reason : "AI 已按许愿内容完成匹配。";

  if (pickedId && input.candidates.some((item) => item.id === pickedId)) {
    return { id: pickedId, reason };
  }

  const answer = readAnswerFromPayload(payload);
  const fallbackId = input.candidates.find((item) => answer.includes(item.id))?.id;
  if (fallbackId) {
    return { id: fallbackId, reason: reason || "AI 已按许愿内容完成匹配。" };
  }

  throw new Error("AI 未返回有效候选 id");
}
