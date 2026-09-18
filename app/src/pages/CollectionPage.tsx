import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ArtifactImage } from "@/components/ArtifactImage";
import { AppShell } from "@/components/AppShell";
import { artifacts } from "@/data";

interface CollectionPageProps {
  discoveredSet: Set<string>;
}

const FILTERS = [
  "全部",
  "武氏墓群",
  "济宁市博",
  "巨野县博",
  "仅已发掘",
  "武梁祠系列",
  "前石室系列",
  "后石室系列",
  "左石室系列",
  "其他石刻系列"
];

export function CollectionPage({ discoveredSet }: CollectionPageProps) {
  const [filter, setFilter] = useState("全部");
  const gridRef = useRef<HTMLDivElement | null>(null);

  const list = useMemo(() => {
    if (filter === "全部") return artifacts;
    if (filter === "仅已发掘") return artifacts.filter((item) => discoveredSet.has(item.id));
    if (filter === "武氏墓群") return artifacts.filter((item) => item.museum?.includes("武氏"));
    if (filter === "济宁市博") return artifacts.filter((item) => item.museum?.includes("济宁"));
    if (filter === "巨野县博") return artifacts.filter((item) => item.museum?.includes("巨野"));
    return artifacts.filter((item) => item.series === filter || item.series.includes(filter));
  }, [filter, discoveredSet]);

  useGSAP(() => {
    if (!gridRef.current) return;
    const cards = gridRef.current.querySelectorAll(".artifact-card");
    if (!cards.length) return;
    gsap.fromTo(
      cards,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.35, stagger: 0.025, ease: "power1.out", clearProps: "all" }
    );
  }, { scope: gridRef, dependencies: [filter] });

  return (
    <AppShell title="文物库" subtitle="三馆展品 · 按博物馆与系列分类浏览" mainClassName="collection-main">
      <section className="filter-row">
        {FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === filter ? "pill active" : "pill"}
            onClick={() => setFilter(name)}
          >
            {name}
          </button>
        ))}
      </section>

      <section ref={gridRef} className="artifact-grid">
        {list.map((item) => (
          <Link key={item.id} to={`/artifact/${item.id}`} className="artifact-card">
            <div className="thumb-frame">
              <ArtifactImage artifact={item} alt={item.name} sizes="(max-width: 720px) 42vw, 220px" />
            </div>
            <div className="card-meta">
              <h3>{item.name}</h3>
              <p>{item.museum ? `${item.museum} · ${item.series}` : item.series}</p>
              <small>{discoveredSet.has(item.id) ? "已发掘" : "未发掘"}</small>
            </div>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
