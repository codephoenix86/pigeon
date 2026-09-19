-- Event ingestion only records an event. A separate fan-out worker creates
-- delivery attempts later, and this status is that worker's durable cursor.
CREATE TYPE "EventFanoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED');

ALTER TABLE "events"
    ADD COLUMN "fanout_status" "EventFanoutStatus" NOT NULL DEFAULT 'PENDING';

-- These events were fanned out by the pre-deferred implementation. Do not
-- create a second initial delivery for them when the new worker starts.
UPDATE "events" SET "fanout_status" = 'COMPLETED';

CREATE INDEX "events_fanout_status_created_at_idx"
    ON "events"("fanout_status", "created_at");

-- A delivery attempt has exactly one initial queue-publication intent, so the
-- nullable timestamp can live on the attempt rather than in a 1:1 outbox row.
ALTER TABLE "delivery_attempts"
    ADD COLUMN "published_at" TIMESTAMPTZ(6);

UPDATE "delivery_attempts" AS attempt
SET "published_at" = outbox."published_at"
FROM "delivery_outbox" AS outbox
WHERE outbox."delivery_attempt_id" = attempt."id";

CREATE INDEX "delivery_attempts_published_at_created_at_idx"
    ON "delivery_attempts"("published_at", "created_at");

DROP TABLE "delivery_outbox";
