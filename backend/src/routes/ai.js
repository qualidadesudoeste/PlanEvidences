import { Router } from 'express';
import { PROVIDERS, buildUserPrompt, extractJSON } from '../services/aiProviders.js';

const router = Router();

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

// POST /api/ai-analyze — gera casos de teste pra os cards enviados
router.post('/', async (req, res) => {
  try {
    const { cards, tipoSistema, criticidade, apiKey, provider, model, testOnly } = req.body || {};

    const chosenProvider = provider || 'gemini';

    const envKeys = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
    };

    const chosenKey = apiKey || envKeys[chosenProvider];

    if (!chosenKey) {
      return res
        .status(400)
        .json({ ok: false, error: `API key para ${chosenProvider} não configurada.` });
    }

    const providerFn = PROVIDERS[chosenProvider];
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
