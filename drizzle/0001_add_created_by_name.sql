SET @exist_revenues := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='revenues' AND COLUMN_NAME='createdByName');
SET @sql_revenues := IF(@exist_revenues=0, 'ALTER TABLE `revenues` ADD COLUMN `createdByName` varchar(200)', 'SELECT 1');
PREPARE stmt FROM @sql_revenues;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @exist_expenses := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses' AND COLUMN_NAME='createdByName');
SET @sql_expenses := IF(@exist_expenses=0, 'ALTER TABLE `expenses` ADD COLUMN `createdByName` varchar(200)', 'SELECT 1');
PREPARE stmt FROM @sql_expenses;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
--> statement-breakpoint
SET @exist_payables := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payables' AND COLUMN_NAME='createdByName');
SET @sql_payables := IF(@exist_payables=0, 'ALTER TABLE `payables` ADD COLUMN `createdByName` varchar(200)', 'SELECT 1');
PREPARE stmt FROM @sql_payables;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
