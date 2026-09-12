'use strict';

const APP_VERSION = '4.5.0';
const STORE = {
  completed:'spainTrip.completed.v4',
  lastDay:'spainTrip.lastDay.v4',
  lastStop:'spainTrip.lastStop.v4',
  rememberedKey:'spainTrip.rememberedKey.v4',
  reservationEdits:'spainTrip.reservationEdits.v4',
  weather:'spainTrip.weather.v4'
};

let TRIP = null;
let encryptedPayload = null;
let currentDayIndex = 0;
let currentStopIndex = 0;
let map = null;
let routeLayer = null;
let markers = [];
let userMarker = null;
let mapLoaded = false;
let userLocation = null;
let completed = new Set(JSON.parse(localStorage.getItem(STORE.completed) || '[]'));
let reservationEdits = JSON.parse(localStorage.getItem(STORE.reservationEdits) || '{}');

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function b64ToBytes(s){ return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function bytesToB64(bytes){ return btoa(String.fromCharCode(...new Uint8Array(bytes))); }

async function fetchEncrypted(){
  const res = await fetch('./itinerary.enc.json', {cache:'no-store'});
  if(!res.ok) throw new Error('Encrypted itinerary not found');
  encryptedPayload = await res.json();
}

async function deriveKey(password){
  const raw = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:b64ToBytes(encryptedPayload.salt), iterations:encryptedPayload.iterations, hash:'SHA-256'},
    baseKey,
    {name:'AES-GCM', length:256},
    true,
    ['decrypt']
  );
}

async function decryptWithKey(key){
  const plain = await crypto.subtle.decrypt(
    {name:'AES-GCM', iv:b64ToBytes(encryptedPayload.iv), additionalData:new TextEncoder().encode(encryptedPayload.aad || '')},
    key,
    b64ToBytes(encryptedPayload.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function tryRememberedKey(){
  const saved = localStorage.getItem(STORE.rememberedKey);
  if(!saved) return false;
  try{
    const raw = b64ToBytes(saved);
    const key = await crypto.subtle.importKey('raw', raw, {name:'AES-GCM'}, false, ['decrypt']);
    TRIP = await decryptWithKey(key);
    return true;
  }catch(e){
    localStorage.removeItem(STORE.rememberedKey);
    return false;
  }
}

async function unlock(){
  const pw = $('#passwordInput').value;
  if(!pw) return showUnlockError('암호를 입력해 주세요.');
  $('#unlockBtn').disabled = true;
  $('#unlockBtn').textContent = '확인 중…';
  try{
    const key = await deriveKey(pw);
    TRIP = await decryptWithKey(key);
    if($('#rememberDevice').checked){
      const raw = await crypto.subtle.exportKey('raw', key);
      localStorage.setItem(STORE.rememberedKey, bytesToB64(raw));
    }
    startApp();
  }catch(e){
    showUnlockError('암호가 맞지 않거나 암호화 파일을 읽을 수 없습니다.');
  }finally{
    $('#unlockBtn').disabled = false;
    $('#unlockBtn').textContent = '일정 열기';
  }
}

function showUnlockError(msg){ $('#unlockError').textContent = msg; }

function startApp(){
  $('#lockScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  chooseInitialDay();
  renderTabs();
  renderDay();
  updateNetwork();
  requestAnimationFrame(() => initMap());
  loadWeather(false);
}

function chooseInitialDay(){
  const savedDay = Number(localStorage.getItem(STORE.lastDay));
  if(Number.isInteger(savedDay) && savedDay >= 0 && savedDay < TRIP.days.length){
    currentDayIndex = savedDay;
  }else{
    const now = new Date();
    const md = `${now.getMonth()+1}/${now.getDate()}`;
    const idx = TRIP.days.findIndex(d => d.date === md);
    currentDayIndex = idx >= 0 ? idx : 0;
  }
  const savedStop = Number(localStorage.getItem(STORE.lastStop));
  currentStopIndex = Number.isInteger(savedStop) ? Math.max(0, savedStop) : 0;
  currentStopIndex = Math.min(currentStopIndex, TRIP.days[currentDayIndex].items.length-1);
}

function dayColor(day){
  return day.city === 'Madrid' ? '#c63b3b' : day.city === 'Barcelona' ? '#226fc4' : '#7a4cc2';
}
function cityForDay(day){
  if(day.city === 'Transfer') return day.date === '9/21' ? 'Madrid' : 'Barcelona';
  return day.city;
}
function dayISO(day){
  const [m,d] = day.date.split('/');
  return `2026-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}
function toQueryPlace(item){ return encodeURIComponent(item.address || item.note || item.name); }

function revealHorizontal(scroller, child){
  if(!scroller || !child) return;
  const childLeft = child.offsetLeft;
  const childRight = childLeft + child.offsetWidth;
  const visibleLeft = scroller.scrollLeft + 8;
  const visibleRight = scroller.scrollLeft + scroller.clientWidth - 16;

  if(childLeft < visibleLeft){
    scroller.scrollTo({left:Math.max(0, childLeft - 14), behavior:'smooth'});
  }else if(childRight > visibleRight){
    scroller.scrollTo({left:Math.max(0, childRight - scroller.clientWidth + 24), behavior:'smooth'});
  }
}

function renderTabs(){
  const wrap = $('#dateTabs');
  const scroller = wrap.parentElement;
  wrap.innerHTML = '';
  TRIP.days.forEach((d,i) => {
    const btn = document.createElement('button');
    btn.className = `date-tab ${i===currentDayIndex?'active':''}`;
    if(i===currentDayIndex) btn.style.background = dayColor(d);
    btn.innerHTML = `<strong>${d.date}</strong><span>${d.city==='Madrid'?'MAD':d.city==='Barcelona'?'BCN':'MOVE'}</span>`;
    btn.onclick = () => {
      if(i === currentDayIndex) return;
      clearMapVisuals();
      currentDayIndex = i;
      currentStopIndex = 0;
      saveSelection();
      renderTabs();
      renderDay();
      rebuildMap();
    };
    wrap.appendChild(btn);
  });
  requestAnimationFrame(()=>revealHorizontal(scroller, wrap.children[currentDayIndex]));
}

function renderDay(){
  const day = TRIP.days[currentDayIndex];
  const item = day.items[currentStopIndex];
  $('#todayLabel').textContent = `${day.date} · ${day.city.toUpperCase()}`;
  $('#dayTitle').textContent = day.title.replace(/^.*?·\s*/,'');
  $('#routeCount').textContent = `${day.items.length} STOPS`;
  const doneCount = day.items.filter(x => completed.has(x.id)).length;
  $('#completionCount').textContent = `${doneCount} 완료`;
  renderStepRail();
  renderPlace();
  renderWeatherPillFromCache();
}

function renderStepRail(){
  const day = TRIP.days[currentDayIndex];
  const rail = $('#stepRail');
  const scroller = rail.parentElement;
  rail.innerHTML = '';
  day.items.forEach((it,i)=>{
    const b = document.createElement('button');
    b.className = `step-btn ${i===currentStopIndex?'active':''} ${completed.has(it.id)?'done':''}`;
    if(i===currentStopIndex && !completed.has(it.id)) b.style.background = dayColor(day);
    b.textContent = String(i+1).padStart(2,'0');
    b.onclick = () => selectStop(i, true);
    rail.appendChild(b);
  });
  requestAnimationFrame(()=>revealHorizontal(scroller, rail.children[currentStopIndex]));
}

function reservationFor(item){
  const day = TRIP.days[currentDayIndex];
  const r = TRIP.reservations.find(r => r.date===day.date && (item.name.includes(r.name) || r.name.includes(item.name) || (r.id==='iryo' && item.name.includes('이리요'))));
  if(!r) return null;
  return {...r, time: reservationEdits[r.id] || r.time};
}

function renderPlace(){
  const day = TRIP.days[currentDayIndex];
  const item = day.items[currentStopIndex];
  $('#placeTime').textContent = item.time;
  $('#placeNumber').textContent = String(currentStopIndex+1).padStart(2,'0');
  $('#placeName').textContent = item.name;
  $('#placeNote').textContent =
    (item.note || '') +
    (item.mapVisible===false ? ' · 정확한 장소 미정이라 지도 마커는 표시하지 않음' : '');
  $('#movementText').textContent = item.transport || '이동 메모 없음';

  const done = completed.has(item.id);
  $('#completeBtn').classList.toggle('done', done);
  $('#completeBtn').textContent = done ? '✓ 완료됨' : '✓ 완료';

  const r = reservationFor(item);
  const box = $('#reservationBox');
  if(r){
    box.classList.remove('hidden');
    box.innerHTML = `<strong>${r.type} · ${r.time}</strong><br>${r.source} · ${r.note}<br><button class="soft-btn" id="editReservationBtn" style="margin-top:6px">시간 수정</button>`;
    $('#editReservationBtn').onclick = () => editReservation(r);
  }else{
    box.classList.add('hidden'); box.innerHTML='';
  }

  $('#toNextBtn').disabled = currentStopIndex >= day.items.length-1;
  renderNearbyButtons();
  updateMarkers();
  saveSelection();
}

function selectStop(i, centerMap=false){
  currentStopIndex = i;
  renderDay();
  if(centerMap) centerSelected();
}

function saveSelection(){
  localStorage.setItem(STORE.lastDay, currentDayIndex);
  localStorage.setItem(STORE.lastStop, currentStopIndex);
}

function toggleCompleted(){
  const item = TRIP.days[currentDayIndex].items[currentStopIndex];
  if(completed.has(item.id)) completed.delete(item.id); else completed.add(item.id);
  localStorage.setItem(STORE.completed, JSON.stringify([...completed]));
  renderDay();
}

function editReservation(r){
  const val = prompt(`${r.name} 예약/탑승 시간을 입력하세요.`, r.time);
  if(!val) return;
  reservationEdits[r.id] = val.trim();
  localStorage.setItem(STORE.reservationEdits, JSON.stringify(reservationEdits));
  renderPlace(); toast('예약 시간이 이 iPhone에 저장되었습니다.');
}

function initMap(){
  if(typeof L === 'undefined'){
    $('#offlineMap').classList.remove('hidden');
    return;
  }

  map = L.map('map',{
    zoomControl:false,
    attributionControl:true,
    preferCanvas:true,
    zoomAnimation:false,
    fadeAnimation:false,
    markerZoomAnimation:false
  });

  // Performance-first, keyless raster map.
  // Browser HTTP cache is used normally; the Service Worker does NOT cache every tile.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    minZoom:2,
    attribution:'&copy; OpenStreetMap contributors',
    updateWhenIdle:true,
    updateWhenZooming:false,
    keepBuffer:1,
    detectRetina:false,
    crossOrigin:true
  }).addTo(map);

  L.control.zoom({position:'bottomleft'}).addTo(map);
  mapLoaded = true;
  rebuildMap();

  requestAnimationFrame(()=>map.invalidateSize(false));
  setTimeout(()=>map.invalidateSize(false),180);
}

function markerIcon(num, color, selected, done){
  return L.divIcon({
    className:'',
    html:`<div class="route-pin ${selected?'selected':''} ${done?'done':''}" style="background:${color}">${num}</div>`,
    iconSize:selected?[43,43]:[34,34],
    iconAnchor:selected?[21,21]:[17,17]
  });
}

function clearMapVisuals(){
  markers.forEach(entry=>{
    try{
      const marker = entry && entry.marker ? entry.marker : entry;
      marker.remove();
    }catch(e){}
  });
  markers=[];

  if(routeLayer){
    try{ routeLayer.remove(); }catch(e){}
    routeLayer=null;
  }
}

function rebuildMap(){
  if(!map || !mapLoaded) return;

  clearMapVisuals();

  const day=TRIP.days[currentDayIndex];
  const color=dayColor(day);
  const pts=day.items.filter(x=>x.mapVisible!==false&&Number.isFinite(x.lat)&&Number.isFinite(x.lng));

  if(pts.length){
    routeLayer=L.polyline(
      pts.map(x=>[x.lat,x.lng]),
      {color,weight:4,opacity:.72,dashArray:'7 8',lineCap:'round',lineJoin:'round',interactive:false}
    ).addTo(map);
  }

  day.items.forEach((it,i)=>{
    if(it.mapVisible===false) return;
    if(!Number.isFinite(it.lat)||!Number.isFinite(it.lng)) return;

    const marker=L.marker(
      [it.lat,it.lng],
      {icon:markerIcon(i+1,color,i===currentStopIndex,completed.has(it.id)),keyboard:false,riseOnHover:false}
    ).addTo(map);

    // Korean itinerary name is available directly on our marker even if the raster basemap
    // itself uses local-language labels.
    marker.bindTooltip(it.name,{
      direction:'top',
      offset:[0,-17],
      opacity:.94,
      className:'trip-tooltip'
    });

    marker.on('click',()=>selectStop(i,false));
    markers.push({marker,itemIndex:i});
  });

  fitRoute();
}

function updateMarkers(){
  if(!map || !mapLoaded) return;

  const day=TRIP.days[currentDayIndex];
  const color=dayColor(day);

  markers.forEach(entry=>{
    const i=entry.itemIndex;
    const it=day.items[i];
    if(!it) return;

    entry.marker.setIcon(
      markerIcon(i+1,color,i===currentStopIndex,completed.has(it.id))
    );
  });
}

function fitRoute(){
  if(!map || !mapLoaded) return;

  const pts=TRIP.days[currentDayIndex].items
    .filter(x=>x.mapVisible!==false&&Number.isFinite(x.lat)&&Number.isFinite(x.lng))
    .map(x=>[x.lat,x.lng]);

  if(!pts.length) return;

  if(pts.length===1){
    map.setView(pts[0],15,{animate:false});
  }else{
    map.fitBounds(pts,{padding:[30,30],animate:false,maxZoom:15});
  }
}

function centerSelected(){
  if(!map || !mapLoaded) return;

  const it=TRIP.days[currentDayIndex].items[currentStopIndex];
  if(it.mapVisible===false){
    toast('이 일정은 정확한 장소가 아직 정해지지 않아 지도 마커를 표시하지 않았습니다.');
    return;
  }
  if(Number.isFinite(it.lat)&&Number.isFinite(it.lng)){
    map.setView([it.lat,it.lng],15,{animate:false});
  }
}

function requestMyLocation(center=true){
  if(!navigator.geolocation) return toast('위치 기능을 사용할 수 없습니다.');

  navigator.geolocation.getCurrentPosition(pos=>{
    userLocation={lat:pos.coords.latitude,lng:pos.coords.longitude};

    if(map && mapLoaded){
      if(userMarker){
        try{ userMarker.remove(); }catch(e){}
      }

      userMarker=L.circleMarker(
        [userLocation.lat,userLocation.lng],
        {
          radius:8,
          color:'#fff',
          weight:3,
          fillColor:'#2385ff',
          fillOpacity:1,
          interactive:false
        }
      ).addTo(map);

      if(center){
        map.setView([userLocation.lat,userLocation.lng],15,{animate:false});
      }
    }

    toast('현재 위치를 확인했습니다.');
  },()=>toast('위치 권한을 허용해 주세요.'),{
    enableHighAccuracy:true,
    timeout:8000,
    maximumAge:30000
  });
}

function googleDirections(origin, dest, mode='walking'){
  const o=encodeURIComponent(origin), d=encodeURIComponent(dest);
  location.href=`https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${mode}`;
}

function selectedItem(){ return TRIP.days[currentDayIndex].items[currentStopIndex]; }
function transportMode(text=''){
  if(text.includes('택시')) return 'driving';
  if(text.includes('지하철')||text.includes('버스')||text.includes('기차')) return 'transit';
  return 'walking';
}

function routeCurrentToSelected(){
  const dest=selectedItem();
  const go=()=>googleDirections(`${userLocation.lat},${userLocation.lng}`,dest.address||`${dest.lat},${dest.lng}`,transportMode(dest.transport));
  if(userLocation) go(); else requestMyLocation(false), setTimeout(()=>{if(userLocation)go();},1200);
}

function routeToNext(){
  const day=TRIP.days[currentDayIndex];
  if(currentStopIndex>=day.items.length-1) return;
  const a=selectedItem(), b=day.items[currentStopIndex+1];
  googleDirections(a.address||`${a.lat},${a.lng}`,b.address||`${b.lat},${b.lng}`,transportMode(b.transport));
}

function routeHome(){
  const day=TRIP.days[currentDayIndex];
  const city = cityForDay(day);
  const home=TRIP.homes[city==='Madrid'?'Madrid':'Barcelona'];
  if(!home) return toast('숙소 정보가 없습니다.');
  const origin = userLocation ? `${userLocation.lat},${userLocation.lng}` : (selectedItem().address||`${selectedItem().lat},${selectedItem().lng}`);
  googleDirections(origin,home.address,'transit');
}

function renderNearbyButtons(){
  const it=selectedItem();
  $$('.nearby').forEach(btn=>{
    btn.onclick=()=>{
      const q=btn.dataset.query;
      const loc = userLocation ? `${userLocation.lat},${userLocation.lng}` : `${it.lat},${it.lng}`;
      location.href=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q+' near '+loc)}`;
    };
  });
}

function updateNetwork(){
  const b=$('#networkBadge');
  const online=navigator.onLine;
  b.textContent=online?'ONLINE':'OFFLINE';
  b.classList.toggle('offline',!online);
  if(!online) $('#offlineMap').classList.remove('hidden');
  else $('#offlineMap').classList.add('hidden');
}

const WMO={0:'맑음',1:'대체로 맑음',2:'구름 조금',3:'흐림',45:'안개',48:'안개',51:'약한 이슬비',53:'이슬비',55:'강한 이슬비',61:'약한 비',63:'비',65:'강한 비',71:'약한 눈',80:'소나기',81:'소나기',82:'강한 소나기',95:'뇌우'};

async function fetchWeather(cityKey){
  const c=TRIP.weatherCities[cityKey];
  const u=`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&timezone=Europe%2FMadrid&forecast_days=16&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&current=temperature_2m,weather_code`;
  const r=await fetch(u); if(!r.ok) throw new Error('weather');
  return r.json();
}

async function loadWeather(force=false){
  if(!navigator.onLine){ renderWeatherSheet(); return; }
  const cached=JSON.parse(localStorage.getItem(STORE.weather)||'{}');
  const age=Date.now()-(cached.fetchedAt||0);
  if(!force && cached.data && age < 2*60*60*1000){ renderWeatherPillFromCache(); return; }
  try{
    const [m,b]=await Promise.all([fetchWeather('Madrid'),fetchWeather('Barcelona')]);
    localStorage.setItem(STORE.weather,JSON.stringify({fetchedAt:Date.now(),data:{Madrid:m,Barcelona:b}}));
    renderWeatherPillFromCache(); renderWeatherSheet();
    if(force) toast('날씨를 갱신했습니다.');
  }catch(e){ if(force) toast('날씨를 불러오지 못했습니다.'); }
}

function forecastForSelected(){
  const cache=JSON.parse(localStorage.getItem(STORE.weather)||'{}').data;
  if(!cache) return null;
  const day=TRIP.days[currentDayIndex];
  const city=cityForDay(day)==='Madrid'?'Madrid':'Barcelona';
  const w=cache[city]; if(!w) return null;
  const iso=dayISO(day);
  const idx=w.daily.time.indexOf(iso);
  if(idx<0) return null;
  return {
    city, code:w.daily.weather_code[idx],
    max:Math.round(w.daily.temperature_2m_max[idx]),min:Math.round(w.daily.temperature_2m_min[idx]),
    rain:w.daily.precipitation_probability_max[idx]
  };
}

function renderWeatherPillFromCache(){
  const f=forecastForSelected(), p=$('#weatherPill');
  if(!f){p.classList.add('hidden');return;}
  p.classList.remove('hidden');
  p.textContent=`${WMO[f.code]||'날씨'} · ${f.max}°/${f.min}° · 비 ${f.rain??'-'}%`;
}

function renderWeatherSheet(){
  const cache=JSON.parse(localStorage.getItem(STORE.weather)||'{}');
  const wrap=$('#weatherContent');
  if(!cache.data){
    wrap.innerHTML='<p style="color:#788296;font-size:13px">아직 저장된 날씨 정보가 없습니다. 온라인에서 새로고침해 주세요.</p>';
    return;
  }
  let html='';
  TRIP.days.forEach(day=>{
    const city=cityForDay(day)==='Madrid'?'Madrid':'Barcelona';
    const w=cache.data[city], iso=dayISO(day), i=w.daily.time.indexOf(iso);
    if(i<0) return;
    html+=`<div class="weather-day">
      <div><strong>${day.date} · ${city==='Madrid'?'마드리드':'바르셀로나'}</strong><br><span>${WMO[w.daily.weather_code[i]]||'날씨'} · 비 ${w.daily.precipitation_probability_max[i]??'-'}%</span></div>
      <div class="weather-temp">${Math.round(w.daily.temperature_2m_max[i])}° / ${Math.round(w.daily.temperature_2m_min[i])}°</div>
    </div>`;
  });
  const t=cache.fetchedAt?new Date(cache.fetchedAt).toLocaleString('ko-KR'):'';
  wrap.innerHTML=html+`<div style="font-size:10px;color:#98a1b0;margin-top:10px">Open-Meteo · 마지막 갱신 ${t}</div>`;
}

function openSheet(which){
  $('#sheetBackdrop').classList.remove('hidden');
  $(which).classList.remove('hidden');
  if(which==='#weatherSheet') renderWeatherSheet();
}
function closeSheets(){ $('#sheetBackdrop').classList.add('hidden'); $$('.bottom-sheet').forEach(x=>x.classList.add('hidden')); }

function toast(msg){
  const t=$('#toast'); t.textContent=msg;t.classList.remove('hidden');
  clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.add('hidden'),2200);
}

function exportProgress(){
  const data={version:4,completed:[...completed],reservationEdits,lastDay:currentDayIndex,lastStop:currentStopIndex,exportedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='spain-trip-progress.json';a.click();URL.revokeObjectURL(a.href);
}
async function importProgress(file){
  try{
    const d=JSON.parse(await file.text());
    completed=new Set(d.completed||[]); reservationEdits=d.reservationEdits||{};
    localStorage.setItem(STORE.completed,JSON.stringify([...completed]));
    localStorage.setItem(STORE.reservationEdits,JSON.stringify(reservationEdits));
    renderDay(); rebuildMap(); toast('진행상황을 복원했습니다.');
  }catch(e){toast('백업 파일을 읽지 못했습니다.');}
}

async function checkForUpdate(){
  if(!('serviceWorker' in navigator)) return toast('업데이트 기능을 지원하지 않습니다.');
  const reg=await navigator.serviceWorker.getRegistration();
  if(reg){await reg.update();toast('업데이트를 확인했습니다. 새 버전이 있으면 다음 실행에 반영됩니다.');}
}
function clearRuntime(){
  if(!confirm('완료 체크, 예약시간 수정, 날씨 캐시를 초기화할까요?')) return;
  [STORE.completed,STORE.lastDay,STORE.lastStop,STORE.reservationEdits,STORE.weather].forEach(k=>localStorage.removeItem(k));
  completed=new Set();reservationEdits={};currentStopIndex=0;renderTabs();renderDay();rebuildMap();toast('로컬 상태를 초기화했습니다.');
}
function lockNow(){
  TRIP=null;encryptedPayload=null;
  $('#app').classList.add('hidden');$('#lockScreen').classList.remove('hidden');$('#passwordInput').value='';
  closeSheets();
}
function forgetKey(){localStorage.removeItem(STORE.rememberedKey);toast('이 iPhone에 저장된 잠금 해제 키를 삭제했습니다.');}

async function bootstrap(){
  $('#unlockBtn').onclick=unlock;
  $('#passwordInput').addEventListener('keydown',e=>{if(e.key==='Enter')unlock();});
  try{
    await fetchEncrypted();
    if(await tryRememberedKey()){startApp();}
  }catch(e){showUnlockError('일정 파일을 불러오지 못했습니다. 인터넷 연결 또는 배포 파일을 확인해 주세요.');}

  $('#completeBtn').onclick=toggleCompleted;
  $('#myLocationBtn').onclick=()=>requestMyLocation(true);
  $('#homeBtn').onclick=routeHome;
  $('#fitRouteBtn').onclick=fitRoute;
  $('#toCurrentBtn').onclick=routeCurrentToSelected;
  $('#toNextBtn').onclick=routeToNext;
  $('#weatherBtn').onclick=()=>openSheet('#weatherSheet');
  $('#settingsBtn').onclick=()=>openSheet('#settingsSheet');
  $('#sheetBackdrop').onclick=closeSheets;
  $$('.close-sheet').forEach(x=>x.onclick=closeSheets);
  $('#refreshWeatherBtn').onclick=()=>loadWeather(true);
  $('#lockNowBtn').onclick=lockNow;
  $('#forgetKeyBtn').onclick=forgetKey;
  $('#exportProgressBtn').onclick=exportProgress;
  $('#importProgressInput').onchange=e=>{if(e.target.files[0])importProgress(e.target.files[0]);};
  $('#checkUpdateBtn').onclick=checkForUpdate;
  $('#clearRuntimeBtn').onclick=clearRuntime;
  $('#versionText').textContent=`v${APP_VERSION}`;
  window.addEventListener('online',()=>{updateNetwork();loadWeather(false);});
  window.addEventListener('offline',updateNetwork);
  window.addEventListener('resize',()=>{ if(map && mapLoaded) setTimeout(()=>map.invalidateSize(false),60); });
  window.addEventListener('orientationchange',()=>{ if(map && mapLoaded) setTimeout(()=>map.invalidateSize(false),250); });
}
bootstrap();

if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.warn));
}
