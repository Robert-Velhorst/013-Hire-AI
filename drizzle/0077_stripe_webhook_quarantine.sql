ALTER TABLE `stripe_webhook_events`
  MODIFY COLUMN `status` enum('processing','processed','failed','quarantined') NOT NULL DEFAULT 'processing';
