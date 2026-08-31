-- Persist dead-letter intent atomically with the terminal delivery status so a
-- temporary Redis outage cannot lose a permanently failed delivery.
CREATE TABLE "delivery_dead_letter_outbox" (
    "id" UUID NOT NULL,
    "delivery_attempt_id" UUID NOT NULL,
    "attempts_made" INTEGER NOT NULL,
    "failed_reason" TEXT NOT NULL,
    "failed_at" TIMESTAMPTZ(6) NOT NULL,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "delivery_dead_letter_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_dead_letter_outbox_delivery_attempt_id_key"
    ON "delivery_dead_letter_outbox"("delivery_attempt_id");

CREATE INDEX "delivery_dead_letter_outbox_published_at_failed_at_idx"
    ON "delivery_dead_letter_outbox"("published_at", "failed_at");

ALTER TABLE "delivery_dead_letter_outbox"
    ADD CONSTRAINT "delivery_dead_letter_outbox_delivery_attempt_id_fkey"
    FOREIGN KEY ("delivery_attempt_id") REFERENCES "delivery_attempts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Recover permanent failures recorded before durable DLQ publishing existed.
-- Re-publishing is safe because the delivery-attempt ID is the BullMQ job ID.
INSERT INTO "delivery_dead_letter_outbox" (
    "id",
    "delivery_attempt_id",
    "attempts_made",
    "failed_reason",
    "failed_at"
)
SELECT
    "id",
    "id",
    "attempt_number",
    'Backfilled permanent delivery failure.',
    "updated_at"
FROM "delivery_attempts"
WHERE "status" = 'FAILED_PERMANENT';
