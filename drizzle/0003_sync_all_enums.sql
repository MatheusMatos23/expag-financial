ALTER TABLE `expenses` MODIFY COLUMN `category` ENUM('bancaria','api','tecnologia','infra','operacional','comercial','folha','comissao','impostos','reembolso','chargeback','estorno','marketing','juridico','administrativo','outros') NOT NULL;
--> statement-breakpoint
ALTER TABLE `payables` MODIFY COLUMN `category` ENUM('bancaria','api','tecnologia','infra','operacional','comercial','folha','comissao','impostos','reembolso','marketing','juridico','administrativo','outros') NOT NULL;
--> statement-breakpoint
ALTER TABLE `cost_centers` MODIFY COLUMN `type` ENUM('receita','despesa_fixa','despesa_variavel','imposto','investimento','credito') NOT NULL;
--> statement-breakpoint
ALTER TABLE `revenues` MODIFY COLUMN `type` ENUM('pix','ted','boleto','credito','antecipacao','pos','white_label','receita_financeira','receita_operacional','outros') NOT NULL;
