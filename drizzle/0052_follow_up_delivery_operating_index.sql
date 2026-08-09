CREATE INDEX `application_approvals_delivery_operating_idx` ON `application_approvals` (`user_id`,`status`,`approval_type`,`entity_type`,`entity_id`,`decided_at`,`id`);
