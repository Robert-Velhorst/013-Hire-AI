ALTER TABLE `interview_schedules`
  ADD COLUMN `employer_response_id` int,
  ADD INDEX `interview_schedules_employer_response_id_idx` (`employer_response_id`),
  ADD CONSTRAINT `interview_schedules_employer_response_fk` FOREIGN KEY (`employer_response_id`) REFERENCES `employer_responses`(`id`) ON DELETE SET NULL;
