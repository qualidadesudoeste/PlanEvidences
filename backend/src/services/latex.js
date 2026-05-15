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
  const s = String(input);
  return s.replace(/[\\&%$#_{}~^]/g, (c) => ESCAPES[c]);
}

function escapeMultiline(input) {
  return escapeLatex(input)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\\\\\n');
}

function scenarioCode(index) {
  return `CT-${String(index + 1).padStart(3, '0')}`;
}

function todayBR() {
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const d = new Date();
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

export function buildLatex(project, { uploadsDir }) {
  const {
    projectName = '',
    sprintName = '',
    version = '1.0',
    redator = '',
    clientName = '',
    sprintObjective = '',
    testScope = '',
    scenarios = [],
  } = project;

  const escProject = escapeLatex(projectName);
  const escSprint = escapeLatex(sprintName);
  const escVersion = escapeLatex(version);
  const escRedator = escapeLatex(redator);
  const escClient = escapeLatex(clientName);
  const escObjective = escapeLatex(sprintObjective);
  const escScope = escapeLatex(testScope);
  const escDate = escapeLatex(todayBR());

  const scenariosTex = scenarios
    .map((sc, idx) => renderScenario(sc, idx, uploadsDir))
    .join('\n\n');

  return `\\documentclass[12pt, a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[brazil]{babel}
\\usepackage{geometry}
\\usepackage{graphicx}
\\usepackage{float}
\\usepackage{booktabs}
\\usepackage{background}
\\usepackage{mathptmx}
\\usepackage{xcolor}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage{enumitem}

\\geometry{a4paper, left=2cm, right=2cm, top=3.5cm, bottom=2.5cm}

\\definecolor{primary}{HTML}{1E3A8A}
\\definecolor{secondary}{HTML}{475569}

\\hypersetup{
  colorlinks=true,
  linkcolor=primary,
  urlcolor=primary,
  pdftitle={Evidencias de Teste - ${escSprint}},
  pdfauthor={${escRedator}}
}

\\titleformat{\\section}{\\Large\\bfseries\\color{primary}}{\\thesection}{1em}{}
\\titleformat{\\subsection}{\\large\\bfseries\\color{secondary}}{\\thesubsection}{1em}{}

\\backgroundsetup{
  scale=1,
  color=black,
  opacity=1,
  angle=0,
  contents={ }
}

\\newcommand{\\sprintnum}{${escSprint}}
\\newcommand{\\docversion}{${escVersion}}
\\newcommand{\\redator}{${escRedator}}
\\newcommand{\\datacriacao}{${escDate}}
\\newcommand{\\clientename}{${escClient}}
\\newcommand{\\projeto}{${escProject}}

\\begin{document}

% =====================================================
% CAPA
% =====================================================
\\begin{titlepage}
  \\centering
  \\vspace*{4cm}

  {\\Huge\\bfseries \\projeto{} -- \\clientename \\par}
  \\vspace{1.2cm}
  {\\LARGE\\bfseries Plano de Testes \\par}
  \\vspace{0.5cm}
  {\\large \\sprintnum \\par}
  \\vspace{0.35cm}
  {\\normalsize\\bfseries Versão: \\docversion \\par}
  \\vspace{0.3cm}
  {\\normalsize\\bfseries Data: \\datacriacao \\par}

  \\vfill
\\end{titlepage}

% =====================================================
% SUMÁRIO
% =====================================================
\\tableofcontents
\\newpage

% =====================================================
% HISTÓRICO DE REVISÃO
% =====================================================
\\section{Histórico de Revisão}
\\begin{table}[H]
\\centering
\\begin{tabular}{|c|c|l|l|}
\\hline
\\textbf{Versão} & \\textbf{Data} & \\textbf{Responsável} & \\textbf{Descrição} \\\\
\\hline
\\docversion & \\datacriacao & \\redator & Criação do documento \\\\
\\hline
\\end{tabular}
\\end{table}

% =====================================================
% OBJETIVO
% =====================================================
\\section{Objetivo}
${escObjective || 'Documentar as evidências dos testes executados durante a sprint.'}

% =====================================================
% ESCOPO
% =====================================================
\\section{Escopo de Testes}
${escScope || 'Não informado.'}

% =====================================================
% CENÁRIOS
% =====================================================
\\section{Cenários de Teste}
${scenariosTex || '\\textit{Nenhum cenário cadastrado.}'}

% =====================================================
% RESULTADO FINAL
% =====================================================
\\newpage
\\section{Resultado Final}
A execução dos cenários descritos neste documento permite a validação do escopo definido para a sprint \\sprintnum. As evidências apresentadas demonstram a conformidade dos testes realizados com os requisitos especificados.

\\vspace{1cm}
\\noindent\\textbf{Total de cenários executados:} ${scenarios.length}

\\vspace{2cm}
\\begin{flushright}
\\rule{6cm}{0.4pt}\\\\
\\redator\\\\
Analista de Testes
\\end{flushright}

\\end{document}
`;
}

function renderScenario(sc, idx, uploadsDir) {
  const number = `1.1.${idx + 1}`;
  const title = escapeLatex(sc.title || 'Cenário sem título');
  const id = scenarioCode(idx);
  const bdd = escapeMultiline(sc.bdd || '');
  const evidencia = escapeLatex(sc.evidence || '');

  const images = Array.isArray(sc.images) ? sc.images : [];
  const imagesTex = images
    .map((img) => {
      if (!img?.path) return '';
      const absolute = path.join(uploadsDir, img.path).replace(/\\/g, '/');
      return `\\begin{figure}[H]
\\centering
\\includegraphics[width=0.85\\linewidth,keepaspectratio]{${absolute}}
\\end{figure}`;
    })
    .filter(Boolean)
    .join('\n');

  return `\\subsection*{Cenário ${number} -- ${title}}
\\noindent\\textbf{ID:} ${id}\\\\[6pt]
${bdd || '\\textit{Critério BDD não informado.}'}\\\\[6pt]
\\textbf{Evidências:} ${evidencia || '\\rule{7cm}{0.4pt}'}

${imagesTex}

\\vspace{0.5cm}`;
}
