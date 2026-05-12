ALTER TABLE `revenues` ADD COLUMN `createdByName` varchar(200);
--> statement-breakpoint
ALTER TABLE `expenses` ADD COLUMN `createdByName` varchar(200);
--> statement-breakpoint
ALTER TABLE `payables` ADD COLUMN `createdByName` varchar(200);
