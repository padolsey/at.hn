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
It is reserved on apex and user hosts. Monitor profile error/timeout rates
separately: process readiness is not a check of Algolia availability.
SIGTERM drains HTTP requests for up to
ten seconds. Development binds loopback by default; `HOST` can select a bind
address. Browser policies prohibit scripts, forms, base-tag changes and framing;
inline styles and HTTP/HTTPS images remain permitted.

Production rollout requires Railway's Custom Start Command to be `node start.mjs`,
Healthcheck Path `/healthz`, and Healthcheck Timeout 30 seconds. These service
settings also require `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15` (or an effective
draining interval above ten seconds with margin). Railway's default is zero
seconds between SIGTERM and SIGKILL; see its [deployment reference](https://docs.railway.com/deployments/reference).
These settings are not applied by this repository change. `start.mjs` selects production
mode itself. Run Node directly; `npm start` adds a launcher that can intercept
SIGTERM. When launching through a shell, use `exec node start.mjs`. Verify the
effective command, readiness and draining interval in staging. Replace a staging
deployment during active requests and verify they complete before the old process
exits; process-only signal tests do not verify Railway's termination timing.
Complete this check before production rollout.

## Proxy configuration

`TRUSTED_PROXY_CIDRS` is a comma-separated list of verified ingress IPs/CIDRs.
The default trusts only the socket peer and ignores forwarded addresses.
Behind a proxy, this default shares the 50/minute limit across its clients.
Before deploying, establish the Cloudflare/Railway forwarding chain and
configure only its trusted ingress ranges. Verify multiple genuine clients
and spoofed `X-Forwarded-For` values through every ingress path in staging.
Do not use blanket trust or guess a hop count.
