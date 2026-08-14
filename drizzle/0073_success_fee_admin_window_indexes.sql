CREATE INDEX `success_fees_created_id_idx` ON `success_fees` (`created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `success_fees_status_created_id_idx` ON `success_fees` (`status`, `created_at`, `id`);
