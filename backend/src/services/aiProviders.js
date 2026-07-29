// Provedores de IA para geração de casos de teste a partir de HU.
// Portado de gerador-testes-hu/api/ai-analyze.js — Anthropic, OpenAI e Gemini
// com retry exponencial e fallback de modelo (Gemini).

export const SYSTEM_PROMPT = `Você é um especialista sênior em QA com domínio de heurísticas de testes de software, testes manuais em sistemas críticos e análise de Histórias de Usuário (HU).

Sua tarefa é, dado um conjunto de CARDS / HUs (cada card tem código, resumo, caminho na navegação, descrição e, opcionalmente, cenários BDD já redigidos), produzir um plano de testes RICO, organizado por card.

DIRETRIZES:
1. Para cada card, gere entre 6 e 12 casos de teste ESPECÍFICOS para a funcionalidade descrita — nada genérico ou que possa ser copiado para qualquer tela.
2. Cubra o fluxo positivo (happy path), validações de obrigatoriedade, regras de unicidade/duplicidade, edição, exclusão (com confirmação), pesquisa/filtros, listagem, permissões, mensagens de erro, integrações e bordas.
3. Cada caso deve referenciar elementos concretos da HU (nomes de campos, botões, mensagens, regras de negócio mencionadas). NÃO use placeholders genéricos como "campo X" ou "tela alvo".
4. Pré-condições, passos e resultado esperado devem ser frases completas, claras, em 3ª pessoa do indicativo, prontas para virar BDD ("Dado que ...", "Quando ...", "Então ...").
5. Reaproveite os cenários BDD que já vieram no card como CASOS PRÓPRIOS (não duplique). Acrescente novos casos para cobrir lacunas.
6. Numere os casos sequencialmente dentro de cada card: CT001, CT002, ...
7. Use prioridade "alta" para fluxos críticos e validações de obrigatoriedade/segurança; "media" para bordas e usabilidade; "baixa" para casos exóticos.

NOME DA TELA — REGRA CRÍTICA:
- O TÍTULO/RESUMO do card é frequentemente uma regra de negócio ou descrição do problema (ex: "O formulário deverá ser preenchido até o quinto dia útil", "Áreas de Feiras: Aba Localizar sem filtros de pesquisa") — NÃO É O NOME DA TELA.
- O nome real da tela vem do CAMINHO (último segmento útil após "Menu >") ou precisa ser inferido do texto da descrição (ex: "aba Localizar", "tela de Áreas de Atividades", "menu Parâmetros da TIP").
- NUNCA use o título do card como se fosse o nome da tela. Nunca produza "acessar a tela de O formulário deverá…" ou similar.
- Se não conseguir identificar um nome de tela curto e claro, use uma frase neutra como "a funcionalidade descrita na HU" — a clareza vale mais do que parecer específico.
- Use concordância verbal e nominal correta. As frases devem soar naturais em português brasileiro.

ESTILO BDD/GHERKIN — OBRIGATÓRIO:
- "resultadoEsperado" é o "Então" do Gherkin: UMA frase curta, direta, observável (ex: "o sistema exibe a mensagem 'Salvo com sucesso' e o registro aparece na listagem"). Máximo ~200 caracteres.
- NUNCA cole a descrição completa da HU no resultadoEsperado. Nada de "conforme a especificação: <parágrafo da HU>".
- "preCondicoes" e "passos" também são frases curtas e individuais. Cada item da lista é um único "Dado/Quando" coerente.
- Evite parágrafos, listas dentro de strings, ou enumerações de telas/campos no mesmo item — quebre em itens separados.

IMPORTANTE: Retorne APENAS JSON válido, sem markdown, sem comentários, sem texto fora do JSON.

Estrutura obrigatória (use OS VALORES DOS CARDS RECEBIDOS, NÃO COPIE os placeholders <...> abaixo):
{
  "cards": [
    {
      "codigo": "<COPIE EXATAMENTE o código do card recebido — não invente nem use exemplos>",
      "resumo": "<COPIE EXATAMENTE o resumo do card recebido — não reescreva nem invente>",
      "caminho": "<COPIE o caminho do card recebido se vier preenchido, senão omita>",
      "casos": [
        {
          "id": "CT001",
          "titulo": "Título curto e descritivo do caso",
          "tipo": "Funcional|Negativo|Borda|Segurança|Acessibilidade|Performance|Integração|UX|Regra de Negócio",
          "prioridade": "alta|media|baixa",
          "preCondicoes": ["uma frase por pré-condição"],
          "passos": ["um passo por item, em 3ª pessoa"],
          "resultadoEsperado": "frase única descrevendo o que deve ocorrer",
          "dadosTeste": "dados concretos quando aplicável; 'N/A' quando não houver"
        }
      ]
    }
  ],
  "analiseGlobal": {
    "qualidade": "alta|media|baixa",
    "ambiguidades": ["pontos da HU/cards que estão ambíguos"],
    "gapsIdentificados": ["perguntas que o PO deveria responder antes do desenvolvimento"],
    "riscosDominio": [
      { "nivel": "alto|medio|baixo", "descricao": "risco específico do domínio/fluxo" }
    ],
    "recomendacoes": ["recomendações táticas para o QA antes/durante a execução"]
  }
}`;

function formatarCardParaPrompt(card, idx) {
  const partes = [];
  partes.push(`### Card ${idx + 1} — #${card.codigo || 'S/CODIGO'} — ${card.resumo || '(sem resumo)'}`);
  if (card.caminho) partes.push(`**Caminho:** ${card.caminho}`);
  if (card.categoria) partes.push(`**Categoria:** ${card.categoria}`);
  if (card.descricaoInicial) partes.push(`**Descrição:** ${card.descricaoInicial}`);

  if (Array.isArray(card.cenarios) && card.cenarios.length) {
    partes.push(`**Cenários BDD já existentes neste card (use-os como base e complemente com novos):**`);
    card.cenarios.forEach((cen) => {
      partes.push(`- Cenário ${cen.numero}: ${cen.titulo}\n  - Dado que ${cen.dado}\n  - Quando ${cen.quando}\n  - Então ${cen.entao}`);
    });
  }
  if (Array.isArray(card.criterios) && card.criterios.length) {
    partes.push(`**Critérios em lista (regras adicionais):**`);
    card.criterios.forEach((c) => partes.push(`- ${c}`));
  }
  return partes.join('\n');
}

export function buildUserPrompt({ cards, tipoSistema, criticidade }) {
  const cardsTxt = (cards || []).map(formatarCardParaPrompt).join('\n\n---\n\n');
  return `## Contexto do Sistema
- **Tipo de Sistema:** ${tipoSistema || 'web'}
- **Criticidade:** ${criticidade || 'media'}

## Cards / HUs a serem analisados (${(cards || []).length})

${cardsTxt || '(nenhum card)'}

## Sua tarefa
Gere o plano de testes JSON conforme estrutura obrigatória. Para CADA card acima, devolva um objeto em "cards" com seus casos (6 a 12 por card). Mantenha "codigo" e "resumo" idênticos aos enviados acima.`;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = 4;

async function fetchWithRetry(url, options, providerName) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;

      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_RETRIES - 1) {
        const body = await response.text();
        const err = new Error(`${providerName} error ${response.status}: ${body}`);
        err.status = response.status;
        throw err;
      }
      lastError = new Error(`${providerName} ${response.status}`);
      lastError.status = response.status;
    } catch (err) {
      if (err.status && !RETRYABLE_STATUS.has(err.status)) throw err;
      lastError = err;
      if (attempt === MAX_RETRIES - 1) throw err;
    }
    const delay = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastError;
}

async function callAnthropic({ apiKey, model, userPrompt, systemPrompt = SYSTEM_PROMPT }) {
  const response = await fetchWithRetry(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: [{ type: 'text', text: systemPrompt }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    },
    'Anthropic'
  );
  const data = await response.json();
  return { texto: data.content?.[0]?.text || '', usage: data.usage };
}

async function callOpenAI({ apiKey, model, userPrompt, systemPrompt = SYSTEM_PROMPT }) {
  const response = await fetchWithRetry(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
      }),
    },
    'OpenAI'
  );
  const data = await response.json();
  return { texto: data.choices?.[0]?.message?.content || '', usage: data.usage };
}

async function callGroq({ apiKey, model, userPrompt, systemPrompt = SYSTEM_PROMPT }) {
  const response = await fetchWithRetry(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'openai/gpt-oss-120b',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.4,
      }),
    },
    'Groq'
  );
  const data = await response.json();
  return { texto: data.choices?.[0]?.message?.content || '', usage: data.usage };
}

function toolArguments(value, providerName) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Mensagem segura e específica abaixo.
  }
  const error = new Error(`${providerName} retornou argumentos inválidos para a ferramenta.`);
  error.status = 502;
  error.code = 'AUTOMATION_TOOL_ARGUMENTS_INVALID';
  throw error;
}

function normalizedTool(tool) {
  return {
    name: String(tool?.name || '').slice(0, 64),
    description: String(tool?.description || '').slice(0, 1_000),
    inputSchema:
      tool?.inputSchema && typeof tool.inputSchema === 'object'
        ? tool.inputSchema
        : { type: 'object', properties: {} },
  };
}

async function callOpenAICompatibleTool({
  baseUrl,
  providerName,
  defaultModel,
  apiKey,
  model,
  userPrompt,
  systemPrompt,
  tools,
}) {
  const response = await fetchWithRetry(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || defaultModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: tools.map((tool) => {
          const normalized = normalizedTool(tool);
          return {
            type: 'function',
            function: {
              name: normalized.name,
              description: normalized.description,
              parameters: normalized.inputSchema,
            },
          };
        }),
        tool_choice: 'required',
        parallel_tool_calls: false,
        temperature: 0.1,
      }),
    },
    providerName
  );
  const data = await response.json();
  const call = data.choices?.[0]?.message?.tool_calls?.find(
    (item) => item?.type === 'function'
  );
  if (!call?.function?.name) {
    const error = new Error(`${providerName} não selecionou uma ferramenta para a próxima ação.`);
    error.status = 502;
    error.code = 'AUTOMATION_TOOL_CALL_MISSING';
    throw error;
  }
  return {
    name: call.function.name,
    arguments: toolArguments(call.function.arguments, providerName),
    usage: data.usage,
  };
}

async function callOpenAITool(opts) {
  return callOpenAICompatibleTool({
    ...opts,
    baseUrl: 'https://api.openai.com/v1',
    providerName: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
  });
}

async function callGroqTool(opts) {
  return callOpenAICompatibleTool({
    ...opts,
    baseUrl: 'https://api.groq.com/openai/v1',
    providerName: 'Groq',
    defaultModel: 'openai/gpt-oss-120b',
  });
}

async function callAnthropicTool({
  apiKey,
  model,
  userPrompt,
  systemPrompt,
  tools,
}) {
  const response = await fetchWithRetry(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: 2_048,
        system: [{ type: 'text', text: systemPrompt }],
        messages: [{ role: 'user', content: userPrompt }],
        tools: tools.map((tool) => {
          const normalized = normalizedTool(tool);
          return {
            name: normalized.name,
            description: normalized.description,
            input_schema: normalized.inputSchema,
          };
        }),
        tool_choice: { type: 'any', disable_parallel_tool_use: true },
      }),
    },
    'Anthropic'
  );
  const data = await response.json();
  const call = data.content?.find((item) => item?.type === 'tool_use');
  if (!call?.name) {
    const error = new Error('Anthropic não selecionou uma ferramenta para a próxima ação.');
    error.status = 502;
    error.code = 'AUTOMATION_TOOL_CALL_MISSING';
    throw error;
  }
  return {
    name: call.name,
    arguments: toolArguments(call.input, 'Anthropic'),
    usage: data.usage,
  };
}

async function callGeminiToolOnce({
  apiKey,
  model,
  userPrompt,
  systemPrompt,
  tools,
}) {
  const modelName = model || 'gemini-2.5-flash';
  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: 4_096,
  };
  if (modelName.startsWith('gemini-2.5')) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const declarations = tools.map((tool) => {
    const normalized = normalizedTool(tool);
    return {
      name: normalized.name,
      description: normalized.description,
      parameters: normalized.inputSchema,
    };
  });
  const response = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        tools: [{ functionDeclarations: declarations }],
        toolConfig: {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: declarations.map((item) => item.name),
          },
        },
        generationConfig,
      }),
    },
    'Gemini'
  );
  const data = await response.json();
  const call = data.candidates?.[0]?.content?.parts?.find(
    (part) => part?.functionCall
  )?.functionCall;
  if (!call?.name) {
    const error = new Error('Gemini não selecionou uma ferramenta para a próxima ação.');
    error.status = 502;
    error.code = 'AUTOMATION_TOOL_CALL_MISSING';
    throw error;
  }
  return {
    name: call.name,
    arguments: toolArguments(call.args, 'Gemini'),
    usage: data.usageMetadata,
  };
}

export async function callProviderTool({
  provider,
  apiKey,
  model,
  userPrompt,
  systemPrompt,
  tools,
}) {
  if (!Array.isArray(tools) || tools.length === 0) {
    const error = new Error('Nenhuma ferramenta foi registrada para o agente.');
    error.status = 422;
    error.code = 'AUTOMATION_TOOLS_UNAVAILABLE';
    throw error;
  }
  if (provider === 'openai') {
    return callOpenAITool({ apiKey, model, userPrompt, systemPrompt, tools });
  }
  if (provider === 'groq') {
    return callGroqTool({ apiKey, model, userPrompt, systemPrompt, tools });
  }
  if (provider === 'anthropic') {
    return callAnthropicTool({ apiKey, model, userPrompt, systemPrompt, tools });
  }
  if (provider === 'gemini') {
    if (!apiKey.startsWith('AIza')) {
      const error = new Error('API key do Gemini inválida.');
      error.status = 400;
      throw error;
    }
    const requestedModel = model || 'gemini-2.5-flash';
    const fallbackChain = [...new Set([requestedModel, 'gemini-2.5-flash', 'gemini-2.0-flash'])];
    let lastError;
    for (const modelName of fallbackChain) {
      try {
        return await callGeminiToolOnce({
          apiKey,
          model: modelName,
          userPrompt,
          systemPrompt,
          tools,
        });
      } catch (error) {
        lastError = error;
        if (![429, 503].includes(error.status)) throw error;
      }
    }
    throw lastError;
  }
  const error = new Error(`Provedor de IA não suportado para automação: ${provider}`);
  error.status = 500;
  throw error;
}

async function callGeminiOnce(apiKey, modelName, userPrompt, systemPrompt = SYSTEM_PROMPT) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const generationConfig = {
    temperature: 0.4,
    responseMimeType: 'application/json',
    maxOutputTokens: 32768,
  };

  // Modelos 2.5 têm "thinking" ligado por padrão e consomem o orçamento de tokens.
  // Desligamos para garantir que todo o orçamento vá pra resposta JSON.
  if (modelName.startsWith('gemini-2.5')) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const response = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig,
      }),
    },
    'Gemini'
  );

  const data = await response.json();
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const finishReason = data.candidates?.[0]?.finishReason;
  const blockReason = data.promptFeedback?.blockReason;

  if (!texto) {
    throw new Error(
      `Gemini retornou resposta vazia (finishReason: ${finishReason || 'n/a'}${
        blockReason ? ', blockReason: ' + blockReason : ''
      }). Tente reduzir o tamanho da HU ou trocar o modelo.`
    );
  }

  if (finishReason === 'MAX_TOKENS') {
    throw new Error(
      `Gemini truncou a resposta (atingiu maxOutputTokens). Use um modelo com mais capacidade (ex: gemini-2.5-pro) ou reduza a quantidade de cards enviados por análise.`
    );
  }

  return {
    texto,
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount,
      completion_tokens: data.usageMetadata?.candidatesTokenCount,
    },
    modelUsed: modelName,
  };
}

async function callGemini({ apiKey, model, userPrompt, systemPrompt = SYSTEM_PROMPT }) {
  if (!apiKey.startsWith('AIza')) {
    const err = new Error(
      'API key do Gemini inválida: deve começar com "AIza". Gere uma key em https://aistudio.google.com/apikey (não use access token OAuth).'
    );
    err.status = 400;
    throw err;
  }

  const requestedModel = model || 'gemini-2.5-flash';
  const fallbackChain = [requestedModel];
  for (const alt of ['gemini-2.5-flash', 'gemini-2.0-flash']) {
    if (!fallbackChain.includes(alt)) fallbackChain.push(alt);
  }

  let lastError;
  for (let i = 0; i < fallbackChain.length; i++) {
    const modelName = fallbackChain[i];
    try {
      return await callGeminiOnce(apiKey, modelName, userPrompt, systemPrompt);
    } catch (err) {
      lastError = err;
      const isOverloaded = err.status === 503 || err.status === 429;
      const isLast = i === fallbackChain.length - 1;
      if (!isOverloaded || isLast) {
        if (isOverloaded && isLast) {
          throw new Error(
            `Todos os modelos Gemini estão sobrecarregados no momento (${fallbackChain.join(', ')}). Tente novamente em alguns minutos ou troque para Anthropic/OpenAI nas Configurações.`
          );
        }
        throw err;
      }
      console.warn(`[gemini] ${modelName} indisponível (${err.status}), tentando ${fallbackChain[i + 1]}...`);
    }
  }
  throw lastError;
}

export function extractJSON(texto) {
  const trimmed = texto.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    /* segue */
  }
  const match = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (_) {
      /* segue */
    }
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      /* segue */
    }
  }
  const preview =
    trimmed.length > 200 ? trimmed.slice(0, 100) + ' […] ' + trimmed.slice(-100) : trimmed;
  throw new Error(`Resposta da IA não é JSON válido. Início/fim do texto: ${preview}`);
}

export const PROVIDERS = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  groq: callGroq,
  gemini: callGemini,
};
