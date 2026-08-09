ALTER TABLE `audit_events`
  MODIFY COLUMN `entity_type` enum('job','application','success_fee','verification','user','admin_review','workspace') NOT NULL;
--> statement-breakpoint
CREATE TABLE `workspaces` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(120) NOT NULL,
  `created_by_user_id` int NOT NULL,
  `status` enum('active','archived') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `workspaces_id` PRIMARY KEY(`id`),
  CONSTRAINT `workspaces_creator_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT,
  INDEX `workspaces_creator_status_idx` (`created_by_user_id`, `status`, `id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_members` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspace_id` int NOT NULL,
  `user_id` int NOT NULL,
  `role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
  `status` enum('active','removed') NOT NULL DEFAULT 'active',
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `workspace_members_id` PRIMARY KEY(`id`),
  CONSTRAINT `workspace_members_workspace_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_members_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_members_workspace_user_unique` UNIQUE (`workspace_id`, `user_id`),
  INDEX `workspace_members_user_status_idx` (`user_id`, `status`, `workspace_id`),
  INDEX `workspace_members_workspace_status_role_idx` (`workspace_id`, `status`, `role`)
);
--> statement-breakpoint
CREATE TABLE `workspace_invitations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspace_id` int NOT NULL,
  `email` varchar(320) NOT NULL,
  `role` enum('admin','member') NOT NULL DEFAULT 'member',
  `token_hash` varchar(64) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `invited_by_user_id` int NOT NULL,
  `accepted_by_user_id` int,
  `accepted_at` timestamp,
  `revoked_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `workspace_invitations_id` PRIMARY KEY(`id`),
  CONSTRAINT `workspace_invitations_workspace_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
  CONSTRAINT `workspace_invitations_inviter_fk` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `workspace_invitations_acceptor_fk` FOREIGN KEY (`accepted_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `workspace_invitations_token_unique` UNIQUE (`token_hash`),
  INDEX `workspace_invitations_workspace_created_idx` (`workspace_id`, `created_at`, `id`),
  INDEX `workspace_invitations_email_expiry_idx` (`email`, `expires_at`, `id`)
);
