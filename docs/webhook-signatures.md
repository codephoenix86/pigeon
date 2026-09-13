# Verifying webhook signatures

Pigeon signs each delivery with the subscription secret returned when the
subscription is created. Webhook receivers should verify the signature before
parsing or processing the request body.

Each request includes these headers:

- `X-Delivery-Id`: the UUID of this delivery attempt.
- `X-Webhook-Timestamp`: the delivery attempt time as Unix seconds.
- `X-Webhook-Signature`: `sha256=` followed by a lowercase hexadecimal digest.

The signed message is the timestamp, delivery ID, and exact raw request body,
separated by ASCII periods:

```text
<timestamp>.<delivery-id>.<raw-request-body>
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

## Duplicate delivery

Pigeon provides at-least-once delivery, so the same event can be delivered more
than once. Store successfully processed `X-Delivery-Id` values for at least the
replay-protection window and return the original successful response when an ID is
seen again. The delivery ID is covered by the signature and cannot be changed
without invalidating it.

Each retry attempt gets a new delivery ID. Receivers that need event-level
de-duplication should also use a stable identifier from their agreed event payload
schema.
