import { artifacts } from "@/data";

export interface ArtifactRecommendation {
  id: string;
  reason: string;
  score: number;
}

interface RecommendInput {
  question: string;
  answer?: string;
  mode: "artifact" | "museum";
  selectedId?: string;
}

interface SearchDoc {
  id: string;
  name: string;
  nameNorm: string;
  seriesNorm: string;
  topicNorm: string;
  tags: string[];
  tagsNorm: string[];
  infoNorm: string;
  richness: number;
}

const STOPWORDS = new Set([
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
  "问题",
  "回答",
  "一下子",
  "有没有",
  "比较",
  "推荐",
  "请问",
  "帮我",
  "看看",
  "这里",
  "那里",
  "一个",
  "一些",
  "那个"
]);

const docs: SearchDoc[] = artifacts.map((item) => {
  const infoPlain = toPlainText(item.infoText || "");
  return {
    id: item.id,
    name: item.name,
    nameNorm: normalize(item.name),
    seriesNorm: normalize(item.series),
    topicNorm: normalize(item.pdfTopic || ""),
    tags: item.tags,
    tagsNorm: item.tags.map((tag) => normalize(tag)),
    infoNorm: normalize(infoPlain.slice(0, 2600)),
    richness: (item.infoText ? 4 : 0) + item.linkedPdf.length * 3 + item.tags.length
  };
});

export function getArtifactSummary(markdown: string, maxLength = 64): string {
  const text = toPlainText(markdown).replace(/\s+/g, " ").trim();
  if (!text) return "暂无详细介绍";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function recommendArtifactsForQuestion(input: RecommendInput): ArtifactRecommendation[] {
  const question = (input.question || "").trim();
  const combined = `${question}\n${input.answer || ""}`;
  const tokens = tokenize(combined);
  const recommendIntent = /(推荐|值得|先看|比较好|看哪|哪块|哪些|入门|优先)/.test(question);
  const pointCurrentIntent = /(这块|这个|当前|它|这件|本件)/.test(question);

  const scored = docs.map((doc) => {
    let score = 0;
    const reasons: string[] = [];

    if (input.mode === "artifact" && input.selectedId === doc.id) {
      score += 20;
      reasons.push("当前上下文展品");
    }

    if (pointCurrentIntent && input.selectedId === doc.id) {
      score += 40;
      reasons.push("匹配“当前展品”指代");
    }

    for (const token of tokens) {
      if (doc.nameNorm.includes(token)) {
        score += Math.max(18, token.length * 6);
        if (!reasons.some((reason) => reason.startsWith("匹配名称"))) {
          reasons.push(`匹配名称关键词“${token}”`);
        }
      }

      const matchedTag = doc.tagsNorm.find((tag) => tag.includes(token));
      if (matchedTag) {
        score += Math.max(12, token.length * 5);
        const rawTag = doc.tags[doc.tagsNorm.indexOf(matchedTag)] || token;
        if (!reasons.some((reason) => reason.startsWith("匹配主题"))) {
          reasons.push(`匹配主题“${rawTag}”`);
        }
      }

      if (doc.seriesNorm.includes(token) || doc.topicNorm.includes(token)) {
        score += Math.max(8, token.length * 4);
        if (!reasons.some((reason) => reason.startsWith("匹配系列"))) {
          reasons.push("匹配系列/主题信息");
        }
      }

      if (token.length >= 2 && doc.infoNorm.includes(token)) {
        score += Math.min(8, token.length * 2);
      }
    }

    if (recommendIntent) {
      score += Math.min(20, Math.round(doc.richness * 0.9));
      if (!reasons.length) {
        reasons.push("信息较完整，适合优先查看");
      }
    }

    return {
      id: doc.id,
      score,
      reason: reasons[0] || "相关展品"
    };
  });

  const ranked = scored
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, 3);

  if (ranked.length) {
    return ranked;
  }

  const explicitArtifactIntent = /(哪块|哪些|推荐|先看|石头|展品|文物)/.test(question);
  if (!explicitArtifactIntent) {
    return [];
  }

  return docs
    .slice()
    .sort((a, b) => b.richness - a.richness)
    .slice(0, 3)
    .map((doc) => ({
      id: doc.id,
      reason: "馆内信息较丰富的代表展品",
      score: doc.richness
    }));
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_#>[\](){}<>"'“”‘’|/\\\-:：，。！？!?；;、,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalize(text);
  const set = new Set<string>();

  for (const token of normalized.split(" ")) {
    if (isValidToken(token)) {
      set.add(token);
    }
  }

  const runs = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of runs) {
    if (isValidToken(run)) {
      set.add(run);
    }
    for (let n = 2; n <= 4; n += 1) {
      if (run.length < n) continue;
      for (let index = 0; index <= run.length - n; index += 1) {
        const part = run.slice(index, index + n);
        if (isValidToken(part)) {
          set.add(part);
        }
        if (set.size >= 56) break;
      }
      if (set.size >= 56) break;
    }
    if (set.size >= 56) break;
  }

  return Array.from(set).slice(0, 56);
}

function isValidToken(token: string): boolean {
  if (!token || token.length < 2) return false;
  if (/^\d+$/.test(token)) return false;
  if (STOPWORDS.has(token)) return false;
  return true;
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+[.)]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/-{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
