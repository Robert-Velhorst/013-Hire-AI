ALTER TABLE `admin_review_items` ADD `active_identity` varchar(180) GENERATED ALWAYS AS (CASE
    WHEN status IN ('open', 'in_progress')
    THEN CONCAT(user_id, ':', entity_type, ':', entity_id, ':', category)
    ELSE NULL
  END) VIRTUAL;--> statement-breakpoint
UPDATE `admin_review_items` AS older
JOIN `admin_review_items` AS newer
  ON newer.`user_id` = older.`user_id`
  AND newer.`entity_type` = older.`entity_type`
  AND newer.`entity_id` = older.`entity_id`
  AND newer.`category` = older.`category`
  AND newer.`status` IN ('open', 'in_progress')
  AND (
    newer.`updated_at` > older.`updated_at`
    OR (newer.`updated_at` = older.`updated_at` AND newer.`id` > older.`id`)
  )
SET older.`status` = 'dismissed',
    older.`resolved_at` = COALESCE(older.`resolved_at`, CURRENT_TIMESTAMP),
    older.`resolution` = COALESCE(
      older.`resolution`,
      'Duplicate active review superseded during migration; historical record retained.'
    )
WHERE older.`status` IN ('open', 'in_progress');--> statement-breakpoint
ALTER TABLE `application_approvals` ADD `active_identity` varchar(180) GENERATED ALWAYS AS (CASE
    WHEN status = 'pending'
    THEN CONCAT(user_id, ':', entity_type, ':', entity_id, ':', approval_type)
    ELSE NULL
  END) VIRTUAL;--> statement-breakpoint
UPDATE `application_approvals` AS older
JOIN `application_approvals` AS newer
  ON newer.`user_id` = older.`user_id`
  AND newer.`entity_type` = older.`entity_type`
  AND newer.`entity_id` = older.`entity_id`
  AND newer.`approval_type` = older.`approval_type`
  AND newer.`status` = 'pending'
  AND (
    newer.`updated_at` > older.`updated_at`
    OR (newer.`updated_at` = older.`updated_at` AND newer.`id` > older.`id`)
  )
SET older.`status` = 'cancelled',
    older.`decided_at` = COALESCE(older.`decided_at`, CURRENT_TIMESTAMP),
    older.`decision_note` = COALESCE(
      older.`decision_note`,
      'Duplicate pending approval superseded during migration; historical record retained.'
    )
WHERE older.`status` = 'pending';--> statement-breakpoint
ALTER TABLE `admin_review_items` ADD CONSTRAINT `admin_review_items_active_identity_unique` UNIQUE(`active_identity`);--> statement-breakpoint
ALTER TABLE `application_approvals` ADD CONSTRAINT `application_approvals_active_identity_unique` UNIQUE(`active_identity`);
