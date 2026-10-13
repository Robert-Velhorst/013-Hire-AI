CREATE TABLE `stripe_reconciliation_commands` (
  `id` int NOT NULL AUTO_INCREMENT,
  `success_fee_id` int NOT NULL,
  `stripe_subscription_id` varchar(255) NOT NULL,
  `command_key` varchar(64) NOT NULL,
  `action` enum('pause','resume','cancel') NOT NULL,
  `status` enum('pending','processing','succeeded','failed','superseded') NOT NULL DEFAULT 'pending',
  `attempt_count` int NOT NULL DEFAULT 0,
  `last_error_code` varchar(120),
  `next_attempt_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_attempt_at` timestamp,
  `lease_id` varchar(64),
  `lease_expires_at` timestamp,
  `completed_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `stripe_reconciliation_commands_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_reconciliation_command_key_unique` ON `stripe_reconciliation_commands` (`command_key`);
--> statement-breakpoint
CREATE INDEX `stripe_reconciliation_status_next_id_idx` ON `stripe_reconciliation_commands` (`status`,`next_attempt_at`,`id`);
--> statement-breakpoint
CREATE INDEX `stripe_reconciliation_fee_created_idx` ON `stripe_reconciliation_commands` (`success_fee_id`,`created_at`,`id`);
