DROP TABLE IF EXISTS `_migration_0045_social_profile_source`;
--> statement-breakpoint
CREATE TABLE `_migration_0045_social_profile_source` AS
SELECT * FROM `social_media_profiles`;
--> statement-breakpoint
CREATE TEMPORARY TABLE `social_profile_canonical_ids` AS
SELECT `user_id`, `platform`, MIN(`id`) AS `canonical_id`
FROM `_migration_0045_social_profile_source`
GROUP BY `user_id`, `platform`;
--> statement-breakpoint
UPDATE `social_media_profiles` AS `canonical`
INNER JOIN `social_profile_canonical_ids` AS `choice`
  ON `canonical`.`id` = `choice`.`canonical_id`
SET
  `canonical`.`profile_url` = (SELECT `source`.`profile_url` FROM `_migration_0045_social_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`platform` = `canonical`.`platform` ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1),
  `canonical`.`is_active` = (SELECT `source`.`is_active` FROM `_migration_0045_social_profile_source` AS `source` WHERE `source`.`user_id` = `canonical`.`user_id` AND `source`.`platform` = `canonical`.`platform` ORDER BY `source`.`updated_at` DESC, `source`.`id` DESC LIMIT 1);
--> statement-breakpoint
DELETE `duplicate`
FROM `social_media_profiles` AS `duplicate`
INNER JOIN `social_profile_canonical_ids` AS `choice`
  ON `duplicate`.`user_id` = `choice`.`user_id`
  AND `duplicate`.`platform` = `choice`.`platform`
WHERE `duplicate`.`id` <> `choice`.`canonical_id`;
--> statement-breakpoint
DROP TEMPORARY TABLE `social_profile_canonical_ids`;
--> statement-breakpoint
DROP TABLE `_migration_0045_social_profile_source`;
--> statement-breakpoint
ALTER TABLE `social_media_profiles`
  ADD UNIQUE INDEX `social_profiles_user_platform_unique` (`user_id`, `platform`);
