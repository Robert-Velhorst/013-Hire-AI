CREATE TABLE `connector_revocation_obligations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`provider` enum('gmail','google_drive','dropbox','outlook','linkedin','github') NOT NULL,
	`status` enum('manual_required','retry_required','completed') NOT NULL DEFAULT 'retry_required',
	`active_identity` varchar(180) GENERATED ALWAYS AS (CASE
    WHEN status IN ('manual_required', 'retry_required')
    THEN CONCAT(user_id, ':', provider)
    ELSE NULL
  END) VIRTUAL,
	`instruction_version` varchar(32) NOT NULL,
	`last_error_code` enum('provider_rejected','network_failure','credential_unavailable'),
	`completion_evidence` enum('provider_api_confirmed','user_attested_manual_removal','operator_attested_manual_removal'),
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `connector_revocation_obligations_id` PRIMARY KEY(`id`),
	CONSTRAINT `connector_revocation_obligations_active_identity_unique` UNIQUE(`active_identity`)
);
--> statement-breakpoint
ALTER TABLE `connector_revocation_obligations` ADD CONSTRAINT `connector_revocation_obligations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `connector_revocation_obligations_user_status_idx` ON `connector_revocation_obligations` (`user_id`,`status`,`updated_at`);