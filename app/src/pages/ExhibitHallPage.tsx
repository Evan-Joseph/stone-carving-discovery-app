import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ArtifactImage } from "@/components/ArtifactImage";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ImageAttachmentBar } from "@/components/ImageAttachmentBar";
import { artifacts, getDatasetMeta } from "@/data";
import { persistChatAttachment, restoreChatAttachments } from "@/lib/chatAttachmentStore";
import type { ImageAttachment } from "@/lib/imageAttachment";
import { askGuideStream } from "@/lib/openaiClient";
import { recallArtifactsByPhoto } from "@/lib/visionRecall";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachment?: {
    name: string;
    width: number;
    height: number;
    bytes: number;
    dataUrl?: string;
    assetId?: string;
  };
}

const HALL_CHAT_STORAGE_KEY = "stone-hall-chat-v2";
const MAX_HALL_MESSAGES = 40;
const HALL_CHAT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function buildHallWelcome(artifactName?: string): string {
  if (artifactName) {
    return `欢迎来到展厅模式。\n\n你正在浏览 **${artifactName}**，可直接问细节，也可问全馆。`;
  }
  return "欢迎来到展厅模式。\n\n你可以直接提问，系统会自动判断是展品问题还是全馆问题。";
}

function buildHallQuickPrompts(artifactName?: string): string[] {
  return [
    `${artifactName || "这件展品"}最值得先看的细节是什么？`,
    "先看哪几件展品最容易建立整体理解？",
    "拍这块石刻后，你最可能识别到什么线索？"
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
          content: buildHallWelcome(initialArtifactName)
        }
      ];
    }
  });
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [itemHeight, setItemHeight] = useState(VIRTUAL_ITEM_HEIGHT);

  const selected = useMemo(() => artifacts.find((item) => item.id === selectedId) || artifacts[0], [selectedId]);
  const quickPrompts = useMemo(() => buildHallQuickPrompts(selected?.name), [selected?.name]);
  const totalPdfPages = Math.max(1, getDatasetMeta().pdfTotalPages || 1);

  const filtered = useMemo(() => {
    const key = keyword.trim();
    if (!key) return artifacts;
    return artifacts.filter((item) =>
      [item.name, item.series, item.museum || "", item.pdfTopic || "", ...item.tags].some((field) => field.includes(key))
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
    const unresolvedAssetIds = Array.from(
      new Set(
        messages
          .filter((message) => message.role === "user" && message.attachment?.assetId && !message.attachment?.dataUrl)
          .map((message) => String(message.attachment?.assetId || ""))
          .filter(Boolean)
      )
    );
    if (!unresolvedAssetIds.length) return;

    let cancelled = false;
    void restoreChatAttachments(unresolvedAssetIds).then((map) => {
      if (cancelled || !Object.keys(map).length) return;
      setMessages((prev) =>
        prev.map((message) => {
          if (message.role !== "user" || !message.attachment?.assetId || message.attachment.dataUrl) return message;
          const restored = map[message.attachment.assetId];
          if (!restored) return message;
          return {
            ...message,
            attachment: {
              ...message.attachment,
              dataUrl: restored
            }
          };
        })
      );
    });

    return () => {
      cancelled = true;
    };
  }, [messages]);

  useEffect(() => {
    const compactMessages = messages.slice(-MAX_HALL_MESSAGES).map((msg) => {
      if (msg.role !== "user" || !msg.attachment) return msg;
      if (!msg.attachment.assetId) return msg;
      return {
        ...msg,
        attachment: {
          ...msg.attachment,
          dataUrl: undefined
        }
      };
    });
    localStorage.setItem(
      HALL_CHAT_STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        selectedId,
        messages: compactMessages
      })
    );
  }, [selectedId, messages]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HALL_CHAT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { savedAt?: number; selectedId?: string };
      const savedAt = Number(parsed.savedAt || 0);
      if (!savedAt || Date.now() - savedAt > HALL_CHAT_STORAGE_TTL_MS) {
        localStorage.removeItem(HALL_CHAT_STORAGE_KEY);
        return;
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
    setAttachment(null);
    setMessages([{ role: "assistant", content: buildHallWelcome(selected?.name) }]);
  };

  const selectArtifact = (id: string) => {
    setSelectedId(id);
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
        <p>{item.museum ? `${item.museum} · ${item.series}` : item.series}</p>
      </div>
    </button>
  );

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) return;

    setInput("");
    const activeAttachment = attachment;
    setAttachment(null);

    const nextUserMessage: ChatMessage = {
      role: "user",
      content: question,
      attachment: activeAttachment
        ? {
            name: activeAttachment.name,
            width: activeAttachment.width,
            height: activeAttachment.height,
            bytes: activeAttachment.bytes,
            dataUrl: activeAttachment.dataUrl
          }
        : undefined
    };
    const nextMessages = [...messages, nextUserMessage];
    const userIndex = nextMessages.length - 1;
    const assistantIndex = nextMessages.length;
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setIsLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const persistPromise = activeAttachment
      ? persistChatAttachment({ dataUrl: activeAttachment.dataUrl, bytes: activeAttachment.bytes }).catch(() => undefined)
      : Promise.resolve(undefined);
    const recallPromise = activeAttachment
      ? recallArtifactsByPhoto(activeAttachment.dataUrl, artifacts, 6).catch(() => [])
      : Promise.resolve([]);

    try {
      const [assetId, visionCandidates] = await Promise.all([persistPromise, recallPromise]);

      if (assetId) {
        setMessages((prev) => {
          if (!prev[userIndex] || prev[userIndex].role !== "user" || !prev[userIndex].attachment) return prev;
          const updated = [...prev];
          const currentAttachment = updated[userIndex].attachment;
          if (!currentAttachment) return prev;
          updated[userIndex] = {
            ...updated[userIndex],
            attachment: {
              ...currentAttachment,
              assetId
            }
          };
          return updated;
        });
      }

      let streamedAnswer = "";
      const imageMode = Boolean(activeAttachment);
      const answer = await askGuideStream({
        question,
        artifactId: imageMode ? undefined : selected?.id,
        artifactName: imageMode ? undefined : selected?.name,
        contextText: imageMode ? undefined : selected?.infoText,
        imageDataUrl: activeAttachment?.dataUrl,
        visionCandidates,
        history: imageMode ? [] : nextMessages.slice(-6).map((item) => ({ role: item.role, content: item.content }))
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
      const message = error instanceof Error ? error.message : "";
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: message ? `AI 服务暂不可用：${message}` : "AI 服务暂不可用，请稍后再试。后台连通后这里会自动走服务端配置。"
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
          <span>{selected.museum ? `${selected.museum} · ${selected.series}` : selected.series}</span>
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
            <>
              {selected.infoText ? <MarkdownContent content={selected.infoText} /> : <p>暂无相关资料</p>}
              {selected.infoImage ? (
                <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px dashed var(--line)" }}>
                  <p style={{ fontSize: "0.82rem", color: "var(--ink-soft)", marginBottom: "6px" }}>馆方展板说明：</p>
                  <img
                    src={selected.infoImage}
                    alt={`${selected.name} 展板说明`}
                    style={{ width: "100%", borderRadius: "6px", border: "1px solid var(--line)" }}
                    loading="lazy"
                  />
                </div>
              ) : null}
            </>
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
          <small>当前展品：{selected.name}</small>
        </header>

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
              <div className="user-bubble-body">
                {message.attachment ? (
                  message.attachment.dataUrl ? (
                    <img className="user-attachment" src={message.attachment.dataUrl} alt="用户附件" />
                  ) : (
                    <span className="user-attachment-chip">{message.attachment.assetId ? "正在恢复图片..." : "图片暂不可用"}</span>
                  )
                ) : null}
                <p className="user-text">{message.content}</p>
              </div>
            )}
            </article>
          ))}
        </div>

        <form className="composer hall-composer" onSubmit={submitQuestion}>
          <ImageAttachmentBar value={attachment} onChange={setAttachment} disabled={isLoading} compact />

          <textarea
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={`可以问“${selected.name}”的细节，也可以问全馆背景`}
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
