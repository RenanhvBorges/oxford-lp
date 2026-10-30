// Gera o blog estático a partir de content/blog/*.md.
//   content/blog/<slug>.md  ->  blog/<slug>.html
//   blog/index.html (listagem paginada), blog/pagina/N.html, blog/feed.xml
// Também regenera sitemap.xml (páginas fixas + posts). Rode com `npm run build`.
//
// Front matter aceito (entre --- no topo do .md):
//   title        obrigatório
//   description  meta description / resumo do card
//   date         obrigatório, AAAA-MM-DD
//   updated      opcional, AAAA-MM-DD
//   slug         opcional (padrão: nome do arquivo)
//   category     opcional
//   author       opcional (padrão: Oxford Soluções Digitais)
//   image        opcional, caminho a partir de /blog/img/ ou URL absoluta
//   cta          opcional, frase do CTA específica do tema (vai acima do bloco padrão)
//   tema         opcional, número do tema no _guia-pautas.md (controle do que já foi escrito)
//   draft        true = não publica
// Para ver rascunhos localmente: npm run preview (BLOG_DRAFTS=1).
// Arquivos que começam com "_" são ignorados (ex.: _modelo.md).

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'blog');
const OUT = path.join(ROOT, 'blog');
const SITE = 'https://www.oxfordmkt.com';
const PER_PAGE = 12;
const DEFAULT_AUTHOR = 'Oxford Soluções Digitais';
const DEFAULT_IMAGE = `${SITE}/img/og-oxford.jpg`;
const GTM = 'GTM-WV3CXKBR';

const css = fs.readFileSync(path.join(__dirname, 'blog.css'), 'utf8');
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const imgUrl = (i) => (!i ? DEFAULT_IMAGE : /^https?:/.test(i) ? i : `${SITE}/blog/img/${i.replace(/^\/+/, '')}`);

function parse(file) {
  const raw = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/^\uFEFF/, '');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: front matter (--- ... ---) ausente`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  for (const k of ['title', 'date']) if (!meta[k]) throw new Error(`${file}: campo "${k}" obrigatório`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) throw new Error(`${file}: date deve ser AAAA-MM-DD`);
  meta.slug = meta.slug || file.replace(/\.md$/, '');
  return { meta, body: m[2] };
}

const head = ({ title, description, canonical, image, type = 'website', extra = '' }) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>
<script defer src="/_vercel/insights/script.js"></script>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#263fa3">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="Blog Oxford" href="/blog/feed.xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Oxford Soluções Digitais">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
${extra}
<style>${css}</style>
</head>
<body>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<header class="site-header">
  <div class="wrap header-inner">
    <a href="/" aria-label="Oxford Soluções Digitais, página inicial"><img src="/img/logo-oxford-branco-180.webp" srcset="/img/logo-oxford-branco-180.webp 180w, /img/logo-oxford-branco-360.webp 360w" sizes="150px" width="150" height="34" alt="Oxford Soluções Digitais"></a>
    <a href="/#sessao" class="btn">Diagnóstico gratuito</a>
  </div>
</header>
`;

const foot = `
<footer>
  <div class="wrap">
    <nav aria-label="Links do rodapé">
      <a href="/">Início</a>
      <a href="/blog">Blog</a>
      <a href="https://www.instagram.com/oxfordmkt/" target="_blank" rel="noopener">Instagram</a>
      <a href="/privacidade">Política de privacidade</a>
    </nav>
    <span>© ${new Date().getFullYear()} Oxford Soluções Digitais · CNPJ 58.364.658/0001-62</span>
  </div>
</footer>
</body>
</html>
`;

const ctaBox = (custom) => `<aside class="cta-box">
  ${custom ? `<p><strong>${esc(custom)}</strong></p>` : ''}
  <h2>Descubra o que está segurando a sua loja.</h2>
  <p>Em 20 minutos, online e sem compromisso, você vê o diagnóstico da sua operação, cases de e-commerces que saíram de onde você está e o plano de crescimento para o momento da sua loja.</p>
  <p>Atendemos apenas 5 novos e-commerces por mês.</p>
  <p><a href="/#sessao" class="btn" data-cta="blog-post">Quero meu diagnóstico gratuito</a></p>
  <p class="disclaimer"><em>Resultados de clientes variam conforme produto, margem, estoque e investimento.</em></p>
</aside>`;

function card({ meta }) {
  const img = meta.image ? `<img src="${imgUrl(meta.image)}" alt="" loading="lazy" width="640" height="360">` : '';
  return `<li><article class="card">${img}<div class="card-body">
    ${meta.category ? `<p class="eyebrow">${esc(meta.category)}</p>` : ''}
    <h2><a href="/blog/${meta.slug}">${esc(meta.title)}</a></h2>
    ${meta.description ? `<p>${esc(meta.description)}</p>` : ''}
    <p class="meta"><time datetime="${meta.date}">${fmtDate(meta.date)}</time></p>
  </div></article></li>`;
}

function listPage(posts, page, pages) {
  const url = page === 1 ? `${SITE}/blog` : `${SITE}/blog/pagina/${page}`;
  const slice = posts.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const title = page === 1 ? 'Blog | Oxford Soluções Digitais' : `Blog, página ${page} | Oxford Soluções Digitais`;
  const desc = 'Conteúdo da Oxford sobre tráfego pago, conversão e growth para e-commerces que querem vender mais.';
  const href = (n) => (n === 1 ? '/blog' : `/blog/pagina/${n}`);
  const pager = pages > 1 ? `<nav class="pager" aria-label="Paginação">${Array.from({ length: pages }, (_, i) => i + 1)
    .map((n) => (n === page ? `<span aria-current="page">${n}</span>` : `<a href="${href(n)}">${n}</a>`)).join('')}</nav>` : '';
  const extra = (page > 1 ? `<link rel="prev" href="${SITE}${href(page - 1)}">` : '') + (page < pages ? `<link rel="next" href="${SITE}${href(page + 1)}">` : '');
  return head({ title, description: desc, canonical: url, image: DEFAULT_IMAGE, extra }) + `<main class="wrap">
  <p class="eyebrow">Blog</p>
  <h1>Growth para e-commerces</h1>
  <p class="lead">${desc}</p>
  ${slice.length ? `<ul class="grid">${slice.map(card).join('')}</ul>${pager}` : '<p class="empty">Em breve, os primeiros artigos.</p>'}
</main>` + foot;
}

function postPage({ meta, body }) {
  const url = `${SITE}/blog/${meta.slug}`;
  const html = marked.parse(body, { gfm: true });
  const author = meta.author || DEFAULT_AUTHOR;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: meta.title,
    description: meta.description || undefined,
    image: imgUrl(meta.image),
    datePublished: meta.date,
    dateModified: meta.updated || meta.date,
    author: { '@type': 'Organization', name: author },
    publisher: { '@type': 'Organization', name: DEFAULT_AUTHOR, logo: { '@type': 'ImageObject', url: `${SITE}/img/icon-512.png` } },
    mainEntityOfPage: url,
    inLanguage: 'pt-BR',
  };
  const extra = `<meta property="article:published_time" content="${meta.date}">
${meta.updated ? `<meta property="article:modified_time" content="${meta.updated}">` : ''}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  return head({ title: `${meta.title} | Oxford`, description: meta.description || meta.title, canonical: url, image: imgUrl(meta.image), type: 'article', extra }) + `<main class="wrap narrow">
  <p class="crumbs"><a href="/blog">← Blog</a></p>
  <article class="post">
    ${meta.category ? `<p class="eyebrow">${esc(meta.category)}</p>` : ''}
    <h1>${esc(meta.title)}</h1>
    <p class="meta">Por ${esc(author)} · <time datetime="${meta.date}">${fmtDate(meta.date)}</time>${meta.updated ? ` · Atualizado em <time datetime="${meta.updated}">${fmtDate(meta.updated)}</time>` : ''}</p>
    ${meta.image ? `<img class="post-cover" src="${imgUrl(meta.image)}" alt="" width="1200" height="630">` : ''}
    ${html}
  </article>
  ${ctaBox(meta.cta)}
</main>` + foot;
}

function feed(posts) {
  const items = posts.slice(0, 20).map(({ meta }) => `  <item>
    <title>${esc(meta.title)}</title>
    <link>${SITE}/blog/${meta.slug}</link>
    <guid>${SITE}/blog/${meta.slug}</guid>
    <pubDate>${new Date(meta.date + 'T12:00:00Z').toUTCString()}</pubDate>
    <description>${esc(meta.description || '')}</description>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Blog Oxford</title>
  <link>${SITE}/blog</link>
  <description>Tráfego pago, conversão e growth para e-commerces.</description>
  <language>pt-BR</language>
${items}
</channel></rss>
`;
}

function sitemap(posts) {
  const url = (loc, lastmod, freq, prio) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  const latest = posts[0] ? (posts[0].meta.updated || posts[0].meta.date) : '2026-10-22';
  const entries = [
    url(`${SITE}/`, '2026-10-22', 'weekly', '1.0'),
    url(`${SITE}/blog`, latest, 'weekly', '0.8'),
    ...posts.map(({ meta }) => url(`${SITE}/blog/${meta.slug}`, meta.updated || meta.date, 'monthly', '0.6')),
    url(`${SITE}/privacidade`, '2026-10-22', 'yearly', '0.2'),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'pagina'), { recursive: true });

  const files = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => f.endsWith('.md') && !f.startsWith('_')) : [];
  const posts = files.map((f) => ({ file: f, ...parse(f) })).filter((p) => p.meta.draft !== 'true' || process.env.BLOG_DRAFTS === '1');

  const seen = new Set();
  for (const p of posts) {
    if (seen.has(p.meta.slug)) throw new Error(`slug duplicado: ${p.meta.slug}`);
    seen.add(p.meta.slug);
  }
  posts.sort((a, b) => b.meta.date.localeCompare(a.meta.date));

  const pages = Math.max(1, Math.ceil(posts.length / PER_PAGE));
  for (let n = 1; n <= pages; n++) {
    const file = n === 1 ? path.join(OUT, 'index.html') : path.join(OUT, 'pagina', `${n}.html`);
    fs.writeFileSync(file, listPage(posts, n, pages));
  }
  for (const p of posts) fs.writeFileSync(path.join(OUT, `${p.meta.slug}.html`), postPage(p));
  fs.writeFileSync(path.join(OUT, 'feed.xml'), feed(posts));
  if (fs.existsSync(path.join(SRC, 'img'))) fs.cpSync(path.join(SRC, 'img'), path.join(OUT, 'img'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap(posts));
  console.log(`blog: ${posts.length} post(s), ${pages} página(s) de listagem`);
}

build();
