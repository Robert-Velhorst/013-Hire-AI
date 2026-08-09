CREATE INDEX `audit_events_user_entity_created_id_idx` ON `audit_events` (`user_id`,`entity_type`,`entity_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `application_notes_application_created_id_idx` ON `application_notes` (`application_id`,`created_at`,`id`);
