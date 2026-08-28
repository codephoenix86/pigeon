-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'RETRY_SCHEDULED',
    'DELIVERED',
    'FAILED_PERMANENT'
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "target_url" TEXT NOT NULL,
    "event_types" VARCHAR(255)[],
    "secret" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "type" VARCHAR(255) NOT NULL,
    "payload" JSONB NOT NULL,
    "source" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "http_status" INTEGER,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "next_retry_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_client_id_status_idx"
    ON "subscriptions"("client_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- Supports active-subscription fan-out queries using event_types @> ARRAY[eventType].
CREATE INDEX "subscriptions_active_event_types_gin_idx"
    ON "subscriptions" USING GIN ("event_types")
    WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE INDEX "events_client_id_type_idx" ON "events"("client_id", "type");

-- CreateIndex
CREATE INDEX "events_type_idx" ON "events"("type");

-- CreateIndex
CREATE INDEX "delivery_attempts_status_next_retry_at_idx"
    ON "delivery_attempts"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "delivery_attempts_event_id_created_at_idx"
    ON "delivery_attempts"("event_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_attempts_subscription_id_status_idx"
    ON "delivery_attempts"("subscription_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_event_subscription_attempt_key"
    ON "delivery_attempts"("event_id", "subscription_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "delivery_attempts"
    ADD CONSTRAINT "delivery_attempts_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts"
    ADD CONSTRAINT "delivery_attempts_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
