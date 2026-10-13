"""
Spotify Web Rig · Precision Engine — Backend v3.0
Motor de letras multi-fuente: LRCLIB (exacto + búsqueda) y NetEase Cloud Music.
"""
import os
import re
import time
import asyncio
import traceback
import unicodedata
from pathlib import Path
from typing import AsyncGenerator, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
import yt_dlp
import httpx

try:
    from ytmusicapi import YTMusic
    ytmusic = YTMusic()
except Exception:
    ytmusic = None

app = FastAPI(title="Spotify Web Rig", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

http_client: Optional[httpx.AsyncClient] = None

@app.on_event("startup")
async def _startup():
    global http_client
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=10.0),
        limits=httpx.Limits(max_connections=80, max_keepalive_connections=25),
        follow_redirects=True,
    )

@app.on_event("shutdown")
async def _shutdown():
    if http_client:
        await http_client.aclose()

STREAM_CACHE_TTL = 4 * 3600
_stream_cache: dict[str, tuple[float, str]] = {}
_cache_lock = asyncio.Lock()

# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------
class SearchRequest(BaseModel):
    query: str

class SearchResultItem(BaseModel):
    title: str
    artist: str
    thumbnail: str
    video_id: str
    duration: int

class SearchResponse(BaseModel):
    results: list[SearchResultItem]

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def index():
    html = Path("static/index.html").read_text(encoding="utf-8")
    return HTMLResponse(content=html)

@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0"}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse_ytm_items(raw_items: list) -> list[SearchResultItem]:
    items = []
    for entry in raw_items:
        vid = entry.get("videoId")
        if not vid:
            continue
        thumbs = entry.get("thumbnails", [])
        thumb_url = thumbs[-1]["url"] if thumbs else ""
        if thumb_url and "=w" in thumb_url:
            thumb_url = thumb_url.split("=w")[0] + "=w500-h500-l90-rj"
        elif thumb_url and "googleusercontent" in thumb_url:
            thumb_url = thumb_url + "=w500-h500-l90-rj"
        artists = entry.get("artists", [])
        artist_str = ", ".join(a["name"] for a in artists) if artists else "Varios Artistas"
        items.append(SearchResultItem(
            title=entry.get("title", "Desconocido"),
            artist=artist_str,
            thumbnail=thumb_url,
            video_id=vid,
            duration=entry.get("duration_seconds") or 0,
        ))
    return items

def _extract_stream_url(video_id: str) -> str:
    clients = ["android,web", "ios", "web_embedded", "tv"]
    cookies_path = "/root/.yt_secure/cookies.txt" if os.path.exists("/root/.yt_secure/cookies.txt") else None
    last_err = None
    for client in clients:
        opts = {
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "socket_timeout": 20,
            "extractor_args": {"youtube": [f"player_client={client}"]},
        }
        if cookies_path:
            opts["cookiefile"] = cookies_path
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(
                    f"https://music.youtube.com/watch?v={video_id}", download=False
                )
                url = info.get("url")
                if url:
                    return url
        except Exception as e:
            last_err = e
            continue
    raise last_err or RuntimeError("No se pudo extraer stream")

async def _get_stream_url(video_id: str) -> str:
    now = time.time()
    async with _cache_lock:
        cached = _stream_cache.get(video_id)
        if cached and (now - cached[0]) < STREAM_CACHE_TTL:
            return cached[1]
        expired = [k for k, (t, _) in _stream_cache.items() if now - t > STREAM_CACHE_TTL]
        for k in expired:
            _stream_cache.pop(k, None)
    loop = asyncio.get_event_loop()
    url = await loop.run_in_executor(None, _extract_stream_url, video_id)
    async with _cache_lock:
        _stream_cache[video_id] = (time.time(), url)
    return url

# ---------------------------------------------------------------------------
# Búsqueda y recomendaciones
# ---------------------------------------------------------------------------
@app.get("/api/trending", response_model=SearchResponse)
async def get_trending():
    loop = asyncio.get_event_loop()
    try:
        def fetch():
            if ytmusic:
                try:
                    return ytmusic.search("Top Hits Globales", filter="songs", limit=20)
                except Exception:
                    pass
            opts = {"quiet": True, "extract_flat": True, "noplaylist": True}
            with yt_dlp.YoutubeDL(opts) as ydl:
                res = ydl.extract_info("ytsearch20:Top Hits Globales", download=False)
            out = []
            for e in res.get("entries", []):
                if e.get("id"):
                    out.append({
                        "videoId": e["id"],
                        "title": e.get("title", ""),
                        "artists": [{"name": e.get("uploader", "")}],
                        "thumbnails": [{"url": f"https://i.ytimg.com/vi/{e['id']}/hqdefault.jpg"}],
                        "duration_seconds": e.get("duration") or 0,
                    })
            return out
        res = await loop.run_in_executor(None, fetch)
        return SearchResponse(results=_parse_ytm_items(res))
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail="No se pudo obtener recomendaciones")

@app.post("/api/search", response_model=SearchResponse)
async def search_yt(req: SearchRequest):
    q = req.query.strip()
    if not q:
        return SearchResponse(results=[])
    loop = asyncio.get_event_loop()
    try:
        def do_search():
            if ytmusic:
                try:
                    return ytmusic.search(q, filter="songs", limit=20)
                except Exception:
                    pass
            opts = {"quiet": True, "extract_flat": True, "noplaylist": True}
            with yt_dlp.YoutubeDL(opts) as ydl:
                res = ydl.extract_info(f"ytsearch15:{q}", download=False)
            out = []
            for e in res.get("entries", []):
                if e.get("id"):
                    out.append({
                        "videoId": e["id"],
                        "title": e.get("title", ""),
                        "artists": [{"name": e.get("uploader", "")}],
                        "thumbnails": [{"url": f"https://i.ytimg.com/vi/{e['id']}/hqdefault.jpg"}],
                        "duration_seconds": e.get("duration") or 0,
                    })
            return out
        res = await loop.run_in_executor(None, do_search)
        return SearchResponse(results=_parse_ytm_items(res))
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail="Error en la búsqueda")

@app.get("/api/related/{video_id}", response_model=SearchResponse)
async def get_related(video_id: str):
    """Radio: canciones relacionadas para autoplay y 'más como esto'."""
    loop = asyncio.get_event_loop()
    try:
        def fetch():
            if ytmusic:
                try:
                    res = ytmusic.get_watch_playlist(video_id, limit=20)
                    return res.get("tracks", []) if isinstance(res, dict) else res
                except Exception:
                    pass
            opts = {"quiet": True, "extract_flat": True, "noplaylist": True}
            with yt_dlp.YoutubeDL(opts) as ydl:
                res = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            return []
        res = await loop.run_in_executor(None, fetch)
        return SearchResponse(results=_parse_ytm_items(res))
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail="No se pudo obtener relacionadas")

# ---------------------------------------------------------------------------
# MOTOR DE LETRAS v3 — multi-fuente con validación estricta
# Prioridad: LRCLIB /api/get (exacto) → LRCLIB search (scoring duro)
#            → NetEase Cloud Music (cobertura masiva de LRC sincronizado)
# NUNCA devuelve letra si no pasa las compuertas de validación.
# ---------------------------------------------------------------------------

_WORD_SEP = re.compile(r"[,&/x+–—-]|feat\.?|ft\.?|featuring|with", re.I)
_VERSION_RE = re.compile(
    r"\b(remix|mix|vip|sped\s*up|slowed|edit|acoustic|acustico|acústico|live|en\s*vivo|"
    r"instrumental|version|versión|cover|karaoke|extended)\b", re.I)
_JUNK_RE = re.compile(
    r"\s*[\(\[](?:official\s*(?:music\s*)?video|video\s*oficial|audio\s*oficial|video\s*lyric|"
    r"lyric\s*video|official\s*audio|visualizer|clip\s*oficial|videoclip|video|audio|hd|4k|"
    r"music\s*video)[^\)\]]*[\)\]]", re.I)

def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()

def _base_title(title: str) -> str:
    t = _JUNK_RE.sub("", title)
    t = re.sub(r"[\(\[]?(?:feat\.?|ft\.?|featuring|with)\s+[^\)\]]+[\)\]]?", " ", t, flags=re.I)
    t = re.sub(r"[\(\[]?(?:remix|mix|version|versión|edit|sped\s*up|slowed)[^\)\]]*[\)\]]?", " ", t, flags=re.I)
    t = re.sub(r"-\s*(?:remix|mix|version|versión|edit).*$", " ", t, flags=re.I)
    return _norm(t)

def _artist_set(title: str, artist: str) -> set[str]:
    out = set()
    for chunk in (artist or "",):
        for a in _WORD_SEP.split(chunk):
            a = _norm(a)
            if len(a) > 1:
                out.add(a)
    for m in re.finditer(r"[\(\[]?(?:feat\.?|ft\.?|featuring|with)\s+([^\)\]]+)[\)\]]?", title or "", re.I):
        for a in _WORD_SEP.split(m.group(1)):
            a = _norm(a)
            if len(a) > 1:
                out.add(a)
    return out

def analyze(title: str, artist: str) -> dict:
    t = _JUNK_RE.sub("", (title or "").strip())
    a = (artist or "").strip()
    if " - " in t and not a:
        parts = t.split(" - ", 1)
        a, t = parts[0].strip(), parts[1].strip()
    return {
        "title": t,
        "base": _base_title(t),
        "artists": _artist_set(t, a),
        "special": bool(_VERSION_RE.search(t) or _VERSION_RE.search(a)),
    }

_STOPWORDS = {"la","el","los","las","de","del","lo","le","en","un","una","con","mi","tu","su",
              "the","a","an","of","to","and","i","you","it","in","on","my","your","y","o","que"}

def score_candidate(c_title: str, c_artist: str, c_duration: float, synced: bool, meta: dict, target_dur: float) -> float:
    """Scoring con compuertas duras. Devuelve -inf si la candidata es claramente otra canción."""
    score = 0.0
    ntitle, nartist = _norm(c_title), _norm(c_artist)

    if synced:
        score += 25

    # --- Compuerta 1: versión (remix vs original) ---
    cand_special = bool(_VERSION_RE.search(ntitle) or _VERSION_RE.search(nartist))
    if meta["special"]:
        if cand_special:
            score += 40
        else:
            score -= 60
    else:
        if cand_special:
            return float("-inf")
        score += 30

    # --- Compuerta 2: artista (OBLIGATORIO si lo conocemos) ---
    if meta["artists"]:
        hit = any(art in nartist or art in ntitle for art in meta["artists"])
        if hit:
            score += 45
        else:
            return float("-inf")

    # --- Compuerta 3: título base (coincidencia por palabra completa) ---
    words = [w for w in meta["base"].split() if len(w) > 2 and w not in _STOPWORDS]
    if words:
        matched = sum(1 for w in words if re.search(r"\b" + re.escape(w) + r"\b", ntitle))
        ratio = matched / len(words)
        if ratio < 0.6:
            return float("-inf")
        score += ratio * 40

    # --- Compuerta 4: duración ---
    if target_dur > 0 and c_duration and c_duration > 0:
        diff = abs(c_duration - target_dur)
        if diff <= 2:
            score += 50
        elif diff <= 5:
            score += 35
        elif diff <= 10:
            score += 15
        elif diff > 25:
            return float("-inf")

    return score

_ACCEPT_THRESHOLD = 65.0

_LRC_LINE = re.compile(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)")
_LRC_OFFSET = re.compile(r"\[offset:\s*([+-]?\d+)\s*\]", re.I)

def parse_lrc(lrc_text: str) -> tuple[list[dict], bool]:
    """Devuelve (líneas, es_sincronizado). Aplica [offset:]."""
    if not lrc_text:
        return [], False
    offset_ms = 0
    m = _LRC_OFFSET.search(lrc_text)
    if m:
        offset_ms = int(m.group(1))
    lines = []
    for raw in lrc_text.splitlines():
        line = raw.strip()
        mm = _LRC_LINE.match(line)
        if mm:
            t = int(mm.group(1)) * 60 + int(mm.group(2))
            frac = mm.group(3) or "0"
            t += float(f"0.{frac[:3].ljust(3, '0')}")
            t -= offset_ms / 1000.0
            if t < 0:
                t = 0.0
            text = mm.group(4).strip()
            lines.append({"time": round(t, 2), "text": text or "♪"})
    lines.sort(key=lambda x: x["time"])
    synced = len(lines) >= 3 and (lines[0]["time"] > 0 or any(l["time"] > 0 for l in lines))
    return lines, (synced and len(lines) >= 3)

def _plain_lines(text: str) -> list[dict]:
    return [{"time": -1, "text": l.strip()} for l in (text or "").splitlines() if l.strip()]

# ---------- Fuentes ----------

async def lrclib_exact(meta: dict, target_dur: float) -> Optional[dict]:
    """LRCLIB /api/get — match exacto contra su base de datos."""
    params = {"track_name": meta["base"] or meta["title"]}
    if meta["artists"]:
        params["artist_name"] = " ".join(sorted(meta["artists"]))
    if target_dur > 0:
        params["duration"] = str(round(target_dur))
    try:
        r = await http_client.get("https://lrclib.net/api/get", params=params)
        if r.status_code != 200:
            return None
        d = r.json()
        if not d.get("syncedLyrics") and not d.get("plainLyrics"):
            return None
        if not _passes_hard_gates(d.get("trackName",""), d.get("artistName",""), d.get("duration") or 0, meta, target_dur):
            return None
        return d
    except Exception:
        return None

def _passes_hard_gates(ct, ca, cd, meta, td) -> bool:
    return score_candidate(ct, ca, cd, True, meta, td) > float("-inf")

async def lrclib_search(meta: dict, target_dur: float) -> list[dict]:
    queries = []
    main = f"{meta['title']} {' '.join(sorted(meta['artists']))}".strip()
    queries.append(main)
    queries.append(f"{meta['base']} {' '.join(sorted(meta['artists']))}".strip())
    queries.append(meta["base"] or meta["title"])
    seen, out = set(), []
    try:
        for q in queries:
            if not q:
                continue
            r = await http_client.get("https://lrclib.net/api/search", params={"q": q})
            if r.status_code == 200:
                for item in r.json():
                    iid = item.get("id")
                    if iid not in seen:
                        seen.add(iid)
                        out.append(item)
            if len(out) >= 12:
                break
    except Exception:
        pass
    best, hi = None, float("-inf")
    for c in out:
        sc = score_candidate(c.get("trackName",""), c.get("artistName",""),
                             c.get("duration") or 0, bool(c.get("syncedLyrics")), meta, target_dur)
        if sc > hi:
            hi, best = sc, c
    if best is not None and hi >= _ACCEPT_THRESHOLD:
        return [best]
    return []

async def netease_search(meta: dict, target_dur: float) -> list[dict]:
    """NetEase Cloud Music — la mayor cobertura de LRC sincronizado que existe."""
    q = f"{meta['base'] or meta['title']} {' '.join(sorted(meta['artists'])[:2])}".strip()
    headers = {"Referer": "https://music.163.com/"}
    try:
        r = await http_client.get(
            "https://music.163.com/api/cloudsearch/get/web",
            params={"s": q, "type": 1, "limit": 15},
            headers=headers,
        )
        if r.status_code != 200:
            return []
        songs = (r.json().get("result") or {}).get("songs") or []
    except Exception:
        return []

    best, hi = None, float("-inf")
    for s in songs:
        name = s.get("name", "")
        ars = ", ".join(a.get("name", "") for a in (s.get("ar") or []))
        dur = (s.get("dt") or 0) / 1000.0
        sc = score_candidate(name, ars, dur, True, meta, target_dur)
        if sc > hi:
            hi, best = sc, (s, dur)
    if best is None or hi < _ACCEPT_THRESHOLD:
        return []

    song, _ = best
    try:
        r = await http_client.get(
            "https://music.163.com/api/song/lyric",
            params={"id": song["id"], "lv": 1, "kv": 1, "tv": -1},
            headers=headers,
        )
        if r.status_code != 200:
            return []
        d = r.json()
        lrc = (d.get("lrc") or {}).get("lyric") or ""
        if not lrc.strip():
            return []
        ars = ", ".join(a.get("name", "") for a in (song.get("ar") or []))
        return [{
            "trackName": song.get("name", ""),
            "artistName": ars,
            "duration": (song.get("dt") or 0) / 1000.0,
            "syncedLyrics": lrc,
        }]
    except Exception:
        return []

@app.get("/api/lyrics/full")
async def lyrics_full(title: str, artist: str = "", duration: int = 0):
    meta = analyze(title, artist)
    target_dur = float(duration or 0)

    candidates: list[dict] = []
    # 1) LRCLIB exacto
    exact = await lrclib_exact(meta, target_dur)
    if exact:
        candidates.append(("lrclib-exact", exact))
    # 2) LRCLIB búsqueda puntuada
    if not candidates:
        candidates += [("lrclib", c) for c in await lrclib_search(meta, target_dur)]
    # 3) NetEase
    if not candidates:
        candidates += [("netease", c) for c in await netease_search(meta, target_dur)]

    for source, c in candidates:
        lrc_text = c.get("syncedLyrics") or ""
        lines, synced = parse_lrc(lrc_text)
        if not lines and c.get("plainLyrics"):
            lines, synced = _plain_lines(c["plainLyrics"]), False
        if not lines:
            continue
        return {
            "found": True,
            "synced": synced,
            "source": source,
            "matchedTitle": c.get("trackName", ""),
            "matchedArtist": c.get("artistName", ""),
            "lines": lines,
        }

    return {"found": False, "synced": False, "source": None, "lines": []}

# ---------------------------------------------------------------------------
# Streaming / Descarga
# ---------------------------------------------------------------------------
@app.get("/api/stream/{video_id}")
async def stream_audio(video_id: str, request: Request, download: int = 0, name: str = ""):
    try:
        stream_url = await _get_stream_url(video_id)
    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail="Fallo al extraer el stream")

    range_header = request.headers.get("range")
    req_headers = {"Range": range_header} if range_header else {}

    try:
        upstream_req = http_client.build_request("GET", stream_url, headers=req_headers)
        upstream_res = await http_client.send(upstream_req, stream=True)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Error conectando con el CDN")

    response_headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": upstream_res.headers.get("content-type", "audio/webm"),
        "Cache-Control": "no-cache",
    }
    if "content-range" in upstream_res.headers:
        response_headers["Content-Range"] = upstream_res.headers["content-range"]
    if "content-length" in upstream_res.headers:
        response_headers["Content-Length"] = upstream_res.headers["content-length"]

    if download:
        safe = re.sub(r'[^\w\-. ]', '', name)[:80] or video_id
        ext = ".m4a" if "mp4" in response_headers["Content-Type"] else ".webm"
        response_headers["Content-Disposition"] = f'attachment; filename="{safe}{ext}"'

    async def generate() -> AsyncGenerator[bytes, None]:
        try:
            async for chunk in upstream_res.aiter_bytes(chunk_size=128 * 1024):
                if await request.is_disconnected():
                    break
                yield chunk
        except (httpx.HTTPError, asyncio.CancelledError):
            pass
        finally:
            await upstream_res.aclose()

    return StreamingResponse(
        generate(),
        status_code=upstream_res.status_code,
        headers=response_headers,
        media_type=response_headers["Content-Type"],
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
