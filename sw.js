const VERSION='spain-trip-v4.2.0';
const APP=`${VERSION}-app`;
const RUNTIME=`${VERSION}-runtime`;
const CORE=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./itinerary.enc.json',
'./icons/icon-192.png','./icons/icon-512.png','./icons/icon-maskable-512.png','./icons/apple-touch-icon.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(APP).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![APP,RUNTIME].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);

  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(res=>{caches.open(APP).then(c=>c.put('./index.html',res.clone()));return res;}).catch(()=>caches.match('./index.html')));
    return;
  }

  if(u.origin===self.location.origin){
    e.respondWith(
      fetch(r,{cache:u.pathname.endsWith('itinerary.enc.json')?'no-store':'no-cache'})
        .then(res=>{caches.open(APP).then(c=>c.put(r,res.clone()));return res;})
        .catch(()=>caches.match(r))
    );
    return;
  }

  if(u.hostname.includes('unpkg.com')||u.hostname.includes('tiles.openfreemap.org')){
    e.respondWith(caches.open(RUNTIME).then(c=>c.match(r).then(cached=>{
      const net=fetch(r).then(res=>{if(res&&(res.ok||res.type==='opaque'))c.put(r,res.clone());return res;}).catch(()=>cached);
      return cached||net;
    })));
  }
});
