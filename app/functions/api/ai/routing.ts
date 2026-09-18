export type AutoScope = "artifact" | "museum";

export interface IntentDecision {
  scope: AutoScope;
  shouldUseWebSearch: boolean;
  continueWithHistory: boolean;
  reason: string;
  correctionTarget: string;
}

export interface DetectIntentInput {
  question: string;
  historyText?: string;
  hasImage: boolean;
  hasArtifactHint: boolean;
  primaryArtifactScore: number;
  correctionTarget?: string;
}

const MUSEUM_INTENT_RE = /(全馆|整个馆|整个博物馆|全局|概览|整体|参观路线|动线|展厅关系|时代脉络|历史脉络|馆藏结构|先看哪)/;
const ARTIFACT_INTENT_RE = /(这块|这件|这幅|这张|这尊|这个展品|这件展品|细节|纹饰|雕刻|构图|画面|图像|材质|石刻|门楣|门柱|故事场景)/;
const WEB_SEARCH_STRONG_RE = /(最新|近年|近期|今年|现在|今日|新闻|研究进展|学界|论文|出处|网址|参考文献|联网查|网上资料)/;
const WEB_SEARCH_SOFT_RE = /(为什么|如何|区别|背景|来源|意义|影响|争议|对比|演变|流变)/;

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function extractCorrectionTarget(question: string): string {
  const text = safeString(question);
  if (!text) return "";

  const candidates = [
    /不是(?:这个|这件|这块|它)?[，,。\s]*是([^，。！？!?\n]+)/,
    /不对[，,。\s]*(?:应该|应当)?是([^，。！？!?\n]+)/,
    /认错了[，,。\s]*(?:应该|其实)?是([^，。！？!?\n]+)/,
    /纠正一下[：:，,\s]*([^，。！？!?\n]+)/
  ];

  for (const pattern of candidates) {
    const matched = text.match(pattern);
    const picked = safeString(matched?.[1]);
    if (picked) return picked;
  }

  return "";
}

export function detectIntent(input: DetectIntentInput): IntentDecision {
  const question = safeString(input.question);
  const historyText = safeString(input.historyText);
  const correctionTarget = safeString(input.correctionTarget);

  let scope: AutoScope = "museum";
  let reason = "默认按全馆问题处理";

  if (correctionTarget) {
    scope = "artifact";
    reason = "检测到用户在纠正识别对象，按展品问题处理";
  } else if (input.hasImage) {
    scope = "artifact";
    reason = "检测到拍照输入，优先按展品识别与讲解处理";
  } else if (MUSEUM_INTENT_RE.test(question)) {
    scope = "museum";
    reason = "问题更偏向全馆背景与动线";
  } else if (input.hasArtifactHint && !MUSEUM_INTENT_RE.test(question)) {
    scope = "artifact";
    reason = "存在展品上下文提示，优先按展品处理";
  } else if (ARTIFACT_INTENT_RE.test(question) && Number(input.primaryArtifactScore || 0) >= 86) {
    scope = "artifact";
    reason = "命中展品细节语义，且候选置信度较高";
  } else if (ARTIFACT_INTENT_RE.test(historyText) && Number(input.primaryArtifactScore || 0) >= 96) {
    scope = "artifact";
    reason = "历史对话持续聚焦展品，沿用展品上下文";
  }

  const shouldUseWebSearch = decideWebSearch(question, scope);
  return {
    scope,
    shouldUseWebSearch,
    continueWithHistory: Boolean(historyText),
    reason,
    correctionTarget
  };
}

function decideWebSearch(question: string, scope: AutoScope): boolean {
  const text = safeString(question);
  if (!text) return false;

  if (WEB_SEARCH_STRONG_RE.test(text)) return true;
  if (scope === "museum" && WEB_SEARCH_SOFT_RE.test(text) && text.length >= 10) return true;
  if (scope === "museum" && /(请给来源|给出处|依据是什么)/.test(text)) return true;

  return false;
}
