/* ============================================================
   AfterOfficeLife — Playlist JS
   Used by: index.html (cards), video.html (series strip), playlist.html (detail)
   ============================================================ */

const PLAYLISTS_URL = './data/playlists.json';
const VIDEOS_URL    = './data/videos.json';

/* ── HOMEPAGE: render playlist cards ── */
async function loadPlaylists() {
  const grid    = document.getElementById('playlistGrid');
  const section = document.getElementById('playlistsSection');
  if (!grid || !section) return;

  try {
    const res  = await fetch(`${PLAYLISTS_URL}?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();
    const playlists = (data.playlists || []).filter(p => p.videoCount > 1);
    if (!playlists.length) return;

    section.style.display = 'block';
    playlists.forEach(p => {
      const card = document.createElement('a');
      card.className = 'playlist-card';
      card.href = `playlist.html?id=${p.id}`;
      card.innerHTML = `
        <div class="playlist-card-thumb">
          <img src="${p.thumbnail}" alt="${esc(p.title)}" loading="lazy" />
          <div class="playlist-count">▶ ${p.videoCount} videos</div>
        </div>
        <div class="playlist-card-body">
          <p class="playlist-card-title">${esc(p.title)}</p>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch {}
}

/* ── VIDEO PAGE: render series strip below video ── */
async function loadSeriesSection(currentVideoId, video) {
  const section = document.getElementById('seriesSection');
  if (!section || !video.playlistIds?.length) return;

  try {
    const [plRes, vidRes] = await Promise.all([
      fetch(`${PLAYLISTS_URL}?t=${Date.now()}`),
      fetch(`${VIDEOS_URL}?t=${Date.now()}`)
    ]);
    if (!plRes.ok || !vidRes.ok) return;
    const [plData, vidData] = await Promise.all([plRes.json(), vidRes.json()]);

    const allVideos = vidData.videos || [];
    const playlist  = (plData.playlists || []).find(p => video.playlistIds.includes(p.id));
    if (!playlist || playlist.videoCount < 2) return;

    const seriesVideos = playlist.videoIds
      .map(id => allVideos.find(v => v.id === id))
      .filter(Boolean);

    section.style.display = 'block';
    section.innerHTML = `
      <div class="series-header">
        <div>
          <div class="series-label">Part of a Series</div>
          <div class="series-title">${esc(playlist.title)}</div>
        </div>
        <a class="series-view-all" href="playlist.html?id=${playlist.id}">View full series →</a>
      </div>
      <div class="series-scroll" id="seriesScroll">
        ${seriesVideos.map(v => `
          <a class="series-item${v.id === currentVideoId ? ' active' : ''}" href="video.html?v=${v.id}">
            <div class="series-item-thumb">
              <img src="${v.thumbnails?.high?.url || `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`}"
                   alt="${esc(v.title)}" loading="lazy" />
            </div>
            <div class="series-item-body">
              <p class="series-item-title">${esc(v.title)}</p>
            </div>
          </a>
        `).join('')}
      </div>
    `;

    // Scroll active item into view
    const active = section.querySelector('.series-item.active');
    if (active) active.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  } catch {}
}

/* ── PLAYLIST DETAIL PAGE ── */
async function initPlaylistPage() {
  const main = document.getElementById('playlistMain');
  if (!main) return;

  const params     = new URLSearchParams(location.search);
  const playlistId = params.get('id');

  // No ?id= → show all playlists listing
  if (!playlistId) {
    await renderAllPlaylists(main);
    return;
  }

  try {
    const [plRes, vidRes] = await Promise.all([
      fetch(`${PLAYLISTS_URL}?t=${Date.now()}`),
      fetch(`${VIDEOS_URL}?t=${Date.now()}`)
    ]);
    if (!plRes.ok || !vidRes.ok) throw new Error('fetch failed');
    const [plData, vidData] = await Promise.all([plRes.json(), vidRes.json()]);

    const playlist  = (plData.playlists || []).find(p => p.id === playlistId);
    if (!playlist) {
      main.innerHTML = `<p style="color:var(--text-muted);padding:4rem 0;text-align:center;">Playlist not found. <a href="/" style="color:var(--accent)">← Back home</a></p>`;
      return;
    }

    const allVideos = vidData.videos || [];
    const videos    = playlist.videoIds.map(id => allVideos.find(v => v.id === id)).filter(Boolean);

    // Update page title/meta
    document.getElementById('pageTitle').textContent = `${playlist.title} | AfterOfficeLife`;
    document.getElementById('metaDesc').setAttribute('content', `Watch the full ${playlist.title} series on AfterOfficeLife. ${playlist.videoCount} videos.`);
    document.getElementById('ogTitle').setAttribute('content', `${playlist.title} | AfterOfficeLife`);
    document.getElementById('ogImage').setAttribute('content', playlist.thumbnail);

    renderPlaylistDetail(main, playlist, videos);
  } catch (e) {
    main.innerHTML = `<p style="color:var(--text-muted);padding:4rem 0;text-align:center;">Could not load playlist. Run <code>npm run serve</code> to test locally.</p>`;
  }
}

async function renderAllPlaylists(main) {
  try {
    const res  = await fetch(`${PLAYLISTS_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const playlists = data.playlists || [];

    document.getElementById('pageTitle').textContent = 'Playlists | AfterOfficeLife';

    main.innerHTML = `
      <div class="playlist-page-header">
        <div class="section-eyebrow">All Series</div>
        <h1 class="playlist-page-title">Series &amp; Playlists</h1>
      </div>
      <div class="playlist-grid" id="allPlaylistGrid"></div>
    `;

    const grid = document.getElementById('allPlaylistGrid');
    if (!playlists.length) {
      grid.innerHTML = `<p style="color:var(--text-muted)">No playlists yet — check back after the next sync.</p>`;
      return;
    }
    playlists.forEach(p => {
      const card = document.createElement('a');
      card.className = 'playlist-card';
      card.href = `playlist.html?id=${p.id}`;
      card.innerHTML = `
        <div class="playlist-card-thumb">
          <img src="${p.thumbnail}" alt="${esc(p.title)}" loading="lazy" />
          <div class="playlist-count">▶ ${p.videoCount} videos</div>
        </div>
        <div class="playlist-card-body">
          <p class="playlist-card-title">${esc(p.title)}</p>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch {
    main.innerHTML = `<p style="color:var(--text-muted);padding:4rem 0;text-align:center;">Could not load playlists.</p>`;
  }
}

function renderPlaylistDetail(main, playlist, videos) {
  main.innerHTML = `
    <div class="playlist-detail-hero">
      <div class="playlist-detail-thumb">
        <img src="${playlist.thumbnail}" alt="${esc(playlist.title)}" loading="eager" />
      </div>
      <div class="playlist-detail-info">
        <div class="section-eyebrow">Series</div>
        <h1 class="playlist-detail-title">${esc(playlist.title)}</h1>
        <p class="playlist-detail-meta">${playlist.videoCount} video${playlist.videoCount !== 1 ? 's' : ''}</p>
        <a class="playlist-yt-link"
           href="https://www.youtube.com/playlist?list=${playlist.id}"
           target="_blank" rel="noopener">▶ View on YouTube</a>
      </div>
    </div>
    <div class="video-grid" id="playlistVideoGrid"></div>
  `;

  const grid = document.getElementById('playlistVideoGrid');
  videos.forEach((v, i) => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `video.html?v=${v.id}`;
    const thumb = v.thumbnails?.high?.url || `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`;
    card.innerHTML = `
      <div class="card-thumb">
        <img src="${thumb}" alt="${esc(v.title)}" loading="lazy" />
        <span class="playlist-part-badge">Part ${i + 1}</span>
      </div>
      <div class="card-body">
        <p class="card-title">${esc(v.title)}</p>
        <p class="card-meta">${formatDate(v.publishedAt)}</p>
        ${v.blogGenerated ? '<span class="card-blog-badge">✦ Blog Post</span>' : ''}
      </div>
    `;
    grid.appendChild(card);
  });
}

/* ── UTILS ── */
function esc(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── BOOT ── */
if (document.getElementById('playlistMain')) {
  initPlaylistPage();
}
if (document.getElementById('playlistGrid')) {
  loadPlaylists();
}
