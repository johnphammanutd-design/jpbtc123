/* Service worker: nhận Web Push + mở đúng thẻ khi bấm thông báo.
   Không cache app (SPA 1 file, luôn cần bản mới) — chỉ phục vụ push. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Bảng công việc', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,          // gộp thông báo trùng thẻ
    data: { url: d.url || '/' },
    lang: 'vi',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        await c.focus();
        c.navigate ? c.navigate(url) : c.postMessage({ type: 'open', url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
