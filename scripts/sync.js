#!/usr/bin/env node
/**
 * AfterOfficeLife — Video Sync & Blog Generator
 *
 * HOW IT WORKS:
 * 1. Fetches all videos from YouTube's FREE public RSS feed (no API key needed)
 * 2. Loads existing data/videos.json
 * 3. For any NEW video not yet in the file → calls Gemini ONCE to generate a blog post
 * 4. Saves blog post to posts/{videoId}.json  (NEVER regenerated after first save)
 * 5. Updates data/videos.json with the new video list
 *
 * Run manually:   node scripts/sync.js
 * Run in CI:      GitHub Actions workflow calls this automatically
 *
 * Required environment variables (set in GitHub Secrets):
 *   GEMINI_API_KEY  — Google Gemini API key (free tier via aistudio.google.com)
 *
 * NO YouTube API key needed — uses the public RSS feed instead.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── CONFIG ───────────────────────────────────────────────────────────────────
const CHANNEL_ID  = 'UCnETBO00VhhaI8xv1ZZO2qA';
const RSS_URL     = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const DATA_DIR    = path.join(__dirname, '..', 'data');
const POSTS_DIR   = path.join(__dirname, '..', 'posts');
const VIDEOS_FILE    = path.join(DATA_DIR, 'videos.json');
const PLAYLISTS_FILE = path.join(DATA_DIR, 'playlists.json');
const GEMINI_KEY     = process.env.GEMINI_API_KEY;

// Ensure directories exist
[DATA_DIR, POSTS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🎮 AfterOfficeLife sync starting…');

  if (!GEMINI_KEY) console.warn('⚠️  GEMINI_API_KEY not set — blog posts will be skipped');

  // Load existing videos
  let existing = { videos: [], lastUpdated: null };
  if (fs.existsSync(VIDEOS_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(VIDEOS_FILE, 'utf8')); } catch {}
  }
  const existingIds = new Set((existing.videos || []).map(v => v.id));

  // Fetch latest from RSS (no API key, completely free)
  console.log('📡 Fetching videos from YouTube RSS feed…');
  const fetched = await fetchFromRSS();
  console.log(`   Found ${fetched.length} videos`);

  // Identify new videos
  const newVideos = fetched.filter(v => !existingIds.has(v.id));
  console.log(`   ${newVideos.length} new video(s) to process`);

  // Generate blog posts for new videos (Gemini called ONCE per video, result saved forever)
  if (GEMINI_KEY && newVideos.length > 0) {
    for (const v of newVideos) {
      const postFile = path.join(POSTS_DIR, `${v.id}.json`);
      if (fs.existsSync(postFile)) {
        console.log(`   ✓ Blog already exists for: ${v.title.slice(0, 50)}`);
        v.blogGenerated = true;
        continue;
      }
      console.log(`   🤖 Generating blog for: ${v.title.slice(0, 50)}…`);
      try {
        const blog = await generateBlog(v);
        fs.writeFileSync(postFile, JSON.stringify({
          videoId:     v.id,
          generatedAt: new Date().toISOString(),
          content:     blog
        }, null, 2));
        v.blogGenerated = true;
        console.log(`   ✅ Saved posts/${v.id}.json`);
        await sleep(2000); // brief pause to respect Gemini rate limits
      } catch (e) {
        console.warn(`   ⚠️  Blog generation failed for ${v.id}: ${e.message}`);
      }
    }
  }

  // Merge: RSS videos (with existing metadata merged in) + old videos not in current RSS
  const existingMap = new Map((existing.videos || []).map(v => [v.id, v]));
  const fetchedIds  = new Set(fetched.map(v => v.id));

  const updatedFetched = fetched.map(v => {
    const prev     = existingMap.get(v.id) || {};
    const postFile = path.join(POSTS_DIR, `${v.id}.json`);
    return { ...prev, ...v, blogGenerated: fs.existsSync(postFile) };
  });

  const keptOld = (existing.videos || [])
    .filter(v => !fetchedIds.has(v.id) && !isShort(v))
    .map(v => {
      const postFile = path.join(POSTS_DIR, `${v.id}.json`);
      return { ...v, blogGenerated: fs.existsSync(postFile) };
    });

  const merged = [...updatedFetched, ...keptOld];

  // Build playlists from video descriptions (also tags each video with playlistIds)
  const playlistData = buildPlaylists(merged);

  // Save updated videos.json
  const output = {
    channelId:   CHANNEL_ID,
    lastUpdated: new Date().toISOString(),
    videos:      merged
  };
  fs.writeFileSync(VIDEOS_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved data/videos.json (${merged.length} videos)`);

  fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlistData, null, 2));
  console.log(`✅ Saved data/playlists.json (${playlistData.playlists.length} playlists)`);

  // Generate sitemap
  generateSitemap(merged);
  console.log('✅ Generated sitemap.xml');
}

// ── RSS FETCH & PARSE ────────────────────────────────────────────────────────
// YouTube's RSS feed returns the 15 most recent videos.
// We merge with the existing JSON so older videos are preserved.
function fetchFromRSS() {
  return new Promise((resolve, reject) => {
    https.get(RSS_URL, { headers: { 'User-Agent': 'AfterOfficeLife-Bot/1.0' } }, res => {
      let xml = '';
      res.on('data', chunk => xml += chunk);
      res.on('end', () => {
        try { resolve(parseRSS(xml)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function parseRSS(xml) {
  const videos = [];

  // Split into <entry> blocks
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

  for (const entry of entries) {
    const videoId   = tag(entry, 'yt:videoId');
    const title     = decodeXML(tag(entry, 'title'));
    const published = tag(entry, 'published');
    const updated   = tag(entry, 'updated');
    const desc      = decodeXML(tag(entry, 'media:description') || tag(entry, 'summary') || '');

    // Thumbnail: YouTube provides several sizes via media:thumbnail
    // We construct them from the video ID for maximum resolution
    const thumbnails = {
      maxres: { url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` },
      high:   { url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` },
      medium: { url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` },
      default:{ url: `https://img.youtube.com/vi/${videoId}/default.jpg` }
    };

    if (!videoId || !title) continue;

    videos.push({
      id:          videoId,
      title,
      description: desc,
      publishedAt: published || updated,
      thumbnails,
      tags:        [],               // RSS doesn't include tags
      game:        extractGame(title, desc)
    });
  }

  return videos.filter(v => !isShort(v));
}

// Detect YouTube Shorts:
// 1. Explicit #shorts/#short hashtag, OR
// 2. No timestamp pattern in description AND description is brief (< 400 chars)
function isShort(video) {
  const combined = (video.title + ' ' + (video.description || '')).toLowerCase();
  if (/#shorts?\b/.test(combined)) return true;
  const hasTimestamps = /\d{1,2}:\d{2}/.test(video.description || '');
  if (!hasTimestamps && (video.description || '').length < 400) return true;
  return false;
}

// Pull a single XML tag's inner text (handles self-closing too)
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1].trim() : '';
}

// Decode common XML entities
function decodeXML(str) {
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function extractGame(title, desc) {
  const patterns = [
    /playing\s+(.+?)(?:\s*[-|#]|$)/i,
    /^(.+?)\s*(?:gameplay|playthrough|episode|ep\s*\d)/i,
    /^(.+?)\s*[-|]\s*afterofficelife/i
  ];
  const haystack = title + ' ' + (desc || '').split('\n')[0];
  for (const re of patterns) {
    const m = haystack.match(re);
    if (m && m[1].length < 60) return m[1].trim();
  }
  return null;
}

// ── GEMINI BLOG GENERATION ───────────────────────────────────────────────────
async function generateBlog(video) {
  const chapters = parseChapters(video.description);
  const chapterText = chapters.length
    ? `\n\nChapters in this video:\n${chapters.map(c => `- ${c.time}: ${c.name}`).join('\n')}`
    : '';

  const prompt = `You are writing a gaming blog post for "AfterOfficeLife", a YouTube channel run by a Pakistani software engineer who games after work.

Video title: "${video.title}"
Game being played: ${video.game || 'See description'}
Published: ${video.publishedAt?.slice(0, 10)}
Description: """${video.description?.slice(0, 1500)}"""${chapterText}

Write a compelling, SEO-optimized blog post about this video. Structure it as follows:

## About This Video
A 2-3 sentence overview of what the viewer can expect from this video.

## The Game
A paragraph about the game being played — its genre, setting, story premise, and why it's interesting. Include relevant gaming context like platform (PS5/PS4) and game genre.

## What Happens in This Episode
Walk through the key moments covered in this video, especially if there are chapters. Describe the gameplay sections, story beats, or highlights.

## Why Watch This?
2-3 reasons why someone should watch this specific video. Mention the gaming perspective, community angle, or unique value.

## About AfterOfficeLife
One sentence mentioning this is a gaming channel for IT professionals, office workers, and Pakistani gamers who unwind with games after work.

Keep the tone conversational and enthusiastic. Optimize naturally for search terms like [game name] gameplay Pakistan, PS5 gaming, [game name] walkthrough. Do not use overly promotional language. Write approximately 400-600 words.`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024
    }
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) reject(new Error('Empty Gemini response: ' + data.slice(0, 300)));
          else resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── PLAYLISTS ────────────────────────────────────────────────────────────────
function extractPlaylistIds(text) {
  const re = /[?&]list=(PL[A-Za-z0-9_-]+)/g;
  const ids = new Set();
  let m;
  while ((m = re.exec(text)) !== null) ids.add(m[1]);
  return [...ids];
}

function derivePlaylistTitle(videos) {
  if (!videos.length) return 'Playlist';
  const game = videos.find(v => v.game)?.game;
  if (game) return game;
  const titles = videos.map(v => v.title);

  let prefix = titles[0];
  for (const t of titles.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < t.length && prefix[i] === t[i]) i++;
    prefix = prefix.slice(0, i);
  }
  prefix = prefix.replace(/[\s\-–—|:,]+$/, '').trim();

  // Single video or no useful common prefix → use text before first separator
  if (titles.length === 1 || prefix.length < 4) {
    prefix = titles[0].split(/[\-–—|]/)[0].trim();
  }
  return prefix || 'Playlist';
}

function buildPlaylists(videos) {
  const playlistMap = new Map(); // playlistId -> [videoId, ...]
  for (const video of videos) {
    for (const pid of extractPlaylistIds(video.description || '')) {
      if (!playlistMap.has(pid)) playlistMap.set(pid, []);
      if (!playlistMap.get(pid).includes(video.id)) playlistMap.get(pid).push(video.id);
    }
  }

  // Tag each video with its playlist IDs
  for (const video of videos) {
    video.playlistIds = [...playlistMap.entries()]
      .filter(([, ids]) => ids.includes(video.id))
      .map(([pid]) => pid);
  }

  const playlists = [];
  for (const [pid, videoIds] of playlistMap) {
    const pvids = videoIds
      .map(id => videos.find(v => v.id === id))
      .filter(Boolean)
      .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));

    playlists.push({
      id:         pid,
      title:      derivePlaylistTitle(pvids),
      thumbnail:  pvids[0]?.thumbnails?.high?.url || `https://img.youtube.com/vi/${pvids[0]?.id}/hqdefault.jpg`,
      videoIds:   pvids.map(v => v.id),
      videoCount: pvids.length
    });
  }

  return { lastUpdated: new Date().toISOString(), playlists };
}

// ── SITEMAP ──────────────────────────────────────────────────────────────────
function generateSitemap(videos) {
  const BASE = 'https://usmanmukhtar.github.io';
  const urls = [
    `<url><loc>${BASE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...videos.map(v =>
      `<url><loc>${BASE}/video.html?v=${v.id}</loc><lastmod>${v.publishedAt?.slice(0,10)}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`
    )
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(__dirname, '..', 'sitemap.xml'), xml);
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function parseChapters(desc = '') {
  const re = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)/;
  return desc.split('\n')
    .map(l => { const m = l.match(re); return m ? { time: m[1], name: m[2].trim() } : null; })
    .filter(Boolean);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error(e); process.exit(1); });
