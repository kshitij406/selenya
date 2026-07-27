# Lunara backup relay (M3)

Stateless zero-knowledge backup: the app encrypts the whole database on-device
(AES-256-GCM, key derived via Argon2id from a show-once recovery code) and this
Worker PUT/GETs the opaque blob in R2, keyed by an ID derived from the recovery
code. No accounts, no email, no readable data. Rate-limited.

Contract (to implement):

- `PUT /v1/blob/:id` — store encrypted snapshot (size-capped, per-IP rate-limited)
- `GET /v1/blob/:id` — fetch snapshot
- The Worker never sees key material; `:id` is derived client-side.

Since `:id` is just a format check (not an ownership proof — the design is
zero-knowledge, so the Worker has no way to verify an id came from a real
recovery code), `PUT` is rate-limited per-IP via a `RATE_LIMITS` KV namespace
to bound R2 storage-fill abuse.
