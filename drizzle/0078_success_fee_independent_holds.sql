ALTER TABLE `success_fees`
  ADD COLUMN `lifecycle_status` enum('pending_verification','active','paused','ended') NOT NULL DEFAULT 'pending_verification';
--> statement-breakpoint

UPDATE `success_fees`
SET `lifecycle_status` = CASE
  WHEN `status` = 'ended' THEN 'ended'
  WHEN `status` = 'paused' THEN 'paused'
  WHEN `status` = 'pending_verification' THEN 'pending_verification'
  ELSE 'active'
END;
--> statement-breakpoint

CREATE TABLE `success_fee_holds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `success_fee_id` int NOT NULL,
  `hold_type` enum('payment','account','administrator','legal','verification','dispute','legacy_review') NOT NULL,
  `reason` text NOT NULL,
  `source_key` varchar(255),
  `created_by_user_id` int,
  `created_by_actor` enum('system','user','admin') NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `resolved_at` timestamp NULL,
  `resolved_by_user_id` int,
  `resolution_evidence` text,
  CONSTRAINT `success_fee_holds_success_fee_id_success_fees_id_fk`
    FOREIGN KEY (`success_fee_id`) REFERENCES `success_fees` (`id`) ON DELETE CASCADE,
  CONSTRAINT `success_fee_holds_created_by_user_id_users_id_fk`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `success_fee_holds_resolved_by_user_id_users_id_fk`
    FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  PRIMARY KEY (`id`),
  KEY `success_fee_holds_fee_active_idx` (`success_fee_id`, `resolved_at`, `id`),
  KEY `success_fee_holds_type_active_idx` (`hold_type`, `resolved_at`, `id`)
);
--> statement-breakpoint

INSERT INTO `success_fee_holds` (
  `success_fee_id`, `hold_type`, `reason`, `created_by_actor`, `created_at`
)
SELECT `id`, 'legacy_review',
  'Migrated unresolved legacy status; operator review and evidence required before resume.',
  'system', `updated_at`
FROM `success_fees`
WHERE `status` IN ('suspended', 'disputed');
