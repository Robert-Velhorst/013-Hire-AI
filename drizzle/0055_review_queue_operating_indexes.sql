CREATE INDEX `application_decisions_user_review_updated_idx` ON `application_decisions` (`user_id`,`review_required`,`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX `admin_review_items_user_status_created_idx` ON `admin_review_items` (`user_id`,`status`,`created_at`,`id`);
