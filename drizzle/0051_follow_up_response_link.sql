ALTER TABLE `follow_ups` ADD `source_response_id` int;
--> statement-breakpoint
UPDATE `follow_ups` AS `follow_up`
INNER JOIN `application_approvals` AS `approval`
  ON `approval`.`entity_type` = 'follow_up'
  AND `approval`.`entity_id` = `follow_up`.`id`
  AND `approval`.`approval_type` = 'follow_up_send'
INNER JOIN `employer_responses` AS `response`
  ON `response`.`id` = CAST(JSON_UNQUOTE(JSON_EXTRACT(`approval`.`payload`, '$.sourceResponseId')) AS UNSIGNED)
  AND `response`.`application_id` = `follow_up`.`application_id`
SET `follow_up`.`source_response_id` = `response`.`id`
WHERE JSON_VALID(`approval`.`payload`)
  AND JSON_TYPE(JSON_EXTRACT(`approval`.`payload`, '$.sourceResponseId')) = 'INTEGER';
--> statement-breakpoint
ALTER TABLE `follow_ups` ADD CONSTRAINT `follow_ups_source_response_id_employer_responses_id_fk` FOREIGN KEY (`source_response_id`) REFERENCES `employer_responses`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX `follow_ups_source_response_sent_idx` ON `follow_ups` (`source_response_id`,`sent_date`);
