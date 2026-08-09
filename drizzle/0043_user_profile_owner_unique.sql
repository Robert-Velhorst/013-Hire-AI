DROP TABLE IF EXISTS `_migration_0043_user_profile_source`;
--> statement-breakpoint
CREATE TABLE `_migration_0043_user_profile_source` AS
SELECT * FROM `user_profiles`;
--> statement-breakpoint
CREATE TEMPORARY TABLE `user_profile_canonical_ids` AS
SELECT `user_id`, MIN(`id`) AS `canonical_id`
FROM `_migration_0043_user_profile_source`
GROUP BY `user_id`;
--> statement-breakpoint
UPDATE `user_profiles` AS `canonical`
INNER JOIN `user_profile_canonical_ids` AS `choice`
  ON `canonical`.`id` = `choice`.`canonical_id`
SET
  `canonical`.`skills` = COALESCE((SELECT `source`.`skills` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`skills` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`skills`),
  `canonical`.`experience` = COALESCE((SELECT `source`.`experience` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`experience` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`experience`),
  `canonical`.`education` = COALESCE((SELECT `source`.`education` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`education` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`education`),
  `canonical`.`preferences` = COALESCE((SELECT `source`.`preferences` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`preferences` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`preferences`),
  `canonical`.`desired_job_types` = COALESCE((SELECT `source`.`desired_job_types` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`desired_job_types` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`desired_job_types`),
  `canonical`.`desired_locations` = COALESCE((SELECT `source`.`desired_locations` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`desired_locations` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`desired_locations`),
  `canonical`.`salary_expectation_min` = COALESCE((SELECT `source`.`salary_expectation_min` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`salary_expectation_min` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`salary_expectation_min`),
  `canonical`.`salary_expectation_max` = COALESCE((SELECT `source`.`salary_expectation_max` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`salary_expectation_max` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`salary_expectation_max`),
  `canonical`.`salary_expectation_currency` = COALESCE((SELECT `source`.`salary_expectation_currency` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`salary_expectation_currency` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`salary_expectation_currency`),
  `canonical`.`resume_url` = COALESCE((SELECT `source`.`resume_url` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`resume_url` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`resume_url`),
  `canonical`.`resume_file_key` = COALESCE((SELECT `source`.`resume_file_key` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`resume_file_key` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`resume_file_key`),
  `canonical`.`linkedin_url` = COALESCE((SELECT `source`.`linkedin_url` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`linkedin_url` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`linkedin_url`),
  `canonical`.`github_url` = COALESCE((SELECT `source`.`github_url` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`github_url` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`github_url`),
  `canonical`.`portfolio_url` = COALESCE((SELECT `source`.`portfolio_url` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`portfolio_url` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`portfolio_url`),
  `canonical`.`diversity_group` = COALESCE((SELECT `source`.`diversity_group` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`diversity_group` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`diversity_group`),
  `canonical`.`needs_visa_sponsorship` = COALESCE((SELECT `source`.`needs_visa_sponsorship` FROM `_migration_0043_user_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`needs_visa_sponsorship` IS NOT NULL ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1), `canonical`.`needs_visa_sponsorship`);
--> statement-breakpoint
DELETE `duplicate`
FROM `user_profiles` AS `duplicate`
INNER JOIN `user_profile_canonical_ids` AS `choice`
  ON `duplicate`.`user_id` = `choice`.`user_id`
WHERE `duplicate`.`id` <> `choice`.`canonical_id`;
--> statement-breakpoint
DROP TEMPORARY TABLE `user_profile_canonical_ids`;
--> statement-breakpoint
DROP TABLE `_migration_0043_user_profile_source`;
--> statement-breakpoint
ALTER TABLE `user_profiles`
  DROP INDEX `user_profiles_user_idx`,
  ADD UNIQUE INDEX `user_profiles_user_unique` (`user_id`);
