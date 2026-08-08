ALTER TABLE `admin_review_items`
  MODIFY COLUMN `category` enum(
    'application_review',
    'submission_evidence',
    'employer_response',
    'offer_attribution',
    'verification_overdue',
    'payment_failed',
    'legal_escalation',
    'employment_ended',
    'privacy_deletion'
  ) NOT NULL;
