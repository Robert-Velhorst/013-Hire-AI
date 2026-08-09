ALTER TABLE `jobs`
  ADD INDEX `jobs_active_posted_created_idx` (`is_active`, `posted_date`, `created_at`),
  ADD INDEX `jobs_platform_external_idx` (`platform_id`, `external_id`);

ALTER TABLE `user_profiles`
  ADD INDEX `user_profiles_user_idx` (`user_id`);

ALTER TABLE `social_media_profiles`
  ADD INDEX `social_media_profiles_user_active_idx` (`user_id`, `is_active`);

ALTER TABLE `applications`
  ADD INDEX `applications_user_created_idx` (`user_id`, `created_at`);

ALTER TABLE `application_decisions`
  ADD INDEX `application_decisions_user_updated_idx` (`user_id`, `updated_at`);

ALTER TABLE `admin_review_items`
  ADD INDEX `admin_review_items_status_created_idx` (`status`, `created_at`),
  ADD INDEX `admin_review_items_user_category_created_idx` (`user_id`, `category`, `entity_type`, `entity_id`, `created_at`);

ALTER TABLE `application_approvals`
  ADD INDEX `application_approvals_user_status_created_idx` (`user_id`, `status`, `created_at`);

ALTER TABLE `follow_ups`
  ADD INDEX `follow_ups_application_created_idx` (`application_id`, `created_at`);

ALTER TABLE `user_resumes`
  ADD INDEX `user_resumes_user_active_version_idx` (`user_id`, `is_active`, `version`);

ALTER TABLE `interview_schedules`
  ADD INDEX `interview_schedules_application_scheduled_idx` (`application_id`, `scheduled_at`),
  ADD INDEX `interview_schedules_status_scheduled_idx` (`status`, `scheduled_at`);

ALTER TABLE `work_experiences`
  ADD INDEX `work_experiences_user_sort_idx` (`user_id`, `sort_order`);

ALTER TABLE `education_entries`
  ADD INDEX `education_entries_user_sort_idx` (`user_id`, `sort_order`);

ALTER TABLE `user_skills`
  ADD INDEX `user_skills_user_sort_idx` (`user_id`, `sort_order`);

ALTER TABLE `success_fees`
  ADD INDEX `success_fees_user_created_idx` (`user_id`, `created_at`);
