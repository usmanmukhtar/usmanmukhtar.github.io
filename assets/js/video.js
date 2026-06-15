/* ============================================================
   AfterOfficeLife — Video Page JS
   Loads from /data/videos.json + /posts/{videoId}.json
   ============================================================ */

const DATA_URL = './data/videos.json';
const POSTS_URL = id => `./posts/${id}.json`;

async function init() {
  const params  = new URLSearchParams(location.search);
  const videoId = params.get('v');

  if (!videoId) {
    window.location.href = '/';
    return;
  }

  // Load video data
  let video = null;
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    video = (data.videos || []).find(v => v.id === videoId);
  } catch (e) {
    console.error('Failed to load videos.json', e);
    document.getElementById('videoMain').innerHTML =
      `<p style="color:var(--text-muted);padding:4rem 0;text-align:center;">Could not load video data. Make sure you are running the site via <code>npm run serve</code> (not opening the HTML file directly). <a href="/" style="color:var(--accent)">← Back home</a></p>`;
    return;
  }

  if (!video) {
    document.getElementById('videoMain').innerHTML =
      `<p style="color:var(--text-muted);padding:4rem 0;text-align:center;">Video not found. <a href="/" style="color:var(--accent)">← Back home</a></p>`;
    return;
  }

  // Update SEO tags dynamically
  updateSEO(video);

  // Render layout
  renderLayout(video);

  // Load AI blog post (if exists)
  loadBlog(videoId, video);

  // Load related videos
  loadRelated(videoId);
}

/* ── SEO ── */
function updateSEO(v) {
  const thumb = bestThumb(v);
  const desc  = (v.description || '').slice(0, 155).replace(/\n/g, ' ');

  document.getElementById('pageTitle').textContent    = `${v.title} | AfterOfficeLife`;
  document.getElementById('metaDesc').setAttribute('content', desc);
  document.getElementById('canonicalLink').setAttribute('href', `https://afterofficelife.github.io/video.html?v=${v.id}`);
  document.getElementById('ogTitle').setAttribute('content', v.title);
  document.getElementById('ogDesc').setAttribute('content', desc);
  document.getElementById('ogImage').setAttribute('content', thumb);
  document.getElementById('ogUrl').setAttribute('content', `https://afterofficelife.github.io/video.html?v=${v.id}`);
  document.getElementById('twTitle').setAttribute('content', v.title);
  document.getElementById('twDesc').setAttribute('content', desc);
  document.getElementById('twImage').setAttribute('content', thumb);

  // Article Schema
  document.getElementById('articleSchema').textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: v.title,
    description: desc,
    image: thumb,
    datePublished: v.publishedAt,
    author: { '@type': 'Person', name: 'AfterOfficeLife' },
    publisher: {
      '@type': 'Organization',
      name: 'AfterOfficeLife',
      url: 'https://afterofficelife.github.io'
    },
    mainEntityOfPage: `https://afterofficelife.github.io/video.html?v=${v.id}`,
    keywords: (v.tags || []).join(', ')
  });
}

/* ── LAYOUT ── */
function renderLayout(v) {
  const chapters = parseChapters(v.description || '');

  document.getElementById('videoMain').innerHTML = `
    <div class="video-layout">

      <!-- Left: Player + blog -->
      <div class="video-player-col">
        <div class="video-player-wrap">
          <iframe
            src="https://www.youtube.com/embed/${v.id}?rel=0&modestbranding=1"
            title="${esc(v.title)}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            loading="lazy">
          </iframe>
        </div>

        <div class="video-title-block">
          ${v.game ? `<span class="video-game-badge">🎮 ${esc(v.game)}</span>` : ''}
          <h1 class="video-h1">${esc(v.title)}</h1>
          <div class="video-meta-row">
            <span>${formatDate(v.publishedAt)}</span>
            <a class="video-yt-link" href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">
              ▶ Watch on YouTube
            </a>
          </div>
        </div>

        <!-- Blog post injected here -->
        <div id="blogArea"></div>
      </div>

      <!-- Right: Chapters sidebar -->
      <div class="video-sidebar">
        ${chapters.length ? renderChapters(chapters, v.id) : renderRawDesc(v.description)}
      </div>
    </div>
  `;
}

/* ── CHAPTERS ── */
function parseChapters(desc) {
  const lines    = desc.split('\n');
  const chapters = [];
  const re       = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/;
  lines.forEach(line => {
    const m = line.match(re);
    if (m) chapters.push({ time: m[1], name: m[2].trim() });
  });
  return chapters;
}

function renderChapters(chapters, videoId) {
  const items = chapters.map(c => {
    const secs = timeToSeconds(c.time);
    return `
      <div class="chapter-item" onclick="seekTo(${secs})" role="button" tabindex="0"
           aria-label="Jump to ${c.name} at ${c.time}">
        <span class="chapter-time">${c.time}</span>
        <span class="chapter-name">${esc(c.name)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="chapters-box">
      <div class="chapters-header">Chapters</div>
      ${items}
    </div>
  `;
}

function renderRawDesc(desc) {
  if (!desc) return '';
  const short = desc.slice(0, 600);
  return `<div class="raw-description">${esc(short)}${desc.length > 600 ? '…' : ''}</div>`;
}

function timeToSeconds(t) {
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  return parts[0]*60 + parts[1];
}

// Seeks embedded player by rebuilding iframe src with start=
function seekTo(seconds) {
  const iframe = document.querySelector('.video-player-wrap iframe');
  if (!iframe) return;
  const src = iframe.src.split('?')[0];
  const params = new URLSearchParams(iframe.src.split('?')[1] || '');
  params.set('start', seconds);
  params.set('autoplay', 1);
  iframe.src = `${src}?${params.toString()}`;
}

/* ── BLOG LOADING ── */
async function loadBlog(videoId, video) {
  const blogArea = document.getElementById('blogArea');
  if (!blogArea) return;

  blogArea.innerHTML = `
    <div class="video-blog">
      <span class="blog-tag">✦ Blog Post</span>
      <div class="blog-content">
        <div class="blog-generating">Loading article…</div>
      </div>
    </div>
  `;

  try {
    const res  = await fetch(POSTS_URL(videoId));
    if (!res.ok) throw new Error('No blog post yet');
    const post = await res.json();

    blogArea.innerHTML = `
      <div class="video-blog">
        <span class="blog-tag">✦ Blog Post</span>
        <div class="blog-content" id="blogContent"></div>
      </div>
    `;

    // Render markdown-lite: ## headings, **bold**, newlines
    document.getElementById('blogContent').innerHTML = renderMarkdown(post.content || '');

  } catch {
    // Fall back to raw description
    blogArea.innerHTML = `
      <div class="video-blog">
        <span class="blog-tag">Description</span>
        <div class="blog-content">
          <p style="white-space:pre-wrap;color:var(--text-secondary);font-size:.9rem;line-height:1.75">${esc(video.description || 'No description available.')}</p>
        </div>
      </div>
    `;
  }
}

/* Minimal markdown renderer */
function renderMarkdown(text) {
  return text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-family:var(--font-display);font-size:1rem;color:var(--text-primary);margin:.75rem 0 .4rem">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.+<\/li>\n?)+/g, m => `<ul>${m}</ul>`)
    .split('\n\n')
    .map(p => p.startsWith('<h') || p.startsWith('<ul') ? p : `<p>${p}</p>`)
    .join('\n');
}

/* ── RELATED VIDEOS ── */
async function loadRelated(currentId) {
  try {
    const res  = await fetch(`${DATA_URL}?t=${Date.now()}`);
    const data = await res.json();
    const related = (data.videos || [])
      .filter(v => v.id !== currentId)
      .slice(0, 4);

    const grid = document.getElementById('relatedGrid');
    related.forEach(v => {
      const card = document.createElement('a');
      card.className = 'card';
      card.href = `video.html?v=${v.id}`;
      const thumb = bestThumb(v);
      card.innerHTML = `
        <div class="card-thumb">
          <img src="${thumb}" alt="${esc(v.title)}" loading="lazy" />
        </div>
        <div class="card-body">
          <p class="card-title">${esc(v.title)}</p>
          <p class="card-meta">${formatDate(v.publishedAt)}</p>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch {}
}

/* ── UTILS ── */
function bestThumb(v) {
  return v.thumbnails?.maxres?.url ||
         v.thumbnails?.high?.url   ||
         v.thumbnails?.medium?.url ||
         `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

function esc(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
