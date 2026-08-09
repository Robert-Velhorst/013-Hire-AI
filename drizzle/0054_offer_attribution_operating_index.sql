CREATE INDEX `application_approvals_offer_attribution_operating_idx` ON `application_approvals` (`user_id`,`status`,`approval_type`,`created_at`,`id`,`application_id`);
