CREATE TABLE `operational_failure_signals` (
  `id` int AUTO_INCREMENT NOT NULL,
  `scope` varchar(80) NOT NULL,
  `operation` varchar(80) NOT NULL,
  `count` int unsigned NOT NULL DEFAULT 1,
  `first_occurred_at` timestamp NOT NULL,
  `last_occurred_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `operational_failure_signals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operational_failure_signals_scope_operation_unique` ON `operational_failure_signals` (`scope`,`operation`);
--> statement-breakpoint
CREATE INDEX `operational_failure_signals_last_idx` ON `operational_failure_signals` (`last_occurred_at`);
