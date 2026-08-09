CREATE INDEX `employer_responses_application_type_received_id_idx` ON `employer_responses` (`application_id`,`response_type`,`received_at`,`id`);
--> statement-breakpoint
CREATE INDEX `interview_schedules_application_status_created_response_idx` ON `interview_schedules` (`application_id`,`status`,`created_at`,`employer_response_id`);
