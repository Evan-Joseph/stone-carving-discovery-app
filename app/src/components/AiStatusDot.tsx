import { useEffect, useMemo, useRef, useState } from "react";
import { getAiHealth, type AiHealthStatus } from "@/lib/openaiClient";

type DotLevel = "ok" | "warn" | "down";

function computeLevel(payload: AiHealthStatus | null, errorText: string): DotLevel {
  if (errorText) return "down";
  if (!payload) return "warn";
  if (payload.ok && payload.configured?.hasApiKey) return "ok";
  if (payload.ok && payload.configured?.hasApiKey === false) return "warn";
  return "down";
}

function buildReason(payload: AiHealthStatus | null, errorText: string): string {
  if (errorText) return `AI 不可用：${errorText}`;
  if (!payload) return "正在检测 AI 服务…";
  if (payload.ok && payload.configured?.hasApiKey === false) return "AI 服务可达，但未配置 BIGMODEL_API_KEY（请在 Cloudflare Pages 环境变量中设置）。";
  if (payload.ok) return `AI 服务正常（model=${payload.configured?.model || "unknown"}）`;
  return payload.error ? `AI 不可用：${payload.error}` : "AI 不可用：未知原因";
}

export function AiStatusDot() {
  const [payload, setPayload] = useState<AiHealthStatus | null>(null);
  const [errorText, setErrorText] = useState("");
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const level = useMemo(() => computeLevel(payload, errorText), [payload, errorText]);
  const reason = useMemo(() => buildReason(payload, errorText), [payload, errorText]);

  useEffect(() => {
    const poll = async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const result = await getAiHealth(controller.signal);
      if (controller.signal.aborted) return;

      setPayload(result);
      setErrorText(result.ok ? "" : result.error || "");
    };

    void poll();
    timerRef.current = window.setInterval(() => void poll(), 12000);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  return (
    <button type="button" className={`ai-status-dot ${level}`} title={reason} aria-label={reason}>
      <span className="dot-core" />
    </button>
  );
}

