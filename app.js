// ════════════════════════════════════════════════════════════
//  GASTOS SEMANALES — app.js v3
//  Cambia SCRIPT_URL por tu URL de Apps Script publicada
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
//  Configurar: ☰ → Configurar GitHub sync
// ════════════════════════════════════════════════════════════

const GITHUB_OWNER = 'VictorGtz12';
const GITHUB_REPO  = 'GastosApp';
const GITHUB_FILE  = 'datos.json';
const GITHUB_BRANCH = 'main';

function getGithubToken() { return localStorage.getItem('githubToken') || ''; }
function usingGithub()    { return !!getGithubToken(); }

// URL de la API de GitHub para el archivo
function githubApiUrl() {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
}

// Cabeceras comunes para la API
function githubHeaders() {
  return {
    'Authorization': `Bearer ${getGithubToken()}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json'
  };
}

// Sube el snapshot a GitHub
async function uploadSnapshot() {
  if (!usingGithub()) return false;
  try {
    const snap    = compressSnap(buildSnapshot());
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(snap))));

    // Obtener SHA del archivo actual (necesario para actualizarlo)
    let sha = null;
    try {
      const get = await fetch(githubApiUrl(), { headers: githubHeaders() });
      if (get.ok) { const data = await get.json(); sha = data.sha; }
    } catch(e) {}

    const body = {
      message: `sync ${new Date().toISOString().slice(0,16).replace('T',' ')}`,
      content,
      branch: GITHUB_BRANCH,
      ...(sha ? { sha } : {})
    };

    const res = await fetch(githubApiUrl(), {
      method:  'PUT',
      headers: githubHeaders(),
      body:    JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    localStorage.setItem('lastSync', new Date().toISOString());
    localStorage.setItem('localModified', localStorage.getItem('lastSync'));
    console.log('GitHub upload OK');
    return true;
  } catch(e) {
    console.warn('uploadSnapshot error:', e.message);
    return false;
  }
}

// Descarga el snapshot de GitHub
async function downloadSnapshot() {
  if (!usingGithub()) return false;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15000);

    // Agregar timestamp para evitar caché del navegador
    const url = `${githubApiUrl()}?ref=${GITHUB_BRANCH}&t=${Date.now()}`;
    const res = await fetch(url, {
      headers: { ...githubHeaders(), 'Cache-Control': 'no-cache' },
      signal:  controller.signal
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data    = await res.json();
    const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g,''))));
    const rawSnap = JSON.parse(decoded);
    const snap    = decompressSnap(rawSnap);
    const ok      = applySnapshot(snap);

    if (ok) {
      saveLocal();
      localStorage.setItem('lastSync', new Date().toISOString());
      localStorage.setItem('localModified', localStorage.getItem('lastSync'));
      console.log('GitHub download OK — gastos:', gastos.length, 'hist:', historico.length);
    }
    return ok;
  } catch(e) {
    console.warn('downloadSnapshot error:', e.message);
    return false;
  }
}

// Al guardar: solo local
function saveData(opts = {}) { saveLocal(); }

// Configura el token de GitHub
function configurarGithub() {
  const token = prompt(
    'Pega tu GitHub Personal Access Token\n' +
    '(Settings → Developer settings → Personal access tokens → Fine-grained)\n' +
    'Permisos necesarios: Contents (Read and Write)\n\n' +
    'Déjalo vacío para desactivar sync:',
    getGithubToken()
  );
  if (token === null) return;
  localStorage.setItem('githubToken', token.trim());
  location.reload();
}

// Botón Actualizar
async function refreshData() {
  if (!usingGithub()) {
    loadFromLocal();
    actualizarSelectCuentas(); actualizarSelectMotivos();
    showTab(document.querySelector('.tab.active')?.id?.replace('tab-','') || 'menu');
    showToast('Vista actualizada ✓');
    return;
  }
  const tabActual = document.querySelector('.tab.active')?.id?.replace('tab-','') || 'menu';
  mostrarBannerActualizar();
  showToast('Subiendo datos...');
  const up = await uploadSnapshot();
  if (!up) { showToast('Error al subir — revisa tu token'); mostrarEstadoSync(false); return; }
  showToast('Descargando...');
  const down = await downloadSnapshot();
  actualizarSelectCuentas(); actualizarSelectMotivos();
  showTab(tabActual);
  mostrarEstadoSync(down);
  showToast(down ? 'Sincronizado ✓' : 'Error al descargar');
}

// Mostrar estado sync en topbar
function mostrarEstadoSync(ok) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.style.display  = 'inline';
  el.style.cursor   = 'pointer';
  el.onclick        = () => refreshData();
  if (!usingGithub()) { el.textContent = ''; el.style.display = 'none'; return; }
  const localMod  = new Date(localStorage.getItem('localModified') || 0).getTime();
  const lastSync  = new Date(localStorage.getItem('lastSync')       || 0).getTime();
  const hayPend   = localMod > lastSync + 3000;
  if (hayPend) {
    el.textContent = '⬆️ Cambios sin subir';
    el.style.color = 'var(--orange)';
    const b = document.getElementById('banner-pendientes');
    if (b) b.style.display = 'flex';
  } else if (ok && lastSync) {
    const d = new Date(lastSync);
    el.textContent = `✓ ${d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`;
    el.style.color = 'var(--green)';
    const b = document.getElementById('banner-pendientes');
    if (b) b.style.display = 'none';
  } else {
    el.textContent = '⚠️ Sin sync';
    el.style.color = 'var(--orange)';
  }
}

function mostrarBannerActualizar() {
  const s = document.getElementById('sync-status');
  if (s && usingGithub()) { s.style.display='inline'; s.textContent='🔄 ...'; s.style.color='var(--text3)'; }
}
function ocultarBannerActualizar() { mostrarEstadoSync(true); }
function ocultarAvisoDesactualizado() {}
function mostrarAvisoDesactualizado() {}
function verificarPendientes()       { mostrarEstadoSync(true); }

// Auto-sync cada 5 min si hay pendientes
function iniciarAutoSync() {
  if (!usingGithub()) return;
  setInterval(async () => {
    const localMod = new Date(localStorage.getItem('localModified') || 0).getTime();
    const lastSync = new Date(localStorage.getItem('lastSync')       || 0).getTime();
    if (localMod > lastSync + 3000) {
      const up = await uploadSnapshot();
      if (up) {
        localStorage.setItem('lastSync', new Date().toISOString());
        localStorage.setItem('localModified', localStorage.getItem('lastSync'));
        mostrarEstadoSync(true);
      }
    }
  }, 5 * 60 * 1000);
}