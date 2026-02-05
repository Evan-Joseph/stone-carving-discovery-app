import { Fragment } from "react";
import { Link } from "react-router-dom";
import { ArtifactImage } from "@/components/ArtifactImage";
import { getArtifactById } from "@/data";
import { getArtifactSummary } from "@/lib/artifactRecommend";

interface MarkdownContentProps {
  content: string;
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "quote"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "artifact"; artifactId: string; note?: string }
  | { type: "code"; text: string; lang: string }
  | { type: "hr" }
  | { type: "p"; text: string };

function parseMarkdown(content: string): Block[] {
  const lines = content.split(/\r?\n/);
  const blocks: Block[] = [];

  let index = 0;
  while (index < lines.length) {
    const raw = lines[index];
    const line = raw.trim();

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: "heading", level, text: headingMatch[2].trim() });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n").trim() });
      continue;
    }

    if (line.startsWith("```") || line.startsWith("~~~")) {
      const fence = line.startsWith("~~~") ? "~~~" : "```";
      const lang = line.replace(new RegExp(`^${fence}`), "").trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && lines[index].trim().startsWith(fence)) {
        index += 1;
      }
      blocks.push({ type: "code", text: codeLines.join("\n"), lang });
      continue;
    }

    const artifactMatch = line.match(/^\[展品卡片:(artifact-[a-zA-Z0-9_-]+)(?:\|(.+))?]$/);
    if (artifactMatch) {
      blocks.push({
        type: "artifact",
        artifactId: artifactMatch[1],
        note: artifactMatch[2]?.trim()
      });
      index += 1;
      continue;
    }

    const tableSeparator = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
    if (line.includes("|") && index + 1 < lines.length && tableSeparator.test(lines[index + 1].trim())) {
      const normalizeCells = (rawLine: string) =>
        rawLine
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());

      const header = normalizeCells(lines[index]);
      index += 2;
      const rows: string[][] = [];

      while (index < lines.length) {
        const current = lines[index].trim();
        if (!current || !current.includes("|")) break;
        rows.push(normalizeCells(lines[index]));
        index += 1;
      }

      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\s*[-*+]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\s*\d+[.)]\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        /^(#{1,6})\s+/.test(current) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(current) ||
        current.startsWith(">") ||
        current.startsWith("```") ||
        current.startsWith("~~~") ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current) ||
        /^\[展品卡片:(artifact-[a-zA-Z0-9_-]+)(?:\|(.+))?]$/.test(current) ||
        (current.includes("|") && index + 1 < lines.length && tableSeparator.test(lines[index + 1].trim()))
      ) {
        break;
      }
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "p", text: paragraphLines.join("\n").trim() });
  }

  return blocks;
}

function renderInline(text: string) {
  const tokens: React.ReactNode[] = [];
  const pattern =
    /(!\[[^\]]*]\(([^)]+)\))|(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(~~[^~]+~~)|(\[([^\]]+)\]\(([^)]+)\))|(https?:\/\/[^\s<]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(<Fragment key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }

    const matched = match[0];
    if (matched.startsWith("![")) {
      const imageAltMatch = matched.match(/^!\[([^\]]*)]/);
      const alt = imageAltMatch?.[1] || "image";
      const rawLink = (match[2] || "").split(/\s+/)[0].trim();
      if (rawLink && !isInvalidUrlToken(rawLink)) {
        tokens.push(<img key={`img-${match.index}`} src={rawLink} alt={alt} loading="lazy" />);
      } else {
        tokens.push(<Fragment key={`img-t-${match.index}`}>{matched}</Fragment>);
      }
    } else if (matched.startsWith("`") && matched.endsWith("`")) {
      tokens.push(<code key={`c-${match.index}`}>{matched.slice(1, -1)}</code>);
    } else if (
      (matched.startsWith("**") && matched.endsWith("**")) ||
      (matched.startsWith("__") && matched.endsWith("__"))
    ) {
      tokens.push(<strong key={`b-${match.index}`}>{matched.slice(2, -2)}</strong>);
    } else if ((matched.startsWith("*") && matched.endsWith("*")) || (matched.startsWith("_") && matched.endsWith("_"))) {
      tokens.push(<em key={`i-${match.index}`}>{matched.slice(1, -1)}</em>);
    } else if (matched.startsWith("~~") && matched.endsWith("~~")) {
      tokens.push(<del key={`d-${match.index}`}>{matched.slice(2, -2)}</del>);
    } else if (matched.startsWith("[")) {
      const label = match[8] || matched;
      const rawLink = match[9] || "";
      const href = rawLink.split(/\s+/)[0].trim();
      if (!href || isInvalidUrlToken(href)) {
        tokens.push(<Fragment key={`a-t-${match.index}`}>{label}</Fragment>);
        lastIndex = pattern.lastIndex;
        continue;
      }
      const external = /^https?:\/\//i.test(href);
      tokens.push(
        <a key={`a-${match.index}`} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
          {label}
        </a>
      );
    } else if (/^https?:\/\//i.test(matched)) {
      const href = matched.trim();
      tokens.push(
        <a key={`u-${match.index}`} href={href} target="_blank" rel="noreferrer">
          {href}
        </a>
      );
    } else {
      tokens.push(<Fragment key={`fallback-${match.index}`}>{matched}</Fragment>);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(<Fragment key={`tail-${lastIndex}`}>{text.slice(lastIndex)}</Fragment>);
  }

  return tokens;
}

function isInvalidUrlToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  return token === "null" || token === "undefined";
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const blocks = parseMarkdown(content);

  return (
    <div className="markdown-content">
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          if (block.level <= 2) return <h2 key={idx}>{renderInline(block.text)}</h2>;
          return <h3 key={idx}>{renderInline(block.text)}</h3>;
        }
        if (block.type === "quote") return <blockquote key={idx}>{renderInline(block.text)}</blockquote>;
        if (block.type === "ul") {
          return (
            <ul key={idx}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={idx}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === "table") {
          return (
            <table key={idx}>
              <thead>
                <tr>
                  {block.header.map((cell, headerIndex) => (
                    <th key={headerIndex}>{renderInline(cell)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (block.type === "artifact") {
          const artifact = getArtifactById(block.artifactId);
          if (!artifact) {
            return <p key={idx}>（未找到展品：{block.artifactId}）</p>;
          }
          return (
            <Link key={idx} className="chat-artifact-card inline-artifact-card" to={`/artifact/${artifact.id}`}>
              <div className="thumb-frame chat-artifact-thumb">
                <ArtifactImage artifact={artifact} alt={artifact.name} sizes="(max-width: 720px) 46vw, 180px" />
              </div>
              <h5>{artifact.name}</h5>
              <p>{getArtifactSummary(artifact.infoText || "", 64)}</p>
              <small>{block.note || `${artifact.series} · 点击查看详情`}</small>
            </Link>
          );
        }
        if (block.type === "code") return <pre key={idx}><code className={block.lang ? `lang-${block.lang}` : undefined}>{block.text}</code></pre>;
        if (block.type === "hr") return <hr key={idx} />;
        return <p key={idx}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
