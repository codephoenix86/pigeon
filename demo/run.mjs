import { randomUUID } from 'node:crypto';

const API_BASE_URL = process.env.PIGEON_API_URL ?? 'http://127.0.0.1:3000';
const CONTROL_BASE_URL = process.env.DEMO_CONTROL_URL ?? 'http://127.0.0.1:4001';
const API_KEY = process.env.PIGEON_API_KEY;
const WEBHOOK_URL = process.env.DEMO_WEBHOOK_URL;
const POLL_INTERVAL_MS = 1000;

const requireConfiguration = () => {
  if (!API_KEY) {
    throw new Error('PIGEON_API_KEY must contain a client API key.');
  }

  if (!WEBHOOK_URL) {
    throw new Error('DEMO_WEBHOOK_URL must contain the tunneled HTTPS webhook URL.');
  }

  const parsedWebhookUrl = new URL(WEBHOOK_URL);

  if (parsedWebhookUrl.protocol !== 'https:') {
    throw new Error('DEMO_WEBHOOK_URL must use HTTPS.');
  }
};

const request = async (baseUrl, path, options = {}) => {
  const response = await fetch(new URL(path, baseUrl), options);
  const text = await response.text();
  let body;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const details = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${details}`);
  }

  return body;
};

const apiRequest = (path, options = {}) =>
  request(API_BASE_URL, path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      ...options.headers,
    },
  });

const controlRequest = (path, options = {}) => request(CONTROL_BASE_URL, path, options);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForStatus = async (eventId, expectedStatus, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let previousState;

  while (Date.now() < deadline) {
    const result = await apiRequest(`/events/${eventId}/deliveries`);
    const latest = result.deliveries.at(-1);
    const state = latest ? `${latest.attemptNumber}:${latest.status}` : 'none';

    if (state !== previousState) {
      if (latest) {
        const retry = latest.nextRetryAt ? ` nextRetryAt=${latest.nextRetryAt}` : '';
        console.log(`  attempt=${latest.attemptNumber} status=${latest.status}${retry}`);
      } else {
        console.log('  waiting for the initial delivery attempt');
      }

      previousState = state;
    }

    if (latest?.status === expectedStatus) {
      return latest;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for event ${eventId} to reach ${expectedStatus}.`);
};

const createEvent = async (type, runId) => {
  const result = await apiRequest('/events', {
    method: 'POST',
    body: JSON.stringify({
      type,
      source: 'phase8-demo',
      payload: {
        businessEventId: randomUUID(),
        demoRunId: runId,
        message: `Pigeon ${type}`,
      },
    }),
  });

  console.log(`  accepted event=${result.event.id} matchingDeliveries=${result.deliveryCount}`);
  return result.event.id;
};

const configureReceiver = (secret) =>
  controlRequest('/secret', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: secret,
  });

const setReceiverMode = (nextMode) => controlRequest(`/mode/${nextMode}`, { method: 'POST' });

const deleteSubscription = async (subscriptionId) => {
  await apiRequest(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
};

const run = async () => {
  requireConfiguration();

  console.log('Pigeon end-to-end demo');
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Receiver: ${WEBHOOK_URL}`);

  await request(API_BASE_URL, '/health');
  await controlRequest('/state');
  console.log('✓ Pigeon and the demo receiver are ready');

  let subscriptionId;

  try {
    console.log('\n1. Register a subscription');
    const created = await apiRequest('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        targetUrl: WEBHOOK_URL,
        eventTypes: ['demo.delivery.success', 'demo.delivery.retry'],
      }),
    });
    subscriptionId = created.subscription.id;
    await configureReceiver(created.secret);
    console.log(`  created subscription=${subscriptionId}`);
    console.log(`  received one-time signing secret=${created.secret.slice(0, 6)}…`);

    const runId = randomUUID();

    console.log('\n2. Send an event and observe successful delivery');
    await setReceiverMode('succeed');
    const successfulEventId = await createEvent('demo.delivery.success', runId);
    const successfulAttempt = await waitForStatus(successfulEventId, 'DELIVERED', 30_000);
    console.log(`✓ delivered successfully with HTTP ${successfulAttempt.httpStatus}`);

    console.log('\n3. Simulate a receiver failure');
    await setReceiverMode('fail');
    const retryEventId = await createEvent('demo.delivery.retry', runId);
    const failedAttempt = await waitForStatus(retryEventId, 'RETRY_SCHEDULED', 30_000);
    console.log(`✓ receiver returned HTTP ${failedAttempt.httpStatus}; BullMQ scheduled a retry`);

    console.log('\n4. Recover the receiver and observe the retry');
    await setReceiverMode('succeed');
    console.log('  receiver is healthy; waiting for the bounded backoff delay');
    const retriedAttempt = await waitForStatus(retryEventId, 'DELIVERED', 150_000);
    console.log(
      `✓ retry attempt=${retriedAttempt.attemptNumber} delivered with HTTP ${retriedAttempt.httpStatus}`,
    );

    console.log('\nDemo complete: register → send → deliver → fail → retry → recover');
  } finally {
    if (subscriptionId) {
      try {
        await deleteSubscription(subscriptionId);
        console.log(`Disabled demo subscription ${subscriptionId}`);
      } catch (error) {
        console.error(
          `Could not disable demo subscription ${subscriptionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
};

run().catch((error) => {
  console.error(`\nDemo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
