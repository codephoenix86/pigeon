# Performance test scripts

These scripts exercise a running Pigeon instance and are not part of the Vitest suite.

## Layout

- `load/` contains event-submission scenarios, including an Autocannon ingestion benchmark.
- `delivery/` contains receiver registration and delivery-success reporting for retry behavior.
- `support/` contains the local webhook receiver, which intentionally returns `503` for roughly 40% of requests by default.
- `lib/` contains shared API and reporting helpers used by all scenario types.

## Run a local scenario

Start Pigeon and its dependencies, then provision an API key. In separate terminals, run:

```bash
PERFORMANCE_RECEIVER_FAILURE_RATE=0 npm run performance:receiver
PIGEON_API_KEY=your-key PERFORMANCE_WEBHOOK_URL=http://127.0.0.1:4000/webhooks npm run performance:register-webhook
PIGEON_API_KEY=your-key npm run performance:ingestion
npm run performance:report-delivery-success
```

`performance:ingestion` sends exactly 10,000 event requests with Autocannon. It prints accepted events/sec and latency percentiles; the command fails if any request errors, times out, or receives a non-`202` response. Set `PERFORMANCE_CONNECTIONS` to control concurrency (default: `100`).

`performance:ingestion:k6` sends exactly 10,000 event requests with k6. Set `PERFORMANCE_VUS` to control the number of virtual users (default: `20`) and pass `PIGEON_API_KEY` as usual:

```bash
PIGEON_API_KEY=your-key PERFORMANCE_VUS=20 npm run performance:ingestion:k6
```

The k6 test fails when any request does not receive `202` and reports request throughput plus p50, p90, and p99 response latency.

## Find the ingestion saturation point

The k6 arrival-rate ramp tests each rate from 100 to 600 requests/sec in 100 requests/sec steps, holding each step for 30 seconds. It reports accepted throughput and p99 latency for every rate:

```bash
PIGEON_API_KEY=your-key npm run performance:ingestion:ramp:k6
```

Tune the ramp without changing the script with `PERFORMANCE_RAMP_START_RATE`, `PERFORMANCE_RAMP_STEP_RATE`, `PERFORMANCE_RAMP_MAX_RATE`, and `PERFORMANCE_RAMP_STAGE_DURATION`. For example, test 100 through 1,000 requests/sec in 100 requests/sec steps, holding each level for one minute:

```bash
PIGEON_API_KEY=your-key \
PERFORMANCE_RAMP_MAX_RATE=1000 \
PERFORMANCE_RAMP_STAGE_DURATION=1m \
npm run performance:ingestion:ramp:k6
```

Run the ramp against a freshly reset benchmark database. The bottleneck is the first load level where accepted request rate stops increasing, p99 rises sharply, or `dropped_iterations` becomes nonzero. While it runs, inspect PostgreSQL waits and Redis operations from separate terminals:

```bash
watch -n 1 "docker compose exec -T postgres psql --username=pigeon --dbname=pigeon --tuples-only --command=\"SELECT state, wait_event_type, wait_event, count(*) FROM pg_stat_activity WHERE datname = 'pigeon' GROUP BY 1, 2, 3 ORDER BY 4 DESC;\""
watch -n 1 "docker compose exec -T redis redis-cli INFO stats | rg 'instantaneous_ops_per_sec|rejected_connections'"
```

High PostgreSQL wait counts or database CPU during the knee indicates the database is limiting ingestion. Redis errors, rejected connections, or high Redis CPU indicate a queue bottleneck. If both remain healthy while API CPU reaches its limit, the API processes are the bottleneck.

## Monitor API CPU and memory

Run this in a separate terminal while the benchmark is active. First find the API's process ID (the matching command differs slightly between the compiled and development server):

```bash
pgrep -af 'node .*dist/api\.js|ts-node-dev .*src/api\.ts'
```

Then replace the value below with that PID. `top` refreshes every second and shows current CPU percentage plus resident memory (`RES`):

```bash
PIGEON_PID=12345
top -b -d 1 -p "$PIGEON_PID"
```

For a single, script-friendly sample, use:

```bash
ps -p "$PIGEON_PID" -o pid=,pcpu=,pmem=,rss=,etime=,args=
```

`rss` is resident memory in KiB. Pigeon's `/metrics` endpoint also exports process and Node.js memory metrics for Prometheus collection; for example:

```bash
curl -sf http://127.0.0.1:3000/metrics | rg '^pigeon_(process|nodejs)_(cpu|resident_memory|heap)'
```

`PIGEON_API_URL` defaults to `http://127.0.0.1:3000`. The receiver host and port default to `127.0.0.1:4000` and can be set with `PERFORMANCE_SERVER_HOST` and `PERFORMANCE_SERVER_PORT`. Set `PERFORMANCE_RECEIVER_FAILURE_RATE` to a decimal from `0` through `1` (default: `0.4`); use `0` for a healthy receiver. Set `PERFORMANCE_RECEIVER_DELAY_MS` to delay each response by 0 through 60,000 milliseconds (default: `0`), such as `2000` for a two-second slow receiver. Set `PERFORMANCE_EVENT_TYPE` to report on a different event type.
