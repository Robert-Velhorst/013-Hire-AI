ALTER TABLE `applications`
  DROP INDEX `applications_user_created_idx`,
  ADD INDEX `applications_user_created_idx` (`user_id`, `created_at`, `id`);
