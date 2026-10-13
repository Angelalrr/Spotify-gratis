import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { execFile, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import https from 'https';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Security: Block any attempts to fetch cookie files via HTTP
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p.includes('cookie') && !p.startsWith('/api/cookies')) {
    res.status(403).json({ error: 'Access forbidden' });
    return;
  }
  next();
});

const COOKIES_FILE = process.env.YT_COOKIES_FILE;
const SECURE_DIR = path.resolve(os.homedir(), '.yt_secure');
fs.mkdirSync(SECURE_DIR, { recursive: true });
const SECURE_COOKIES_PATH = path.join(SECURE_DIR, 'cookies.txt');

function getCookiesPath(): string | null {
  if (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) {
    return COOKIES_FILE;
  }
  if (fs.existsSync(SECURE_COOKIES_PATH)) {
    return SECURE_COOKIES_PATH;
  }
  const rootCookies = path.resolve(__dirname, 'cookies.txt');
  if (fs.existsSync(rootCookies)) {
    return rootCookies;
  }
  return null;
}

function getYtDlpPath(): string {
  const localBin = path.resolve(__dirname, 'bin', 'yt-dlp');
  if (fs.existsSync(localBin)) {
    try {
      fs.chmodSync(localBin, 0o755);
    } catch {}
    return localBin;
  }
  return 'yt-dlp';
}

// In-memory stream cache
const STREAM_CACHE_TTL = 4 * 3600 * 1000; // 4 hours
const streamCache = new Map<string, { url: string; time: number }>();

function extractStreamUrl(videoId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cached = streamCache.get(videoId);
    if (cached && Date.now() - cached.time < STREAM_CACHE_TTL) {
      resolve(cached.url);
      return;
    }

    const bin = getYtDlpPath();
    const args = [
      '-g',
      '-f',
      'bestaudio[ext=m4a]/bestaudio/best',
      '--no-playlist',
      '--socket-timeout',
      '20',
    ];

    const cookies = getCookiesPath();
    if (cookies) {
      args.push('--cookies', cookies);
    }

    args.push(`https://music.youtube.com/watch?v=${videoId}`);

    execFile(bin, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        // Fallback without music subdomain
        const fallbackArgs = [
          '-g',
          '-f',
          'bestaudio[ext=m4a]/bestaudio/best',
          '--no-playlist',
          '--socket-timeout',
          '20',
        ];
        if (cookies) fallbackArgs.push('--cookies', cookies);
        fallbackArgs.push(`https://www.youtube.com/watch?v=${videoId}`);

        execFile(bin, fallbackArgs, (err2, stdout2) => {
          if (err2) {
            reject(err2);
            return;
          }
          const lines = stdout2.trim().split('\n');
          const finalUrl = lines[lines.length - 1]?.trim();
          if (finalUrl) {
            streamCache.set(videoId, { url: finalUrl, time: Date.now() });
            resolve(finalUrl);
          } else {
            reject(new Error('No stream URL returned'));
          }
        });
        return;
      }

      const lines = stdout.trim().split('\n');
      const finalUrl = lines[lines.length - 1]?.trim();
      if (finalUrl) {
        streamCache.set(videoId, { url: finalUrl, time: Date.now() });
        resolve(finalUrl);
      } else {
        reject(new Error('No stream URL returned'));
      }
    });
  });
}

function parseYtDlpEntries(entries: any[]) {
  return entries
    .filter((e) => e && (e.id || e.url))
    .map((e) => {
      const vid = e.id || '';
      let thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      if (e.thumbnails && Array.isArray(e.thumbnails) && e.thumbnails.length > 0) {
        thumb = e.thumbnails[e.thumbnails.length - 1].url || thumb;
      }
      return {
        title: e.title || 'Desconocido',
        artist: e.uploader || e.channel || 'Varios Artistas',
        thumbnail: thumb,
        video_id: vid,
        duration: e.duration || 0,
      };
    });
}

// ---------------------------------------------------------------------------
// Precision Engine API Routes (Solo Música y Portadas Oficiales de Álbumes)
// ---------------------------------------------------------------------------

const MUSIC_SERVICE_PATH = path.resolve(__dirname, 'music_service.py');

// Fallback top tracks so trending NEVER returns empty under any scenario
const HARDCODED_FALLBACK_HITS = [
  {
    title: 'Monaco',
    artist: 'Bad Bunny',
    album: 'Nadie Sabe Lo Que Va A Pasar Mañana',
    thumbnail: 'https://i.ytimg.com/vi/V9PVRfjEBTI/hqdefault.jpg',
    video_id: 'V9PVRfjEBTI',
    duration: 267,
  },
  {
    title: 'Qlona',
    artist: 'Karol G, Peso Pluma',
    album: 'Mañana Será Bonito',
    thumbnail: 'https://i.ytimg.com/vi/0pQnF7wG84s/hqdefault.jpg',
    video_id: '0pQnF7wG84s',
    duration: 172,
  },
  {
    title: 'Lollipop',
    artist: 'Darell',
    album: 'Everybody Go to the Discotek',
    thumbnail: 'https://i.ytimg.com/vi/lJ_ZfI0_8wE/hqdefault.jpg',
    video_id: 'lJ_ZfI0_8wE',
    duration: 198,
  },
  {
    title: 'Perro Negro',
    artist: 'Bad Bunny, Feid',
    album: 'Nadie Sabe Lo Que Va A Pasar Mañana',
    thumbnail: 'https://i.ytimg.com/vi/f8k4Pqf0L0o/hqdefault.jpg',
    video_id: 'f8k4Pqf0L0o',
    duration: 162,
  },
  {
    title: 'Holanda',
    artist: 'Jhayco',
    album: 'Le Clique: Vida Rockstar',
    thumbnail: 'https://i.ytimg.com/vi/2N0wKxZ18u0/hqdefault.jpg',
    video_id: '2N0wKxZ18u0',
    duration: 200,
  },
  {
    title: 'Columbia',
    artist: 'Quevedo',
    album: 'Buenas Noches',
    thumbnail: 'https://i.ytimg.com/vi/nFkG3_M_a6o/hqdefault.jpg',
    video_id: 'nFkG3_M_a6o',
    duration: 194,
  },
  {
    title: 'Classy 101',
    artist: 'Feid, Young Miko',
    album: 'FERXXOCALIPSIS',
    thumbnail: 'https://i.ytimg.com/vi/bQj7Y_bIomE/hqdefault.jpg',
    video_id: 'bQj7Y_bIomE',
    duration: 195,
  },
  {
    title: 'LALA',
    artist: 'Myke Towers',
    album: 'La Vida Es Una',
    thumbnail: 'https://i.ytimg.com/vi/T1j5v1544qI/hqdefault.jpg',
    video_id: 'T1j5v1544qI',
    duration: 198,
  },
];

const trendingCache = new Map<string, { data: any[]; time: number }>();
const TRENDING_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// GET /api/trending (Éxitos de hoy por región o global con fallback garantizado)
app.get('/api/trending', (req: Request, res: Response) => {
  const country = ((req.query.country as string) || 'GLOBAL').toUpperCase();
  const cached = trendingCache.get(country);
  if (cached && Date.now() - cached.time < TRENDING_CACHE_TTL && cached.data.length > 0) {
    res.json({ results: cached.data });
    return;
  }

  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'trending', country],
    { maxBuffer: 15 * 1024 * 1024, timeout: 6000 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          if (Array.isArray(results) && results.length > 0) {
            trendingCache.set(country, { data: results, time: Date.now() });
            res.json({ results });
            return;
          }
        } catch {}
      }
      // Fallback a GLOBAL
      execFile(
        'python3',
        [MUSIC_SERVICE_PATH, 'trending', 'GLOBAL'],
        { maxBuffer: 15 * 1024 * 1024, timeout: 5000 },
        (err2, stdout2) => {
          if (!err2 && stdout2.trim()) {
            try {
              const results2 = JSON.parse(stdout2.trim());
              if (Array.isArray(results2) && results2.length > 0) {
                trendingCache.set(country, { data: results2, time: Date.now() });
                res.json({ results: results2 });
                return;
              }
            } catch {}
          }
          // Rock-solid fallback guaranteed to return results
          res.json({ results: HARDCODED_FALLBACK_HITS });
        }
      );
    }
  );
});

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#1db954"/><stop offset="100%" stop-color="#121212"/></linearGradient></defs><rect width="300" height="300" rx="16" fill="url(#g)"/><circle cx="150" cy="150" r="50" fill="#282828"/><path d="M142 125v45a16 16 0 1016-16V135h20v-10z" fill="#ffffff"/></svg>`;

// GET /api/proxy-image (Garantiza carga de imágenes oficiales evitando bloqueos de CDN o referrer)
app.get('/api/proxy-image', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl || !imageUrl.startsWith('http')) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(FALLBACK_SVG);
    return;
  }
  try {
    const upstream = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://music.youtube.com/',
      },
    });
    if (!upstream.ok) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(FALLBACK_SVG);
      return;
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(FALLBACK_SVG);
  }
});

// POST /api/recommendations (Para ti)
app.post('/api/recommendations', (req: Request, res: Response) => {
  const payload = JSON.stringify(req.body || {});

  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'personalized', payload],
    { maxBuffer: 15 * 1024 * 1024 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          if (Array.isArray(results)) {
            res.json({ results });
            return;
          }
        } catch {}
      }
      res.json({ results: [] });
    }
  );
});

// GET /api/artists
app.get('/api/artists', (_req: Request, res: Response) => {
  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'artists'],
    { maxBuffer: 10 * 1024 * 1024 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          res.json({ results });
          return;
        } catch {}
      }
      res.json({ results: [] });
    }
  );
});

// GET /api/artist/:name
app.get('/api/artist/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'artist_songs', name],
    { maxBuffer: 15 * 1024 * 1024 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          res.json({ results });
          return;
        } catch {}
      }
      res.json({ results: [] });
    }
  );
});

// GET /api/albums
app.get('/api/albums', (_req: Request, res: Response) => {
  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'albums'],
    { maxBuffer: 10 * 1024 * 1024 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          res.json({ results });
          return;
        } catch {}
      }
      res.json({ results: [] });
    }
  );
});

// GET /api/album/:id
app.get('/api/album/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const title = (req.query.title as string) || '';
  const artist = (req.query.artist as string) || '';

  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'album_tracks', id, title, artist],
    { maxBuffer: 15 * 1024 * 1024 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          res.json({ results });
          return;
        } catch {}
      }
      res.json({ results: [] });
    }
  );
});

// POST /api/search
app.post('/api/search', (req: Request, res: Response) => {
  const query = (req.body?.query || '').trim();
  if (!query) {
    res.json({ results: [] });
    return;
  }

  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'search', query],
    { maxBuffer: 15 * 1024 * 1024 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          if (Array.isArray(results)) {
            res.json({ results });
            return;
          }
        } catch {}
      }
      res.status(502).json({ detail: 'Error en la búsqueda de canciones' });
    }
  );
});

// GET /api/related/:video_id
app.get('/api/related/:video_id', (req: Request, res: Response) => {
  const { video_id } = req.params;

  execFile(
    'python3',
    [MUSIC_SERVICE_PATH, 'related', video_id],
    { maxBuffer: 15 * 1024 * 1024 },
    (err, stdout) => {
      if (!err && stdout.trim()) {
        try {
          const results = JSON.parse(stdout.trim());
          if (Array.isArray(results)) {
            res.json({ results });
            return;
          }
        } catch {}
      }
      res.json({ results: [] });
    }
  );
});

// ---------------------------------------------------------------------------
// Lyrics Engine (LRCLIB + parsing)
// ---------------------------------------------------------------------------
const LRC_LINE = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
const LRC_OFFSET = /\[offset:\s*([+-]?\d+)\s*\]/i;

function parseLrc(lrcText: string): { lines: { time: number; text: string }[]; synced: boolean } {
  if (!lrcText) return { lines: [], synced: false };
  let offsetMs = 0;
  const offsetMatch = lrcText.match(LRC_OFFSET);
  if (offsetMatch) {
    offsetMs = parseInt(offsetMatch[1], 10) || 0;
  }

  const lines: { time: number; text: string }[] = [];
  for (const raw of lrcText.split('\n')) {
    const line = raw.trim();
    const m = line.match(LRC_LINE);
    if (m) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] || '0';
      let t = min * 60 + sec + parseFloat(`0.${frac.padEnd(3, '0').slice(0, 3)}`);
      t -= offsetMs / 1000.0;
      if (t < 0) t = 0;
      const text = m[4].trim();
      lines.push({ time: Math.round(t * 100) / 100, text: text || '' });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  const synced = lines.length >= 3 && lines.some((l) => l.time > 0);
  return { lines, synced };
}

app.get('/api/lyrics/full', async (req: Request, res: Response) => {
  const title = (req.query.title as string) || '';
  const artist = (req.query.artist as string) || '';
  const duration = parseFloat((req.query.duration as string) || '0');

  try {
    // 1. Try exact match from LRCLIB
    const exactParams = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    if (duration > 0) exactParams.set('duration', String(Math.round(duration)));

    const exactResp = await fetch(`https://lrclib.net/api/get?${exactParams}`, {
      headers: { 'User-Agent': 'SpotifyWebRig/3.0' },
    });

    if (exactResp.ok) {
      const data = await exactResp.json();
      if (data.syncedLyrics) {
        const { lines, synced } = parseLrc(data.syncedLyrics);
        if (lines.length > 0) {
          res.json({
            found: true,
            synced,
            source: 'lrclib-exact',
            matchedTitle: data.trackName,
            matchedArtist: data.artistName,
            lines,
          });
          return;
        }
      }
      if (data.plainLyrics) {
        const plainLines = data.plainLyrics
          .split('\n')
          .map((l: string) => ({ time: -1, text: l.trim() }))
          .filter((l: any) => l.text.length > 0);
        res.json({
          found: true,
          synced: false,
          source: 'lrclib',
          matchedTitle: data.trackName,
          matchedArtist: data.artistName,
          lines: plainLines,
        });
        return;
      }
    }

    // 2. Try search
    const searchParams = new URLSearchParams({ q: `${title} ${artist}`.trim() });
    const searchResp = await fetch(`https://lrclib.net/api/search?${searchParams}`, {
      headers: { 'User-Agent': 'SpotifyWebRig/3.0' },
    });

    if (searchResp.ok) {
      const items = await searchResp.json();
      if (Array.isArray(items) && items.length > 0) {
        const first = items[0];
        if (first.syncedLyrics) {
          const { lines, synced } = parseLrc(first.syncedLyrics);
          if (lines.length > 0) {
            res.json({
              found: true,
              synced,
              source: 'lrclib',
              matchedTitle: first.trackName,
              matchedArtist: first.artistName,
              lines,
            });
            return;
          }
        }
        if (first.plainLyrics) {
          const plainLines = first.plainLyrics
            .split('\n')
            .map((l: string) => ({ time: -1, text: l.trim() }))
            .filter((l: any) => l.text.length > 0);
          res.json({
            found: true,
            synced: false,
            source: 'lrclib',
            matchedTitle: first.trackName,
            matchedArtist: first.artistName,
            lines: plainLines,
          });
          return;
        }
      }
    }

    res.json({ found: false, synced: false, source: null, lines: [] });
  } catch {
    res.json({ found: false, synced: false, source: null, lines: [] });
  }
});

// ---------------------------------------------------------------------------
// Stream Audio Proxy (supports HTTP 206 Range requests and downloading)
// ---------------------------------------------------------------------------
app.get('/api/stream/:video_id', async (req: Request, res: Response) => {
  const { video_id } = req.params;
  const isDownload = req.query.download === '1' || req.query.download === 'true';
  const rawName = (req.query.name as string) || video_id;
  const safeName = rawName.replace(/[^a-zA-Z0-9 \-_().]/g, '').slice(0, 80) || video_id;

  let streamUrl: string;
  try {
    streamUrl = await extractStreamUrl(video_id);
  } catch (err: any) {
    res.status(502).json({ detail: 'No se pudo obtener el stream de audio' });
    return;
  }

  const range = req.headers.range;
  const urlObj = new URL(streamUrl);
  const protocol = urlObj.protocol === 'https:' ? https : http;

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  if (range) {
    headers['Range'] = range;
  }

  const upstreamReq = protocol.get(streamUrl, { headers }, (upstreamRes) => {
    const statusCode = upstreamRes.statusCode || 200;

    res.status(statusCode);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'audio/webm');
    res.setHeader('Cache-Control', 'no-cache');

    if (upstreamRes.headers['content-range']) {
      res.setHeader('Content-Range', upstreamRes.headers['content-range']);
    }
    if (upstreamRes.headers['content-length']) {
      res.setHeader('Content-Length', upstreamRes.headers['content-length']);
    }

    if (isDownload) {
      const ext = (upstreamRes.headers['content-type'] || '').includes('mp4') ? '.m4a' : '.webm';
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}${ext}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeName)}"`);
    }

    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ detail: 'Error al conectar con el CDN de audio' });
    }
  });

  req.on('close', () => {
    upstreamReq.destroy();
  });
});

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '3.0.0' });
});

// Serve the imported Spotify Web Rig frontend at root
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.resolve(__dirname, 'static', 'index.html'));
});

// Static assets
app.use(express.static(path.resolve(__dirname, 'static')));

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Spotify Web Rig v3 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
