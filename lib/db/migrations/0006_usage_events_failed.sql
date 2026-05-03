-- Task #11 follow-up: distinguish failed LLM calls (where the wrapped fn
-- threw) from successful zero-cost calls. Lets /admin/usage surface real
-- error rates without conflating them with cheap legitimate calls.
ALTER TABLE "usage_events"
  ADD COLUMN IF NOT EXISTS "failed" boolean NOT NULL DEFAULT false;
