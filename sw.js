const CACHE='touch-wall-c41af1322f17',ASSETS=["./", "./index.html", "./style.css", "./host.js", "./app.js", "./icon.svg", "./manifest.webmanifest", "./effects/fable.js", "./effects/liquid.js", "./effects/haiku.js", "./effects/synth-depth.js"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('touch-wall-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&new URL(e.request.url).origin===self.location.origin)e.respondWith(caches.open(CACHE).then(c=>c.match(e.request)).then(r=>r||fetch(e.request)));});
