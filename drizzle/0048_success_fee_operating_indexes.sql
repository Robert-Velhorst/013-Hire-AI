DROP INDEX `success_fees_user_created_idx` ON `success_fees`;
--> statement-breakpoint
CREATE INDEX `success_fees_user_created_id_idx` ON `success_fees` (`user_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `success_fees_user_application_created_idx` ON `success_fees` (`user_id`,`application_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `success_fees_user_status_due_id_idx` ON `success_fees` (`user_id`,`status`,`next_verification_due`,`id`);
