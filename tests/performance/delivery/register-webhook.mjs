import { getApiConfiguration, postToApi } from '../lib/api-client.mjs';

const webhookUrl = process.env.PERFORMANCE_WEBHOOK_URL;

if (!webhookUrl) {
  throw new Error('Set PERFORMANCE_WEBHOOK_URL before running this script.');
}

const response = await postToApi({
  ...getApiConfiguration(),
  path: '/subscriptions',
  body: {
    targetUrl: webhookUrl,
    eventTypes: ['performance.load-test'],
  },
});
const body = await response.text();

if (!response.ok) {
  throw new Error(`Could not create subscription (${response.status}): ${body}`);
}

console.log(body);
