import { Link } from "react-router-dom";
import type { AnswerCitation } from "@/lib/openaiClient";

interface AnswerCitationListProps {
  items: AnswerCitation[];
}

const SOURCE_LABEL: Record<AnswerCitation["sourceType"], string> = {
  artifact: "展品资料",
  pdf: "书籍/PDF",
  museum: "馆藏信息",
  web: "联网资料"
};

export function AnswerCitationList({ items }: AnswerCitationListProps) {
  if (!items.length) return null;

  return (
    <div className="citation-list">
      <h6>回答依据</h6>
      {items.map((item, index) => (
        <article key={`${item.title}-${index}`} className="citation-item">
          <div className="citation-head">
            <span className="citation-source">{SOURCE_LABEL[item.sourceType]}</span>
            {item.artifactId ? (
              <Link to={`/artifact/${item.artifactId}`} className="citation-link">
                查看展品
              </Link>
            ) : null}
          </div>
          <p className="citation-title">{item.title}</p>
          <p className="citation-snippet">{item.snippet}</p>
        </article>
      ))}
    </div>
  );
}
