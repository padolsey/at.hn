import he from 'he';
import { previewHost } from './preview.mjs';

export const escapeHtml = value => he.encode(String(value), { useNamedReferences: true });
export const homeUrl = () => previewHost || process.env.NODE_ENV === 'development' ? '/' : 'https://at.hn/';
export const profileUrl = (username, refresh = false) => previewHost || process.env.NODE_ENV === 'development'
  ? `/user?user=${encodeURIComponent(username)}${refresh ? '&refresh' : ''}`
  : `https://${username}.at.hn${refresh ? '/?refresh' : ''}`;

export default function page({ title, content }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 1rem; color: #222; background: #fff;
      font: 1rem/1.65 Verdana, Geneva, sans-serif; }
    #c { max-width: 76ch; margin: 0 auto; padding: clamp(1rem, 4vw, 2rem);
      background: #f6f6ef; border-top: 3px solid #ff6600; overflow-wrap: anywhere; }
    h1, h2, h3 { line-height: 1.25; }
    h1 { font-size: 1.8rem; margin: 0 0 .5rem; }
    h2 { font-size: 1.2rem; margin-top: 1.75rem; }
    a { color: #174c76; text-underline-offset: .15em; }
    header h1 a { color: inherit; text-decoration: none; }
    header p { margin: .3rem 0; }
    .muted, .meta, footer { color: #595959; }
    .meta, footer { font-size: .875rem; }
    nav { display: flex; flex-wrap: wrap; gap: .25rem 1rem; }
    .bio { margin: 2rem 0; }
    .bio img { display: block; max-width: min(100%, 400px); height: auto; }
    .bio pre { overflow: auto; padding: .8rem; background: #eeeee5; }
    .bio pre code { overflow-wrap: normal; }
    .bio table { display: block; max-width: 100%; overflow-x: auto; overflow-wrap: normal; border-collapse: collapse; }
    .bio th, .bio td { padding: .4rem .65rem; border: 1px solid #c9c9bf; }
    .bio blockquote { margin-inline: 0; padding-left: 1rem; border-left: 3px solid #c9c9bf; }
    code, input[readonly] { font-family: ui-monospace, monospace; }
    label { display: block; margin-bottom: .35rem; font-weight: bold; }
    input { max-width: 100%; width: 30rem; padding: .65rem; border: 1px solid #777;
      border-radius: 2px; background: #fff; color: #222; font: inherit; }
    input[readonly] { width: 100%; }
    button, .button { display: inline-block; padding: .55rem .9rem; border: 1px solid #555;
      border-radius: 2px; background: #fff; color: #222; font: inherit; cursor: pointer; }
    .button { text-decoration: none; }
    :focus-visible { outline: 3px solid #174c76; outline-offset: 3px; }
    .hint { font-size: .875rem; margin: .4rem 0 1rem; }
    .error { border-left: 3px solid #a12a14; padding-left: 1rem; }
    li { margin-bottom: .65rem; }
    footer { border-top: 1px solid #c9c9bf; padding-top: 1rem; margin-top: 2rem; }
    summary { cursor: pointer; }
    time { white-space: normal; }
    @media (max-width: 480px) { body { padding: 0; } h1 { font-size: 1.5rem; } }
  </style>
</head>
<body><main id="c">${previewHost ? '<p class="meta">Staging preview</p>' : ''}${content}</main></body>
</html>`;
}
