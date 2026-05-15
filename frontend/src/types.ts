export interface UploadedImage {
  id: string;
  originalName: string;
  filename: string;
  key: string;
  url: string;
  size: number;
}

export interface Scenario {
  id: string;
  title: string;
  bdd: string;
  evidence: string;
  images: UploadedImage[];
}

export interface Project {
  projectName: string;
  sprintName: string;
  version: string;
  redator: string;
  clientName: string;
  sprintObjective: string;
  testScope: string;
  scenarios: Scenario[];
}

export interface GeneratedDoc {
  id: string;
  createdAt: string;
  projectName: string;
  clientName: string;
  sprintName: string;
  version: string;
  redator: string;
  tex: string;
  pdf: string | null;
  pdfError: string | null;
  baseName: string;
}

export function scenarioCode(index: number): string {
  return `CT-${String(index + 1).padStart(3, '0')}`;
}
