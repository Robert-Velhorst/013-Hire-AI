CREATE TABLE `job_discovery_run_state` (
  `name` varchar(64) NOT NULL,
  `lease_token` varchar(64),
  `lease_expires_at` timestamp NULL,
  `last_started_at` timestamp NULL,
  `last_completed_at` timestamp NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `job_discovery_run_state_name` PRIMARY KEY (`name`)
);
--> statement-breakpoint
CREATE INDEX `job_discovery_run_state_lease_idx` ON `job_discovery_run_state` (`lease_expires_at`);
