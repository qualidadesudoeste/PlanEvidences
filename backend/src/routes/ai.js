import { Router } from 'express';
import { PROVIDERS, buildUserPrompt, extractJSON } from '../services/aiProviders.js';

const router = Router();

const BUG_CARD_SYSTEM_PROMPT = `Você é um analista sênior de qualidade responsável por redigir cards de correção de defeitos para equipes de desenvolvimento.

Transforme o relato do QA em um card técnico, claro, objetivo e sem ambiguidades. Corrija ortografia e concordância sem inventar fatos, mensagens, regras ou passos que não foram informados.

Retorne APENAS JSON válido, sem markdown ou texto adicional, exatamente com estas propriedades:
{
  "title": "[HU 199] - Sistema > Tela: resumo curto do problema",
  "bugDescription": "descrição objetiva do comportamento atual observado",
  "expectedBehavior": "descrição objetiva do comportamento esperado"
}

Regras:
- O título deve seguir: [HU XXX] - Caminho da Tela: Resumo do Problema.
- No título, normalize HU.199 ou HU 199 para HU 199.
- O resumo do título deve conter somente a essência do defeito.
- bugDescription descreve somente o que ocorre atualmente.
- expectedBehavior descreve o resultado correto esperado.
- Se o relato não declarar explicitamente o comportamento esperado, deduza apenas o resultado funcional mínimo e óbvio, sem inventar detalhes de interface.
- Não repita HU ou caminho dentro de bugDescription e expectedBehavior.`;

function configuredAI(body = {}) {
  const chosenProvider = body.provider || 'gemini';
  const envKeys = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  return {
    chosenProvider,
    chosenKey: body.apiKey || envKeys[chosenProvider],
    providerFn: PROVIDERS[chosenProvider],
  };
}

function titleHu(hu) {
  const value = String(hu || '').trim().replace(/^HU[\s.:-]*/i, '').trim();
  return `HU ${value || 'S/N'}`;
}

function standardizedBugTitle(aiTitle, hu, screenPath) {
  const raw = String(aiTitle || '').trim();
  const prefixEnd = raw.indexOf(':', raw.indexOf(']'));
  const summary = (prefixEnd >= 0 ? raw.slice(prefixEnd + 1) : raw)
    .replace(/^\[[^\]]+\]\s*-\s*/, '')
    .trim();
  return `[${titleHu(hu)}] - ${String(screenPath || '').trim() || 'Caminho não informado'}: ${
    summary || 'Defeito identificado durante a execução do teste'
  }`;
}

// GET /api/ai-analyze — informa quais provedores têm key no .env do servidor
router.get('/', (_req, res) => {
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  // Quando o operador configura mais de uma key, OpenAI/Anthropic têm precedência
  // sobre Gemini (são pagos — sinal de que o operador preferiu pagar e quer usar).
  let defaultProvider = null;
  if (hasOpenAI) defaultProvider = 'openai';
  else if (hasAnthropic) defaultProvider = 'anthropic';
  else if (hasGemini) defaultProvider = 'gemini';

  res.json({
    serverConfigured: hasAnthropic || hasOpenAI || hasGemini,
    providers: { anthropic: hasAnthropic, openai: hasOpenAI, gemini: hasGemini },
    defaultProvider,
  });
});

// POST /api/ai-analyze/bug-card — estrutura um relato em card de corretiva.
// Usa exatamente os mesmos provedores, credenciais, retry e fallback da geração de casos.
router.post('/bug-card', async (req, res) => {
  try {
    const {
      hu,
      screenPath,
      errorDescription,
      sigCardCode,
      scenarioCode,
      scenarioTitle,
      provider,
      model,
      apiKey,
    } = req.body || {};
    if (!String(errorDescription || '').trim()) {
      return res.status(400).json({ ok: false, error: 'Descreva o erro encontrado antes de gerar o card.' });
    }

    const { chosenProvider, chosenKey, providerFn } = configuredAI({ provider, apiKey });
    if (!chosenKey) {
      return res.status(400).json({ ok: false, error: `API key para ${chosenProvider} não configurada.` });
    }
    if (!providerFn) {
      return res.status(400).json({ ok: false, error: `Provider desconhecido: ${chosenProvider}` });
    }

    const userPrompt = [
      `HU: ${String(hu || 'Não informada').trim()}`,
      `Caminho da tela: ${String(screenPath || 'Não informado').trim()}`,
      sigCardCode ? `Card de melhoria SIG de origem: #${String(sigCardCode).trim()}` : null,
      scenarioCode ? `Código do cenário: ${String(scenarioCode).trim()}` : null,
      scenarioTitle ? `Cenário em execução: ${String(scenarioTitle).trim()}` : null,
      `Relato do QA: ${String(errorDescription).trim()}`,
    ].filter(Boolean).join('\n');

    const result = await providerFn({
      apiKey: chosenKey,
      model,
      systemPrompt: BUG_CARD_SYSTEM_PROMPT,
      userPrompt,
    });
    const card = extractJSON(result.texto);
    if (!card?.title || !card?.bugDescription || !card?.expectedBehavior) {
      throw new Error('A IA retornou um card incompleto. Tente gerar novamente.');
    }

    return res.json({
      ok: true,
      provider: chosenProvider,
      model: result.modelUsed || model,
      usage: result.usage,
      card: {
        title: standardizedBugTitle(card.title, hu, screenPath),
        hu: String(hu || '').trim(),
        screenPath: String(screenPath || '').trim(),
        bugDescription: String(card.bugDescription).trim(),
        expectedBehavior: String(card.expectedBehavior).trim(),
      },
    });
  } catch (err) {
    console.error('[bug-card] erro:', err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({
      ok: false,
      error: status >= 500
        ? 'Não foi possível gerar o card agora. Verifique a conexão com a IA e tente novamente.'
        : err.message,
    });
  }
});

// POST /api/ai-analyze — gera casos de teste pra os cards enviados
router.post('/', async (req, res) => {
  try {
    const { cards, tipoSistema, criticidade, apiKey, provider, model, testOnly } = req.body || {};

    const { chosenProvider, chosenKey, providerFn } = configuredAI({ provider, apiKey });

    if (!chosenKey) {
      return res
        .status(400)
        .json({ ok: false, error: `API key para ${chosenProvider} não configurada.` });
    }

    if (!providerFn) {
      return res.status(400).json({ ok: false, error: `Provider desconhecido: ${chosenProvider}` });
    }

    // Modo de teste — só pinga o provedor pra validar a key/model
    if (testOnly) {
      const testPrompt = 'Responda apenas JSON: {"ok": true}';
      await providerFn({ apiKey: chosenKey, model, userPrompt: testPrompt });
      return res.json({ ok: true, provider: chosenProvider });
    }

    if (!Array.isArray(cards) || cards.length === 0) {
      return res
        .status(400)
        .json({ ok: false, error: 'Nenhum card enviado. O front deve mandar pelo menos 1 card.' });
    }

    const userPrompt = buildUserPrompt({ cards, tipoSistema, criticidade });
    const result = await providerFn({ apiKey: chosenKey, model, userPrompt });

    return res.json({
      ok: true,
      provider: chosenProvider,
      model: result.modelUsed || model,
      usage: result.usage,
      analise: extractJSON(result.texto),
    });
  } catch (err) {
    console.error('[ai-analyze] erro:', err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    return res.status(status).json({ ok: false, error: err.message });
  }
});

export default router;
