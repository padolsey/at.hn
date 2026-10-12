import page, { escapeHtml as e, homeUrl, profileUrl } from './page.mjs';
import { encodeUsername, decodeUsername } from './username.mjs';

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
  return page({ title: 'at.hn — your HN bio, with a little more room', content: `
    <header><h1>at.hn</h1><p>Your Hacker News bio, with a little more room.</p></header>
    <p>Give your bio a public page with formatted text, links and images.
      You keep editing it on HN. No extra account is needed.</p>
    ${usernameForm()}
    <p><a href="https://padolsey.at.hn">See an example</a></p>
    <h2>How it works</h2>
    <ol><li>Get your address and add it to your HN bio to opt in.</li>
      <li>Check your profile here to publish the page. Accounts need at least 5 karma.</li>
      <li>Edit your bio on HN whenever you like. Markdown adds formatting.</li></ol>
    <h2>You're in control</h2>
    <p>Only profiles that include their at.hn address are published. To leave, remove that
      address from your HN bio and refresh your page here once HN's profile index has caught up.</p>
    <p>Cached pages expire after three hours; the next visit checks again. A refresh checks
      immediately, but changes on HN can take a few minutes to reach its profile index.</p>
    <p class="meta">An independent project by <a href="https://padolsey.at.hn">James Padolsey</a>.
      Not affiliated with Hacker News or Y Combinator.</p>${footer()}` });
}

export function setupPage(params) {
  const values = params.getAll('username');
  const username = values.length === 1 ? values[0].trim() : '';
  let error;
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(username)) {
    error = 'Enter one HN username using letters, numbers, underscores or hyphens.';
  }
  const encoded = encodeUsername(username);
  if (!error && encoded === 'www') {
    error = 'The www.at.hn address is reserved for the homepage. This username cannot have a profile subdomain.';
  }
  if (!error && (encoded.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(encoded))) {
    error = 'This username cannot be represented by an at.hn subdomain. It may be too long after encoding, or start or end with a hyphen.';
  }
  if (!error && decodeUsername(encoded) !== username) {
    error = 'This username conflicts with the existing at.hn address encoding. We cannot generate an unambiguous address for it.';
  }
  if (!error) {
    try {
      // DNS-shaped labels may still be invalid browser hostnames (e.g. xn--a).
      if (new URL(`https://${encoded}.at.hn`).hostname !== `${encoded}.at.hn`) throw new Error('Different hostname');
    } catch {
      error = 'This username cannot be represented by a valid at.hn web address.';
    }
  }
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
