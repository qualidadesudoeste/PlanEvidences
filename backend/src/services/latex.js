import path from 'node:path';

const ESCAPES = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};

export function escapeLatex(input) {
  if (input == null) return '';
  return String(input).replace(/[\\&%$#_{}~^]/g, (c) => ESCAPES[c]);
}

function todayBR() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Quebra o texto BDD em três partes (Dado que / Quando / Então).
// Linhas iniciadas por "Dado que", "Quando", "Então"/"Entao" mudam o bucket
// atual. Linhas iniciadas por "E " são anexadas ao bucket atual.
function parseBdd(text) {
  const empty = { dado: '', quando: '', entao: '' };
  if (!text) return empty;
  const buckets = { dado: [], quando: [], entao: [] };
  let current = 'dado';
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const m = line.match(/^(dado que|dado|quando|então|entao|e)\b\s*/i);
    if (m) {
      const kw = m[1].toLowerCase();
      const rest = line.slice(m[0].length).trim();
      if (kw === 'dado que' || kw === 'dado') {
        current = 'dado';
        if (rest) buckets.dado.push(rest);
      } else if (kw === 'quando') {
        current = 'quando';
        if (rest) buckets.quando.push(rest);
      } else if (kw === 'então' || kw === 'entao') {
        current = 'entao';
        if (rest) buckets.entao.push(rest);
      } else if (kw === 'e') {
        if (rest) buckets[current].push(rest);
      } else {
        buckets[current].push(line);
      }
    } else {
      buckets[current].push(line);
    }
  }
  return {
    dado: joinSteps(buckets.dado),
    quando: joinSteps(buckets.quando),
    entao: joinSteps(buckets.entao),
  };
}

// Junta múltiplos passos do mesmo bucket BDD em uma única frase legível.
// O primeiro passo entra como está; os seguintes ganham conector " e ", com
// o ponto final do passo anterior removido pra não duplicar (ex: "X. e Y" → "X e Y").
// Isso resolve o problema antigo onde os passos ficavam colados sem pontuação:
//   "acessa Menu > X o usuário executa Y o usuário confirma Z"
// → "acessa Menu > X. E o usuário executa Y. E o usuário confirma Z"
function joinSteps(steps) {
  if (!steps.length) return '';
  return steps
    .map((s, i) => {
      const limpo = s.replace(/[\s.,;:]+$/, '').trim();
      if (i === 0) return limpo;
      // Capitaliza primeira letra após o conector pra leitura ficar natural.
      const cap = limpo.charAt(0).toUpperCase() + limpo.slice(1);
      return `E ${cap}`;
    })
    .join('. ');
}

// Placeholders que a IA pode ter ecoado de prompts antigos. Quando aparecerem
// em cardCodigo, devem ser tratados como ausência de código (vamos mostrar
// só o resumo, sem "Card #...").
const PLACEHOLDER_CODIGOS = new Set(['S/CODIGO', 'S/CÓDIGO', 'S/COD', 'S/N', 'N/A', 'NA', 'NULL', 'UNDEFINED', '?']);
// Código sentinela da HU manual (sem número real de HU).
const CODIGO_SEM_NUMERO_REAL = new Set(['HU-MANUAL']);

// Decide o título exibido do card no PDF:
//   - Placeholder ruim / null → só resumo.
//   - HU-MANUAL → só resumo (sentinela sem número real).
//   - HU.04, HU 07... → "HU.04 - Resumo" (preserva o número da HU).
//   - Numérico (cards SIG) → "Card #CODIGO — Resumo".
function tituloCardParaLatex(codigo, resumo) {
  const cod = codigo == null ? '' : String(codigo).trim();
  const up = cod.toUpperCase();
  if (!cod || PLACEHOLDER_CODIGOS.has(up)) {
    return resumo || '(sem identificação)';
  }
  if (CODIGO_SEM_NUMERO_REAL.has(up)) {
    return resumo || cod;
  }
  if (/^HU/i.test(cod)) {
    return resumo ? `${cod} - ${resumo}` : cod;
  }
  return resumo ? `Card #${cod} — ${resumo}` : `Card #${cod}`;
}

// Agrupa scenarios pelo cardCodigo preservando a ordem original. Cenários sem
// cardCodigo caem num grupo "sem card" — usado pra projetos legados (gerados antes
// da feature de agrupamento) sem quebrar a renderização.
function agruparPorCard(scenarios) {
  const grupos = [];
  const idx = new Map();
  scenarios.forEach((sc) => {
    const cod = sc.cardCodigo || '__SEM_CARD__';
    if (!idx.has(cod)) {
      idx.set(cod, grupos.length);
      grupos.push({
        codigo: sc.cardCodigo || null,
        resumo: sc.cardResumo || null,
        caminho: sc.cardCaminho || null,
        scenarios: [],
      });
    }
    grupos[idx.get(cod)].scenarios.push(sc);
  });
  return grupos;
}

export function buildLatex(project, { uploadsDir }) {
  const {
    projectName = '',
    sprintName = '',
    redator = '',
    clientName = '',
    scenarios = [],
  } = project;

  const escProject = escapeLatex(projectName);
  const escSprint = escapeLatex(sprintName);
  const escRedator = escapeLatex(redator);
  const escClient = escapeLatex(clientName);
  const escDate = escapeLatex(todayBR());
  // "PROJETO - CLIENTE" na capa (ex: "SGOS - SMED"); cai pra um só caso o outro venha vazio.
  const tituloCapa = [projectName, clientName].filter(Boolean).map(escapeLatex).join(' - ') || 'Projeto';

  // Quando há cards (cardCodigo presente em pelo menos 1 cenário), agrupa as seções
  // por card: \section{Card #...} com \subsection{CT-001 - título} para cada cenário.
  // Quando não há (projetos antigos), mantém o formato flat \section por cenário.
  const temCards = scenarios.some((s) => s.cardCodigo);
  let sectionsTex;
  if (temCards) {
    let globalIdx = 0;
    sectionsTex = agruparPorCard(scenarios)
      .map((grupo, gi, arr) => {
        const tituloGrupo = escapeLatex(tituloCardParaLatex(grupo.codigo, grupo.resumo));
        const cenariosTex = grupo.scenarios
          .map((sc) => {
            const out = renderScenario(sc, globalIdx, uploadsDir, scenarios.length, { useSubsection: true });
            globalIdx++;
            return out;
          })
          .join('\n');
        const isLastGroup = gi === arr.length - 1;
        // Quebra de página entre grupos pra cada card começar numa página nova.
        const tail = isLastGroup ? '' : '\n\\newpage\n';
        return `% ================== CARD ==================
\\section{${tituloGrupo}}
${cenariosTex}${tail}`;
      })
      .join('\n');
  } else {
    sectionsTex = scenarios
      .map((sc, idx) => renderScenario(sc, idx, uploadsDir, scenarios.length))
      .join('\n');
  }

  return `\\documentclass[12pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[shorthands=off,brazil]{babel}
\\usepackage{graphicx}
\\usepackage{geometry}
\\usepackage{fancyhdr}
\\usepackage{xcolor}
\\usepackage{tabularx}
\\usepackage{array}
\\usepackage{titlesec}
\\usepackage{tocloft}
% Aumenta o espaço reservado pro número da seção no sumário — sem isso,
% itens com 3+ dígitos (>99) colam no título (ex: "100Validação").
\\setlength{\\cftsecnumwidth}{3.5em}
\\setlength{\\cftsubsecnumwidth}{4em}
\\usepackage{hyperref}
\\usepackage{colortbl}
\\usepackage{float}
\\usepackage[pages=some]{background}
\\usepackage{everypage}

% ---- Configuração de margens ----
\\geometry{
    a4paper,
    left=2.5cm,
    right=2.5cm,
    top=4cm,
    bottom=3cm,
    headheight=2.5cm
}

% ---- Cores ----
\\definecolor{azulSudoeste}{RGB}{46, 88, 148}
\\definecolor{cinzaClaro}{RGB}{240, 240, 240}

% ---- Variáveis do documento ----
\\newcommand{\\clientename}{${escClient}}
\\newcommand{\\projectname}{${escProject}}
\\newcommand{\\titulocapa}{${tituloCapa}}
\\newcommand{\\sprintnum}{${escSprint}}
\\newcommand{\\sprintlabel}{${escSprint ? `Sprint ${escSprint}` : ''}}

% ---- Hyperlinks ----
\\hypersetup{
    colorlinks=true,
    linkcolor=black,
    urlcolor=azulSudoeste,
    pdftitle={Evidências de Teste - ${tituloCapa}${escSprint ? ` - Sprint ${escSprint}` : ''}},
}

% ---- Cabeçalho e rodapé das páginas internas ----
\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}

% ---- Formatação de seções ----
\\titleformat{\\section}
  {\\normalfont\\large\\bfseries\\color{azulSudoeste}}
  {}{0em}{}
\\titleformat{\\subsection}
  {\\normalfont\\normalsize\\bfseries\\color{azulSudoeste}}
  {}{0em}{}

% ---- Comando para tabela BDD ----
\\newcommand{\\tabelaBDD}[3]{%
    \\vspace{0.4cm}
    \\noindent
    \\renewcommand{\\arraystretch}{1.6}
    \\begin{tabularx}{\\textwidth}{|>{\\columncolor{cinzaClaro}\\bfseries}p{2.5cm}|X|}
        \\hline
        DADO QUE & #1 \\\\
        \\hline
        QUANDO   & #2 \\\\
        \\hline
        ENTÃO    & #3 \\\\
        \\hline
    \\end{tabularx}
    \\vspace{0.4cm}
}

% ---- Comando para bloco de resultado ----
% Altura máxima: 65% do textheight. Screenshots de mobile em portrait não
% invadem mais o rodapé, e imagens horizontais ainda usam toda a largura.
\\newcommand{\\resultadoObtido}[1]{%
    \\noindent\\textbf{RESULTADO OBTIDO:}
    \\vspace{0.3cm}

    \\noindent
    \\begin{center}
        \\includegraphics[width=\\textwidth,height=0.65\\textheight,keepaspectratio]{#1}
    \\end{center}
    \\vspace{0.3cm}
}

% =================================================================
\\begin{document}

% ================= CAPA =================
\\backgroundsetup{
  scale=1,
  angle=0,
  opacity=1,
  contents={\\includegraphics[width=\\paperwidth,height=\\paperheight]{capa.png}}
}
\\begin{titlepage}
    \\thispagestyle{empty}
    \\BgThispage
    \\null
    \\vfill
    \\begin{center}
        {\\large \\titulocapa} \\\\[0.5cm]
        {\\large \\textbf{Documento de Evidências de Teste}} \\\\[0.3cm]
        {\\normalsize \\sprintlabel}
    \\end{center}
    \\vfill
\\end{titlepage}

% ================= PÁGINAS INTERNAS =================
\\clearpage
\\backgroundsetup{
  scale=1,
  angle=0,
  opacity=1,
  contents={\\includegraphics[width=\\paperwidth,height=\\paperheight]{cabecalho.png}}
}
\\BgThispage
\\AddEverypageHook{\\BgThispage}

% ================= HISTÓRICO DE REVISÃO =================
\\section*{Histórico de Revisão}
\\addcontentsline{toc}{section}{Histórico de Revisão}

\\renewcommand{\\arraystretch}{1.5}
\\begin{tabularx}{\\textwidth}{|l|X|l|}
    \\hline
    \\rowcolor{cinzaClaro}
    \\textbf{Data} & \\textbf{Descrição} & \\textbf{Autor} \\\\
    \\hline
    ${escDate} & Criação inicial do documento de evidências de testes para ${tituloCapa}${escSprint ? ` -- Sprint ${escSprint}` : ''}. & ${escRedator} \\\\
    \\hline
\\end{tabularx}

\\newpage

% ================= SUMÁRIO =================
\\tableofcontents

\\newpage

${sectionsTex || '\\textit{Nenhum cenário cadastrado.}'}

\\end{document}
`;
}

function renderScenario(sc, idx, uploadsDir, total, opts = {}) {
  const useSubsection = !!opts.useSubsection;
  // Quando subsection, prefixa com o ID CT-001 pra alinhar com a UI e o sumário.
  const ctId = String(idx + 1).padStart(3, '0');
  const rawTitle = sc.title || `Cenário ${idx + 1}`;
  const tituloComId = useSubsection ? `CT-${ctId} — ${rawTitle}` : rawTitle;
  const title = escapeLatex(tituloComId);
  const parsed = parseBdd(sc.bdd);
  const dado = escapeLatex(parsed.dado) || '\\textit{Não informado}';
  const quando = escapeLatex(parsed.quando) || '\\textit{Não informado}';
  const entao = escapeLatex(parsed.entao) || '\\textit{Não informado}';
  const status = escapeLatex(sc.status || 'APROVADO');

  const images = Array.isArray(sc.images) ? sc.images : [];
  let resultBlock = '';
  if (images.length > 0) {
    const firstRel = images[0].path.replace(/\\/g, '/');
    resultBlock = `\\resultadoObtido{${firstRel}}\n`;
    for (let i = 1; i < images.length; i++) {
      const rel = images[i].path.replace(/\\/g, '/');
      resultBlock +=
        `\\begin{center}\\includegraphics[width=\\textwidth,height=0.65\\textheight,keepaspectratio]{${rel}}\\end{center}\n\\vspace{0.3cm}\n`;
    }
  }

  const isLast = idx === total - 1;
  // Quando agrupando por card, deixamos a quebra de página entre CARDS (no buildLatex),
  // não entre cenários do mesmo card — caso contrário cada CT vai pra página nova
  // e o documento explode em tamanho.
  const tail = isLast || useSubsection ? '' : '\n\\newpage\n';
  const heading = useSubsection ? '\\subsection' : '\\section';

  return `% =================================================================
${heading}{${title}}

\\tabelaBDD
  {${dado}}
  {${quando}}
  {${entao}}

${resultBlock}
\\noindent\\textbf{STATUS: ${status}}
${tail}`;
}
