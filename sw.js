// Service Worker：電波のない場所でもアプリが開けるように、ファイルと地図を保存しておく。
const CORE = 'core-v5';
const TILES = 'tiles-v1';
const DATA = 'data-v1';
const CORE_FILES = [
  './', './index.html', './styles.css', './app.js', './db.js', './checklists.js', './training.js', './guides.js', './manifest.webmanifest',
  './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const TILE_HOSTS = ['cyberjapandata.gsi.go.jp', 'tile.openstreetmap.org'];
const DATA_HOSTS = ['api.open-meteo.com', 'nominatim.openstreetmap.org'];
const MAX_TILES = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CORE).then(c => c.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  const keep = [CORE, TILES, DATA];
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // アプリ本体：保存済みのものをすぐ返し、裏で新しい版を取りに行く
    e.respondWith(caches.open(CORE).then(async cache => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || new Response('オフラインです', { status: 503 });
    }));
    return;
  }

  if (TILE_HOSTS.includes(url.hostname)) {
    // 地図タイル：一度表示した場所はオフラインでも見られる
    e.respondWith(caches.open(TILES).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) { await cache.put(req, res.clone()); trim(cache); }
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }

  if (DATA_HOSTS.includes(url.hostname)) {
    // 天気など：通信できればその結果、できなければ前回の結果
    e.respondWith(caches.open(DATA).then(async cache => {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    }));
  }
});

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  } finally { trimming = false; }
}
