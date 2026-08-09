CREATE INDEX `work_experiences_user_start_id_idx` ON `work_experiences` (`user_id`,`start_date`,`id`);
--> statement-breakpoint
CREATE INDEX `education_entries_user_end_id_idx` ON `education_entries` (`user_id`,`end_date`,`id`);
--> statement-breakpoint
CREATE INDEX `user_skills_user_sort_id_idx` ON `user_skills` (`user_id`,`sort_order`,`id`);
--> statement-breakpoint
CREATE INDEX `user_projects_user_sort_id_idx` ON `user_projects` (`user_id`,`sort_order`,`id`);
