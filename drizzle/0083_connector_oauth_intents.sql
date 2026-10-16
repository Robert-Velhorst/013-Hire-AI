CREATE TABLE `connector_oauth_intents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`state_nonce_hash` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`provider` enum('gmail','google_drive','dropbox','outlook','linkedin','github') NOT NULL,
	`consent_scopes` text NOT NULL,
	`session_binding` varchar(64) NOT NULL,
	`application_origin` varchar(512) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `connector_oauth_intents_id` PRIMARY KEY(`id`),
	CONSTRAINT `connector_oauth_intents_nonce_hash_unique` UNIQUE(`state_nonce_hash`)
);
--> statement-breakpoint
ALTER TABLE `connector_oauth_intents` ADD CONSTRAINT `connector_oauth_intents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `connector_oauth_intents_expiry_idx` ON `connector_oauth_intents` (`expires_at`,`consumed_at`);
