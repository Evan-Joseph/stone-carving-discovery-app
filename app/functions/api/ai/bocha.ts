export interface BochaSearchItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface BochaSearchConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  count: number;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function searchBochaWeb(
  query: string,
  config: BochaSearchConfig
): Promise<{ items: BochaSearchItem[]; error?: string }> {
  const normalizedQuery = safeString(query);
  if (!normalizedQuery) return { items: [] };
  if (!config.apiKey) return { items: [], error: "bocha key missing" };

  const baseUrl = (safeString(config.baseUrl) || "https://api.bochaai.com").replace(/\/+$/, "");
  const timeoutMs = Number.isFinite(config.timeoutMs) ? Math.max(3000, Math.floor(config.timeoutMs)) : 12000;
  const count = Number.isFinite(config.count) ? Math.max(1, Math.min(10, Math.floor(config.count))) : 5;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/v1/web-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        query: normalizedQuery,
        count,
        summary: true,
        freshness: "noLimit"
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        items: [],
        error: `bocha_http_${response.status}: ${text.slice(0, 220)}`
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const items = normalizeBochaPayload(payload, count);
    return { items };
  } catch (error) {
    const message = error instanceof Error ? error.message : "bocha request failed";
    return { items: [], error: message };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBochaPayload(payload: Record<string, unknown>, count: number): BochaSearchItem[] {
  const candidates = resolveCandidateArray(payload);

  return candidates
    .map((item) => {
      const row = item as Record<string, unknown>;
      const title = safeString(row.name) || safeString(row.title) || safeString(row.siteName) || "联网资料";
      const url = safeString(row.url) || safeString(row.link);
      const snippet = safeString(row.summary) || safeString(row.snippet) || safeString(row.description);
      const publishedAt = safeString(row.datePublished) || safeString(row.dateLastCrawled) || safeString(row.publishedAt) || undefined;
      if (!url || !snippet) return null;
      return { title, url, snippet, publishedAt } satisfies BochaSearchItem;
    })
    .filter((item): item is BochaSearchItem => Boolean(item))
    .slice(0, count);
}

function resolveCandidateArray(payload: Record<string, unknown>): unknown[] {
  const direct = payload.webPages as { value?: unknown } | undefined;
  if (Array.isArray(direct?.value)) return direct.value;

  const data = payload.data as Record<string, unknown> | undefined;
  const nested = data?.webPages as { value?: unknown } | undefined;
  if (Array.isArray(nested?.value)) return nested.value;

  if (Array.isArray(payload.results)) return payload.results as unknown[];
  if (Array.isArray(data?.results)) return data.results as unknown[];

  return [];
}
