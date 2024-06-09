import express from 'express';
import { JSDOM } from 'jsdom';
import { marked } from 'marked';
import PQueue from 'p-queue';
import { LRUCache as LRU } from 'lru-cache';
import path from 'path';
import fs from 'fs/promises';
import fss from 'fs';
import crypto from 'crypto';
import template from './template.mjs';
import sanitizeHtml from 'sanitize-html';

const PROFILES_DIR = path.join(process.cwd(), 'profiles');

if (!fss.existsSync(PROFILES_DIR)) {
  fss.mkdirSync(PROFILES_DIR);
}

marked.use({
  renderer: {
    image: (href, title, txt) => {
      return `<img src="${href}" alt="${txt}" class="${txt == 'me' ? 'profile' : ''}" />`
    }
  }
});

function sansHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: []
  });
}

// To avoid hammering HN, no more than 1 req per second
const queue = new PQueue({ concurrency: 1, interval: 1000 });

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

const fetchData = async (url) => {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Failed to fetch ${url}: ${r.statusText}`);
  }
  return r.text();
};

const hashUsernameForFS = (username) => {
  return crypto.createHash('md5').update(username).digest('hex');
};

const app = express();
const port = process.env.PORT || 4008;

app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/user', async (req, res) => {

  console.log('>req', req.url, req.headers);

  res.set('Content-Type', 'text/html');

  function respond(status = 200, html = '', cacheKey = null) {
    if (cacheKey) {
      midTermCache.set(cacheKey, html);
      shortTermCache.set(cacheKey, html);
    }
    res.status(status).send(html);
  }

  const urlParams = new URL(req.url, `http://${req.headers.host}`);
  const user = urlParams.searchParams.get('user');
  const refresh = urlParams.searchParams.has('refresh');

  console.log(`Received request for user: ${user}, refresh: ${refresh}`);

  if (user && /\w/.test(user) && user.length < 255) {
    const cacheKey = user;
    const hashKey = hashUsernameForFS(user);
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
        console.log(`Fetching profile for user: ${user}`);
        const hnProfileUrl = `https://news.ycombinator.com/user?id=${user}`;
        const html = await fetchData(hnProfileUrl);

        const dom = new JSDOM(html);
        const fields = [
          ...dom.window.document.querySelectorAll('table table tr')
        ].reduce((acc, tr) => {
          const k = tr.querySelector('td')?.textContent;
          if (['created:', 'user:', 'karma:', 'about:'].includes(k)) {
            acc[k.slice(0, -1)] = sansHtml(
              tr.querySelector('td:nth-child(2)')?.innerHTML
                .replace(/<p>/g, '\n<p>\n').replace(/<\/p>/g, '\n</p>\n')
              || ''
            );
          }
          return acc;
        }, {});

        const userAddrCheckR =
          RegExp(`(<p>)?\s*?(https?://)?${user}.at.hn\s*(</p>)?`, 'i');

        if (fields.about && fields.about.match(userAddrCheckR)) {
          const bioHtml = marked(
            fields.about.replace(userAddrCheckR, '')
          );
          const responseHtml = template({ user, bioHtml, fields });

          await fs.mkdir(path.join(process.cwd(), 'profiles'), { recursive: true });
          await fs.writeFile(filePath, responseHtml, 'utf8');

          console.log(`Profile fetched and cached for user: ${user}`);
          respond(200, responseHtml, cacheKey);
          return;
        }

        console.log(`User bio not found or does not include the required link for user: ${user}`);
        return respond(
          404,
          `<p style="width:500px;margin:0 auto;text-align:center;font-size: 12pt; font-family: monospace; padding: 1em;">Hmmm, we cannot see you. Either you do not exist on HN or your bio text does not include the required reference to "${sansHtml(user)}.at.hn". If it is your bio, just include the text "${sansHtml(user)}.at.hn" and then wait and come back <a href="https://${sansHtml(user)}.at.hn/?refresh">here</a>. This ensures you have opted-in to have your bio visible on this site. Follow guidance on <a href="https://at.hn">at.hn</a> if lost.</p>`,
          cacheKey
        );
      } catch (error) {
        console.error(`Error fetching profile for user: ${user}`, error);
        return respond(
          500,
          '<strong>Internal Server Error 34</strong>',
          cacheKey
        );
      }
    };

    // Add the fetchProfile task to the queue with a timeout
    // ... If too many refreshes have been requested...
    const queueTask = queue.add(fetchProfile);
    const timeout = setTimeout(() => {
      console.log(`Request timed out and queued for user: ${user}`);
      res.status(202).send('Request has been queued. Please try again in a little bit.');
    }, 3000);

    queueTask.finally(() => clearTimeout(timeout));
  } else {
    console.log('Bad request: valid user parameter is missing');
    res.status(400).send('Bad Request');
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
