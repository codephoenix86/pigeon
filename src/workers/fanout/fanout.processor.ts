import { DeliveryStatus, EventFanoutStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { env, logger, prisma } from '../../config';
import { cacheSubscriptionIds, getCachedSubscriptionIds } from '../../cache';
const fanoutLogger = logger.child({ component: 'event-fanout-poller' });
type ClaimedEvent = { id: string; clientId: string; type: string };

const claimPendingEvents = () =>
  prisma.$queryRaw<ClaimedEvent[]>(Prisma.sql`
    WITH claimed AS (
      SELECT "id" FROM "events" WHERE "fanout_status" = 'PENDING'
      ORDER BY "created_at" ASC FOR UPDATE SKIP LOCKED LIMIT ${env.EVENT_FANOUT_BATCH_SIZE}
    )
    UPDATE "events" SET "fanout_status" = 'PROCESSING' FROM claimed
    WHERE "events"."id" = claimed."id"
    RETURNING "events"."id" AS "id", "events"."client_id" AS "clientId", "events"."type" AS "type"
  `);

const fanoutEvent = async (event: ClaimedEvent) => {
  try {
    let subscriptionIds = await getCachedSubscriptionIds(event.clientId, event.type);
    if (subscriptionIds === null) {
      const subscriptions = await prisma.subscription.findMany({
        where: {
          clientId: event.clientId,
          status: SubscriptionStatus.ACTIVE,
          eventTypes: { has: event.type },
        },
        select: { id: true },
      });
      subscriptionIds = subscriptions.map((subscription) => subscription.id);
      await cacheSubscriptionIds(event.clientId, event.type, subscriptionIds);
    }
    await prisma.$transaction(async (transaction) => {
      if (subscriptionIds.length > 0) {
        await transaction.deliveryAttempt.createMany({
          data: subscriptionIds.map((subscriptionId) => ({
            eventId: event.id,
            subscriptionId,
            status: DeliveryStatus.PENDING,
            attemptNumber: 1,
          })),
          skipDuplicates: true,
        });
      }
      await transaction.event.update({
        where: { id: event.id },
        data: { fanoutStatus: EventFanoutStatus.COMPLETED },
      });
    });
  } catch (error) {
    await prisma.event.updateMany({
      where: { id: event.id, fanoutStatus: EventFanoutStatus.PROCESSING },
      data: { fanoutStatus: EventFanoutStatus.PENDING },
    });
    fanoutLogger.error({ err: error, eventId: event.id }, 'Event fan-out failed; will retry');
  }
};

export const fanoutPendingEvents = async (): Promise<number> => {
  const events = await claimPendingEvents();
  for (const event of events) await fanoutEvent(event);
  return events.length;
};

export const recoverInterruptedEventFanout = () =>
  prisma.event.updateMany({
    where: { fanoutStatus: EventFanoutStatus.PROCESSING },
    data: { fanoutStatus: EventFanoutStatus.PENDING },
  });

let pollerTimer: NodeJS.Timeout | undefined;
let pollInFlight: Promise<void> | undefined;
const pollEventFanout = () => {
  if (pollInFlight) return;
  pollInFlight = fanoutPendingEvents()
    .then(() => undefined)
    .catch((error: unknown) =>
      fanoutLogger.error({ err: error }, 'Event fan-out poll failed; will retry'),
    )
    .finally(() => {
      pollInFlight = undefined;
    });
};
export const startEventFanoutPoller = () => {
  if (pollerTimer) return;
  pollEventFanout();
  pollerTimer = setInterval(pollEventFanout, env.EVENT_FANOUT_POLL_INTERVAL_MS);
};
export const stopEventFanoutPoller = async () => {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = undefined;
  }
  await pollInFlight;
};
