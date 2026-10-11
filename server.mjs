import express from 'express';
import PQueue from 'p-queue';
import path from 'path';
import template from './template.mjs';
import rateLimit from 'express-rate-limit';
import { renderBio, sansHtml } from './bio.mjs';
import { ProfileCache } from './profile-cache.mjs';

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

function encodeUsername(username) {
  return username
    .split('')
    .map(char => {
      if (char >= 'A' && char <= 'Z') {
        const asciiHex = char.charCodeAt(0).toString(16);
        return `${char.toLowerCase()}0x${asciiHex}`;
      } else if (char === '_') {
        return '0x5f';
      } else {
        return char;
      }
    })
    .join('');
}

function decodeUsername(encodedUsername) {
  return encodedUsername
    .replace(/([a-z])0x([0-9a-f]{2})/g, (match, p1, p2) => {
      const decodedChar = String.fromCharCode(parseInt(p2, 16));
      return p1.toLowerCase() === decodedChar.toLowerCase() ? decodedChar.toUpperCase() : match;
    })
    .replace(/0x5f/g, '_');
}

const app = express();
const port = process.env.PORT || 4008;

app.set('trust proxy', true);

// Replaces the old nginx wildcard rewrite: <sub>.at.hn -> /user?user=<sub>.
// On Railway there's no nginx in front, so the app maps the subdomain itself.
// Faithful to the old nginx: ANY non-asset path on a subdomain resolves to the
// user's profile; static assets (favicon etc.) fall through to express.static;
// apex/www serve the homepage.
app.use((req, res, next) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const m = host.match(/^([^.]+)\.at\.hn$/); // single-label subdomain only
  if (m && m[1] !== 'www' && !/\.(?:html|css|js|png|jpg|jpeg|gif|ico|txt|svg|webp)$/i.test(req.path)) {
    const qs = req.url.includes('?') ? '&' + req.url.split('?')[1] : '';
    req.url = `/user?user=${encodeURIComponent(m[1])}${qs}`;
  }
  next();
});

app.use(express.static(path.join(process.cwd(), 'public')));

app.use('/user', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 50,
  message: 'Too many requests from this IP, please try again after a minute.'
}));

app.get('/user', (req, res, next) => {
  handleProfile(req, res).catch(next);
});

async function handleProfile(req, res) {

  console.log('>req', req.url, 'queue size:', queue.size);

  res.set('Content-Type', 'text/html');

  let responseSent = false;

  function respond(status = 200, html = '', cacheKey = null) {
    if (!responseSent) {
      responseSent = true;
      res.status(status).send(html);
    }
  }

  function respondError(errHtml, status = 404) {
    return respond(status, `<p style="width:500px;margin:0 auto;text-align:left;font-size: 10pt; font-family: monospace; padding: 1em;">${errHtml}</p>`);
  }

  const urlParams = new URL(req.url, 'http://localhost');
  const users = urlParams.searchParams.getAll('user');
  const user = users.length === 1 ? users[0] : null;
  const refresh = urlParams.searchParams.has('refresh');

  if (typeof user !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(user)) {
    return respondError('Bad Request. User param missing or invalid.', 400);
  }
  const decodedUsername = decodeUsername(user);
  const encodedUsername = encodeUsername(decodedUsername);
  if (encodedUsername.length > 63) {
    return respondError('Bad Request. Encoded username is too long.', 400);
  }

  console.log(`Received request for user: ${user}, refresh: ${refresh}`);

  if (user && /\w/.test(user) && user.length < 255) {
    const cacheKey = encodedUsername; // Use encoded username for cache key
    if (!refresh) {
      const cached = await profileCache.get(cacheKey);
      if (cached) return respond(cached.status, cached.html);
    }

    const revoke = () => profileCache.put(cacheKey, '<p>Profile unavailable. Check your HN opt-in and karma.</p>', 404);

    const fetchProfile = async () => {
      try {
        console.log(`Fetching profile for user: ${user}, Decoded: ${decodeUsername(user)}`);

        const profileData = await getProfileData(decodedUsername);

        const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const names = [...new Set([decodedUsername, encodedUsername])].map(escapeRegex).join('|');
        const userAddrCheckR = RegExp(`(?<![A-Za-z0-9_.-])(?:[hH][tT][tT][pP][sS]?://)?(?:${names})\\.[aA][tT]\\.[hH][nN](?=$|[\\s<>\"'/?#),;!\\\]]|\\.(?=$|[\\s<>\"'\\\]]))`);
        const about = typeof profileData?.about === 'string' ? profileData.about : '';

        if (profileData?.username === decodedUsername && about.match(userAddrCheckR)) {
          const karma = profileData.karma || 0;

          if (karma < KARMA_MIN) {
            await revoke();
            return respondError(`You need at least ${KARMA_MIN} karma to be here. This is an anti-spam measure. <3`)
          }

          const bioHtml = renderBio(about, userAddrCheckR, karma);

          const fields = {
            user: profileData.username,
            created: new Date(profileData.created_at).toLocaleDateString(),
            karma: profileData.karma.toString(),
            about: profileData.about
          };
          const responseHtml = template({
            encodedUsername,
            decodedUsername,
            bioHtml,
            fields
          });

          await profileCache.put(cacheKey, responseHtml);

          console.log(`Profile fetched and cached for user: ${user}`);

          if (refresh) {
            const redirect = process.env.NODE_ENV === 'development'
              ? `http://localhost:${port}/user/?user=${encodeURIComponent(encodedUsername)}`
              : `https://${encodedUsername}.at.hn`;

            console.log('Refreshed - redirecting', redirect);

            if (!responseSent) {
              responseSent = true;
              res.redirect(
                303,
                redirect
              );
            }
            return;
          }

          respond(200, responseHtml, cacheKey);
          return;
        }

        console.log(`User bio not found for user: ${user}`);

        await revoke();

        throw 'Does not exist or bio not valid';
      } catch (error) {
        if (error instanceof ProfileError && error.status === 404) await revoke();
        if (error instanceof ProfileError && error.status !== 404) {
          if (error.status === 503) res.set('Retry-After', '5');
          console.error(JSON.stringify({ event: 'profile_upstream_failure', status: error.status }));
          return respondError(error.message, error.status);
        }
        if (error instanceof Error && !(error instanceof ProfileError)) throw error;
        console.log(`No valid profile at: ${encodedUsername}`);
        return respondError(
          `Hmmm, we cannot see you [<a href="https://hn.algolia.com/api/v1/users/${decodedUsername}">${decodedUsername}</a>]. It's possible that you've attempted a username that doesn't exist or is invalid. Important: If your username has uppercase letters or underscores, then encode them according to the instructions on the <a href="https://at.hn">homepage</a>.
          <br/><br/>
          Btw: Ensure that your bio text includes your URL/slug: "${sansHtml(encodedUsername)}.at.hn" or "${sansHtml(decodedUsername)}.at.hn". This ensures you have opted-in to have your bio visible on here.
          <br/><br/>
          Then <a href="https://${sansHtml(encodedUsername)}.at.hn/?refresh">queue a refresh</a> after waiting a couple minutes.
          <br/><br/>Follow guidance on <a href="https://at.hn">at.hn</a> if lost. If it's not working, best to just wait a couple minutes, try again, clear your browser cache, etc.`
        );
      }
    };

    await fetchProfile();
  } else {
    console.log('Bad request: valid user parameter is missing');
    return respondError('Bad Request. User param missing or invalid.', 400);
  }
}

app.use((err, req, res, next) => {
  console.error('Profile request failed:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).type('text/plain').send('Internal Server Error');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

