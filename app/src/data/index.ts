import dataset from "@/data/artifacts.json";
import type { Artifact, ArtifactDataset } from "@/types/artifact";

const artifactDataset = dataset as ArtifactDataset;

export const artifacts = artifactDataset.artifacts;

export function getArtifactById(id: string): Artifact | undefined {
  return artifacts.find((item) => item.id === id);
}

export function getDatasetMeta(): Pick<ArtifactDataset, "generatedAt" | "totalArtifacts" | "pdfSource" | "pdfTotalPages"> {
  return {
    generatedAt: artifactDataset.generatedAt,
    totalArtifacts: artifactDataset.totalArtifacts,
    pdfSource: artifactDataset.pdfSource,
    pdfTotalPages: artifactDataset.pdfTotalPages
  };
}
