ALTER TABLE `revenues` ADD COLUMN IF NOT EXISTS `createdByName` varchar(200);
--> statement-breakpoint
ALTER TABLE `expenses` ADD COLUMN IF NOT EXISTS `createdByName` varchar(200);
--> statement-breakpoint
ALTER TABLE `payables` ADD COLUMN IF NOT EXISTS `createdByName` varchar(200);
