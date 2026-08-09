CREATE INDEX `employer_responses_user_interview_idx` ON `employer_responses` (`user_id`,`interview_id`);
--> statement-breakpoint
CREATE INDEX `interview_schedules_status_updated_id_idx` ON `interview_schedules` (`status`,`updated_at`,`id`);
