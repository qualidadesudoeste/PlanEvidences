import type { AutomationRun } from '@/types';

const RUNNER_URL = (
  import.meta.env.VITE_AUTOMATION_RUNNER_URL || 'http://127.0.0.1:4317'
).replace(/\/+$/, '');
const RUNNER_WINDOW_NAME = 'planevidences_local_runner';
export const LOCAL_RUNNER_DOWNLOAD_URL =
  import.meta.env.VITE_AUTOMATION_RUNNER_DOWNLOAD_URL ||
  '/downloads/PlanEvidencesRunner-Windows.zip';

interface ApiResponse {
  ok?: boolean;
  error?: string;
  run?: AutomationRun;
  runnerToken?: string;
}

async function readJson(response: Response): Promise<ApiResponse> {
  const raw = await response.text();
  try {
    return raw ? (JSON.parse(raw) as ApiResponse) : {};
  } catch {
    return {};
  }
}

async function authenticatedApi(path: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(`/api/automation${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  if (response.status === 401) {
    window.dispatchEvent(new Event('planevidences:unauthorized'));
  }
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}.`);
  return data;
}

export interface CreateAutomationRunInput {
  projectName: string;
  sprintName: string;
  evidenceProjectId?: string | null;
  qaPlanId?: string | null;
  baseUrl: string;
  loginUrl: string;
  cards: Array<{
    code: string;
    title: string;
    hu: string;
    path: string;
    scenarios: Array<{
      id: string;
      code: string;
      title: string;
      bdd: string;
      path: string;
    }>;
  }>;
}

export async function createAutomationRun(input: CreateAutomationRunInput) {
  const data = await authenticatedApi('/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!data.run || !data.runnerToken) {
    throw new Error('O servidor não retornou os dados necessários para iniciar o runner.');
  }
  sessionStorage.setItem(`automation-runner-token:${data.run.id}`, data.runnerToken);
  return { run: data.run, runnerToken: data.runnerToken };
}

export async function getAutomationRun(runId: string): Promise<AutomationRun> {
  const data = await authenticatedApi(`/runs/${encodeURIComponent(runId)}`);
  if (!data.run) throw new Error('Execução automatizada não encontrada.');
  return data.run;
}

export async function cancelAutomationRun(runId: string): Promise<AutomationRun> {
  const data = await authenticatedApi(`/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  });
  if (!data.run) throw new Error('Execução automatizada não encontrada.');
  return data.run;
}

export function openLocalRunnerStatus() {
  window.open(`${RUNNER_URL}/`, RUNNER_WINDOW_NAME, 'noopener');
}

export function prepareLocalRunnerWindow(): Window | null {
  const runnerWindow = window.open('about:blank', RUNNER_WINDOW_NAME);
  if (runnerWindow) {
    try {
      runnerWindow.document.title = 'PlanEvidences Runner Local';
      runnerWindow.document.body.textContent = 'Preparando execução no Runner Local...';
    } catch {
      // Uma aba local existente pode continuar cross-origin até concluir a navegação.
    }
  }
  return runnerWindow;
}

export function startLocalAutomationRunner(input: {
  runId: string;
  runnerToken?: string;
  username: string;
  password: string;
}) {
  const runnerToken =
    input.runnerToken ||
    sessionStorage.getItem(`automation-runner-token:${input.runId}`) ||
    '';
  if (!runnerToken) throw new Error('O token temporário do Runner Local não está disponível.');

  // Uma navegação POST de nível superior é usada em vez de fetch para funcionar
  // também quando o PlanEvidences está em HTTP e o Chrome restringe Local Network Access.
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${RUNNER_URL}/runs/start`;
  form.target = RUNNER_WINDOW_NAME;
  form.style.display = 'none';
  const fields = {
    serverUrl: window.location.origin,
    runId: input.runId,
    runnerToken,
    username: input.username,
    password: input.password,
  };
  for (const [name, value] of Object.entries(fields)) {
    const element = document.createElement('input');
    element.type = 'hidden';
    element.name = name;
    element.value = value;
    form.appendChild(element);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

export function forgetRunnerToken(runId: string) {
  sessionStorage.removeItem(`automation-runner-token:${runId}`);
}
