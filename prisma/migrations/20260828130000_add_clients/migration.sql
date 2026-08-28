-- Store only SHA-256 digests of client API keys. Raw keys are generated during
-- provisioning and are never persisted or written to application logs.
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "api_key_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clients_api_key_hash_key" ON "clients"("api_key_hash");

ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "events"
    ADD CONSTRAINT "events_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
