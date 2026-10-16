UPDATE `application_materials` AS material
LEFT JOIN `applications` AS application ON application.`id` = material.`application_id`
LEFT JOIN `user_resumes` AS resume ON resume.`id` = material.`resume_id`
SET material.`resume_id` = NULL
WHERE material.`resume_id` IS NOT NULL
	AND (application.`id` IS NULL OR resume.`id` IS NULL OR resume.`user_id` <> application.`user_id`);--> statement-breakpoint
ALTER TABLE `application_materials` ADD CONSTRAINT `application_materials_resume_id_user_resumes_id_fk` FOREIGN KEY (`resume_id`) REFERENCES `user_resumes`(`id`) ON DELETE set null ON UPDATE no action;
