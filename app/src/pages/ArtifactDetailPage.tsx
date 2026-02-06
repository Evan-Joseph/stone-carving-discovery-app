import { ChangeEvent, FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArtifactImage } from "@/components/ArtifactImage";
import { AppShell } from "@/components/AppShell";
import { MarkdownContent } from "@/components/MarkdownContent";
import { artifacts, getArtifactById, getDatasetMeta } from "@/data";
import { fileToCompressedImageAttachment, type ImageAttachment } from "@/lib/imageAttachment";
import { askGuideStream } from "@/lib/openaiClient";

export function ArtifactDetailPage() {
  const { artifactId } = useParams<{ artifactId: string }>();
  const [searchParams] = useSearchParams();
  const artifact = artifactId ? getArtifactById(artifactId) : undefined;
  const [tab, setTab] = useState<"official" | "book" | "pdf">("official");
  const [askInput, setAskInput] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [attachment, setAttachment] = useState<ImageAttachment | null>(null);
  const [attachError, setAttachError] = useState("");
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  const totalPdfPages = Math.max(1, getDatasetMeta().pdfTotalPages || 1);
  const fromPageRaw = Number.parseInt(searchParams.get("fromPage") || "", 10);
  const fromPage = Number.isFinite(fromPageRaw)
    ? Math.min(totalPdfPages, Math.max(1, Math.round(fromPageRaw)))
    : undefined;

  const related = useMemo(() => {
    if (!artifact) return [];
    return artifacts.filter((item) => item.series === artifact.series && item.id !== artifact.id).slice(0, 4);
  }, [artifact]);

  if (!artifact) {
    return (
      <AppShell title="文物详情" subtitle="未找到对应展品">
        <p>请从文物库重新选择展品。</p>
        <div className="hero-actions">
          <Link className="btn primary" to="/collection">
            返回文物库
          </Link>
        </div>
      </AppShell>
    );
  }

  const askArtifactNow = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) return;

    setAskInput("");
    setAskAnswer("");
    setIsAsking(true);
    try {
      let streamedAnswer = "";
      const answer = await askGuideStream({
        question,
        scope: "artifact",
        artifactId: artifact.id,
        artifactName: artifact.name,
        contextText: artifact.infoText,
        imageDataUrl: attachment?.dataUrl
      }, {
        onDelta: (_, fullText) => {
          streamedAnswer = fullText;
          setAskAnswer(fullText);
        }
      });
      const finalAnswer = answer.trim() ? answer : streamedAnswer;
      setAskAnswer(finalAnswer);
    } catch {
      setAskAnswer("AI 服务暂不可用，请稍后重试。后台连通后将自动恢复。");
    } finally {
      setIsAsking(false);
    }
  };

  const onPickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAttachError("");
    try {
      const packed = await fileToCompressedImageAttachment(file, { maxEdge: 1280, quality: 0.78 });
      if (packed.bytes > 1_800_000) {
        setAttachError("图片过大，请换一张或稍后重试。");
        setAttachment(null);
        return;
      }
      setAttachment(packed);
    } catch (error) {
      setAttachment(null);
      setAttachError(error instanceof Error ? error.message : "图片处理失败");
    }
  };

  const submitAsk = async (event: FormEvent) => {
    event.preventDefault();
    await askArtifactNow(askInput);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isAsking && askInput.trim()) {
        void askArtifactNow(askInput);
      }
    }
  };

  return (
    <AppShell title={artifact.name} subtitle={artifact.series} mainClassName="detail-main">
      <section className="panel artifact-hero">
        <ArtifactImage artifact={artifact} alt={artifact.name} loading="eager" sizes="(max-width: 720px) 92vw, 680px" />
        {fromPage ? (
          <div className="hero-actions">
            <Link className="btn ghost" to={`/pdf-reader?page=${fromPage}&artifactId=${artifact.id}`}>
              返回 PDF 第{fromPage}页
            </Link>
          </div>
        ) : null}
        <div className="hero-actions compact">
          <Link className="btn ghost" to={`/ai-guide?artifactId=${artifact.id}`}>
            打开 AI 展品问询
          </Link>
        </div>
      </section>

      <section className="tab-row">
        <button className={tab === "official" ? "tab active" : "tab"} onClick={() => setTab("official")}>官方介绍</button>
        <button className={tab === "book" ? "tab active" : "tab"} onClick={() => setTab("book")}>书籍摘录</button>
        <button className={tab === "pdf" ? "tab active" : "tab"} onClick={() => setTab("pdf")}>PDF索引</button>
      </section>

      {tab === "official" ? (
        <section className="panel prose-panel">
          {artifact.infoText ? <MarkdownContent content={artifact.infoText} /> : <p>暂无相关资料</p>}
        </section>
      ) : null}

      {tab === "book" ? (
        <section className="panel prose-panel">
          {artifact.linkedPdf.length ? (
            artifact.linkedPdf.map((page) => (
              <article key={page.page} className="linked-page">
                <h4>
                  第{page.page}页 {page.title ? `· ${page.title}` : ""}
                </h4>
                <div className="hero-actions compact">
                  <Link className="btn ghost" to={`/pdf-reader?page=${page.page}&artifactId=${artifact.id}`}>
                    打开此页
                  </Link>
                </div>
                {page.content ? <MarkdownContent content={page.content} /> : <p>（暂无文字内容）</p>}
              </article>
            ))
          ) : (
            <p>暂无相关资料</p>
          )}
        </section>
      ) : null}

      {tab === "pdf" ? (
        <section className="panel prose-panel">
          <p>关联页码：{artifact.pdfPages.length ? artifact.pdfPages.join("、") : "暂无"}</p>
          {artifact.pdfPages.length ? (
            <div className="pdf-page-links">
              {artifact.pdfPages.map((page) => (
                <Link key={page} className="pill" to={`/pdf-reader?page=${page}&artifactId=${artifact.id}`}>
                  第{page}页
                </Link>
              ))}
            </div>
          ) : null}
          <p>主题：{artifact.pdfTopic || "暂无"}</p>
          <div className="hero-actions">
            <Link
              className="btn primary"
              to={`/pdf-reader?page=${artifact.pdfPages[0] ?? 1}&artifactId=${artifact.id}`}
            >
              打开 PDF 阅读器
            </Link>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <header className="panel-title-row">
          <h3>即时问AI（当前展品）</h3>
          <Link to={`/ai-guide?artifactId=${artifact.id}`}>完整对话</Link>
        </header>
        <form className="composer" onSubmit={submitAsk}>
          <div className="attachment-row">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickImage}
              style={{ display: "none" }}
            />
            <input
              ref={albumInputRef}
              type="file"
              accept="image/*"
              onChange={onPickImage}
              style={{ display: "none" }}
            />

            <button type="button" className="btn ghost btn-small" onClick={() => cameraInputRef.current?.click()}>
              拍照
            </button>
            <button type="button" className="btn ghost btn-small" onClick={() => albumInputRef.current?.click()}>
              相册
            </button>

            {attachment ? (
              <div className="attachment-preview" title={`${attachment.name} · ${(attachment.bytes / 1024).toFixed(0)}KB`}>
                <img src={attachment.dataUrl} alt="已选图片预览" />
                <button type="button" className="attachment-remove" onClick={() => setAttachment(null)} aria-label="移除图片">
                  ×
                </button>
              </div>
            ) : null}

            {attachError ? <span className="attachment-error">{attachError}</span> : null}
          </div>

          <textarea
            rows={2}
            value={askInput}
            onChange={(event) => setAskInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={`例如：${artifact.name}里最值得注意的叙事细节是什么？`}
          />
          <p className="composer-tip">Enter 发送 · Shift+Enter 换行</p>
          <button className="btn primary" type="submit" disabled={isAsking}>
            {isAsking ? "AI 回答中..." : "立即提问"}
          </button>
        </form>
        {askAnswer ? (
          <div className="chat-panel inline-chat">
            <article className="bubble ai">
              <MarkdownContent content={askAnswer} />
            </article>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <header className="panel-title-row">
          <h3>同系列展品</h3>
          <Link to="/collection">更多</Link>
        </header>
        <div className="artifact-scroll">
          {related.map((item) => (
            <Link key={item.id} to={`/artifact/${item.id}`} className="artifact-chip">
              <div className="thumb-frame">
                <ArtifactImage artifact={item} alt={item.name} sizes="(max-width: 720px) 42vw, 180px" />
              </div>
              <h4>{item.name}</h4>
              <p>{item.series}</p>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
