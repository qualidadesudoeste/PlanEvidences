import type { QAAnaliseResult, QACardComCasos, QACase, Scenario } from '@/types';
import type { SigCard } from './sigParser';

// ---------- Helpers ----------

function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFileSlug(s: string, fallback: string): string {
  const cleaned = (s || '').replace(/[^\w\d]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function frasePraBDD(s: string | undefined | null): string {
  if (!s) return '';
  const trimmed = s.trim().replace(/[.;]+$/, '');
  if (/^[A-ZÀ-Ý]{2,}/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function casoParaBDDTexto(caso: QACase): string {
  const linhas: string[] = [];
  const pre = (caso.preCondicoes || []).filter(Boolean).map(frasePraBDD);
  const passos = (caso.passos || []).filter(Boolean).map(frasePraBDD);

  pre.forEach((p, i) => linhas.push(i === 0 ? `Dado que ${p}` : `E ${p}`));
  passos.forEach((p, i) => linhas.push(i === 0 ? `Quando ${p}` : `E ${p}`));
  if (caso.resultadoEsperado) {
    linhas.push(`Então ${frasePraBDD(caso.resultadoEsperado)}`);
  }
  return linhas.join('\n');
}

// ---------- Markdown completo (com análise IA + riscos) ----------

export interface MarkdownOpts {
  projeto: string;
  sprint: string;
  tela?: string | null;
  tipoSistema: string;
  criticidade: string;
  analise: QAAnaliseResult;
  riscos?: Array<{ nivel: string; descricao: string }>;
}

export function gerarMarkdown(opts: MarkdownOpts): string {
  const data = new Date().toLocaleDateString('pt-BR');
  const totalCasos = opts.analise.cards.reduce((acc, c) => acc + c.casos.length, 0);

  let md = `# 🧪 Plano de Testes — ${opts.tela || opts.projeto}\n\n`;
  md += `> **Projeto:** ${opts.projeto} • **Sprint:** ${opts.sprint} • **Gerado em:** ${data}\n`;
  md += `> **Tipo:** ${opts.tipoSistema} • **Criticidade:** ${opts.criticidade}\n`;
  md += `> **Cards / HUs:** ${opts.analise.cards.length} • **Casos de teste:** ${totalCasos}\n\n---\n\n`;

  for (const card of opts.analise.cards) {
    const titulo = card.codigo ? `Card #${card.codigo} — ${card.resumo}` : card.resumo;
    md += `## ${titulo}\n`;
    if (card.caminho) md += `*Caminho:* ${card.caminho}\n`;
    md += `\n`;

    card.casos.forEach((c) => {
      md += `### ${c.id} — ${c.titulo}\n`;
      const meta: string[] = [];
      if (c.prioridade) meta.push(`*Prioridade:* ${c.prioridade}`);
      if (c.tipo) meta.push(`*Tipo:* ${c.tipo}`);
      if (meta.length) md += `- ${meta.join(' • ')}\n`;
      if (c.preCondicoes && c.preCondicoes.length) {
        md += `- *Pré-condição:* ${c.preCondicoes.join(' / ')}\n`;
      }
      if (c.passos && c.passos.length) {
        md += `- *Passos:* ${c.passos.join(' > ')}\n`;
      }
      if (c.resultadoEsperado) {
        md += `- *Resultado esperado:* ${c.resultadoEsperado}\n`;
      }
      if (c.dadosTeste && c.dadosTeste !== 'N/A') {
        md += `- *Dados de teste:* ${c.dadosTeste}\n`;
      }
      md += `\n`;
    });

    md += `---\n\n`;
  }

  // Análise da IA (ambiguidades, gaps, recomendações)
  const a = opts.analise.analiseGlobal;
  if (a && (a.ambiguidades?.length || a.gapsIdentificados?.length || a.recomendacoes?.length)) {
    md += `## 🔎 Análise da IA\n\n`;
    if (a.qualidade) md += `**Qualidade da HU:** ${a.qualidade.toUpperCase()}\n\n`;
    if (a.ambiguidades?.length) {
      md += `**Ambiguidades:**\n`;
      a.ambiguidades.forEach((x) => (md += `- ${x}\n`));
      md += `\n`;
    }
    if (a.gapsIdentificados?.length) {
      md += `**Perguntas para o PO:**\n`;
      a.gapsIdentificados.forEach((x) => (md += `- ${x}\n`));
      md += `\n`;
    }
    if (a.recomendacoes?.length) {
      md += `**Recomendações:**\n`;
      a.recomendacoes.forEach((x) => (md += `- ${x}\n`));
      md += `\n`;
    }
  }

  // Riscos identificados (vindos da heurística local + IA)
  if (opts.riscos && opts.riscos.length) {
    md += `## ⚠️ Riscos Identificados\n\n`;
    opts.riscos.forEach((r) => (md += `- **${r.nivel.toUpperCase()}:** ${r.descricao}\n`));
    md += `\n`;
  }

  return md;
}

export function exportarMarkdown(opts: MarkdownOpts): void {
  const md = gerarMarkdown(opts);
  const slug = safeFileSlug(opts.tela || opts.projeto, 'plano');
  downloadBlob(md, `plano-testes-${slug}.md`, 'text/markdown;charset=utf-8');
}

// ---------- Template SIG (formato cards, pra colar em ferramenta) ----------

export interface TemplateOpts {
  projeto: string;
  sprint: string;
  cardsSig: SigCard[];
}

export function gerarMarkdownTemplate(opts: TemplateOpts): string {
  const data = new Date().toLocaleDateString('pt-BR');
  const totalCen = opts.cardsSig.reduce((acc, c) => acc + (c.cenarios?.length || 0), 0);

  let md = `# 🧪 Plano de Testes — ${opts.projeto}${opts.sprint ? ` / Sprint ${opts.sprint}` : ''}\n\n`;
  md += `> **Gerado em:** ${data} • **HUs:** ${opts.cardsSig.length} • **Cenários:** ${totalCen}\n\n---\n\n`;

  opts.cardsSig.forEach((card, idx) => {
    const codigo = card.codigo || `HU${idx + 1}`;
    const titulo = card.resumo || `HU ${idx + 1}`;
    md += `## #${codigo} – ${titulo}\n\n`;
    md += `**Caminho:** ${card.caminho || '(preencher)'}\n\n`;
    md += `**Categoria:** ${card.categoria || 'Melhoria'}\n\n`;
    md += `**Descrição:** ${card.descricaoInicial || '(não informada)'}\n\n`;
    md += `**Nível:** Alta Complexidade\n\n`;
    md += `**Funcionalidade:** ${titulo}\n\n`;
    md += `*Testes Críticos (Risco Alto)*\n\n`;
    if (card.cenarios && card.cenarios.length) {
      card.cenarios.forEach((cen) => {
        md += `### Cenário ${cen.numero}: ${cen.titulo}\n\n`;
        md += `| | |\n|---|---|\n`;
        md += `| **Dado** | que ${cen.dado} |\n`;
        md += `| **Quando** | ${cen.quando} |\n`;
        md += `| **Então** | ${cen.entao} |\n\n`;
        md += `**Execução:** ☐ Aprovado &nbsp;&nbsp; ☐ Reprovado\n\n`;
        md += `**Observações / Evidências:**\n\n\n`;
      });
    } else {
      md += `_Nenhum cenário de aceite extraído deste card._\n\n`;
    }
    md += `---\n\n`;
  });

  return md;
}

export function exportarTemplate(opts: TemplateOpts): void {
  const md = gerarMarkdownTemplate(opts);
  const slug = safeFileSlug(opts.sprint, 'sig');
  downloadBlob(md, `plano-template-${slug}.md`, 'text/markdown;charset=utf-8');
}

// ---------- JSON BDD (consumido pelo Editor de Evidências) ----------

export interface JsonBddOpts {
  projeto: string;
  sprint: string;
  tela?: string | null;
  analise: QAAnaliseResult;
}

export function exportarJSONBDD(opts: JsonBddOpts): number {
  const scenarios: Scenario[] = [];
  for (const card of opts.analise.cards) {
    for (const c of card.casos) {
      scenarios.push({
        id: crypto.randomUUID(),
        title: c.titulo || '',
        bdd: casoParaBDDTexto(c),
        evidence: '',
        images: [],
        cardCodigo: card.codigo || null,
        cardResumo: card.resumo || null,
        cardCaminho: card.caminho || null,
        caseId: c.id || null,
      });
    }
  }

  const payload = {
    projectName: opts.projeto || '',
    sprintName: opts.sprint || '',
    version: '',
    redator: '',
    clientName: '',
    sprintObjective: '',
    testScope: opts.tela || '',
    scenarios,
  };

  const slug = safeFileSlug(opts.tela || 'hu', 'hu');
  downloadBlob(JSON.stringify(payload, null, 2), `cenarios-bdd-${slug}.json`, 'application/json;charset=utf-8');
  return scenarios.length;
}

// ---------- Util pra copiar pro clipboard ----------

export async function copiarMarkdown(opts: MarkdownOpts): Promise<void> {
  const md = gerarMarkdown(opts);
  await navigator.clipboard.writeText(md);
}

// Re-exporta utilitário de cards comum usado pelos consumidores
export type { QACardComCasos };
