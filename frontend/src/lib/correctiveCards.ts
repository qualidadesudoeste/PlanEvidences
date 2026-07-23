import type {
  CorrectiveCardDraft,
  CorrectiveCardContext,
  GenerateCorrectiveCardInput,
  PublishedCorrectiveCard,
  QAAIConfig,
  QAServerStatus,
} from '@/types';
import { carregarConfigIA } from '@/lib/qa/aiConfig';
import { buscarStatusServidor } from '@/lib/qa/aiClient';

interface BugCardResponse {
  ok: boolean;
  error?: string;
  card?: CorrectiveCardDraft;
}

interface SigPublicationResponse {
  ok: boolean;
  code?: string;
  error?: string;
  publication?: PublishedCorrectiveCard;
}

export class SigPublicationError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'SigPublicationError';
    this.code = code;
  }
}

async function readResponse(response: Response): Promise<BugCardResponse> {
  const raw = await response.text();
  if (!raw) throw new Error(`O servidor retornou uma resposta vazia (HTTP ${response.status}).`);
  try {
    return JSON.parse(raw) as BugCardResponse;
  } catch {
    throw new Error('O servidor retornou uma resposta inválida. Tente novamente em alguns instantes.');
  }
}

function aiPayload(status: QAServerStatus | null, config: QAAIConfig | null) {
  if (status?.serverConfigured) {
    return { provider: status.defaultProvider };
  }
  if (config?.apiKey) {
    return { provider: config.provider, model: config.model, apiKey: config.apiKey };
  }
  throw new Error('IA não configurada. Configure um provedor no Gerador de Casos antes de gerar a corretiva.');
}

export async function generateCorrectiveCard(
  input: GenerateCorrectiveCardInput
): Promise<CorrectiveCardDraft> {
  const status = await buscarStatusServidor();
  const config = carregarConfigIA();
  const response = await fetch('/api/ai-analyze/bug-card', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, ...aiPayload(status, config) }),
  }).catch((error) => {
    throw new Error(
      `Não foi possível comunicar com o servidor. Verifique sua conexão e tente novamente. ${
        error instanceof Error ? error.message : ''
      }`.trim()
    );
  });

  const data = await readResponse(response);
  if (!response.ok || !data.ok || !data.card) {
    throw new Error(data.error || 'Não foi possível gerar o card. Tente novamente.');
  }
  return data.card;
}

export async function publishCorrectiveCard(
  card: CorrectiveCardDraft,
  context: CorrectiveCardContext,
  requestId: string
): Promise<PublishedCorrectiveCard> {
  const response = await fetch('/api/sig/correctives', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ card, context, requestId }),
  }).catch(() => {
    throw new Error(
      'Não foi possível comunicar com o servidor para publicar a corretiva no SIG.'
    );
  });
  const raw = await response.text();
  let data: SigPublicationResponse;
  try {
    data = raw ? (JSON.parse(raw) as SigPublicationResponse) : { ok: false };
  } catch {
    throw new Error('O servidor retornou uma resposta inválida ao publicar no SIG.');
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('planevidences:unauthorized'));
  }
  if (!response.ok || !data.ok || !data.publication) {
    throw new SigPublicationError(
      data.error || 'Não foi possível publicar a corretiva no SIG.',
      data.code
    );
  }
  return data.publication;
}

export function correctiveCardToMarkdown(
  card: CorrectiveCardDraft,
  context: Pick<GenerateCorrectiveCardInput, 'screenPath' | 'screenUrl'>
): string {
  return [
    `**Tela:** ${context.screenPath.trim() || 'Não informada'}`,
    '',
    '**URL:**',
    context.screenUrl?.trim() || 'Não informada',
    '',
    '**Descrição do Problema:**',
    '',
    card.problemDescription.trim(),
    '',
    '**Passos para Reproduzir:**',
    '',
    ...card.reproductionSteps
      .map((step) => step.trim())
      .filter(Boolean)
      .map((step, index) => `${index + 1}. ${step}`),
    '',
    '**Resultado Atual:**',
    '',
    card.currentResult.trim(),
    '',
    '**Resultado Esperado:**',
    '',
    card.expectedResult.trim(),
  ].join('\n');
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const element = document.createElement('textarea');
  element.value = text;
  element.style.position = 'fixed';
  element.style.opacity = '0';
  document.body.appendChild(element);
  element.select();
  const copied = document.execCommand('copy');
  element.remove();
  if (!copied) throw new Error('Não foi possível acessar a área de transferência.');
}
