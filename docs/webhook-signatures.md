# Verifying webhook signatures

Pigeon signs each delivery with the subscription secret returned when the
subscription is created. Webhook receivers should verify the signature before
parsing or processing the request body.

Each request includes these headers:

- `X-Webhook-Timestamp`: the delivery attempt time as Unix seconds.
- `X-Webhook-Signature`: `sha256=` followed by a lowercase hexadecimal digest.

The signed message is the timestamp, one ASCII period, and the exact raw request
body:

```text
<timestamp>.<raw-request-body>
```

Compute HMAC-SHA256 over that message with the subscription secret and compare it
with the digest in `X-Webhook-Signature` using a constant-time comparison. Do not
re-serialize parsed JSON when verifying because even equivalent JSON can have
different bytes.

## Replay-protection window

Receivers should reject a request when `X-Webhook-Timestamp` is invalid or differs
from their current Unix time by more than **five minutes (300 seconds)**. Verify
the timestamp and signature together before processing the payload. Receiver clocks
therefore need to be kept in sync.

The tolerance check limits how long a captured signed request can be replayed. It
does not prevent duplicates within the five-minute window, so receivers still need
idempotent processing.
