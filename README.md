# PlanEvidences — Gerador de Evidências de Teste QA

Sistema web para geração automática de documentação de evidências de testes em LaTeX e PDF, com histórico persistente.

## Stack

- **Frontend:** React + TypeScript + Vite + CSS custom (hospedado no Vercel)
- **Backend:** Node + Express + Multer + Sharp + LaTeX (hospedado no Render via Docker)
- **Storage de arquivos:** Cloudflare R2 (10GB grátis)
- **Banco:** Neon Postgres (3GB grátis)

## Estrutura

```
/frontend    Aplicação React
/backend     API Express
/templates   Template LaTeX base (referência)
```

---

## Desenvolvimento local

### Pré-requisitos
- Node.js 18+
- LaTeX opcional (MiKTeX/TeX Live se quiser gerar PDF local; sem ele só sai `.tex`)
- Conta no Cloudflare R2 e Neon (mesmas creds de produção, ou crie um bucket/db separado pra dev)

### Subir
```bash
# Backend (porta 3001)
cd backend
cp .env.example .env  # preencha DATABASE_URL e R2_*
npm install
npm run dev

# Frontend (porta 5173) — em outro terminal
cd frontend
npm install
npm run dev
```

Acesse http://localhost:5173.

---

## Deploy

Pré-requisito: contas configuradas no Cloudflare R2 e Neon (instruções abaixo).

### 1. Cloudflare R2 (storage)

1. https://dash.cloudflare.com → **R2 Object Storage** → ative
2. **Create bucket** → nome `planevidences`
3. Entre no bucket → **Settings** → **Public access** → habilite r2.dev subdomain. Anote a URL pública (`https://pub-xxxx.r2.dev`)
4. Menu R2 → **Manage R2 API Tokens** → **Create API Token**
   - Permissions: Object Read & Write
   - Specify bucket: `planevidences`
   - TTL: Forever
5. Anote: **Account ID**, **Access Key ID**, **Secret Access Key**

### 2. Neon Postgres (banco)

1. https://neon.tech → Sign up com GitHub
2. **Create Project** (region AWS US East, Postgres 16)
3. Copie a **Connection String** (preferência pela do "pooler" com `channel_binding=require`)

### 3. Backend no Render

1. https://render.com → login com GitHub
2. **New → Web Service** → seleciona o repo
3. Configurações:
   - **Root Directory:** `backend`
   - **Environment:** Docker
   - **Plan:** Free
   - **Health Check Path:** `/api/health`
4. **Environment Variables**:
   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | (a connection string do Neon) |
   | `R2_ACCOUNT_ID` | (Account ID do Cloudflare) |
   | `R2_ACCESS_KEY_ID` | (Access Key do R2) |
   | `R2_SECRET_ACCESS_KEY` | (Secret Access Key) |
   | `R2_BUCKET` | `planevidences` |
   | `R2_PUBLIC_URL` | (URL pub-xxxx.r2.dev) |
   | `ALLOWED_ORIGINS` | (deixe vazio por enquanto) |
5. **Create Web Service**. Build leva ~5-8min na primeira vez (TeX Live).
6. Teste: `https://SEU-BACKEND.onrender.com/api/health` → `{"status":"ok",...}`

### 4. Frontend no Vercel

1. https://vercel.com → importa o repo
2. Configurações:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (auto)
3. **Environment Variables**: `VITE_API_URL` = URL do Render
4. Deploy.

### 5. Fechar o CORS

Render → seu serviço → **Environment** → `ALLOWED_ORIGINS` = URL do Vercel. Múltiplos domínios separados por vírgula.

---

## Variáveis de ambiente

### Frontend
| Variável | Default | Descrição |
|---|---|---|
| `VITE_API_URL` | vazio (dev usa proxy) | URL pública do backend |

### Backend
| Variável | Obrigatório | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Postgres do Neon |
| `R2_ACCOUNT_ID` | sim | Account ID do Cloudflare |
| `R2_ACCESS_KEY_ID` | sim | Token R2 |
| `R2_SECRET_ACCESS_KEY` | sim | Token R2 |
| `R2_BUCKET` | sim | Nome do bucket |
| `R2_PUBLIC_URL` | sim | URL pública do bucket (pub-xxxx.r2.dev) |
| `ALLOWED_ORIGINS` | não | Origens permitidas no CORS (vírgula). Vazio = aberto. |
| `PORT` | não | Default 3001 (Render seta automaticamente) |

---

## Como funciona o histórico

- **Imagens** → Cloudflare R2 (`uploads/<sessionId>/<file>`)
- **Documentos** (.tex e .pdf) → Cloudflare R2 (`documents/<id>/<basename>.{tex,pdf}`)
- **Metadados** (id, cliente, sprint, versão, redator, URLs) → Postgres tabela `documents`

A tabela é criada automaticamente no startup do backend (`ensureSchema`).

## Funcionalidades

- Upload com drag-and-drop, compressão automática (Sharp)
- Cenários BDD com ID auto `CT-001`, `CT-002`...
- Geração LaTeX + compilação PDF (latexmk/pdflatex)
- Histórico persistente entre deploys
- Tema dark/light
- Auto-save no localStorage
- Exportar/importar projeto JSON
- Drag-and-drop para reordenar cenários
- Painel lateral de navegação
