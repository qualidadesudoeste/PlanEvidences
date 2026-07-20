import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Scenario } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface CardGroup {
  codigo: string | null;
  resumo: string | null;
  caminho: string | null;
  scenarios: Scenario[];
  // Índice global do cenário dentro do projeto inteiro (não dentro do grupo) —
  // mantém o CT-001/CT-002... contínuo entre cards.
  startIndex: number;
}

// Placeholders ecoados pela IA em prompts antigos — tratar como ausência de código.
const PLACEHOLDER_CODIGOS = new Set([
  'S/CODIGO',
  'S/CÓDIGO',
  'S/COD',
  'S/N',
  'N/A',
  'NA',
  'NULL',
  'UNDEFINED',
  '?',
]);

// "HU-MANUAL" é o código sentinela usado quando o usuário digitou a HU direto sem
// um identificador. Mostra só o resumo (nada de "HU-MANUAL - ..." no título).
const CODIGO_SEM_NUMERO_REAL = new Set(['HU-MANUAL']);

// Formata o título do card:
//   - Placeholder ruim / null → só resumo
//   - HU-MANUAL → só resumo (não tem número de HU real)
//   - HU.04, HU.01, HU 07... → "HU.04 - Resumo"
//   - Numérico (cards SIG) → "Card #CODIGO — Resumo"
export function tituloCardParaExibicao(codigo?: string | null, resumo?: string | null): string {
  if (!codigo || PLACEHOLDER_CODIGOS.has(codigo.trim().toUpperCase())) {
    return resumo || '(sem identificação)';
  }
  if (CODIGO_SEM_NUMERO_REAL.has(codigo.trim().toUpperCase())) {
    return resumo || codigo;
  }
  if (/^HU/i.test(codigo)) {
    return resumo ? `${codigo} - ${resumo}` : codigo;
  }
  return resumo ? `Card #${codigo} — ${resumo}` : `Card #${codigo}`;
}

// Agrupa cenários por cardCodigo preservando a ordem de inserção.
// Cenários sem cardCodigo caem num grupo único "Sem card" (apenas quando
// o documento tem mistura — projetos legados ficam todos juntos).
export function agruparCenariosPorCard(scenarios: Scenario[]): CardGroup[] {
  const grupos: CardGroup[] = [];
  const indice = new Map<string, number>();
  scenarios.forEach((s, idx) => {
    const cod = s.cardCodigo || 'SEM-CARD';
    if (!indice.has(cod)) {
      indice.set(cod, grupos.length);
      grupos.push({
        codigo: s.cardCodigo || null,
        resumo: s.cardResumo || null,
        caminho: s.cardCaminho || null,
        scenarios: [],
        startIndex: idx,
      });
    }
    grupos[indice.get(cod)!].scenarios.push(s);
  });
  return grupos;
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function getErrorMessage(err: unknown): string {
  if (!err) return 'Erro desconhecido';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const obj = err as Record<string, any>;
    if (typeof obj.message === 'string' && obj.message) {
      const codeStr = obj.code ? ` (${obj.code})` : '';
      const detailsStr = obj.details ? ` - ${obj.details}` : '';
      return `${obj.message}${detailsStr}${codeStr}`;
    }
    if (typeof obj.error_description === 'string' && obj.error_description) return obj.error_description;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

