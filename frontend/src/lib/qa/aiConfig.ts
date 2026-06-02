import type { QAAIConfig, QAProvider } from '@/types';

const STORAGE_KEY = 'qa-assistant-ai-config';

export interface AIModelOption {
  value: string;
  label: string;
}

export const AI_MODELS: Record<QAProvider, AIModelOption[]> = {
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recomendado)' },
    { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (máxima qualidade)' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (rápido/barato)' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o-mini (rápido/barato)' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  ],
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recomendado - rápido/grátis)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (máxima qualidade)' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (fallback estável)' },
  ],
};

export const PROVIDER_LABELS: Record<QAProvider, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI GPT',
  gemini: 'Google Gemini',
};

export const KEY_HINTS: Record<QAProvider, { label: string; url: string }> = {
  anthropic: { label: 'console.anthropic.com', url: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'platform.openai.com', url: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'aistudio.google.com/apikey', url: 'https://aistudio.google.com/apikey' },
};

export function carregarConfigIA(): QAAIConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as QAAIConfig;
  } catch {
    return null;
  }
}

export function salvarConfigIA(config: QAAIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function limparConfigIA(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function modeloPadrao(provider: QAProvider): string {
  return AI_MODELS[provider][0].value;
}
