ALTER TABLE `job_alerts`
  ADD INDEX `job_alerts_active_frequency_triggered_idx` (`is_active`, `frequency`, `last_triggered`);
