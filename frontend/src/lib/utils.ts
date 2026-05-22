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

// Formata o título do card: códigos HU.* (HU.04, HU-MANUAL) já carregam o
// identificador no resumo, então mostra só o resumo. Códigos numéricos
// (cards SIG) recebem o prefixo "Card #".
export function tituloCardParaExibicao(codigo?: string | null, resumo?: string | null): string {
  if (!codigo) return resumo || '(sem identificação)';
  if (/^HU/i.test(codigo)) return resumo || codigo;
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
