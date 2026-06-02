import type { QACard, QACardCenario } from '@/types';

export interface SigJSONItem {
  ['Código']?: string | number;
  codigo?: string | number;
  code?: string | number;
  ['Resumo']?: string;
  resumo?: string;
  title?: string;
  ['Descrição']?: string;
  descricao?: string;
  description?: string;
  hu?: string;
  ['Projeto']?: string;
  projeto?: string;
  project?: string;
  ['Sprint']?: string;
  sprint?: string;
  ['Categoria']?: string;
  categoria?: string;
}

export interface SigCard extends QACard {
  projeto?: string;
  sprint?: string;
}

// Remove emojis "mangled" (??, ???) que aparecem no JSON exportado e normaliza espaços.
function limparTextoSig(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/\?{2,}/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "HU.17.1 (4/4) - ALTERAÇÃO EM GESTÃO DE OS - PERMISSÃO CANCELAR OS" → "Menu > Gestão de OS"
function extrairCaminhoDoResumo(resumo: string): string {
  const r = (resumo || '').trim();
  if (!r) return '';
  let m = r.match(/ALTERA[ÇC][ÃA]O\s+EM\s+(.+?)(?:\s*[-–]\s|$)/i);
  if (m) return `Menu > ${m[1].trim()}`;
  m = r.match(/^TELA\s+DE\s+(.+?)(?:\s*[-–]|$)/i);
  if (m) return `Tela de ${m[1].trim()}`;
  m = r.match(/^(?:HU\.[\d.]+(?:\s*\([^)]*\))?\s*[-–]\s*)?(.+)$/i);
  if (m) return `Menu > ${m[1].trim()}`;
  return `Menu > ${r}`;
}

// Faz parsing dos blocos "Cenário N: Título Dado que ... Quando ... Então ..."
function extrairCenariosQA(textoCenariosQA: string): QACardCenario[] {
  const cenarios: QACardCenario[] = [];
  if (!textoCenariosQA) return cenarios;
  const regex = /Cen[áa]rio\s+(\d+):\s*([\s\S]+?)(?=Cen[áa]rio\s+\d+:|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(textoCenariosQA)) !== null) {
    const numero = Number(m[1]);
    const bloco = m[2].trim();
    const dadoIdx = bloco.search(/\bDado\s+que\b/i);
    const quandoIdx = bloco.search(/\bQuando\b/i);
    const entaoIdx = bloco.search(/\bEnt[aã]o\b/i);
    if (dadoIdx < 0 || quandoIdx < 0 || entaoIdx < 0) continue;
    if (!(dadoIdx < quandoIdx && quandoIdx < entaoIdx)) continue;

    const titulo = bloco
      .substring(0, dadoIdx)
      .replace(/[\s.,;:]+$/, '')
      .trim();
    const dado = bloco
      .substring(dadoIdx, quandoIdx)
      .replace(/^Dado\s+que\s*/i, '')
      .replace(/[\s,;]+$/, '')
      .trim();
    const quando = bloco
      .substring(quandoIdx, entaoIdx)
      .replace(/^Quando\s*/i, '')
      .replace(/[\s,;]+$/, '')
      .trim();
    const entao = bloco
      .substring(entaoIdx)
      .replace(/^Ent[aã]o\s*/i, '')
      .replace(/[\s.]+$/, '')
      .trim();

    cenarios.push({ numero, titulo, dado, quando, entao });
  }
  return cenarios;
}

// Extrai descrição inicial (MAPEAMENTO DE CAMADAS) e Cenários (CENÁRIOS DE TESTE QA).
function extrairSecoesCardSig(descricao: string): { descricaoInicial: string; cenarios: QACardCenario[] } {
  const desc = limparTextoSig(descricao);

  const idxIntro = desc.search(/MAPEAMENTO\s+DE\s+CAMADAS/i);
  const idxTarefas = desc.search(/TAREFAS\s+DE\s+DESENVOLVIMENTO/i);
  const idxCenarios = desc.search(/CEN[ÁA]RIOS?\s+DE\s+TESTE/i);
  const idxNotas = desc.search(/NOTAS\s+DE\s+IMPLEMENTA[ÇC][ÃA]O/i);

  let descricaoInicial = '';
  if (idxIntro >= 0) {
    const fim = idxTarefas >= 0 ? idxTarefas : idxCenarios >= 0 ? idxCenarios : desc.length;
    descricaoInicial = desc
      .substring(idxIntro, fim)
      .replace(/^MAPEAMENTO\s+DE\s+CAMADAS\s*/i, '')
      .trim();
  } else if (idxTarefas >= 0 || idxCenarios >= 0) {
    const fim = idxTarefas >= 0 ? idxTarefas : idxCenarios;
    let inicio = 0;
    const decompIdx = desc.search(/DECOMPOSI[ÇC][ÃA]O\s+T[ÉE]CNICA:/i);
    if (decompIdx >= 0) {
      const colon = desc.indexOf(':', decompIdx);
      if (colon >= 0) inicio = colon + 1;
    }
    descricaoInicial = desc.substring(inicio, fim).trim();
  } else {
    descricaoInicial = desc;
  }

  let textoCenarios = '';
  if (idxCenarios >= 0) {
    const fim = idxNotas >= 0 ? idxNotas : desc.length;
    textoCenarios = desc
      .substring(idxCenarios, fim)
      .replace(/^CEN[ÁA]RIOS?\s+DE\s+TESTE(?:\s*\([^)]*\))?\s*/i, '');
  }

  return { descricaoInicial, cenarios: extrairCenariosQA(textoCenarios) };
}

export function parsearCardsSig(items: SigJSONItem[]): SigCard[] {
  return items
    .map((item): SigCard => {
      const codigo = item['Código'] ?? item.codigo ?? item.code ?? '';
      const resumo = item['Resumo'] ?? item.resumo ?? item.title ?? '';
      const descricao = item['Descrição'] ?? item.descricao ?? item.description ?? item.hu ?? '';
      const projeto = item['Projeto'] ?? item.projeto ?? item.project ?? '';
      const sprint = item['Sprint'] ?? item.sprint ?? '';
      const categoria = item['Categoria'] ?? item.categoria ?? 'Melhoria';
      const { descricaoInicial, cenarios } = extrairSecoesCardSig(descricao);
      return {
        codigo: String(codigo),
        resumo,
        projeto: projeto || undefined,
        sprint: sprint || undefined,
        categoria,
        caminho: extrairCaminhoDoResumo(resumo),
        descricaoInicial,
        cenarios,
      };
    })
    .filter(
      (c) =>
        (c.descricaoInicial && c.descricaoInicial.length >= 20) ||
        (c.cenarios && c.cenarios.length > 0)
    );
}

// Texto consolidado pra preencher o textarea: só descrição + cenários, sem TAREFAS/NOTAS.
export function montarHUConsolidadaLimpa(cards: SigCard[]): string {
  const blocos = cards.map((c, i) => {
    const titulo = c.resumo || `HU ${i + 1}`;
    const codigo = c.codigo ? ` (#${c.codigo})` : '';
    const parts: string[] = [`## HU ${i + 1}: ${titulo}${codigo}`];
    if (c.caminho) parts.push(`**Caminho:** ${c.caminho}`);
    if (c.categoria) parts.push(`**Categoria:** ${c.categoria}`);
    if (c.descricaoInicial) parts.push(`**Descrição:** ${c.descricaoInicial}`);
    if (c.cenarios && c.cenarios.length) {
      const cenTxt = c.cenarios
        .map(
          (cen) =>
            `- **Cenário ${cen.numero}: ${cen.titulo}**\n  - Dado que ${cen.dado}\n  - Quando ${cen.quando}\n  - Então ${cen.entao}`
        )
        .join('\n');
      parts.push(`**Critérios de Aceite (BDD):**\n${cenTxt}`);
    }
    if (c.criterios && c.criterios.length) {
      const critTxt = c.criterios.map((crit) => `- ${crit}`).join('\n');
      parts.push(`**Regras / Critérios Adicionais:**\n${critTxt}`);
    }
    return parts.join('\n\n');
  });
  return `# Plano Consolidado SIG — ${cards.length} HUs\n\n${blocos.join('\n\n---\n\n')}`;
}

// ============== Parser para PDF/DOCX (texto extraído) ==============

function limparTextoCenario(s: string | null | undefined): string {
  return (s || '')
    .split('\n')
    .map((l) => l.replace(/^\s*[●○•]\s*/, '').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/^[\s,;.]+|[\s,;.]+$/g, '')
    .trim();
}

function parsearDadoQuandoEntao(bloco: string): Array<{ dado: string; quando: string; entao: string }> {
  const subs: Array<{ dado: string; quando: string; entao: string }> = [];
  const partes = bloco.split(/\bDado\s+que\s+/i);
  for (let i = 1; i < partes.length; i++) {
    const sec = partes[i];
    const dadoEnd = sec.search(/(?:\bE\s+)?quando\s+/i);
    if (dadoEnd < 0) continue;
    const dado = limparTextoCenario(sec.substring(0, dadoEnd));
    if (!dado) continue;

    const resto = sec.substring(dadoEnd);
    const qqRegex = /(?:\bE\s+)?quando\s+([\s\S]+?),?\s*ent[aã]o\s+([\s\S]+?)(?=\b(?:E\s+)?quando\s+|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = qqRegex.exec(resto)) !== null) {
      const quando = limparTextoCenario(m[1]);
      const entao = limparTextoCenario(m[2]);
      if (quando && entao) subs.push({ dado, quando, entao });
    }
  }
  return subs;
}

function extrairCenariosDocumento(texto: string, linhas: string[]): QACardCenario[] {
  const cenarios: QACardCenario[] = [];

  const regexCenario =
    /Cen[áa]rio\s+(\d+)[\.\:]?\s*([^\n]+)\n([\s\S]+?)(?=Cen[áa]rio\s+\d+[\.\:]|\bTELA\s+\d+\b|Caminho\s+no\s+menu\s*:|COMPORTAMENTO\s+ESPERADO|CRIT[ÉE]RIOS\s+DE\s+ACEIT|REGRAS\s+DE\s+NEG[ÓO]CIO|INTERFACE\s+DE\s+USU|APROVA[ÇC][ÃA]O|ANEXOS|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = regexCenario.exec(texto)) !== null) {
    const numero = Number(m[1]);
    const titulo = (m[2] || '').replace(/[\s.,;:]+$/, '').trim();
    const subCenarios = parsearDadoQuandoEntao(m[3]);
    if (subCenarios.length === 1) {
      cenarios.push({ numero, titulo, ...subCenarios[0] });
    } else if (subCenarios.length > 1) {
      subCenarios.forEach((c, i) =>
        cenarios.push({
          numero: i === 0 ? numero : numero + i / 10, // 1.1, 1.2, etc — preserva ordem
          titulo: i === 0 ? titulo : `${titulo} — continuação`,
          ...c,
        })
      );
    }
  }

  // DOCX em tabela: padrão de linhas [título, "DADO QUE", "QUANDO", "ENTÃO", d, q, e]
  if (cenarios.length === 0) {
    let seq = 1;
    for (let i = 0; i < linhas.length - 6; i++) {
      if (
        /^DADO\s+QUE$/i.test(linhas[i]) &&
        /^QUANDO$/i.test(linhas[i + 1]) &&
        /^ENT[ÃA]O$/i.test(linhas[i + 2])
      ) {
        const titulo = (i > 0 ? linhas[i - 1] : `Cenário ${seq}`).trim();
        const dado = (linhas[i + 3] || '').replace(/[,.\s]+$/, '').trim();
        const quando = (linhas[i + 4] || '').replace(/[,.\s]+$/, '').trim();
        const entao = (linhas[i + 5] || '').replace(/[\s.]+$/, '').trim();
        if (dado && quando && entao) {
          cenarios.push({ numero: seq++, titulo, dado, quando, entao });
        }
        i += 5;
      }
    }
  }

  return cenarios;
}

// Pula SUMÁRIO/TOC do documento (TOC entries seriam confundidas com critérios reais).
function pularSumario(texto: string): string {
  const idxSum = texto.search(/\bSUM[ÁA]RIO\b/i);
  if (idxSum < 0) return texto;
  const offset = idxSum + 10;
  const re = /\n([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-ZÁÉÍÓÚÀÂÊÔÃÕÇ\s\-/]{4,})(?=\n)/g;
  re.lastIndex = offset;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const head = m[1].trim();
    if (!/\d$/.test(head)) {
      return texto.substring(m.index + 1);
    }
  }
  return texto;
}

function extrairCriteriosBullets(texto: string): string[] {
  const out: string[] = [];

  function colher(bloco: string): string[] {
    return bloco
      .split(/[\n;]/)
      .map((l) => l.replace(/^[●○•◦\-\*\d.)\s]+/, '').trim())
      .filter(
        (l) =>
          l.length > 15 &&
          !/^Dado\s+que\b/i.test(l) &&
          !/^Quando\b/i.test(l) &&
          !/^Ent[aã]o\b/i.test(l) &&
          !/^Cen[áa]rio\s+\d/i.test(l) &&
          !/^(REGRAS|CRIT[ÉE]RIOS|TELAS?|INTERFACE|DEPEND[ÊE]NCIAS|PR[ÉE]-REQUISITOS|FORA\s+DE\s+ESCOPO|HIST[ÓO]RIA|VIS[ÃA]O|APROVA[ÇC][ÃA]O|SUM[ÁA]RIO)\b/i.test(l)
      );
  }

  const anchorFim =
    /TELAS?\b|INTERFACE\s+DE\s+USU[ÁA]RIO|CRIT[ÉE]RIOS\s+DE\s+ACEIT|COMPORTAMENTO\s+ESPERADO|ANEXOS\b|APROVA[ÇC][ÃA]O\s+DO\s+REQUISITO/;

  const idxR = texto.search(/REGRAS\s+DE\s+NEG[ÓO]CIO/);
  if (idxR >= 0) {
    const tail = texto.substring(idxR + 'REGRAS DE NEGÓCIO'.length);
    const rel = tail.search(anchorFim);
    const bloco = rel >= 0 ? tail.substring(0, rel) : tail;
    out.push(...colher(bloco));
  }

  const idxC = texto.search(/Crit[ée]rios?\s+de\s+aceit(?:e|a[çc][ãa]o)/i);
  if (idxC >= 0) {
    const tailC = texto.substring(idxC);
    const corte = tailC.search(/Dado\s+que\b|Cen[áa]rio\s+\d|DADO\s+QUE|ANEXOS\b|APROVA[ÇC][ÃA]O/);
    out.push(...colher(tailC.substring(0, corte > 0 ? corte : tailC.length)));
  }

  const seen = new Set<string>();
  return out
    .filter((c) => {
      const k = c.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 20);
}

export function parsearHUDeDocumento(textoBruto: string, fileName: string): SigCard {
  const texto = textoBruto.replace(/ /g, ' ');
  const linhas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let codigo = '';
  let resumo = '';
  const tituloRegex =
    /\bHU[\s.\-_]?\s*(\d+(?:[.\-]\d+)*)(?:\s*\([^)]*\))?\s*[-–\s]+([^\n[]+?)(?:\s*\[[^\]]+\])?\s*$/im;
  for (const l of linhas.slice(0, 15)) {
    const m = l.match(tituloRegex);
    if (m) {
      codigo = 'HU.' + m[1].replace(/-/g, '.');
      resumo = `${codigo} - ${m[2].trim()}`;
      break;
    }
  }
  if (!codigo) {
    const base = (fileName || 'documento')
      .replace(/\.(pdf|docx)$/i, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim();
    const m = base.match(/^HU[\s.\-_]?\s*(\d+(?:[.\-]\d+)*)\s*[-–\s]+(.+)$/i);
    if (m) {
      codigo = 'HU.' + m[1].replace(/-/g, '.');
      resumo = `${codigo} - ${m[2].trim()}`;
    } else {
      codigo = base.substring(0, 30) || 'HU';
      resumo = base;
    }
  }

  let caminho = '';
  const caminhoMatch = texto.match(/Caminho(?:\s+no\s+menu)?\s*:\s*([^\n]+)/i);
  if (caminhoMatch) {
    caminho = caminhoMatch[1].trim();
    if (!/^Menu/i.test(caminho)) caminho = 'Menu > ' + caminho;
  } else {
    caminho = `Menu > ${resumo}`;
  }

  // ----- História de Usuário (Como/quero/de modo que) -----
  let huPapel = '';
  let huAcao = '';
  let huBeneficio = '';
  const huInline = texto.match(
    /Como\s+([^,\n]+?),?\s*(?:eu\s+)?quero\s+([^,\n]+?),?\s*(?:de\s+modo\s+que|para\s+que|para)\s+([^.\n]+)/i
  );
  if (huInline) {
    huPapel = huInline[1].trim();
    huAcao = huInline[2].trim();
    huBeneficio = huInline[3].trim();
  } else {
    // DOCX em tabela: [COMO / EU QUERO / DE MODO QUE] seguidas dos valores
    for (let i = 0; i < linhas.length - 5; i++) {
      if (
        /^COMO$/i.test(linhas[i]) &&
        /^EU\s+QUERO$/i.test(linhas[i + 1]) &&
        /^DE\s+MODO\s+QUE$/i.test(linhas[i + 2])
      ) {
        huPapel = linhas[i + 3] || '';
        huAcao = linhas[i + 4] || '';
        huBeneficio = linhas[i + 5] || '';
        break;
      }
    }
  }

  const textoSemSumario = pularSumario(texto);
  const linhasSemSumario = textoSemSumario
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const cenarios = extrairCenariosDocumento(textoSemSumario, linhasSemSumario);

  const cenTitulos = new Set(cenarios.map((c) => (c.titulo || '').toLowerCase().trim()));
  const criterios = extrairCriteriosBullets(textoSemSumario).filter(
    (c) => !cenTitulos.has(c.toLowerCase().trim())
  );

  let projeto = '';
  const projMatch = texto.match(/PROJETO\s*:\s*([^\n]+)/i);
  if (projMatch) projeto = projMatch[1].trim();
  if (!projeto) {
    for (let i = 0; i < linhas.length - 7; i++) {
      if (
        /^CLIENTE$/i.test(linhas[i]) &&
        /^PROJETO$/i.test(linhas[i + 1]) &&
        /^REQUISITO$/i.test(linhas[i + 2]) &&
        /^REDATOR$/i.test(linhas[i + 3])
      ) {
        projeto = (linhas[i + 5] || '').trim();
        break;
      }
    }
  }
  let sprint = '';
  const sprMatch = (fileName || '').match(/SPRINT\s*(\d+)/i) || texto.match(/SPRINT\s*(\d+)/i);
  if (sprMatch) sprint = sprMatch[1].trim();

  let descricaoInicial = '';
  if (huPapel || huAcao || huBeneficio) {
    descricaoInicial = `Como ${huPapel || '(papel)'}, quero ${huAcao || '(ação)'}, de modo que ${
      huBeneficio || '(benefício)'
    }.`;
  } else {
    descricaoInicial = resumo;
  }

  return {
    codigo,
    resumo,
    projeto: projeto || undefined,
    sprint: sprint || undefined,
    categoria: 'Melhoria',
    caminho,
    descricaoInicial,
    cenarios,
    criterios,
  };
}

// Faz merge entre cards já importados e novos, deduplicando por código+resumo.
export function mergeSigCards(existing: SigCard[], novos: SigCard[]): SigCard[] {
  const merged = new Map<string, SigCard>();
  let chaveAuto = 0;
  for (const c of [...existing, ...novos]) {
    const base = `${c.codigo || ''}|${c.resumo || ''}`;
    const chave = base.length > 1 ? base : `auto-${++chaveAuto}`;
    merged.set(chave, c);
  }
  return Array.from(merged.values());
}
