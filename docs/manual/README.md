# Manual de Uso — PlanEvidences

Apresentação em Beamer (LaTeX) com manual para QAs.

## Saída

[`manual.pdf`](manual.pdf) — 16 slides, ~1.2 MB.

## Como regerar

Pré-requisito: MiKTeX (Windows) ou TeX Live (Linux/Mac) com:
- `babel` (português brasileiro)
- `fontawesome5`
- `tcolorbox`
- `graphicx`, `xcolor` (geralmente já vêm)

```powershell
cd docs/manual
pdflatex -interaction=nonstopmode manual.tex
```

Rode **2x** se mexer em coisas que afetam o sumário/refs.

## Como editar o conteúdo

- **Texto**: `manual.tex` — cada slide é um `\begin{frame}...\end{frame}`
- **Imagens**: `images/` — substitua o `.png` com o mesmo nome pra atualizar
- **Cores da marca**: definidas no preâmbulo (`peGreen`, `peMuted`, etc.)
- **Caixas de destaque**: `\begin{dica}...\end{dica}` (verde) ou `\begin{atencao}...\end{atencao}` (laranja)

## Adicionar/substituir prints

Substitua os arquivos `.png` em `images/` mantendo os mesmos nomes:

| Arquivo | Slide |
|---------|-------|
| `01-qa-home.png` | Tela inicial do Gerador (/qa) |
| `02-retomar-plano.png` | Modal de retomar plano salvo |
| `03-qa-hu-preenchida.png` | HU preenchida pronta pra analisar |
| `04-casos-teste.png` | Tab Casos de Teste |
| `05-cobertura-riscos.png` | Tab Cobertura e Riscos |
| `06-heuristicas.png` | Tab Heurísticas |
| `07-editor-evidencias.png` | Editor de Evidências (visão geral) |
| `08-editor-cenario.png` | Cenário expandido com BDD + prints |

Mantenha resolução alta (≥1280×720). Vai compilando os 13 slides com `pdflatex` cada vez que quiser atualizar.
