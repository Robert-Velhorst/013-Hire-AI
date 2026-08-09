ALTER TABLE `users`
  ADD COLUMN `locale` varchar(10) NOT NULL DEFAULT 'en' AFTER `role`;
