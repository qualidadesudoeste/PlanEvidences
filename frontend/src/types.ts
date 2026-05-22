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
  // Metadados do card/HU de origem (vindos do QA Assistant). Quando presentes,
  // os cenários são agrupados por card na UI e no PDF gerado.
  cardCodigo?: string | null;
  cardResumo?: string | null;
  cardCaminho?: string | null;
  caseId?: string | null;
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
  // Indica que o documento tem project_json salvo (gerado após a feature de
  // reabertura). Documentos antigos vêm com hasProject=false e o botão "Abrir
  // no editor" fica desabilitado.
  hasProject?: boolean;
}

export function scenarioCode(index: number): string {
  return `CT-${String(index + 1).padStart(3, '0')}`;
}
