// ════════════════════════════════════════════════════════════
//  GASTOS SEMANALES — app.js v3
// ════════════════════════════════════════════════════════════

// Google Sheets ya no se usa como base de datos principal.
// Usa el menú ☰ → Importar de Sheets para migrar datos.

// ── Configuración ─────────────────────────────────────────────
let PRESUPUESTO = 3400.09; // Configurable desde Ajustes

// Iconos por defecto para motivos conocidos
const MOTIVO_ICON_DEFAULT = {
  'Comida':'🍽️','Comida a Domicilio':'🛵','Mandado':'🧺','Otros':'📋',
  'ATM':'🏧','Compra en Linea':'💻','Farmacia':'💊','Abarrotes':'🛒',
  'Entretenimiento':'🎬','Servicios':'🏠','Reembolso':'↩️','Ahorro':'🐷',
  'Ahorro Victor':'💰','GN':'📌'
};

// Catálogos dinámicos (se cargan desde localStorage / Sheets)
let catalogoCuentas = [
  { nombre:'Banamex',     color:'#e24b4a', tieneCorte:true,  diaCorte:3  },
  { nombre:'Santander',   color:'#22c55e', tieneCorte:true,  diaCorte:4  },
  { nombre:'HSBC',        color:'#c8102e', tieneCorte:true,  diaCorte:9  },
  { nombre:'Banorte',     color:'#1d4ed8', tieneCorte:true,  diaCorte:22 },
  { nombre:'BBVA',        color:'#92400e', tieneCorte:true,  diaCorte:21 },
  { nombre:'Amex',        color:'#ec4899', tieneCorte:true,  diaCorte:13 },
  { nombre:'MercadoPago', color:'#eab308', tieneCorte:true,  diaCorte:21 },
  { nombre:'Debito',      color:'#64748b', tieneCorte:false, diaCorte:null },
];

let catalogoMotivos = [
  'Comida','Comida a Domicilio','Mandado','Otros','ATM',
  'Compra en Linea','Farmacia','Abarrotes','Entretenimiento',
  'Servicios','Reembolso','Ahorro','Ahorro Victor','GN'
];

let catalogoComentarios = [
  'Starbucks','Caffenio','Amazon','Mercado Libre','Chipotles',
  'Carls Jr','Jack In The Box','DQ','Pizza','Tacos','Sams',
  'Walmart','Oxxo','Hot Dogs','HBO MAX','Apple One','Boneless',
  '260','Costco','Gas','Luz','Agua','Internet'
];

// Helpers que reemplazan las constantes estáticas anteriores
function getCuentas()      { return catalogoCuentas.map(c => c.nombre); }
function getCuentaObj(n)   { return catalogoCuentas.find(c => c.nombre === n) || {}; }
function getCuentaColor(n) { return getCuentaObj(n).color || '#888'; }
function getMotivoIcon(m)  { return MOTIVO_ICON_DEFAULT[m] || '📋'; }
function getCortesConfig() {
  const cfg = {};
  catalogoCuentas.filter(c => c.tieneCorte && c.diaCorte).forEach(c => {
    cfg[c.nombre] = { dia: c.diaCorte, color: c.color };
  });
  return cfg;
}

// ── Estado ────────────────────────────────────────────────────
let gastos = [];
let historico = [];
let nextId = 1;
let cuentasAhorro = [];
let nextAhorroId = 1;
let excepciones = []; // [{Cuenta, FechaOriginal, FechaExcepcion, Nota}]

let abonado = false;
let ignorar = false;
let externo = 'no';
let descontarAhorro = false;
let ahorroDescontar = null;
let activeFilter = 'todos';
let extFilter = 'todos';
let editingId = null;
let movMode = 'abono';
let movCuentaId = null;
let traspasoOrigenId = null;

// Recurrentes (servicios, plataformas con cargo fijo mensual)
// { id, nombre, cuenta, motivo, cantidad, dia, activo, ultimoAviso }
let recurrentes = [];
let nextRecId = 1;

// Deudas a meses sin intereses
// { id, nombre, cuenta, total, cuota, mesesTotal, mesesPagados, diaCorte, fechaInicio }
let deudas = [];
let nextDeudaId = 1;
let nextMovId = 1;

// ── Utilidades ────────────────────────────────────────────────
const fmt = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const fmtD = d => {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0,10);
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0,10);
  }
  return String(d).slice(0,10);
};

function getWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return date.getUTCFullYear() + '-W' + String(Math.ceil((((date - y) / 86400000) + 1) / 7)).padStart(2, '0');
}

// ════════════════════════════════════════════════════════════
//  SINCRONIZACIÓN — GitHub API
//  Lee y escribe datos.json directamente en tu repositorio.
//  Configurar: ☰ → GitHub Sync → Configurar token
// ════════════════════════════════════════════════════════════

const GITHUB_OWNER  = 'VictorGtz12';
const GITHUB_REPO   = 'GastosApp';
const GITHUB_FILE   = 'datos.json';
const GITHUB_BRANCH = 'main';

function getGithubToken() { return localStorage.getItem('githubToken') || ''; }
function usingGithub()    { return !!getGithubToken() && localStorage.getItem('githubDisabled') !== '1'; }
const usingSheets = usingGithub;

// ── Supabase Sync ────────────────────────────────────────────
const SUPABASE_URL  = 'https://iskzbiozycpvnkkverfg.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_VXLcIr88JZDRMn7-k7XJUw_y4k9nceQ';

function getSupabaseDeviceId() {
  let id = localStorage.getItem('supabaseDeviceId');
  if (!id) { id = 'device_' + Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem('supabaseDeviceId', id); }
  return id;
}
function usingSupabase() { return localStorage.getItem('supabaseEnabled') === '1'; }

async function uploadSupabase() {
  if (!usingSupabase()) return false;
  try {
    const snap = compressSnap(buildSnapshot());
    const deviceId = getSupabaseDeviceId();
    // Usar UPSERT correcto de Supabase: POST con Prefer: resolution=merge-duplicates y onConflict
    const res = await fetch(`${SUPABASE_URL}/rest/v1/snapshots?on_conflict=device_id`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ device_id: deviceId, data: snap, updated_at: new Date().toISOString() })
    });
    if (!res.ok) { const e = await res.text(); throw new Error(e); }
    localStorage.setItem('lastSyncSupabase', new Date().toISOString());
    registrarEntradaHistorialSync('subida', 'supabase');
    return true;
  } catch(e) { console.warn('Supabase upload error:', e.message); return false; }
}

async function downloadSupabase() {
  if (!usingSupabase()) return false;
  try {
    const deviceId = getSupabaseDeviceId();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/snapshots?device_id=eq.${deviceId}&select=data,updated_at`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!rows.length) return false;
    const snap = decompressSnap(rows[0].data);
    const ok = applySnapshot(snap);
    if (ok) {
      saveLocal();
      localStorage.setItem('lastSyncSupabase', new Date().toISOString());
      registrarEntradaHistorialSync('descarga', 'supabase');
    }
    return ok;
  } catch(e) { console.warn('Supabase download error:', e.message); return false; }
}

function githubApiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
}

function githubHeaders() {
  return {
    'Authorization': `Bearer ${getGithubToken()}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

// Compresión de campos para reducir tamaño del JSON
const SNAP_KEYS = {
  'periodoCorte':'pc','comentarios':'co','cantidad':'ca','externo':'ex',
  'abonado':'ab','ignorar':'ig','ahorroDesc':'ad','semana':'se',
  'motivo':'mo','cuenta':'cu','fecha':'fe','movimientos':'mv',
  'excluirTotal':'et','nombre':'no','grupo':'gr','meta':'me',
  'destino':'de','origen':'or','nota':'nt','tipo':'ti',
};
const SNAP_KEYS_REV = Object.fromEntries(Object.entries(SNAP_KEYS).map(([k,v])=>[v,k]));

function compressSnap(obj) {
  if (Array.isArray(obj)) return obj.map(compressSnap);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(obj)) out[SNAP_KEYS[k]||k] = compressSnap(v);
    return out;
  }
  return obj;
}

function decompressSnap(obj) {
  if (Array.isArray(obj)) return obj.map(decompressSnap);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(obj)) out[SNAP_KEYS_REV[k]||k] = decompressSnap(v);
    return out;
  }
  return obj;
}

function buildSnapshot() {
  return {
    version:2, savedAt:new Date().toISOString(),
    gastos, historico, nextId, cuentasAhorro, nextAhorroId,
    excepciones, catalogoCuentas, catalogoMotivos, catalogoComentarios,
    recurrentes, nextRecId, deudas, nextDeudaId, nextMovId, presupuesto:PRESUPUESTO,
  };
}

function applySnapshot(snap) {
  if (!snap || snap.version < 2) return false;
  if (snap.gastos)              gastos              = snap.gastos.map(normGasto);
  if (snap.historico)           historico           = snap.historico.map(normGasto);
  if (snap.nextId)              nextId              = snap.nextId;
  if (snap.cuentasAhorro)       cuentasAhorro       = snap.cuentasAhorro.map(normAhorro);
  if (snap.nextAhorroId)        nextAhorroId        = snap.nextAhorroId;
  if (snap.excepciones)         excepciones         = snap.excepciones;
  if (snap.catalogoCuentas)     catalogoCuentas     = snap.catalogoCuentas;
  if (snap.catalogoMotivos)     catalogoMotivos     = snap.catalogoMotivos;
  if (snap.catalogoComentarios) catalogoComentarios = snap.catalogoComentarios.map(c=>typeof c==='string'?c:(c.nombre||''));
  if (snap.recurrentes)         recurrentes         = snap.recurrentes;
  if (snap.nextRecId)           nextRecId           = snap.nextRecId;
  if (snap.deudas)              deudas              = snap.deudas;
  if (snap.nextDeudaId)         nextDeudaId         = snap.nextDeudaId;
  if (snap.nextMovId)           nextMovId           = snap.nextMovId || 1;
  if (snap.presupuesto)         PRESUPUESTO         = snap.presupuesto;
  return true;
}

// ── Historial de Sync ───────────────────────────────────────
function registrarEntradaHistorialSync(tipo, fuente = 'github') {
  try {
    const hist = JSON.parse(localStorage.getItem('syncHistorial') || '[]');
    const snap = buildSnapshot();
    hist.unshift({
      tipo,    // 'subida' | 'descarga'
      fuente,  // 'github' | 'supabase'
      ts: new Date().toISOString(),
      gastos: (snap.gastos?.length || 0) + (snap.historico?.length || 0),
    });
    localStorage.setItem('syncHistorial', JSON.stringify(hist.slice(0, 50)));
  } catch(e) {}
}

function verHistorialSync() {
  const hist = JSON.parse(localStorage.getItem('syncHistorial') || '[]');
  const body = document.getElementById('historial-sync-body');
  if (!hist.length) {
    body.innerHTML = '<div class="empty">Sin sincronizaciones registradas</div>';
  } else {
    body.innerHTML = hist.map(h => {
      const fecha = new Date(h.ts);
      const hora  = fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      const dia   = fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
      const icono = h.tipo === 'subida' ? '⬆️' : '⬇️';
      const color = h.tipo === 'subida' ? 'var(--accent2)' : 'var(--green)';
      const fuenteLabel = h.fuente === 'supabase' ? '🗄️ Supabase' : '🐙 GitHub';
      const accion = h.tipo === 'subida' ? 'Subida' : 'Descarga';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">${icono}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:${color}">${accion} · ${fuenteLabel}</div>
            <div style="font-size:11px;color:var(--text3)">${dia} · ${hora}</div>
          </div>
        </div>
        <div style="text-align:right;font-size:11px;color:var(--text3)">
          <div>${h.gastos} gastos</div>
        </div>
      </div>`;
    }).join('');
  }
  openModal('modal-historial-sync');
}

function limpiarHistorialSync() {
  localStorage.removeItem('syncHistorial');
  verHistorialSync();
}

async function uploadSnapshot() {
  if (!usingGithub()) return false;
  try {
    const snap    = compressSnap(buildSnapshot());
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(snap))));

    // Intentar subir — reintentar una vez si hay conflicto de SHA (409)
    for (let intento = 0; intento < 2; intento++) {
      // Obtener SHA fresco en cada intento
      let sha = null;
      const getMeta = await fetch(githubApiUrl(), { headers: githubHeaders() });
      if (getMeta.ok) { const d = await getMeta.json(); sha = d.sha; }
      else if (getMeta.status !== 404) throw new Error(`GET HTTP ${getMeta.status}`);

      const res = await fetch(githubApiUrl(), {
        method: 'PUT', headers: githubHeaders(),
        body: JSON.stringify({
          message: `sync ${new Date().toISOString().slice(0,16).replace('T',' ')}`,
          content, branch: GITHUB_BRANCH, ...(sha ? {sha} : {})
        })
      });

      if (res.ok) {
        const result = await res.json();
        const newSha = result.content?.sha;
        if (newSha) localStorage.setItem('githubSha', newSha);
        const ts = new Date().toISOString();
        localStorage.setItem('lastSync', ts);
        localStorage.setItem('localModified', ts);
        registrarEntradaHistorialSync('subida');
        return true;
      }

      const e = await res.json();
      // Si es conflicto de SHA y es el primer intento, reintentar
      if (res.status === 409 && intento === 0) {
        console.warn('SHA conflict, retrying...');
        localStorage.removeItem('githubSha');
        continue;
      }
      throw new Error(e.message || `HTTP ${res.status}`);
    }
    return false;
  } catch(e) { console.warn('upload error:', e.message); return false; }
}

async function downloadSnapshot() {
  if (!usingGithub()) return false;
  if (syncBloqueado) return false;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15000);
    const res = await fetch(githubApiUrl(), {
      headers: githubHeaders(), signal: controller.signal
    });
    if (res.status === 404) { console.log('datos.json no existe aún'); return false; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta      = await res.json();
    const remoteSha = meta.sha;
    const cachedSha = localStorage.getItem('githubSha');
    // Si el SHA coincide Y hay datos locales -> sin cambios remotos, no aplicar
    if (remoteSha && remoteSha === cachedSha && gastos.length > 0) {
      return true;
    }
    // Hay cambios o no hay datos -> aplicar snapshot
    const decoded = decodeURIComponent(escape(atob(meta.content.replace(/\n/g,''))));
    const snap    = decompressSnap(JSON.parse(decoded));
    const ok      = applySnapshot(snap);
    if (ok) {
      saveLocal();
      localStorage.setItem('githubSha', remoteSha);
      const ts = new Date().toISOString();
      localStorage.setItem('lastSync', ts);
      localStorage.setItem('localModified', ts);
    }
    return ok;
  } catch(e) { console.warn('download error:', e.message); return false; }
}

function saveData(opts = {}) { saveLocal(); }

async function refreshData() {
  // Supabase sync (download primero, luego upload)
  if (usingSupabase()) {
    await downloadSupabase();
    await uploadSupabase();
  }
  if (!usingGithub()) {
    loadFromLocal(); actualizarSelectCuentas(); actualizarSelectMotivos();
    showTab(tabActualGlobal);
    showToast('Vista actualizada ✓'); return;
  }
  const tabActual = tabActualGlobal;
  const bp = document.getElementById('banner-pendientes');
  if (bp) bp.style.display = 'none';
  mostrarBannerActualizar();
  showToast('Sincronizando...');
  const up = await uploadSnapshot();
  if (!up) { showToast('Error al subir — revisa tu token'); mostrarEstadoSync(false); return; }
  // NO descargar después de subir — ya tenemos los datos correctos en local.
  // Solo actualizamos los timestamps para que coincidan.
  const ts = new Date().toISOString();
  localStorage.setItem('lastSync', ts);
  localStorage.setItem('localModified', ts);
  actualizarSelectCuentas(); actualizarSelectMotivos();
  renderMenu();
  showTab(tabActual);
  mostrarEstadoSync(true);
  showToast('Sincronizado ✓');
}

function configurarGithub() {
  const input = document.getElementById('input-github-token');
  if (input) input.value = getGithubToken();
  openModal('modal-github-token');
}

function guardarGithubToken() {
  const token = (document.getElementById('input-github-token').value || '').trim();
  localStorage.setItem('githubToken', token);
  closeModal('modal-github-token');
  if (!token) { showToast('Sync desactivado'); return; }
  showToast('Conectando con GitHub...');
  setTimeout(async () => {
    // Intentar descargar primero — si GitHub tiene datos, esos ganan
    const down = await downloadSnapshot();
    if (down) {
      actualizarSelectCuentas(); actualizarSelectMotivos();
      showTab('menu');
      mostrarEstadoSync(true);
      showToast('Datos sincronizados desde GitHub ✓');
    } else {
      // GitHub vacío o error — subir datos locales
      const up = await uploadSnapshot();
      mostrarEstadoSync(up);
      showToast(up ? 'Datos subidos a GitHub ✓' : 'Verifica que el token sea correcto');
    }
  }, 300);
}

function mostrarEstadoSync(ok) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.style.display = 'inline'; el.style.cursor = 'pointer'; el.onclick = () => refreshData();
  if (!usingGithub()) { el.textContent = ''; el.style.display = 'none'; return; }
  const localMod = new Date(localStorage.getItem('localModified')||0).getTime();
  const lastSync = new Date(localStorage.getItem('lastSync')||0).getTime();
  if (localMod > lastSync + 3000) {
    el.textContent = '⬆️ Cambios sin subir'; el.style.color = 'var(--orange)';
    const b = document.getElementById('banner-pendientes'); if (b) b.style.display = 'flex';
  } else if (ok && lastSync) {
    const d = new Date(lastSync);
    el.textContent = `✓ ${d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`;
    el.style.color = 'var(--green)';
    const b = document.getElementById('banner-pendientes'); if (b) b.style.display = 'none';
  } else {
    el.textContent = '⚠️ Sin sync'; el.style.color = 'var(--orange)';
  }
}

function mostrarBannerActualizar() {
  const s = document.getElementById('sync-status');
  if (s) {
    s.style.display = 'inline';
    s.innerHTML = '<span style="display:inline-block;animation:spin .7s linear infinite">⟳</span> Sync...';
    s.style.color = 'var(--text3)';
  }
}
function ocultarBannerActualizar()    { mostrarEstadoSync(true); }
function ocultarAvisoDesactualizado() {}
function mostrarAvisoDesactualizado() {}
function verificarPendientes()        { mostrarEstadoSync(true); }

function iniciarAutoSync() {
  if (!usingGithub()) return;
  // Respaldo: cada 2 min reintenta si quedó algo sin subir
  setInterval(async () => {
    if (syncBloqueado) return;
    const lm = new Date(localStorage.getItem('localModified')||0).getTime();
    const ls = new Date(localStorage.getItem('lastSync')||0).getTime();
    if (lm > ls + 3000) {
      const up = await uploadSnapshot();
      if (up) mostrarEstadoSync(true);
    }
  }, 2 * 60 * 1000);
}

// Configura la URL de Sheets
function configurarSheets() {
  // configurarSheets reemplazado por configurarGithub
}

// Mostrar estado de sync en topbar
function mostrarEstadoSync(ok) {
  const el   = document.getElementById('sync-status');
  const last = localStorage.getItem('lastSync');
  if (!el) return;
  el.style.display = 'inline';
  if (ok && last) {
    const d = new Date(last);
    el.textContent = `✓ ${d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`;
    el.style.color = 'var(--green)';
  } else {
    el.textContent = usingGithub() ? '⚠️ Sin sync' : '';
    el.style.color = 'var(--orange)';
  }
}

function mostrarBannerActualizar() {
  const status = document.getElementById('sync-status');
  if (status && usingGithub()) {
    status.style.display = 'inline';
    status.textContent = '🔄 ...';
    status.style.color = 'var(--text3)';
  }
}

function ocultarBannerActualizar() {
  mostrarEstadoSync(true);
}

function ocultarAvisoDesactualizado() {}
function mostrarAvisoDesactualizado() {}




// ════════════════════════════════════════════════════════════
//  ALMACENAMIENTO LOCAL — localStorage
// ════════════════════════════════════════════════════════════

function saveLocal() {
  try {
    const data = {
      gastos, historico, nextId, nextAhorroId,
      cuentasAhorro, excepciones,
      catalogoCuentas, catalogoMotivos, catalogoComentarios,
      presupuesto: PRESUPUESTO,
      recurrentes, nextRecId, deudas, nextDeudaId, nextMovId
    };
    localStorage.setItem('appData_v1', JSON.stringify(data));
    const ts = new Date().toISOString();
    localStorage.setItem('localModified', ts);
    // Sincronizar automáticamente en segundo plano
    if (!syncBloqueado) {
      clearTimeout(window._autoSyncTimer);
      window._autoSyncTimer = setTimeout(async () => {
        const [upGH, upSB] = await Promise.all([
          usingGithub() ? uploadSnapshot() : Promise.resolve(true),
          usingSupabase() ? uploadSupabase() : Promise.resolve(true)
        ]);
        const up = upGH && upSB;
        if (up) {
          mostrarEstadoSync(true);
          const b = document.getElementById('banner-pendientes');
          if (b) b.style.display = 'none';
        } else {
          const syncEl = document.getElementById('sync-status');
          if (syncEl) {
            syncEl.style.display = 'inline';
            syncEl.textContent   = '⬆️ Sin subir';
            syncEl.style.color   = 'var(--orange)';
            syncEl.style.cursor  = 'pointer';
            syncEl.onclick       = () => refreshData();
          }
          const b = document.getElementById('banner-pendientes');
          if (b) b.style.display = 'flex';
        }
      }, 1500);
    }
  } catch(e) {
    console.warn('saveLocal error:', e);
    try {
      localStorage.setItem('gastos',    JSON.stringify(gastos));
      localStorage.setItem('historico', JSON.stringify(historico));
      localStorage.setItem('ahorros',   JSON.stringify(cuentasAhorro));
    } catch(e2) { console.error('saveLocal fallback error:', e2); }
  }
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem('appData_v1');
    if (raw) {
      const data = JSON.parse(raw);
      if (data.gastos)              gastos              = data.gastos.map(normGasto);
      if (data.historico)           historico           = data.historico.map(normGasto);
      if (data.nextId)              nextId              = data.nextId;
      if (data.nextAhorroId)        nextAhorroId        = data.nextAhorroId;
      if (data.excepciones)         excepciones         = data.excepciones;
      if (data.catalogoCuentas)     catalogoCuentas     = data.catalogoCuentas;
      if (data.catalogoMotivos)     catalogoMotivos     = data.catalogoMotivos;
      if (data.catalogoComentarios) catalogoComentarios = data.catalogoComentarios.map(c => typeof c === 'string' ? c : (c.nombre || c.Nombre || '')).filter(Boolean);
      if (data.cuentasAhorro)       cuentasAhorro       = data.cuentasAhorro.map(normAhorro);
      if (data.presupuesto)         PRESUPUESTO         = data.presupuesto;
      if (data.recurrentes)         recurrentes         = data.recurrentes  || [];
      if (data.nextRecId)           nextRecId           = data.nextRecId;
      if (data.deudas)              deudas              = data.deudas       || [];
      if (data.nextDeudaId)         nextDeudaId         = data.nextDeudaId;
      if (data.nextMovId)           nextMovId           = data.nextMovId || 1;
      return;
    }
    // Fallback: claves legacy
    const tryGet = (...keys) => { for (const k of keys) { const v = localStorage.getItem(k); if (v !== null) return v; } return null; };
    const g = tryGet('gastos','gastos_v7','gastos_v6','gastos_v5');
    const h = tryGet('historico','historico_v7','historico_v6');
    const a = tryGet('ahorros','ahorros_v7','ahorros_v6');
    if (g) gastos    = JSON.parse(g).map(normGasto);
    if (h) historico = JSON.parse(h).map(normGasto);
    if (a) cuentasAhorro = JSON.parse(a).map(normAhorro);
    if (g || h || a) saveLocal();
  } catch(e) { console.error('loadFromLocal error:', e); }
}

function normGasto(x) {
  let fecha = String(x.fecha || x.Fecha || today());
  if (fecha.includes('T')) fecha = fecha.slice(0, 10);
  return {
    id:           x.id || x.ID,
    fecha,
    cuenta:       x.cuenta || x.Cuenta || '',
    motivo:       x.motivo || x.Motivo || '',
    cantidad:     Number(x.cantidad || x.Cantidad) || 0,
    comentarios:  x.comentarios || x.Comentarios || '',
    abonado:      x.abonado === true || x.Abonado === 'SI' || x.abonado === 'true',
    ignorar:      x.ignorar === true || x.Ignorar === 'SI' || x.ignorar === 'true',
    externo:      x.externo || x.Externo || 'no',
    semana:       x.semana || x.Semana || getWeek(new Date()),
    ahorroDesc:   x.ahorroDesc || x.AhorroDesc || '',
    periodoCorte: x.periodoCorte || null,
    updatedAt:    x.updatedAt || null,
  };
}

function normAhorro(c) {
  const excluir = c.excluirTotal === true || c.excluirTotal === 'SI' || c.excluirTotal === 'true';
  return {
    id:           c.id || c.ID,
    nombre:       c.nombre || c.Nombre || '',
    meta:         Number(c.meta || c.Meta) || 0,
    grupo:        c.grupo || c.Grupo || 'General',
    excluirTotal: excluir,
    movimientos:  (c.movimientos || []).map(m => ({
      tipo:     m.tipo || '',
      cantidad: Number(m.cantidad) || 0,
      nota:     m.nota || '',
      fecha:    String(m.fecha || '').slice(0, 10),
      destino:  m.destino ? Number(m.destino) : undefined,
      origen:   m.origen  ? Number(m.origen)  : undefined,
    })),
  };
}


// ── Navegación ────────────────────────────────────────────────
const TABS = ['menu','gastos','nuevo','externos','cortes','ahorros','historico','catalogos','recurrentes','conciliacion'];
let tabActualGlobal = 'menu';

function showTab(tab) {
  tabActualGlobal = tab; // siempre actualizar el tab global
  TABS.forEach(t => {
    document.getElementById('content-' + t).classList.toggle('active', t === tab);
    const tabEl = document.getElementById('tab-' + t);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
  // Marcar activo en drawer
  ['historico','catalogos','recurrentes','conciliacion'].forEach(t => {
    const el = document.getElementById('drawer-' + t);
    if (el) el.classList.toggle('active-item', t === tab);
  });
  const titles = {
    menu:'Gastos Semanales', gastos:'Mis Gastos',
    nuevo: editingId ? 'Editar Gasto' : 'Nuevo Gasto',
    externos:'Externos', cortes:'Cortes por Tarjeta',
    ahorros:'Mis Ahorros', historico:'Historial',
    catalogos:'Catálogos', recurrentes:'Recurrentes y Deudas', conciliacion:'Conciliación'
  };
  document.getElementById('topbar-title').textContent = titles[tab] || 'Gastos Semanales';
  if (tab === 'nuevo' && !editingId) {
    const fe = document.getElementById('f-fecha'); if (fe && !fe.value) fe.value = today();
  }
  if (tab === 'gastos')    renderGastos();
  if (tab === 'externos')  renderExternos();
  if (tab === 'cortes')    renderCortes();
  if (tab === 'ahorros')   renderAhorros();
  if (tab === 'historico')   renderHistorico();
  if (tab === 'catalogos')   renderCatalogos();
  if (tab === 'recurrentes') renderRecurrentes();
  if (tab === 'conciliacion') renderConciliacion();
}

// ── Menú ──────────────────────────────────────────────────────
function renderMenu() {
  const activos = gastos.filter(g => !g.ignorar);
  const total   = activos.reduce((s, g) => s + g.cantidad, 0);
  const pct     = Math.min(100, Math.round(total / PRESUPUESTO * 100));
  const disp    = Math.max(0, PRESUPUESTO - total);
  const extPend = [...gastos, ...historico].filter(g => g.externo === 'externo').reduce((s,g) => s+g.cantidad, 0);
  const totA    = cuentasAhorro.filter(c=>!c.excluirTotal).reduce((s, c) => s + saldoCuenta(c), 0);

  document.getElementById('s-total').textContent = fmt(total);
  document.getElementById('s-disp').textContent  = fmt(disp);
  document.getElementById('s-disp').className = 'stat-val ' + (disp < 500 ? 'red' : 'green');
  document.getElementById('s-ext').textContent    = fmt(extPend);
  document.getElementById('s-ahorro').textContent = fmt(totA);
  document.getElementById('p-nums').textContent   = fmt(total) + ' / ' + fmt(PRESUPUESTO);

  const fill = document.getElementById('p-fill');
  fill.style.width  = pct + '%';
  fill.className    = 'progress-fill' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '');
  document.getElementById('p-pct').textContent   = pct + '% usado';
  document.getElementById('p-resta').textContent = 'Resta ' + fmt(disp);

  const rows = getCuentas().map(c => {
    const sum = activos.filter(g => g.cuenta === c).reduce((s,g) => s+g.cantidad, 0);
    if (!sum) return '';
    return `<div class="saldo-row">
      <span class="saldo-nombre"><span class="dot" style="background:${getCuentaColor(c)||'#888'}"></span>${c}</span>
      <span class="saldo-monto">${fmt(sum)}</span>
    </div>`;
  }).filter(Boolean).join('');
  document.getElementById('saldos-list').innerHTML = rows ||
    '<div style="font-size:12px;color:var(--text2);padding:6px 0">Sin gastos esta semana</div>';
  verificarCortesProximos();
  verificarRecurrentesProximos();
}

// ── Gastos ────────────────────────────────────────────────────
// ── Edición masiva ──────────────────────────────────────────
let modoMasivo = false;
const seleccionMasiva = new Set();

function toggleEdicionMasiva() {
  modoMasivo = !modoMasivo;
  seleccionMasiva.clear();
  const toolbar = document.getElementById('toolbar-masiva');
  const btn = document.getElementById('btn-edicion-masiva');
  if (toolbar) toolbar.style.display = modoMasivo ? 'flex' : 'none';
  if (btn) { btn.textContent = modoMasivo ? '✕ Editar' : '✏️ Editar'; btn.style.borderColor = modoMasivo ? 'var(--accent)' : 'var(--border2)'; btn.style.color = modoMasivo ? 'var(--accent2)' : 'var(--text2)'; }
  if (modoMasivo) {
    // Llenar selects
    const sc = document.getElementById('masiva-cuenta');
    const sm = document.getElementById('masiva-motivo');
    if (sc) sc.innerHTML = '<option value="">— Cuenta —</option>' + getCuentas().map(c => `<option value="${c}">${c}</option>`).join('');
    if (sm) sm.innerHTML = '<option value="">— Motivo —</option>' + catalogoMotivos.map(m => `<option value="${m}">${m}</option>`).join('');
  }
  actualizarConteoMasiva();
  renderGastos();
}

function toggleSeleccionMasiva(id) {
  if (seleccionMasiva.has(id)) seleccionMasiva.delete(id);
  else seleccionMasiva.add(id);
  actualizarConteoMasiva();
  renderGastos();
}

function actualizarConteoMasiva() {
  const el = document.getElementById('masiva-count');
  if (el) el.textContent = `${seleccionMasiva.size} seleccionado${seleccionMasiva.size !== 1 ? 's' : ''}`;
}

function aplicarEdicionMasiva() {
  if (!seleccionMasiva.size) { showToast('Selecciona al menos un gasto'); return; }
  const cuenta  = document.getElementById('masiva-cuenta')?.value;
  const motivo  = document.getElementById('masiva-motivo')?.value;
  const estado  = document.getElementById('masiva-estado')?.value;
  if (!cuenta && !motivo && !estado) { showToast('Selecciona al menos un campo a cambiar'); return; }

  let count = 0;
  gastos.forEach(g => {
    if (!seleccionMasiva.has(g.id)) return;
    if (cuenta) g.cuenta = cuenta;
    if (motivo) g.motivo = motivo;
    if (estado === 'abonado')    { g.abonado = true; }
    if (estado === 'pendiente')  { g.abonado = false; }
    if (estado === 'ignorar')    { g.ignorar = true; }
    if (estado === 'no-ignorar') { g.ignorar = false; }
    g.updatedAt = new Date().toISOString();
    count++;
  });

  saveLocal();
  showToast(`${count} gastos actualizados ✓`);
  toggleEdicionMasiva();
  renderMenu();
}

function renderGastos() {
  const q = (document.getElementById('search-in').value || '').toLowerCase();
  let list = gastos.filter(g => {
    if (activeFilter === 'pendiente') return !g.abonado;
    if (activeFilter === 'abonado')   return g.abonado;
    if (activeFilter === 'ignorar')   return g.ignorar;
    if (activeFilter === 'externo')   return g.externo !== 'no';
    return true;
  }).filter(g => !q ||
    g.motivo.toLowerCase().includes(q) ||
    g.cuenta.toLowerCase().includes(q) ||
    (g.comentarios||'').toLowerCase().includes(q) ||
    String(g.cantidad).includes(q)
  );
  // Búsqueda global: incluir histórico cuando hay texto
  if (q && activeFilter === 'todos') {
    const enHist = historico.filter(g =>
      g.motivo.toLowerCase().includes(q) ||
      g.cuenta.toLowerCase().includes(q) ||
      (g.comentarios||'').toLowerCase().includes(q) ||
      String(g.cantidad).includes(q)
    ).map(g => ({...g, _esHistorico: true}));
    if (enHist.length) list = [...list, ...enHist];
  }
  list = list.sort((a,b) => (Number(b.id)||0) - (Number(a.id)||0) || String(b.fecha).localeCompare(String(a.fecha)));
  const el = document.getElementById('gastos-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Sin gastos registrados</div>'; return; }
  el.innerHTML = list.map(g => {
    const iE = g.externo === 'externo', iP = g.externo === 'pagado';
    const seleccionado = modoMasivo && seleccionMasiva.has(g.id);
    return `<div class="gasto-item ${iE?'ext-pend':iP?'ext-paid':''}" style="${g.ignorar?'opacity:.55':''}${seleccionado?';border-color:var(--accent);background:rgba(108,99,255,.08)':''}" onclick="${modoMasivo?`toggleSeleccionMasiva(${g.id})`:''}">
      ${modoMasivo
        ? `<div style="width:22px;height:22px;border-radius:6px;border:2px solid ${seleccionado?'var(--accent)':'var(--border2)'};background:${seleccionado?'var(--accent)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">${seleccionado?'<span style="color:white;font-size:12px">✓</span>':''}</div>`
        : `<div class="gasto-icon" onclick="openDetail(${g.id})">${getMotivoIcon(g.motivo)||'📋'}</div>`
      }
      <div class="gasto-info" onclick="${modoMasivo?`toggleSeleccionMasiva(${g.id})`:`openDetail(${g.id})`}">
        <div class="gasto-motivo">${g.motivo}${g.ahorroDesc?` <span style="font-size:10px;color:var(--purple)">🐷 ${g.ahorroDesc}</span>`:''}${g._esHistorico?' <span style="font-size:9px;background:rgba(108,99,255,.2);color:var(--accent2);padding:1px 5px;border-radius:6px">historial</span>':''}</div>
        <div class="gasto-meta">${g.cuenta}${g.comentarios?' · '+g.comentarios:''} · ${g.fecha}</div>
        <div class="badges">
          ${g.ignorar ? '<span class="badge ignorar">🚫 Ignorado</span>' : ''}
          ${!g.ignorar && iE ? '<span class="badge ext">📤 Externo</span>' : ''}
          ${!g.ignorar && iP ? '<span class="badge ext-paid">✅ Cobrado</span>' : ''}
          ${!iE && !iP ? `<span class="badge ${g.abonado?'ab':'pend'}">${g.abonado?'✓ Abonado':'✗ Pendiente'}</span>` : ''}
          ${gastoPendienteSync(g) ? '<span style="font-size:9px;background:rgba(255,159,67,.15);color:var(--orange);border:1px solid rgba(255,159,67,.3);padding:1px 6px;border-radius:6px;font-weight:600">⬆️ Sin sync</span>' : ''}
          ${g.desdeConciliador ? '<span style="font-size:9px;background:rgba(108,99,255,.15);color:var(--accent2);border:1px solid rgba(108,99,255,.3);padding:1px 6px;border-radius:6px;font-weight:600">🏦 Banco</span>' : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div class="gasto-monto" onclick="openDetail(${g.id})" style="${g.ignorar||iP?'text-decoration:line-through;color:var(--text2)':iE?'color:var(--orange)':''}">${fmt(g.cantidad)}</div>
        ${!g._esHistorico&&!modoMasivo?`<button onclick="editarDirecto(${g.id})" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:5px 8px;font-size:11px;cursor:pointer;flex-shrink:0">✏️</button>`:''}
      </div>
    </div>`;
  }).join('');
}

function setFilter(f) {
  activeFilter = f;
  ['todos','pendiente','abonado','ignorar','externo'].forEach(x =>
    document.getElementById('f-'+x).classList.toggle('active', x===f)
  );
  renderGastos();
}

// ── Externos ──────────────────────────────────────────────────
function renderExternos() {
  const todos = [...gastos,...historico].filter(g => g.externo !== 'no');
  const pend  = todos.filter(g => g.externo === 'externo');
  const paid  = todos.filter(g => g.externo === 'pagado');
  document.getElementById('ext-pend-tot').textContent = fmt(pend.reduce((s,g)=>s+g.cantidad,0));
  document.getElementById('ext-paid-tot').textContent = fmt(paid.reduce((s,g)=>s+g.cantidad,0));
  document.getElementById('ext-cnt').textContent = todos.length;
  let list = todos;
  if (extFilter === 'pendiente') list = pend;
  if (extFilter === 'pagado')    list = paid;
  list = list.sort((a,b) => (Number(b.id)||0) - (Number(a.id)||0) || String(b.fecha).localeCompare(String(a.fecha)));
  const el = document.getElementById('externos-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Sin gastos externos en este filtro</div>'; return; }
  el.innerHTML = list.map(g => {
    const iP = g.externo === 'pagado';
    return `<div class="ext-item ${iP?'pagado':''}">
      <div class="ext-item-header">
        <span class="ext-nombre">${getMotivoIcon(g.motivo)||'📋'} ${g.motivo}
          <span style="font-size:10px;color:var(--text2);font-weight:400">· ${g.cuenta}</span>
        </span>
        <span class="ext-monto ${iP?'pagado':''}">${fmt(g.cantidad)}</span>
      </div>
      <div class="ext-meta">${g.fecha}${g.comentarios?' · '+g.comentarios:''} ·
        ${iP?'<strong style="color:var(--green)">Cobrado</strong>':'<strong style="color:var(--orange)">Pendiente de cobro</strong>'}
      </div>
      ${!iP
        ? `<button class="btn-marcar-pagado" onclick="marcarExterno(${g.id},'pagado')">✅ Marcar como cobrado</button>`
        : `<button class="btn-marcar-pend" onclick="marcarExterno(${g.id},'externo')">↩ Marcar como pendiente</button>`}
    </div>`;
  }).join('');
}

function setExtFilter(f) {
  extFilter = f;
  ['todos','pendiente','pagado'].forEach(x => document.getElementById('ef-'+x).classList.toggle('active',x===f));
  renderExternos();
}

async function marcarExterno(id, estado) {
  let g = gastos.find(x=>x.id===id) || historico.find(x=>x.id===id);
  if (g) g.externo = estado;
  saveLocal();
  showToast(estado==='pagado'?'Marcado como cobrado ✓':'Marcado como pendiente');
  renderExternos(); renderMenu();
}

// ── Excepciones de corte ──────────────────────────────────────
// Dado un día de corte y una fecha, devuelve la fecha de corte real
// considerando si existe una excepción para ese período
// ════════════════════════════════════════════════════════════
//  CORTES POR TARJETA — Rediseño robusto
//  Cada gasto lleva un campo "periodoCorte" = "CUENTA|YYYY-MM-DD"
//  (fecha del último día del período) asignado al guardarlo.
//  La vista simplemente agrupa por ese campo, sin recalcular fechas.
// ════════════════════════════════════════════════════════════

// Calcula a qué período pertenece un gasto dado su fecha y cuenta
function calcularPeriodoCorte(cuenta, fechaGasto) {
  const cfg = getCortesConfig()[cuenta];
  if (!cfg) return null; // cuenta sin corte (débito)

  const fecha = new Date(String(fechaGasto).slice(0,10) + 'T12:00:00');
  if (isNaN(fecha.getTime())) return null; // fecha inválida
  const dia   = cfg.dia;

  // El período cierra el día "dia" de cada mes
  // Si el día del gasto <= dia de corte → pertenece al corte de ESTE mes
  // Si el día del gasto >  dia de corte → pertenece al corte del MES SIGUIENTE
  let anio = fecha.getFullYear();
  let mes  = fecha.getMonth(); // 0-11

  if (fecha.getDate() <= dia) {
    // corte es este mes
  } else {
    // corte es el mes siguiente
    mes++;
    if (mes > 11) { mes = 0; anio++; }
  }

  // Verificar excepción
  const corteBase = new Date(anio, mes, dia);
  const fBase = fmtD(corteBase);
  const exc = excepciones.find(e => e.Cuenta === cuenta && e.FechaOriginal === fBase);
  const fechaCorte = exc ? exc.FechaExcepcion : fBase;
  return `${cuenta}|${fechaCorte}`;
}

// Obtiene inicio del período dado su clave "CUENTA|YYYY-MM-DD"
function periodoDesde(clave) {
  const [cuenta, hastaStr] = clave.split('|');
  const cfg = getCortesConfig()[cuenta];
  if (!cfg) return null;
  // El inicio es el día siguiente al corte del mes anterior
  const hasta = new Date(hastaStr + 'T12:00:00');
  const pm    = hasta.getMonth() === 0 ? 11 : hasta.getMonth() - 1;
  const py    = hasta.getMonth() === 0 ? hasta.getFullYear() - 1 : hasta.getFullYear();
  const corteAntBase = fmtD(new Date(py, pm, cfg.dia));
  const exc = excepciones.find(e => e.Cuenta === cuenta && e.FechaOriginal === corteAntBase);
  const corteAnt = exc ? exc.FechaExcepcion : corteAntBase;
  const d = new Date(corteAnt + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return fmtD(d);
}

// Obtiene el período activo actual para una tarjeta
function getPeriodoActualKey(cuenta) {
  return calcularPeriodoCorte(cuenta, today());
}

function gastosEnPeriodo(all, cuenta, desde, hasta) {
  return all.filter(g => {
    if (g.cuenta !== cuenta) return false;
    const fechaStr = String(g.fecha || '').slice(0, 10);
    if (!fechaStr) return false;
    const fd = new Date(fechaStr + 'T12:00:00');
    return fd >= desde && fd <= hasta;
  });
}

function renderCortes() {
  const all = [...gastos, ...historico];
  const hoy = new Date();
  const cfg = getCortesConfig();

  document.getElementById('cortes-list').innerHTML = Object.entries(cfg).map(([cuenta, c]) => {
    const key    = getPeriodoActualKey(cuenta);
    const hasta  = key ? key.split('|')[1] : null;
    const desde  = key ? periodoDesde(key) : null;
    // Usar gastosEnPeriodo que ya maneja fechas correctamente
    const gp = hasta && desde ? gastosEnPeriodo(all, cuenta,
      new Date(desde + 'T00:00:00'),
      new Date(hasta + 'T23:59:59')
    ) : [];
    const total  = gp.reduce((s,g) => s+g.cantidad, 0);
    const diasR  = hasta ? Math.ceil((new Date(hasta+'T12:00:00') - hoy) / 864e5) : 0;
    const vencida = diasR < 0;
    return `<div class="tarjeta-card" onclick="openCorteTarjeta('${cuenta}')" style="${vencida?'border-color:var(--orange)':''}">
      <div class="tarjeta-header">
        <span class="tarjeta-nombre"><span class="dot" style="background:${c.color}"></span>${cuenta}</span>
        <span class="tarjeta-monto">${fmt(total)}</span>
      </div>
      <div class="tarjeta-info">
        Corte día ${c.dia} · ${desde||'—'} → ${hasta||'—'} ·
        <strong style="color:${vencida?'var(--orange)':diasR<=3?'var(--yellow)':'var(--text2)'}">
          ${vencida?'¡Vencido!':diasR===0?'Hoy':diasR+' días'}
        </strong>
      </div>
    </div>`;
  }).join('');
}

function openCorteTarjeta(cuenta) {
  const cfg = getCortesConfig()[cuenta];
  const all = [...gastos,...historico];
  const hoy = new Date();

  // Obtener todos los períodos que tienen gastos para esta tarjeta
  const keysConGastos = [...new Set(
    all.filter(g => g.cuenta === cuenta && g.periodoCorte)
       .map(g => g.periodoCorte)
  )].sort().reverse();

  // Agregar período actual si no está
  const keyActual = getPeriodoActualKey(cuenta);
  if (keyActual && !keysConGastos.includes(keyActual)) keysConGastos.unshift(keyActual);

  // Gastos sin periodoCorte — asignar dinámicamente
  const sinClave = all.filter(g => g.cuenta === cuenta && !g.periodoCorte);
  sinClave.forEach(g => {
    const fechaNorm = String(g.fecha || '').slice(0,10);
    if (!fechaNorm) return;
    const k = calcularPeriodoCorte(cuenta, fechaNorm);
    if (k && !keysConGastos.includes(k)) keysConGastos.push(k);
    g._periodoTemp = k;
  });
  keysConGastos.sort().reverse();

  let periodoIdx = 0;
  const body = document.getElementById('modal-corte-body');

  function render() {
    const key   = keysConGastos[periodoIdx] || keyActual;
    const hasta = key ? key.split('|')[1] : null;
    const desde = key ? periodoDesde(key) : null;
    const esActual = key === keyActual;
    const diasR = hasta ? Math.ceil((new Date(hasta+'T12:00:00') - hoy) / 864e5) : 0;
    const vencida = esActual && diasR < 0;

    const gp = hasta && desde ? gastosEnPeriodo(all, cuenta,
      new Date(desde + 'T00:00:00'),
      new Date(hasta + 'T23:59:59')
    ) : [];
    const total = gp.reduce((s,g) => s+g.cantidad, 0);

    const label = esActual
      ? (vencida ? '⚠️ Período vencido' : `Período activo · ${diasR===0?'Corte hoy':diasR+' días para corte'}`)
      : 'Período anterior';
    const labelColor = esActual && vencida ? 'var(--orange)' : esActual ? 'var(--green)' : 'var(--text2)';

    body.innerHTML = `
      <h2 style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="width:12px;height:12px;border-radius:50%;background:${cfg.color};display:inline-block;flex-shrink:0"></span>${cuenta}
      </h2>
      <div style="font-size:11px;color:${labelColor};font-weight:500;margin-bottom:10px">${label}</div>

      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <button onclick="window._prevP()" ${periodoIdx>=keysConGastos.length-1?'disabled':''} style="padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);font-size:14px;cursor:pointer;color:var(--text)">‹</button>
        <div style="flex:1;text-align:center;font-size:12px;color:var(--text2);font-weight:500">
          ${desde||'—'} → ${hasta||'—'}
        </div>
        <button onclick="window._nextP()" ${periodoIdx===0?'disabled':''} style="padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);font-size:14px;cursor:pointer;color:var(--text)">›</button>
      </div>

      <div style="background:var(--bg3);border-radius:10px;padding:14px;margin-bottom:12px;text-align:center">
        <div style="font-size:11px;color:var(--text2);margin-bottom:3px">Total del período</div>
        <div style="font-size:26px;font-weight:700;color:${total>0?'var(--red)':'var(--text2)'}">${fmt(total)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${gp.length} gasto${gp.length!==1?'s':''}</div>
      </div>

      ${esActual && vencida ? `<button onclick="showToast('Haz el corte semanal desde el Menú')" style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:500;cursor:pointer;margin-bottom:10px">✂️ Ir al corte semanal</button>` : ''}

      <button onclick="window._openExc()" style="width:100%;padding:8px;border-radius:8px;border:1px dashed var(--border2);background:transparent;color:var(--text2);font-size:12px;cursor:pointer;margin-bottom:10px">
        📅 Ajustar fecha de corte por día inhábil
      </button>

      ${gp.length
        ? gp.sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0)||String(b.fecha).localeCompare(String(a.fecha))).map(g=>`
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:16px">${getMotivoIcon(g.motivo)}</span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;color:var(--text)">${g.motivo}</div>
              <div style="font-size:11px;color:var(--text2)">${String(g.fecha).slice(0,10)}${g.comentarios?' · '+g.comentarios:''}</div>
            </div>
            <div style="font-size:14px;font-weight:700;color:var(--text)">${fmt(g.cantidad)}</div>
          </div>`).join('')
        : '<div style="text-align:center;padding:20px;color:var(--text2);font-size:13px">Sin gastos en este período</div>'}

      <div class="modal-actions" style="margin-top:14px">
        <button class="mbtn sec" onclick="closeModal('modal-corte-tarjeta')">Cerrar</button>
      </div>`;
  }

  window._prevP = () => { if (periodoIdx < keysConGastos.length-1) { periodoIdx++; render(); } };
  window._nextP = () => { if (periodoIdx > 0) { periodoIdx--; render(); } };
  window._openExc = () => {
    const key  = keysConGastos[periodoIdx] || keyActual;
    const hasta = key ? key.split('|')[1] : today();
    document.getElementById('exc-cuenta').textContent     = cuenta;
    document.getElementById('exc-fecha-orig').textContent = hasta;
    document.getElementById('exc-fecha-nueva').value      = hasta;
    document.getElementById('exc-nota').value             = '';
    window._excCuenta    = cuenta;
    window._excFechaOrig = hasta;
    openModal('modal-excepcion');
  };

  render();
  openModal('modal-corte-tarjeta');
}


// ── Ahorros ───────────────────────────────────────────────────
const saldoCuenta = c => c.movimientos.reduce((s,m) =>
  (m.tipo==='abono'||m.tipo==='traspaso-in') ? s+m.cantidad : s-m.cantidad, 0);

function renderAhorros() {
  const el = document.getElementById('ahorros-list');
  if (!cuentasAhorro.length) {
    document.getElementById('ahorro-big').textContent = fmt(0);
    document.getElementById('ahorro-grupos-totales').innerHTML = '';
    el.innerHTML = '<div class="empty">Sin cuentas de ahorro.<br>Crea tu primera cuenta.</div>';
    return;
  }

  // Total general: solo cuentas que no están excluidas
  const totGeneral = cuentasAhorro.filter(c=>!c.excluirTotal).reduce((s,c)=>s+saldoCuenta(c),0);
  document.getElementById('ahorro-big').textContent = fmt(totGeneral);

  // Agrupar cuentas por grupo
  const grupos = {};
  cuentasAhorro.forEach(c => {
    const g = c.grupo || 'General';
    if (!grupos[g]) grupos[g] = { cuentas:[], total:0 };
    grupos[g].cuentas.push(c);
    grupos[g].total += saldoCuenta(c);
  });

  // Subtotales: mostrar todos los grupos que no sean "General",
  // y también "General" si alguna cuenta está excluida del total
  const hayExcluidas = cuentasAhorro.some(c=>c.excluirTotal);
  const gruposSubtotal = Object.entries(grupos).filter(([nombre]) =>
    nombre !== 'General' || hayExcluidas
  );
  document.getElementById('ahorro-grupos-totales').innerHTML = gruposSubtotal.map(([nombre, g]) => {
    const esExcluido = g.cuentas.every(c=>c.excluirTotal);
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;color:var(--text2)">${nombre}${esExcluido?' <span style=\"font-size:9px\">(no contabiliza)</span>':''}</span>
      <span style="font-size:13px;font-weight:500;color:${esExcluido?'#64748b':'#7c3aed'}">${fmt(g.total)}</span>
    </div>`;
  }).join('');

  // Renderizar tarjetas agrupadas
  const tieneOtras = cuentasAhorro.length > 1;
  let html = '';
  const multiGrupo = Object.keys(grupos).length > 1;
  Object.entries(grupos).forEach(([nombreGrupo, g]) => {
    if (multiGrupo) {
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin:14px 0 6px">
        <span style="font-size:10px;font-weight:500;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">${nombreGrupo}</span>
        <span class="ahorro-grupo-total" style="font-size:12px;font-weight:500;color:var(--purple)">${fmt(g.total)}</span>
      </div>`;
    }
    g.cuentas.forEach(c => {
      const s   = saldoCuenta(c);
      const pct = c.meta ? Math.min(100, Math.round(s/c.meta*100)) : 0;
      const ult = c.movimientos.slice(-3).reverse();
      const excluida = !!c.excluirTotal;
      html += `<div class="ahorro-card" data-id="${c.id}" draggable="${dragModeActivo}"
        ondragstart="onAhorroDragStart(event,${c.id})" ondragend="onAhorroDragEnd(event)"
        ondragover="onAhorroDragOver(event)" ondragleave="onAhorroDragLeave(event)" ondrop="onAhorroDrop(event,${c.id})"
        ontouchstart="onAhorroTouchStart(event,${c.id})" ontouchmove="onAhorroTouchMove(event)" ontouchend="onAhorroTouchEnd(event,${c.id})"
        style="cursor:${dragModeActivo?'grab':'default'};touch-action:${dragModeActivo?'none':'auto'};user-select:${dragModeActivo?'none':'auto'}">
        <div class="ahorro-header">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="ahorro-nombre">🐷 ${c.nombre}</span>
            ${excluida?'<span style="font-size:9px;background:var(--bg3);color:var(--text2);padding:2px 6px;border-radius:8px">No contabiliza</span>':''}
          </div>
          <span class="ahorro-total" style="color:${excluida?'#64748b':'#7c3aed'}">${fmt(s)}</span>
        </div>
        ${c.meta?`<div class="ahorro-progress"><div class="ahorro-fill" style="width:${pct}%"></div></div>
          <div class="ahorro-meta-row"><span>${pct}% de meta</span><span>Meta: ${fmt(c.meta)}</span></div>`:''}
        ${ult.length?`<div style="margin-top:8px">${ult.map(m=>{
          const label=m.tipo==='traspaso-out'?'→ '+(cuentasAhorro.find(x=>x.id===m.destino)||{nombre:'?'}).nombre
            :m.tipo==='traspaso-in'?'← '+(cuentasAhorro.find(x=>x.id===m.origen)||{nombre:'?'}).nombre
            :(m.nota||'');
          const pos=m.tipo==='abono'||m.tipo==='traspaso-in';
          return `<div class="mov-item">
            <span style="color:var(--text2)">${m.fecha}${label?' · '+label:''}</span>
            <span class="${pos?'mov-pos':'mov-neg'} ahorro-mov-monto">${pos?'+':'-'}${fmt(m.cantidad)}</span>
          </div>`;
        }).join('')}</div>`:''}
        <div class="ahorro-btns">
          <button class="btn-abonar" onclick="openMovAhorro(${c.id},'abono')">+ Abonar</button>
          <button class="btn-retirar" onclick="openMovAhorro(${c.id},'retiro')">− Retirar</button>
          ${tieneOtras?`<button class="btn-retirar" onclick="openTraspaso(${c.id})" style="flex:none;padding:8px 12px;color:var(--green);border-color:var(--green)">⇄</button>`:''}
          <button class="btn-retirar" onclick="verHistorialAhorro(${c.id})" style="flex:none;padding:8px 12px;color:var(--accent2);border-color:var(--accent2)" title="Ver historial">📋</button>
          <button class="btn-retirar" onclick="editarCuentaAhorro(${c.id})" style="flex:none;padding:8px 12px;color:var(--text2)">✏️</button>
          <button class="btn-retirar" onclick="eliminarCuenta(${c.id})" style="flex:none;padding:8px 12px;color:var(--red);border-color:var(--red)">🗑</button>
        </div>
      </div>`;
    });
  });
  el.innerHTML = html;
  // Aplicar visibilidad después de renderizar tarjetas
  aplicarVisibilidadAhorros();
}


function nuevoMov(campos) {
  return { ...campos, movId: nextMovId++ };
}

function verHistorialAhorro(id) {
  const c = cuentasAhorro.find(x => x.id === id);
  if (!c) return;
  const saldoFinal = saldoCuenta(c);

  // Ordenar por movId (orden de creación), calcular saldo acumulado
  const ordenados = [...c.movimientos].sort((a,b) => (a.movId||0) - (b.movId||0));
  let saldoAcum = 0;
  const movsConSaldo = ordenados.map(m => {
    const pos = m.tipo === 'abono' || m.tipo === 'traspaso-in';
    saldoAcum += pos ? m.cantidad : -m.cantidad;
    return { ...m, saldoAcum };
  }).reverse(); // mostrar más reciente primero

  const tipoLabel = m => {
    if (m.tipo === 'abono')       return { label:'Abono',    color:'var(--green)' };
    if (m.tipo === 'retiro')      return { label:'Retiro',   color:'var(--red)' };
    if (m.tipo === 'traspaso-in') return { label:'Entrada',  color:'var(--green)' };
    if (m.tipo === 'traspaso-out')return { label:'Salida',   color:'var(--orange)' };
    return { label: m.tipo, color: 'var(--text2)' };
  };

  document.getElementById('hist-ahorro-titulo').textContent = `📋 ${c.nombre}`;
  document.getElementById('hist-ahorro-saldo').textContent  = `Saldo actual: ${fmt(saldoFinal)}`;
  document.getElementById('hist-ahorro-lista').innerHTML = movsConSaldo.length
    ? movsConSaldo.map(m => {
        const { label, color } = tipoLabel(m);
        const pos = m.tipo === 'abono' || m.tipo === 'traspaso-in';
        const nota = m.nota || m.tipo;
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:${color}">${label}</div>
            <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.fecha}${nota?' · '+nota:''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:14px;font-weight:700;color:${color}">${pos?'+':'-'}${fmt(m.cantidad)}</div>
            <div style="font-size:10px;color:var(--text3)">${fmt(m.saldoAcum)}</div>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Sin movimientos registrados</div>';

  openModal('modal-hist-ahorro');
}

function openMovAhorro(id, tipo) {
  movCuentaId = id; movMode = tipo;
  const c = cuentasAhorro.find(x=>x.id===id);
  document.getElementById('modal-ahorro-title').textContent = (tipo==='abono'?'Abonar a ':'Retirar de ')+c.nombre;
  document.getElementById('modal-ahorro-btn').textContent   = tipo==='abono'?'Abonar':'Retirar';
  document.getElementById('modal-ahorro-btn').className     = 'mbtn '+(tipo==='abono'?'purple':'danger');
  document.getElementById('ahorro-cantidad').value = '';
  document.getElementById('ahorro-nota').value     = '';
  openModal('modal-ahorro');
}

async function confirmarMovAhorro() {
  const cantidad = parseFloat(document.getElementById('ahorro-cantidad').value);
  if (!cantidad||cantidad<=0) { showToast('Ingresa una cantidad válida'); return; }
  const nota = document.getElementById('ahorro-nota').value;
  const c = cuentasAhorro.find(x=>x.id===movCuentaId);
  if (!c) return;
  if (movMode==='retiro' && cantidad>saldoCuenta(c)) { showToast('Saldo insuficiente'); return; }
  c.movimientos.push(nuevoMov({ tipo: movMode, cantidad, nota, fecha: today() }));
  saveLocal();
  closeModal('modal-ahorro');
  showToast(movMode==='abono'?'Abono registrado ✓':'Retiro registrado ✓');
  renderAhorros(); renderMenu();
}

function openTraspaso(origenId) {
  traspasoOrigenId = origenId;
  const origen = cuentasAhorro.find(x=>x.id===origenId);
  const otras  = cuentasAhorro.filter(x=>x.id!==origenId);
  document.getElementById('modal-traspaso-body').innerHTML = `
    <h2 style="margin-bottom:4px">⇄ Traspasar saldo</h2>
    <div style="font-size:12px;color:var(--text2);margin-bottom:12px">
      Desde: <strong style="color:var(--purple)">${origen.nombre}</strong> · Disponible: ${fmt(saldoCuenta(origen))}
    </div>
    <div class="field">
      <label>Cantidad <span class="req">*</span></label>
      <input type="number" id="traspaso-cantidad" placeholder="0.00" step="0.01" min="0" inputmode="decimal"
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);font-size:16px;color:var(--text);font-family:inherit">
    </div>
    <div class="field">
      <label>Destino <span class="req">*</span></label>
      <select id="traspaso-destino" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);font-size:16px;color:var(--text);font-family:inherit">
        ${otras.map(c=>`<option value="${c.id}">${c.nombre} (${fmt(saldoCuenta(c))})</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Nota</label>
      <input type="text" id="traspaso-nota" placeholder="Opcional..."
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);font-size:16px;color:var(--text);font-family:inherit">
    </div>
    <div class="modal-actions">
      <button class="mbtn sec" onclick="closeModal('modal-traspaso')">Cancelar</button>
      <button class="mbtn prim" onclick="confirmarTraspaso()">Traspasar</button>
    </div>`;
  openModal('modal-traspaso');
}

async function confirmarTraspaso() {
  const cantidad   = parseFloat(document.getElementById('traspaso-cantidad').value);
  if (!cantidad||cantidad<=0) { showToast('Ingresa una cantidad válida'); return; }
  const destinoId  = parseInt(document.getElementById('traspaso-destino').value);
  const nota       = document.getElementById('traspaso-nota').value;
  const origen     = cuentasAhorro.find(x=>x.id===traspasoOrigenId);
  const destino    = cuentasAhorro.find(x=>x.id===destinoId);
  if (!origen||!destino) return;
  if (cantidad > saldoCuenta(origen)) { showToast('Saldo insuficiente'); return; }
  const f = today();
  origen.movimientos.push(nuevoMov({ tipo:'traspaso-out', cantidad, nota, destino:destinoId, fecha:f }));
  destino.movimientos.push(nuevoMov({ tipo:'traspaso-in', cantidad, nota, origen:traspasoOrigenId, fecha:f }));
  saveLocal();
  closeModal('modal-traspaso');
  showToast(`Traspasado ${fmt(cantidad)} a ${destino.nombre} ✓`);
  renderAhorros(); renderMenu();
}

let _editAhorroId = null;

function openNuevaCuenta() {
  _editAhorroId = null;
  document.getElementById('nc-modal-title').textContent = 'Nueva cuenta de ahorro';
  document.getElementById('nc-nombre').value        = '';
  document.getElementById('nc-saldo-inicial').value = '';
  document.getElementById('nc-saldo-inicial').disabled = false;
  document.getElementById('nc-meta').value          = '';
  document.getElementById('nc-grupo').value         = '';
  document.getElementById('nc-excluir').checked     = false;
  openModal('modal-nueva-cuenta');
}

function editarCuentaAhorro(id) {
  const c = cuentasAhorro.find(x=>x.id===id);
  if (!c) return;
  _editAhorroId = id;
  document.getElementById('nc-modal-title').textContent = 'Editar cuenta';
  document.getElementById('nc-nombre').value        = c.nombre;
  document.getElementById('nc-saldo-inicial').value = '';
  document.getElementById('nc-saldo-inicial').disabled = true; // no editar saldo inicial
  document.getElementById('nc-meta').value          = c.meta || '';
  document.getElementById('nc-grupo').value         = c.grupo || '';
  document.getElementById('nc-excluir').checked     = !!c.excluirTotal;
  openModal('modal-nueva-cuenta');
}

async function crearCuentaAhorro() {
  const nombre      = document.getElementById('nc-nombre').value.trim();
  if (!nombre) { showToast('Ingresa un nombre'); return; }
  const meta        = parseFloat(document.getElementById('nc-meta').value) || 0;
  const grupo       = document.getElementById('nc-grupo').value.trim() || 'General';
  const excluirTotal = document.getElementById('nc-excluir').checked;

  if (_editAhorroId !== null) {
    // Editar existente
    const c = cuentasAhorro.find(x=>x.id===_editAhorroId);
    if (c) { c.nombre=nombre; c.meta=meta; c.grupo=grupo; c.excluirTotal=excluirTotal; }
    saveLocal();
    closeModal('modal-nueva-cuenta');
    showToast('Cuenta actualizada ✓');
  } else {
    // Crear nueva
    const saldoInicial = parseFloat(document.getElementById('nc-saldo-inicial').value) || 0;
    const movimientos  = saldoInicial > 0
      ? [{ tipo:'abono', cantidad: saldoInicial, nota:'Saldo inicial', fecha: today() }]
      : [];
    const nueva = { id: nextAhorroId++, nombre, meta, grupo, excluirTotal, movimientos };
    cuentasAhorro.push(nueva);
    saveLocal();
    closeModal('modal-nueva-cuenta');
    showToast('Cuenta creada ✓');
  }
  renderAhorros(); renderMenu();
}

async function eliminarCuenta(id) {
  if (!confirm('¿Eliminar esta cuenta de ahorro?')) return;
  cuentasAhorro = cuentasAhorro.filter(x=>x.id!==id);
  saveLocal();
  showToast('Cuenta eliminada');
  renderAhorros(); renderMenu();
}

// ── Histórico ─────────────────────────────────────────────────
function renderHistorico() {
  const el = document.getElementById('historico-list');
  if (!historico.length) {
    el.innerHTML = '<div class="empty">Sin historial aún.<br>Haz tu primer corte semanal.</div>';
    return;
  }
  const bySem = {};
  historico.forEach(g => { if(!bySem[g.semana])bySem[g.semana]=[]; bySem[g.semana].push(g); });
  el.innerHTML = Object.keys(bySem).sort((a,b)=>b.localeCompare(a)).map(sem => {
    const items = bySem[sem].sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0)||String(b.fecha).localeCompare(String(a.fecha)));
    const total = items.filter(g=>!g.ignorar).reduce((s,g)=>s+g.cantidad,0);
    return `<div class="semana-group">
      <div class="semana-header"><span>Semana ${sem}</span><span>${fmt(total)}</span></div>
      ${items.map(g=>`<div class="hist-item" style="${g.ignorar?'opacity:.5':''}">
        <div style="font-size:17px">${getMotivoIcon(g.motivo)||'📋'}</div>
        <div class="hist-info">
          <div class="hist-motivo">${g.motivo}${g.externo!=='no'?` <span style="font-size:9px;color:${g.externo==='pagado'?'#0d9488':'#d97706'}">${g.externo==='pagado'?'✅':'📤'}</span>`:''}</div>
          <div class="hist-meta">${g.cuenta} · ${g.fecha}</div>
        </div>
        <div class="hist-monto" style="${g.ignorar?'text-decoration:line-through':''}">${fmt(g.cantidad)}</div>
      </div>`).join('')}
    </div>`;
  }).join('');
}

// ── Formulario nuevo gasto ────────────────────────────────────
function setAb(v){
  abonado=v;
  document.getElementById('ab-no').className='tog'+(v?'':' sel-no');
  document.getElementById('ab-si').className='tog'+(v?' sel-si':'');
}
function setIg(v){
  ignorar=v;
  document.getElementById('ig-no').className='tog'+(v?'':' sel-no');
  document.getElementById('ig-si').className='tog'+(v?' sel-ig':'');
}
function setExt(v){
  externo=v;
  document.getElementById('ext-no').className    ='tog'+(v==='no'?     ' sel-no':'');
  document.getElementById('ext-ext').className   ='tog'+(v==='externo'?' sel-ext':'');
  document.getElementById('ext-pagado').className='tog'+(v==='pagado'? ' sel-si':'');
}
function setDescAhorro(v){
  descontarAhorro = v;
  document.getElementById('desc-no').className ='tog'+(v?'':' sel-no');
  document.getElementById('desc-si').className ='tog'+(v?' sel-si':'');
  document.getElementById('ahorro-selector-wrap').style.display = v ? 'block' : 'none';
  if (v) refreshAhorroSelector();
}

// Actualiza selector de cuentas de ahorro en el form
function refreshAhorroSelector() {
  const sel = document.getElementById('f-ahorro-cuenta');
  if (!sel) return;
  sel.innerHTML = cuentasAhorro.map(c =>
    `<option value="${c.id}">${c.nombre} (${fmt(saldoCuenta(c))})</option>`
  ).join('');
}

async function guardarGasto() {
  syncBloqueado = true; // bloquear sync durante guardado
  const cantidad = parseFloat(document.getElementById('f-cantidad').value);
  if (!cantidad||cantidad<=0) { syncBloqueado = false; showToast('Ingresa una cantidad válida'); return; }

  // Verificar saldo si se descuenta de ahorro
  let ahorroSelId = null, ahorroSelNombre = '';
  if (descontarAhorro) {
    const sel = document.getElementById('f-ahorro-cuenta');
    ahorroSelId = parseInt(sel.value);
    const ca = cuentasAhorro.find(x=>x.id===ahorroSelId);
    if (!ca) { syncBloqueado = false; showToast('Selecciona una cuenta de ahorro'); return; }
    if (cantidad > saldoCuenta(ca)) { syncBloqueado = false; showToast(`Saldo insuficiente en ${ca.nombre}`); return; }
    ahorroSelNombre = ca.nombre;
  }

  const isEditing = !!editingId;
  const gasto = {
    id:           editingId || nextId++,
    fecha:        document.getElementById('f-fecha')?.value || today(),
    cuenta:       document.getElementById('f-cuenta').value,
    motivo:       document.getElementById('f-motivo').value,
    cantidad,
    comentarios:  document.getElementById('f-comentarios-input').value,
    abonado, ignorar, externo,
    semana:       getWeek(new Date()),
    ahorroDesc:   descontarAhorro ? ahorroSelNombre : '',
    updatedAt:    new Date().toISOString(),
    periodoCorte: calcularPeriodoCorte(document.getElementById('f-cuenta').value, document.getElementById('f-fecha')?.value || today()),
    desdeConciliador: window._desdeConciliador ? true : undefined,
  };

  if (isEditing) {
    const idx = gastos.findIndex(x=>x.id===editingId);
    const gastoAnterior = idx >= 0 ? gastos[idx] : null;

    // Si el gasto anterior tenía descuento de ahorro, revertir ese movimiento
    if (gastoAnterior?.ahorroDesc) {
      const cuentaAnterior = cuentasAhorro.find(c => c.nombre === gastoAnterior.ahorroDesc);
      if (cuentaAnterior) {
        // Buscar por gastoId primero (más confiable), luego por coincidencia de datos
        const movIdx = cuentaAnterior.movimientos.findIndex(m =>
          m.tipo === 'retiro' && (
            m.gastoId === gastoAnterior.id ||
            (m.cantidad === gastoAnterior.cantidad &&
             m.fecha === gastoAnterior.fecha &&
             (m.nota || '').includes(gastoAnterior.motivo))
          )
        );
        if (movIdx !== -1) cuentaAnterior.movimientos.splice(movIdx, 1);
      }
    }
    if (idx >= 0) gastos[idx] = gasto;
  } else {
    gastos.push(gasto);
  }

  // Descontar del ahorro si aplica (nuevo o edición con ahorro)
  if (descontarAhorro && ahorroSelId) {
    const ca = cuentasAhorro.find(x=>x.id===ahorroSelId);
    if (ca) {
      ca.movimientos.push({
        tipo:'retiro', cantidad,
        nota:`Gasto: ${gasto.motivo}`,
        fecha: gasto.fecha,
        gastoId: gasto.id  // guardar referencia al gasto
      });
    }
  }

  // Guardar todo junto
  syncBloqueado = false;
  saveLocal();
  resetForm(); editingId=null; showTab('gastos');
  showToast('Gasto guardado ✓');
}

function resetForm() {
  document.getElementById('f-cantidad').value    = '';
  document.getElementById('f-comentarios-input').value = ''; document.getElementById('comentario-dropdown').style.display='none';
  document.getElementById('f-cuenta').selectedIndex = 0;
  document.getElementById('f-motivo').selectedIndex  = 0;
  const fe = document.getElementById('f-fecha'); if (fe) fe.value = today();
  setAb(false); setIg(false); setExt('no'); setDescAhorro(false);
}
function cancelForm() {
  editingId=null; resetForm();
  showTab(gastos.length?'gastos':'menu');
}

// ── Detalle / Editar / Eliminar ───────────────────────────────
function openDetail(id) {
  const g = gastos.find(x=>x.id===id); if(!g) return;
  const iE=g.externo==='externo', iP=g.externo==='pagado';
  document.getElementById('modal-detail-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <div style="font-size:24px">${getMotivoIcon(g.motivo)||'📋'}</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:500;color:var(--text)">${g.motivo}</div>
        <div style="font-size:12px;color:var(--text2)">${g.cuenta} · ${g.fecha}</div>
      </div>
      <div style="font-size:17px;font-weight:500;color:${iE?'#d97706':iP?'#0d9488':'#1e293b'}">${fmt(g.cantidad)}</div>
    </div>
    ${g.comentarios?`<div style="font-size:12px;color:var(--text2);margin-bottom:9px">📝 ${g.comentarios}</div>`:''}
    ${g.ahorroDesc?`<div style="font-size:12px;color:var(--purple);margin-bottom:9px">🐷 Descontado de: ${g.ahorroDesc}</div>`:''}
    <div class="badges" style="margin-bottom:12px">
      ${g.ignorar?'<span class="badge ignorar">🚫 Ignorado</span>':''}
      ${!g.ignorar && iE?'<span class="badge ext">📤 Externo pendiente de cobro</span>':''}
      ${!g.ignorar && iP?'<span class="badge ext-paid">✅ Externo cobrado</span>':''}
      ${!iE && !iP?`<span class="badge ${g.abonado?'ab':'pend'}">${g.abonado?'✓ Abonado':'✗ Pendiente'}</span>`:''}
    </div>
    ${iE?`<button class="btn-marcar-pagado" onclick="marcarExterno(${g.id},'pagado');closeModal('modal-detail');renderGastos()">✅ Marcar como cobrado</button>`:''}
    ${iP?`<button class="btn-marcar-pend" onclick="marcarExterno(${g.id},'externo');closeModal('modal-detail');renderGastos()">↩ Marcar como pendiente</button>`:''}
    <div class="modal-actions" style="margin-top:${iE||iP?'10px':'0'}">
      <button class="mbtn sec" onclick="closeModal('modal-detail')">Cerrar</button>
      <button class="mbtn danger" onclick="eliminar(${g.id})">Eliminar</button>
      <button class="mbtn prim" onclick="editar(${g.id})">Editar</button>
    </div>`;
  openModal('modal-detail');
}

function editarDirecto(id) {
  const g = gastos.find(x=>x.id===id); if(!g) return;
  editingId=id;
  document.getElementById('f-cuenta').value            = g.cuenta;
  document.getElementById('f-motivo').value             = g.motivo;
  document.getElementById('f-cantidad').value           = g.cantidad;
  document.getElementById('f-comentarios-input').value  = g.comentarios||'';
  const fe = document.getElementById('f-fecha'); if (fe) fe.value = g.fecha || today();
  setAb(g.abonado); setIg(g.ignorar||false); setExt(g.externo||'no');
  // Restaurar estado de descuento de ahorro
  if (g.ahorroDesc) {
    setDescAhorro(true);
    setTimeout(() => {
      const sel = document.getElementById('f-ahorro-cuenta');
      if (sel) {
        const ca = cuentasAhorro.find(c => c.nombre === g.ahorroDesc);
        if (ca) sel.value = ca.id;
      }
    }, 50);
  } else { setDescAhorro(false); }
  showTab('nuevo');
  document.getElementById('topbar-title').textContent = 'Editar Gasto';
}

function editar(id) {
  closeModal('modal-detail');
  const g = gastos.find(x=>x.id===id); if(!g) return;
  editingId=id;
  document.getElementById('f-cuenta').value            = g.cuenta;
  document.getElementById('f-motivo').value             = g.motivo;
  document.getElementById('f-cantidad').value           = g.cantidad;
  document.getElementById('f-comentarios-input').value  = g.comentarios||'';
  const fe = document.getElementById('f-fecha'); if (fe) fe.value = g.fecha || today();
  setAb(g.abonado); setIg(g.ignorar||false); setExt(g.externo||'no');
  // Restaurar estado de descuento de ahorro
  if (g.ahorroDesc) {
    setDescAhorro(true);
    setTimeout(() => {
      const sel = document.getElementById('f-ahorro-cuenta');
      if (sel) {
        const ca = cuentasAhorro.find(c => c.nombre === g.ahorroDesc);
        if (ca) sel.value = ca.id;
      }
    }, 50);
  } else { setDescAhorro(false); }
  showTab('nuevo');
  document.getElementById('topbar-title').textContent = 'Editar Gasto';
}

function eliminar(id) {
  const g = gastos.find(x=>x.id===id);
  if (!g) return;
  // Guardar id para confirmar
  window._eliminarId = id;
  document.getElementById('confirm-eliminar-desc').textContent =
    `${g.motivo} · ${g.cuenta} · ${fmt(g.cantidad)}`;
  closeModal('modal-detail');
  openModal('modal-confirm-eliminar');
}

function confirmarEliminar() {
  const gasto = gastos.find(x => x.id === window._eliminarId);
  // Si el gasto tenía descuento de ahorro, eliminar el movimiento correspondiente
  if (gasto?.ahorroDesc) {
    const cuenta = cuentasAhorro.find(c => c.nombre === gasto.ahorroDesc);
    if (cuenta) {
      // Buscar el movimiento de retiro que coincida en fecha y cantidad
      const idx = cuenta.movimientos.findIndex(m =>
        m.tipo === 'retiro' && (
          m.gastoId === gasto.id ||
          (m.cantidad === gasto.cantidad &&
           m.fecha === gasto.fecha &&
           (m.nota || '').includes(gasto.motivo))
        )
      );
      if (idx !== -1) {
        cuenta.movimientos.splice(idx, 1);
      }
    }
  }
  // Si el gasto corresponde a un recurrente, limpiar ultimoPago
  if (gasto) {
    const rec = recurrentes.find(r => r.nombre === gasto.comentarios || r.nombre === gasto.motivo);
    if (rec) {
      const hoy = new Date();
      const mesKey = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
      if (rec.ultimoPago === mesKey) rec.ultimoPago = null;
    }
  }
  gastos = gastos.filter(x => x.id !== window._eliminarId);
  saveLocal();
  closeModal('modal-confirm-eliminar');
  showToast('Gasto eliminado');
  renderGastos(); renderMenu();
}

// ── Corte semanal ─────────────────────────────────────────────
function openCorte() {
  document.getElementById('corte-count').textContent = gastos.length;
  openModal('modal-corte-sem');
}

async function hacerCorte() {
  if (!gastos.length) { closeModal('modal-corte-sem'); showToast('No hay gastos que cortar'); return; }
  historico = [...gastos, ...historico];
  gastos = [];
  saveLocal();
  closeModal('modal-corte-sem');
  showToast('¡Corte semanal realizado! ✓');
  renderMenu();
}

// ── Exportar Excel ────────────────────────────────────────────
function exportarExcel() {
  if (typeof XLSX==='undefined') { showToast('Cargando...'); return; }
  const wb = XLSX.utils.book_new();
  const hdr = ['ID','Fecha','Cuenta','Motivo','Cantidad','Comentarios','Abonado','Externo','Ignorar','Ahorro','Semana'];
  const cols = [{wch:6},{wch:13},{wch:13},{wch:20},{wch:13},{wch:24},{wch:10},{wch:14},{wch:10},{wch:18},{wch:11}];
  const toR = g => [g.id,g.fecha,g.cuenta,g.motivo,g.cantidad,g.comentarios||'',
    g.abonado?'SI':'NO',g.externo||'no',g.ignorar?'SI':'NO',g.ahorroDesc||'',g.semana];
  const ws1 = XLSX.utils.aoa_to_sheet([hdr,...gastos.map(toR)]);
  ws1['!cols']=cols; XLSX.utils.book_append_sheet(wb,ws1,'Semana Actual');
  const ws2 = XLSX.utils.aoa_to_sheet([hdr,...historico.map(toR)]);
  ws2['!cols']=cols; XLSX.utils.book_append_sheet(wb,ws2,'Historico');
  const ext = [...gastos,...historico].filter(g=>g.externo!=='no');
  const ws3 = XLSX.utils.aoa_to_sheet([
    ['Fecha','Cuenta','Motivo','Cantidad','Comentarios','Estado'],
    ...ext.map(g=>[g.fecha,g.cuenta,g.motivo,g.cantidad,g.comentarios||'',g.externo==='pagado'?'Cobrado':'Pendiente'])
  ]);
  ws3['!cols']=[{wch:13},{wch:13},{wch:20},{wch:13},{wch:24},{wch:12}];
  XLSX.utils.book_append_sheet(wb,ws3,'Externos');
  const aRows=[];
  cuentasAhorro.forEach(c=>{
    c.movimientos.forEach(m=>aRows.push([c.nombre,saldoCuenta(c),c.meta||'',m.tipo,m.cantidad,m.nota||'',m.fecha]));
  });
  const ws4 = XLSX.utils.aoa_to_sheet([['Cuenta','Saldo','Meta','Tipo','Cantidad','Nota','Fecha'],...aRows]);
  ws4['!cols']=[{wch:20},{wch:12},{wch:12},{wch:14},{wch:12},{wch:20},{wch:13}];
  XLSX.utils.book_append_sheet(wb,ws4,'Ahorros');
  XLSX.writeFile(wb,`GastosSemanales_${today()}.xlsx`);
  showToast('Excel descargado ✓');
}

// ── Helpers ───────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}




// ════════════════════════════════════════════════════════════
//  BACKUP — Exportar / Importar / Migrar desde Sheets
// ════════════════════════════════════════════════════════════

// Exportar todo como archivo JSON de backup
function exportarBackup() {
  const data = {
    version: 2, savedAt: new Date().toISOString(), fecha: today(),
    gastos, historico, nextId, nextAhorroId, nextMovId,
    cuentasAhorro, excepciones,
    catalogoCuentas, catalogoMotivos, catalogoComentarios,
    presupuesto: PRESUPUESTO,
    recurrentes, nextRecId, deudas, nextDeudaId
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `gastos_backup_${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup descargado ✓');
}

// Importar backup JSON
function importarBackup() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.gastos && !data.historico) throw new Error('Formato inválido');
      // Guardar datos para confirmar en modal
      window._backupPendiente = data;
      // Mostrar modal de confirmación en vez de confirm()
      const info = `${data.gastos?.length||0} gastos, ${data.historico?.length||0} historial, ${data.cuentasAhorro?.length||0} ahorros`;
      document.getElementById('backup-confirm-info').textContent = info;
      openModal('modal-backup-confirm');
    } catch(e) { showToast('Error al leer el archivo: ' + e.message); }
  };
  input.click();
}

function confirmarRestaurarBackup() {
  const data = window._backupPendiente;
  if (!data) return;
  if (data.gastos)              gastos              = data.gastos.map(normGasto);
  if (data.historico)           historico           = data.historico.map(normGasto);
  if (data.nextId)              nextId              = data.nextId;
  if (data.nextAhorroId)        nextAhorroId        = data.nextAhorroId;
  if (data.excepciones)         excepciones         = data.excepciones       || [];
  if (data.catalogoCuentas)     catalogoCuentas     = data.catalogoCuentas;
  if (data.catalogoMotivos)     catalogoMotivos     = data.catalogoMotivos;
  if (data.catalogoComentarios) catalogoComentarios = data.catalogoComentarios.map(c => typeof c === 'string' ? c : (c.nombre || c.Nombre || '')).filter(Boolean);
  if (data.cuentasAhorro)       cuentasAhorro       = data.cuentasAhorro.map(normAhorro);
  if (data.recurrentes)         recurrentes         = data.recurrentes       || [];
  if (data.nextRecId)           nextRecId           = data.nextRecId         || 1;
  if (data.deudas)              deudas              = data.deudas            || [];
  if (data.nextDeudaId)         nextDeudaId         = data.nextDeudaId       || 1;
  if (data.presupuesto)         PRESUPUESTO         = data.presupuesto;
  saveLocal();
  actualizarSelectCuentas(); actualizarSelectMotivos();
  closeModal('modal-backup-confirm');
  window._backupPendiente = null;
  showTab('menu');
  renderMenu();
  showToast('Backup restaurado ✓');
}

// Exportar backup a Excel (además del JSON)
function exportarBackupExcel() {
  if (typeof XLSX === 'undefined') { showToast('Cargando...'); return; }
  const wb  = XLSX.utils.book_new();
  const hdr = ['ID','Fecha','Cuenta','Motivo','Cantidad','Comentarios','Abonado','Externo','Ignorar','Ahorro','Semana'];
  const toR = g => [g.id,g.fecha,g.cuenta,g.motivo,g.cantidad,g.comentarios||'',
    g.abonado?'SI':'NO',g.externo||'no',g.ignorar?'SI':'NO',g.ahorroDesc||'',g.semana];
  const ws1 = XLSX.utils.aoa_to_sheet([hdr,...gastos.map(toR)]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Semana Actual');
  const ws2 = XLSX.utils.aoa_to_sheet([hdr,...historico.map(toR)]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Historico');
  const aRows = [];
  cuentasAhorro.forEach(c => c.movimientos.forEach(m =>
    aRows.push([c.nombre,saldoCuenta(c),c.meta||'',m.tipo,m.cantidad,m.nota||'',m.fecha])
  ));
  const ws3 = XLSX.utils.aoa_to_sheet([['Cuenta','Saldo','Meta','Tipo','Cantidad','Nota','Fecha'],...aRows]);
  XLSX.utils.book_append_sheet(wb, ws3, 'Ahorros');
  XLSX.writeFile(wb, `GastosSemanales_${today()}.xlsx`);
  showToast('Excel descargado ✓');
}

// Importar desde Google Sheets (migración única)


// ════════════════════════════════════════════════════════════
//  NOTIFICACIONES DE CORTE PRÓXIMO
// ════════════════════════════════════════════════════════════
function verificarCortesProximos() {
  const cfg = getCortesConfig();
  const hoy = new Date();
  const alertas = [];
  Object.entries(cfg).forEach(([cuenta]) => {
    const key  = getPeriodoActualKey(cuenta);
    if (!key) return;
    const hasta = key.split('|')[1];
    if (!hasta) return;
    const dias = Math.ceil((new Date(hasta + 'T12:00:00') - hoy) / 864e5);
    if (dias >= 0 && dias <= 3) {
      alertas.push({ cuenta, dias, hasta });
    }
  });
  if (!alertas.length) return;
  // Mostrar banner en el menú
  const banner = document.getElementById('banner-cortes');
  if (!banner) return;
  banner.innerHTML = alertas.map(a =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;color:var(--text)">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getCuentaColor(a.cuenta)};margin-right:6px"></span>
        ${a.cuenta}
      </span>
      <span style="font-size:12px;font-weight:600;color:${a.dias===0?'var(--red)':'var(--orange)'}">
        ${a.dias===0?'Corte hoy':a.dias===1?'Mañana':a.dias+' días'}
      </span>
    </div>`
  ).join('');
  banner.style.display = 'block';
}

// ── Presupuesto configurable ─────────────────────────────────
function abrirAjustes() {
  document.getElementById('ajuste-presupuesto').value = PRESUPUESTO;
  const wu = document.getElementById('ajuste-worker-url');
  if (wu) wu.value = localStorage.getItem('workerUrl') || '';
  // Supabase
  const sbEnabled = document.getElementById('ajuste-supabase-enabled');
  const ghDisabled = document.getElementById('ajuste-github-disabled');
  const deviceIdEl = document.getElementById('supabase-device-id');
  if (sbEnabled) sbEnabled.checked = usingSupabase();
  if (ghDisabled) ghDisabled.checked = localStorage.getItem('githubDisabled') === '1';
  if (deviceIdEl) deviceIdEl.textContent = getSupabaseDeviceId();
  openModal('modal-ajustes');
}

function guardarAjustes() {
  const val = parseFloat(document.getElementById('ajuste-presupuesto').value);
  if (!val || val <= 0) { showToast('Ingresa un presupuesto válido'); return; }
  PRESUPUESTO = val;
  const wu = document.getElementById('ajuste-worker-url');
  if (wu) {
    const workerVal = wu.value.trim();
    if (workerVal) localStorage.setItem('workerUrl', workerVal);
    else localStorage.removeItem('workerUrl');
  }
  // Supabase
  const sbEnabled = document.getElementById('ajuste-supabase-enabled');
  const ghDisabled = document.getElementById('ajuste-github-disabled');
  if (sbEnabled) {
    if (sbEnabled.checked) localStorage.setItem('supabaseEnabled', '1');
    else localStorage.removeItem('supabaseEnabled');
  }
  if (ghDisabled) {
    if (ghDisabled.checked) localStorage.setItem('githubDisabled', '1');
    else localStorage.removeItem('githubDisabled');
  }
  saveLocal();
  closeModal('modal-ajustes');
  renderMenu();
  showToast('Ajustes guardados ✓');
}


// ════════════════════════════════════════════════════════════
//  RECURRENTES Y DEUDAS
// ════════════════════════════════════════════════════════════

let recTab = 'servicios'; // 'servicios' | 'deudas'

function renderRecurrentes() {
  const btnS = document.getElementById('rtab-servicios');
  const btnD = document.getElementById('rtab-deudas');
  if (btnS) { btnS.style.background = recTab==='servicios'?'var(--accent)':'transparent'; btnS.style.color = recTab==='servicios'?'white':'var(--text2)'; }
  if (btnD) { btnD.style.background = recTab==='deudas'?'var(--accent)':'transparent'; btnD.style.color = recTab==='deudas'?'white':'var(--text2)'; }
  const pS = document.getElementById('rec-panel-servicios');
  const pD = document.getElementById('rec-panel-deudas');
  if (pS) pS.style.display = recTab==='servicios'?'':'none';
  if (pD) pD.style.display = recTab==='deudas'?'':'none';
  if (recTab==='servicios') renderServicios();
  else renderDeudas();
}

function setRecTab(t) { recTab = t; renderRecurrentes(); }

// ── SERVICIOS RECURRENTES ─────────────────────────────────────
function renderServicios() {
  const hoy = new Date();
  const el  = document.getElementById('rec-servicios-list');
  if (!el) return;

  // Verificar cuáles cobran hoy o en los próximos 3 días
  const proximos = recurrentes.filter(r => {
    if (!r.activo) return false;
    if (recurrenteYaPagado(r)) return false; // ya pagado este mes
    const diff = r.dia - hoy.getDate();
    return diff >= 0 && diff <= 3;
  });

  // Banner dentro de la pestaña recurrentes
  const bannerTab = document.getElementById('banner-rec-tab');
  if (bannerTab) {
    if (proximos.length) {
      bannerTab.style.display = 'block';
      bannerTab.innerHTML = '<div style="font-size:10px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px">⚠️ Cobran pronto</div>' +
        proximos.map(r => {
          const diff = r.dia - hoy.getDate();
          return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:12px;color:var(--text)">${r.nombre}</span>
            <span style="font-size:12px;font-weight:600;color:${diff===0?'var(--red)':'var(--orange)'}">${diff===0?'¡Hoy!':diff===1?'Mañana':diff+' días'} · ${fmt(r.cantidad)}</span>
          </div>`;
        }).join('');
    } else {
      bannerTab.style.display = 'none';
    }
  }

  if (!recurrentes.length) {
    el.innerHTML = '<div class="empty">Sin servicios registrados.<br>Agrega Netflix, luz, agua...</div>';
    return;
  }

  el.innerHTML = recurrentes.map((r,i) => {
    const diff = r.dia - hoy.getDate();
    const proxEst = recurrenteYaPagado(r) ? '✅ Pagado este mes' : diff < 0 ? `en ${30+diff} días (próx. mes)` : diff===0 ? '¡Hoy!' : diff===1 ? 'Mañana' : `en ${diff} días`;
    return `<div style="background:var(--bg2);border-radius:14px;border:1px solid var(--border);padding:14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:18px">${getMotivoIcon(r.motivo)}</span>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text)">${r.nombre}</div>
            <div style="font-size:11px;color:var(--text2)">${r.cuenta} · ${r.motivo} · Día ${r.dia} de cada mes</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:15px;font-weight:700;color:var(--text)">${fmt(r.cantidad)}</div>
          <div style="font-size:10px;color:${diff>=0&&diff<=3?'var(--orange)':'var(--text2)'}">${proxEst}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        ${recurrenteYaPagado(r)
          ? `<div style="display:flex;gap:6px;flex:1">
               <div style="flex:1;padding:7px;border-radius:8px;background:rgba(34,211,165,.1);border:1px solid rgba(34,211,165,.3);color:var(--green);font-size:11px;font-weight:600;text-align:center">✅ Pagado este mes</div>
               <button onclick="desmarcarPagado(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:11px;cursor:pointer" title="Desmarcar">↩️</button>
             </div>`
          : `<div style="display:flex;gap:6px;flex:1">
               <button onclick="registrarRecurrente(${i})" style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),#8b5cf6);color:white;font-size:11px;font-weight:600;cursor:pointer">✓ Registrar gasto</button>
               <button onclick="marcarPagadoManual(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid rgba(34,211,165,.3);background:transparent;color:var(--green);font-size:11px;cursor:pointer" title="Marcar como pagado sin registrar gasto">✅</button>
             </div>`
        }
        <button onclick="editarRecurrente(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:11px;cursor:pointer">✏️</button>
        <button onclick="eliminarRecurrente(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid rgba(255,94,122,.3);background:transparent;color:var(--red);font-size:11px;cursor:pointer">🗑</button>
      </div>
    </div>`;
  }).join('');
}


// ── Verificar si recurrente ya fue pagado este mes ────────────
function recurrenteYaPagado(r) {
  const hoy = new Date();
  const mesKey = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  return r.ultimoPago === mesKey;
}

function marcarPagadoManual(i) {
  const r = recurrentes[i];
  if (!r) return;
  const hoy = new Date();
  r.ultimoPago = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  saveLocal();
  renderServicios();
  verificarRecurrentesProximos();
  showToast(`${r.nombre} marcado como pagado ✓`);
}

function desmarcarPagado(i) {
  const r = recurrentes[i];
  if (!r) return;
  r.ultimoPago = null;
  saveLocal();
  renderServicios();
  verificarRecurrentesProximos();
  showToast(`${r.nombre} desmarcado`);
}


function registrarRecurrente(i) {
  const r = recurrentes[i];
  if (!r) return;
  // Marcar como pagado este mes
  const hoy = new Date();
  r.ultimoPago = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  saveLocal();
  // Pre-llenar formulario de nuevo gasto
  showTab('nuevo');
  setTimeout(() => {
    document.getElementById('f-cuenta').value            = r.cuenta;
    document.getElementById('f-motivo').value             = r.motivo;
    document.getElementById('f-cantidad').value           = r.cantidad;
    document.getElementById('f-comentarios-input').value  = r.nombre;
    setAb(false); setIg(false); setExt('no');
  }, 50);
}

function abrirNuevoRecurrente() {
  window._editRecIdx = null;
  document.getElementById('rec-nombre').value    = '';
  // Poblar selects
  const rCta = document.getElementById('rec-cuenta');
  rCta.innerHTML = getCuentas().map(n=>`<option>${n}</option>`).join('');
  rCta.value = getCuentas()[0] || '';
  const rMot = document.getElementById('rec-motivo');
  rMot.innerHTML = catalogoMotivos.map(m=>`<option>${m}</option>`).join('');
  document.getElementById('rec-motivo').value    = catalogoMotivos[0] || '';
  document.getElementById('rec-cantidad').value  = '';
  document.getElementById('rec-dia').value       = '';
  openModal('modal-rec-servicio');
}

function editarRecurrente(i) {
  const r = recurrentes[i];
  window._editRecIdx = i;
  const rCta2 = document.getElementById('rec-cuenta');
  rCta2.innerHTML = getCuentas().map(n=>`<option>${n}</option>`).join('');
  const rMot2 = document.getElementById('rec-motivo');
  rMot2.innerHTML = catalogoMotivos.map(m=>`<option>${m}</option>`).join('');
  document.getElementById('rec-nombre').value    = r.nombre;
  document.getElementById('rec-cuenta').value    = r.cuenta;
  document.getElementById('rec-motivo').value    = r.motivo;
  document.getElementById('rec-cantidad').value  = r.cantidad;
  document.getElementById('rec-dia').value       = r.dia;
  openModal('modal-rec-servicio');
}

function guardarRecurrente() {
  const nombre   = document.getElementById('rec-nombre').value.trim();
  const cuenta   = document.getElementById('rec-cuenta').value;
  const motivo   = document.getElementById('rec-motivo').value;
  const cantidad = parseFloat(document.getElementById('rec-cantidad').value);
  const dia      = parseInt(document.getElementById('rec-dia').value);
  if (!nombre || !cantidad || !dia || dia<1 || dia>31) { showToast('Completa todos los campos'); return; }
  const obj = { id: 0, nombre, cuenta, motivo, cantidad, dia, activo: true };
  if (window._editRecIdx !== null) {
    obj.id = recurrentes[window._editRecIdx].id;
    recurrentes[window._editRecIdx] = obj;
  } else {
    obj.id = nextRecId++;
    recurrentes.push(obj);
  }
  saveLocal();
  closeModal('modal-rec-servicio');
  showToast('Servicio guardado ✓');
  renderServicios();
}

function eliminarRecurrente(i) {
  if (!confirm(`¿Eliminar "${recurrentes[i].nombre}"?`)) return;
  recurrentes.splice(i, 1);
  saveLocal();
  renderServicios();
  showToast('Servicio eliminado');
}

// ── DEUDAS A MESES SIN INTERESES ─────────────────────────────
function renderDeudas() {
  const el = document.getElementById('rec-deudas-list');
  if (!el) return;
  if (!deudas.length) {
    el.innerHTML = '<div class="empty">Sin deudas registradas.<br>Agrega tus compras a meses.</div>';
    return;
  }
  el.innerHTML = deudas.map((d,i) => {
    const pagados  = d.mesesPagados || 0;
    const restante = d.mesesTotal - pagados;
    const saldoPend = restante * d.cuota;
    const pct = Math.round(pagados / d.mesesTotal * 100);
    return `<div style="background:var(--bg2);border-radius:14px;border:1px solid var(--border);padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-size:14px;font-weight:600;color:var(--text)">${d.nombre}</div>
          <div style="font-size:11px;color:var(--text2)">${d.cuenta} · Día ${d.diaCorte} · ${fmt(d.cuota)}/mes</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:15px;font-weight:700;color:var(--red)">${fmt(saldoPend)}</div>
          <div style="font-size:10px;color:var(--text2)">${pagados}/${d.mesesTotal} meses</div>
        </div>
      </div>
      <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px"></div>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">${pct}% pagado · ${restante} ${restante===1?'mes':'meses'} restante${restante===1?'':'s'}</div>
      <div style="display:flex;gap:6px">
        <button onclick="registrarPagoDeuda(${i})" style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),#8b5cf6);color:white;font-size:11px;font-weight:600;cursor:pointer">✓ Registrar pago del mes</button>
        <button onclick="editarDeuda(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:11px;cursor:pointer">✏️</button>
        <button onclick="eliminarDeuda(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid rgba(255,94,122,.3);background:transparent;color:var(--red);font-size:11px;cursor:pointer">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function registrarPagoDeuda(i) {
  const d = deudas[i];
  if (!d) return;
  if (d.mesesPagados >= d.mesesTotal) { showToast('Esta deuda ya está liquidada ✓'); return; }
  // Pre-llenar formulario con la cuota
  showTab('nuevo');
  setTimeout(() => {
    document.getElementById('f-cuenta').value           = d.cuenta;
    document.getElementById('f-motivo').value            = 'Otros';
    document.getElementById('f-cantidad').value          = d.cuota;
    document.getElementById('f-comentarios-input').value = `${d.nombre} (${d.mesesPagados+1}/${d.mesesTotal})`;
    setAb(false); setIg(false); setExt('no');
  }, 50);
  // Incrementar meses pagados
  deudas[i].mesesPagados = (d.mesesPagados || 0) + 1;
  if (deudas[i].mesesPagados >= d.mesesTotal) showToast(`¡${d.nombre} liquidada! 🎉`);
  saveLocal();
}

function abrirNuevaDeuda() {
  window._editDeudaIdx = null;
  ['deuda-nombre','deuda-cuenta','deuda-total','deuda-cuota','deuda-meses','deuda-dia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const dCta = document.getElementById('deuda-cuenta');
  dCta.innerHTML = getCuentas().map(n=>`<option>${n}</option>`).join('');
  dCta.value = getCuentas()[0] || '';
  openModal('modal-deuda');
}

function editarDeuda(i) {
  const d = deudas[i];
  window._editDeudaIdx = i;
  const dCta2 = document.getElementById('deuda-cuenta');
  dCta2.innerHTML = getCuentas().map(n=>`<option>${n}</option>`).join('');
  document.getElementById('deuda-nombre').value  = d.nombre;
  document.getElementById('deuda-cuenta').value  = d.cuenta;
  document.getElementById('deuda-total').value   = d.total;
  document.getElementById('deuda-cuota').value   = d.cuota;
  document.getElementById('deuda-meses').value   = d.mesesTotal;
  document.getElementById('deuda-dia').value     = d.diaCorte;
  openModal('modal-deuda');
}

function calcularCuotaDeuda() {
  const total = parseFloat(document.getElementById('deuda-total').value) || 0;
  const meses = parseInt(document.getElementById('deuda-meses').value)   || 0;
  if (total && meses) document.getElementById('deuda-cuota').value = (total/meses).toFixed(2);
}

function guardarDeuda() {
  const nombre  = document.getElementById('deuda-nombre').value.trim();
  const cuenta  = document.getElementById('deuda-cuenta').value;
  const total   = parseFloat(document.getElementById('deuda-total').value);
  const cuota   = parseFloat(document.getElementById('deuda-cuota').value);
  const meses   = parseInt(document.getElementById('deuda-meses').value);
  const dia     = parseInt(document.getElementById('deuda-dia').value);
  if (!nombre||!total||!cuota||!meses||!dia) { showToast('Completa todos los campos'); return; }
  const obj = { nombre, cuenta, total, cuota, mesesTotal: meses, mesesPagados: 0, diaCorte: dia, fechaInicio: today() };
  if (window._editDeudaIdx !== null) {
    obj.mesesPagados = deudas[window._editDeudaIdx].mesesPagados;
    obj.id = deudas[window._editDeudaIdx].id;
    deudas[window._editDeudaIdx] = obj;
  } else {
    obj.id = nextDeudaId++;
    deudas.push(obj);
  }
  saveLocal();
  closeModal('modal-deuda');
  showToast('Deuda guardada ✓');
  renderDeudas();
}

function eliminarDeuda(i) {
  if (!confirm(`¿Eliminar deuda "${deudas[i].nombre}"?`)) return;
  deudas.splice(i, 1);
  saveLocal();
  renderDeudas();
  showToast('Deuda eliminada');
}

// Verificar deudas y recurrentes próximos (llamado desde renderMenu)
function verificarRecurrentesProximos() {
  const hoy = new Date();
  const alertas = recurrentes.filter(r => r.activo && !recurrenteYaPagado(r) && r.dia >= hoy.getDate() && r.dia - hoy.getDate() <= 3);
  const banner  = document.getElementById('banner-recurrentes');
  if (!banner) return;
  if (alertas.length) {
    banner.style.display = 'block';
    banner.innerHTML = alertas.map(r => {
      const diff = r.dia - hoy.getDate();
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--text)">💳 ${r.nombre}</span>
        <span style="font-size:12px;font-weight:600;color:${diff===0?'var(--red)':'var(--orange)'}">${diff===0?'¡Hoy!':diff+'d'} · ${fmt(r.cantidad)}</span>
      </div>`;
    }).join('');
  } else {
    banner.style.display = 'none';
  }
}


// ── Detección de datos desactualizados ───────────────────────

function mostrarAvisoDesactualizado() {
  const status = document.getElementById('sync-status');
  if (status) {
    status.style.display = 'inline';
    status.textContent = '⚠️ Datos desactualizados';
    status.style.color = 'var(--orange)';
    status.style.cursor = 'pointer';
    status.onclick = () => refreshData();
  }
  // Banner prominente en el menú
  const banner = document.getElementById('banner-desactualizado');
  if (banner) banner.style.display = 'flex';
}

function ocultarAvisoDesactualizado() {
  const banner = document.getElementById('banner-desactualizado');
  if (banner) banner.style.display = 'none';
  const status = document.getElementById('sync-status');
  if (status) status.style.cursor = '';
}


// ── Drag & Drop para reordenar ahorros ───────────────────────
let dragSrcId = null;
let syncBloqueado = false;
let dragModeActivo = false; // bloquea download durante guardar


function toggleDragMode() {
  dragModeActivo = !dragModeActivo;
  renderAhorros();
  // Actualizar botón DESPUÉS de renderAhorros (que no lo toca)
  const btn = document.getElementById('btn-drag-mode');
  if (btn) {
    btn.textContent   = dragModeActivo ? '✅ Reordenando — toca para salir' : '↕️ Reordenar cuentas';
    btn.style.background = dragModeActivo ? 'var(--accent)' : 'var(--bg3)';
    btn.style.color   = dragModeActivo ? 'white' : 'var(--text2)';
    btn.style.border  = dragModeActivo ? 'none' : '1px solid var(--border2)';
  }
}

function onAhorroDragStart(e, id) {
  if (!dragModeActivo) { e.preventDefault(); return; }
  dragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.5';
}

function onAhorroDragEnd(e) {
  e.currentTarget.style.opacity = '1';
}

function onAhorroDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.borderColor = 'var(--accent)';
}

function onAhorroDragLeave(e) {
  e.currentTarget.style.borderColor = '';
}

function onAhorroDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  if (dragSrcId === targetId) return;
  const srcIdx = cuentasAhorro.findIndex(c => c.id === dragSrcId);
  const tgtIdx = cuentasAhorro.findIndex(c => c.id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;
  // Intercambiar posiciones
  const [item] = cuentasAhorro.splice(srcIdx, 1);
  cuentasAhorro.splice(tgtIdx, 0, item);
  saveLocal();
  renderAhorros();
}

// Touch drag para móvil
let touchDragId = null;
let touchClone  = null;

function onAhorroTouchStart(e, id) {
  if (!dragModeActivo) return;
  touchDragId = id;
  const card = e.currentTarget;
  touchClone = card.cloneNode(true);
  touchClone.style.cssText = `position:fixed;opacity:.8;pointer-events:none;z-index:999;width:${card.offsetWidth}px;left:${card.getBoundingClientRect().left}px;top:${card.getBoundingClientRect().top}px;`;
  document.body.appendChild(touchClone);
  card.style.opacity = '0.3';
}

function onAhorroTouchMove(e) {
  if (!touchClone) return;
  e.preventDefault();
  const t = e.touches[0];
  touchClone.style.left = `${t.clientX - touchClone.offsetWidth/2}px`;
  touchClone.style.top  = `${t.clientY - 30}px`;
}

function onAhorroTouchEnd(e, id) {
  if (!touchClone) return;
  const t = e.changedTouches[0];
  touchClone.remove(); touchClone = null;
  document.querySelectorAll('.ahorro-card').forEach(card => card.style.opacity = '1');
  // Encontrar el card sobre el que se soltó
  const el = document.elementFromPoint(t.clientX, t.clientY)?.closest('.ahorro-card');
  if (!el) return;
  const targetId = Number(el.dataset.id);
  if (targetId && targetId !== touchDragId) {
    const srcIdx = cuentasAhorro.findIndex(c => c.id === touchDragId);
    const tgtIdx = cuentasAhorro.findIndex(c => c.id === targetId);
    if (srcIdx !== -1 && tgtIdx !== -1) {
      const [item] = cuentasAhorro.splice(srcIdx, 1);
      cuentasAhorro.splice(tgtIdx, 0, item);
      saveLocal();
      renderAhorros();
    }
  }
  touchDragId = null;
}


// ── Indicador de sync pendiente ───────────────────────────────
function gastoPendienteSync(g) {
  if (!usingGithub() || !g.updatedAt) return false;
  const lastSync = new Date(localStorage.getItem('lastSync')||0).getTime();
  return new Date(g.updatedAt).getTime() > lastSync;
}

// ── Modal de confirmación genérico (reemplaza confirm()) ──────
function modalConfirmar(mensaje, onSi) {
  document.getElementById('modal-confirmar-msg').textContent = mensaje;
  window._confirmarCallback = onSi;
  openModal('modal-confirmar');
}
function _confirmarSi() {
  closeModal('modal-confirmar');
  if (typeof window._confirmarCallback === 'function') window._confirmarCallback();
  window._confirmarCallback = null;
}


// ── Búsqueda global ───────────────────────────────────────────
let searchVisible = false;

function toggleBusquedaGlobal() {
  searchVisible = !searchVisible;
  const wrap = document.getElementById('busqueda-global-wrap');
  if (!wrap) return;
  wrap.style.display = searchVisible ? 'block' : 'none';
  if (searchVisible) {
    const inp = document.getElementById('busqueda-global-input');
    if (inp) { inp.focus(); inp.value = ''; }
    document.getElementById('busqueda-global-results').innerHTML = '';
  }
}

function busquedaGlobal() {
  const q = (document.getElementById('busqueda-global-input').value || '').trim().toLowerCase();
  const el = document.getElementById('busqueda-global-results');
  if (!q || q.length < 2) { el.innerHTML = ''; return; }
  const resultados = [];
  gastos.filter(g =>
    g.motivo.toLowerCase().includes(q) || g.cuenta.toLowerCase().includes(q) ||
    (g.comentarios||'').toLowerCase().includes(q) || String(g.cantidad).includes(q)
  ).forEach(g => resultados.push({ tipo:'Gasto', icon:getMotivoIcon(g.motivo), titulo:g.motivo,
    sub:`${g.cuenta} · ${g.fecha}`, monto:fmt(g.cantidad), color:'var(--text)',
    onClick:`openDetail(${g.id})` }));
  historico.filter(g =>
    g.motivo.toLowerCase().includes(q) || g.cuenta.toLowerCase().includes(q) ||
    (g.comentarios||'').toLowerCase().includes(q) || String(g.cantidad).includes(q)
  ).forEach(g => resultados.push({ tipo:'Historial', icon:getMotivoIcon(g.motivo), titulo:g.motivo,
    sub:`${g.cuenta} · ${g.fecha}`, monto:fmt(g.cantidad), color:'var(--text2)',
    onClick:`showTab('historico')` }));
  cuentasAhorro.filter(c => c.nombre.toLowerCase().includes(q))
    .forEach(c => resultados.push({ tipo:'Ahorro', icon:'🐷', titulo:c.nombre,
      sub:`${c.grupo} · Meta: ${fmt(c.meta||0)}`, monto:fmt(saldoCuenta(c)), color:'var(--purple)',
      onClick:`showTab('ahorros')` }));
  recurrentes.filter(r => r.nombre.toLowerCase().includes(q) || r.cuenta.toLowerCase().includes(q))
    .forEach(r => resultados.push({ tipo:'Recurrente', icon:'🔄', titulo:r.nombre,
      sub:`${r.cuenta} · Día ${r.dia}`, monto:fmt(r.cantidad), color:'var(--accent2)',
      onClick:`showTab('recurrentes')` }));
  if (!resultados.length) {
    el.innerHTML = '<div style="padding:12px;text-align:center;font-size:13px;color:var(--text3)">Sin resultados</div>';
    return;
  }
  el.innerHTML = resultados.slice(0,20).map(r => `
    <div onclick="${r.onClick};toggleBusquedaGlobal()" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);cursor:pointer">
      <span style="font-size:18px">${r.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:${r.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.titulo}</div>
        <div style="font-size:10px;color:var(--text3)">${r.tipo} · ${r.sub}</div>
      </div>
      <div style="font-size:13px;font-weight:700;color:${r.color};flex-shrink:0">${r.monto}</div>
    </div>`).join('');
}


// ── Excepciones de corte ──────────────────────────────────────
function guardarExcepcion() {
  const cuenta    = document.getElementById('exc-cuenta').textContent;
  const fechaNueva = document.getElementById('exc-fecha-nueva').value;
  const nota      = document.getElementById('exc-nota').value.trim();
  if (!fechaNueva) { showToast('Selecciona una fecha'); return; }
  // Remover excepción previa para este período si existe
  const periodoKey = document.getElementById('exc-periodo-key')?.value || '';
  excepciones = excepciones.filter(e => !(e.Cuenta === cuenta && e.FechaOriginal === periodoKey));
  excepciones.push({ Cuenta: cuenta, FechaOriginal: periodoKey, FechaExcepcion: fechaNueva, Nota: nota });
  saveLocal();
  closeModal('modal-excepcion');
  showToast('Excepción guardada ✓');
  renderCortes();
}


function nuevoComentarioCat() {
  document.getElementById('modal-cat-comentario-titulo').textContent = 'Nuevo lugar';
  document.getElementById('input-cat-comentario').value = '';
  window._editComentarioIdx = null;
  openModal('modal-cat-comentario');
}


// ── Conciliación de estado de cuenta ─────────────────────────
let concilCuenta   = '';
let concilPeriodo  = '';
let conciliados    = {}; // { gastoId: true/false }

function abrirConciliacion() {
  closeDrawer();
  // Poblar selector de cuentas con corte
  const cfg = getCortesConfig();
  const sel = document.getElementById('concil-cuenta');
  sel.innerHTML = Object.keys(cfg).map(c => `<option value="${c}">${c}</option>`).join('');
  concilCuenta = sel.value || Object.keys(cfg)[0] || '';
  actualizarPeriodosConcil();
  showTab('conciliacion');
}

function actualizarPeriodosConcil() {
  const cuenta = document.getElementById('concil-cuenta').value;
  concilCuenta = cuenta;
  // Recopilar períodos únicos para esta cuenta
  const all = [...gastos, ...historico];
  const periodos = [...new Set(
    all.filter(g => g.cuenta === cuenta && g.periodoCorte)
       .map(g => g.periodoCorte)
  )].sort((a,b) => b.localeCompare(a)); // más reciente primero

  const selP = document.getElementById('concil-periodo');
  if (!periodos.length) {
    selP.innerHTML = '<option>Sin períodos disponibles</option>';
    document.getElementById('concil-results').innerHTML =
      '<div class="empty">Sin gastos con período de corte para esta cuenta</div>';
    return;
  }
  selP.innerHTML = periodos.map(p => {
    const [, hasta] = p.split('|');
    const [, desde] = [p, periodoDesde(p)];
    return `<option value="${p}">${periodoDesde(p)} → ${hasta}</option>`;
  }).join('');
  concilPeriodo = selP.value;
  // Limpiar resultados de conciliación anterior al cambiar tarjeta/período
  window._bancMovs = [];
  window._noConcilBanco = [];
  window._posiblesMatches = [];
  const st = document.getElementById('concil-pdf-status');
  if (st) st.textContent = '';
  renderConciliacion();
}

function renderConciliacion() {
  const cuenta  = document.getElementById('concil-cuenta')?.value || concilCuenta;
  const periodo = document.getElementById('concil-periodo')?.value || concilPeriodo;
  concilCuenta  = cuenta;
  concilPeriodo = periodo;

  const el = document.getElementById('concil-results');
  if (!el || !periodo) return;

  const [, hasta] = periodo.split('|');
  const desde     = periodoDesde(periodo);
  const all       = [...gastos, ...historico];
  const items     = gastosEnPeriodo(all, cuenta,
    new Date(desde + 'T00:00:00'),
    new Date(hasta + 'T23:59:59')
  ).sort((a,b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id);

  const clave = `${cuenta}|${periodo}`;
  if (!conciliados[clave]) conciliados[clave] = {};
  const conc = conciliados[clave];

  const totalPeriodo  = items.reduce((s,g) => s + g.cantidad, 0);
  const totalConcil   = items.filter(g => conc[g.id]).reduce((s,g) => s + g.cantidad, 0);
  const totalPendiente= totalPeriodo - totalConcil;
  const todosConcil   = items.length > 0 && items.every(g => conc[g.id]);

  // Header de resumen
  el.innerHTML = `
    <div style="background:var(--bg2);border-radius:12px;padding:12px 14px;margin-bottom:14px;border:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:11px;color:var(--text2)">Total período</span>
        <span style="font-size:14px;font-weight:700;color:var(--text)">${fmt(totalPeriodo)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:11px;color:var(--text2)">Conciliado</span>
        <span style="font-size:14px;font-weight:700;color:var(--green)">${fmt(totalConcil)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:11px;color:var(--text2)">Pendiente</span>
        <span style="font-size:14px;font-weight:700;color:${totalPendiente>0?'var(--orange)':'var(--green)'}">${fmt(totalPendiente)}</span>
      </div>
      <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${totalPeriodo>0?Math.round(totalConcil/totalPeriodo*100):0}%;background:var(--green);border-radius:3px;transition:width .3s"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button onclick="conciliarTodos()" style="flex:1;padding:7px;border-radius:8px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);font-size:12px;cursor:pointer">
          ${todosConcil ? '☐ Desmarcar todos' : '☑ Marcar todos'}
        </button>
      </div>
    </div>
    <div id="concil-lista">
      ${!items.length
        ? '<div class="empty">Sin gastos en este período</div>'
        : items.map(g => {
            const ok = !!conc[g.id];
            return `<div onclick="toggleConcil(${g.id})" style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid ${ok?'rgba(34,211,165,.3)':'var(--border)'};background:${ok?'rgba(34,211,165,.06)':'var(--bg2)'};margin-bottom:8px;cursor:pointer;transition:all .2s">
              <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${ok?'var(--green)':'var(--border2)'};background:${ok?'var(--green)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s">
                ${ok?'<span style="color:white;font-size:12px;font-weight:700">✓</span>':''}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:${ok?'var(--green)':'var(--text)'}">${g.motivo}${g.comentarios?' · '+g.comentarios:''}</div>
                <div style="font-size:11px;color:var(--text3)">${g.fecha}${g.ignorar?' · Ignorado':''}</div>
              </div>
              <div style="font-size:14px;font-weight:700;color:${ok?'var(--green)':'var(--text)'};flex-shrink:0">${fmt(g.cantidad)}</div>
            </div>`;
          }).join('')
      }
    </div>
    ${(window._posiblesMatches || []).length ? `
      <div style="background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.3);border-radius:12px;padding:12px 14px;margin-top:14px">
        <div style="font-size:11px;font-weight:700;color:#ca8a04;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">🔍 Posible coincidencia — mismo monto, fecha diferente</div>
        ${(window._posiblesMatches || []).map((p, i) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="display:flex;gap:8px;align-items:flex-start">
                <span style="font-size:10px;color:var(--text3);min-width:16px;padding-top:2px">${i+1}.</span>
                <div>
                  <div style="font-size:11px;color:#ca8a04;font-weight:600">Banco: ${p.banco.descripcion}</div>
                  <div style="font-size:10px;color:var(--text3)">${p.banco.fecha}</div>
                  <div style="font-size:11px;color:var(--text2);margin-top:3px">App: ${p.gasto.motivo}${p.gasto.comentarios?' · '+p.gasto.comentarios:''}</div>
                  <div style="font-size:10px;color:var(--text3)">${p.gasto.fecha} · diferencia ${Math.round(Math.abs(new Date(p.banco.fecha)-new Date(p.gasto.fecha))/86400000)} días</div>
                </div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:13px;font-weight:700;color:#ca8a04">${fmt(p.banco.monto)}</div>
                <button onclick="conciliarPosible(${p.gasto.id})" style="margin-top:4px;font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid #ca8a04;background:transparent;color:#ca8a04;cursor:pointer">Conciliar</button>
              </div>
            </div>
          </div>`).join('')}
      </div>` : ''}
    ${(window._noConcilBanco || []).length ? `
      <div style="background:rgba(255,94,122,.08);border:1px solid rgba(255,94,122,.25);border-radius:12px;padding:12px 14px;margin-top:14px">
        <div style="font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">⚠️ En banco pero no registrados en app</div>
        ${(window._noConcilBanco || []).map((m, i) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="display:flex;align-items:flex-start;gap:8px">
                <span style="font-size:10px;color:var(--text3);min-width:16px;padding-top:2px">${i + 1}.</span>
                <div>
                  <div style="font-size:12px;font-weight:500;color:var(--text)">${m.descripcion}</div>
                  <div style="font-size:10px;color:var(--text3)">${m.fecha}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                <span style="font-size:13px;font-weight:700;color:var(--red)">${fmt(m.monto)}</span>
                <button onclick="registrarDesdeBanco(window._noConcilBanco[${i}])" style="font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid var(--red);background:transparent;color:var(--red);cursor:pointer;white-space:nowrap">+ Registrar</button>
              </div>
            </div>
          </div>`).join('')}
      </div>` : ''}
    `;
}

// ── Estadísticas ────────────────────────────────────────────
let _statTab = 'semanas';

function abrirEstadisticas() {
  _statTab = 'semanas';
  document.querySelectorAll('.stat-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('stab-semanas')?.classList.add('active');
  renderStatTab();
  openModal('modal-estadisticas');
}

function setStatTab(tab) {
  _statTab = tab;
  document.querySelectorAll('.stat-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('stab-' + tab)?.classList.add('active');
  renderStatTab();
}

function renderStatTab() {
  const el = document.getElementById('stat-content');
  if (!el) return;
  const all = [...gastos, ...historico].filter(g => !g.ignorar && !g.externo);
  switch (_statTab) {
    case 'semanas':    el.innerHTML = renderStatSemanas(all); break;
    case 'meses':      el.innerHTML = renderStatMeses(all); break;
    case 'categorias': el.innerHTML = renderStatCategorias(all); break;
    case 'tarjetas':   el.innerHTML = renderStatTarjetas(all); break;
    case 'top':        el.innerHTML = renderStatTop(all); break;
  }
}

function barChart(items, colorFn) {
  // items: [{label, value}]
  const max = Math.max(...items.map(i => i.value), 1);
  return `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
    ${items.map(it => `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:2px">
          <span style="max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.label}</span>
          <span style="font-weight:600;color:var(--text)">${fmt(it.value)}</span>
        </div>
        <div style="height:8px;background:var(--bg3);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${(it.value/max*100).toFixed(1)}%;background:${colorFn ? colorFn(it) : 'var(--accent)'};border-radius:4px;transition:width .3s"></div>
        </div>
      </div>`).join('')}
  </div>`;
}

function renderStatSemanas(all) {
  // Agrupar por semana (YYYY-Www)
  const map = {};
  all.forEach(g => {
    const d = new Date(g.fecha + 'T12:00:00');
    const wk = `${d.getFullYear()}-S${String(getWeek(d)).padStart(2,'0')}`;
    map[wk] = (map[wk] || 0) + g.cantidad;
  });
  const items = Object.entries(map).sort((a,b) => a[0].localeCompare(b[0])).slice(-12)
    .map(([label, value]) => ({ label, value }));
  if (!items.length) return '<div class="empty">Sin datos</div>';
  const total = items.reduce((s,i) => s+i.value, 0);
  const prom  = total / items.length;
  return `<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:100px;background:var(--bg2);border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:11px;color:var(--text3)">Promedio/semana</div>
      <div style="font-size:16px;font-weight:700;color:var(--accent2)">${fmt(prom)}</div>
    </div>
    <div style="flex:1;min-width:100px;background:var(--bg2);border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:11px;color:var(--text3)">Total (${items.length} sem)</div>
      <div style="font-size:16px;font-weight:700;color:var(--text)">${fmt(total)}</div>
    </div>
  </div>
  ${barChart(items.slice(-8), it => it.value > prom*1.2 ? 'var(--red)' : 'var(--accent)')}`;
}

function renderStatMeses(all) {
  const map = {};
  all.forEach(g => {
    const k = g.fecha.slice(0, 7); // YYYY-MM
    map[k] = (map[k] || 0) + g.cantidad;
  });
  const items = Object.entries(map).sort((a,b) => a[0].localeCompare(b[0])).slice(-12)
    .map(([k, value]) => {
      const [y, m] = k.split('-');
      const meses = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      return { label: `${meses[+m]} ${y}`, value };
    });
  if (!items.length) return '<div class="empty">Sin datos</div>';
  const total = items.reduce((s,i) => s+i.value, 0);
  const prom  = total / items.length;
  const max   = Math.max(...items.map(i => i.value));
  const maxItem = items.find(i => i.value === max);
  return `<div style="display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:100px;background:var(--bg2);border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:11px;color:var(--text3)">Promedio/mes</div>
      <div style="font-size:16px;font-weight:700;color:var(--accent2)">${fmt(prom)}</div>
    </div>
    <div style="flex:1;min-width:100px;background:var(--bg2);border-radius:10px;padding:10px;text-align:center">
      <div style="font-size:11px;color:var(--text3)">Mes más alto</div>
      <div style="font-size:16px;font-weight:700;color:var(--red)">${maxItem?.label}</div>
    </div>
  </div>
  ${barChart(items, it => it.value > prom*1.2 ? 'var(--red)' : 'var(--accent)')}`;
}

function renderStatCategorias(all) {
  const map = {};
  all.forEach(g => { map[g.motivo] = (map[g.motivo] || 0) + g.cantidad; });
  const items = Object.entries(map).sort((a,b) => b[1]-a[1])
    .map(([label, value]) => ({ label, value }));
  if (!items.length) return '<div class="empty">Sin datos</div>';
  const total = items.reduce((s,i) => s+i.value, 0);
  const colors = ['var(--accent)','var(--accent2)','var(--green)','var(--orange)','var(--red)','#06b6d4','#a78bfa','#f472b6'];
  return `<div style="margin-bottom:12px;font-size:12px;color:var(--text3)">Total: ${fmt(total)}</div>
    ${barChart(items, (it, i) => colors[items.indexOf(it) % colors.length])}`;
}

function renderStatTarjetas(all) {
  const map = {};
  all.forEach(g => { map[g.cuenta] = (map[g.cuenta] || 0) + g.cantidad; });
  const items = Object.entries(map).sort((a,b) => b[1]-a[1])
    .map(([label, value]) => ({ label, value }));
  if (!items.length) return '<div class="empty">Sin datos</div>';
  const total = items.reduce((s,i) => s+i.value, 0);
  const colors = ['var(--accent)','var(--accent2)','var(--green)','var(--orange)','var(--red)','#06b6d4'];
  return `<div style="margin-bottom:12px;font-size:12px;color:var(--text3)">Total acumulado: ${fmt(total)}</div>
    ${barChart(items, (it) => colors[items.indexOf(it) % colors.length])}
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:6px">
      ${items.map(it => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text2)">${it.label}</span>
        <span style="color:var(--text3)">${(it.value/total*100).toFixed(1)}%</span>
      </div>`).join('')}
    </div>`;
}

function renderStatTop(all) {
  const top = [...all].sort((a,b) => b.cantidad-a.cantidad).slice(0, 15);
  if (!top.length) return '<div class="empty">Sin datos</div>';
  return `<div style="display:flex;flex-direction:column;gap:0">
    ${top.map((g,i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:13px;color:var(--text3);min-width:20px">${i+1}.</span>
        <div>
          <div style="font-size:13px;font-weight:500;color:var(--text)">${g.motivo}${g.comentarios?' · <span style="color:var(--text3);font-weight:400">'+g.comentarios+'</span>':''}</div>
          <div style="font-size:10px;color:var(--text3)">${g.fecha} · ${g.cuenta}</div>
        </div>
      </div>
      <span style="font-size:13px;font-weight:700;color:var(--red);flex-shrink:0">${fmt(g.cantidad)}</span>
    </div>`).join('')}
  </div>`;
}

function registrarDesdeBanco(mv) {
  // Pre-llenar formulario con los datos del movimiento bancario
  window._desdeConciliador = mv; // marcar origen
  showTab('nuevo');
  setTimeout(() => {
    const fCantidad = document.getElementById('f-cantidad');
    const fFecha    = document.getElementById('f-fecha');
    const fComent   = document.getElementById('f-comentarios-input');
    const fCuenta   = document.getElementById('f-cuenta');
    if (fCantidad) fCantidad.value = mv.monto;
    if (fFecha && mv.fecha) fFecha.value = mv.fecha;
    if (fComent) fComent.value = mv.descripcion || '';
    if (fCuenta && concilCuenta) {
      const opt = Array.from(fCuenta.options).find(o => o.value === concilCuenta);
      if (opt) fCuenta.value = concilCuenta;
    }
    showToast('Completa el motivo y guarda el gasto ✓');
  }, 150);
}

function toggleConcil(gastoId) {
  const clave = `${concilCuenta}|${concilPeriodo}`;
  if (!conciliados[clave]) conciliados[clave] = {};
  conciliados[clave][gastoId] = !conciliados[clave][gastoId];
  renderConciliacion();
}

function mostrarSubirImagenes() {
  document.getElementById('concil-img-input').click();
}

async function procesarImagenesConciliacion(event) {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  const status = document.getElementById('concil-pdf-status');

  const workerUrl = localStorage.getItem('workerUrl') || '';
  if (!workerUrl) {
    status.textContent = '❌ Configura el Worker en Ajustes para procesar imágenes.';
    event.target.value = ''; return;
  }

  status.textContent = `📷 Leyendo ${files.length} imagen(es)...`;

  try {
    const imagenes = await Promise.all(files.map(f => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res({ base64: r.result.split(',')[1], tipo: f.type });
      r.onerror = rej;
      r.readAsDataURL(f);
    })));

    const clave = `${concilCuenta}|${concilPeriodo}`;
    const [, hasta] = concilPeriodo.split('|');
    const desde = periodoDesde(concilPeriodo);
    const all = [...gastos, ...historico];
    const items = gastosEnPeriodo(all, concilCuenta,
      new Date(desde + 'T00:00:00'), new Date(hasta + 'T23:59:59'));

    status.textContent = '🤖 Analizando imágenes con IA...';

    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagenes,
        gastos: items.map(g => ({ id: g.id, fecha: g.fecha, motivo: g.motivo, comentarios: g.comentarios, cantidad: g.cantidad })),
        cuenta: concilCuenta,
        periodo: concilPeriodo,
        modo: 'imagen'
      })
    });

    if (!response.ok) throw new Error(`Worker error ${response.status}`);
    const resultado = await response.json();
    if (resultado.error) throw new Error(resultado.error);

    if (!conciliados[clave]) conciliados[clave] = {};
    (resultado.conciliados || []).forEach(id => { conciliados[clave][id] = true; });
    (resultado.no_conciliados_app || []).forEach(id => { conciliados[clave][id] = false; });

    window._bancMovs = resultado.movimientos_banco || [];

    // Calcular posibles matches y no conciliados
    const gastosSinConciliar = items.filter(g => !conciliados[clave][g.id]);
    window._posiblesMatches = [];
    window._noConcilBanco = (resultado.no_conciliados_banco || []).filter(mv => {
      const posible = gastosSinConciliar.find(g => Math.abs(g.cantidad - mv.monto) < 1);
      if (posible) { window._posiblesMatches.push({ banco: mv, gasto: posible }); return false; }
      return true;
    });

    const concilCount = (resultado.conciliados || []).length;
    status.textContent = `✅ ${concilCount} de ${items.length} gastos conciliados · ${window._noConcilBanco.length} cargos sin registrar`;
    renderConciliacion();

  } catch(e) {
    status.textContent = `❌ Error: ${e.message}`;
  }
  event.target.value = '';
}

function conciliarPosible(gastoId) {
  const clave = `${concilCuenta}|${concilPeriodo}`;
  if (!conciliados[clave]) conciliados[clave] = {};
  conciliados[clave][gastoId] = true;
  // Mover de posibles a conciliados
  window._posiblesMatches = (window._posiblesMatches || []).filter(p => p.gasto.id !== gastoId);
  renderConciliacion();
}

function conciliarTodos() {
  const clave = `${concilCuenta}|${concilPeriodo}`;
  if (!conciliados[clave]) conciliados[clave] = {};
  const [, hasta] = concilPeriodo.split('|');
  const desde = periodoDesde(concilPeriodo);
  const all = [...gastos, ...historico];
  const items = gastosEnPeriodo(all, concilCuenta,
    new Date(desde + 'T00:00:00'),
    new Date(hasta + 'T23:59:59')
  );
  const todosConcil = items.every(g => conciliados[clave][g.id]);
  items.forEach(g => { conciliados[clave][g.id] = !todosConcil; });
  renderConciliacion();
}


// ── Conciliación automática con PDF ──────────────────────────

function subirEstadoCuenta() {
  document.getElementById('concil-pdf-input').click();
}

async function procesarEstadoCuenta(event) {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.getElementById('concil-pdf-status');
  status.style.display = 'block';
  status.textContent = '📄 Leyendo PDF...';

  try {
    // Convertir PDF a base64
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(new Error('Error al leer el archivo'));
      r.readAsDataURL(file);
    });

    // Extraer texto del PDF
    status.textContent = '📄 Extrayendo texto del PDF...';
    const pdfText = await extraerTextoPDF(base64);
    if (!pdfText || pdfText.length < 50) {
      status.innerHTML = '📷 Este PDF no tiene texto extraíble. <a href="#" onclick="mostrarSubirImagenes();return false" style="color:var(--accent2);text-decoration:underline">Subir imágenes de los movimientos</a>';
      event.target.value = '';
      return;
    }

    // Detectar encoding corrupto (HSBC usa Xenos D2eVision con caracteres ilegibles)
    const charRaros = (pdfText.match(/[^ -À-ÿÀ-ɏ -~]/g) || []).length;
    const ratioCorrupto = charRaros / pdfText.length;
    if (ratioCorrupto > 0.15) {
      status.innerHTML = '📷 Este PDF tiene codificación no estándar (HSBC). <a href="#" onclick="mostrarSubirImagenes();return false" style="color:var(--accent2);text-decoration:underline">Subir imágenes de los movimientos</a>';
      event.target.value = '';
      return;
    }

    // Obtener gastos del período actual
    const clave = `${concilCuenta}|${concilPeriodo}`;
    const [, hasta] = concilPeriodo.split('|');
    const desde = periodoDesde(concilPeriodo);
    const all = [...gastos, ...historico];
    const items = gastosEnPeriodo(all, concilCuenta,
      new Date(desde + 'T00:00:00'),
      new Date(hasta + 'T23:59:59')
    );

    // Parser específico por banco
    const parsedForPrompt = parsearEstadoCuentaBanco(pdfText, concilCuenta);
    console.log('[Parser] cuenta:', concilCuenta, 'banco:', parsedForPrompt?.banco, 'movimientos:', parsedForPrompt?.movimientos?.length);
    if (parsedForPrompt && parsedForPrompt.movimientos.length > 0) {
      const nombresB = {
        amex: 'American Express', bbva: 'BBVA', banamex: 'Banamex',
        banorte: 'Banorte', hsbc: 'HSBC', santander: 'Santander', mercadolibre: 'Mercado Libre'
      };
      status.textContent = `🏦 ${nombresB[parsedForPrompt.banco]} — ${parsedForPrompt.movimientos.length} movimientos extraídos`;
      window._bancoDetectado = parsedForPrompt.banco;
      window._bancMovs = parsedForPrompt.movimientos;
    }

    // Construir prompt
    const movsParsedStr = (parsedForPrompt && parsedForPrompt.movimientos.length > 0)
      ? `\nMOVIMIENTOS DEL BANCO (parser ${parsedForPrompt.banco.toUpperCase()}):\n` +
        parsedForPrompt.movimientos.map(mv => `- ${mv.fecha} | ${mv.descripcion} | $${mv.monto}`).join('\n')
      : `\nESTADO DE CUENTA (texto PDF):\n${pdfText.slice(0, 6000)}`;

    const prompt = `Eres un asistente de conciliación bancaria.${movsParsedStr}

Mis gastos registrados para el período ${desde} al ${hasta} en cuenta ${concilCuenta} son:
${items.map(g => `- ID:${g.id} | ${g.fecha} | ${g.motivo}${g.comentarios?' - '+g.comentarios:''} | $${g.cantidad}`).join('\n')}

Devuelve SOLO un JSON con este formato exacto:
{
  "movimientos_banco": [{ "fecha": "YYYY-MM-DD", "descripcion": "...", "monto": 123.45 }],
  "conciliados": [id1, id2],
  "no_conciliados_banco": [{ "fecha": "YYYY-MM-DD", "descripcion": "...", "monto": 123.45 }],
  "no_conciliados_app": [id3],
  "resumen": "breve resumen"
}
Criterios: monto exacto o diferencia <$1, fecha ±3 días.`;

    // Llamar al Worker de Cloudflare
    const workerUrl = localStorage.getItem('workerUrl') || '';
    if (!workerUrl) {
      mostrarTextoPDFParaConciliar(pdfText, items);
      return;
    }

    const movsBanco = parsedForPrompt?.movimientos || [];
    const tieneParseo = movsBanco.length > 0;

    if (tieneParseo) {
      // ── Matching local sin IA ──────────────────────────────────
      // Conciliar por monto (±$1) y fecha (±3 días)
      if (!conciliados[clave]) conciliados[clave] = {};
      const bancoConciliados = new Set();

      items.forEach(g => {
        const match = movsBanco.find((mv, idx) =>
          !bancoConciliados.has(idx) &&
          Math.abs(g.cantidad - mv.monto) < 1 &&
          Math.abs(new Date(g.fecha) - new Date(mv.fecha)) <= 3 * 86400000
        );
        if (match) {
          conciliados[clave][g.id] = true;
          bancoConciliados.add(movsBanco.indexOf(match));
        }
      });

      window._bancMovs = movsBanco;
      const noConcilBanco = movsBanco.filter((mv, idx) => !bancoConciliados.has(idx));

      // Detectar posibles matches: monto coincide (±$1) pero fecha fuera de rango
      const gastosSinConciliar = items.filter(g => !conciliados[clave][g.id]);
      window._posiblesMatches = [];
      window._noConcilBanco = noConcilBanco.filter(mv => {
        const posible = gastosSinConciliar.find(g => Math.abs(g.cantidad - mv.monto) < 1);
        if (posible) {
          window._posiblesMatches.push({ banco: mv, gasto: posible });
          return false; // no va a "no encontrados", va a "posibles"
        }
        return true;
      });

      const concilCount = Object.values(conciliados[clave]).filter(Boolean).length;
      status.textContent = `✅ ${concilCount} de ${items.length} gastos conciliados · ${window._noConcilBanco.length} cargos sin registrar`;
      renderConciliacion();
      if (window._noConcilBanco.length) showToast(`⚠️ ${window._noConcilBanco.length} cargo(s) del banco no encontrados en la app`);
      return;
    }

    // ── Sin parser: usar IA via Worker ────────────────────────────
    status.textContent = '🤖 Conciliando con IA...';
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdfText: pdfText.slice(0, 8000),
        gastos: items.map(g => ({ id: g.id, fecha: g.fecha, motivo: g.motivo, comentarios: g.comentarios, cantidad: g.cantidad })),
        cuenta: concilCuenta,
        periodo: concilPeriodo
      })
    });

    if (!response.ok) {
      const errTxt = await response.text().catch(() => '');
      throw new Error(`Worker error ${response.status}: ${errTxt.slice(0, 200)}`);
    }
    const resultado = await response.json();
    if (resultado.error) throw new Error(resultado.error);

    if (!conciliados[clave]) conciliados[clave] = {};
    (resultado.conciliados || []).forEach(id => { conciliados[clave][id] = true; });
    (resultado.no_conciliados_app || []).forEach(id => { conciliados[clave][id] = false; });

    window._bancMovs = resultado.movimientos_banco || [];
    window._noConcilBanco = resultado.no_conciliados_banco || [];

    const concilCount = (resultado.conciliados || []).length;
    status.textContent = `✅ ${concilCount} de ${items.length} gastos conciliados automáticamente`;
    if (resultado.resumen) status.textContent += ` · ${resultado.resumen}`;
    renderConciliacion();
    if (window._noConcilBanco?.length) showToast(`⚠️ ${window._noConcilBanco.length} cargo(s) del banco no encontrados en la app`);

  } catch(e) {
    status.textContent = `❌ Error: ${e.message}`;
    showToast('Error al procesar el PDF');
  }

  // Limpiar input para permitir subir el mismo archivo de nuevo
  event.target.value = '';
}


// ── Parsers específicos por banco ─────────────────────────────

/**
 * Detecta el banco a partir del texto extraído del PDF.
 * Retorna: 'amex' | 'bbva' | 'banamex' | 'banorte' | 'hsbc' | 'santander' | 'mercadolibre' | null
 */
function detectarBanco(texto, cuentaExplicita) {
  // Fuente primaria: nombre de la cuenta seleccionada en el conciliador
  const nombreCuenta = (cuentaExplicita || concilCuenta || '').toLowerCase();
  const mapaCuentas = {
    'banamex':     'banamex',  // antes de 'amex' para evitar falso match
    'banorte':     'banorte',
    'bbva':        'bbva',
    'amex':        'amex',
    'hsbc':        'hsbc',
    'santander':   'santander',
    'mercadopago': 'mercadolibre',
    'mercado pago':'mercadolibre',
  };
  for (const [clave, banco] of Object.entries(mapaCuentas)) {
    if (nombreCuenta.includes(clave)) return banco;
  }
  // Fallback: detectar por keywords en el texto del PDF
  const t = texto.toLowerCase();
  if (t.includes('american express') || t.includes('americanexpress.com.mx')) return 'amex';
  if (t.includes('bbva mexico') || t.includes('bbva.mx') || t.includes('grupo financiero bbva')) return 'bbva';
  if (t.includes('banamex') || t.includes('costco banamex') || t.includes('citibanamex')) return 'banamex';
  if (t.includes('banorte') || t.includes('banortel') || t.includes('grupo financiero banorte')) return 'banorte';
  if (t.includes('hsbc') || t.includes('hsbc mexico') || t.includes('hsbc.com.mx')) return 'hsbc';
  if (t.includes('santander') || t.includes('banco santander') || t.includes('likeu')) return 'santander';
  if (t.includes('mercado libre') || t.includes('mercadopago') || t.includes('mercado pago 1')) return 'mercadolibre';
  return null;
}

/**
 * Convierte nombre de mes en español a número (0-11).
 */
function mesEsToNum(mes) {
  const meses = {
    'enero':0,'febrero':1,'marzo':2,'abril':3,'mayo':4,'junio':5,
    'julio':6,'agosto':7,'septiembre':8,'octubre':9,'noviembre':10,'diciembre':11,
    'ene':0,'feb':1,'mar':2,'abr':3,'may':4,'jun':5,
    'jul':6,'ago':7,'sep':8,'oct':9,'nov':10,'dic':11
  };
  return meses[mes.toLowerCase()] ?? null;
}

/**
 * Parsea número con formato mexicano: "1,234.56" → 1234.56
 */
function parseMonto(str) {
  return parseFloat(str.replace(/,/g, '')) || 0;
}

/**
 * Extrae año del texto del PDF (para inferir año en fechas sin año explícito).
 */
function inferirAnio(texto) {
  const m = texto.match(/20(2[3-9]|[3-9]\d)/);
  return m ? parseInt(m[0]) : new Date().getFullYear();
}

/**
 * Parser American Express — funciona con texto plano (PDF.js).
 *
 * Amex tiene dos formatos según la página:
 * - Página principal titular: fechas agrupadas, descripciones agrupadas, montos al final (columnas)
 * - Páginas adicionales/tarjetahabiente: fecha-descripción-monto secuencial
 *
 * Estrategia: extraer sección de movimientos, detectar bloques de "N fechas seguidas → N montos"
 * y secciones secuenciales, unirlos en orden.
 */
function parsearAmex(texto) {
  const anio = inferirAnio(texto);
  const movimientos = [];
  const lineas = texto.split('\n');

  // Pasada 1: formato layout (una línea por transacción con espacios)
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const match = linea.match(/^\s*(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(.+?)\s{3,}([\d,]+\.\d{2})\s*$/i);
    if (!match) continue;
    const [, dia, mes, desc, montoStr] = match;
    const sigLinea = (lineas[i + 1] || '').trim();
    if (sigLinea === 'CR') continue;
    if (/^(Total|MONTO A DIFERIR|MESES EN AUTOMÁTICO|Crédito por redención|REVERSION|SERVICIO)/i.test(desc.trim())) continue;
    const numMes = mesEsToNum(mes);
    if (numMes === null) continue;
    movimientos.push({
      fecha: new Date(anio, numMes, parseInt(dia)).toISOString().slice(0, 10),
      descripcion: desc.trim().replace(/\s{2,}/g, ' '),
      monto: parseMonto(montoStr)
    });
  }
  if (movimientos.length > 0) return movimientos;

  // Pasada 2: texto plano — procesar línea por línea con state machine
  // Estado: cuando vemos "DD de Mes" abrimos una transacción,
  // recolectamos descripción, y cerramos cuando encontramos un monto suelto.
  // Para el bloque de página 2 donde las fechas están agrupadas y los montos al final,
  // usamos una estrategia diferente: detectar bloques de N fechas consecutivas seguidas de N montos.

  const FECHA_RX = /^(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)$/i;
  const MONTO_SOLO_RX = /^([\d,]+\.\d{2})$/;
  const SKIP_LINE = /^(Total de|MONTO A DIFERIR|MESES EN AUTOMÁTICO|Crédito por redención|REVERSION|SERVICIO DE FACTURACION|Dólar U\.S\.A\.|Importe en MN|Fecha y Detalle|Estado de Cuenta|Número de Cuenta|Tarjetahabiente|Fecha Siguiente|de Corte|Paga desde|Recuerda|En Canales|Desde la Web|Paga con|El pago|Para mayor|Este no es|RFC[A-Z0-9]{10,}|Página \d)/i;

  // Marcar índices de fechas y montos
  const fechaIdxs = [];
  const montoIdxs = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (FECHA_RX.test(l)) fechaIdxs.push(i);
    if (MONTO_SOLO_RX.test(l)) montoIdxs.push(i);
  }

  // Detectar si hay un bloque de fechas consecutivas (página 2 de Amex)
  // Un bloque es: N líneas de fecha con índices contiguos (diferencia ≤2 entre ellas)
  let i = 0;
  while (i < fechaIdxs.length) {
    // Buscar inicio de bloque de fechas consecutivas
    let bloqueEnd = i;
    while (bloqueEnd + 1 < fechaIdxs.length && fechaIdxs[bloqueEnd + 1] - fechaIdxs[bloqueEnd] <= 3) {
      bloqueEnd++;
    }
    const bloqueFechas = fechaIdxs.slice(i, bloqueEnd + 1);

    if (bloqueFechas.length >= 2) {
      // Bloque de fechas agrupadas — los montos están al final, después de las descripciones
      // Buscar el bloque de montos que sigue después del último índice del bloque de fechas
      const despuesDeFechas = fechaIdxs[bloqueEnd];
      // Los montos del bloque son los que aparecen después de las descripciones
      // Hay que encontrar N montos consecutivos después del bloque de descripciones
      // Buscamos el primer grupo de montos consecutivos después del bloque
      let mStart = -1;
      for (let m = 0; m < montoIdxs.length; m++) {
        if (montoIdxs[m] > despuesDeFechas + 5) { // al menos 5 líneas después
          // Verificar que son consecutivos
          let count = 1;
          while (m + count < montoIdxs.length && montoIdxs[m + count] - montoIdxs[m + count - 1] <= 2) count++;
          if (count >= bloqueFechas.length) { mStart = m; break; }
        }
      }

      if (mStart >= 0) {
        // Tenemos N fechas y N montos, unirlos en orden (saltando CR)
        let mIdx = mStart;
        for (let f = 0; f < bloqueFechas.length; f++) {
          // Buscar siguiente monto que no sea CR
          while (mIdx < montoIdxs.length) {
            const sigLinea = (lineas[montoIdxs[mIdx] + 1] || '').trim();
            if (sigLinea !== 'CR') break;
            mIdx++; // saltar monto CR
          }
          if (mIdx >= montoIdxs.length) break;

          const fIdx = bloqueFechas[f];
          const fm = lineas[fIdx].trim().match(FECHA_RX);
          if (!fm) { mIdx++; continue; }

          // Descripción: líneas entre esta fecha y la siguiente fecha del bloque (o fin de bloque)
          const nextFIdx = f + 1 < bloqueFechas.length ? bloqueFechas[f + 1] : montoIdxs[mStart];
          const descLineas = [];
          for (let d = fIdx + 1; d < nextFIdx; d++) {
            const dl = lineas[d].trim();
            if (!dl || SKIP_LINE.test(dl) || FECHA_RX.test(dl) || MONTO_SOLO_RX.test(dl) || /^\d+\.\d{2}\s+TC:/.test(dl)) continue;
            descLineas.push(dl);
          }
          const desc = descLineas.slice(0, 2).join(' ').trim();
          const numMes = mesEsToNum(fm[2]);
          if (numMes === null || !desc) { mIdx++; continue; }

          movimientos.push({
            fecha: new Date(anio, numMes, parseInt(fm[1])).toISOString().slice(0, 10),
            descripcion: desc.replace(/\s{2,}/g, ' '),
            monto: parseMonto(lineas[montoIdxs[mIdx]].trim())
          });
          mIdx++;
        }
        i = bloqueEnd + 1;
        continue;
      }
    }

    // Fecha sola (secuencial): fecha → descripción → monto
    const fIdx = fechaIdxs[i];
    const fm = lineas[fIdx].trim().match(FECHA_RX);
    if (fm) {
      // Buscar el primer monto después de esta fecha
      const nextFechaIdx = i + 1 < fechaIdxs.length ? fechaIdxs[i + 1] : lineas.length;
      const montoEvt = montoIdxs.find(m => m > fIdx && m < nextFechaIdx);
      if (montoEvt) {
        const sigLinea = (lineas[montoEvt + 1] || '').trim();
        if (sigLinea !== 'CR') {
          const descLineas = [];
          for (let d = fIdx + 1; d < montoEvt; d++) {
            const dl = lineas[d].trim();
            if (!dl || SKIP_LINE.test(dl) || /^\d+\.\d{2}\s+TC:/.test(dl)) continue;
            descLineas.push(dl);
          }
          const desc = descLineas.slice(0, 2).join(' ').trim();
          const numMes = mesEsToNum(fm[2]);
          if (desc && numMes !== null && !SKIP_LINE.test(desc)) {
            movimientos.push({
              fecha: new Date(anio, numMes, parseInt(fm[1])).toISOString().slice(0, 10),
              descripcion: desc.replace(/\s{2,}/g, ' '),
              monto: parseMonto(lineas[montoEvt].trim())
            });
          }
        }
      }
    }
    i++;
  }

  // Eliminar duplicados por fecha+monto
  const vistos = new Set();
  return movimientos.filter(m => {
    const key = m.fecha + '|' + m.monto;
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });
}
function parsearBBVA(texto) {
  const movimientos = [];
  // BBVA: "DD-mmm-AAAA  DD-mmm-AAAA  Descripcion  + / -  $1,234.56"
  const regex = /(\d{2})-([a-záéíóú]{3,4})-(\d{4})\s+(\d{2})-[a-záéíóú]{3,4}-\d{4}\s+(.+?)\s+[+\-]\s+\$?([\d,]+\.\d{2})/gi;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const [, dia, mes, anio, , desc, montoStr] = m;
    if (/ABONO|PAGO|SU ABONO/i.test(desc)) continue;
    const numMes = mesEsToNum(mes);
    if (numMes === null) continue;
    const fecha = new Date(parseInt(anio), numMes, parseInt(dia));
    movimientos.push({
      fecha: fecha.toISOString().slice(0, 10),
      descripcion: desc.trim().replace(/\s+/g, ' '),
      monto: parseMonto(montoStr)
    });
  }
  // Fallback: formato simple "DD-mes-AAAA  Descripcion  $1,234.56"
  if (movimientos.length === 0) {
    const rx2 = /(\d{2})-([a-záéíóú]{3,4})-(\d{4})\s+(.+?)\s+\+\s+\$?([\d,]+\.\d{2})/gi;
    while ((m = rx2.exec(texto)) !== null) {
      const [, dia, mes, anio, desc, montoStr] = m;
      const numMes = mesEsToNum(mes);
      if (numMes === null) continue;
      const fecha = new Date(parseInt(anio), numMes, parseInt(dia));
      movimientos.push({
        fecha: fecha.toISOString().slice(0, 10),
        descripcion: desc.trim().replace(/\s+/g, ' '),
        monto: parseMonto(montoStr)
      });
    }
  }
  return movimientos;
}

/**
 * Parser Banamex (Citibanamex).
 * Soporta texto con layout y texto plano (PDF.js).
 * En texto plano: bloques de fechas, luego descripciones, luego signos, luego montos.
 * En texto layout: "DD-mmm-AAAA  DD-mmm-AAAA  Desc  +  $1,234.00"
 */
function parsearBanamex(texto) {
  const movimientos = [];

  // Pasada 1: texto con layout
  const rxLayout = /(\d{2})-([a-z]{3})-(\d{4})\s+\d{2}-[a-z]{3}-\d{4}\s+(.+?)\s+\+\s+\$\s*([\d,]+\.\d{2})/gi;
  let m;
  while ((m = rxLayout.exec(texto)) !== null) {
    const [, dia, mes, anio, desc, montoStr] = m;
    if (/^(Total cargos|Total abonos)/i.test(desc.trim())) continue;
    const numMes = mesEsToNum(mes);
    if (numMes === null) continue;
    movimientos.push({
      fecha: new Date(parseInt(anio), numMes, parseInt(dia)).toISOString().slice(0, 10),
      descripcion: desc.trim().replace(/\s{2,}/g, ' '),
      monto: parseMonto(montoStr)
    });
  }
  if (movimientos.length > 0) return movimientos;

  // Pasada 2: texto plano — procesar cada sección CARGOS, ABONOS por separado
  // Cada sección tiene: bloque fechas | bloque descs | bloque signos | bloque montos
  const lineas = texto.split('\n');
  const FECHA_RX = /^(\d{2})-([a-z]{3})-(\d{4})$/i;
  const MONTO_RX = /^\$?(\d[\d,]*\.\d{2})$/;
  const SIGNO_RX = /^[\+\-]$/;
  const SKIP = /^(Total cargos|Total abonos|Fecha de la|operación|Fecha|de cargo|Descripción del movimiento|Monto|CARGOS, ABONOS|COMPRAS Y CARGOS|DESGLOSE|Número de tarjeta|Notas|Página \d|NA|SU ABONO)/i;

  // Encontrar índices de inicio de cada sección
  const seccionIdxs = [];
  for (let i = 0; i < lineas.length; i++) {
    if (/CARGOS, ABONOS Y COMPRAS REGULARES/i.test(lineas[i])) seccionIdxs.push(i);
  }
  if (seccionIdxs.length === 0) return movimientos;

  // Procesar cada sección
  seccionIdxs.forEach((secStart, si) => {
    const secEnd = si + 1 < seccionIdxs.length ? seccionIdxs[si + 1] : lineas.length;
    const secLineas = lineas.slice(secStart, secEnd);

    // Recolectar fechas, montos y signos dentro de esta sección
    const fechas = [], montos = [], signos = [], descs = [];
    let enFechas = false, enDescs = false, enSignos = false, enMontos = false;
    let fechasVistas = 0;

    for (let i = 0; i < secLineas.length; i++) {
      const l = secLineas[i].trim();
      if (!l || SKIP.test(l)) continue;
      if (FECHA_RX.test(l)) { fechas.push(l); fechasVistas++; enFechas = true; continue; }
      // Después de las fechas vienen las descripciones
      if (fechasVistas > 0 && !MONTO_RX.test(l) && !SIGNO_RX.test(l)) { descs.push(l); continue; }
      if (SIGNO_RX.test(l)) { signos.push(l); continue; }
      if (MONTO_RX.test(l)) { montos.push(l); continue; }
    }

    if (fechas.length === 0 || montos.length === 0) return;

    // Agrupar descripciones: 2 líneas por transacción (nombre + referencia)
    // Pero si hay más descs que fechas*2, ajustar
    const descsPorTx = Math.max(1, Math.min(2, Math.round(descs.length / fechas.length)));

    let mIdx = 0;
    for (let f = 0; f < fechas.length; f++) {
      // Saltear si el signo es negativo (abono)
      if (signos[f] === '-') { mIdx++; continue; }
      if (mIdx >= montos.length) break;

      const fm = fechas[f].match(FECHA_RX);
      if (!fm) { mIdx++; continue; }
      const numMes = mesEsToNum(fm[2]);
      if (numMes === null) { mIdx++; continue; }

      const descLineas = descs.slice(f * descsPorTx, f * descsPorTx + descsPorTx);
      const desc = descLineas.join(' ').trim();
      if (!desc) { mIdx++; continue; }

      const montoStr = montos[mIdx].replace('$', '');
      const monto = parseMonto(montoStr);
      if (monto <= 0) { mIdx++; continue; }

      movimientos.push({
        fecha: new Date(parseInt(fm[3]), numMes, parseInt(fm[1])).toISOString().slice(0, 10),
        descripcion: desc.replace(/\s{2,}/g, ' '),
        monto
      });
      mIdx++;
    }
  });

  // Deduplicar por fecha+monto
  const vistos = new Set();
  return movimientos.filter(mv => {
    const k = mv.fecha + '|' + mv.monto;
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}
function parsearBanorte(texto) {
  const movimientos = [];
  const regex = /(\d{2})-([A-Z]{3})-(\d{4})\s+\d{2}-[A-Z]{3}-\d{4}\s+(.+?)\s+\+\$?([\d,]+\.\d{2})/g;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const [, dia, mes, anio, desc, montoStr] = m;
    if (/ABONO|PAGO/i.test(desc)) continue;
    const numMes = mesEsToNum(mes);
    if (numMes === null) continue;
    const fecha = new Date(parseInt(anio), numMes, parseInt(dia));
    movimientos.push({
      fecha: fecha.toISOString().slice(0, 10),
      descripcion: desc.trim().replace(/\s+/g, ' '),
      monto: parseMonto(montoStr)
    });
  }
  return movimientos;
}

/**
 * Parser HSBC.
 * Texto extraído con PDF.js (no con pdftotext directamente ya que tiene encoding raro).
 * Formato en DESGLOSE: "DD-Mes-AAAA  DD-Mes-AAAA  Descripcion  + $1,234.00"
 */
function parsearHSBC(texto) {
  const movimientos = [];
  // Intenta el formato estándar de HSBC con visual
  const regex = /(\d{2})-([A-Za-záéíóú]{3,4})-(\d{4})\s+\d{2}-[A-Za-záéíóú]{3,4}-\d{4}\s+(.+?)\s+\+\s*\$?([\d,]+\.\d{2})/g;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const [, dia, mes, anio, desc, montoStr] = m;
    if (/ABONO|PAGO|SPEI/i.test(desc)) continue;
    const numMes = mesEsToNum(mes);
    if (numMes === null) continue;
    const fecha = new Date(parseInt(anio), numMes, parseInt(dia));
    movimientos.push({
      fecha: fecha.toISOString().slice(0, 10),
      descripcion: desc.trim().replace(/\s+/g, ' '),
      monto: parseMonto(montoStr)
    });
  }
  // Fallback para texto de imagen: buscar "MAG", "APPLE", etc. con monto
  if (movimientos.length === 0) {
    const rx2 = /(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2})-[A-Za-z]{3}-\d{4}\s+(.+?)\s+\$\+?\s*([\d,]+\.\d{2})/g;
    while ((m = rx2.exec(texto)) !== null) {
      const [, dia, mes, anio, , desc, montoStr] = m;
      const numMes = mesEsToNum(mes);
      if (numMes === null) continue;
      const fecha = new Date(parseInt(anio), numMes, parseInt(dia));
      movimientos.push({
        fecha: fecha.toISOString().slice(0, 10),
        descripcion: desc.trim().replace(/\s+/g, ' '),
        monto: parseMonto(montoStr)
      });
    }
  }
  return movimientos;
}

/**
 * Parser Santander.
 * Formato: "DD-Mar-AAAA  DD-Mar-AAAA  Descripcion  +  $ 1,234.00"
 * o "DD-Mar-AAAA  DD-Mar-AAAA  Descripcion LOLA850607FT3  +  $ 644.00"
 */
function parsearSantander(texto) {
  const movimientos = [];

  // Pasada 1: layout — "DD-Mar-AAAA  DD-Mar-AAAA  Desc Ref  +  $ 644.00"
  const rxLayout = /(\d{2})-([A-Za-z]{3})-(\d{4})\s+\d{2}-[A-Za-z]{3}-\d{4}\s+(.+?)\s+\+\s+\$\s*([\d,]+\.\d{2})/g;
  let m;
  while ((m = rxLayout.exec(texto)) !== null) {
    const [, dia, mes, anio, desc, montoStr] = m;
    if (/^(PAGO POR TRANSFERENCIA|SU ABONO|Total de cargos|Total de abonos)/i.test(desc.trim())) continue;
    const numMes = mesEsToNum(mes);
    if (numMes === null) continue;
    movimientos.push({
      fecha: new Date(parseInt(anio), numMes, parseInt(dia)).toISOString().slice(0, 10),
      descripcion: desc.trim().replace(/\s{2,}/g, ' '),
      monto: parseMonto(montoStr)
    });
  }
  if (movimientos.length > 0) return movimientos;

  // Pasada 2: texto plano — misma estructura de columnas que Banamex
  const lineas = texto.split('\n');
  const FECHA_RX = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/;
  const MONTO_RX = /^\$?\s*(\d[\d,]*\.\d{2})$/;
  const SIGNO_RX = /^[\+\-]$/;
  const SKIP = /^(Total de cargos|Total de abonos|Fecha de la|operación|Fecha de|cargo|Descripción del movimiento|Monto|CARGOS, ABONOS|DESGLOSE|Número de cuenta|Notas|Página|ATENCIÓN|Tarjeta titular|COMPRAS Y CARGOS)/i;

  const secStart = lineas.findIndex(l => /CARGOS, ABONOS Y COMPRAS REGULARES/i.test(l));
  const secEnd = lineas.findIndex(l => /ATENCIÓN DE QUEJAS/i.test(l));
  if (secStart === -1) return movimientos;

  const region = lineas.slice(secStart, secEnd > 0 ? secEnd : lineas.length);
  const fechas = [], signos = [], montos = [], descs = [];
  for (const l of region) {
    const t = l.trim();
    if (!t || SKIP.test(t)) continue;
    if (FECHA_RX.test(t)) { fechas.push(t); continue; }
    if (SIGNO_RX.test(t)) { signos.push(t); continue; }
    if (MONTO_RX.test(t)) { montos.push(t); continue; }
    if (fechas.length > 0 && signos.length === 0 && montos.length === 0) descs.push(t);
  }

  const fechasOp = fechas.filter((_, i) => i % 2 === 0);
  if (fechasOp.length === 0 || montos.length === 0) return movimientos;

  const descsPorTx = Math.max(1, Math.min(2, Math.round(descs.length / fechasOp.length)));
  let mIdx = 0;
  for (let f = 0; f < fechasOp.length; f++) {
    if (signos[f] === '-') { mIdx++; continue; }
    if (mIdx >= montos.length) break;
    const fm = fechasOp[f].match(FECHA_RX);
    if (!fm) continue;
    const numMes = mesEsToNum(fm[2]);
    if (numMes === null) continue;
    const descLineas = descs.slice(f * descsPorTx, f * descsPorTx + descsPorTx);
    const desc = descLineas.join(' ').trim();
    if (!desc || /^(PAGO POR TRANSFERENCIA|SU ABONO)/i.test(desc)) { mIdx++; continue; }
    const montoStr = montos[mIdx].replace(/\$|\s/g, '');
    const monto = parseMonto(montoStr);
    if (monto <= 0) { mIdx++; continue; }
    movimientos.push({
      fecha: new Date(parseInt(fm[3]), numMes, parseInt(fm[1])).toISOString().slice(0, 10),
      descripcion: desc.replace(/\s{2,}/g, ' '),
      monto
    });
    mIdx++;
  }

  const vistos = new Set();
  return movimientos.filter(mv => {
    const k = mv.fecha + '|' + mv.monto;
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}

/**
 * Parser Mercado Libre / Mercado Pago.
 * Formato en sección "Movimientos": "DD/MM Compra en DESCRIPCION  $ 1,234.56"
 */
function parsearMercadoLibre(texto) {
  const movimientos = [];
  const anio = inferirAnio(texto);
  const regex = /(\d{2})\/(\d{2})\s+Compra en\s+(.+?)\s+\$\s*([\d,]+\.\d{2})/gi;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const [, dia, mes, desc, montoStr] = m;
    const fecha = new Date(anio, parseInt(mes) - 1, parseInt(dia));
    movimientos.push({
      fecha: fecha.toISOString().slice(0, 10),
      descripcion: desc.trim().replace(/\s+/g, ' '),
      monto: parseMonto(montoStr)
    });
  }
  return movimientos;
}

/**
 * Punto de entrada principal: detecta banco y llama al parser correcto.
 * Retorna array de { fecha, descripcion, monto } o null si no detectó banco.
 */
function parsearEstadoCuentaBanco(texto, cuentaExplicita) {
  const banco = detectarBanco(texto, cuentaExplicita);
  if (!banco) return null;
  
  let movimientos = [];
  switch (banco) {
    case 'amex':         movimientos = parsearAmex(texto); break;
    case 'bbva':         movimientos = parsearBBVA(texto); break;
    case 'banamex':      movimientos = parsearBanamex(texto); break;
    case 'banorte':      movimientos = parsearBanorte(texto); break;
    case 'hsbc':         movimientos = parsearHSBC(texto); break;
    case 'santander':    movimientos = parsearSantander(texto); break;
    case 'mercadolibre': movimientos = parsearMercadoLibre(texto); break;
  }
  
  return { banco, movimientos };
}

// ── Extraer texto de PDF (usando PDF.js si disponible) ────────
async function extraerTextoPDF(base64) {
  try {
    if (!window.pdfjsLib) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const pdfData = atob(base64);
    const bytes = new Uint8Array(pdfData.length);
    for (let i = 0; i < pdfData.length; i++) bytes[i] = pdfData.charCodeAt(i);
    const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
    let text = '';

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });

      // Agrupar items por línea usando coordenada Y (tolerancia de 3px)
      const lineasMap = new Map();
      for (const item of content.items) {
        if (!item.str.trim()) continue;
        const y = Math.round(item.transform[5]); // Y en espacio de página
        // Buscar línea existente con Y cercana
        let lineaKey = null;
        for (const [k] of lineasMap) {
          if (Math.abs(k - y) <= 3) { lineaKey = k; break; }
        }
        if (lineaKey === null) { lineaKey = y; lineasMap.set(y, []); }
        lineasMap.get(lineaKey).push({ x: item.transform[4], str: item.str });
      }

      // Ordenar líneas por Y descendente (PDF tiene Y=0 abajo, texto va de arriba a abajo)
      const lineasOrdenadas = [...lineasMap.entries()]
        .sort((a, b) => b[0] - a[0]); // Y mayor = parte superior

      for (const [, items] of lineasOrdenadas) {
        // Ordenar items dentro de la línea por X
        items.sort((a, b) => a.x - b.x);
        // Construir línea con espaciado proporcional
        let linea = '';
        let prevX = items[0].x;
        for (const item of items) {
          // Insertar espacios según la distancia horizontal
          const espacios = Math.max(1, Math.round((item.x - prevX) / 5));
          if (linea) linea += ' '.repeat(espacios);
          linea += item.str;
          prevX = item.x + item.str.length * 5; // estimado
        }
        text += linea + '\n';
      }
      text += '\f'; // separador de página
    }
    return text;
  } catch(e) {
    console.warn('PDF.js error:', e);
    return null;
  }
}

// ── Conciliación asistida sin IA ─────────────────────────────
function mostrarTextoPDFParaConciliar(pdfText, items) {
  // Extraer líneas con montos del texto del PDF
  const lineas = pdfText.split('\n').filter(l => l.trim());
  const montoRegex = /\$?([\d,]+\.\d{2})/g;

  // Mapear cada línea con su monto
  const lineasConMonto = [];
  lineas.forEach(linea => {
    const montos = [];
    let m;
    const rx = /\$?([\d,]+\.\d{2})/g;
    while ((m = rx.exec(linea)) !== null) {
      const val = parseFloat(m[1].replace(/,/g,''));
      if (val > 0 && val < 1000000) montos.push(val);
    }
    if (montos.length) {
      lineasConMonto.push({ texto: linea.trim(), montos });
    }
  });

  // Marcar automáticamente los gastos cuyo monto aparece en el PDF
  const clave = `${concilCuenta}|${concilPeriodo}`;
  if (!conciliados[clave]) conciliados[clave] = {};
  let conciliados_count = 0;
  const montosUsados = new Set();

  items.forEach(g => {
    const lineaMatch = lineasConMonto.find(l =>
      l.montos.some(m => Math.abs(m - g.cantidad) < 1)
    );
    const encontrado = !!lineaMatch;
    conciliados[clave][g.id] = encontrado;
    if (encontrado) {
      conciliados_count++;
      // Marcar este monto como usado
      lineaMatch.montos.forEach(m => {
        if (Math.abs(m - g.cantidad) < 1) montosUsados.add(m);
      });
    }
  });

  // Encontrar montos del PDF que no coincidieron con ningún gasto
  window._noConcilBanco = [];
  lineasConMonto.forEach(linea => {
    linea.montos.forEach(monto => {
      // Si este monto no fue usado en ningún gasto
      const yaUsado = items.some(g => Math.abs(g.cantidad - monto) < 1 && conciliados[clave][g.id]);
      if (!yaUsado && monto > 0) {
        // Evitar duplicados
        const existe = window._noConcilBanco.some(x => Math.abs(x.monto - monto) < 0.01 && x.descripcion === linea.texto.slice(0,60));
        if (!existe) {
          window._noConcilBanco.push({
            fecha: '',
            descripcion: linea.texto.slice(0, 80),
            monto
          });
        }
      }
    });
  });

  const status = document.getElementById('concil-pdf-status');
  const noBanco = window._noConcilBanco.length;
  status.textContent = `✅ ${conciliados_count} de ${items.length} gastos conciliados por monto.`;
  if (noBanco) status.textContent += ` · ${noBanco} cargo(s) en PDF sin registrar.`;
  renderConciliacion();
}

// ── Catálogos ─────────────────────────────────────────────────
// Sub-tab activo: 'cuentas' | 'motivos'
let catalogoTab = 'cuentas';

function renderCatalogos() {
  ['cuentas','motivos','comentarios'].forEach(t => {
    const btn = document.getElementById('ctab-'+t);
    if (!btn) return;
    btn.style.background = catalogoTab === t ? '#0d9488' : 'transparent';
    btn.style.color      = catalogoTab === t ? 'white'   : '#94a3b8';
    document.getElementById('cat-panel-'+t).style.display = catalogoTab === t ? '' : 'none';
  });
  if (catalogoTab === 'cuentas')    renderCatCuentas();
  if (catalogoTab === 'motivos')    renderCatMotivos();
  if (catalogoTab === 'comentarios') renderCatComentarios();
}

function setCatalogoTab(t) { catalogoTab = t; renderCatalogos(); }

// ── Catálogo de Cuentas ───────────────────────────────────────
function renderCatCuentas() {
  const el = document.getElementById('cat-cuentas-list');
  el.innerHTML = catalogoCuentas.map((c, i) => `
    <div style="background:var(--bg2);border-radius:10px;border:1px solid var(--border);padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:14px;height:14px;border-radius:50%;background:${c.color};flex-shrink:0;display:inline-block"></span>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:500;color:var(--text)">${c.nombre}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">
            ${c.tieneCorte ? `Corte día ${c.diaCorte}` : 'Sin corte (débito)'}
          </div>
        </div>
        <button onclick="editarCuenta(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;font-size:12px;color:var(--text2);cursor:pointer">Editar</button>
        <button onclick="eliminarCuenta_cat(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid #fee2e2;background:transparent;font-size:12px;color:var(--red);cursor:pointer">🗑</button>
      </div>
    </div>`).join('');
}

function nuevaCuenta_cat() {
  document.getElementById('cc-nombre').value    = '';
  document.getElementById('cc-color').value     = '#0d9488';
  document.getElementById('cc-tiene-corte').checked = false;
  document.getElementById('cc-dia-wrap').style.display = 'none';
  document.getElementById('cc-dia').value       = '';
  document.getElementById('cc-modal-title').textContent = 'Nueva cuenta';
  window._editCuentaIdx = null;
  openModal('modal-cat-cuenta');
}

function editarCuenta(i) {
  const c = catalogoCuentas[i];
  document.getElementById('cc-nombre').value    = c.nombre;
  document.getElementById('cc-color').value     = c.color;
  document.getElementById('cc-tiene-corte').checked = !!c.tieneCorte;
  document.getElementById('cc-dia-wrap').style.display = c.tieneCorte ? '' : 'none';
  document.getElementById('cc-dia').value       = c.diaCorte || '';
  document.getElementById('cc-modal-title').textContent = 'Editar cuenta';
  window._editCuentaIdx = i;
  openModal('modal-cat-cuenta');
}

async function guardarCuenta_cat() {
  const nombre = document.getElementById('cc-nombre').value.trim();
  if (!nombre) { showToast('Ingresa el nombre de la cuenta'); return; }
  const color      = document.getElementById('cc-color').value;
  const tieneCorte = document.getElementById('cc-tiene-corte').checked;
  const diaCorte   = tieneCorte ? parseInt(document.getElementById('cc-dia').value) : null;
  if (tieneCorte && (!diaCorte || diaCorte < 1 || diaCorte > 31)) {
    showToast('Ingresa un día de corte válido (1-31)'); return;
  }
  const obj = { nombre, color, tieneCorte, diaCorte };
  if (window._editCuentaIdx !== null) {
    catalogoCuentas[window._editCuentaIdx] = obj;
  } else {
    if (catalogoCuentas.find(c => c.nombre.toLowerCase() === nombre.toLowerCase())) {
      showToast('Ya existe una cuenta con ese nombre'); return;
    }
    catalogoCuentas.push(obj);
  }
  saveLocal();
  closeModal('modal-cat-cuenta');
  showToast('Cuenta guardada ✓');
  renderCatCuentas();
  // Actualizar selects del formulario de gastos
  actualizarSelectCuentas();
}

async function eliminarCuenta_cat(i) {
  const c = catalogoCuentas[i];
  if (!confirm(`¿Eliminar la cuenta "${c.nombre}"? Los gastos existentes mantendrán el nombre.`)) return;
  catalogoCuentas.splice(i, 1);
  await saveData();
  showToast('Cuenta eliminada');
  renderCatCuentas();
  actualizarSelectCuentas();
}

function actualizarSelectCuentas() {
  const sel = document.getElementById('f-cuenta');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = getCuentas().map(n => `<option${n===cur?' selected':''}>${n}</option>`).join('');
}

// ── Catálogo de Motivos ───────────────────────────────────────
function renderCatMotivos() {
  const el = document.getElementById('cat-motivos-list');
  el.innerHTML = catalogoMotivos.map((m, i) => `
    <div style="background:var(--bg2);border-radius:10px;border:1px solid var(--border);padding:11px 13px;margin-bottom:7px;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">${getMotivoIcon(m)}</span>
      <span style="flex:1;font-size:13px;font-weight:500;color:var(--text)">${m}</span>
      <button onclick="editarMotivo(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;font-size:12px;color:var(--text2);cursor:pointer">Editar</button>
      <button onclick="eliminarMotivo(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid #fee2e2;background:transparent;font-size:12px;color:var(--red);cursor:pointer">🗑</button>
    </div>`).join('');
}

function nuevoMotivo() {
  document.getElementById('cm-nombre').value = '';
  document.getElementById('cm-modal-title').textContent = 'Nuevo motivo';
  window._editMotivoIdx = null;
  openModal('modal-cat-motivo');
}

function editarMotivo(i) {
  document.getElementById('cm-nombre').value = catalogoMotivos[i];
  document.getElementById('cm-modal-title').textContent = 'Editar motivo';
  window._editMotivoIdx = i;
  openModal('modal-cat-motivo');
}

async function guardarMotivo_cat() {
  const nombre = document.getElementById('cm-nombre').value.trim();
  if (!nombre) { showToast('Ingresa el nombre del motivo'); return; }
  if (window._editMotivoIdx !== null) {
    catalogoMotivos[window._editMotivoIdx] = nombre;
  } else {
    if (catalogoMotivos.map(m=>m.toLowerCase()).includes(nombre.toLowerCase())) {
      showToast('Ya existe ese motivo'); return;
    }
    catalogoMotivos.push(nombre);
  }
  saveLocal();
  closeModal('modal-cat-motivo');
  showToast('Motivo guardado ✓');
  renderCatMotivos();
  actualizarSelectMotivos();
}

async function eliminarMotivo(i) {
  if (!confirm(`¿Eliminar el motivo "${catalogoMotivos[i]}"?`)) return;
  catalogoMotivos.splice(i, 1);
  await saveData();
  showToast('Motivo eliminado');
  renderCatMotivos();
  actualizarSelectMotivos();
}

function actualizarSelectMotivos() {
  const sel = document.getElementById('f-motivo');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = catalogoMotivos.map(m => `<option${m===cur?' selected':''}>${m}</option>`).join('');
}

// El campo comentarios es un combo: dropdown + input libre
function openComentarioDropdown() {
  const dropdown = document.getElementById('comentario-dropdown');
  const input    = document.getElementById('f-comentarios-input');
  const q        = input.value.trim().toLowerCase();

  // Normalizar: el catálogo puede tener strings u objetos {nombre:...}
  const todos = (catalogoComentarios || []).map(c =>
    typeof c === 'string' ? c : (c.nombre || c.Nombre || String(c))
  ).filter(Boolean);

  const items = q ? todos.filter(c => c.toLowerCase().includes(q)) : todos;

  let html = items.map(c =>
    `<div onmousedown="event.preventDefault();seleccionarComentario('${c.replace(/'/g,'&#39;').replace(/"/g,'&quot;')}')"
      style="padding:11px 14px;font-size:14px;color:var(--text);cursor:pointer;border-bottom:1px solid var(--border)">${c}</div>`
  ).join('');

  if (q && !todos.some(c => c.toLowerCase() === q)) {
    html += `<div onmousedown="event.preventDefault();seleccionarComentario('${input.value.replace(/'/g,'&#39;').replace(/"/g,'&quot;')}')"
      style="padding:11px 14px;font-size:13px;color:var(--green);cursor:pointer;font-weight:600">+ Usar "${input.value}"</div>`;
  }

  if (!html) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = html;
  dropdown.style.display = 'block';
}

function seleccionarComentario(val) {
  document.getElementById('f-comentarios-input').value = val;
  document.getElementById('comentario-dropdown').style.display = 'none';
}

function cerrarDropdownComentario(e) {
  const wrap = document.getElementById('comentario-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('comentario-dropdown').style.display = 'none';
  }
}


// ── Catálogo de Comentarios ───────────────────────────────────
function renderCatComentarios() {
  const el = document.getElementById('cat-comentarios-list');
  el.innerHTML = catalogoComentarios.map((c, i) => `
    <div style="background:var(--bg2);border-radius:10px;border:1px solid var(--border);padding:11px 13px;margin-bottom:7px;display:flex;align-items:center;gap:10px">
      <span style="font-size:16px">💬</span>
      <span style="flex:1;font-size:13px;font-weight:500;color:var(--text)">${c}</span>
      <button onclick="editarComentario(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;font-size:12px;color:var(--text2);cursor:pointer">Editar</button>
      <button onclick="eliminarComentario(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid #fee2e2;background:transparent;font-size:12px;color:var(--red);cursor:pointer">🗑</button>
    </div>`).join('');
}

function nuevoComentario() {
  document.getElementById('ccom-nombre').value = '';
  document.getElementById('ccom-modal-title').textContent = 'Nuevo comentario';
  window._editComentarioIdx = null;
  openModal('modal-cat-comentario');
}

function editarComentario(i) {
  document.getElementById('ccom-nombre').value = catalogoComentarios[i];
  document.getElementById('ccom-modal-title').textContent = 'Editar comentario';
  window._editComentarioIdx = i;
  openModal('modal-cat-comentario');
}

async function guardarComentarioCat() {
  const nombre = document.getElementById('ccom-nombre').value.trim();
  if (!nombre) { showToast('Ingresa el nombre del comentario'); return; }
  if (window._editComentarioIdx !== null) {
    catalogoComentarios[window._editComentarioIdx] = nombre;
  } else {
    if (catalogoComentarios.map(c=>c.toLowerCase()).includes(nombre.toLowerCase())) {
      showToast('Ya existe ese comentario'); return;
    }
    catalogoComentarios.push(nombre);
  }
  saveLocal();
  closeModal('modal-cat-comentario');
  showToast('Comentario guardado ✓');
  renderCatComentarios();
}

async function eliminarComentario(i) {
  if (!confirm(`¿Eliminar "${catalogoComentarios[i]}" del catálogo?`)) return;
  catalogoComentarios.splice(i, 1);
  await saveData();
  showToast('Eliminado');
  renderCatComentarios();
}


// ── Menú lateral (drawer) ─────────────────────────────────────
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
}


// ── Modo oscuro / claro ───────────────────────────────────────
function aplicarTema(modo) {
  const root = document.documentElement;
  if (modo === 'claro') {
    root.style.setProperty('--bg',      '#f0f2f5');
    root.style.setProperty('--bg2',     '#ffffff');
    root.style.setProperty('--bg3',     '#e8eaf0');
    root.style.setProperty('--text',    '#1a1d27');
    root.style.setProperty('--text2',   '#4a5568');
    root.style.setProperty('--text3',   '#718096');
    root.style.setProperty('--border',  'rgba(0,0,0,.1)');
    root.style.setProperty('--border2', 'rgba(0,0,0,.18)');
    root.style.setProperty('--topbar1', '#4c1d95');
    root.style.setProperty('--topbar2', '#5b21b6');
    document.body.style.background = '#f0f2f5';
  } else {
    root.style.setProperty('--bg',      '#0f1117');
    root.style.setProperty('--bg2',     '#1a1d27');
    root.style.setProperty('--bg3',     '#22263a');
    root.style.setProperty('--text',    '#f0f2ff');
    root.style.setProperty('--text2',   '#8b92b0');
    root.style.setProperty('--text3',   '#555d7a');
    root.style.setProperty('--border',  'rgba(255,255,255,.07)');
    root.style.setProperty('--border2', 'rgba(255,255,255,.12)');
    root.style.setProperty('--topbar1', '#1e1b4b');
    root.style.setProperty('--topbar2', '#2d1b6e');
    document.body.style.background = '#0f1117';
  }
  localStorage.setItem('tema', modo);
  const btn = document.getElementById('btn-tema');
  if (btn) btn.textContent = modo === 'claro' ? '🌙 Modo oscuro' : '☀️ Modo claro';
}
function toggleTema() {
  aplicarTema(localStorage.getItem('tema')==='claro' ? 'oscuro' : 'claro');
}
// ── Ocultar/mostrar total ahorrado ───────────────────────────
let ahorroVisible = false;
function toggleAhorroVisible() {
  ahorroVisible = !ahorroVisible;
  aplicarVisibilidadAhorros();
}

function aplicarVisibilidadAhorros() {
  const blur = ahorroVisible ? '' : 'blur(8px)';
  // Total grande y grupos en pestaña Ahorros
  ['ahorro-big','ahorro-grupos-totales'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.filter = blur;
  });
  // Saldos en cada tarjeta de ahorro (.ahorro-total)
  document.querySelectorAll('.ahorro-total').forEach(el => el.style.filter = blur);
  // Totales de grupo en headers
  document.querySelectorAll('.ahorro-grupo-total').forEach(el => el.style.filter = blur);
  // Movimientos en tarjetas
  document.querySelectorAll('.ahorro-mov-monto').forEach(el => el.style.filter = blur);
  // Stat card del Menú
  const sAhorro = document.getElementById('s-ahorro');
  if (sAhorro) sAhorro.style.filter = blur;
  // Botones ojito
  ['btn-eye-ahorro','btn-eye-menu'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = ahorroVisible ? '👁' : '🙈';
  });
}

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  try { loadFromLocal(); } catch(e) { console.error('Error cargando datos:', e); }
  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
  actualizarSelectCuentas();
  actualizarSelectMotivos();
  // Inicializar fecha
  const fechaEl = document.getElementById('f-fecha');
  if (fechaEl) fechaEl.value = new Date().toISOString().slice(0,10);
  aplicarTema(localStorage.getItem('tema') || 'oscuro');
  // Renderizar menú con datos locales INMEDIATAMENTE
  showTab('menu');
  renderMenu();
  aplicarVisibilidadAhorros(); // aplicar estado inicial (oculto)
  document.addEventListener('click', cerrarDropdownComentario);
  iniciarAutoSync();
  mostrarBannerActualizar();
  // Sync con GitHub en segundo plano
  if (usingGithub()) {
    downloadSnapshot().then(async ok => {
      // Re-renderizar siempre con los datos más frescos
      actualizarSelectCuentas();
      actualizarSelectMotivos();
      renderMenu();
      const tabAct = tabActualGlobal;
      if (tabAct === 'gastos') renderGastos();
      // Solo subir si hay cambios locales reales (timestamps con valor)
      const lm = new Date(localStorage.getItem('localModified')||0).getTime();
      const ls = new Date(localStorage.getItem('lastSync')||0).getTime();
      if (lm > 0 && ls > 0 && lm > ls + 3000) {
        const up = await uploadSnapshot();
        if (up) {
          const ts = new Date().toISOString();
          localStorage.setItem('lastSync', ts);
          localStorage.setItem('localModified', ts);
        }
      }
      mostrarEstadoSync(true);
    });
  } else {
    mostrarEstadoSync(false);
  }
});

function mostrarBannerActualizar() {
  // Usar sync-status en topbar en vez de banner que ocupa espacio
  const status = document.getElementById('sync-status');
  if (status) {
    status.style.display = 'inline';
    if (usingGithub()) {
      status.textContent = '🔄 Sync...';
      status.style.color = 'var(--text3)';
    } else {
      const lastBackup = localStorage.getItem('lastBackup');
      if (!lastBackup) {
        status.textContent = '💾 Sin backup';
        status.style.color = 'var(--orange)';
      }
    }
  }
  // Ocultar el banner de abajo (no usarlo para no afectar layout)
  const banner = document.getElementById('banner-actualizar');
  if (banner) banner.style.display = 'none';
}

function ocultarBannerActualizar() {
  const banner = document.getElementById('banner-actualizar');
  if (banner) banner.style.display = 'none';
  mostrarEstadoSync(true);
  // Mostrar hora de sync en topbar
  const last = localStorage.getItem('lastSync');
  const status = document.getElementById('sync-status');
  if (status && last) {
    const d = new Date(last);
    status.style.display = 'inline';
    status.textContent = `✓ ${d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`;
    status.style.color = 'var(--green)';
  }
}
