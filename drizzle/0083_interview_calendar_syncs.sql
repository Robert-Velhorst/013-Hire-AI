CREATE TABLE `interview_calendar_syncs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`interview_id` int NOT NULL,
	`provider` enum('gmail','outlook') NOT NULL,
	`status` enum('pending','synced','failed','unknown','cancelled') NOT NULL DEFAULT 'pending',
	`provider_event_id` varchar(255),
	`idempotency_key` varchar(80) NOT NULL,
	`last_error_code` enum('provider_rejected','network_failure','credential_unavailable'),
	`attempt_count` int NOT NULL DEFAULT 0,
	`last_attempt_at` timestamp,
	`synced_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `interview_calendar_syncs_id` PRIMARY KEY(`id`),
	CONSTRAINT `interview_calendar_syncs_user_interview_provider_unique` UNIQUE(`user_id`,`interview_id`,`provider`),
	CONSTRAINT `interview_calendar_syncs_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `interview_calendar_syncs` ADD CONSTRAINT `interview_calendar_syncs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `interview_calendar_syncs` ADD CONSTRAINT `interview_calendar_syncs_interview_id_interview_schedules_id_fk` FOREIGN KEY (`interview_id`) REFERENCES `interview_schedules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `interview_calendar_syncs_user_status_updated_idx` ON `interview_calendar_syncs` (`user_id`,`status`,`updated_at`,`id`);