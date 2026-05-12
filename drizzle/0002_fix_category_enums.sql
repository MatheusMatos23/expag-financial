ALTER TABLE `expenses` MODIFY COLUMN `category` ENUM('bancaria','api','tecnologia','infra','operacional','comercial','folha','comissao','impostos','reembolso','chargeback','estorno','marketing','juridico','administrativo','outros') NOT NULL;
--> statement-breakpoint
ALTER TABLE `payables` MODIFY COLUMN `category` ENUM('bancaria','api','tecnologia','infra','operacional','comercial','folha','comissao','impostos','reembolso','marketing','juridico','administrativo','outros') NOT NULL;
