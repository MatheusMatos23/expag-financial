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

## Auditoria geral (commit `____`)

Varredura completa do sistema. Confronto procedure-a-procedure backend↔frontend,
auditoria de invalidação de cache e revisão dos fluxos críticos.

### Corrigido
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
- [x] **Testes de regressão** — nova suíte `tests/cache-invalidation.test.ts`
      com 14 testes que falham se alguém remover o invalidate de funções
      sensíveis no `db.ts`.

### Não é bug (verificado, deixei como está)
- Procedures backend não usadas no frontend: `system.health`, `system.notifyOwner`,
  `reconciliation.findSuspiciousPairsForDivergence`, `reconciliation.parseStatementFile`,
  `reconciliation.processExcel`, `reconciliation.getManualAdjustments`,
  `reconciliation.getReconciliationStatus`, `reconciliation.getSessionBanks`
  → utilitárias, admin ou chamadas internas.
- `reconciliation.deleteDivergence` → cross-reference mostrou OK (estava na
  lista de "frontend chama mas backend não tem" mas o backend tem;
  era falso positivo do meu grep inicial que não pegava `adminProcedure`).

### Pendente (feature gap, não bug)
- [ ] **DRE não tem UI de override manual** — backend `accounting.upsertDRE`
      existe, mas a tela só lista valores auto-calculados de receitas/despesas
      e tem botão de DELETAR. Falta um formulário para sobrescrever um mês
      manualmente (campos: receita bruta, custos financeiros/operacionais,
      despesas administrativas/comerciais, impostos).
- [ ] **CashFlow não tem UI de override manual** — backend `accounting.upsertCashFlow`
      existe, mas a tela é só read-only. Mesma situação do DRE: falta form
      para sobrescrever um dia.
- [ ] **Loans sem edit/delete na UI** — backend `controllership.updateLoan` e
      `controllership.deleteLoan` existem; UI tem botão "Editar valores" só
      para o pagamento de parcela (não para o empréstimo em si).

### Dead code identificado (deixei pra remover depois)
- `controllership.getCreditPortfolio` → duplicata exata de `controllership.getLoans`.
- `controllership.updatePayableStatus` → superado por `updatePayable`.
- `dashboard.getSummary` → versão antiga, Dashboard usa queries específicas.
- `dashboard.getSystemConfig` / `setSystemConfig` → UI de config nunca foi feita.
- `server/reconciliation/engine.ts` vs `server/modules/reconciliation/engine.ts`
  → ambos em uso (`reconcileMultiBank` no fluxo inline, `runReconciliationEngine`
  na conciliação assíncrona). Nada para remover, mas vale documentar.

### Observações arquiteturais
- Backend tem cache in-memory com TTLs curtos (5–10s) só para 4 chaves de
  reconciliação. NÃO há cache para controllership/accounting — essas queries
  sempre vão ao DB. A correção de cache no backend só importa para os caches
  existentes; a maior parte do "delay" era do React Query no frontend.
- O motor de conciliação tem dois caminhos (engine inline + engine async), o
  que pode mascarar inconsistências. Vale uma sessão dedicada para revisar
  só o motor.
