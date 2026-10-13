CREATE TABLE `cloud_resume_candidates` (
	`candidate_id` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`provider` enum('google_drive','dropbox') NOT NULL,
	`source_id` varchar(1000) NOT NULL,
	`name` varchar(500) NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`size` int unsigned,
	`modified_at` timestamp,
	`expires_at` timestamp NOT NULL,
	`import_lease_until` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cloud_resume_candidates_candidate_id` PRIMARY KEY(`candidate_id`)
);
--> statement-breakpoint
ALTER TABLE `cloud_resume_candidates` ADD CONSTRAINT `cloud_resume_candidates_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `cloud_resume_candidates_user_expiry_idx` ON `cloud_resume_candidates` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `cloud_resume_candidates_expiry_idx` ON `cloud_resume_candidates` (`expires_at`);