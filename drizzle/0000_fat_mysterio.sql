CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('cash_shortage','negative_cash','insufficient_funding','excessive_client_balance_use','critical_divergence','overdue_payable','credit_default','concentration_excess') NOT NULL,
	`title` varchar(300) NOT NULL,
	`message` text NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
	`status` enum('active','acknowledged','resolved') NOT NULL DEFAULT 'active',
	`referenceId` int,
	`referenceType` varchar(50),
	`acknowledgedBy` int,
	`acknowledgedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `api_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`type` enum('credit','debit') NOT NULL,
	`transactionDate` date NOT NULL,
	`description` text,
	`amount` decimal(18,2) NOT NULL,
	`channel` varchar(50),
	`clientId` varchar(100),
	`clientName` varchar(200),
	`externalId` varchar(100),
	`matchStatus` enum('pending','matched','divergent','manual') NOT NULL DEFAULT 'pending',
	`matchedBankTransactionId` int,
	`matchType` enum('exact','partial','approximate','manual','divergent'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`type` enum('credit','debit') NOT NULL,
	`transactionDate` date NOT NULL,
	`description` text,
	`amount` decimal(18,2) NOT NULL,
	`channel` varchar(50),
	`bankName` varchar(100),
	`externalId` varchar(100),
	`matchStatus` enum('pending','matched','divergent','manual') NOT NULL DEFAULT 'pending',
	`matchedApiTransactionId` int,
	`matchType` enum('exact','partial','approximate','manual','divergent'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bank_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cash_flow` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referenceDate` date NOT NULL,
	`openingBalance` decimal(18,2) DEFAULT '0',
	`projectedInflows` decimal(18,2) DEFAULT '0',
	`realizedInflows` decimal(18,2) DEFAULT '0',
	`projectedOutflows` decimal(18,2) DEFAULT '0',
	`realizedOutflows` decimal(18,2) DEFAULT '0',
	`closingBalance` decimal(18,2) DEFAULT '0',
	`freeCash` decimal(18,2) DEFAULT '0',
	`committedCash` decimal(18,2) DEFAULT '0',
	`fundingNeeded` decimal(18,2) DEFAULT '0',
	`projectionD7` decimal(18,2),
	`projectionD15` decimal(18,2),
	`projectionD30` decimal(18,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cash_flow_id` PRIMARY KEY(`id`),
	CONSTRAINT `cash_flow_referenceDate_unique` UNIQUE(`referenceDate`)
);
--> statement-breakpoint
CREATE TABLE `cost_centers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`type` enum('receita','despesa_fixa','despesa_variavel','imposto','credito') NOT NULL,
	`description` text,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cost_centers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_installments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`creditId` int NOT NULL,
	`installmentNumber` int NOT NULL,
	`dueDate` date NOT NULL,
	`principalAmount` decimal(18,2) NOT NULL,
	`interestAmount` decimal(18,2) NOT NULL,
	`totalAmount` decimal(18,2) NOT NULL,
	`paidAmount` decimal(18,2) DEFAULT '0',
	`paidDate` date,
	`status` enum('pendente','pago','vencido','parcial') NOT NULL DEFAULT 'pendente',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `credit_installments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `credit_portfolio` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` varchar(100) NOT NULL,
	`clientName` varchar(200) NOT NULL,
	`principal` decimal(18,2) NOT NULL,
	`interestRate` decimal(8,4) NOT NULL,
	`totalInstallments` int NOT NULL,
	`paidInstallments` int NOT NULL DEFAULT 0,
	`totalInterestEarned` decimal(18,2) DEFAULT '0',
	`outstandingBalance` decimal(18,2) NOT NULL,
	`status` enum('ativo','quitado','inadimplente','renegociado','cancelado') NOT NULL DEFAULT 'ativo',
	`startDate` date NOT NULL,
	`expectedEndDate` date NOT NULL,
	`lastPaymentDate` date,
	`fundingSource` enum('capital_proprio','uso_custodia','externo') DEFAULT 'capital_proprio',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `credit_portfolio_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `divergences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`divergenceDate` date NOT NULL,
	`bankName` varchar(100),
	`clientId` varchar(100),
	`clientName` varchar(200),
	`divergenceType` enum('bank_surplus','bank_shortage') NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`origin` varchar(100),
	`category` enum('receita_nao_lancada','pix_sem_cliente','receita_financeira','estorno','devolucao','deposito_nao_identificado','tarifa_nao_apropriada','ted_orfa','receita_operacional','emprestimo_operacional','uso_saldo_clientes','despesa_nao_lancada','tarifa_bancaria','imposto','repasse_externo','ajuste_manual','saida_operacional','liquidacao_divergente','outros') NOT NULL,
	`subcategory` varchar(100),
	`responsible` varchar(200),
	`status` enum('pendente','em_analise','identificado','regularizado','reclassificado','baixado','em_aberto','escalado_diretoria') NOT NULL DEFAULT 'pendente',
	`slaDeadline` date,
	`priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`evidence` text,
	`observation` text,
	`actionTaken` text,
	`bankTransactionId` int,
	`apiTransactionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `divergences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dre` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referenceMonth` varchar(7) NOT NULL,
	`grossRevenue` decimal(18,2) DEFAULT '0',
	`netRevenue` decimal(18,2) DEFAULT '0',
	`financialCosts` decimal(18,2) DEFAULT '0',
	`operationalCosts` decimal(18,2) DEFAULT '0',
	`adminExpenses` decimal(18,2) DEFAULT '0',
	`commercialExpenses` decimal(18,2) DEFAULT '0',
	`taxes` decimal(18,2) DEFAULT '0',
	`operationalResult` decimal(18,2) DEFAULT '0',
	`financialResult` decimal(18,2) DEFAULT '0',
	`netProfit` decimal(18,2) DEFAULT '0',
	`margin` decimal(8,4) DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dre_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referenceDate` date NOT NULL,
	`category` enum('bancaria','api','tecnologia','infra','operacional','comercial','folha','comissao','impostos','reembolso','chargeback','estorno','outros') NOT NULL,
	`subcategory` varchar(100),
	`description` text,
	`amount` decimal(18,2) NOT NULL,
	`supplier` varchar(200),
	`status` enum('previsto','realizado','cancelado') NOT NULL DEFAULT 'realizado',
	`bankTransactionId` int,
	`costCenterId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `managerial_balances` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referenceDate` date NOT NULL,
	`bankBalance` decimal(18,2) NOT NULL DEFAULT '0',
	`clientBalance` decimal(18,2) NOT NULL DEFAULT '0',
	`committedBalance` decimal(18,2) NOT NULL DEFAULT '0',
	`divergenceBalance` decimal(18,2) NOT NULL DEFAULT '0',
	`realCash` decimal(18,2) NOT NULL DEFAULT '0',
	`ownCash` decimal(18,2) NOT NULL DEFAULT '0',
	`committedCash` decimal(18,2) NOT NULL DEFAULT '0',
	`freeCash` decimal(18,2) NOT NULL DEFAULT '0',
	`thirdPartyResources` decimal(18,2) DEFAULT '0',
	`futureObligations` decimal(18,2) DEFAULT '0',
	`fundingNeeded` decimal(18,2) DEFAULT '0',
	`openDivergences` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `managerial_balances_id` PRIMARY KEY(`id`),
	CONSTRAINT `managerial_balances_referenceDate_unique` UNIQUE(`referenceDate`)
);
--> statement-breakpoint
CREATE TABLE `payables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`description` text NOT NULL,
	`supplier` varchar(200),
	`category` enum('bancaria','api','tecnologia','infra','operacional','comercial','folha','comissao','impostos','reembolso','outros') NOT NULL,
	`amount` decimal(18,2) NOT NULL,
	`dueDate` date NOT NULL,
	`paidDate` date,
	`status` enum('pendente','pago','vencido','cancelado') NOT NULL DEFAULT 'pendente',
	`recurrent` boolean DEFAULT false,
	`recurrenceDay` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reconciliation_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`referenceDate` date NOT NULL,
	`status` enum('processing','completed','error') NOT NULL DEFAULT 'processing',
	`totalBankCredits` decimal(18,2) DEFAULT '0',
	`totalBankDebits` decimal(18,2) DEFAULT '0',
	`totalApiCredits` decimal(18,2) DEFAULT '0',
	`totalApiDebits` decimal(18,2) DEFAULT '0',
	`matchedCount` int DEFAULT 0,
	`divergentCount` int DEFAULT 0,
	`pendingCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reconciliation_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `revenues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referenceDate` date NOT NULL,
	`type` enum('pix','ted','boleto','credito','antecipacao','pos','white_label','receita_financeira','receita_operacional','outros') NOT NULL,
	`description` text,
	`amount` decimal(18,2) NOT NULL,
	`clientId` varchar(100),
	`clientName` varchar(200),
	`status` enum('previsto','realizado','cancelado') NOT NULL DEFAULT 'realizado',
	`bankTransactionId` int,
	`costCenterId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `revenues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`description` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_config_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
