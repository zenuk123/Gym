// Web Push reminders (README §5), loaded into the Workbox service worker via importScripts.
// The push Edge Function sends { title, body, url, tag }; url is relative to the app.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Fitness OS', body: event.data ? event.data.text() : '' };
  }
  const scope = self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(data.title || 'Fitness OS', {
      body: data.body || '',
      tag: data.tag || 'fitness-os',
      icon: scope + 'icons/icon-192.png',
      badge: scope + 'icons/icon-192.png',
      data: { url: new URL(String(data.url || '/').replace(/^\//, ''), scope).href },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.registration.scope));
      if (win) return win.focus().then((w) => (w && 'navigate' in w ? w.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
