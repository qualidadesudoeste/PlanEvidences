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
  qaPlanId?: string | null;
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

// Contratos da corretiva ficam independentes da UI e já carregam os vínculos
// necessários para uma futura publicação direta no SIG.
export interface CorrectiveCardContext {
  hu: string;
  screenPath: string;
  screenUrl?: string;
  sigCardCode?: string | null;
  projectName?: string | null;
  sprintName?: string | null;
  evidenceProjectId?: string | null;
  qaPlanId?: string | null;
  scenarioId?: string | null;
  scenarioCode?: string | null;
  scenarioTitle?: string | null;
  scenarioBdd?: string | null;
  evidenceDescription?: string | null;
  caseId?: string | null;
  evidenceImageKeys?: string[];
}

export interface CorrectiveCardDraft {
  title: string;
  problemDescription: string;
  reproductionSteps: string[];
  currentResult: string;
  expectedResult: string;
}

export interface GenerateCorrectiveCardInput extends CorrectiveCardContext {
  errorDescription: string;
}

/** Porta preparada para uma futura implementação de cadastro direto no SIG. */
export interface CorrectiveCardPublisher {
  publish(
    card: CorrectiveCardDraft,
    context: CorrectiveCardContext,
    requestId: string
  ): Promise<PublishedCorrectiveCard>;
}

export interface PublishedCorrectiveCard {
  externalId: string;
  url: string;
  originCardId: string;
  project: { id: string; name: string };
  sprint: { id: string; name: string };
  activity: { id: string; name: string };
}

export function scenarioCode(index: number): string {
  return `CT-${String(index + 1).padStart(3, '0')}`;
}

// ---------- QA Assistant (gerador de casos a partir de HU) ----------

export type QAProvider = 'anthropic' | 'openai' | 'gemini';
export type QACriticidade = 'alta' | 'media' | 'baixa';
export type QATipoSistema = 'web' | 'mobile' | 'desktop' | 'api' | 'ia';

export interface QACardCenario {
  numero: number;
  titulo: string;
  dado: string;
  quando: string;
  entao: string;
}

export interface QACard {
  codigo: string | null;
  resumo: string;
  caminho?: string | null;
  categoria?: string | null;
  descricaoInicial?: string | null;
  cenarios?: QACardCenario[];
  criterios?: string[];
}

export interface QACase {
  id: string;
  titulo: string;
  tipo?: string;
  prioridade?: QACriticidade;
  preCondicoes?: string[];
  passos?: string[];
  resultadoEsperado?: string;
  dadosTeste?: string;
}

export interface QACardComCasos {
  codigo: string;
  resumo: string;
  caminho?: string | null;
  casos: QACase[];
}

export interface QAAnaliseGlobal {
  qualidade?: QACriticidade;
  ambiguidades?: string[];
  gapsIdentificados?: string[];
  riscosDominio?: Array<{ nivel: string; descricao: string }>;
  recomendacoes?: string[];
}

export interface QAAnaliseResult {
  cards: QACardComCasos[];
  analiseGlobal?: QAAnaliseGlobal;
}

export interface QAServerStatus {
  serverConfigured: boolean;
  providers: { anthropic: boolean; openai: boolean; gemini: boolean };
  defaultProvider: QAProvider | null;
}

export interface QAAIConfig {
  provider: QAProvider;
  model: string;
  apiKey: string;
}
