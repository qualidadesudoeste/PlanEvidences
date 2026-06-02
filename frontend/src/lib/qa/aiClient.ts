import type {
  QAAIConfig,
  QAAnaliseResult,
  QACard,
  QACriticidade,
  QAProvider,
  QAServerStatus,
  QATipoSistema,
} from '@/types';

const ENDPOINT = '/api/ai-analyze';

export async function buscarStatusServidor(): Promise<QAServerStatus | null> {
  try {
    const resp = await fetch(ENDPOINT, { method: 'GET' });
    if (!resp.ok) return null;
    return (await resp.json()) as QAServerStatus;
  } catch {
    return null;
  }
}

interface ChamarIAOptions {
  cards: QACard[];
  tipoSistema: QATipoSistema;
  criticidade: QACriticidade;
  /**
   * Quando vier do navegador (sem key no servidor), inclui apiKey/provider/model.
   * Quando o backend tem key configurada, só precisa de provider.
   */
  config?: QAAIConfig | null;
  serverStatus?: QAServerStatus | null;
}

interface AIResponse {
  ok: boolean;
  error?: string;
  analise?: QAAnaliseResult;
  provider?: string;
  model?: string;
}

async function chamarIAUmCard(payload: Record<string, unknown>): Promise<QAAnaliseResult> {
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(
      `Não foi possível alcançar o backend. Confirme que está rodando em http://localhost:4500 (cd backend && npm run dev). Detalhe: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  // Lê como texto antes de tentar JSON pra dar mensagem útil em caso de
  // proxy/CDN devolver HTML (timeout, 502) em vez de JSON do backend.
  const raw = await resp.text();
  if (!raw) {
    throw new Error(
      `Resposta vazia do servidor (HTTP ${resp.status}). Backend rodando na porta 4500?`
    );
  }
  let data: AIResponse;
  try {
    data = JSON.parse(raw);
  } catch {
    const inicio = raw.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Resposta inválida do servidor (HTTP ${resp.status}). Início da resposta: "${inicio}…"`
    );
  }
  if (!resp.ok || !data.ok || !data.analise) {
    throw new Error(data.error || `Erro HTTP ${resp.status}`);
  }
  return data.analise;
}

/**
 * Envia 1 card por requisição (padrão herdado do QA Assistant — resiliência:
 * falha em 1 card não derruba os demais). Para HU manual, é sempre 1 card.
 */
export async function analisarComIA({
  cards,
  tipoSistema,
  criticidade,
  config,
  serverStatus,
  onProgress,
}: ChamarIAOptions & {
  onProgress?: (i: number, total: number, card: QACard) => void;
}): Promise<{ analise: QAAnaliseResult; falhas: string[] }> {
  const servidorOk = serverStatus?.serverConfigured ?? false;

  if (!servidorOk && !config?.apiKey) {
    throw new Error('IA não configurada (nem servidor, nem navegador).');
  }

  const basePayload: Record<string, unknown> = { tipoSistema, criticidade };
  if (servidorOk && serverStatus) {
    basePayload.provider = serverStatus.defaultProvider;
  } else if (config) {
    basePayload.apiKey = config.apiKey;
    basePayload.provider = config.provider;
    basePayload.model = config.model;
  }

  const cardsResultado: QAAnaliseResult['cards'] = [];
  const analiseGlobalAgregada: QAAnaliseResult['analiseGlobal'] = {
    ambiguidades: [],
    gapsIdentificados: [],
    riscosDominio: [],
    recomendacoes: [],
  };
  const falhas: string[] = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    onProgress?.(i + 1, cards.length, card);

    try {
      const analise = await chamarIAUmCard({ ...basePayload, cards: [card] });
      if (analise.cards?.length) {
        // Sobrescreve codigo/resumo/caminho com o que ENVIAMOS — a IA às vezes
        // vaza valores do exemplo do system prompt (ex: copia "112964" /
        // "CRUD de Áreas de Atividades" em vez do código real do card).
        // Os casos (analise.cards[].casos) vêm da IA; só a metadata do card é
        // forçada pra bater com o input.
        for (const out of analise.cards) {
          out.codigo = card.codigo ?? out.codigo;
          out.resumo = card.resumo ?? out.resumo;
          if (card.caminho) out.caminho = card.caminho;
        }
        cardsResultado.push(...analise.cards);
      }
      const g = analise.analiseGlobal;
      if (g) {
        if (Array.isArray(g.ambiguidades)) analiseGlobalAgregada.ambiguidades!.push(...g.ambiguidades);
        if (Array.isArray(g.gapsIdentificados))
          analiseGlobalAgregada.gapsIdentificados!.push(...g.gapsIdentificados);
        if (Array.isArray(g.riscosDominio))
          analiseGlobalAgregada.riscosDominio!.push(...g.riscosDominio);
        if (Array.isArray(g.recomendacoes))
          analiseGlobalAgregada.recomendacoes!.push(...g.recomendacoes);
      }
    } catch (err) {
      console.error(`[IA] card ${card.codigo} falhou:`, err);
      falhas.push(`${card.codigo || '?'}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (cardsResultado.length === 0 && falhas.length > 0) {
    throw new Error(`IA falhou em todos os ${falhas.length} cards. Primeiro erro: ${falhas[0]}`);
  }

  return {
    analise: { cards: cardsResultado, analiseGlobal: analiseGlobalAgregada },
    falhas,
  };
}

export async function testarKey({
  provider,
  model,
  apiKey,
}: {
  provider: QAProvider;
  model: string;
  apiKey: string;
}): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testOnly: true, provider, model, apiKey }),
    });
  } catch (e) {
    throw new Error(
      `Não foi possível alcançar o backend (${ENDPOINT}). Confirme que o servidor está rodando em http://localhost:4500 (cd backend && npm run dev). Detalhe: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }

  // Lê texto primeiro: backend offline / proxy do Vite / erro HTML conhecidos
  // geram resposta vazia ou HTML, que quebraria resp.json() com erro confuso.
  const raw = await resp.text();
  if (!raw) {
    throw new Error(
      `Resposta vazia do servidor (HTTP ${resp.status}). Confirme que o backend está rodando em http://localhost:4500.`
    );
  }
  let data: AIResponse;
  try {
    data = JSON.parse(raw) as AIResponse;
  } catch {
    const inicio = raw.slice(0, 160).replace(/\s+/g, ' ').trim();
    throw new Error(
      `Resposta inválida do servidor (HTTP ${resp.status}). Era esperado JSON, veio: "${inicio}…". Backend rodando na porta 4500?`
    );
  }
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `Erro HTTP ${resp.status}`);
  }
}
