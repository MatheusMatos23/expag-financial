import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Hook que devolve um disparador único para invalidar todos os caches
 * que dependem do estado financeiro do sistema. Use em mutations que
 * afetam dados visíveis em mais de uma tela (Receitas, Despesas, Pagáveis,
 * Conciliações, Divergências, NID, Boletos, Saldo Gerencial, Dashboard, DRE).
 *
 * Antes desta normalização, cada mutation invalidava só a própria query —
 * resultado: depois de mover divergência para Receitas, o Dashboard mostrava
 * o valor antigo até o próximo poll (8-30s) ou até o usuário clicar Atualizar.
 *
 * Esta função invalida em paralelo:
 *  - reconciliation.*    → sessões, divergências, saldos bancários, boletos, NID
 *  - controllership.*    → dashboard financeiro, receitas, despesas, pagáveis, loans
 *  - accounting.*        → DRE, fluxo de caixa, centros de custo
 *  - dashboard.*         → alertas, audit, summary
 *
 * Como ALL queries marcadas como observed serão re-fetchadas, o custo é
 * proporcional ao que está na tela atual + nas telas montadas em cache.
 *
 * Uso:
 *   const invalidateAll = useInvalidateFinancialData();
 *   const mut = trpc.X.create.useMutation({ onSuccess: () => invalidateAll() });
 */
export function useInvalidateFinancialData() {
  const utils = trpc.useUtils();
  return useCallback(() => {
    void utils.reconciliation.invalidate();
    void utils.controllership.invalidate();
    void utils.accounting.invalidate();
    void utils.dashboard.invalidate();
  }, [utils]);
}
