/* ============================================================
   AfterOfficeLife — Homepage JS
   Reads from /data/videos.json (built by GitHub Actions)
   Never calls YouTube API directly from the browser
   ============================================================ */

const CHANNEL_ID = 'UCnETBO00VhhaI8xv1ZZO2qA';
const DATA_URL   = './data/videos.json';
const PER_PAGE   = 12;

let allVideos  = [];
let filtered   = [];
let pageOffset = 0;

/* ── BOOT ── */
async function init() {
  try {
    const res  = await fetch(`${DATA_URL}?t=${Date.now()}`);
    const data = await res.json();
    allVideos  = data.videos || [];
    document.getElementById('statVideos').textContent = allVideos.length;
    renderSpotlight(allVideos[0]);
    applyFilter('all');
  } catch (e) {
    document.getElementById('videoGrid').innerHTML =
      `<p style="color:var(--text-muted);padding:2rem 0;">Could not load videos. Check back soon.</p>`;
    console.error('Failed to load videos.json', e);
  }
}

/* ── SPOTLIGHT ── */
function renderSpotlight(v) {
  if (!v) return;
  const thumb = bestThumb(v);
  const el = document.getElementById('spotlightCard');
  el.innerHTML = `
    <a class="spotlight-thumb" href="video.html?v=${v.id}" title="${esc(v.title)}">
      <img src="${thumb}" alt="${esc(v.title)}" loading="eager" />
      <div class="spotlight-play"><div class="play-btn">▶</div></div>
    </a>
    <div class="spotlight-info">
      <span class="spotlight-badge">Latest Video</span>
      <h2 class="spotlight-title">${esc(v.title)}</h2>
      <p class="spotlight-meta">${formatDate(v.publishedAt)}</p>
      <p class="spotlight-desc">${esc(v.description?.slice(0, 220) || '')}…</p>
      <a class="spotlight-cta" href="video.html?v=${v.id}">Watch & Read More →</a>
    </div>
  `;
}

/* ── FILTER ── */
function applyFilter(f) {
  if (f === 'all') {
    filtered = [...allVideos];
  } else {
    filtered = allVideos.filter(v =>
      v.title.toLowerCase().includes(f) ||
      (v.tags || []).some(t => t.toLowerCase().includes(f))
    );
  }
  pageOffset = 0;
  document.getElementById('videoGrid').innerHTML = '';
  renderPage();
}

function renderPage() {
  const slice = filtered.slice(pageOffset, pageOffset + PER_PAGE);
  const grid  = document.getElementById('videoGrid');
  const btn   = document.getElementById('loadMoreBtn');

  // Remove skeletons on first render
  grid.querySelectorAll('.skeleton').forEach(s => s.remove());

  slice.forEach(v => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `video.html?v=${v.id}`;
    card.setAttribute('aria-label', v.title);
    const thumb = bestThumb(v);
    const hasBlog = !!v.blogGenerated;
    card.innerHTML = `
      <div class="card-thumb">
        <img src="${thumb}" alt="${esc(v.title)}" loading="lazy" />
      </div>
      <div class="card-body">
        <p class="card-title">${esc(v.title)}</p>
        <p class="card-meta">${formatDate(v.publishedAt)}</p>
        ${hasBlog ? `<span class="card-blog-badge">✦ Blog Post</span>` : ''}
      </div>
    `;
    grid.appendChild(card);
  });

  pageOffset += slice.length;
  btn.style.display = pageOffset < filtered.length ? 'inline-block' : 'none';
}

/* ── FILTER BUTTONS ── */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilter(btn.dataset.filter);
  });
});

document.getElementById('loadMoreBtn').addEventListener('click', renderPage);

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
