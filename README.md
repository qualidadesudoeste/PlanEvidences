# PlanEvidences — Gerador de Evidências de Teste QA

Sistema web para geração automática de documentação de evidências de testes em LaTeX e PDF.

## Estrutura

```
/frontend    React + TypeScript + Vite + CSS custom
/backend     Node.js + Express + Multer + Sharp
/templates   Templates LaTeX
/uploads     Imagens (runtime — não versionar)
/generated   Documentos gerados (runtime — não versionar)
```

## Desenvolvimento local

### Pré-requisitos
- Node.js 18+
- LaTeX opcional (instale MiKTeX ou TeX Live se quiser gerar PDF localmente)

### Subir
```bash
# Backend (porta 3001)
cd backend
npm install
npm run dev

# Frontend (porta 5173) — em outro terminal
cd frontend
npm install
npm run dev
```

Acesse http://localhost:5173.

---

## Deploy em produção

A combinação recomendada é **Vercel (frontend)** + **Render (backend Docker com LaTeX)**.

### 1. Backend no Render

1. Acesse https://render.com e faça login com GitHub.
2. **New → Web Service** → escolha este repositório.
3. Configure:
   - **Root Directory:** `backend`
   - **Environment:** `Docker` (detecta o `Dockerfile` automaticamente)
   - **Plan:** `Free`
   - **Health Check Path:** `/api/health`
4. Variáveis de ambiente (Environment → Add Environment Variable):
   - `DATA_DIR` = `/app/data`
   - `ALLOWED_ORIGINS` = (deixe vazio por enquanto — você preenche depois do deploy do Vercel)
5. **Create Web Service**. O build leva ~5-8min (TeX Live é pesado). A primeira vez compilando PDF também é lenta.
6. Anote a URL pública gerada (ex: `https://planevidences-backend.onrender.com`).
7. Teste: `https://SEU-BACKEND.onrender.com/api/health` deve retornar `{"status":"ok",...}`.

> **Notas do plano free:**
> - Filesystem é efêmero (PDFs gerados somem em redeploy/restart, mas dão pra baixar no momento).
> - Serviço dorme após 15min sem uso. A primeira request acorda em ~30s.

Alternativa: Railway, Fly.io ou Koyeb — qualquer host que aceite Docker.

### 2. Frontend no Vercel

1. Acesse https://vercel.com e importe o repositório.
2. Configure:
   - **Root Directory:** `frontend`
   - **Framework Preset:** `Vite` (auto)
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `dist` (default)
3. Variáveis de ambiente (Environment Variables):
   - `VITE_API_URL` = URL do backend que você anotou (ex: `https://planevidences-backend.onrender.com`)
4. **Deploy**.
5. Anote a URL gerada pelo Vercel (ex: `https://planevidences.vercel.app`).

### 3. Liberar o CORS

Volte no Render → seu serviço → **Environment**:
- `ALLOWED_ORIGINS` = URL do Vercel (ex: `https://planevidences.vercel.app`)

Salve. O Render reinicia o serviço com o CORS restrito ao seu domínio.

Para múltiplos domínios (preview do Vercel, custom domain, etc.) separe por vírgula:
```
ALLOWED_ORIGINS=https://planevidences.vercel.app,https://qa.minhaempresa.com
```

### 4. Testar end-to-end

1. Abra a URL do Vercel.
2. Preencha um projeto, adicione um cenário, faça upload de uma imagem.
3. Clique em **Gerar Documento**. Deve baixar `.tex` e `.pdf`.

---

## Variáveis de ambiente

### Frontend (`frontend/.env`)
```
VITE_API_URL=https://planevidences-backend.onrender.com
```
Em dev, deixe vazio (o `vite.config.ts` proxy redireciona `/api` para `localhost:3001`).

### Backend
| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta HTTP |
| `DATA_DIR` | raiz do repo em dev | Onde salvar uploads/generated |
| `UPLOADS_DIR` | `$DATA_DIR/uploads` | Override só do diretório de uploads |
| `GENERATED_DIR` | `$DATA_DIR/generated` | Override só do diretório de gerados |
| `ALLOWED_ORIGINS` | vazio (abre tudo) | Lista de origens permitidas, separadas por vírgula |

---

## Funcionalidades

- Upload múltiplo com drag-and-drop, compressão automática (Sharp)
- Cenários BDD com ID auto-incremento `CT-001`, `CT-002`...
- Geração LaTeX + compilação PDF (latexmk/pdflatex)
- Tema dark/light
- Auto-save em localStorage
- Exportar/importar projeto JSON
- Histórico de documentos gerados
- Drag-and-drop para reordenar cenários
- Numeração automática e painel lateral de navegação
