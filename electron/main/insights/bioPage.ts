/**
 * Link-in-bio page generator: produces a single self-contained static HTML
 * file (inline CSS, no dependencies) the user can host anywhere — GitHub
 * Pages, S3, their site — and link from every social profile.
 */

export interface BioPageInput {
  name: string;
  tagline?: string;
  brokerage?: string;
  phone?: string;
  email?: string;
  accentColor?: string;
  links: Array<{ label: string; url: string }>;
  listings?: Array<{
    address: string;
    price?: string;
    specs?: string;
    url?: string;
    photoUrl?: string;
  }>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildBioPageHtml(input: BioPageInput): string {
  const accent = input.accentColor ?? '#4d7cff';
  const links = input.links
    .map(
      (l) =>
        `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`,
    )
    .join('\n      ');

  const listings = (input.listings ?? [])
    .map((l) => {
      const img = l.photoUrl
        ? `<img src="${esc(l.photoUrl)}" alt="${esc(l.address)}" loading="lazy"/>`
        : '';
      const inner = `${img}<div class="meta"><p class="addr">${esc(l.address)}</p>${
        l.price ? `<p class="price">${esc(l.price)}</p>` : ''
      }${l.specs ? `<p class="specs">${esc(l.specs)}</p>` : ''}</div>`;
      return l.url
        ? `<a class="listing" href="${esc(l.url)}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="listing">${inner}</div>`;
    })
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(input.name)}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0c0c0f; color: #f4f4f6;
         min-height: 100vh; display: flex; justify-content: center; padding: 40px 16px; }
  .card { width: 100%; max-width: 420px; text-align: center; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .tagline { color: #a1a1ab; font-size: 14px; margin-bottom: 2px; }
  .brokerage { color: #71717f; font-size: 12px; margin-bottom: 16px; }
  .contact { font-size: 12px; color: #a1a1ab; margin-bottom: 24px; }
  .contact a { color: var(--accent); text-decoration: none; }
  .link { display: block; background: #17171b; border: 1px solid #26262c; border-radius: 12px;
          padding: 14px; margin-bottom: 10px; color: #f4f4f6; text-decoration: none;
          font-weight: 600; font-size: 14px; transition: border-color .15s, transform .15s; }
  .link:hover { border-color: var(--accent); transform: translateY(-1px); }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; color: #71717f;
       margin: 28px 0 12px; }
  .listing { display: block; background: #17171b; border: 1px solid #26262c; border-radius: 12px;
             overflow: hidden; margin-bottom: 12px; text-decoration: none; color: inherit; text-align: left; }
  .listing img { width: 100%; height: 180px; object-fit: cover; display: block; }
  .listing .meta { padding: 12px 14px; }
  .listing .addr { font-weight: 600; font-size: 14px; }
  .listing .price { color: var(--accent); font-weight: 700; font-size: 14px; margin-top: 2px; }
  .listing .specs { color: #a1a1ab; font-size: 12px; margin-top: 2px; }
  footer { margin-top: 28px; font-size: 11px; color: #4a4a55; }
</style>
</head>
<body>
  <div class="card">
    <h1>${esc(input.name)}</h1>
    ${input.tagline ? `<p class="tagline">${esc(input.tagline)}</p>` : ''}
    ${input.brokerage ? `<p class="brokerage">${esc(input.brokerage)}</p>` : ''}
    ${
      input.phone || input.email
        ? `<p class="contact">${input.phone ? esc(input.phone) : ''}${
            input.phone && input.email ? ' · ' : ''
          }${input.email ? `<a href="mailto:${esc(input.email)}">${esc(input.email)}</a>` : ''}</p>`
        : ''
    }
    ${links ? `<div class="links">\n      ${links}\n    </div>` : ''}
    ${listings ? `<h2>Featured Listings</h2>\n      ${listings}` : ''}
    <footer>Built with USCut</footer>
  </div>
</body>
</html>
`;
}
