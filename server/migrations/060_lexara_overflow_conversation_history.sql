-- LEXARA durable consultation history on canonical Overflow hot authority.
-- Deliberately omits a users-table foreign key: master access is stateless and
-- LEXARA persistence must not introduce a cross-authority dependency on Primary.

CREATE TABLE IF NOT EXISTS public.lexara_conversations (
  id varchar PRIMARY KEY,
  user_id varchar,
  session_id varchar(255),
  user_prompt text NOT NULL,
  lexara_response text NOT NULL,
  audio_generated boolean NOT NULL DEFAULT false,
  audio_url text,
  audio_base64 text,
  audio_duration_ms integer,
  model varchar(50),
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lexara_conversations_user_id
  ON public.lexara_conversations (user_id);

CREATE INDEX IF NOT EXISTS idx_lexara_conversations_session_id
  ON public.lexara_conversations (session_id);

CREATE INDEX IF NOT EXISTS idx_lexara_conversations_created_at
  ON public.lexara_conversations (created_at);
