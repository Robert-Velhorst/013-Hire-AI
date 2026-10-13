ALTER TABLE `connector_authorizations` ADD `access_token_lifetime` enum('expiring','non_expiring','unknown') DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
UPDATE `connector_authorizations`
SET `access_token_lifetime` = CASE
	WHEN `access_token_expires_at` IS NOT NULL THEN 'expiring'
	WHEN `provider` = 'github'
		AND `encrypted_refresh_token` IS NULL
		AND `granted_scopes` = '["read:user"]' THEN 'non_expiring'
	ELSE 'unknown'
END;
