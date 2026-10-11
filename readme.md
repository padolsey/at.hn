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
