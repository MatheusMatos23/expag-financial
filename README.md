# Expag Financial System

Sistema de gestão financeira institucional para fintechs — conciliação bancária, controladoria, contabilidade e dashboards executivos.

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 7 + TypeScript 5.9 |
| Roteamento | Wouter 3.3 |
| Estado servidor | tRPC v11 + React Query v5 |
| Estilização | TailwindCSS v4 + shadcn/ui |
| Backend | Express 4 + tRPC v11 |
| ORM | Drizzle ORM 0.44 |
| Banco de dados | MySQL 8+ |
| Testes | Vitest 2 |
| Gerenciador de pacotes | pnpm 10 |

---

## Pré-requisitos

- Node.js 20+
- pnpm 10+
- MySQL 8+ (local ou Docker)

---

## Configuração Inicial

### 1. Instalar dependências

```bash
pnpm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o arquivo `.env` e preencha as variáveis:

```env
DATABASE_URL=mysql://root:senha@localhost:3306/expag_financial
JWT_SECRET=seu_secret_aleatorio_aqui_minimo_32_caracteres
OWNER_OPEN_ID=           # preenchido após primeiro login
OAUTH_SERVER_URL=https://api.manus.app
VITE_APP_ID=             # ID da app registrada no Manus
VITE_OAUTH_PORTAL_URL=https://manus.app
```

### 3. Criar banco de dados MySQL

```sql
CREATE DATABASE expag_financial CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Ou via Docker:

```bash
docker run -d \
  --name expag-mysql \
  -e MYSQL_ROOT_PASSWORD=senha \
  -e MYSQL_DATABASE=expag_financial \
  -p 3306:3306 \
  mysql:8
```

### 4. Executar migrações

```bash
pnpm db:push
```

---

## Rodando Localmente

```bash
# Desenvolvimento (hot-reload)
pnpm dev

# Verificar TypeScript
pnpm check

# Rodar testes
pnpm test
```

O servidor inicia em `http://localhost:3000`.

---

## Estrutura do Projeto

```
expag_financial_system/
├── client/src/
│   ├── _core/hooks/        # Hooks de infraestrutura (useAuth)
│   ├── components/         # Componentes de layout e UI base
│   ├── contexts/           # ThemeContext
│   ├── hooks/              # Hooks de utilidade
│   ├── lib/                # Clientes tRPC e funções utilitárias
│   └── pages/              # 13 páginas da aplicação
├── server/
│   ├── _core/              # Infraestrutura: auth, trpc, context, env
│   ├── db.ts               # Camada de acesso a dados (Drizzle)
│   ├── routers.ts          # Rotas tRPC + lógica de negócio
│   └── storage.ts          # Upload para S3/Forge
├── drizzle/
│   ├── schema.ts           # 15 tabelas do banco de dados
│   ├── relations.ts        # Relações Drizzle para joins
│   └── migrations/         # Migrações geradas
└── shared/                 # Tipos e constantes compartilhados
```

---

## Módulos do Sistema

### Camada 1 — Conciliação Bancária
- Upload de 4 extratos Excel (Créditos/Débitos Banco × API)
- Motor de matching com 5 prioridades
- Motor de divergências com 19 categorias e 8 status
- Saldo Gerencial (Real, Próprio, Livre, Comprometido)

### Camada 2 — Controladoria
- Receitas por tipo (PIX, TED, Boleto, Crédito, Antecipação, etc.)
- Despesas por categoria (13 categorias)
- Contas a Pagar com recorrência e SLA
- Carteira de Crédito com amortização Price Table

### Camada 3 — Contabilidade
- DRE Gerencial com margens automáticas
- Fluxo de Caixa com projeções D+7, D+15, D+30
- Centros de Custo

### Dashboard Executivo
- Métricas em tempo real
- Alertas de tesouraria (caixa baixo, funding insuficiente, divergências críticas)
- Gráficos de evolução de saldos e fluxo de caixa

---

## Scripts Disponíveis

```bash
pnpm dev          # Servidor de desenvolvimento
pnpm build        # Build de produção
pnpm start        # Inicia build de produção
pnpm check        # Verificação TypeScript
pnpm test         # Executa testes Vitest
pnpm db:push      # Gera e executa migrações do banco
pnpm format       # Formata código com Prettier
```

---

## Autenticação

O sistema usa OAuth via Manus. Para login local de desenvolvimento:
1. Configure `VITE_APP_ID` e `VITE_OAUTH_PORTAL_URL` no `.env`
2. Após primeiro login, copie o `openId` e defina como `OWNER_OPEN_ID`
3. O usuário com `OWNER_OPEN_ID` recebe role `admin` automaticamente

---

## Banco de Dados

Principais tabelas:

| Tabela | Descrição |
|---|---|
| `users` | Usuários do sistema |
| `reconciliation_sessions` | Sessões de conciliação |
| `bank_transactions` | Transações importadas do banco |
| `api_transactions` | Transações importadas da API |
| `divergences` | Divergências detectadas |
| `managerial_balances` | Saldos gerenciais diários |
| `revenues` | Receitas lançadas |
| `expenses` | Despesas lançadas |
| `payables` | Contas a pagar |
| `credit_portfolio` | Carteira de crédito |
| `credit_installments` | Parcelas de crédito |
| `cost_centers` | Centros de custo |
| `dre` | DRE mensal |
| `cash_flow` | Fluxo de caixa diário |
| `alerts` | Alertas do sistema |

