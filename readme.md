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

IPv6 clients are normalized and share the 50/minute limit within a /56 subnet.
This prevents equivalent spellings and rotation within that subnet from creating
new buckets. Verify the grouping against genuine staging clients before rollout.

For verified Railway public ingress, select `CLIENT_IP_SOURCE=railway-edge` and
pin only observed ingress socket addresses in `TRUSTED_PROXY_CIDRS`. This mode
uses the valid single `X-Real-IP` value only when the actual socket peer is trusted.
It ignores `X-Forwarded-For` and Cloudflare headers when selecting the limiter key.
Private/untrusted peers and missing, invalid or repeated client-IP values fall
back to the socket address. Structured fallback warnings are bounded per process.

Staging observed `100.64.0.2/32` and `100.64.0.3/32` on the tested ingress paths;
these are deployment observations, not published Railway CIDRs or a permanent
platform contract. Revalidate direct/Cloudflare paths, IPv4/IPv6 clients, private
callers and both HTTP protocols on every deployment. Unknown future proxy peers
fail closed to a shared socket bucket and require trust-configuration review.
