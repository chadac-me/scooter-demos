# Outbox retry handling

## Problem

The outbox relay publishes each row once. If the broker rejects it or the
connection drops, the row stays `pending` until the relay restarts. After last
week's broker failover, 1,200 order events sat unsent for 40 minutes.

## Proposal

- The relay claims up to 100 pending rows with `FOR UPDATE SKIP LOCKED`, so several relays can run at once.
- A failed publish sets `attempts = attempts + 1` and `next_attempt_at = now() + backoff(attempts)`.
- Backoff is exponential with full jitter: 1 s, 2 s, 4 s and so on, capped at 5 minutes.
- Rows that fail 10 times move to `outbox_dead` and page the on-call.
- Consumers already dedupe on `event_id`, so publishing a row twice is harmless.

### Rolling deploys

A claim is a 30 s lease (`claimed_until`), not a held transaction. On SIGTERM the
relay stops claiming, publishes the rows it holds within the grace period and
releases any it can't finish. A pod killed outright leaves its leases to expire,
so another relay picks those rows up within 30 s. A row published twice this way
is deduped by `event_id`.

## Alternatives

- **Retry in the request path.** Holds the user's request open while the broker is down.
- **A fixed 30 s retry loop.** Simple, but a broker outage turns every relay into a thundering herd.

## Decisions

**Attempt limit:** 10 attempts, about 30 minutes of retrying with the 5-minute cap. A longer outage is an incident, and the dead-letter page starts one.

**Stopping relays:** finish what they hold within the grace period, as above.
