import { FormEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { AppShell } from "@/components/AppShell";
import { ArtifactImage } from "@/components/ArtifactImage";
import { artifacts, getDatasetMeta } from "@/data";

interface HomePageProps {
  discoveredCount: number;
}

export function HomePage({ discoveredCount }: HomePageProps) {
  const navigate = useNavigate();
  const featured = artifacts.slice(0, 6);
  const [quickAsk, setQuickAsk] = useState("");
  const mainRef = useRef<HTMLDivElement | null>(null);

  useGSAP(() => {
    if (!mainRef.current) return;
    gsap.from(mainRef.current.querySelectorAll(".hero-card, .home-spotlight, .stats-grid, .panel"), {
      opacity: 0,
      y: 20,
      duration: 0.6,
      stagger: 0.1,
      ease: "power2.out",
      clearProps: "all"
    });
  }, { scope: mainRef });

  const meta = getDatasetMeta();
  const spotlight = useMemo(
    () => artifacts.find((item) => item.modelImage && item.infoText) || artifacts.find((item) => item.modelImage),
    []
  );
  const spotlightSummary = useMemo(() => {
    const raw = spotlight?.infoText || "";
    const plain = raw
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^>\s?/gm, "")
      .replace(/\*\*/g, "")
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) return "从石刻纹饰、人物故事到时代线索，进入详情可继续深读。";
    return plain.slice(0, 74) + (plain.length > 74 ? "..." : "");
  }, [spotlight?.infoText]);

  const submitQuickAsk = (event: FormEvent) => {
    event.preventDefault();
    const question = quickAsk.trim();
    if (!question) return;
    navigate(`/ai-guide?q=${encodeURIComponent(question)}`);
  };

  const quickAskTemplates = [
    "第一次来馆里，先看哪几件最容易看懂？",
    "汉代石刻里常见的叙事主题有哪些？",
    "拍照后你能帮我识别并讲解吗？"
  ];

  return (
    <AppShell title="石刻文化发现" subtitle="沉浸式发掘 · 文物库 · AI导游" mainClassName="home-main">
      <div ref={mainRef} style={{ display: "contents" }}>
        <section className="hero-card">
        <p className="eyebrow">鲁西南汉画像石数字展厅 · 三馆汇聚</p>
        <h2>先发掘，再理解石刻里的历史叙事</h2>
        <p>汇集嘉祥武氏墓群石刻博物馆、济宁市博物馆、巨野县博物馆汉代石刻艺术珍品。</p>
        <div className="hero-actions">
          <Link className="btn primary" to="/excavate">
            开始发掘
          </Link>
          <Link className="btn ghost" to="/collection">
            查看文物库
          </Link>
          <Link className="btn ghost" to="/hall">
            展厅模式
          </Link>
        </div>

        <form className="home-ai-entry" onSubmit={submitQuickAsk}>
          <label htmlFor="home-ai-question">先问一句再进入 AI 导游</label>
          <div className="home-ai-entry-row">
            <input
              id="home-ai-question"
              value={quickAsk}
              onChange={(event) => setQuickAsk(event.target.value)}
              placeholder="例如：先看哪几件最容易理解？"
            />
            <button className="btn primary" type="submit" disabled={!quickAsk.trim()}>
              一步发问
            </button>
          </div>
          <div className="home-ai-suggestions">
            {quickAskTemplates.map((item) => (
              <button key={item} type="button" className="pill" onClick={() => setQuickAsk(item)}>
                {item}
              </button>
            ))}
          </div>
        </form>
      </section>

      {spotlight ? (
        <section className="panel home-spotlight">
          <header className="panel-title-row">
            <h3>今日推荐</h3>
            <Link to={`/artifact/${spotlight.id}`}>查看详情</Link>
          </header>
          <Link className="home-spotlight-card" to={`/artifact/${spotlight.id}`}>
            <div className="thumb-frame home-spotlight-image">
              <ArtifactImage artifact={spotlight} alt={spotlight.name} loading="eager" sizes="(max-width: 720px) 88vw, 50vw" />
            </div>
            <div className="home-spotlight-meta">
              <h4>{spotlight.name}</h4>
              <p>{spotlight.series}</p>
              <small>{spotlightSummary}</small>
            </div>
          </Link>
        </section>
      ) : null}

      <section className="stats-grid">
        <article>
          <strong>{meta.totalArtifacts}</strong>
          <span>馆藏珍品（3大博物馆）</span>
        </article>
        <article>
          <strong>{discoveredCount}</strong>
          <span>已发掘展品</span>
        </article>
        <article>
          <strong>3 处</strong>
          <span>研学文博场馆</span>
        </article>
      </section>

      <section className="panel">
        <header className="panel-title-row">
          <h3>精选展品</h3>
          <Link to="/collection">全部</Link>
        </header>
        <div className="artifact-scroll">
          {featured.map((item) => (
            <Link key={item.id} to={`/artifact/${item.id}`} className="artifact-chip">
              <div className="thumb-frame">
                <ArtifactImage artifact={item} alt={item.name} sizes="(max-width: 720px) 40vw, 180px" />
              </div>
              <h4>{item.name}</h4>
              <p>{item.series}</p>
            </Link>
          ))}
        </div>
      </section>
      </div>
    </AppShell>
  );
}
