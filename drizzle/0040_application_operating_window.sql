ALTER TABLE `applications`
  ADD INDEX `applications_user_status_activity_idx` (`user_id`, `status`, `last_activity`, `created_at`, `id`);
