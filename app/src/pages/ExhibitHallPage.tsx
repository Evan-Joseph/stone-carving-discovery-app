import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ArtifactImage } from "@/components/ArtifactImage";
import { MarkdownContent } from "@/components/MarkdownContent";
import { artifacts, getDatasetMeta } from "@/data";
import { askGuideStream } from "@/lib/openaiClient";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const HALL_CHAT_STORAGE_KEY = "stone-hall-chat-v1";
const MAX_HALL_MESSAGES = 40;
const HALL_CHAT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildHallWelcome(mode: "artifact" | "museum", artifactName?: string): string {
  if (mode === "artifact") {
    return `欢迎来到展厅模式。\n\n你可以直接问 **${artifactName || "当前展品"}** 的纹饰、时代背景和图像细节。`;
  }
  return "欢迎来到展厅模式。\n\n你可以从全馆角度提问，我会给出结构化、可核实的回答。";
}

function buildHallQuickPrompts(mode: "artifact" | "museum", artifactName?: string): string[] {
  if (mode === "artifact") {
    return [
      `${artifactName || "这件展品"}最值得先看的细节是什么？`,
      `请用3点说明${artifactName || "该展品"}的文化意义`,
      `${artifactName || "该展品"}和同系列相比有什么特点？`
    ];
  }
  return [
    "先看哪几件展品最容易建立整体理解？",
    "武梁祠与前后石室的主要差异是什么？",
    "请按时间线梳理馆内常见叙事主题"
  ];
}

const VIRTUAL_LIST_THRESHOLD = 22;
const VIRTUAL_ITEM_HEIGHT = 92;
const VIRTUAL_OVERSCAN = 4;

export function ExhibitHallPage() {
  const [searchParams] = useSearchParams();
  const artifactIdFromQuery = searchParams.get("artifactId") || "";
  const initialArtifactId = artifacts.find((item) => item.id === artifactIdFromQuery)?.id || artifacts[0]?.id || "";
  const initialArtifactName = artifacts.find((item) => item.id === initialArtifactId)?.name;

  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState(initialArtifactId);
  const [tab, setTab] = useState<"official" | "book" | "pdf">("official");
  const [askMode, setAskMode] = useState<"artifact" | "museum">("artifact");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const raw = localStorage.getItem(HALL_CHAT_STORAGE_KEY);
      if (!raw) throw new Error("empty");
      const parsed = JSON.parse(raw) as { savedAt?: number; messages?: ChatMessage[] };
      const savedAt = Number(parsed.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > HALL_CHAT_STORAGE_TTL_MS) throw new Error("expired");
      if (!Array.isArray(parsed.messages) || !parsed.messages.length) throw new Error("invalid");
      return parsed.messages.slice(-MAX_HALL_MESSAGES);
    } catch {
      return [
        {
          role: "assistant",
          content: buildHallWelcome("artifact", initialArtifactName)
        }
      ];
    }
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [itemHeight, setItemHeight] = useState(VIRTUAL_ITEM_HEIGHT);

  const selected = useMemo(() => artifacts.find((item) => item.id === selectedId) || artifacts[0], [selectedId]);
  const quickPrompts = useMemo(() => buildHallQuickPrompts(askMode, selected?.name), [askMode, selected?.name]);
  const totalPdfPages = Math.max(1, getDatasetMeta().pdfTotalPages || 1);

  const filtered = useMemo(() => {
    const key = keyword.trim();
    if (!key) return artifacts;
    return artifacts.filter((item) =>
      [item.name, item.series, item.pdfTopic || "", ...item.tags].some((field) => field.includes(key))
    );
  }, [keyword]);

  const useVirtualList = filtered.length >= VIRTUAL_LIST_THRESHOLD;
  const totalVirtualHeight = filtered.length * itemHeight;
  const startIndex = useVirtualList ? Math.max(0, Math.floor(scrollTop / itemHeight) - VIRTUAL_OVERSCAN) : 0;
  const clampedViewport = Math.max(itemHeight, Math.min(viewportHeight || itemHeight * 6, itemHeight * 8));
  const visibleCount = useVirtualList
    ? Math.ceil(clampedViewport / itemHeight) + VIRTUAL_OVERSCAN * 2
    : filtered.length;
  const endIndex = useVirtualList ? Math.min(filtered.length, startIndex + visibleCount) : filtered.length;
  const visibleItems = useVirtualList ? filtered.slice(startIndex, endIndex) : filtered;

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;

    const refreshViewport = () => {
      setViewportHeight(node.clientHeight);
      setScrollTop(node.scrollTop);
    };

    refreshViewport();
    const onScroll = () => setScrollTop(node.scrollTop);
    node.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(refreshViewport);
    observer.observe(node);

    return () => {
      node.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [filtered.length]);

  useEffect(() => {
    if (!useVirtualList) return;
    const node = listRef.current;
    if (!node) return;
    const firstItem = node.querySelector(".hall-item") as HTMLElement | null;
    if (!firstItem) return;
    const measured = Math.max(72, Math.round(firstItem.getBoundingClientRect().height + 6));
    if (Math.abs(measured - itemHeight) > 1) {
      setItemHeight(measured);
    }
  }, [useVirtualList, filtered.length, viewportHeight, itemHeight]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = 0;
    setScrollTop(0);
  }, [keyword]);

  useEffect(() => {
    const node = chatPanelRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(
      HALL_CHAT_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        askMode,
        selectedId,
        messages: messages.slice(-MAX_HALL_MESSAGES)
      })
    );
  }, [askMode, selectedId, messages]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HALL_CHAT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt?: number; askMode?: "artifact" | "museum"; selectedId?: string };
      const savedAt = Number(parsed.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > HALL_CHAT_STORAGE_TTL_MS) {
        localStorage.removeItem(HALL_CHAT_STORAGE_KEY);
        return;
      }
      if (parsed.askMode === "artifact" || parsed.askMode === "museum") {
        setAskMode(parsed.askMode);
      }
      if (parsed.selectedId && artifacts.some((item) => item.id === parsed.selectedId)) {
        setSelectedId(parsed.selectedId);
      }
    } catch {
      // ignore invalid cache
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const resetConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInput("");
    setMessages([{ role: "assistant", content: buildHallWelcome(askMode, selected?.name) }]);
  };

  const selectArtifact = (id: string) => {
    setSelectedId(id);
    setAskMode("artifact");
  };

  const renderListItem = (item: (typeof filtered)[number], indexInFiltered: number, virtualized: boolean) => (
    <button
      key={item.id}
      type="button"
      className={item.id === selected.id ? "hall-item active" : "hall-item"}
      style={virtualized ? { top: `${indexInFiltered * itemHeight}px` } : undefined}
      onClick={() => selectArtifact(item.id)}
    >
      <div className="thumb-frame thumb-small">
        <ArtifactImage artifact={item} alt={item.name} sizes="72px" />
      </div>
      <div className="hall-item-meta">
        <h4>{item.name}</h4>
        <p>{item.series}</p>
      </div>
    </button>
  );

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) return;

    setInput("");
    const nextUserMessage: ChatMessage = { role: "user", content: question };
    const nextMessages = [...messages, nextUserMessage];
    const assistantIndex = nextMessages.length;
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setIsLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let streamedAnswer = "";
      const answer = await askGuideStream({
        question,
        scope: askMode,
        artifactId: askMode === "artifact" ? selected?.id : undefined,
        artifactName: selected?.name,
        contextText: askMode === "artifact" ? selected?.infoText : undefined,
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
          content: "AI 服务暂不可用，请稍后再试。后台连通后这里会自动走服务端配置。"
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

  if (!selected) {
    return (
      <AppShell title="展厅模式" subtitle="暂无展品数据" hideNav mainClassName="hall-main">
        <section className="panel">请先构建数据后再进入展厅模式。</section>
      </AppShell>
    );
  }

  return (
    <AppShell title="展厅模式" subtitle="横屏一屏浏览：陈列 · 阅读 · AI问询" hideNav mainClassName="hall-main">
      <section className="panel hall-list-panel">
        <header className="panel-title-row">
          <h3>展品陈列</h3>
          <small>{artifacts.length} 件</small>
        </header>
        <label className="hall-search">
          检索
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="按名称/系列/主题过滤" />
        </label>
        <div className="hall-list" ref={listRef}>
          {useVirtualList ? (
            <div className="hall-list-virtual" style={{ height: `${totalVirtualHeight}px` }}>
              {visibleItems.map((item, offset) => renderListItem(item, startIndex + offset, true))}
            </div>
          ) : (
            filtered.map((item, index) => renderListItem(item, index, false))
          )}
        </div>
      </section>

      <section className="panel hall-detail-panel">
        <header className="panel-title-row">
          <h3>{selected.name}</h3>
          <span>{selected.series}</span>
        </header>
        <div className="hall-hero">
          <div className="thumb-frame hall-hero-image">
            <ArtifactImage artifact={selected} alt={selected.name} loading="eager" sizes="(max-width: 1200px) 42vw, 360px" />
          </div>
          <div className="hall-hero-meta">
            <p>关联PDF页：{selected.pdfPages.length ? selected.pdfPages.join("、") : "暂无"}</p>
            <p>主题：{selected.pdfTopic || "暂无"}</p>
            <div className="hero-actions compact">
              <Link className="btn ghost" to={`/pdf-reader?page=${selected.pdfPages[0] || 1}&artifactId=${selected.id}`}>
                打开PDF
              </Link>
              <Link className="btn ghost" to={`/artifact/${selected.id}`}>
                独立详情
              </Link>
            </div>
          </div>
        </div>

        <div className="tab-row hall-tabs">
          <button className={tab === "official" ? "tab active" : "tab"} onClick={() => setTab("official")}>官方</button>
          <button className={tab === "book" ? "tab active" : "tab"} onClick={() => setTab("book")}>书籍</button>
          <button className={tab === "pdf" ? "tab active" : "tab"} onClick={() => setTab("pdf")}>PDF</button>
        </div>

        <div className="hall-body">
          {tab === "official" ? (
            selected.infoText ? <MarkdownContent content={selected.infoText} /> : <p>暂无相关资料</p>
          ) : null}

          {tab === "book" ? (
            selected.linkedPdf.length ? (
              selected.linkedPdf.map((page) => (
                <article key={page.page} className="linked-page">
                  <h4>第{page.page}页 {page.title ? `· ${page.title}` : ""}</h4>
                  {page.content ? <MarkdownContent content={page.content} /> : <p>（暂无文字内容）</p>}
                </article>
              ))
            ) : (
              <p>暂无相关资料</p>
            )
          ) : null}

          {tab === "pdf" ? (
            <div className="hall-pdf-grid">
              {selected.pdfPages.length ? (
                selected.pdfPages.map((page) => (
                  <Link key={page} className="pill" to={`/pdf-reader?page=${Math.min(totalPdfPages, page)}&artifactId=${selected.id}`}>
                    第{page}页
                  </Link>
                ))
              ) : (
                <p>暂无相关页码</p>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel hall-ai-panel">
        <header className="panel-title-row">
          <h3>AI问询</h3>
          <small>{askMode === "artifact" ? `针对：${selected.name}` : "全馆模式"}</small>
        </header>

        <div className="pick-grid">
          <button type="button" className={askMode === "artifact" ? "pill active" : "pill"} onClick={() => setAskMode("artifact")}>问这个展品</button>
          <button type="button" className={askMode === "museum" ? "pill active" : "pill"} onClick={() => setAskMode("museum")}>问整个博物馆</button>
        </div>

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

        <div className="chat-panel hall-chat" ref={chatPanelRef}>
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
        </div>

        <form className="composer hall-composer" onSubmit={submitQuestion}>
          <textarea
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={askMode === "artifact" ? `问“${selected.name}”的纹饰、故事或出处` : "问馆藏、展厅、时代背景或人物故事"}
          />
          <p className="composer-tip">Enter 发送 · Shift+Enter 换行</p>
          <button className="btn primary" type="submit" disabled={isLoading}>
            发送
          </button>
        </form>
      </section>
    </AppShell>
  );
}
