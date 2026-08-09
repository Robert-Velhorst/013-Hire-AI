ALTER TABLE `employer_responses`
  MODIFY COLUMN `response_type` enum('viewed','rejection','interview_invite','offer','employer_question','no_response','other') NOT NULL;
