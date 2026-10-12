import page, { escapeHtml as e, homeUrl, profileUrl } from './page.mjs';

export default ({ encodedUsername, decodedUsername, fields, bioHtml, checkedAt }) => {
  const hnProfile = `https://news.ycombinator.com/user?id=${encodeURIComponent(decodedUsername)}`;
  const refreshUrl = e(profileUrl(encodedUsername, true));
  const checked = checkedAt ? new Date(checkedAt).toISOString() : null;
  return page({ title: `${decodedUsername}.at.hn`, content: `
    <header>
      <h1><a href="${e(profileUrl(encodedUsername))}">${e(decodedUsername)}<span class="muted">.at.hn</span></a></h1>
      ${decodedUsername !== encodedUsername ? `<p class="meta">Address: ${e(encodedUsername)}.at.hn</p>` : ''}
      <nav class="meta" aria-label="On Hacker News">
        <span>karma: ${e(fields.karma)}</span>
        <a href="${hnProfile}">HN profile</a>
        <a href="https://news.ycombinator.com/submitted?id=${encodeURIComponent(decodedUsername)}">submissions</a>
        <a href="https://news.ycombinator.com/threads?id=${encodeURIComponent(decodedUsername)}">comments</a>
      </nav>
    </header>
    <div class="bio">${bioHtml}</div>
    <footer>
      ${checked ? `<p>Last checked: <time datetime="${checked}">${checked.slice(0, 19).replace('T', ' ')} UTC</time>.</p>` : ''}
      <nav aria-label="Manage this page"><a href="${refreshUrl}">Refresh from HN</a>
        <a href="${hnProfile}">Edit bio on HN</a></nav>
      <p>Changes on HN can take a few minutes to reach its profile index.
        Cached pages expire after three hours; the next visit checks again.</p>
      <details><summary>Remove this page</summary>
        <p>Remove every occurrence of <code>${e(encodedUsername)}.at.hn</code>${decodedUsername !== encodedUsername ? ` and <code>${e(decodedUsername)}.at.hn</code>` : ''}
          from your HN bio and save it. Then <a href="${refreshUrl}">refresh from HN</a>.</p>
        <p>Once the edit reaches HN's profile index, a refresh removes the cached page.
          If your page still appears, wait a few minutes and try again.</p>
      </details>
      <p><a href="${homeUrl()}">About at.hn</a> · <a href="https://github.com/padolsey/at.hn">Source code</a></p>
    </footer>` });
};
