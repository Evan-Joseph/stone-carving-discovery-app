import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { ArtifactImage } from "@/components/ArtifactImage";
import { artifacts, getDatasetMeta } from "@/data";

interface HomePageProps {
  discoveredCount: number;
}

export function HomePage({ discoveredCount }: HomePageProps) {
  const featured = artifacts.slice(0, 6);
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

  return (
    <AppShell title="石刻文化发现" subtitle="沉浸式发掘 · 文物库 · AI导游" mainClassName="home-main">
      <section className="hero-card">
        <p className="eyebrow">武氏墓群石刻博物馆</p>
        <h2>先发掘，再理解石刻里的历史叙事</h2>
        <p>基于展品抠图、馆方信息图、鲁迅《藏汉画珍赏》节选与双向索引构建。</p>
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
          <span>可浏览展品</span>
        </article>
        <article>
          <strong>{discoveredCount}</strong>
          <span>已发掘展品</span>
        </article>
        <article>
          <strong>{meta.generatedAt ? new Date(meta.generatedAt).toLocaleDateString("zh-CN") : "-"}</strong>
          <span>数据更新时间</span>
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
    </AppShell>
  );
}
