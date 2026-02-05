import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ArtifactImage } from "@/components/ArtifactImage";
import { artifacts, getArtifactById, getDatasetMeta } from "@/data";

type PdfJsApi = typeof import("pdfjs-dist/legacy/build/pdf.min.mjs");
type PDFDocumentProxy = import("pdfjs-dist/types/src/display/api").PDFDocumentProxy;

let pdfJsLoader: Promise<PdfJsApi> | null = null;

async function loadPdfJsApi(): Promise<PdfJsApi> {
  if (pdfJsLoader) return pdfJsLoader;

  pdfJsLoader = Promise.all([
    import("pdfjs-dist/legacy/build/pdf.min.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });

  return pdfJsLoader;
}

function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(total, Math.max(1, Math.round(page)));
}

function isValidPdfSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && normalized !== "null" && normalized !== "undefined";
}

export function PdfReaderPage() {
  const meta = getDatasetMeta();
  const initialTotalPages = Math.max(1, meta.pdfTotalPages || 1);
  const pdfSource = isValidPdfSource(meta.pdfSource) ? meta.pdfSource : "";
  const [searchParams, setSearchParams] = useSearchParams();

  const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
  const [pdfApi, setPdfApi] = useState<PdfJsApi | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const totalPages = pdfDoc?.numPages ? Math.max(1, pdfDoc.numPages) : initialTotalPages;
  const activePage = clampPage(rawPage, totalPages);
  const artifactId = searchParams.get("artifactId") || "";
  const selectedArtifact = artifactId ? getArtifactById(artifactId) : undefined;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [docState, setDocState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [renderError, setRenderError] = useState("");

  const [pageInput, setPageInput] = useState(String(activePage));
  useEffect(() => {
    setPageInput(String(activePage));
  }, [activePage]);

  const relatedArtifacts = useMemo(
    () => artifacts.filter((item) => item.pdfPages.includes(activePage)),
    [activePage]
  );

  const pdfPageUrl = pdfSource ? `${pdfSource}#page=${activePage}&view=FitH` : "";

  useEffect(() => {
    let cancelled = false;
    loadPdfJsApi()
      .then((api) => {
        if (cancelled) return;
        setPdfApi(api);
      })
      .catch((error) => {
        if (cancelled) return;
        setDocState("error");
        setRenderState("error");
        setRenderError(error instanceof Error ? error.message : "PDF 预览引擎加载失败。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pdfSource) {
      setPdfDoc(null);
      setDocState("error");
      setRenderState("error");
      setRenderError("未找到 PDF 文件路径，请检查数据构建结果。");
      return;
    }
    if (!pdfApi) {
      setDocState("loading");
      return;
    }

    let cancelled = false;
    const loadingTask = pdfApi.getDocument({
      url: pdfSource,
      disableRange: false,
      disableStream: false,
      disableAutoFetch: false
    });

    setDocState("loading");
    setRenderState("idle");
    setRenderError("");

    loadingTask.promise
      .then((doc: PDFDocumentProxy) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        setPdfDoc(doc);
        setDocState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPdfDoc(null);
        setDocState("error");
        setRenderState("error");
        setRenderError(error instanceof Error ? error.message : "PDF 加载失败，请尝试新窗口打开。");
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [pdfApi, pdfSource]);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        void pdfDoc.destroy();
      }
    };
  }, [pdfDoc]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateWidth = () => {
      setFrameWidth(Math.max(0, frame.clientWidth));
    };
    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pdfDoc || !frameWidth) return;

    let cancelled = false;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      setRenderState("error");
      setRenderError("浏览器不支持 Canvas 渲染。");
      return;
    }

    setRenderState("loading");
    setRenderError("");

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const render = async () => {
      try {
        const page = await pdfDoc.getPage(activePage);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = Math.max(220, frameWidth - 24);
        const cssScale = targetWidth / baseViewport.width;
        const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        const viewport = page.getViewport({ scale: cssScale * dpr });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);

        const task = page.render({
          canvas,
          canvasContext: context,
          viewport
        });
        renderTaskRef.current = task as unknown as { cancel: () => void };
        await task.promise;
        renderTaskRef.current = null;

        if (cancelled) return;
        setRenderState("ready");

        const nextPage = activePage + 1;
        if (nextPage <= totalPages) {
          void pdfDoc.getPage(nextPage).catch(() => undefined);
        }
      } catch (error) {
        if (cancelled) return;
        const name = (error as { name?: string }).name;
        if (name === "RenderingCancelledException") return;

        setRenderState("error");
        setRenderError(error instanceof Error ? error.message : "PDF 页面渲染失败，请尝试新窗口打开。");
      }
    };

    void render();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [activePage, frameWidth, pdfDoc, totalPages]);

  const jumpTo = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(clampPage(page, totalPages)));
    setSearchParams(next, { replace: true });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    jumpTo(Number.parseInt(pageInput || "1", 10));
  };

  return (
    <AppShell
      title="PDF原文阅读"
      subtitle={`《鲁迅藏汉画珍赏》 · 第${activePage}/${totalPages}页`}
      mainClassName="pdf-main"
    >
      <section className="panel pdf-toolbar">
        <div className="pdf-toolbar-row">
          <button type="button" className="btn ghost" onClick={() => jumpTo(activePage - 1)} disabled={activePage <= 1}>
            上一页
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => jumpTo(activePage + 1)}
            disabled={activePage >= totalPages}
          >
            下一页
          </button>
          {pdfPageUrl ? (
            <a className="btn ghost" href={pdfPageUrl} target="_blank" rel="noreferrer">
              新窗口打开
            </a>
          ) : null}
        </div>

        <form className="pdf-jump-form" onSubmit={onSubmit}>
          <label>
            跳转页码
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
            />
          </label>
          <button className="btn primary" type="submit">
            跳转
          </button>
        </form>

        <p className="note">
          {selectedArtifact
            ? `当前从展品「${selectedArtifact.name}」进入，可在右侧反向跳回展品详情。`
            : "可从任意展品详情页跳转到对应 PDF 页。"}
        </p>
      </section>

      <section className="pdf-layout">
        <section className="panel pdf-frame-panel">
          <div ref={frameRef} className="pdf-frame">
            <canvas ref={canvasRef} className={renderState === "ready" ? "pdf-canvas ready" : "pdf-canvas"} />
            {docState === "loading" || renderState === "loading" ? (
              <div className="pdf-render-state">PDF 加载中...</div>
            ) : null}
            {renderState === "error" ? (
              <div className="pdf-render-state error">预览失败：{renderError || "请尝试新窗口打开。"}</div>
            ) : null}
          </div>
          {renderState === "error" && pdfPageUrl ? (
            <p className="note">
              当前设备可能不支持内嵌预览，可使用「新窗口打开」查看原始 PDF。
            </p>
          ) : null}
        </section>

        <section className="panel pdf-side-panel">
          <h3>第{activePage}页关联展品</h3>
          {relatedArtifacts.length ? (
            <div className="pdf-related-list">
              {relatedArtifacts.map((item) => (
                <article
                  key={item.id}
                  className={item.id === artifactId ? "pdf-related-card active" : "pdf-related-card"}
                >
                  <div className="thumb-frame thumb-small">
                    <ArtifactImage artifact={item} alt={item.name} sizes="90px" />
                  </div>
                  <div className="pdf-related-meta">
                    <h4>{item.name}</h4>
                    <p>{item.series}</p>
                    <div className="hero-actions">
                      <Link className="btn primary" to={`/artifact/${item.id}?fromPage=${activePage}`}>
                        查看展品
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p>本页暂无直接映射展品，可继续翻页或搜索相关主题。</p>
          )}
        </section>
      </section>
    </AppShell>
  );
}
