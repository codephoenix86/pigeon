import { getApiConfiguration, postToApi } from '../lib/api-client.mjs';

const totalEvents = 10_000;
const batchSize = 100;
const { apiKey, apiUrl } = getApiConfiguration();

const sendEvent = async (index) => {
  const response = await postToApi({
    apiKey,
    apiUrl,
    path: '/events',
    body: {
      type: 'performance.load-test',
      source: 'performance-script',
      payload: { index },
    },
  });

  if (!response.ok) {
    throw new Error(`Event ${index} failed with ${response.status}: ${await response.text()}`);
  }
};

const failures = [];

for (let start = 0; start < totalEvents; start += batchSize) {
  const batch = Array.from({ length: batchSize }, (_, offset) => start + offset + 1);
  const results = await Promise.allSettled(batch.map(sendEvent));

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push(result.reason);
      console.error(result.reason.message ?? `Event ${batch[index]} failed.`);
    }
  });

  console.log(`Submitted ${Math.min(start + batchSize, totalEvents)}/${totalEvents} events.`);
}

if (failures.length > 0) {
  process.exitCode = 1;
  console.error(`${failures.length} events failed.`);
} else {
  console.log(`All ${totalEvents} events were accepted.`);
}
