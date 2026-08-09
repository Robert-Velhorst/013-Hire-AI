CREATE INDEX `application_attempts_application_created_id_idx` ON `application_attempts` (`application_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `employer_responses_application_received_id_idx` ON `employer_responses` (`application_id`,`received_at`,`id`);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_created_id_idx` ON `audit_events` (`entity_type`,`entity_id`,`created_at`,`id`);
