ALTER TABLE `job_alerts` ADD COLUMN `last_checked_at` timestamp NULL;
--> statement-breakpoint
UPDATE `job_alerts` SET `last_checked_at` = `last_triggered` WHERE `last_triggered` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `job_alerts` DROP INDEX `job_alerts_active_frequency_triggered_idx`;
--> statement-breakpoint
ALTER TABLE `job_alerts` ADD INDEX `job_alerts_active_frequency_checked_idx` (`is_active`, `frequency`, `last_checked_at`);
