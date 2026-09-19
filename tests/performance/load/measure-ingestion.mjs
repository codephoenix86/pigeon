import autocannon from 'autocannon';

import { getApiConfiguration } from '../lib/api-client.mjs';

const totalEvents = 10_000;
const connections = Number(process.env.PERFORMANCE_CONNECTIONS ?? 100);

if (!Number.isInteger(connections) || connections < 1) {
  throw new Error('PERFORMANCE_CONNECTIONS must be a positive integer.');
}

const { apiKey, apiUrl } = getApiConfiguration();
const startedAt = performance.now();

const result = await new Promise((resolve, reject) => {
  autocannon(
    {
      url: `${apiUrl}/events`,
      method: 'POST',
      connections,
      amount: totalEvents,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        type: 'performance.load-test',
        source: 'autocannon',
        payload: { benchmark: 'ingestion' },
      }),
    },
    (error, benchmarkResult) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(benchmarkResult);
    },
  );
});

const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const acceptedEvents = result['2xx'] ?? 0;
const failedEvents = result.non2xx + result.errors + result.timeouts;

console.log('Ingestion benchmark complete');
console.log(`  requests attempted: ${totalEvents}`);
console.log(`  requests accepted: ${acceptedEvents}`);
console.log(`  elapsed: ${elapsedSeconds.toFixed(2)} s`);
console.log(`  accepted throughput: ${(acceptedEvents / elapsedSeconds).toFixed(2)} events/sec`);
console.log(
  `  latency (ms): p50=${result.latency.p50}, p90=${result.latency.p90}, p99=${result.latency.p99}`,
);
console.log(
  `  failures: non-2xx=${result.non2xx}, errors=${result.errors}, timeouts=${result.timeouts}`,
);

if (acceptedEvents !== totalEvents || failedEvents > 0) {
  throw new Error('Ingestion benchmark did not receive 10,000 successful responses.');
}
