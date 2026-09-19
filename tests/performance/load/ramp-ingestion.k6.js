/* global __ENV, __ITER, __VU */

import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

const apiKey = __ENV.PIGEON_API_KEY;
const apiUrl = (__ENV.PIGEON_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const startRate = Number(__ENV.PERFORMANCE_RAMP_START_RATE ?? 100);
const stepRate = Number(__ENV.PERFORMANCE_RAMP_STEP_RATE ?? 100);
const maxRate = Number(__ENV.PERFORMANCE_RAMP_MAX_RATE ?? 600);
const stageDuration = __ENV.PERFORMANCE_RAMP_STAGE_DURATION ?? '30s';

if (!apiKey) {
  throw new Error('Set PIGEON_API_KEY before running this test.');
}

for (const [name, value] of [
  ['PERFORMANCE_RAMP_START_RATE', startRate],
  ['PERFORMANCE_RAMP_STEP_RATE', stepRate],
  ['PERFORMANCE_RAMP_MAX_RATE', maxRate],
]) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

if (maxRate < startRate) {
  throw new Error('PERFORMANCE_RAMP_MAX_RATE must be greater than or equal to the start rate.');
}

const durationMatch = /^(\d+)(s|m)$/.exec(stageDuration);

if (!durationMatch) {
  throw new Error('PERFORMANCE_RAMP_STAGE_DURATION must be a whole number of seconds or minutes.');
}

const stageDurationSeconds = Number(durationMatch[1]) * (durationMatch[2] === 'm' ? 60 : 1);
const rates = [];

for (let target = startRate; target <= maxRate; target += stepRate) {
  rates.push(target);
}

if (rates[rates.length - 1] !== maxRate) {
  rates.push(maxRate);
}

const acceptedEvents = Object.fromEntries(
  rates.map((rate) => [rate, new Counter(`accepted_events_rate_${rate}`)]),
);
const attemptedEvents = Object.fromEntries(
  rates.map((rate) => [rate, new Counter(`attempted_events_rate_${rate}`)]),
);
const ingestionLatency = Object.fromEntries(
  rates.map((rate) => [rate, new Trend(`ingestion_latency_rate_${rate}`, true)]),
);

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(99)'],
  scenarios: Object.fromEntries(
    rates.map((rate, index) => [
      `rate_${rate}`,
      {
        executor: 'constant-arrival-rate',
        rate,
        timeUnit: '1s',
        duration: stageDuration,
        startTime: `${index * stageDurationSeconds}s`,
        preAllocatedVUs: Math.max(50, Math.min(rate, 200)),
        maxVUs: Math.max(100, rate * 2),
      },
    ]),
  ),
};

export default function () {
  const rate = Number(exec.scenario.name.replace('rate_', ''));
  const response = http.post(
    `${apiUrl}/events`,
    JSON.stringify({
      type: 'performance.load-test',
      source: 'k6-ramp',
      payload: { benchmark: 'ingestion-ramp', virtualUser: __VU, iteration: __ITER },
    }),
    {
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      tags: { endpoint: 'events' },
    },
  );

  attemptedEvents[rate].add(1);
  ingestionLatency[rate].add(response.timings.duration);
  const accepted = check(response, { 'event accepted (202)': (result) => result.status === 202 });

  if (accepted) {
    acceptedEvents[rate].add(1);
  }
}

export const handleSummary = (data) => {
  const droppedIterations = data.metrics.dropped_iterations?.values.count ?? 0;
  const stageSummaries = rates.map((rate) => {
    const attempted = data.metrics[`attempted_events_rate_${rate}`]?.values.count ?? 0;
    const accepted = data.metrics[`accepted_events_rate_${rate}`]?.values.count ?? 0;
    const latency = data.metrics[`ingestion_latency_rate_${rate}`]?.values ?? {};
    const acceptedRate = accepted / stageDurationSeconds;

    return `  ${rate}/sec target: accepted=${accepted}/${attempted}, throughput=${acceptedRate.toFixed(2)}/sec, p99=${latency['p(99)']?.toFixed(2) ?? 'n/a'} ms`;
  });

  return {
    stdout: [
      'k6 ingestion ramp complete',
      ...stageSummaries,
      `  dropped iterations: ${droppedIterations}`,
      '',
    ].join('\n'),
  };
};
