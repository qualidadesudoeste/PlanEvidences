const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 150_000;

function toolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // A mensagem segura abaixo representa a resposta inválida.
  }
  const error = new Error('OpenAI retornou argumentos inválidos para a ferramenta.');
  error.status = 502;
  error.code = 'AUTOMATION_TOOL_ARGUMENTS_INVALID';
  throw error;
}

function normalizedTool(tool) {
  return {
    type: 'function',
    name: String(tool?.name || '').slice(0, 64),
    description: String(tool?.description || '').slice(0, 1_000),
    parameters:
      tool?.inputSchema && typeof tool.inputSchema === 'object'
        ? tool.inputSchema
        : { type: 'object', properties: {} },
    strict: false,
  };
}

function safeImage(image) {
  const mimeType = String(image?.mimeType || '');
  const data = String(image?.data || '');
  if (!/^image\/(?:png|jpeg)$/.test(mimeType) || !data) return null;
  // Limita cada frame a aproximadamente 5 MB antes da codificação base64.
  if (data.length > 7_000_000) return null;
  return `data:${mimeType};base64,${data}`;
}

function currentTurnContent(turnText, image) {
  const content = [{ type: 'input_text', text: turnText }];
  const imageUrl = safeImage(image);
  if (imageUrl) {
    content.push({ type: 'input_image', image_url: imageUrl, detail: 'high' });
  }
  return content;
}

export function buildPersistentResponseRequest({
  model,
  systemPrompt,
  userPrompt,
  tools,
  image,
  previousResponseId,
  previousCallId,
}) {
  const input = [];
  if (previousResponseId && previousCallId) {
    input.push({
      type: 'function_call_output',
      call_id: previousCallId,
      output: userPrompt,
    });
    input.push({
      role: 'user',
      content: currentTurnContent(
        'Continue a execução usando o novo estado visual da página. Preserve o plano e não repita ações já concluídas.',
        image
      ),
    });
  } else {
    input.push({
      role: 'user',
      content: currentTurnContent(userPrompt, image),
    });
  }

  return {
    model: model || 'gpt-5.4',
    instructions: systemPrompt,
    input,
    tools: tools.map(normalizedTool),
    tool_choice: 'required',
    parallel_tool_calls: false,
    previous_response_id: previousResponseId || undefined,
    store: true,
  };
}

export function parsePersistentToolResponse(data) {
  const call = Array.isArray(data?.output)
    ? data.output.find((item) => item?.type === 'function_call')
    : null;
  if (!call?.name || !call?.call_id) {
    const error = new Error('OpenAI não selecionou uma ferramenta para a próxima ação.');
    error.status = 502;
    error.code = 'AUTOMATION_TOOL_CALL_MISSING';
    throw error;
  }
  return {
    responseId: String(data.id || ''),
    callId: String(call.call_id),
    name: String(call.name),
    arguments: toolArguments(call.arguments),
    usage: data.usage,
  };
}

async function fetchResponse(apiKey, body) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        // A resposta textual será usada na mensagem de erro.
      }
      if (response.ok) return data;
      const error = new Error(
        data?.error?.message || `OpenAI respondeu HTTP ${response.status}.`
      );
      error.status = response.status;
      error.code = data?.error?.code || 'AUTOMATION_OPENAI_ERROR';
      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS - 1) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError =
        error?.name === 'AbortError'
          ? Object.assign(new Error('A IA excedeu o tempo limite para decidir a próxima ação.'), {
              status: 504,
              code: 'AUTOMATION_AI_TIMEOUT',
            })
          : error;
      if (
        (lastError.status && !RETRYABLE_STATUS.has(lastError.status)) ||
        attempt === MAX_ATTEMPTS - 1
      ) {
        throw lastError;
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
  }
  throw lastError;
}

export async function callOpenAIPersistentTool(options) {
  const body = buildPersistentResponseRequest(options);
  const data = await fetchResponse(options.apiKey, body);
  return parsePersistentToolResponse(data);
}
