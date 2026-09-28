import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const renderer = new Marked({
  gfm: true,
  renderer: {
    html: () => '',
    image: () => '',
  },
});

export function renderPreview(markdown: string): string {
  const html = renderer.parse(markdown, { async: false });
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'del', 's', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'],
    ALLOWED_ATTR: ['href', 'title', 'start', 'align', 'type', 'checked', 'disabled'],
    ALLOW_DATA_ATTR: false,
  });
  const container = document.createElement('div');
  container.innerHTML = safe;
  container.querySelectorAll('a').forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    try {
      const url = new URL(href, 'https://md-capture.invalid/');
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) link.removeAttribute('href');
      else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    } catch { link.removeAttribute('href'); }
  });
  container.querySelectorAll('input').forEach(input => {
    if (input.type !== 'checkbox') input.remove();
    else input.disabled = true;
  });
  return container.innerHTML;
}
