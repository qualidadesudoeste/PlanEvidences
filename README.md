# PlanEvidences — Gerador de Evidências de Teste QA

Sistema web para geração automática de documentação de evidências de testes em LaTeX e PDF, com histórico persistente.

## Stack

- **Frontend:** React + TypeScript + Vite + CSS custom (hospedado no Vercel)
- **Backend:** Node + Express + Multer + Sharp + LaTeX (hospedado no Render via Docker)
- **Storage + Banco:** Supabase (free tier, sem cartão de crédito)
- Compatível com qualquer S3-compatible (R2, AWS S3, MinIO) trocando as env vars

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

### 1. Supabase (banco + storage, sem cartão)

1. https://supabase.com → **Start your project** (login com GitHub)
2. **New project**:
   - Name: `planevidences`
   - Database password: gere uma forte (anote!)
   - Region: a mais perto do seu Render (ex: `East US`)
3. Aguarde ~2min até o projeto provisionar.

**Pegue a connection string do Postgres:**
- **Settings (engrenagem) → Database → Connection string**
- Aba **URI** → modo **Transaction (pooler)** → copie a string completa
- Substitua `[YOUR-PASSWORD]` pela senha que você definiu
- Vai ficar tipo: `postgresql://postgres.xxxx:senha@aws-0-us-east-1.pooler.supabase.com:5432/postgres`

**Crie o bucket de storage:**
- Menu lateral → **Storage** → **New bucket**
- Name: `planevidences`
- **Public bucket:** marque (ativa)
- Create

**Gere as credenciais S3:**
- **Settings → Storage → S3 Connection**
- Anote o **Endpoint** (algo como `https://SEU-PROJETO.supabase.co/storage/v1/s3`)
- Anote a **Region** (geralmente `us-east-1` ou similar)
- Clique em **New access key** → cria
- Anote **Access key ID** e **Secret access key** (aparece uma única vez)

**URL pública do bucket** (você monta):
- Formato: `https://SEU-PROJETO.supabase.co/storage/v1/object/public/planevidences`

### 2. Backend no Render

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
   | `DATABASE_URL` | Connection string Supabase (URI Transaction pooler) |
   | `STORAGE_ENDPOINT` | `https://SEU-PROJETO.supabase.co/storage/v1/s3` |
   | `STORAGE_REGION` | `us-east-1` (ou a que Supabase mostrar) |
   | `STORAGE_ACCESS_KEY_ID` | Access key do Supabase Storage |
   | `STORAGE_SECRET_ACCESS_KEY` | Secret access key |
   | `STORAGE_BUCKET` | `planevidences` |
   | `STORAGE_PUBLIC_URL` | `https://SEU-PROJETO.supabase.co/storage/v1/object/public/planevidences` |
   | `ALLOWED_ORIGINS` | (deixe vazio por enquanto) |
5. **Create Web Service**. Build leva ~5-8min na primeira vez (TeX Live).
6. Teste: `https://SEU-BACKEND.onrender.com/api/health` → `{"status":"ok",...}`

### 3. Frontend no Vercel

1. https://vercel.com → importa o repo
2. Configurações:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (auto)
3. **Environment Variables**: `VITE_API_URL` = URL do Render
4. Deploy.

### 4. Fechar o CORS

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
| `DATABASE_URL` | sim | Connection string Postgres (Supabase/Neon) |
| `STORAGE_ENDPOINT` | sim | Endpoint S3-compatible |
| `STORAGE_REGION` | sim | Region (`us-east-1` para Supabase, `auto` para R2) |
| `STORAGE_ACCESS_KEY_ID` | sim | Access key |
| `STORAGE_SECRET_ACCESS_KEY` | sim | Secret access key |
| `STORAGE_BUCKET` | sim | Nome do bucket |
| `STORAGE_PUBLIC_URL` | sim | URL pública do bucket |
| `ALLOWED_ORIGINS` | não | Origens permitidas no CORS (vírgula). Vazio = aberto. |
| `PORT` | não | Default 3001 (Render seta automaticamente) |

---

## Como funciona o histórico

- **Imagens** → Supabase Storage (`uploads/<sessionId>/<file>`)
- **Documentos** (.tex e .pdf) → Supabase Storage (`documents/<id>/<basename>.{tex,pdf}`)
- **Metadados** (id, cliente, sprint, versão, redator, URLs) → Supabase Postgres, tabela `documents`

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
