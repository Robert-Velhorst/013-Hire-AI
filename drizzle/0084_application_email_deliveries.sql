CREATE TABLE `application_email_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`application_id` int NOT NULL,
	`provider` enum('gmail','outlook') NOT NULL,
	`status` enum('draft','pending_approval','ready','sending','sent','failed','unknown','cancelled') NOT NULL DEFAULT 'draft',
	`recipient` varchar(320) NOT NULL,
	`subject` varchar(500) NOT NULL,
	`message` text NOT NULL,
	`resume_id` int NOT NULL,
	`resume_version` int NOT NULL,
	`resume_file_key` varchar(500) NOT NULL,
	`resume_file_name` varchar(255) NOT NULL,
	`resume_mime_type` varchar(100) NOT NULL,
	`resume_size` int unsigned NOT NULL,
	`resume_sha256` varchar(64) NOT NULL,
	`message_sha256` varchar(64) NOT NULL,
	`attempt_key` varchar(64),
	`provider_message_id` varchar(320),
	`failure_message` varchar(500),
	`attempt_count` int unsigned NOT NULL DEFAULT 0,
	`approved_at` timestamp,
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `application_email_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `application_email_deliveries_application_unique` UNIQUE(`application_id`),
	CONSTRAINT `application_email_deliveries_attempt_key_unique` UNIQUE(`attempt_key`)
);
--> statement-breakpoint
ALTER TABLE `application_approvals` MODIFY COLUMN `approval_type` enum('application_submission','follow_up_send','offer_attribution','interview_schedule','profile_claim','billing_action','application_email_submission') NOT NULL;--> statement-breakpoint
ALTER TABLE `application_email_deliveries` ADD CONSTRAINT `application_email_deliveries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `application_email_deliveries` ADD CONSTRAINT `application_email_deliveries_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `application_email_deliveries_user_status_idx` ON `application_email_deliveries` (`user_id`,`status`,`updated_at`);
