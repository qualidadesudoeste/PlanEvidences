import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
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

function runCmd(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: process.platform === 'win32' });
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

  const hasLatexmk = await commandExists('latexmk');
  if (hasLatexmk) {
    const r = await runCmd(
      'latexmk',
      ['-pdf', '-interaction=nonstopmode', '-halt-on-error', fileName],
      cwd
    );
    if (r.code === 0 && (await fileExists(pdfPath))) {
      return { ok: true, pdfPath };
    }
  }

  const hasPdflatex = await commandExists('pdflatex');
  if (hasPdflatex) {
    for (let i = 0; i < 2; i++) {
      await runCmd('pdflatex', ['-interaction=nonstopmode', fileName], cwd);
    }
    if (await fileExists(pdfPath)) {
      return { ok: true, pdfPath };
    }
    return { ok: false, error: 'pdflatex executou mas o PDF não foi produzido. Verifique erros de LaTeX.' };
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
