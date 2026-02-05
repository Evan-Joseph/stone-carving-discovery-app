import type { ImgHTMLAttributes } from "react";
import type { Artifact } from "@/types/artifact";

interface ArtifactImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> {
  artifact: Artifact;
  alt: string;
  sizes?: string;
}

function buildWebpSrcSet(artifact: Artifact): string {
  const entries: string[] = [];
  if (artifact.modelImageThumb) entries.push(`${artifact.modelImageThumb} 320w`);
  if (artifact.modelImageLarge) entries.push(`${artifact.modelImageLarge} 720w`);
  return entries.join(", ");
}

export function ArtifactImage({ artifact, alt, sizes, loading = "lazy", ...rest }: ArtifactImageProps) {
  const fallbackSrc = artifact.modelImage || artifact.modelImageLarge || artifact.modelImageThumb || "";
  if (!fallbackSrc) return null;

  const webpSrcSet = buildWebpSrcSet(artifact);

  return (
    <picture>
      {webpSrcSet ? <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} /> : null}
      <img src={fallbackSrc} alt={alt} loading={loading} decoding="async" {...rest} />
    </picture>
  );
}
