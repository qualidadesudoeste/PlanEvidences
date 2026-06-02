import type { QAAnaliseResult, QATipoSistema } from '@/types';
import { SUITE_TESTES, type SuiteCategoria, type SuiteContext } from './suite-data';

export interface CategoriaAplicavel extends SuiteCategoria {
  motivo: string;
  keywordsEncontradas: string[];
}

export interface RiscoIdentificado {
  nivel: 'alto' | 'medio' | 'baixo';
  descricao: string;
}

export interface CoberturaResumo {
  categoriasAplicaveis: number;
  totalTestesSuite: number;
  casosGerados: number;
  tiposCobertos: string[];
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function contemKeyword(texto: string, keyword: string): boolean {
  const textoNorm = normalizar(texto);
  const kwNorm = normalizar(keyword);
  const regex = new RegExp(`\\b${kwNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return regex.test(textoNorm);
}

export function selecionarCategoriasAplicaveis(
  hu: string,
  tela: string,
  tipoSistema: QATipoSistema
): CategoriaAplicavel[] {
  const textoAnalise = `${tela} ${hu}`.toLowerCase();
  const contexto: SuiteContext = { hu, tela, tipoSistema };
  const aplicaveis: CategoriaAplicavel[] = [];

  for (const cat of SUITE_TESTES) {
    let aplicavel = false;
    let motivo = '';
    const keywordsEncontradas: string[] = [];

    if (cat.sempreAplicavel) {
      aplicavel = true;
      motivo = 'Categoria essencial — aplicável a qualquer funcionalidade.';
    }

    if (cat.keywords && cat.keywords.length > 0) {
      for (const kw of cat.keywords) {
        if (kw === '*') continue;
        if (contemKeyword(textoAnalise, kw)) {
          aplicavel = true;
          keywordsEncontradas.push(kw);
        }
      }
      if (keywordsEncontradas.length > 0) {
        motivo = `Detectado na HU: "${keywordsEncontradas.slice(0, 3).join('", "')}"`;
      }
    }

    if (cat.aplicaApenasSe && !cat.aplicaApenasSe(contexto)) {
      aplicavel = false;
    }

    if (aplicavel) {
      aplicaveis.push({ ...cat, motivo, keywordsEncontradas });
    }
  }

  return aplicaveis;
}

export function analisarCoberturaRiscos(
  hu: string,
  tela: string,
  tipoSistema: QATipoSistema,
  categorias: CategoriaAplicavel[],
  analise: QAAnaliseResult
): { riscos: RiscoIdentificado[]; cobertura: CoberturaResumo } {
  const riscos: RiscoIdentificado[] = [];
  const textoNorm = normalizar(`${tela} ${hu}`);

  if (/pagamento|cart[aã]o|cobran[çc]a|financ/i.test(textoNorm)) {
    riscos.push({
      nivel: 'alto',
      descricao:
        'Funcionalidade envolve transação financeira — falhas podem gerar perda monetária direta. Priorize testes de idempotência, estorno e reconciliação.',
    });
  }

  if (/senha|login|autentic|token/i.test(textoNorm)) {
    riscos.push({
      nivel: 'alto',
      descricao:
        'Envolve credenciais e segurança — uma falha pode comprometer contas de usuários. Teste brute force, session fixation e exposição de tokens.',
    });
  }

  if (/deletar|excluir|remover/i.test(textoNorm)) {
    riscos.push({
      nivel: 'alto',
      descricao:
        'Operação destrutiva — valide confirmação, soft delete, cascata e possibilidade de recuperação.',
    });
  }

  if (/upload|arquivo/i.test(textoNorm)) {
    riscos.push({
      nivel: 'medio',
      descricao:
        'Upload de arquivos é vetor clássico de ataque (XSS, path traversal, malware). Reforce validação de tipo real e sandbox.',
    });
  }

  if (
    /chatbot|llm|gpt|intelig[eê]ncia artificial|machine learning/i.test(textoNorm) ||
    tipoSistema === 'ia'
  ) {
    riscos.push({
      nivel: 'alto',
      descricao:
        'Sistema usa IA — risco de alucinações, viés e prompt injection. Requer testes específicos de robustez e veracidade.',
    });
  }

  if (/integr|api|webhook|externo/i.test(textoNorm)) {
    riscos.push({
      nivel: 'medio',
      descricao:
        'Depende de sistema externo — teste cenários de timeout, indisponibilidade e callbacks duplicados.',
    });
  }

  if (!hu || hu.length < 50) {
    riscos.push({
      nivel: 'medio',
      descricao:
        'HU muito curta ou sem critérios de aceite — aumenta risco de ambiguidade. Recomenda-se alinhar com PO antes de testar.',
    });
  }

  const casos = analise.cards.flatMap((c) => c.casos);
  const cobertura: CoberturaResumo = {
    categoriasAplicaveis: categorias.length,
    totalTestesSuite: categorias.reduce((acc, c) => acc + c.testes.length, 0),
    casosGerados: casos.length,
    tiposCobertos: Array.from(new Set(casos.map((c) => c.tipo).filter((t): t is string => !!t))),
  };

  return { riscos, cobertura };
}
