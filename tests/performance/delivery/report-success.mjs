import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { summarizeDeliveryAttempts } from '../lib/delivery-report.mjs';

const eventType = process.env.PERFORMANCE_EVENT_TYPE ?? 'performance.load-test';
const prisma = new PrismaClient();

try {
  const attempts = await prisma.deliveryAttempt.findMany({
    where: { event: { type: eventType } },
    select: {
      eventId: true,
      subscriptionId: true,
      attemptNumber: true,
      status: true,
    },
  });
  const report = summarizeDeliveryAttempts(attempts);

  console.log(`Event type: ${eventType}`);
  console.log(`Successful logical deliveries: ${report.successfulDeliveries}`);
  console.log(`Total logical deliveries: ${report.totalLogicalDeliveries}`);
  console.log(`Eventual delivery success rate: ${report.eventualSuccessRate.toFixed(2)}%`);
  console.log(`Successful delivery attempts: ${report.successfulAttempts}`);
  console.log(`Total delivery attempts: ${report.totalAttempts}`);
  console.log(`Attempt success rate: ${report.attemptSuccessRate.toFixed(2)}%`);
  console.log(
    report.pendingDeliveries > 0
      ? `Pending deliveries: ${report.pendingDeliveries}`
      : 'No deliveries are pending.',
  );
} finally {
  await prisma.$disconnect();
}
