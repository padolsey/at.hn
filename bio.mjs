import { Marked } from 'marked';
import he from 'he';
import sanitizeHtml from 'sanitize-html';

const KARMA_LINK_FOLLOW_MIN = 200;

export function sansHtml(html, tags = [], karma = 0) {
  return sanitizeHtml(html, {
    allowedTags: tags,
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, a: ['href', 'name', 'target', 'rel'] },
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, rel: karma > KARMA_LINK_FOLLOW_MIN ? 'noopener noreferrer' : 'noopener noreferrer nofollow' } })
    }
  });
}

export function renderBio(about, userAddrCheckR, karma) {
          const markdown = new Marked({
            renderer: {
              image: (href, title, txt) => {
                return `<img src="${he.encode(href, { useNamedReferences: true })}" alt="${he.encode(sansHtml(txt), { useNamedReferences: true })}" class="${txt == 'me' ? 'profile' : ''}" />`;
              },
              link: (href, title, txt) => {
                if (/^javascript:/i.test(href.trim())) {
                  return '';
                }
                return `<a href="${he.encode(href, { useNamedReferences: true })}" title="${he.encode(sansHtml(title || ''), { useNamedReferences: true })}" target="_blank" rel="noopener noreferrer ${karma > KARMA_LINK_FOLLOW_MIN ? '' : 'nofollow'}">${sansHtml(txt)}</a>`;
              }
            }
          });

          const bioHtml = !about ? '' : sansHtml(
            markdown.parse(
              he.decode(
                sansHtml(
                  about
                    .replace(/<p>/g, '<p>\n') // help with bullet lists
                )
              ).replace(userAddrCheckR, '')
            ),
            [
              'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code',
              'col', 'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption',
              'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
            ], karma
          );

          return bioHtml;
}
