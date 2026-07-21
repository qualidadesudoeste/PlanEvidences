import type {
  CorrectiveCardDraft,
  GenerateCorrectiveCardInput,
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

export function correctiveCardToMarkdown(
  card: CorrectiveCardDraft,
  context: Pick<GenerateCorrectiveCardInput, 'hu' | 'screenPath'>
): string {
  return [
    `**HU:** ${context.hu.trim() || 'Não informada'}`,
    '',
    '**Caminho da Tela:**',
    context.screenPath.trim() || 'Não informado',
    '',
    '**Descrição do Bug:**',
    '',
    card.bugDescription.trim(),
    '',
    '**Comportamento esperado:**',
    '',
    card.expectedBehavior.trim(),
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
