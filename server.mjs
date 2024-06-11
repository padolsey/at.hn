import express from 'express';
import { marked } from 'marked';
import PQueue from 'p-queue';
import { LRUCache as LRU } from 'lru-cache';
import path from 'path';
import fs from 'fs/promises';
import fss from 'fs';
import crypto from 'crypto';
import template from './template.mjs';
import sanitizeHtml from 'sanitize-html';
import rateLimit from 'express-rate-limit';
import he from 'he';

const PROFILES_DIR = path.join(process.cwd(), 'profiles');
const KARMA_LINK_FOLLOW_MIN = 200;
const REQ_TIMEOUT = 5000;

fs.mkdir(path.join(process.cwd(), 'profiles'), { recursive: true });

if (!fss.existsSync(PROFILES_DIR)) {
  fss.mkdirSync(PROFILES_DIR);
}

function sansHtml(html, tags = []) {
  return sanitizeHtml(html, {
    allowedTags: tags
  });
}

// To avoid hammering HN, no more than 2 reqs in any given sec
const queue = new PQueue({ concurrency: 2, interval: 1000 });

// Dunno
const midTermCache = new LRU({
  max: 1_000, // Maximum number of items in cache
  ttl: 1000 * 60 * 60 * 3
});

// To avoid hammering with '?refresh'
const shortTermCache = new LRU({
  allowStale: false,
  max: 100,
  ttl: 1000 * 5 // 5s
});

const fetchData = async (username) => {
  const url = `https://hn.algolia.com/api/v1/users/${username}`;
  console.log('Fetching', url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return response.json();
};

const hashUsernameForFS = (username) => {
  return crypto.createHash('md5').update(username).digest('hex');
};

// Because _ or uppercase letters can't be in subdomains
// We allow them to be encoded
// So Rally_Driver would be 0.rally.1.0.driver
function encodeUsername(username) {
  return username
    .split('')
    .map(char => {
      if (char >= 'A' && char <= 'Z') {
        return `0.${char.toLowerCase()}`;
      } else if (char === '_') {
        return '.1.';
      } else {
        return char;
      }
    })
    .join('');
}

function decodeUsername(_encodedUsername) {
  return _encodedUsername
    .replace(/0\.(.)/g, (match, p1) => p1.toUpperCase())
    .replace(/\.1\./g, '_');
}

const app = express();
const port = process.env.PORT || 4008;

app.set('trust proxy', true);

app.use(express.static(path.join(process.cwd(), 'public')));

app.use('/user', rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 50,
  message: 'Too many requests from this IP, please try again after a minute.'
}));

app.get('/user', async (req, res) => {

  console.log('>req', req.url, 'queue size:', queue.size);

  res.set('Content-Type', 'text/html');

  let responseSent = false;

  function respond(status = 200, html = '', cacheKey = null) {
    if (!responseSent) {
      responseSent = true;
      if (cacheKey) {
        midTermCache.set(cacheKey, html);
        shortTermCache.set(cacheKey, html);
      }
      res.status(status).send(html);
    }
  }

  function respondError(errHtml, status=404) {
    return respond(status, `<p style="width:500px;margin:0 auto;text-align:left;font-size: 10pt; font-family: monospace; padding: 1em;">${errHtml}</p>`);
  }

  if (queue.size > 1) {
    return respondError('<a href="https://at.hn/">At.hn</a> user pages are being hammered. Queue is too large; please come back later.', 429);
  }

  const urlParams = new URL(req.url, `http://${req.headers.host}`);
  const user = urlParams.searchParams.get('user');
  const refresh = urlParams.searchParams.has('refresh');

  const encodedUsername = encodeUsername(user);
  const decodedUsername = decodeUsername(user);

  console.log(`Received request for user: ${user}, refresh: ${refresh}`);

  if (user && /\w/.test(user) && user.length < 255) {
    const cacheKey = encodeUsername(user); // Use encoded username for cache key
    const hashKey = hashUsernameForFS(cacheKey);
    const filePath = path.join(PROFILES_DIR, `${hashKey}.html`);

    if (shortTermCache.has(cacheKey)) {
      console.log(`ShortTerm Cache hit for user: ${user}`);
      res.send(shortTermCache.get(cacheKey));
      return;
    }

    if (!refresh) {
      if (midTermCache.has(cacheKey)) {
        console.log(`MidTerm Cache hit for user: ${user}`);
        res.send(midTermCache.get(cacheKey));
        return;
      }

      try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        console.log(`File Cache hit for user: ${user}`);
        res.send(fileContent);
        midTermCache.set(cacheKey, fileContent);
        shortTermCache.set(cacheKey, fileContent);
        return;
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`Error reading cache file for user: ${user}`, err);
          res.status(500).send('<strong>Internal Server Error 92</strong>');
          return;
        }
      }
    }

    const fetchProfile = async () => {
      try {
        console.log(`Fetching profile for user: ${user}, Decoded: ${decodeUsername(user)}`);

        const profileData = await fetchData(decodeUsername(user));

        const userAddrCheckEncoded = encodeUsername(user);
        const userAddrCheckR = RegExp(`(<p>)?\\s*?(https?://)?(${decodeUsername(user)}|${userAddrCheckEncoded}).at.hn\\s*(</p>)?`, 'i');

        if (profileData?.username && profileData.about.match(userAddrCheckR)) {
          const karma = profileData.karma || 0;

          marked.use({
            renderer: {
              image: (href, title, txt) => {
                return `<img src="${encodeURI(href)}" alt="${sansHtml(txt)}" class="${txt == 'me' ? 'profile' : ''}" />`
              },
              link: (href, title, txt) => {
                if (/^javascript:/i.test(href.trim())) {
                  return '';
                }
                return `<a href="${encodeURI(href)}" title="${sansHtml(title) || ''}" target="_blank" rel="noopener noreferrer ${karma > KARMA_LINK_FOLLOW_MIN ? '' : 'nofollow'}">${sansHtml(txt)}</a>`;
              }
            }
          });

          const bioHtml = !profileData.about ? '' : sansHtml(
            // run sansHtml two times to prevent badness
            // (TODO: explanation)
            marked(
              he.decode(
                sansHtml(
                  profileData.about
                    .replace(/<p>/g, '<p>\n') // help with bullet lists
                )

              // Replace the x.at.hn slug:
              ).replace(userAddrCheckR, '')
            ),
            [
              'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code',
              'col', 'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption',
              'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
            ]
          );

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

          await fs.writeFile(filePath, responseHtml, 'utf8');

          midTermCache.set(cacheKey, responseHtml);
          shortTermCache.set(cacheKey, responseHtml);

          console.log(`Profile fetched and cached for user: ${user}`);

          if (refresh) {
            const redirect = process.env.NODE_ENV === 'development'
              ? `http://localhost:4008/user/?user=${user}`
              : `https://${user}.at.hn`;

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

        // Clear caches in case the user has changed to opt-out
        midTermCache.delete(cacheKey);
        shortTermCache.delete(cacheKey);
        fs.unlink(filePath).catch(() => {});

        throw 'Does not exist or bio not valid';
      } catch (error) {
        console.error(`No user at: ${user}. Error displayed.`);
        return respondError(
          `Hmmm, we cannot see you [<a href="https://hn.algolia.com/api/v1/users/${decodedUsername}">${decodedUsername}</a>]. It's possible that you've attempted a username that doesn't exist or is invalid. ${decodedUsername !== encodedUsername ? `If your username has uppercase letters or underscores, then encode them thus to access your URL here: <a href="https://${encodedUsername}.at.hn">${encodedUsername}.at.hn</a>` : ''}
          <br/><br/>
          Btw: Ensure that your bio text includes your URL/slug: "${sansHtml(encodedUsername)}.at.hn" or "${sansHtml(decodedUsername)}.at.hn". This ensures you have opted-in to have your bio visible on here.
          <br/><br/>
          Then <a href="https://${sansHtml(encodedUsername)}.at.hn/?refresh">queue a refresh</a> after waiting a couple minutes.
          <br/><br/>Follow guidance on <a href="https://at.hn">at.hn</a> if lost. If it's not working, best to just wait a couple minutes, try again, clear your browser cache, etc.`
        );
      }
    };

    // Race the timeout...
    Promise.race([
      queue.add(fetchProfile),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('timeout');
        }, REQ_TIMEOUT);
      })
    ])
      .then((result) => {
        if (result === 'timeout') {
          console.log(`Request timed out and queued for user: ${user}`);
          return respondError('Request has been queued. Please try again in a little bit.', 202);
        }
      })
      .catch((error) => {
        console.error(`Error in Promise.race for user: ${user}`, error);
        respond(500, 'Internal Server Error');
      });
  } else {
    console.log('Bad request: valid user parameter is missing');
    return respondError('Bad Request. User param missing or invalid.', 400);
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
