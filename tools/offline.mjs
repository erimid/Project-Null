/**
 * Offline play: a Vite plugin that writes sw.js, a service worker that keeps
 * every file of the built game in the browser's cache, so the game opens and
 * plays with no connection once it has been opened once (or installed).
 *
 * Only the game's own files are kept, and only from its own address: the
 * worker never touches a request to anywhere else.
 */
import { readdirSync } from 'node:fs';

/** The worker itself. `files` are paths relative to the game's folder. */
export function workerSource(files, version) {
  return `// Made by tools/offline.mjs when the game is built.
const CACHE = 'project-null-${version}';
const FILES = ${JSON.stringify(['./', ...files])};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('project-null-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // The page itself: fresh when online, so an update arrives; the kept copy when not.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./', { cacheName: CACHE, ignoreVary: true }).then((kept) => kept ?? Response.error())),
    );
    return;
  }
  // Everything else is named by its contents, so a kept copy is always right. The server's Vary
  // header would keep a module script (sent with an Origin) from matching its kept copy, so it is ignored.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((kept) => kept ?? fetch(request)));
});
`;
}

/** A short hash of the list of files, which changes whenever any file does (their names carry hashes). */
function hashOf(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** The Vite plugin: lists the built files and the public folder's, and writes sw.js beside them. */
export function offline() {
  return {
    name: 'project-null-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => file !== 'index.html' && !file.endsWith('.map'));
      const shared = readdirSync('public').filter((file) => !file.startsWith('.'));
      const files = [...new Set([...built, ...shared])].sort();
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: workerSource(files, hashOf(files.join('\n'))) });
    },
  };
}
