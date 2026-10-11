# at.hn

See [at.hn](https://at.hn);

This is proxied into by nginx but when in development you can go to `localhost:4008/user/?user=___`

## Profile cache policy

Profile eligibility is revalidated after at most three hours. `?refresh` bypasses
all cache tiers. Confirmed opt-out, missing profile, empty bio or insufficient
karma replaces the cached profile with a 404 entry. Upstream failure does not
extend freshness. Positive disk entries from a previous process are revalidated
before use; negative entries remain usable until expiry. Disk-write failure
disables disk reads for that process. Atomic writes are ordered per identity.
Memory is bounded to 1,000 entries/32 MiB, disk records to 1,000 entries, and
each JSON record to 256 KiB. Legacy `.html` files are not served.


## Service checks

`/healthz` reports process readiness without requesting an upstream profile.
It is reserved on apex and user hosts. `railway.json` selects it for deployment
health checks. Monitor profile error/timeout rates separately: process readiness
is not a check of Algolia availability. SIGTERM drains HTTP requests for up to
ten seconds. Development binds loopback by default; `HOST` can select a bind
address. Browser policies prohibit scripts, forms, base-tag changes and framing;
inline styles and HTTP/HTTPS images remain permitted.
