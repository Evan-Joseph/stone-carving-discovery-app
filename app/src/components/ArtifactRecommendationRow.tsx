import { Link } from "react-router-dom";
import { ArtifactImage } from "@/components/ArtifactImage";
import { getArtifactById } from "@/data";
import { getArtifactSummary, type ArtifactRecommendation } from "@/lib/artifactRecommend";

interface ArtifactRecommendationRowProps {
  items: ArtifactRecommendation[];
}

export function ArtifactRecommendationRow({ items }: ArtifactRecommendationRowProps) {
  const resolved = items
    .map((item) => ({ item, artifact: getArtifactById(item.id) }))
    .filter((entry): entry is { item: ArtifactRecommendation; artifact: NonNullable<ReturnType<typeof getArtifactById>> } =>
      Boolean(entry.artifact)
    );

  if (!resolved.length) return null;

  return (
    <div className="chat-artifact-grid">
      {resolved.map(({ item, artifact }) => (
        <Link key={artifact.id} className="chat-artifact-card" to={`/artifact/${artifact.id}`}>
          <div className="thumb-frame chat-artifact-thumb">
            <ArtifactImage artifact={artifact} alt={artifact.name} sizes="(max-width: 720px) 38vw, 148px" />
          </div>
          <h5>{artifact.name}</h5>
          <p>{getArtifactSummary(artifact.infoText || "", 56)}</p>
          <small>{item.reason}</small>
        </Link>
      ))}
    </div>
  );
}
