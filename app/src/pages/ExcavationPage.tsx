import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ExcavationCanvas, type ExcavationCanvasHandle } from "@/components/ExcavationCanvas";
import { artifacts } from "@/data";
import { pickArtifactByWish } from "@/lib/openaiClient";
import type { Artifact } from "@/types/artifact";

interface ExcavationPageProps {
  discoveredSet: Set<string>;
  markDiscovered: (id: string) => void;
}

type ExcavationPhase = "pick" | "digging" | "revealed";

function pickRandom(pool: Artifact[]): Artifact | undefined {
  if (!pool.length) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}

function randomTapTarget(): number {
  return 4 + Math.floor(Math.random() * 3);
}

function chooseByWishHeuristic(wish: string, pool: Artifact[]): { id: string; reason: string } {
  const normalizedWish = wish.replace(/\s+/g, "");
  const scored = pool
    .map((item) => {
      const fields = [item.name, item.series, item.pdfTopic || "", ...item.tags];
      const score = fields.reduce((sum, field) => {
        const token = field.replace(/[（）()、，。\s]/g, "");
        if (!token || token.length < 2) return sum;
        return normalizedWish.includes(token) ? sum + token.length : sum;
      }, 0);
      return { id: item.id, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored[0] && scored[0].score > 0) {
    return { id: scored[0].id, reason: "本地关键词匹配成功" };
  }
  return { id: (pickRandom(pool) ?? pool[0]).id, reason: "未命中关键词，随机盲盒" };
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

export function ExcavationPage({ discoveredSet, markDiscovered }: ExcavationPageProps) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [phase, setPhase] = useState<ExcavationPhase>("pick");
  const [round, setRound] = useState(1);
  const [tapTarget, setTapTarget] = useState(randomTapTarget());
  const [tapCount, setTapCount] = useState(0);
  const [coverProgress, setCoverProgress] = useState(0);
  const [hint, setHint] = useState("先选一个盲盒目标，再开始下一轮发掘。");
  const [wishText, setWishText] = useState("");
  const [wishReason, setWishReason] = useState("");
  const [isPicking, setIsPicking] = useState(false);

  const canvasRef = useRef<ExcavationCanvasHandle | null>(null);
  const completedRef = useRef(false);
  const hasStartedRef = useRef(false);

  const pool = useMemo(
    () => artifacts.filter((item) => Boolean(item.modelImage) && !discoveredSet.has(item.id)),
    [discoveredSet]
  );
  const fallbackArtifact = useMemo(() => artifacts.find((item) => Boolean(item.modelImage)), []);
  const currentArtifact = useMemo(() => artifacts.find((item) => item.id === currentId), [currentId]);
  const remainingCount = pool.length;
  const seriesOptions = useMemo(
    () => Array.from(new Set(pool.map((item) => item.series))).filter(Boolean).slice(0, 6),
    [pool]
  );

  const startRound = useCallback(
    (artifact: Artifact, reason: string) => {
      setCurrentId(artifact.id);
      setPhase("digging");
      setTapCount(0);
      setTapTarget(randomTapTarget());
      setCoverProgress(0);
      setWishReason(reason);
      setHint("轻触土层 4-6 次，土块会随机击碎掉落。");
      completedRef.current = false;
      if (hasStartedRef.current) {
        setRound((prev) => prev + 1);
      } else {
        hasStartedRef.current = true;
      }
    },
    []
  );

  useEffect(() => {
    if (!pool.length) {
      if (!currentId) {
        const fallback = artifacts.find((item) => Boolean(item.modelImage)) ?? artifacts[0];
        if (fallback) {
          setCurrentId(fallback.id);
          setPhase("revealed");
          setHint("全部文物已发掘完毕，可回看已收纳展品。");
        }
      }
      return;
    }
  }, [currentId, pool.length]);

  const completeRound = useCallback(() => {
    if (!currentArtifact || completedRef.current) return;
    completedRef.current = true;
    markDiscovered(currentArtifact.id);
    setPhase("revealed");
    setHint("发掘完成，先欣赏成果，再决定是否进入详情。");
    canvasRef.current?.revealNow();
    vibrate([20, 30, 26]);
  }, [currentArtifact, markDiscovered]);

  useEffect(() => {
    if (phase !== "digging" || completedRef.current) return;
    if (tapCount >= tapTarget) completeRound();
  }, [completeRound, phase, tapCount, tapTarget]);

  useEffect(() => {
    if (phase !== "digging" || completedRef.current) return;
    if (coverProgress >= 95) completeRound();
  }, [completeRound, coverProgress, phase]);

  const onTapStep = useCallback((step: number) => {
    setTapCount(step);
    vibrate(12);
  }, []);

  const chooseBySeries = useCallback(
    (series: string) => {
      const candidates = pool.filter((item) => item.series === series);
      const next = pickRandom(candidates.length ? candidates : pool);
      if (!next) return;
      startRound(next, `${series}定向盲盒`);
    },
    [pool, startRound]
  );

  const chooseRandom = useCallback(() => {
    const next = pickRandom(pool);
    if (!next) return;
    startRound(next, "随机盲盒");
  }, [pool, startRound]);

  const chooseByWish = useCallback(async () => {
    const wish = wishText.trim();
    if (!wish) {
      setHint("先输入许愿关键词，再进行 AI 抽取。");
      return;
    }
    if (!pool.length) {
      setHint("暂无可发掘展品。");
      return;
    }

    setIsPicking(true);
    try {
      const picked = await pickArtifactByWish({
        wish,
        candidates: pool.map((item) => ({
          id: item.id,
          name: item.name,
          series: item.series,
          tags: item.tags,
          pdfTopic: item.pdfTopic
        }))
      });

      const next = pool.find((item) => item.id === picked.id) ?? pickRandom(pool);
      if (!next) return;
      startRound(next, `许愿“${wish}” · ${picked.reason}`);
      setHint("AI 已按许愿内容锁定目标，开始轻触发掘。");
    } catch {
      const fallback = chooseByWishHeuristic(wish, pool);
      const next = pool.find((item) => item.id === fallback.id) ?? pickRandom(pool);
      if (!next) return;
      startRound(next, `许愿“${wish}” · ${fallback.reason}`);
      setHint("AI 调用失败，已用本地规则锁定目标。");
    } finally {
      setIsPicking(false);
    }
  }, [pool, startRound, wishText]);

  const toPickPhase = useCallback(() => {
    if (!pool.length) {
      setHint("当前文物库已全部发掘完成。");
      return;
    }
    setPhase("pick");
    setCurrentId(null);
    setTapCount(0);
    setCoverProgress(0);
    setWishReason("");
    completedRef.current = false;
    setHint("请选择下一件：可随机盲盒，也可 AI 许愿抽取。");
  }, [pool.length]);

  if (!fallbackArtifact) {
    return (
      <AppShell title="模拟发掘" subtitle="暂无展品数据">
        <p>请先执行数据构建脚本生成展品数据。</p>
      </AppShell>
    );
  }

  const ritualProgress = phase === "digging" ? (tapCount / Math.max(1, tapTarget)) * 100 : 0;
  const displayProgress = phase === "revealed" ? 100 : Math.max(ritualProgress, coverProgress);
  const subtitle =
    phase === "pick"
      ? `第${round}轮盲盒 · 先选后挖`
      : phase === "revealed"
        ? `本轮成果：${currentArtifact?.name || "已发掘展品"}`
        : `第${round}轮盲盒 · 轻触 ${tapCount}/${tapTarget}`;

  return (
    <AppShell title="模拟发掘（单窗模式）" subtitle={subtitle} mainClassName="excavate-main">
      <section className="panel excavation-one-window">
        <div className="flow-steps">
          <span className={phase === "pick" ? "step active" : "step"}>1 先选</span>
          <span className={phase === "digging" ? "step active" : "step"}>2 再挖</span>
          <span className={phase === "revealed" ? "step active" : "step"}>3 最后欣赏</span>
        </div>

        <div className="progress-row">
          <span>发掘进度</span>
          <strong>{Math.round(displayProgress)}%</strong>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${displayProgress}%` }} />
        </div>

        <p className="hint-text">{hint}</p>
        <p className="hint-text">待发掘剩余：{remainingCount} 件</p>
        {wishReason ? <p className="wish-reason">{wishReason}</p> : null}

        {phase === "pick" ? (
          <div className="excavate-picker">
            <h3>选什么来挖？</h3>
            <p className="hint-text">每轮只发掘一件，建议先随机盲盒，再尝试 AI 许愿。</p>
            <div className="pick-grid">
              <button type="button" className="pill active" onClick={chooseRandom} disabled={isPicking}>
                随机盲盒
              </button>
              {seriesOptions.map((series) => (
                <button key={series} type="button" className="pill" onClick={() => chooseBySeries(series)} disabled={isPicking}>
                  {series}
                </button>
              ))}
            </div>

            <label>
              AI许愿抽取（可选）
              <input
                value={wishText}
                onChange={(event) => setWishText(event.target.value)}
                placeholder="例如：想看孔门弟子、刺秦、车骑出行"
              />
            </label>
            <div className="hero-actions compact">
              <button type="button" className="btn ghost" onClick={() => void chooseByWish()} disabled={isPicking}>
                {isPicking ? "AI 抽取中..." : "按许愿抽取"}
              </button>
            </div>
          </div>
        ) : null}

        {currentArtifact ? (
          <div className="excavate-stage-block">
            <ExcavationCanvas
              ref={canvasRef}
              imageUrl={currentArtifact.modelImage || ""}
              artifactName={currentArtifact.name}
              phase={phase === "pick" ? "ready" : phase}
              clickTarget={tapTarget}
              onTapStep={onTapStep}
              onRevealChange={setCoverProgress}
            />
          </div>
        ) : null}

        {phase === "digging" && currentArtifact ? (
          <div className="excavate-footer">
            <strong>当前目标：{currentArtifact.name}</strong>
            <span>
              轻触进度 {tapCount}/{tapTarget}
            </span>
          </div>
        ) : null}

        {phase === "revealed" && currentArtifact ? (
          <div className="reveal-panel">
            <h3>亮相完成：{currentArtifact.name}</h3>
            <p>石刻已完整显露。可以先欣赏，再进入详情查看文献与 AI 导览。</p>
            <div className="hero-actions">
              <Link className="btn primary" to={`/artifact/${currentArtifact.id}`}>
                查看并收纳文物
              </Link>
              <button type="button" className="btn ghost" onClick={toPickPhase}>
                继续下一件
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
