# PlanEvidences

QA Suite unificada — gerador de casos de teste a partir de HU (com IA) **+** editor de evidências (anexa prints e gera PDF em LaTeX). Single-page React + um Node servindo tudo.

```
┌─────────────────────────────────────────────────────────────┐
│  /qa          Gerador de Casos (cola HU → IA → BDD)         │
│  /evidences   Editor de Evidências (anexa prints → PDF)     │
│  /api/*       Express (LaTeX, upload S3, IA e orquestração) │
│  /runner      Runner Local (Playwright MCP no computador QA)│
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
| Automação web | Runner Local + Microsoft Playwright MCP |

## Estrutura

```
/backend         Express + LaTeX (porta 4500) — também serve frontend/dist em prod
/frontend        React + Vite (dev na 5173, build → frontend/dist)
/runner          Agente local Playwright MCP (porta loopback 4317)
/deploy          Scripts PowerShell pro Smart Sig Runner (Windows Server)
```

---

## Desenvolvimento local

**Pré-requisitos:** Node 20+, npm, opcional MiKTeX/TeX Live (sem ele, gera só `.tex`).

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

## Agente de testes automatizados

O botão **Automatizar testes** aparece no Editor de Evidências quando existem cenários
associados a cards importados do SIG. A janela permite:

- selecionar vários cards de uma vez;
- marcar ou desmarcar cenários individualmente dentro de cada card;
- informar URL do sistema, URL de login e a conta do ambiente testado;
- acompanhar progresso e resultado de cada cenário;
- revisar print, console e requisições de rede quando houver falha;
- abrir **Gerar corretiva** já com a descrição e os prints encontrados pelo agente;
- publicar a corretiva no SIG usando o fluxo já existente.

### Arquitetura

O backend do PlanEvidences orquestra o lote e usa a IA já configurada para decidir a
próxima ação. O navegador é controlado pelo pacote oficial `@playwright/mcp` em um
**Runner Local**, instalado no computador do QA. Dessa forma, o navegador continua
dentro da VPN do cliente.

As ferramentas publicadas pelo Playwright MCP são registradas na API do provedor como
funções nativas. OpenAI usa function calling obrigatório, Anthropic usa `tool_use` e
Gemini usa `functionDeclarations` em modo `ANY`. A IA só consegue escolher uma função
registrada e os argumentos seguem o schema real do MCP; não existe interpretação de
nomes de ferramenta gerados como texto livre. A função virtual
`automation_complete` é usada para encerrar cada etapa com resultado estruturado.

Usuário e senha do sistema testado vão diretamente do navegador para
`127.0.0.1:4317`. Eles não são gravados no PlanEvidences e não são enviados à IA.
O backend recebe apenas os marcadores `{{USERNAME}}` e `{{PASSWORD}}`; a substituição
ocorre localmente no instante de preencher o formulário. O runner aceita chamadas
somente da origem exata configurada em `PLAN_EVIDENCES_URL` e executa um lote por vez.

Ao iniciar, o PlanEvidences abre uma aba do Runner Local e envia os dados por uma
navegação POST de nível superior. Não é usado `fetch` entre o IP público/HTTP e
`127.0.0.1`; isso mantém compatibilidade com as restrições de Local Network Access
adotadas pelo Chrome 142+ sem exigir HTTPS no ambiente interno. A aba local mostra
que o lote foi recebido e fecha automaticamente quando a execução começa.

### Instalar em cada computador de QA

O QA não precisa clonar o projeto nem instalar Node, npm ou Git. Na janela
**Execução automatizada**, clique em **Instalar Runner**, extraia o ZIP baixado e
dê dois cliques em `Instalar Runner.cmd`.

O pacote já contém Node, dependências e o **Chrome for Testing** compatível com a
versão fixada do Playwright MCP. Ele instala tudo em
`%LOCALAPPDATA%\PlanEvidencesRunner`, inicia o Runner em segundo plano e cria um
atalho na inicialização do usuário. Não exige permissão de administrador e, depois
disso, o Runner inicia automaticamente com o Windows.

Para gerar ou atualizar o ZIP no servidor do PlanEvidences:

```powershell
cd C:\sig\PlanEvidences
.\runner\build-portable.ps1 -PlanEvidencesUrl http://136.248.115.65:4500
```

O arquivo final é criado em
`downloads\PlanEvidencesRunner-Windows.zip` e passa a ser servido automaticamente
em `/downloads/PlanEvidencesRunner-Windows.zip`. A geração precisa de acesso à
internet uma única vez para baixar a versão fixada do navegador. Os computadores
dos QAs não precisam acessar npm, GitHub ou os servidores do Playwright.

O script `runner\install.ps1` continua disponível somente para desenvolvimento,
quando o repositório já está presente no computador.

No `runner\.env`, configure a mesma origem usada no navegador, sem barra final:

```env
PLAN_EVIDENCES_URL=http://136.248.115.65:4500
RUNNER_PORT=4317
RUNNER_HEADLESS=true
RUNNER_MAX_STEPS=35
```

O navegador de teste roda invisível. Para diagnóstico temporário, altere
`RUNNER_HEADLESS=false` e reinicie o Runner.
Cada lote aceita até 30 cards e 150 cenários e é executado sequencialmente para
evitar concorrência destrutiva no mesmo ambiente.

Antes do primeiro cenário, o agente executa uma fase exclusiva de autenticação:
localiza os campos de usuário e senha pelo snapshot de acessibilidade, preenche os
marcadores protegidos e confirma que a tela autenticada foi carregada. A mesma sessão
é reutilizada nos demais cards e cenários do lote. O Runner também confirma localmente
o desaparecimento do formulário de login, evitando ciclos da IA. Credencial recusada,
captcha, MFA e ausência de progresso geram mensagem específica, print e diagnóstico
técnico no primeiro cenário bloqueado.

As capturas de falha são armazenadas em
`automation/<usuario>/<execucao>/<cenario>/` e podem ser anexadas diretamente à
corretiva. Elas continuam separadas das imagens de aprovação do critério BDD e,
portanto, não entram automaticamente no documento final de evidências.

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

Pra autenticar os usuários e publicar corretivas diretamente no SIG, configure no `backend/.env`:

```env
SIG_API_URL=https://sigv3.sudoesteinformatica.com.br/sig_v3
SIG_WEB_URL=https://sigv3.sudoesteinformatica.com.br
SIG_CORRECTIVE_ACTIVITY_ID=10
SESSION_TTL_HOURS=8
SESSION_COOKIE_SECURE=false
```

Cada pessoa entra no PlanEvidences com o mesmo usuário e senha usados no SIG. A senha é
encaminhada apenas durante o login e não é gravada pelo PlanEvidences. O backend mantém em memória
somente os tokens temporários retornados pelo SIG; portanto, reiniciar o serviço encerra as sessões.
Ao publicar, o card é criado com o token do usuário conectado, preservando a autoria no SIG.

O backend localiza o card de melhoria informado no cenário e herda dele o projeto e a sprint.
Categoria, origem, tempo previsto e atividade são validados no servidor antes da publicação.

Os **prints do erro** adicionados na janela "Criar corretiva" são independentes das imagens de
evidência do cenário. Eles são armazenados em um caminho dedicado
`correctives/<usuario>/<requestId>/`
e, depois que o SIG retorna o ID do novo card, enviados como anexos reais para
`/kanban/cases/<id>/attachments`. São aceitos até 10 arquivos PNG/JPG, com limite de 20 MB cada.
As imagens anexadas ao critério BDD continuam exclusivas do documento final e nunca são
selecionadas automaticamente para a corretiva. Esse fluxo depende das configurações `STORAGE_*`.

> O ambiente atual usa HTTP apenas por estar restrito à rede interna. Nesse modo,
> `SESSION_COOKIE_SECURE=false`. Quando o serviço receber HTTPS, altere para `true`; sem HTTPS,
> usuário e senha não são criptografados durante o tráfego entre navegador e servidor.

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

# Atualiza e também gera o ZIP offline usado pelo botão "Instalar Runner"
.\deploy\update.ps1 -RestartService -BuildRunnerPackage

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
| POST | `/api/ai-analyze/bug-card` | Gera card padronizado de corretiva a partir do relato do QA |
| GET | `/api/sig/status` | Informa se a integração com o SIG está configurada |
| POST | `/api/sig/correctives` | Publica a corretiva no projeto e sprint do card de melhoria |
| POST | `/api/automation/runs` | Cria lote com vários cards/cenários |
| GET | `/api/automation/runs/:id` | Consulta progresso e resultados do lote |
| POST | `/api/automation/runs/:id/cancel` | Solicita cancelamento |
| GET/PATCH | `/api/automation-runner/runs/:id` | Canal autenticado do Runner Local |
| POST | `/api/automation-runner/runs/:id/decision` | Obtém próxima ação do agente |
| POST | `/api/automation-runner/runs/:id/evidence` | Recebe print de falha |
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
