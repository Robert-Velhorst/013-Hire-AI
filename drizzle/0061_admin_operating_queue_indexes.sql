CREATE INDEX `admin_review_items_status_created_id_idx` ON `admin_review_items` (`status`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `employment_verifications_status_submitted_id_idx` ON `employment_verifications` (`status`,`submitted_at`,`id`);
--> statement-breakpoint
CREATE INDEX `fee_payments_created_id_idx` ON `fee_payments` (`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `success_fees_status_due_id_idx` ON `success_fees` (`status`,`next_verification_due`,`id`);
