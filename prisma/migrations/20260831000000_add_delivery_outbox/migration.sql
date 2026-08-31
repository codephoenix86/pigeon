-- Persist enqueue intent in the same PostgreSQL transaction as each delivery.
-- The publisher marks an entry only after BullMQ acknowledges the idempotent job.
CREATE TABLE "delivery_outbox" (
    "id" UUID NOT NULL,
    "delivery_attempt_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "delivery_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_outbox_delivery_attempt_id_key"
    ON "delivery_outbox"("delivery_attempt_id");

CREATE INDEX "delivery_outbox_published_at_created_at_idx"
    ON "delivery_outbox"("published_at", "created_at");

ALTER TABLE "delivery_outbox"
    ADD CONSTRAINT "delivery_outbox_delivery_attempt_id_fkey"
    FOREIGN KEY ("delivery_attempt_id") REFERENCES "delivery_attempts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Recover delivery work created before the outbox was introduced. BullMQ job
-- IDs are delivery-attempt IDs, so republishing an existing job is idempotent.
INSERT INTO "delivery_outbox" ("id", "delivery_attempt_id")
SELECT "id", "id"
FROM "delivery_attempts"
WHERE "status" = 'PENDING';
