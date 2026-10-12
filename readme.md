# at.hn

See [at.hn](https://at.hn);

Run `npm ci` and `npm run dev`, then visit `http://localhost:4008` (or the
configured `PORT`). Development binds to loopback. Use the homepage setup helper
to generate an address from an exact, case-sensitive HN username. The helper
updates and copies the address client-side, with a plain form fallback when
JavaScript is unavailable. Profile pages work without JavaScript.
Production routes `username.at.hn` to the
profile directly; development also supports `/user?user=___`.

## Setup, updates and removal

The setup helper accepts a raw HN username and generates the existing encoded
address automatically. It rejects names that cannot round-trip through the
legacy encoding or fit a DNS label, rather than linking to a different account.
Typing a username makes no network requests. It does not contact HN until the
user follows a profile or check link. The minimum
karma remains 5, and opting in still requires editing the HN bio.

Profiles show when the upstream index was last checked, with links to refresh,
edit on HN and instructions to remove the opt-in text. Refresh checks bypass
at.hn's cache, but the Algolia HN index can lag edits on HN. The three-hour cache
bound starts at an upstream check, not at the time someone edits their HN bio.
Profile responses and setup pages use `Cache-Control: no-store` so browser or
proxy caches do not hide a subsequent refresh or confirmed removal. Detailed
404 pages, including a retry link, are cached on confirmed ineligibility; upstream
failures remain distinct 502/503/504 responses with retry guidance.

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
address. Browser policies prohibit base-tag changes and framing; inline styles
and HTTP/HTTPS images remain permitted. Only the homepage allows same-origin
external scripts for the input helper; inline scripts remain prohibited. Only
the homepage and setup fallback allow same-origin forms. Profiles and profile
errors continue to prohibit scripts and forms.

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

## Fixed staging route

Reuse `https://rollout-6f6c1de8.at.hn` and Railway's `staging` environment for
deployment checks. Despite its initial rollout name, this is a fixed hostname:
keep its Cloudflare CNAME/TXT records and Railway domain registration between
deployments. Do not create a new hostname or require DNS edits for each rollout.
Keep staging fixtures and instrumentation out of the production launcher.
For an interactive preview, set `PREVIEW_HOST=rollout-6f6c1de8.at.hn` in staging
and use the normal `node start.mjs` command. The configured host serves the
homepage, profile links and redirects use `/user?user=...` on the preview, and
responses are marked `noindex, nofollow`. Opt-in text still uses the real at.hn
address. Leave `PREVIEW_HOST` unset in production. The preview uses the real HN
index; editing an HN bio still changes that public profile.
Stop disposable test clients and idle staging deployments after verification;
retain the environment, service instance and domain so the next check can use
the same route.

### Staging preview procedure

Use the task's existing worktree and reviewed commit. Hold the workspace
integration lock through the final head/CI checks, staging changes and live
verification. A request to see staging authorizes this preview, not a production
merge or deployment. Leave a requested preview running for the user to inspect.

1. Link the task directory explicitly to project
   `49cd741a-5fa8-443d-933b-597e564c1079`, environment
   `6f6c1de8-dea8-488f-81af-b407d1275da1` (`staging`), service
   `d01e22c5-ac3a-4068-9a34-51acf6798752` (`athn`), then verify `railway status`.
   Record the production deployment ID so it can be checked unchanged afterward.
2. Inspect staging's actual start command and settings. Earlier load tests used
   `node --import ./staging-probe.mjs start.mjs`; that probe is not part of the app.
   Interactive previews use `node start.mjs`, `/healthz`, a 30-second healthcheck
   timeout, a 15-second draining interval, and the existing verified proxy settings.
   Set `PREVIEW_HOST=rollout-6f6c1de8.at.hn` only in staging, with deploys skipped
   until the reviewed upload is ready. Keep the existing domain/DNS registration.
3. For settings changes absent from the CLI, inspect the live schema with
   `railway api describe`. Use an explicit environment-scoped
   `environmentPatchCommit` with only the intended fields and `skipDeploys: true`.
   Do not assume a service-level mutation is restricted to the selected environment;
   verify staging and production settings after the change. Print only explicitly
   selected, nonsecret settings; never dump variables or credentials.
4. Upload a clean Git archive, not a working directory containing local tooling.
   Put the archive directly under the task worktree, outside ignored ancestors:

   ```sh
   set -euo pipefail
   preview_sha=$(git rev-parse HEAD)
   preview_upload=$(mktemp -d "$PWD/staging-upload.XXXXXX")
   git archive "$preview_sha" | tar -x -C "$preview_upload"
   test -f "$preview_upload/package.json"
   railway up "$preview_upload" --path-as-root --detach \
     --project 49cd741a-5fa8-443d-933b-597e564c1079 \
     --environment 6f6c1de8-dea8-488f-81af-b407d1275da1 \
     --service d01e22c5-ac3a-4068-9a34-51acf6798752 \
     --message "Staging preview $preview_sha"
   ```

   Railway CLI 5.64.2 uploaded an empty archive when the source directory was
   beneath `node_modules`, even with `--no-gitignore`. Railpack then reported
   that it could not detect a language and showed only `./` as the app contents.
   Check archive placement and build contents before changing the app's build
   configuration. Keep the temporary upload out of commits.
5. `railway up --detach` confirms an upload, not a healthy deployment. Record its
   deployment ID, inspect that deployment's build/runtime logs, and wait for
   `SUCCESS`. Check the fixed hostname with a cache-busting request and verify the
   staging banner and `X-Robots-Tag`, not only `/healthz` (a cached response can
   obscure an offline service). Check the client-side helper, copying and mobile
   layout with JavaScript enabled. Also check the plain form fallback with
   JavaScript disabled, a real opted-in example, refresh redirects and removal instructions.
   Profile links must stay on staging; editing the HN bio itself is still live.
6. Verify production's deployment ID is unchanged. Record the staging URL,
   deployed commit and checks in the existing PR. Remove only this task's temporary
   upload after verification; preserve useful test evidence and release the lock.

## UI changes

Preserve the existing homepage's content, examples, screenshot and visual layout
when adding functionality. Compare the live page and repository source before
editing, and review the result in a browser. An input helper is an addition to
the page, not authorization to replace it. Keep profile readability styling
separate from homepage styling. Local calculations belong in the browser, with
a working HTML form fallback.

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

For verified Railway public HTTP ingress, select `CLIENT_IP_SOURCE=railway-edge`
and configure its verified socket range in `TRUSTED_PROXY_CIDRS`. This mode
uses the valid single `X-Real-IP` value only when the actual socket peer is trusted.
It ignores `X-Forwarded-For` and Cloudflare headers when selecting the limiter key.
Private/untrusted peers and missing, invalid or repeated client-IP values share
one fallback bucket. Rotating unknown proxy sockets cannot reset that quota.
This restricts all unverified ingress to 50/minute per process; legitimate clients
on a changed ingress topology will share that limit until configuration is reviewed.
Structured fallback warnings are bounded per process.

Staging observed rotating HTTP proxy sockets `100.64.0.2` through `100.64.0.20`,
and private callers in `10.x`/`fd12:`. A narrow `100.64.0.0/24` configuration is
an operational assumption based on these observations, not published Railway
CIDRs or a permanent platform contract. Railway staff identify `100.64.x.x` as
[proxy traffic](https://station.railway.com/questions/unexpected-egress-spike-causing-2-3x-mon-01458b94),
including TCP proxies. Do not expose the application through a TCP proxy: that
path does not sanitize HTTP headers and can invalidate this trust boundary.
Verify there are no TCP mappings to the listener before rollout. Revalidate
direct/Cloudflare paths, genuine clients, private callers and both HTTP protocols
on every deployment. Unknown future proxy peers use the shared fallback bucket.
