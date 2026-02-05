import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArtifactImage } from "@/components/ArtifactImage";
import { AppShell } from "@/components/AppShell";
import { artifacts } from "@/data";

interface CollectionPageProps {
  discoveredSet: Set<string>;
}

const FILTERS = ["全部", "仅已发掘", "武梁祠系列", "前石室系列", "后石室系列", "左石室系列", "其他石刻系列"];

export function CollectionPage({ discoveredSet }: CollectionPageProps) {
  const [filter, setFilter] = useState("全部");

  const list = useMemo(() => {
    if (filter === "全部") return artifacts;
    if (filter === "仅已发掘") return artifacts.filter((item) => discoveredSet.has(item.id));
    return artifacts.filter((item) => item.series === filter);
  }, [filter, discoveredSet]);

  return (
    <AppShell title="文物库" subtitle="按发掘进度与展区浏览" mainClassName="collection-main">
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

      <section className="artifact-grid">
        {list.map((item) => (
          <Link key={item.id} to={`/artifact/${item.id}`} className="artifact-card">
            <div className="thumb-frame">
              <ArtifactImage artifact={item} alt={item.name} sizes="(max-width: 720px) 42vw, 220px" />
            </div>
            <div className="card-meta">
              <h3>{item.name}</h3>
              <p>{item.series}</p>
              <small>{discoveredSet.has(item.id) ? "已发掘" : "未发掘"}</small>
            </div>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
