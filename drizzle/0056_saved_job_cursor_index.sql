ALTER TABLE `saved_jobs` DROP INDEX `saved_jobs_user_updated_idx`, ADD INDEX `saved_jobs_user_updated_idx` (`user_id`, `updated_at`, `id`);
