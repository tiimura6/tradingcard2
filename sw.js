/* カードのイラスト画像だけを端末に保存する（一度見た画像は通信なしで表示）
   アプリ本体（index.html・データ）はここでは扱わない（いつも最新を読み込むため） */
const CACHE = 'card-img-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !/\/tradingcard-img[^/]*\/(A1|A2|B1|B2|PT)\/.+\.webp$/.test(url.pathname)) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res && res.ok) c.put(e.request, res.clone());
    return res;
  }));
});
