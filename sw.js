// 운동 레포트 서비스워커
// 내 파일: 항상 네트워크 먼저(업데이트 바로 반영), 안 되면 저장본
// 외부 라이브러리/폰트: 저장본 먼저
// Firestore, Apps Script, 로그인, POST 요청은 건드리지 않음
const CACHE = 'wr-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'fb.js', 'config.js', 'manifest.json', 'icons/icon-192.png'];
const CDN = ['www.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/__/')) return; // Firebase 로그인 경로
    e.respondWith(
      (req.mode === 'navigate' ? fetch(req) : fetch(req.url, { cache: 'no-cache' }))
        .then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
          .then(r => r || Response.error()))
    );
    return;
  }

  if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
