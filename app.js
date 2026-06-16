// ============================================================
//  RotaLivre — app.js
//  Substitua as variáveis SUPABASE_URL, SUPABASE_KEY e
//  MERCADOPAGO_LINK antes de publicar.
// ============================================================

const SUPABASE_URL  = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_KEY  = 'SUA_CHAVE_PUBLICA_SUPABASE';
const MERCADOPAGO_LINK = 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=SEU_PLANO_ID';
const FREE_LIMIT    = 5;
const POINT_COLORS  = ['#e94560','#f5a623','#1D9E75','#378ADD','#a855f7','#0ea5e9','#f59e0b','#10b981','#ef4444','#8b5cf6'];

// ---- Estado ----
let map, geocoder, dirSvc, dirRender;
let waypoints = [];
let markers   = [];
let user      = null;
let isPro     = false;
let authMode  = 'login'; // 'login' | 'register'
let acTimeout = null;

// ---- Supabase (cliente leve sem SDK) ----
async function sbFetch(path, opts = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + (user?.access_token || SUPABASE_KEY),
      'Content-Type': 'application/json',
      ...opts.headers
    }
  });
  return res.json();
}

// ---- Auth ----
async function sbLogin(email, password) {
  const data = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (data.error) throw new Error(data.error_description || data.error);
  return data;
}

async function sbRegister(email, password) {
  const data = await sbFetch('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (data.error) throw new Error(data.error_description || data.error);
  return data;
}

async function checkProStatus() {
  if (!user) return false;
  const data = await sbFetch('/rest/v1/subscriptions?user_id=eq.' + user.user.id + '&status=eq.active&select=id');
  return Array.isArray(data) && data.length > 0;
}

// ---- UI helpers ----
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showLoading(v) { document.getElementById('loading').style.display = v ? 'flex' : 'none'; }

function setUserUI() {
  const loggedIn = !!user;
  document.getElementById('btn-login').style.display  = loggedIn ? 'none' : '';
  document.getElementById('btn-logout').style.display = loggedIn ? '' : 'none';
  document.getElementById('plan-badge').textContent   = isPro ? 'Pro ⚡' : 'Gratuito';
  document.getElementById('plan-badge').className     = 'badge-plan' + (isPro ? ' pro' : '');
  document.getElementById('btn-upgrade').style.display = (loggedIn && !isPro) ? '' : 'none';
  document.getElementById('stat-limit').textContent   = isPro ? '∞' : FREE_LIMIT + ' pts';
}

// ---- Landing ↔ App ----
function openApp() {
  document.getElementById('landing').style.display  = 'none';
  document.getElementById('app-view').style.display = '';
  if (window._mapReady) startMap(); else window._mapInitCb = startMap;
}

// ---- Auth modal ----
function openLoginModal() { authMode = 'login'; renderAuthModal(); openModal('modal-auth'); }
function openUpgradeModal() { openModal('modal-upgrade'); }

function renderAuthModal() {
  const isLogin = authMode === 'login';
  document.getElementById('auth-title').textContent       = isLogin ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-desc').textContent        = isLogin ? 'Acesse sua conta para salvar suas rotas.' : 'Crie uma conta gratuita agora.';
  document.getElementById('auth-submit-btn').textContent  = isLogin ? 'Entrar' : 'Criar conta';
  document.getElementById('auth-switch').innerHTML        = isLogin
    ? 'Não tem conta? <a onclick="toggleAuthMode()">Criar conta</a>'
    : 'Já tem conta? <a onclick="toggleAuthMode()">Entrar</a>';
  document.getElementById('auth-error').textContent = '';
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  renderAuthModal();
}

async function submitAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Preencha e-mail e senha.'; return; }
  try {
    const data = authMode === 'login' ? await sbLogin(email, pass) : await sbRegister(email, pass);
    user = data;
    isPro = await checkProStatus();
    setUserUI();
    closeModal('modal-auth');
    openApp();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function logout() {
  user = null; isPro = false;
  setUserUI();
  document.getElementById('landing').style.display  = '';
  document.getElementById('app-view').style.display = 'none';
  clearAll();
}

// ---- Checkout ----
function startCheckout() {
  if (!user) {
    closeModal('modal-upgrade');
    openLoginModal();
    return;
  }
  // Abre link do Mercado Pago com o ID do usuário como external_reference
  const url = MERCADOPAGO_LINK + '&external_reference=' + encodeURIComponent(user.user.id);
  window.open(url, '_blank');
}

// ---- Map ----
function startMap() {
  map = new google.maps.Map(document.getElementById('map-canvas'), {
    center: { lat: -25, lng: -52 },
    zoom: 4,
    mapTypeId: 'roadmap',
    disableDefaultUI: true,
    zoomControl: true,
    styles: [
      { featureType: 'all', elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f3460' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#16213e' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
      { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1a4a6b' }] },
      { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#334155' }] },
      { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#8a9bb5' }] },
      { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#a0aec0' }] },
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#16213e' }] },
    ]
  });

  geocoder  = new google.maps.Geocoder();
  dirSvc    = new google.maps.DirectionsService();
  dirRender = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    polylineOptions: { strokeColor: '#e94560', strokeWeight: 4, strokeOpacity: 0.9 }
  });
  dirRender.setMap(map);

  map.addListener('click', (e) => {
    if (!canAddPoint()) return;
    showLoading(true);
    geocoder.geocode({ location: e.latLng }, (res, status) => {
      showLoading(false);
      if (status === 'OK' && res[0]) addPoint(res[0].formatted_address, e.latLng.lat(), e.latLng.lng());
    });
  });
}

// ---- Points ----
function canAddPoint() {
  const limit = isPro ? Infinity : FREE_LIMIT;
  if (waypoints.length >= limit) {
    document.getElementById('paywall-banner').classList.add('visible');
    return false;
  }
  return true;
}

function addPoint(name, lat, lng) {
  if (!canAddPoint()) return;
  const idx   = waypoints.length;
  const color = POINT_COLORS[idx % POINT_COLORS.length];
  waypoints.push({ name, lat, lng, color });

  const marker = new google.maps.Marker({
    position: { lat, lng },
    map,
    zIndex: 10 + idx,
    label: { text: String(idx + 1), color: '#0f0f1a', fontSize: '11px', fontWeight: '700' },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 15,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2.5
    }
  });
  markers.push(marker);
  recalcRoute();
}

function removePoint(idx) {
  waypoints.splice(idx, 1);
  markers[idx].setMap(null);
  markers.splice(idx, 1);
  markers.forEach((m, i) => {
    const color = POINT_COLORS[i % POINT_COLORS.length];
    m.setLabel({ text: String(i + 1), color: '#0f0f1a', fontSize: '11px', fontWeight: '700' });
    m.setIcon({ path: google.maps.SymbolPath.CIRCLE, scale: 15, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5 });
    waypoints[i].color = color;
  });
  document.getElementById('paywall-banner').classList.remove('visible');
  recalcRoute();
}

function clearAll() {
  waypoints = [];
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (dirRender) dirRender.setDirections({ routes: [] });
  document.getElementById('paywall-banner').classList.remove('visible');
  renderSidebar([]);
  updateStats(0, 0);
}

// ---- Route calculation ----
function recalcRoute() {
  if (waypoints.length < 2) {
    if (dirRender) dirRender.setDirections({ routes: [] });
    renderSidebar([]);
    updateStats(0, 0);
    return;
  }
  const origin      = { lat: waypoints[0].lat, lng: waypoints[0].lng };
  const destination = { lat: waypoints[waypoints.length - 1].lat, lng: waypoints[waypoints.length - 1].lng };
  const stops       = waypoints.slice(1, -1).map(p => ({ location: new google.maps.LatLng(p.lat, p.lng), stopover: true }));

  showLoading(true);
  dirSvc.route({
    origin, destination,
    waypoints: stops,
    travelMode: google.maps.TravelMode.DRIVING,
    unitSystem: google.maps.UnitSystem.METRIC
  }, (result, status) => {
    showLoading(false);
    if (status === 'OK') {
      dirRender.setDirections(result);
      const legs = result.routes[0].legs;
      let totalDist = 0, totalTime = 0;
      const segs = legs.map(l => {
        totalDist += l.distance.value;
        totalTime += l.duration.value;
        return Math.round(l.distance.value / 1000);
      });
      updateStats(totalDist, totalTime);
      renderSidebar(segs);
    }
  });
}

function updateStats(distM, timeSec) {
  const km = Math.round(distM / 1000);
  document.getElementById('stat-km').textContent  = km > 0 ? km.toLocaleString('pt-BR') + ' km' : '— km';
  document.getElementById('stat-pts').textContent = waypoints.length;
  if (timeSec > 0) {
    const h = Math.floor(timeSec / 3600), m = Math.round((timeSec % 3600) / 60);
    document.getElementById('stat-time').textContent = h > 0 ? h + 'h ' + m + 'min' : m + 'min';
  } else {
    document.getElementById('stat-time').textContent = '—';
  }
}

// ---- Sidebar list ----
function renderSidebar(segs) {
  const area = document.getElementById('points-area');
  if (waypoints.length === 0) {
    area.innerHTML = `<div class="empty-state"><span class="empty-icon">📍</span>Adicione o primeiro ponto buscando uma cidade ou clicando no mapa.</div>`;
    return;
  }
  let html = '';
  waypoints.forEach((pt, i) => {
    html += `
      <div class="point-row">
        <div class="point-dot" style="background:${pt.color}">${i + 1}</div>
        <div class="point-info">
          <div class="point-name">${pt.name}</div>
        </div>
        <button class="point-del" onclick="removePoint(${i})" title="Remover">✕</button>
      </div>`;
    if (i < segs.length) {
      html += `
      <div class="seg-arrow">
        <div class="seg-line"></div>
        <span class="seg-km">↓ ${segs[i].toLocaleString('pt-BR')} km</span>
        <div class="seg-line"></div>
      </div>`;
    }
  });
  area.innerHTML = html;
  // expose removePoint globally (already is, but make sure)
  window.removePoint = removePoint;
}

// ---- Autocomplete ----
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(acTimeout);
  const val = e.target.value.trim();
  const list = document.getElementById('autocomplete-list');
  if (!val || val.length < 3 || !window.google) { list.style.display = 'none'; return; }
  acTimeout = setTimeout(() => {
    const svc = new google.maps.places.AutocompleteService();
    svc.getPlacePredictions({ input: val, language: 'pt' }, (preds, status) => {
      list.innerHTML = '';
      if (status !== 'OK' || !preds) { list.style.display = 'none'; return; }
      preds.slice(0, 5).forEach(p => {
        const div = document.createElement('div');
        div.className = 'ac-item';
        div.textContent = p.description;
        div.onclick = () => {
          document.getElementById('search-input').value = '';
          list.style.display = 'none';
          geocodeAndAdd(p.description);
        };
        list.appendChild(div);
      });
      list.style.display = 'block';
    });
  }, 280);
});

document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = document.getElementById('search-input').value.trim();
    if (val) { document.getElementById('autocomplete-list').style.display = 'none'; geocodeAndAdd(val); document.getElementById('search-input').value = ''; }
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) document.getElementById('autocomplete-list').style.display = 'none';
});

function geocodeAndAdd(query) {
  if (!canAddPoint()) return;
  showLoading(true);
  geocoder.geocode({ address: query }, (res, status) => {
    showLoading(false);
    if (status === 'OK' && res[0]) {
      const loc = res[0].geometry.location;
      addPoint(res[0].formatted_address, loc.lat(), loc.lng());
    }
  });
}

// ---- Init ----
setUserUI();
