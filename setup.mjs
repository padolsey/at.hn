import page, { escapeHtml as e, homeUrl, profileUrl } from './page.mjs';
import { usernameAddress } from './public/username.mjs';
import { readFileSync } from 'node:fs';
import { previewHost } from './preview.mjs';

const homepage = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');

const footer = () => `<footer><nav aria-label="About at.hn"><a href="${homeUrl()}">About at.hn</a>
  <a href="https://github.com/padolsey/at.hn">Source code</a></nav></footer>`;

function usernameForm(username = '', error = '') {
  return `${error ? `<p class="error" id="username-error">${e(error)}</p>` : ''}
  <form action="/setup" method="get">
    <label for="username">Your HN username</label>
    <input id="username" name="username" value="${e(username)}" required maxlength="63"
      autocapitalize="none" spellcheck="false" autocomplete="off" aria-describedby="username-hint${error ? ' username-error' : ''}"${error ? ' aria-invalid="true"' : ''}>
    <p class="hint" id="username-hint">Use the same uppercase and lowercase letters as on HN.</p>
    <button type="submit">Get my address</button>
  </form>`;
}

export function homePage() {
  let html = homepage
    .replaceAll('href="https://padolsey.at.hn"', `href="${e(profileUrl('padolsey'))}"`)
    .replace('href="https://at.hn"', `href="${e(homeUrl())}"`);
  if (previewHost || process.env.NODE_ENV === 'development') {
    html = html.replace('data-profile-mode="subdomain"', 'data-profile-mode="path"');
  }
  if (previewHost) html = html.replace('<div id="c">', '<div id="c"><p>Staging preview</p>');
  return html;
}

export function setupPage(params) {
  const values = params.getAll('username');
  const { username, encoded, error } = usernameAddress(values.length === 1 ? values[0] : '');
  if (error) return { status: 400, html: page({ title: 'Get your at.hn address', content:
    `<h1>Get your at.hn address</h1>${usernameForm(username, error)}${footer()}` }) };
  const address = `${encoded}.at.hn`;
  return { status: 200, html: page({ title: `Set up ${username} on at.hn`, content: `
    <header><h1>Set up your page</h1><p>HN username: <strong>${e(username)}</strong></p></header>
    <h2>1. Copy your address</h2>
    <label for="address">Add this text anywhere in your HN bio</label>
    <input id="address" readonly value="${e(address)}" aria-describedby="address-hint">
    <p class="hint" id="address-hint">${encoded !== username ? 'Your address encodes uppercase letters and underscores automatically. ' : ''}Select the text above and copy it.</p>
    <h2>2. Save it on HN</h2>
    <p><a href="https://news.ycombinator.com/user?id=${encodeURIComponent(username)}" target="_blank" rel="noopener noreferrer">Open your HN profile (new tab)</a>,
      sign in there if needed, and add the address to your <strong>about</strong> section. Save your changes.</p>
    <h2>3. Check your profile</h2>
    <p><a class="button" href="/user?user=${encodeURIComponent(encoded)}&amp;refresh">Check my profile</a></p>
    <p>This checks HN's profile index for your opt-in. Recent edits can take a few minutes to appear.
      Accounts need at least 5 karma.</p>
    <p>Your public address: <a href="${e(profileUrl(encoded))}">${e(address)}</a></p>
    <p><a href="${homeUrl()}">Use a different username</a></p>${footer()}` }) };
}

export function profileStatusPage({ kind, encodedUsername, decodedUsername }) {
  const address = `${encodedUsername}.at.hn`;
  const messages = {
    optin: ['This page is not published', `We found your HN profile, but its bio does not include the opt-in text <code>${e(address)}</code>.
      If you removed it, your cached page is no longer served. To publish, add that text to your bio and save it.`],
    missing: ['Profile not found in the index', 'HN’s profile index did not return this account. Check the spelling and capitalization of your username. A new account may take time to appear.'],
    karma: ['This account needs more karma', 'Your opt-in was found, but at.hn requires at least 5 karma to publish a page. This helps limit spam. Any previously cached page is no longer served.'],
    unavailable: ['Could not check your profile', 'HN’s profile index is temporarily unavailable. We could not confirm your latest changes. Try again in 30 seconds.'],
    timeout: ['The profile check timed out', 'HN’s profile index took too long to respond. We could not confirm your latest changes. Try again in 30 seconds.'],
    busy: ['Please try again shortly', 'All profile checks are currently busy. Try again in 5 seconds.'],
    invalid: ['Check your username', 'The address is missing a valid username. Use the setup helper to get the exact address for your HN account.']
  };
  const [title, message] = messages[kind];
  return page({ title: `${title} — at.hn`, content: `<h1>${title}</h1><p>${message}</p>
    ${kind !== 'invalid' ? `<p><a class="button" href="${e(profileUrl(encodedUsername, true))}">Check again</a></p>
      <p><a href="https://news.ycombinator.com/user?id=${encodeURIComponent(decodedUsername)}">View or edit your HN profile</a></p>
      <p class="meta">Checks bypass at.hn's cache. Edits on HN can take a few minutes to reach its profile index.</p>` : ''}
    <p><a href="${homeUrl()}">Get help with your address</a></p>${footer()}` });
}
