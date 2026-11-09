# Outbox retry handling

## Problem

The outbox relay publishes each row once. If the broker rejects it or the
connection drops, the row stays `pending` until the relay restarts. After last
week's broker failover, 1,200 order events sat unsent for 40 minutes.

## Proposal

- The relay claims up to 100 pending rows with `FOR UPDATE SKIP LOCKED`, so several relays can run at once.
- A failed publish sets `attempts = attempts + 1` and `next_attempt_at = now() + backoff(attempts)`.
- Backoff is exponential with full jitter: 1 s, 2 s, 4 s and so on, capped at 5 minutes.
- Rows past the attempt limit move to `outbox_dead` and page the on-call.
- Consumers already dedupe on `event_id`, so publishing a row twice is harmless.

## Alternatives

- **Retry in the request path.** Holds the user's request open while the broker is down.
- **A fixed 30 s retry loop.** Simple, but a broker outage turns every relay into a thundering herd.

## Open questions

<!-- scooter:question id="attempt-limit" kind="single" -->
How many attempts before a row is dead-lettered? I'd take 10: with the 5-minute cap, that is about 30 minutes of retrying.

- [ ] 10 attempts (about 30 min)
- [ ] 20 attempts (about 1.5 h)
- [ ] Never; retry forever
<!-- /scooter:question -->

<!-- scooter:question id="shutdown" kind="single" -->
What should a stopping relay do with rows it has claimed?

- [ ] Finish publishing them within the shutdown grace period
- [ ] Drop the claim and let another relay take them
<!-- /scooter:question -->
