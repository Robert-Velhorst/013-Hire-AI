ALTER TABLE `job_alerts` ADD COLUMN `check_lease_id` varchar(64) NULL;
--> statement-breakpoint
ALTER TABLE `job_alerts` ADD COLUMN `check_lease_until` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `job_alerts` DROP INDEX `job_alerts_active_frequency_checked_idx`;
--> statement-breakpoint
ALTER TABLE `job_alerts` ADD INDEX `job_alerts_due_lease_idx` (`is_active`, `frequency`, `last_checked_at`, `check_lease_until`);
