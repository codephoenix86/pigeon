# End-to-end demo

This demo shows the complete Pigeon workflow:

```text
register → send event → receive delivery → return 503 → inspect retry → recover → receive retry
```

The included receiver verifies Pigeon's HMAC signature and timestamp before responding. Its control server can switch between successful and failing responses without exposing those controls through the public tunnel.

## Prerequisites

- Complete the [local setup](../README.md#local-setup).
- Start Pigeon with `npm run dev`.
- Install [`cloudflared`](https://developers.cloudflare.com/tunnel/downloads/) or provide an equivalent public HTTPS tunnel.
- Create a client API key with `npm run client:create`.

A public HTTPS URL is required because Pigeon's SSRF protection deliberately rejects localhost and private-IP subscription targets. Cloudflare Quick Tunnels are intended only for development and demos.

## Run the demo

Use three terminals so the receiver, tunnel, and guided demo remain visible.

### Terminal 1: receiver

```bash
npm run demo:receiver
```

The webhook receiver listens on `127.0.0.1:4000`. A separate control server listens on `127.0.0.1:4001` and is never exposed by the tunnel.

### Terminal 2: public HTTPS tunnel

```bash
cloudflared tunnel --url http://127.0.0.1:4000
```

Copy the generated `https://...trycloudflare.com` URL and append `/webhooks`.

### Terminal 3: guided flow

Keep the API key out of shell history by reading it without echo:

```bash
read -rsp "Pigeon API key: " PIGEON_API_KEY && echo
export PIGEON_API_KEY
export DEMO_WEBHOOK_URL="https://generated-host.trycloudflare.com/webhooks"
npm run demo
```

The runner creates a temporary subscription, configures the receiver with its one-time secret, and sends two events. The first succeeds immediately. For the second, the receiver intentionally returns `503`, Pigeon records `RETRY_SCHEDULED`, and the receiver switches back to success before BullMQ's retry. With the default configuration, the first retry occurs after roughly one minute plus or minus jitter.

At the end, the runner disables its temporary subscription. Stop the receiver and tunnel with `Ctrl+C`.

## Record the GIF or video

Arrange the terminals with the guided flow largest and the receiver log visible beside it. Begin recording immediately before `npm run demo` and stop after `Demo complete` appears.

For a concise recording:

1. Show the subscription ID and masked one-time secret.
2. Keep the successful delivery and signature-verification log visible.
3. Show the `503` result and `RETRY_SCHEDULED` state.
4. Cut or speed up the one-minute backoff wait.
5. End on retry attempt 2 reaching `DELIVERED`.

Before publishing, confirm that the client API key and full subscription secret are not visible. The runner masks the secret and never prints the API key, but the provisioning terminal should remain outside the captured area.

Suggested formats are an optimized GIF for the README or a short MP4/WebM linked from it. Keep the source recording outside Git if it contains credentials; commit only the reviewed, redacted result.

## Optional configuration

| Variable           | Default                 | Purpose                                |
| ------------------ | ----------------------- | -------------------------------------- |
| `PIGEON_API_URL`   | `http://127.0.0.1:3000` | Pigeon HTTP endpoint                   |
| `PIGEON_API_KEY`   | Required                | Provisioned client credential          |
| `DEMO_WEBHOOK_URL` | Required                | Public HTTPS URL ending in `/webhooks` |
| `DEMO_CONTROL_URL` | `http://127.0.0.1:4001` | Local receiver control endpoint        |

If the runner encounters an error after registration, it still attempts to disable the subscription it created. Re-run it after correcting the reported connectivity or configuration error.
