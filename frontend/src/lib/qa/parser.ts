import type { QACard } from '@/types';

export interface HUParseada {
  papel: string | null;
  acao: string | null;
  beneficio: string | null;
  criterios: string[];
  textoCompleto: string;
}

export function parsearHU(texto: string): HUParseada {
  const huParseada: HUParseada = {
    papel: null,
    acao: null,
    beneficio: null,
    criterios: [],
    textoCompleto: texto,
  };

  const regexPapel = /(?:como|as a)\s+(?:um\s+|uma\s+|an?\s+)?([^,\n]+)/i;
  const regexAcao = /(?:eu\s+quero|quero|i\s+want(?:\s+to)?)\s+([^,\n]+)/i;
  const regexBeneficio = /(?:para\s+que|para|so that)\s+([^,\n]+)/i;

  const matchPapel = texto.match(regexPapel);
  const matchAcao = texto.match(regexAcao);
  const matchBeneficio = texto.match(regexBeneficio);

  if (matchPapel) huParseada.papel = matchPapel[1].trim();
  if (matchAcao) huParseada.acao = matchAcao[1].trim();
  if (matchBeneficio) {
    huParseada.beneficio = matchBeneficio[1]
      .trim()
      .replace(/^(?:eu|ele|ela|o\s+usu[áa]rio|o\s+sistema)\s+(?:possa|posso|consiga|consegue)\s+/i, '')
      .replace(/[.;]+$/, '')
      .trim();
  }

  const regexCriterios = /(?:critérios?\s+de\s+aceite|crit[eé]rios|acceptance\s+criteria)[:\s]*([\s\S]*)/i;
  const matchCriterios = texto.match(regexCriterios);
  if (matchCriterios) {
    const linhas = matchCriterios[1].split(/\n/);
    huParseada.criterios = linhas
      .map((l) => l.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter((l) => l.length > 5);
  }

  return huParseada;
}

// Tenta extrair um número de HU do texto, suportando "HU 07", "HU.07", "HU-07",
// "HU07", "HU.04.1", etc. Retorna no formato "HU.NN" quando achar, senão null.
function extrairCodigoHUDoTexto(texto: string): string | null {
  const m = texto.match(/\bHU[\s.\-_]?(\d+(?:[.\-]\d+)*)/i);
  if (!m) return null;
  return 'HU.' + m[1].replace(/-/g, '.');
}

/**
 * Para HU manual (sem PDF/JSON importado), monta 1 card sintético que o resto
 * do pipeline trata como qualquer outro card.
 *
 * O `codigo` precisa ser preenchido (não null) — senão o prompt da IA usa
 * "S/CODIGO" como placeholder e a IA ecoa isso de volta, gerando títulos
 * feios como "Card #S/CODIGO" no PDF. Quando o usuário não passa um número,
 * usamos "HU-MANUAL" e o tituloCardParaLatex (que trata códigos começando
 * com HU sem prefixo "Card #") mostra só o resumo.
 */
export function criarCardSinteticoDeHU(hu: string, projeto: string, sprint: string): QACard {
  const parsed = parsearHU(hu);
  const resumoBase = parsed.acao || parsed.papel || `${projeto || 'Projeto'} — Sprint ${sprint || 'atual'}`;
  const codigoExtraido = extrairCodigoHUDoTexto(hu);
  return {
    codigo: codigoExtraido || 'HU-MANUAL',
    resumo: resumoBase.length > 100 ? resumoBase.slice(0, 97) + '...' : resumoBase,
    descricaoInicial: hu,
    criterios: parsed.criterios.length > 0 ? parsed.criterios : undefined,
  };
}
