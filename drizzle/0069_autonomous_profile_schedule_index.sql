ALTER TABLE `user_profiles` ADD COLUMN `autonomous_enabled` int NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `user_profiles`
SET `autonomous_enabled` = 1
WHERE JSON_UNQUOTE(JSON_EXTRACT(
  IF(JSON_VALID(`preferences`), `preferences`, '{}'),
  '$.autonomousEnabled'
)) = 'true';
--> statement-breakpoint
ALTER TABLE `user_profiles` ADD INDEX `user_profiles_autonomous_user_idx` (`autonomous_enabled`, `user_id`);
