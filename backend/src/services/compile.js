import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

async function commandExists(cmd) {
  return new Promise((resolve) => {
    const checker = process.platform === 'win32'
      ? spawn('where', [cmd], { shell: true })
      : spawn('which', [cmd]);
    checker.on('error', () => resolve(false));
    checker.on('close', (code) => resolve(code === 0));
  });
}

// Com shell:true o cmd.exe re-parseia os args. Args com espaços (ex: nome
// do arquivo .tex com a sprint) precisam ser quoted manualmente — senão o
// pdflatex enxerga "Evidencias", "de", "Teste", ... como arquivos separados.
function quoteForShell(arg) {
  if (typeof arg !== 'string') return arg;
  if (!/[ "&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function runCmd(cmd, args, cwd) {
  const useShell = process.platform === 'win32';
  const finalArgs = useShell ? args.map(quoteForShell) : args;
  return new Promise((resolve) => {
    const proc = spawn(cmd, finalArgs, { cwd, shell: useShell });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr + err.message }));
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function compilePdf(texPath, cwd) {
  const fileName = path.basename(texPath);
  const baseName = fileName.replace(/\.tex$/, '');
  const pdfPath = path.join(cwd, `${baseName}.pdf`);

  let lastResult = null;
  const hasLatexmk = await commandExists('latexmk');
  if (hasLatexmk) {
    lastResult = await runCmd(
      'latexmk',
      ['-pdf', '-interaction=nonstopmode', '-halt-on-error', fileName],
      cwd
    );
    if (lastResult.code === 0 && (await fileExists(pdfPath))) {
      return { ok: true, pdfPath };
    }
  }

  const hasPdflatex = await commandExists('pdflatex');
  if (hasPdflatex) {
    for (let i = 0; i < 2; i++) {
      lastResult = await runCmd('pdflatex', ['-interaction=nonstopmode', fileName], cwd);
    }
    if (await fileExists(pdfPath)) {
      return { ok: true, pdfPath };
    }

    // Compilation failed. Try to extract LaTeX errors from the log file.
    const logPath = path.join(cwd, `${baseName}.log`);
    let latexErrorDetails = '';
    if (await fileExists(logPath)) {
      try {
        const logContent = await readFile(logPath, 'utf-8');
        const lines = logContent.split(/\r?\n/);
        const errors = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('!')) {
            // Grab the line with '!' and the next 4 lines
            errors.push(lines.slice(i, i + 5).join('\n'));
            i += 4;
          }
        }
        if (errors.length > 0) {
          latexErrorDetails = errors.join('\n\n');
        } else {
          // If no lines started with '!', grab the last 30 lines
          latexErrorDetails = lines.slice(-30).join('\n');
        }
      } catch (err) {
        latexErrorDetails = `Erro ao ler arquivo de log: ${err.message}`;
      }
    } else {
      latexErrorDetails = `Nenhum arquivo de log encontrado (${baseName}.log).\nStdout: ${lastResult?.stdout || ''}\nStderr: ${lastResult?.stderr || ''}`;
    }

    console.error(`[compilePdf] Erro na compilação do LaTeX:\n${latexErrorDetails}`);

    return {
      ok: false,
      error: `pdflatex executou mas o PDF não foi produzido. Detalhes do erro:\n${latexErrorDetails}`,
    };
  }

  return {
    ok: false,
    error: 'Nenhum compilador LaTeX encontrado (pdflatex / latexmk). Instale MiKTeX ou TeX Live.',
  };
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
