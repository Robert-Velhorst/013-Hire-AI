ALTER TABLE `connector_authorizations` ADD COLUMN `refresh_lease_token` varchar(64) NULL;
--> statement-breakpoint
ALTER TABLE `connector_authorizations` ADD COLUMN `refresh_lease_expires_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `connector_authorizations` ADD INDEX `connector_authorizations_refresh_lease_idx` (`refresh_lease_expires_at`);
