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
