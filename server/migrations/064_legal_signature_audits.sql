CREATE TABLE IF NOT EXISTS legal_signature_audits (
  id varchar(64) PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matter_session_id varchar(128),
  title text NOT NULL,
  document_type text,
  jurisdiction text,
  signer_name text NOT NULL,
  consent_text text NOT NULL,
  original_content_sha256 varchar(64) NOT NULL,
  signed_pdf_sha256 varchar(64) NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_signature_audits_user
  ON legal_signature_audits(user_id);

CREATE INDEX IF NOT EXISTS idx_legal_signature_audits_matter
  ON legal_signature_audits(user_id, matter_session_id);
