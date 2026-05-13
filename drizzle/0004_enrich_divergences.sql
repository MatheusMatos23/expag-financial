ALTER TABLE `divergences` ADD COLUMN IF NOT EXISTS `bankDescription` varchar(500);
--> statement-breakpoint
ALTER TABLE `divergences` ADD COLUMN IF NOT EXISTS `apiDescription` varchar(500);
--> statement-breakpoint
ALTER TABLE `divergences` ADD COLUMN IF NOT EXISTS `externalId` varchar(200);
--> statement-breakpoint
ALTER TABLE `divergences` ADD COLUMN IF NOT EXISTS `bankAmount` decimal(18,2);
--> statement-breakpoint
ALTER TABLE `divergences` ADD COLUMN IF NOT EXISTS `apiAmount` decimal(18,2);
--> statement-breakpoint
ALTER TABLE `divergences` ADD COLUMN IF NOT EXISTS `transactionType` enum('credit','debit');
