import { Counter, Gauge, Registry, collectDefaultMetrics } from '@prometheus-io/client';

import { env } from '../config/env';
import { getLogger } from '../config/logger';
import { deliveryDeadLetterQueue, deliveryQueue } from '../queue';

const DELIVERY_OUTCOMES = ['delivered', 'retry_scheduled', 'failed_permanent'] as const;
type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
type QueueState = (typeof QUEUE_STATES)[number];

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: 'pigeon' });
collectDefaultMetrics({ register: metricsRegistry, prefix: 'pigeon_' });

const deliveryAttempts = new Counter({
  name: 'pigeon_delivery_attempts_total',
  help: 'Completed webhook delivery attempts since the process started.',
  labelNames: ['outcome'] as const,
  registers: [metricsRegistry],
});

const deliveryRetries = new Counter({
  name: 'pigeon_delivery_retries_total',
  help: 'Webhook delivery retries scheduled since the process started.',
  registers: [metricsRegistry],
});

const deliveryOutcomeCounts: Record<DeliveryOutcome, number> = {
  delivered: 0,
  retry_scheduled: 0,
  failed_permanent: 0,
};

new Gauge({
  name: 'pigeon_delivery_success_ratio',
  help: 'Ratio of successful to completed webhook delivery attempts since process start.',
  registers: [metricsRegistry],
  collect() {
    const total = Object.values(deliveryOutcomeCounts).reduce((sum, count) => sum + count, 0);
    this.set(total === 0 ? 0 : deliveryOutcomeCounts.delivered / total);
  },
});

const collectionFailures = new Counter({
  name: 'pigeon_metrics_collection_failures_total',
  help: 'Metric collection failures since the process started.',
  labelNames: ['collector'] as const,
  registers: [metricsRegistry],
});

const withCollectionTimeout = async <T>(operation: Promise<T>): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Metric collection timed out after ${env.METRICS_COLLECTION_TIMEOUT_MS}ms.`,
              ),
            ),
          env.METRICS_COLLECTION_TIMEOUT_MS,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const queues = [
  { name: 'delivery', queue: deliveryQueue },
  { name: 'dead_letter', queue: deliveryDeadLetterQueue },
] as const;

new Gauge({
  name: 'pigeon_queue_jobs',
  help: 'Current number of BullMQ jobs by queue and state.',
  labelNames: ['queue', 'state'] as const,
  registers: [metricsRegistry],
  async collect() {
    this.reset();

    const results = await Promise.allSettled(
      queues.map(async ({ name, queue }) => ({
        name,
        counts: await withCollectionTimeout(queue.getJobCounts(...QUEUE_STATES)),
      })),
    );

    results.forEach((result, index) => {
      const queueName = queues[index].name;

      if (result.status === 'rejected') {
        collectionFailures.inc({ collector: `queue_depth_${queueName}` });
        getLogger().warn(
          { err: result.reason, queue: queueName },
          'Queue depth metric collection failed',
        );
        return;
      }

      QUEUE_STATES.forEach((state: QueueState) => {
        this.set({ queue: result.value.name, state }, result.value.counts[state] ?? 0);
      });
    });
  },
});

DELIVERY_OUTCOMES.forEach((outcome) => deliveryAttempts.inc({ outcome }, 0));
deliveryRetries.inc(0);
collectionFailures.inc({ collector: 'queue_depth_delivery' }, 0);
collectionFailures.inc({ collector: 'queue_depth_dead_letter' }, 0);

const recordDeliveryOutcome = (outcome: DeliveryOutcome) => {
  deliveryOutcomeCounts[outcome] += 1;
  deliveryAttempts.inc({ outcome });
};

export const recordDeliverySuccess = () => recordDeliveryOutcome('delivered');

export const recordDeliveryRetry = () => {
  recordDeliveryOutcome('retry_scheduled');
  deliveryRetries.inc();
};

export const recordDeliveryPermanentFailure = () => recordDeliveryOutcome('failed_permanent');
