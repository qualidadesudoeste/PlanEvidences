# PlanEvidences

QA Suite unificada — gerador de casos de teste a partir de HU (com IA) **+** editor de evidências (anexa prints e gera PDF em LaTeX). Single-page React + um Node servindo tudo.

```
┌─────────────────────────────────────────────────────────────┐
│  /qa          Gerador de Casos (cola HU → IA → BDD)         │
│  /evidences   Editor de Evidências (anexa prints → PDF)     │
│  /api/*       Express (LaTeX, upload S3, proxy IA)          │
└─────────────────────────────────────────────────────────────┘
```

## Stack

| Camada | Tech |
|--------|------|
| Frontend | React 18 + TypeScript + Vite + Tailwind + Radix |
| Backend | Node 18+ + Express + Multer + Sharp + LaTeX (pdflatex) |
| IA | Anthropic / OpenAI / Gemini (escolha por requisição ou via env) |
| Banco | Supabase (planos, execuções, falhas) — opcional pro gerador básico |
| Storage | S3-compatível (Supabase Storage / R2 / MinIO) — só pras evidências |
| Postgres | Histórico de PDFs gerados — opcional |

## Estrutura

```
/backend         Express + LaTeX (porta 4500) — também serve frontend/dist em prod
/frontend        React + Vite (dev na 5173, build → frontend/dist)
/deploy          Scripts PowerShell pro Smart Sig Runner (Windows Server)
```

---

## Desenvolvimento local

**Pré-requisitos:** Node 18+, npm, opcional MiKTeX/TeX Live (sem ele, gera só `.tex`).

```powershell
# Terminal 1 — backend
cd backend
copy .env.example .env   # edite com chaves de IA / Supabase / etc
npm install
npm run dev               # http://localhost:4500

# Terminal 2 — frontend (HMR)
cd frontend
copy .env.example .env   # edite com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev               # http://localhost:5173 (proxy /api → :4500)
```

A app abre na `5173` em dev. Em produção é `4500` (mesmo Node servindo o build).

---

## Deploy: Smart Sig Runner (Windows Server)

Setup recomendado: **um único Node** servindo o frontend buildado e a API, registrado como Windows Service via `nssm`.

### 1. Clonar e instalar

```powershell
# Como qualquer usuário com acesso de escrita
cd C:\sig
git clone <url-do-repo> PlanEvidences
cd PlanEvidences

# Pré-flight + npm install + build do frontend
.\deploy\install.ps1
```

O script verifica Node/npm/git/MiKTeX, cria os `.env` a partir dos `.env.example` se não existirem, e roda `npm ci` + `npm run build`.

### 2. Configurar credenciais

Edite os dois `.env`:

```powershell
notepad backend\.env
notepad frontend\.env
```

Mínimo pro gerador rodar: chave de IA em `backend/.env` (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY`) **ou** o usuário configura no navegador via "Configurações de IA".

Pra Editor de Evidências completo: `STORAGE_*` (S3-compatível) + `DATABASE_URL` (Postgres).

Mudou `frontend/.env`? roda o build de novo:

```powershell
cd frontend; npm run build; cd ..
```

### 3. Testar manualmente

```powershell
cd backend
npm start
# [backend] listening on :4500
```

Acesse `http://localhost:4500` — frontend + API na mesma porta.
Da intranet: `http://<ip-do-servidor>:4500`.

### 4. Registrar como Windows Service (autostart)

Pré-requisito: `winget install NSSM.NSSM` (ou baixar de https://nssm.cc/).

```powershell
# Como Administrator
.\deploy\service-install.ps1
```

O script:

- Cria o serviço `PlanEvidences` apontando pra `node backend/src/server.js`
- Configura `AppDirectory`, restart automático, logs em `logs/stdout.log` e `logs/stderr.log` (rotacionados a 10MB)
- Inicia o serviço

Operações depois:

```powershell
nssm status PlanEvidences
nssm restart PlanEvidences
nssm stop PlanEvidences
nssm start PlanEvidences

# Remover totalmente
.\deploy\service-install.ps1 -Uninstall
```

### 5. Atualizar versão

```powershell
cd C:\sig\PlanEvidences

# Como Administrator (pra reiniciar o serviço)
.\deploy\update.ps1 -RestartService

# Sem admin: o script faz git pull + rebuild, e você reinicia depois com nssm
.\deploy\update.ps1
```

### Porta ocupada / mudança de porta

O default é **4500**. Pra mudar, edite `PORT=` em `backend/.env` e reinicie. Confirme com:

```powershell
Get-NetTCPConnection -LocalPort 4500
```

### HTTPS na intranet

Sem domínio público, fica HTTP. Se quiser HTTPS depois:

- Reverse proxy local (IIS / nginx) com cert auto-assinado ou Let's Encrypt
- Cloudflare Tunnel ou Tailscale (sem precisar abrir porta)

---

## Schema do Supabase

Crie no SQL Editor (mesmo schema do QA Assistant legado):

```sql
create extension if not exists "pgcrypto";

create table if not exists public.test_plans (
  id uuid primary key default gen_random_uuid(),
  projeto text not null,
  sprint text not null,
  tela text,
  hu text not null,
  hu_hash text not null,
  tipo_sistema text,
  criticidade text,
  resultado_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_plans_unique_key unique (projeto, sprint, hu_hash)
);

create table if not exists public.test_case_executions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.test_plans(id) on delete cascade,
  case_id text not null,
  titulo text,
  tipo text,
  origem text,
  status text not null default 'nao_executado'
    check (status in ('nao_executado','passou','falhou')),
  fail_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint test_case_executions_unique unique (plan_id, case_id)
);

create table if not exists public.test_case_fail_history (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.test_plans(id) on delete cascade,
  case_id text not null,
  observacao text,
  created_at timestamptz not null default now()
);

create table if not exists public.evidence_projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  sprint_name text,
  project_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_test_plans_touch on public.test_plans;
create trigger trg_test_plans_touch before update on public.test_plans
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_evidence_projects_touch on public.evidence_projects;
create trigger trg_evidence_projects_touch before update on public.evidence_projects
  for each row execute function public.touch_updated_at();

alter table public.test_plans enable row level security;
alter table public.test_case_executions enable row level security;
alter table public.test_case_fail_history enable row level security;
alter table public.evidence_projects enable row level security;
create policy "anon all test_plans" on public.test_plans for all using (true) with check (true);
create policy "anon all executions" on public.test_case_executions for all using (true) with check (true);
create policy "anon all fail_history" on public.test_case_fail_history for all using (true) with check (true);
create policy "anon all evidence_projects" on public.evidence_projects for all using (true) with check (true);
```

Storage: crie um bucket público chamado `planevidences` (Storage → New bucket → Public).

---

## Endpoints

| Método | Rota | Função |
|--------|------|--------|
| GET | `/api/health` | Healthcheck |
| GET | `/api/ai-analyze` | Status de IA configurada no servidor |
| POST | `/api/ai-analyze` | Análise IA (recebe cards, devolve casos) |
| POST | `/api/upload` | Upload de imagem (S3) |
| POST | `/api/documents` | Compila LaTeX → PDF |
| GET | `/api/documents` | Lista histórico de documentos gerados |
| GET | `/*` (não-API) | SPA do React (frontend/dist) |

---

## Deploy alternativo: Vercel + Render (legado)

Mantido como alternativa caso queira separar frontend/backend:

- **Frontend** → Vercel (build `npm run build`, output `dist/`)
- **Backend** → Render via `render.yaml` + `backend/Dockerfile`
- Configure `ALLOWED_ORIGINS` no backend e `VITE_API_URL` no frontend

Detalhes nos arquivos `render.yaml` e `backend/Dockerfile`.

---

## Migração do QA Assistant legado

O repositório `gerador-testes-hu` (QA Assistant standalone em HTML/JS vanilla) foi unificado neste projeto. Tudo o que ele fazia agora está em `/qa`:

- Geração de casos a partir de HU (com IA)
- Import JSON/PDF/DOCX (SIG)
- Heurísticas de teste (20 categorias)
- Cobertura e riscos
- Status de execução (passou/falhou) + histórico de falhas
- Save/retomar plano no Supabase
- Exportar Markdown / JSON BDD / Template SIG

Não há migração de dados — os dois sistemas usavam a mesma tabela `test_plans`. Planos antigos aparecem em "Retomar plano".

---

## Licença

MIT (ou conforme licença do repositório).
