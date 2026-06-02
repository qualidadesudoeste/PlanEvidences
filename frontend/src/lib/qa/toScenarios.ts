import type { QAAnaliseResult, Scenario } from '@/types';

/**
 * Baixa a 1ª letra (a menos que seja sigla/nome próprio) e remove pontuação
 * final pra a frase fluir bem após "Dado que / Quando / Então".
 */
function frasePraBDD(s: string | undefined | null): string {
  if (!s) return '';
  const trimmed = s.trim().replace(/[.;]+$/, '');
  if (/^[A-ZÀ-Ý]{2,}/.test(trimmed)) return trimmed; // sigla → preserva
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/**
 * Converte um caso de teste no formato da IA (preCondicoes / passos /
 * resultadoEsperado) pra um bloco BDD pronto pra colar em evidência.
 */
function casoParaBDDTexto(caso: {
  preCondicoes?: string[];
  passos?: string[];
  resultadoEsperado?: string;
}): string {
  const linhas: string[] = [];
  const pre = (caso.preCondicoes || []).filter(Boolean).map(frasePraBDD);
  const passos = (caso.passos || []).filter(Boolean).map(frasePraBDD);

  pre.forEach((p, i) => {
    linhas.push(i === 0 ? `Dado que ${p}` : `E ${p}`);
  });
  passos.forEach((p, i) => {
    linhas.push(i === 0 ? `Quando ${p}` : `E ${p}`);
  });
  if (caso.resultadoEsperado) {
    linhas.push(`Então ${frasePraBDD(caso.resultadoEsperado)}`);
  }
  return linhas.join('\n');
}

/**
 * Aplana cards × casos em uma lista plana de Scenario pronto pro editor de
 * evidências. Preserva metadados de card pro agrupamento na UI continuar funcionando.
 */
export function analiseParaScenarios(analise: QAAnaliseResult): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const card of analise.cards) {
    for (const caso of card.casos) {
      scenarios.push({
        id: crypto.randomUUID(),
        title: caso.titulo || '',
        bdd: casoParaBDDTexto(caso),
        evidence: '',
        images: [],
        cardCodigo: card.codigo || null,
        cardResumo: card.resumo || null,
        cardCaminho: card.caminho || null,
        caseId: caso.id || null,
      });
    }
  }
  return scenarios;
}
