export interface LinkedPdf {
  page: number;
  title?: string;
  content?: string;
}

export interface Artifact {
  id: string;
  name: string;
  series: string;
  modelImage?: string;
  modelImageThumb?: string;
  modelImageLarge?: string;
  infoImage?: string;
  infoText?: string;
  pdfPages: number[];
  pdfTopic?: string;
  linkedPdf: LinkedPdf[];
  tags: string[];
}

export interface ArtifactDataset {
  generatedAt: string;
  totalArtifacts: number;
  pdfSource: string;
  pdfTotalPages: number;
  artifacts: Artifact[];
}
