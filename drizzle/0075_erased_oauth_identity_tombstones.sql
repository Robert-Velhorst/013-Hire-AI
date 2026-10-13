CREATE TABLE `erased_oauth_identities` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key_version` int unsigned NOT NULL,
  `identity_hash` varchar(64) NOT NULL,
  `erased_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `erased_oauth_identities_id` PRIMARY KEY (`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `erased_oauth_identities_key_hash_unique` ON `erased_oauth_identities` (`key_version`, `identity_hash`);
