import express from 'express';
import PQueue from 'p-queue';
import path from 'path';
import template from './template.mjs';
import rateLimit from 'express-rate-limit';
import he from 'he';
import { renderBio } from './bio.mjs';
import { ProfileCache } from './profile-cache.mjs';
import { trustedProxyCidrs } from './proxy-trust.mjs';
import { createClientIpKey } from './client-ip.mjs';
import { encodeUsername, decodeUsername } from './username.mjs';
import { homePage, setupPage, profileStatusPage } from './setup.mjs';
import { profileUrl } from './page.mjs';
import { previewHost } from './preview.mjs';

const PROFILES_DIR = path.join(process.cwd(), 'profiles');
const KARMA_MIN = 5;
const REQ_TIMEOUT = 5000;

const profileCache = new ProfileCache(PROFILES_DIR);
profileCache.prune().catch(() => {});

// Bound fetch starts to two per one-second queue interval.
const queue = new PQueue({ concurrency: 2, interval: 1000, intervalCap: 2 });
const pendingProfiles = new Map();

class ProfileError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const fetchData = async (username, signal) => {
  const url = `https://hn.algolia.com/api/v1/users/${encodeURIComponent(username)}`;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new ProfileError('Profile upstream returned an error', response.status === 404 ? 404 : 502);
    }
    const data = await response.json();
    signal.throwIfAborted();
    return data;
  } catch (err) {
    if (signal.aborted) throw new ProfileError('Profile upstream timed out', 504);
    if (err instanceof ProfileError) throw err;
    throw new ProfileError('Profile upstream unavailable', 502);
  }
};

function getProfileData(username) {
  if (pendingProfiles.has(username)) return pendingProfiles.get(username);
  if (queue.size >= 2) return Promise.reject(new ProfileError('Profile queue is full', 503));
  // The deadline includes queue waiting, fetch, and JSON body consumption.
  const signal = AbortSignal.timeout(REQ_TIMEOUT);
  const queued = queue.add(() => fetchData(username, signal), { signal });
  let onAbort;
  const deadline = new Promise((resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const job = Promise.race([queued, deadline]).catch(err => {
    if (signal.aborted) throw new ProfileError('Profile upstream timed out', 504);
    throw err;
  }).finally(() => {
    signal.removeEventListener('abort', onAbort);
    pendingProfiles.delete(username);
  });
  pendingProfiles.set(username, job);
  return job;
}

const BROWSER_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src https: http:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const app = express();
let draining = false;
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': BROWSER_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (previewHost) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});
app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store').status(draining ? 503 : 200).json({ status: draining ? 'draining' : 'ok' });
});
const port = process.env.PORT || 4008;

const proxyCidrs = trustedProxyCidrs(process.env.TRUSTED_PROXY_CIDRS);
app.set('trust proxy', proxyCidrs);
const clientIpSource = process.env.CLIENT_IP_SOURCE || 'proxy';
if (clientIpSource === 'railway-edge' && !proxyCidrs) throw new Error('railway-edge requires explicit TRUSTED_PROXY_CIDRS');
const clientIpKey = createClientIpKey({ source: clientIpSource, trustPeer: app.get('trust proxy fn') });

// Replaces the old nginx wildcard rewrite: <sub>.at.hn -> /user?user=<sub>.
// On Railway there's no nginx in front, so the app maps the subdomain itself.
// Faithful to the old nginx: ANY non-asset path on a subdomain resolves to the
// user's profile; static assets (favicon etc.) fall through to express.static;
// apex/www serve the homepage.
app.use((req, res, next) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const m = host.match(/^([^.]+)\.at\.hn$/); // single-label subdomain only
  req.profileHost = Boolean(m && m[1] !== 'www' && host !== previewHost);
  if (req.profileHost && !/\.(?:html|css|js|png|jpg|jpeg|gif|ico|txt|svg|webp)$/i.test(req.path)) {
    const qs = req.url.includes('?') ? '&' + req.url.split('?')[1] : '';
    req.url = `/user?user=${encodeURIComponent(m[1])}${qs}`;
  }
  next();
});

// Only these application-owned pages permit same-origin form submissions.
// Profiles and their error pages keep form-action 'none' and prohibit scripts.
app.get(['/', '/index.html', '/setup'], (req, res) => {
  if (req.profileHost) return res.status(404).type('text/plain').send('Page not found');
  res.set({
    'Content-Security-Policy': BROWSER_POLICY.replace("form-action 'none'", "form-action 'self'"),
    'Cache-Control': 'no-store'
  });
  if (req.path === '/setup') {
    const result = setupPage(new URL(req.url, 'http://localhost').searchParams);
    return res.status(result.status).type('html').send(result.html);
  }
  res.type('html').send(homePage());
});

app.use(express.static(path.join(process.cwd(), 'public')));

app.use('/user', rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 50,
  keyGenerator: clientIpKey,
  message: 'Too many requests from this IP, please try again after a minute.'
}));

app.get('/user', (req, res, next) => {
  handleProfile(req, res).catch(next);
});

async function handleProfile(req, res) {
  // Refresh/removal must not be hidden by a browser or intermediary's old HTML.
  res.type('html').set('Cache-Control', 'no-store');
  const urlParams = new URL(req.url, 'http://localhost');
  const users = urlParams.searchParams.getAll('user');
  const user = users.length === 1 ? users[0] : null;
  const refresh = urlParams.searchParams.has('refresh');

  if (typeof user !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(user) || !/\w/.test(user)) {
    return res.status(400).send(profileStatusPage({ kind: 'invalid' }));
  }
  const decodedUsername = decodeUsername(user);
  const encodedUsername = encodeUsername(decodedUsername);
  if (encodedUsername.length > 63) {
    return res.status(400).send(profileStatusPage({ kind: 'invalid' }));
  }
  const statusPage = kind => profileStatusPage({ kind, encodedUsername, decodedUsername });
  if (!refresh) {
    const cached = await profileCache.get(encodedUsername);
    if (cached) return res.status(cached.status).send(cached.html);
  }
  const revoke = async kind => {
    const html = statusPage(kind);
    await profileCache.put(encodedUsername, html, 404);
    return res.status(404).send(html);
  };

  let profileData;
  try {
    profileData = await getProfileData(decodedUsername);
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
    if (error.status === 404) return revoke('missing');
    const kind = { 502: 'unavailable', 503: 'busy', 504: 'timeout' }[error.status];
    res.set('Retry-After', error.status === 503 ? '5' : '30');
    console.error(JSON.stringify({ event: 'profile_upstream_failure', status: error.status }));
    return res.status(error.status).send(statusPage(kind));
  }

  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // HN identities are case-sensitive; DNS spelling is not. Normalize the
  // HTML representation of about before testing visible consent text.
  const dnsName = [...encodedUsername].map(char => /[a-z]/i.test(char)
    ? `[${char.toLowerCase()}${char.toUpperCase()}]` : escapeRegex(char)).join('');
  const names = `${escapeRegex(decodedUsername)}|${dnsName}`;
  const userAddrCheckR = RegExp(`(?<![A-Za-z0-9_.-])(?:[hH][tT][tT][pP][sS]?://)?(?:${names})\\.[aA][tT]\\.[hH][nN](?=$|[\\s<>\"'/?#),;!\\\]]|\\.(?=$|[\\s<>\"'\\\]]))`);
  const about = typeof profileData?.about === 'string' ? profileData.about : '';

  if (profileData?.username !== decodedUsername) return revoke('missing');
  if (!he.decode(about).match(userAddrCheckR)) return revoke('optin');
  const karma = profileData.karma || 0;
  if (karma < KARMA_MIN) return revoke('karma');

  const responseHtml = template({
    encodedUsername,
    decodedUsername,
    bioHtml: renderBio(about, userAddrCheckR, karma),
    fields: { karma },
    checkedAt: Date.now()
  });
  await profileCache.put(encodedUsername, responseHtml);
  if (refresh) return res.redirect(303, profileUrl(encodedUsername));
  return res.status(200).send(responseHtml);
}

app.use((err, req, res, next) => {
  console.error('Profile request failed:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).type('text/plain').send('Internal Server Error');
});

const host = process.env.HOST || (process.env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0');
const server = app.listen(port, host, () => {
  console.log(`Server is running on port ${port}`);
});


function shutdown() {
  draining = true;
  server.close(() => process.exit(0));
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
