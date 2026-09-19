/* global __ENV, __ITER, __VU */

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const totalEvents = 10_000;
const virtualUsers = Number(__ENV.PERFORMANCE_VUS ?? 20);
const apiKey = __ENV.PIGEON_API_KEY;
const apiUrl = (__ENV.PIGEON_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

if (!apiKey) {
  throw new Error('Set PIGEON_API_KEY before running this test.');
}

if (!Number.isInteger(virtualUsers) || virtualUsers < 1) {
  throw new Error('PERFORMANCE_VUS must be a positive integer.');
}

const acceptedEvents = new Counter('accepted_events');
const ingestionLatency = new Trend('ingestion_latency', true);

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(99)'],
  scenarios: {
    ingestion: {
      executor: 'shared-iterations',
      vus: virtualUsers,
      iterations: totalEvents,
      maxDuration: '10m',
    },
  },
  thresholds: {
    checks: ['rate==1'],
  },
};

export default function () {
  const response = http.post(
    `${apiUrl}/events`,
    JSON.stringify({
      type: 'performance.load-test',
      source: 'k6',
      payload: { benchmark: 'ingestion', virtualUser: __VU, iteration: __ITER },
    }),
    {
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      tags: { endpoint: 'events' },
    },
  );

  ingestionLatency.add(response.timings.duration);
  const accepted = check(response, { 'event accepted (202)': (result) => result.status === 202 });

  if (accepted) {
    acceptedEvents.add(1);
  }
}

export const handleSummary = (data) => {
  const requestRate = data.metrics.http_reqs?.values.rate ?? 0;
  const latency = data.metrics.ingestion_latency?.values ?? {};
  const accepted = data.metrics.accepted_events?.values.count ?? 0;

  return {
    stdout: [
      'k6 ingestion benchmark complete',
      `  requests attempted: ${totalEvents}`,
      `  requests accepted: ${accepted}`,
      `  accepted throughput: ${requestRate.toFixed(2)} events/sec`,
      `  latency (ms): p50=${latency['p(50)']?.toFixed(2) ?? 'n/a'}, p90=${latency['p(90)']?.toFixed(2) ?? 'n/a'}, p99=${latency['p(99)']?.toFixed(2) ?? 'n/a'}`,
      '',
    ].join('\n'),
  };
};
