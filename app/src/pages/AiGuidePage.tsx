import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ImageAttachmentBar } from "@/components/ImageAttachmentBar";
import { MarkdownContent } from "@/components/MarkdownContent";
import { artifacts } from "@/data";
import { persistChatAttachment, restoreChatAttachments } from "@/lib/chatAttachmentStore";
import type { ImageAttachment } from "@/lib/imageAttachment";
import { askGuideStream } from "@/lib/openaiClient";
import { recallArtifactsByPhoto } from "@/lib/visionRecall";

interface MessageAttachment {
  name: string;
  width: number;
  height: number;
  bytes: number;
  dataUrl?: string;
  assetId?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  attachment?: MessageAttachment;
}

interface CachedChatPayload {
  savedAt?: number;
  artifactHintId?: string;
  messages?: Message[];
}

const CHAT_STORAGE_KEY = "stone-ai-guide-chat-v2";
const MAX_STORED_MESSAGES = 40;
const CHAT_STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildWelcomeMessage(artifactName?: string): string {
  if (artifactName) {
    return `你好，我是你的石刻导游。\n\n当前：**${artifactName}**`;
  }
  return "你好，我是你的石刻导游。";
}

function normalizeAttachment(value: unknown): MessageAttachment | undefined {
  const row = value as Record<string, unknown>;
  const name = safeString(row?.name);
  const width = Number(row?.width || 0);
  const height = Number(row?.height || 0);
  const bytes = Number(row?.bytes || 0);
  const dataUrl = safeString(row?.dataUrl);
  const assetId = safeString(row?.assetId);

  if (!name && !dataUrl && !assetId) return undefined;
  return {
    name: name || "photo.jpg",
    width: Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0,
    height: Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0,
    bytes: Number.isFinite(bytes) ? Math.max(0, Math.round(bytes)) : 0,
    dataUrl: dataUrl || undefined,
    assetId: assetId || undefined
  };
}

function normalizeMessage(value: unknown): Message | null {
  const row = value as Record<string, unknown>;
  const role = row?.role === "assistant" ? "assistant" : row?.role === "user" ? "user" : "";
  const content = safeString(row?.content);
  if (!role || !content) return null;

  return {
    role,
    content,
    attachment: role === "user" ? normalizeAttachment(row?.attachment) : undefined
  };
}

function readCachedMessages(defaultArtifactId: string): { artifactHintId: string; messages: Message[] } {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as CachedChatPayload;
    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt || Date.now() - savedAt > CHAT_STORAGE_TTL_MS) throw new Error("expired");

    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.map((item) => normalizeMessage(item)).filter((item): item is Message => Boolean(item)).slice(-MAX_STORED_MESSAGES)
      : [];

    if (!messages.length) throw new Error("invalid_messages");

    const artifactHintId = artifacts.some((item) => item.id === parsed.artifactHintId)
      ? safeString(parsed.artifactHintId)
      : defaultArtifactId;

    return {
      artifactHintId,
      messages
    };
  } catch {
    return {
      artifactHintId: defaultArtifactId,
      messages: []
    };
  }
}

function stripMessagesForStorage(messages: Message[]): Message[] {
  return messages.slice(-MAX_STORED_MESSAGES).map((message) => {
    if (message.role !== "user" || !message.attachment) return message;
    if (!message.attachment.assetId) return message;
    return {
      ...message,
      attachment: {
        ...message.attachment,
        dataUrl: undefined
      }
    };
  });
}

export function AiGuidePage() {
  const [searchParams] = useSearchParams();
  const queryArtifactId = safeString(searchParams.get("artifactId"));
  const bootQuestion = safeString(searchParams.get("q"));
  const defaultArtifactId = artifacts.some((item) => item.id === queryArtifactId) ? queryArtifactId : "";

  const initialCache = useMemo(() => readCachedMessages(defaultArtifactId), [defaultArtifactId]);
  const [artifactHintId, setArtifactHintId] = useState(initialCache.artifactHintId || defaultArtifactId);
  const selectedArtifact = useMemo(() => artifacts.find((item) => item.id === artifactHintId), [artifactHintId]);

  const [messages, setMessages] = useState<Message[]>(() => {
    if (initialCache.messages.length) return initialCache.messages;
    return [{ role: "assistant", content: buildWelcomeMessage(selectedArtifact?.name) }];
  });
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatPanelRef = useRef<HTMLElement | null>(null);
  const autoAskedRef = useRef(false);
  useEffect(() => {
    if (queryArtifactId && artifacts.some((item) => item.id === queryArtifactId)) {
      setArtifactHintId(queryArtifactId);
    }
  }, [queryArtifactId]);

  useEffect(() => {
    if (!chatPanelRef.current) return;
    chatPanelRef.current.scrollTop = chatPanelRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const unresolvedAssetIds = Array.from(
      new Set(
        messages
          .filter((message) => message.role === "user" && message.attachment?.assetId && !message.attachment?.dataUrl)
          .map((message) => safeString(message.attachment?.assetId))
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
    try {
      localStorage.setItem(
        CHAT_STORAGE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          artifactHintId,
          messages: stripMessagesForStorage(messages)
        } satisfies CachedChatPayload)
      );
    } catch {
      try {
        const fallback = stripMessagesForStorage(messages).map((message) => {
          if (message.role !== "user" || !message.attachment) return message;
          return {
            ...message,
            attachment: {
              ...message.attachment,
              dataUrl: undefined
            }
          };
        });
        localStorage.setItem(
          CHAT_STORAGE_KEY,
          JSON.stringify({
            savedAt: Date.now(),
            artifactHintId,
            messages: fallback
          } satisfies CachedChatPayload)
        );
      } catch {
        // ignore local cache overflow
      }
    }
  }, [artifactHintId, messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clearConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setInput("");
    setAttachment(null);
    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setMessages([{ role: "assistant", content: buildWelcomeMessage(selectedArtifact?.name) }]);
  };

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) return;

    const activeAttachment = attachment;
    setInput("");
    setAttachment(null);

    const nextUserMessage: Message = {
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
      const answer = await askGuideStream(
        {
          question,
          artifactId: imageMode ? undefined : artifactHintId || undefined,
          artifactName: imageMode ? undefined : selectedArtifact?.name,
          contextText: imageMode ? undefined : selectedArtifact?.infoText,
          imageDataUrl: activeAttachment?.dataUrl,
          visionCandidates,
          history: imageMode ? [] : nextMessages.slice(-8).map((item) => ({ role: item.role, content: item.content }))
        },
        {
          signal: controller.signal,
          onDelta: (_, fullText) => {
            streamedAnswer = fullText;
            setMessages((prev) => {
              if (!prev[assistantIndex] || prev[assistantIndex].role !== "assistant") return prev;
              const updated = [...prev];
              updated[assistantIndex] = {
                role: "assistant",
                content: fullText
              };
              return updated;
            });
          }
        }
      );

      const finalAnswer = answer.trim() ? answer : streamedAnswer;
      setMessages((prev) => {
        if (!prev[assistantIndex] || prev[assistantIndex].role !== "assistant") return prev;
        const updated = [...prev];
        updated[assistantIndex] = {
          role: "assistant",
          content: finalAnswer
        };
        return updated;
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
          content: message
            ? `暂时没连上 AI 服务：${message}`
            : "暂时没连上 AI 服务，请稍后再试。"
        }
      ]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!bootQuestion || autoAskedRef.current) return;
    autoAskedRef.current = true;
    void sendQuestion(bootQuestion);
  }, [bootQuestion]);

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
    <AppShell title="AI导游" subtitle="直接提问，拍照也能识别讲解" mainClassName="ai-main">
      <section className="panel">
        <div className="chat-toolbar">
          <small>{Math.max(0, Math.floor(messages.length / 2))} 轮对话</small>
          <button type="button" className="btn ghost btn-small" onClick={clearConversation} disabled={isLoading}>
            清空聊天
          </button>
        </div>
      </section>

      <section className="panel chat-panel" ref={chatPanelRef}>
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={message.role === "assistant" ? "bubble ai" : "bubble user"}>
            {message.role === "assistant" ? (
              message.content ? (
                <MarkdownContent content={message.content} />
              ) : (
                <p className="typing-line">
                  AI 正在输入<span className="typing-cursor">|</span>
                </p>
              )
            ) : (
              <div className="user-bubble-body">
                {message.attachment ? (
                  message.attachment.dataUrl ? (
                    <img className="user-attachment" src={message.attachment.dataUrl} alt={message.attachment.name || "用户附件"} />
                  ) : (
                    <span className="user-attachment-chip">
                      {message.attachment.assetId ? "正在恢复图片..." : "图片暂不可用"}
                    </span>
                  )
                ) : null}
                <p className="user-text">{message.content}</p>
              </div>
            )}
          </article>
        ))}
      </section>

      <form className="panel composer" onSubmit={submitQuestion}>
        <ImageAttachmentBar value={attachment} onChange={setAttachment} disabled={isLoading} />

        <textarea
          placeholder="输入你的问题"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          rows={2}
        />
        <p className="composer-tip">Enter 发送 · Shift+Enter 换行</p>
        <button className="btn primary" type="submit" disabled={isLoading}>
          发送
        </button>
      </form>
    </AppShell>
  );
}
