DROP TABLE IF EXISTS `_migration_0044_interview_prep_source`;
--> statement-breakpoint
CREATE TABLE `_migration_0044_interview_prep_source` AS
SELECT * FROM `interview_preparation`;
--> statement-breakpoint
CREATE TEMPORARY TABLE `interview_prep_canonical_ids` AS
SELECT `user_id`, `job_id`, MIN(`id`) AS `canonical_id`
FROM `_migration_0044_interview_prep_source`
GROUP BY `user_id`, `job_id`;
--> statement-breakpoint
UPDATE `interview_preparation` AS `canonical`
INNER JOIN `interview_prep_canonical_ids` AS `choice`
  ON `canonical`.`id` = `choice`.`canonical_id`
SET
  `canonical`.`questions` = COALESCE((SELECT `source`.`questions` FROM `_migration_0044_interview_prep_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`job_id` = `canonical`.`job_id` AND `source`.`questions` IS NOT NULL ORDER BY `source`.`created_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`questions`),
  `canonical`.`coaching_tips` = COALESCE((SELECT `source`.`coaching_tips` FROM `_migration_0044_interview_prep_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`job_id` = `canonical`.`job_id` AND `source`.`coaching_tips` IS NOT NULL ORDER BY `source`.`created_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`coaching_tips`),
  `canonical`.`company_insights` = COALESCE((SELECT `source`.`company_insights` FROM `_migration_0044_interview_prep_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`job_id` = `canonical`.`job_id` AND `source`.`company_insights` IS NOT NULL ORDER BY `source`.`created_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`company_insights`);
--> statement-breakpoint
DELETE `duplicate`
FROM `interview_preparation` AS `duplicate`
INNER JOIN `interview_prep_canonical_ids` AS `choice`
  ON `duplicate`.`user_id` = `choice`.`user_id`
  AND `duplicate`.`job_id` = `choice`.`job_id`
WHERE `duplicate`.`id` <> `choice`.`canonical_id`;
--> statement-breakpoint
DROP TEMPORARY TABLE `interview_prep_canonical_ids`;
--> statement-breakpoint
DROP TABLE `_migration_0044_interview_prep_source`;
--> statement-breakpoint
ALTER TABLE `interview_preparation`
  ADD UNIQUE INDEX `interview_prep_user_job_unique` (`user_id`, `job_id`);
