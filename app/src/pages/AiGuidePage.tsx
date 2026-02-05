import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { MarkdownContent } from "@/components/MarkdownContent";
import { artifacts } from "@/data";
import { askGuideStream } from "@/lib/openaiClient";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const CHAT_STORAGE_KEY = "stone-ai-guide-chat-v1";
const MAX_STORED_MESSAGES = 40;
const CHAT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildWelcomeMessage(mode: "artifact" | "museum", artifactName?: string): string {
  if (mode === "artifact") {
    return `你好，我是石刻 AI 导游。\n\n可围绕 **${artifactName || "当前展品"}** 直接提问：纹饰寓意、历史背景、图像细节。`;
  }
  return "你好，我是石刻 AI 导游。\n\n你可以问我展馆脉络、时代背景、展厅关系，我会尽量给出清晰可核实的回答。";
}

function buildQuickPrompts(mode: "artifact" | "museum", artifactName?: string): string[] {
  if (mode === "artifact") {
    return [
      `${artifactName || "这个展品"}最值得先看的细节是什么？`,
      `请分3点解释${artifactName || "该展品"}的文化意义`,
      `如果只看30秒，应该重点看哪里？`
    ];
  }
  return ["武梁祠系列与前后石室系列有什么差异？", "如果按参观动线，先看哪些展品最容易理解？", "汉代石刻中常见叙事主题有哪些？"];
}

export function AiGuidePage() {
  const [searchParams] = useSearchParams();
  const queryArtifactId = searchParams.get("artifactId") || "";
  const defaultArtifactId = artifacts.find((item) => item.id === queryArtifactId)?.id || artifacts[0]?.id || "";

  const [mode, setMode] = useState<"artifact" | "museum">(queryArtifactId ? "artifact" : "museum");
  const [selectedId, setSelectedId] = useState(defaultArtifactId);
  const selectedArtifact = useMemo(() => artifacts.find((item) => item.id === selectedId), [selectedId]);
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) throw new Error("empty");
      const parsed = JSON.parse(raw) as { savedAt?: number; mode?: "artifact" | "museum"; selectedId?: string; messages?: Message[] };
      const savedAt = Number(parsed.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > CHAT_STORAGE_TTL_MS) throw new Error("expired");
      if (!Array.isArray(parsed.messages) || !parsed.messages.length) throw new Error("invalid");
      return parsed.messages.slice(-MAX_STORED_MESSAGES);
    } catch {
      return [{ role: "assistant", content: buildWelcomeMessage(queryArtifactId ? "artifact" : "museum", selectedArtifact?.name) }];
    }
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatPanelRef = useRef<HTMLElement | null>(null);

  const quickPrompts = useMemo(() => buildQuickPrompts(mode, selectedArtifact?.name), [mode, selectedArtifact?.name]);

  useEffect(() => {
    if (!chatPanelRef.current) return;
    chatPanelRef.current.scrollTop = chatPanelRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt?: number; mode?: "artifact" | "museum"; selectedId?: string };
      const savedAt = Number(parsed.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > CHAT_STORAGE_TTL_MS) {
        localStorage.removeItem(CHAT_STORAGE_KEY);
        return;
      }
      if (parsed.mode === "artifact" || parsed.mode === "museum") {
        setMode(parsed.mode);
      }
      if (parsed.selectedId && artifacts.some((item) => item.id === parsed.selectedId)) {
        setSelectedId(parsed.selectedId);
      }
    } catch {
      // ignore invalid cache
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        mode,
        selectedId,
        messages: messages.slice(-MAX_STORED_MESSAGES)
      })
    );
  }, [mode, selectedId, messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const resetConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInput("");
    setMessages([{ role: "assistant", content: buildWelcomeMessage(mode, selectedArtifact?.name) }]);
  };

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) return;

    setInput("");
    const userMessage: Message = { role: "user", content: question };
    const nextMessages = [...messages, userMessage];
    const assistantIndex = nextMessages.length;
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setIsLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let streamedAnswer = "";
      const answer = await askGuideStream({
        question,
        scope: mode,
        artifactId: mode === "artifact" ? selectedArtifact?.id : undefined,
        artifactName: selectedArtifact?.name,
        contextText: mode === "artifact" ? selectedArtifact?.infoText : undefined,
        history: nextMessages.slice(-6).map((item) => ({ role: item.role, content: item.content }))
      }, {
        signal: controller.signal,
        onDelta: (_, fullText) => {
          streamedAnswer = fullText;
          setMessages((prev) => {
            if (!prev[assistantIndex] || prev[assistantIndex].role !== "assistant") return prev;
            const next = [...prev];
            next[assistantIndex] = {
              role: "assistant",
              content: fullText
            };
            return next;
          });
        }
      });

      const finalAnswer = answer.trim() ? answer : streamedAnswer;
      setMessages((prev) => {
        if (!prev[assistantIndex] || prev[assistantIndex].role !== "assistant") return prev;
        const next = [...prev];
        next[assistantIndex] = {
          role: "assistant",
          content: finalAnswer
        };
        return next;
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: "AI 服务暂不可用，请稍后重试。后台连通后本页会自动使用服务端配置。"
        }
      ]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const submitQuestion = async (event: FormEvent) => {
    event.preventDefault();
    await sendQuestion(input);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isLoading && input.trim()) {
        void sendQuestion(input);
      }
    }
  };

  return (
    <AppShell title="AI导游问答" subtitle="展品即时问询 · 全馆深度问询" mainClassName="ai-main">
      <section className="panel ai-mode-panel">
        <div className="pick-grid">
          <button type="button" className={mode === "museum" ? "pill active" : "pill"} onClick={() => setMode("museum")}>
            全馆问询
          </button>
          <button type="button" className={mode === "artifact" ? "pill active" : "pill"} onClick={() => setMode("artifact")}>
            展品问询
          </button>
        </div>

        {mode === "artifact" ? (
          <label>
            当前展品
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {artifacts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <p className="config-tip">
          {mode === "artifact"
            ? `将结合“${selectedArtifact?.name || "当前展品"}”资料回答，可问纹饰、故事、出处。`
            : "将按馆藏与展厅背景回答，可问时代、主题、展区关系。"}
        </p>

        <div className="chat-toolbar">
          <small>{Math.max(0, Math.floor(messages.length / 2))} 轮对话</small>
          <button type="button" className="btn ghost btn-small" onClick={resetConversation}>
            新开对话
          </button>
        </div>

        <div className="quick-prompt-row">
          {quickPrompts.map((prompt) => (
            <button key={prompt} type="button" className="pill quick-prompt" onClick={() => setInput(prompt)}>
              {prompt}
            </button>
          ))}
        </div>

        <div className="hero-actions compact">
          <Link className="btn ghost" to="/hall">
            打开展厅模式
          </Link>
          {selectedArtifact ? (
            <Link className="btn ghost" to={`/artifact/${selectedArtifact.id}`}>
              查看当前展品
            </Link>
          ) : null}
        </div>
      </section>

      <section className="panel chat-panel" ref={chatPanelRef}>
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={message.role === "assistant" ? "bubble ai" : "bubble user"}>
            {message.role === "assistant" ? (
              <>
                {message.content ? (
                  <MarkdownContent content={message.content} />
                ) : (
                  <p className="typing-line">
                    AI 正在输入<span className="typing-cursor">|</span>
                  </p>
                )}
              </>
            ) : (
              message.content
            )}
          </article>
        ))}
      </section>

      <form className="panel composer" onSubmit={submitQuestion}>
        <textarea
          placeholder={mode === "artifact" ? "例如：这块石刻中车骑纹饰象征什么？" : "例如：武梁祠三壁叙事有什么差异？"}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          rows={2}
        />
        <p className="composer-tip">Enter 发送 · Shift+Enter 换行</p>
        <button className="btn primary" type="submit" disabled={isLoading}>
          发送问题
        </button>
      </form>
    </AppShell>
  );
}
