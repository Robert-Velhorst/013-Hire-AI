DROP INDEX `jobs_active_posted_created_idx` ON `jobs`;
--> statement-breakpoint
CREATE INDEX `jobs_active_posted_created_cursor_idx` ON `jobs` (`is_active`,`posted_date`,`created_at`,`id`);
