# Expag Financial System - TODO

## Fase 1: Setup e Schema
- [x] Schema de banco de dados completo (15 tabelas)
- [x] Design system dark corporativo
- [x] DashboardLayout com sidebar e navegação
- [x] Roteamento das 4 camadas

## Camada 1: Conciliação
- [x] Upload de extratos Excel (4 bases)
- [x] Motor de matching com 5 prioridades
- [x] Exibição de resultados conciliados/divergentes/pendentes
- [x] Motor de Divergências com classificação automática
- [x] Gestão de divergências: 15 campos, 8 status, SLA, responsável
- [x] Motor Gerencial: Saldo Real
- [x] Visões de Caixa Próprio, Comprometido e Livre

## Camada 2: Controladoria
- [x] Movimentações globais diárias e mensais
- [x] Apuração de receitas por tipo
- [x] Mapeamento de despesas por categoria
- [x] Contas a Pagar pré-programadas
- [x] Carteira de Crédito

## Camada 3: Contabilidade
- [x] DRE Gerencial
- [x] Centros de Custo
- [x] Fluxo de Caixa completo
- [x] Projeção D+7, D+15, D+30 (calculada a partir dos dados existentes)

## Camada 4: Dashboards Executivos
- [x] Dashboard Financeiro
- [x] Dashboard Operacional
- [x] Dashboard Compliance
- [x] Dashboard Diretoria
- [x] Gráficos de tendência
- [x] Alertas de tesouraria

## Importação e Notificações
- [x] Upload Excel para as 4 bases
- [x] Processamento automático pós-upload
- [x] Notificações automáticas ao gestor (divergências críticas, caixa baixo, funding insuficiente)

## Testes e Entrega
- [x] Testes Vitest (auth.logout + 14 testes de integração das 4 camadas)
- [x] Checkpoint final

## Auditoria geral (commits `cba1267`, `38c6cfb`, `1b6012a`)

Varredura completa do sistema. Confronto procedure-a-procedure backend↔frontend,
auditoria de invalidação de cache e revisão dos fluxos críticos. Trabalho feito
em 3 commits ao longo do dia 21/05/2026.

### Corrigido em `cba1267` (auditoria principal de invalidação)
- [x] **Dashboard congelado em Receitas/Despesas/Resultado/Margem** — `getControllershipDashboard`
      não tinha `refetchInterval` e tinha `refetchOnWindowFocus: false`. Cards
      só atualizavam ao clicar "Atualizar". Agora faz polling a cada 20s e
      revalida ao focar a aba.
- [x] **Backend não invalidava cache em mutações críticas** — `moveDivergencesToRevenue`,
      `moveDivergencesToExpense`, `upsertManagerialBalance`, `resolveNdi`,
      `markDivergencesAsNdi`, `unmarkNdi`, `createManualAdjustment` faziam
      mudanças mas deixavam o cache `divergences_all` (TTL 10s) servir
      versão antiga. Todas chamam `invalidateReconciliationCaches()` agora.
- [x] **Frontend sem invalidação cross-tela** — cada página tinha seu próprio
      `invalidateAcrossScreens` com escopo diferente. Centralizado em
      `useInvalidateFinancialData()` que invalida `reconciliation` +
      `controllership` + `accounting` + `dashboard` de uma vez. 13 páginas
      adotaram o hook.
- [x] **QueryClient sem defaults explícitos** — agora declarado com `retry: 1`,
      `refetchOnWindowFocus: true`, `refetchOnReconnect: true`. Mutations
      com `retry: 0` (não re-executa após erro).
- [x] **`window.__dashboardDebug` agora captura loading/error de cada query** —
      antes só mostrava contadores; agora também `isLoading`, `isFetching`,
      `isError`, `error.message` e `dataPresent` por query.
- [x] **Testes de regressão** — `tests/cache-invalidation.test.ts` com 14
      testes que falham se alguém remover o invalidate de funções sensíveis
      no `db.ts`.

### Corrigido em `38c6cfb` (UI override DRE)
- [x] **DRE ganhou UI de override manual** — antes a página só permitia
      DELETAR overrides; agora botão "Override Manual" no header + botão
      Edit por linha. Form com 7 campos e prévia em tempo real do Resultado
      Operacional e Margem.
- [x] **`upsertDRE` e `upsertCashFlow` agora invalidam cache** —
      complementa as 7 invalidações do `cba1267`. Testes ampliados para 16.

### Corrigido em `1b6012a` (UI override CashFlow + Loans + cleanup)
- [x] **CashFlow ganhou UI de override manual** — segue o padrão do DRE.
      Form com data, saldo de abertura, entradas/saídas realizadas e
      projetadas (em `<details>` recolhido). Prévia do Saldo de Fechamento
      + aviso quando vai negativo.
- [x] **Loans (CreditPortfolio) ganhou edit/delete** — empréstimos não
      eram mais imutáveis após criação. Dialog de edit permite alterar
      status, taxa de juros (a.m.), fonte de recursos e notas. Delete
      com confirmação dupla. `principal`/`totalInstallments`/`startDate`
      ficam disabled no edit (alterá-los geraria inconsistência com as
      parcelas calculadas pela tabela Price).
- [x] **Bug colateral encontrado e corrigido** — `db.deleteCreditPortfolio`
      deletava só a linha em `credit_portfolio`, mas `credit_installments.creditId`
      não tem `ON DELETE CASCADE` no schema. Parcelas órfãs ficavam no banco.
      Agora deleta as installments antes do empréstimo (mesma transação).
- [x] **Dead code removido**: `controllership.getCreditPortfolio` (duplicata
      exata de `getLoans`).

### Pendente (feature gap, não bug)
Nada de feature gap conhecido. Próximas oportunidades de melhoria estão em
"Observações arquiteturais" abaixo.

### Dead code restante (baixa prioridade, segura para remover quando for)
- `controllership.updatePayableStatus` → superado por `updatePayable`,
  ninguém chama.
- `dashboard.getSummary` → versão antiga, Dashboard usa queries específicas.
- `dashboard.getSystemConfig` / `setSystemConfig` → UI de config nunca
  existiu, podem ser removidas.

### Não é bug (procedures backend "órfãs" verificadas)
- `system.health`, `system.notifyOwner`, `reconciliation.findSuspiciousPairsForDivergence`,
  `reconciliation.parseStatementFile`, `reconciliation.processExcel`,
  `reconciliation.getManualAdjustments`, `reconciliation.getReconciliationStatus`,
  `reconciliation.getSessionBanks`
  → utilitárias, admin ou chamadas internas. Não são chamadas por nenhuma página
  mas existem por design.

### Observações arquiteturais (não tocadas, candidatas a sessão dedicada)
- Backend tem cache in-memory com TTLs curtos (5–10s) só para 4 chaves de
  reconciliação. NÃO há cache para controllership/accounting — essas queries
  sempre vão ao DB. A correção de cache no backend só importa para os caches
  existentes; a maior parte do "delay" era do React Query no frontend.
- O motor de conciliação tem dois caminhos (`reconcileMultiBank` no fluxo
  inline, `runReconciliationEngine` na conciliação assíncrona). Ambos em uso
  e funcionais, mas a coexistência merece uma revisão dedicada para
  verificar se podem ser unificados.

### Avisos para sessões futuras
- O sandbox de Claude (`/home/claude/expag-financial`) pode ser compartilhado
  entre conversas paralelas. Os 3 commits acima foram feitos por 2 conversas
  paralelas trabalhando no mesmo arquivo de sistema. Antes de iniciar um
  trabalho, vale rodar `git fetch && git log --oneline origin/main -10` para
  ver se algo novo apareceu desde o último checkpoint.
