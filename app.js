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
const fmtD = d => d instanceof Date ? d.toISOString().slice(0, 10) : d;

function getWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return date.getUTCFullYear() + '-W' + String(Math.ceil((((date - y) / 86400000) + 1) / 7)).padStart(2, '0');
}

// ── Google Sheets API ─────────────────────────────────────────
// URL por defecto — todos los dispositivos usarán esta automáticamente
const SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbyTA1gjKpDoooomuXR_W_pzLDNjeXJEAQXtXX1q6zvptRPVZHUWU5v0k5-WevcMZjhm/exec';
const SCRIPT_URL = localStorage.getItem('sheetsUrl') || SCRIPT_URL_DEFAULT;
const usingSheets = () => SCRIPT_URL !== 'https://script.google.com/macros/s/AKfycbyTA1gjKpDoooomuXR_W_pzLDNjeXJEAQXtXX1q6zvptRPVZHUWU5v0k5-WevcMZjhm/exec' && !!SCRIPT_URL;

async function apiGet(action) {
  const res = await fetch(`${SCRIPT_URL}?action=${action}`);
  return res.json();
}
async function apiPost(action, data) {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action, data }),
    headers: { 'Content-Type': 'text/plain' }
  });
  return res.json();
}

// Aplica datos de Sheets sobre el estado actual
function applySheetData(result) {
  if (!result) return;
  if (result.semana)    gastos    = (result.semana    || []).map(normalizeGasto);
  if (result.historico) historico = (result.historico || []).map(normalizeGasto);
  if (result.excepciones) excepciones = result.excepciones || [];
  if (result.ahorros && result.ahorros.length) {
    cuentasAhorro = result.ahorros.map(normAhorro);
    const ids = cuentasAhorro.map(c=>c.id).filter(Boolean);
    nextAhorroId = ids.length ? Math.max(...ids)+1 : 1;
  }
  const allIds = [...gastos,...historico].map(g=>Number(g.id)).filter(Boolean);
  nextId = allIds.length ? Math.max(...allIds)+1 : 1;
  if (result.catalogos) {
    if (result.catalogos.cuentas?.length)     catalogoCuentas     = result.catalogos.cuentas;
    if (result.catalogos.motivos?.length)     catalogoMotivos     = result.catalogos.motivos;
    if (result.catalogos.comentarios?.length) catalogoComentarios = result.catalogos.comentarios.map(c=>typeof c==='string'?c:(c.nombre||''));
  }
}

// Sync en segundo plano — no bloquea la UI
async function syncSheetsBackground() {
  if (!usingSheets()) return;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15000);
    const res    = await fetch(`${SCRIPT_URL}?action=getAll`, { signal: controller.signal });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    applySheetData(result);
    saveLocal();
    // Refrescar vista actual silenciosamente
    actualizarSelectCuentas();
    actualizarSelectMotivos();
    const tab = document.querySelector('.tab.active')?.id?.replace('tab-','') || 'menu';
    showTab(tab);
    // Actualizar timestamp de última sincronización
    localStorage.setItem('lastSync', new Date().toISOString());
    mostrarEstadoSync(true);
    return true;
  } catch(e) {
    console.warn('Sync Sheets error:', e.message);
    mostrarEstadoSync(false);
    return false;
  }
}

function mostrarEstadoSync(ok) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const last = localStorage.getItem('lastSync');
  if (ok && last) {
    const d = new Date(last);
    el.textContent = `Sincronizado ${d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}`;
    el.style.color = 'var(--green)';
  } else if (!ok) {
    el.textContent = 'Sin conexión con Sheets';
    el.style.color = 'var(--orange)';
  }
}

// Guarda gasto en Sheets en segundo plano
function saveGastoSheets(gasto, accion) {
  if (!usingSheets()) return;
  const row = {
    ID: gasto.id, Fecha: gasto.fecha, Cuenta: gasto.cuenta, Motivo: gasto.motivo,
    Cantidad: gasto.cantidad, Comentarios: gasto.comentarios||'',
    Abonado: gasto.abonado, Ignorar: gasto.ignorar, Externo: gasto.externo,
    Semana: gasto.semana, AhorroDesc: gasto.ahorroDesc||''
  };
  apiPost(accion, row).catch(()=>{});
}

// Guarda ahorros en Sheets en segundo plano
function saveAhorrosSheets() {
  if (!usingSheets()) return;
  apiPost('saveAhorros', { cuentas: cuentasAhorro }).catch(()=>{});
}

// Configura la URL de Sheets
function configurarSheets() {
  const url = prompt('Pega la URL de tu Apps Script (déjalo vacío para desactivar):', SCRIPT_URL);
  if (url === null) return;
  if (url && !url.includes('script.google.com')) { showToast('URL inválida'); return; }
  localStorage.setItem('sheetsUrl', url || '');
  location.reload();
}


// ── Normalización ────────────────────────────────────────────
function normalizeGasto(row) {
  return {
    id:           row.ID || row.id,
    fecha:        (String(row.Fecha || row.fecha || today())).slice(0,10),
    cuenta:       row.Cuenta || row.cuenta || '',
    motivo:       row.Motivo || row.motivo || '',
    cantidad:     Number(row.Cantidad || row.cantidad) || 0,
    comentarios:  row.Comentarios || row.comentarios || '',
    abonado:      row.Abonado === true || row.Abonado === 'SI' || row.abonado === true,
    ignorar:      row.Ignorar === true || row.Ignorar === 'SI' || row.ignorar === true,
    externo:      row.Externo || row.externo || 'no',
    semana:       row.Semana || row.semana || getWeek(new Date()),
    ahorroDesc:   row.AhorroDesc || row.ahorroDesc || '',
  };
}
function gastoToSheets(g) {
  return {
    ID: g.id, Fecha: g.fecha, Cuenta: g.cuenta, Motivo: g.motivo,
    Cantidad: g.cantidad, Comentarios: g.comentarios || '',
    Abonado: g.abonado, Ignorar: g.ignorar, Externo: g.externo,
    Semana: g.semana, AhorroDesc: g.ahorroDesc || ''
  };
}

// ════════════════════════════════════════════════════════════
//  ALMACENAMIENTO — localStorage (simple, universal, sin bloqueos)
//  IndexedDB causaba bloqueos en Safari/iPhone — volvemos a localStorage
//  pero con una sola clave JSON para evitar el límite de 5MB por fragmento.
// ════════════════════════════════════════════════════════════

function saveLocal() {
  try {
    const data = {
      gastos, historico, nextId, nextAhorroId,
      cuentasAhorro, excepciones,
      catalogoCuentas, catalogoMotivos, catalogoComentarios
    };
    localStorage.setItem('appData_v1', JSON.stringify(data));
  } catch(e) {
    console.warn('saveLocal error:', e);
    // Si falla por tamaño, guardar por partes
    try {
      localStorage.setItem('gastos',    JSON.stringify(gastos));
      localStorage.setItem('historico', JSON.stringify(historico));
      localStorage.setItem('ahorros',   JSON.stringify(cuentasAhorro));
    } catch(e2) { console.error('saveLocal fallback error:', e2); }
  }
}

function loadFromLocal() {
  try {
    // Intentar clave nueva primero
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
      if (data.catalogoComentarios) catalogoComentarios = data.catalogoComentarios.map(c => typeof c === "string" ? c : (c.nombre || c.Nombre || "")).filter(Boolean);
      if (data.cuentasAhorro)       cuentasAhorro       = data.cuentasAhorro.map(normAhorro);
      return;
    }
    // Fallback: claves legacy separadas
    const tryGet = (...keys) => {
      for (const k of keys) { const v = localStorage.getItem(k); if (v !== null) return v; }
      return null;
    };
    const g    = tryGet('gastos','gastos_v7','gastos_v6','gastos_v5','gastos_v4','gastos_v3');
    const h    = tryGet('historico','historico_v7','historico_v6','historico_v5');
    const n    = tryGet('nextId');
    const a    = tryGet('ahorros','ahorros_v7','ahorros_v6','ahorros_v5');
    const na   = tryGet('nextAhorroId');
    const ex   = tryGet('excepciones');
    const cc   = tryGet('catalogoCuentas');
    const cm   = tryGet('catalogoMotivos');
    const ccom = tryGet('catalogoComentarios');
    if (g)    gastos              = JSON.parse(g).map(normGasto);
    if (h)    historico           = JSON.parse(h).map(normGasto);
    if (n)    nextId              = parseInt(n) || 1;
    if (na)   nextAhorroId        = parseInt(na) || 1;
    if (ex)   excepciones         = JSON.parse(ex);
    if (cc)   catalogoCuentas     = JSON.parse(cc);
    if (cm)   catalogoMotivos     = JSON.parse(cm);
    if (ccom) {
      const raw = JSON.parse(ccom);
      // Normalizar: aceptar strings o {nombre:...}
      catalogoComentarios = raw.map(c => typeof c === 'string' ? c : (c.nombre || c.Nombre || '')).filter(Boolean);
    }
    if (a)    cuentasAhorro       = JSON.parse(a).map(normAhorro);
    // Migrar a clave nueva
    if (g || h || a) saveLocal();
  } catch(e) { console.error('loadFromLocal error:', e); }
}

function normGasto(x) {
  // Normalizar fecha: quitar hora si viene con T
  let fecha = String(x.fecha || x.Fecha || today());
  if (fecha.includes('T')) fecha = fecha.slice(0, 10);
  return {
    id:          x.id || x.ID,
    fecha,
    cuenta:      x.cuenta || x.Cuenta || '',
    motivo:      x.motivo || x.Motivo || '',
    cantidad:    Number(x.cantidad || x.Cantidad) || 0,
    comentarios: x.comentarios || x.Comentarios || '',
    abonado:     x.abonado === true  || x.Abonado === 'SI'  || x.abonado === 'true',
    ignorar:     x.ignorar === true  || x.Ignorar === 'SI'  || x.ignorar === 'true',
    externo:     x.externo || x.Externo || 'no',
    semana:      x.semana || x.Semana || getWeek(new Date()),
    ahorroDesc:  x.ahorroDesc || x.AhorroDesc || '',
  };
}

function normAhorro(c) {
  // excluirTotal: comparar estrictamente — el string "false" NO debe ser true
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
// ── saveData ─────────────────────────────────────────────────
function saveData(opts = {}) {
  saveLocal();
  // Sincronizar con Sheets en segundo plano si está configurado
  if (usingSheets() && opts.gasto)   saveGastoSheets(opts.gasto, opts.accion || 'addGasto');
  if (usingSheets() && opts.ahorros) saveAhorrosSheets();
}

// Carga datos y muestra la app
function loadData() {
  loadFromLocal();
  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-app').style.display = 'flex';
  actualizarSelectCuentas();
  actualizarSelectMotivos();
  showTab('menu');
}

// Botón Actualizar — jala de Sheets si está configurado
async function refreshData() {
  if (usingSheets()) {
    showToast('Sincronizando...');
    const ok = await syncSheetsBackground();
    showToast(ok ? 'Sincronizado con Sheets ✓' : 'Sin conexión — datos locales');
  } else {
    loadFromLocal();
    actualizarSelectCuentas();
    actualizarSelectMotivos();
    const tab = document.querySelector('.tab.active')?.id?.replace('tab-','') || 'menu';
    showTab(tab);
    showToast('Vista actualizada ✓');
  }
}



// ── Navegación ────────────────────────────────────────────────
const TABS = ['menu','gastos','nuevo','externos','cortes','ahorros','historico','catalogos','recurrentes'];

function showTab(tab) {
  TABS.forEach(t => {
    document.getElementById('content-' + t).classList.toggle('active', t === tab);
    const tabEl = document.getElementById('tab-' + t);
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
  // Marcar activo en drawer
  ['historico','catalogos','recurrentes'].forEach(t => {
    const el = document.getElementById('drawer-' + t);
    if (el) el.classList.toggle('active-item', t === tab);
  });
  const titles = {
    menu:'Gastos Semanales', gastos:'Mis Gastos',
    nuevo: editingId ? 'Editar Gasto' : 'Nuevo Gasto',
    externos:'Externos', cortes:'Cortes por Tarjeta',
    ahorros:'Mis Ahorros', historico:'Historial',
    catalogos:'Catálogos', recurrentes:'Recurrentes y Deudas'
  };
  document.getElementById('topbar-title').textContent = titles[tab] || 'Gastos Semanales';
  if (tab === 'menu')      renderMenu();
  if (tab === 'gastos')    renderGastos();
  if (tab === 'externos')  renderExternos();
  if (tab === 'cortes')    renderCortes();
  if (tab === 'ahorros')   renderAhorros();
  if (tab === 'historico')   renderHistorico();
  if (tab === 'catalogos')   renderCatalogos();
  if (tab === 'recurrentes') renderRecurrentes();
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
function renderGastos() {
  const q = (document.getElementById('search-in').value || '').toLowerCase();
  let list = gastos.filter(g => {
    if (activeFilter === 'pendiente') return !g.abonado && !g.ignorar && g.externo === 'no';
    if (activeFilter === 'abonado')   return g.abonado  && !g.ignorar && g.externo === 'no';
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
  list = list.sort((a,b) => String(b.fecha).localeCompare(String(a.fecha)));
  const el = document.getElementById('gastos-list');
  if (!list.length) { el.innerHTML = '<div class="empty">Sin gastos registrados</div>'; return; }
  el.innerHTML = list.map(g => {
    const iE = g.externo === 'externo', iP = g.externo === 'pagado';
    return `<div class="gasto-item ${iE?'ext-pend':iP?'ext-paid':''}" style="${g.ignorar?'opacity:.55':''}">
      <div class="gasto-icon" onclick="openDetail(${g.id})">${getMotivoIcon(g.motivo)||'📋'}</div>
      <div class="gasto-info" onclick="openDetail(${g.id})">
        <div class="gasto-motivo">${g.motivo}${g.ahorroDesc?` <span style="font-size:10px;color:var(--purple)">🐷 ${g.ahorroDesc}</span>`:''}${g._esHistorico?' <span style="font-size:9px;background:rgba(108,99,255,.2);color:var(--accent2);padding:1px 5px;border-radius:6px">historial</span>':''}</div>
        <div class="gasto-meta">${g.cuenta}${g.comentarios?' · '+g.comentarios:''} · ${g.fecha}</div>
        <div class="badges">
          ${g.ignorar ? '<span class="badge ignorar">🚫 Ignorado</span>'
            : iE ? '<span class="badge ext">📤 Externo</span>'
            : iP ? '<span class="badge ext-paid">✅ Cobrado</span>'
            : `<span class="badge ${g.abonado?'ab':'pend'}">${g.abonado?'✓ Abonado':'✗ Pendiente'}</span>`}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div class="gasto-monto" onclick="openDetail(${g.id})" style="${g.ignorar||iP?'text-decoration:line-through;color:var(--text2)':iE?'color:var(--orange)':''}">${fmt(g.cantidad)}</div>
        ${!g._esHistorico?`<button onclick="editarDirecto(${g.id})" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:5px 8px;font-size:11px;cursor:pointer;flex-shrink:0">✏️</button>`:''}
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
  list = list.sort((a,b) => String(b.fecha).localeCompare(String(a.fecha)));
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
function diaCorteEfectivo(cuenta, fechaCorteNormal) {
  const fStr = fmtD(fechaCorteNormal);
  const exc = excepciones.find(e =>
    e.Cuenta === cuenta && e.FechaOriginal === fStr
  );
  if (exc && exc.FechaExcepcion) return new Date(exc.FechaExcepcion + 'T12:00:00');
  return fechaCorteNormal;
}

function fechaCorteNormal(cfg, año, mes) {
  return new Date(año, mes, cfg.dia);
}

// Calcula el período activo para una tarjeta respetando excepciones
function getPeriodoActual(cfg, cuenta) {
  const hoy = new Date();
  let desde, hastaBase, hasta;

  if (hoy.getDate() <= cfg.dia) {
    const pm = hoy.getMonth() === 0 ? 11 : hoy.getMonth() - 1;
    const py = hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear();
    // fecha corte del mes anterior
    const cortePrevBase = fechaCorteNormal(cfg, py, pm);
    const cortePrev = diaCorteEfectivo(cuenta, cortePrevBase);
    desde = new Date(cortePrev.getFullYear(), cortePrev.getMonth(), cortePrev.getDate() + 1);
    hastaBase = fechaCorteNormal(cfg, hoy.getFullYear(), hoy.getMonth());
    hasta = diaCorteEfectivo(cuenta, hastaBase);
  } else {
    const corteActBase = fechaCorteNormal(cfg, hoy.getFullYear(), hoy.getMonth());
    const corteAct = diaCorteEfectivo(cuenta, corteActBase);
    desde = new Date(corteAct.getFullYear(), corteAct.getMonth(), corteAct.getDate() + 1);
    const nm = (hoy.getMonth() + 1) % 12;
    const ny = hoy.getMonth() === 11 ? hoy.getFullYear() + 1 : hoy.getFullYear();
    hastaBase = fechaCorteNormal(cfg, ny, nm);
    hasta = diaCorteEfectivo(cuenta, hastaBase);
  }
  return { desde, hasta };
}

function periodoAnterior(cfg, cuenta, desde) {
  // El corte que terminó justo antes de 'desde' es el día anterior
  const hastaBase = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate() - 1);
  const hasta = diaCorteEfectivo(cuenta, hastaBase);
  // El inicio de ese período es el día después del corte previo
  const pm = hasta.getMonth() === 0 ? 11 : hasta.getMonth() - 1;
  const py = hasta.getMonth() === 0 ? hasta.getFullYear() - 1 : hasta.getFullYear();
  const corteAntBase = fechaCorteNormal(cfg, py, pm);
  const corteAnt = diaCorteEfectivo(cuenta, corteAntBase);
  const nuevaDesde = new Date(corteAnt.getFullYear(), corteAnt.getMonth(), corteAnt.getDate() + 1);
  return { desde: nuevaDesde, hasta };
}

function periodoSiguiente(cfg, cuenta, hasta) {
  const nuevaDesde = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate() + 1);
  const nm = (nuevaDesde.getMonth() + 1) % 12;
  const ny = nuevaDesde.getMonth() === 11 ? nuevaDesde.getFullYear() + 1 : nuevaDesde.getFullYear();
  const hastaBase = fechaCorteNormal(cfg, ny, nm);
  const nuevaHasta = diaCorteEfectivo(cuenta, hastaBase);
  return { desde: nuevaDesde, hasta: nuevaHasta };
}

function gastosEnPeriodo(all, cuenta, desde, hasta) {
  return all.filter(g => {
    if (g.cuenta !== cuenta) return false;
    // Normalizar fecha: quitar hora si viene con T antes de comparar
    const fechaStr = String(g.fecha || '').slice(0, 10);
    const fd = new Date(fechaStr + 'T12:00:00');
    return fd >= desde && fd <= hasta;
  });
}

function renderCortes() {
  const all = [...gastos, ...historico];
  const hoy = new Date();
  document.getElementById('cortes-list').innerHTML = Object.entries(getCortesConfig()).map(([cuenta, cfg]) => {
    const { desde, hasta } = getPeriodoActual(cfg, cuenta);
    const gp    = gastosEnPeriodo(all, cuenta, desde, hasta);
    const total = gp.reduce((s,g) => s+g.cantidad, 0);
    const dias  = Math.ceil((hasta - hoy) / 864e5);
    const vencida = dias < 0;
    return `<div class="tarjeta-card" onclick="openCorteTarjeta('${cuenta}')" style="${vencida?'border-color:#fcd34d':''}">
      <div class="tarjeta-header">
        <span class="tarjeta-nombre"><span class="dot" style="background:${cfg.color}"></span>${cuenta}</span>
        <span class="tarjeta-monto">${fmt(total)}</span>
      </div>
      <div class="tarjeta-info">
        Corte día ${cfg.dia} · ${fmtD(desde)} → ${fmtD(hasta)} ·
        <strong style="color:${vencida?'#d97706':dias<=3?'#ef9f27':'#94a3b8'}">${vencida?'¡Vencido!':dias===0?'Hoy':dias+' días'}</strong>
      </div>
    </div>`;
  }).join('');
}

function openCorteTarjeta(cuenta) {
  const cfg = getCortesConfig()[cuenta];
  const all = [...gastos,...historico];
  const hoy = new Date();
  let { desde: dActual, hasta: hActual } = getPeriodoActual(cfg, cuenta);
  let curDesde = dActual, curHasta = hActual;
  const body = document.getElementById('modal-corte-body');

  const isActual  = () => fmtD(curDesde) === fmtD(dActual);
  const isFuturo  = () => curDesde > dActual;

  function render() {
    const gp = gastosEnPeriodo(all, cuenta, curDesde, curHasta);
    const total = gp.reduce((s,g)=>s+g.cantidad,0);
    const diasR = Math.ceil((curHasta - hoy) / 864e5);
    const vencida = isActual() && diasR < 0;
    const esActual = isActual();
    const labelPeriodo = esActual
      ? (vencida ? '⚠️ Período vencido'
        : `Período activo · ${diasR===0?'Corte hoy':diasR+' días para corte'}`)
      : isFuturo() ? 'Período futuro' : 'Período anterior';
    const labelColor = esActual && vencida ? '#d97706' : esActual ? '#0d9488' : '#94a3b8';

    // Excepción activa para este período
    const excActiva = excepciones.find(e =>
      e.Cuenta === cuenta && e.FechaOriginal === fmtD(curHasta)
    );

    body.innerHTML = `
      <h2 style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="width:12px;height:12px;border-radius:50%;background:${cfg.color};display:inline-block;flex-shrink:0"></span>${cuenta}
      </h2>
      <div style="font-size:11px;color:${labelColor};font-weight:500;margin-bottom:10px">${labelPeriodo}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <button onclick="window._prevP()" style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);font-size:13px;cursor:pointer">‹</button>
        <div style="flex:1;text-align:center;font-size:12px;color:var(--text2);font-weight:500">
          ${curDesde.toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'})} →
          ${curHasta.toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'})}
        </div>
        <button onclick="window._nextP()" ${isFuturo()?'disabled':''} style="padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg2);font-size:13px;cursor:pointer;color:${isFuturo()?'#cbd5e1':'#1e293b'}">›</button>
      </div>

      ${excActiva ? `<div style="background:rgba(255,159,67,.15);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:var(--orange)">
        ⚠️ Excepción activa: corte movido al <strong>${excActiva.FechaExcepcion}</strong>${excActiva.Nota?' — '+excActiva.Nota:''}
        <button onclick="eliminarExcepcion('${cuenta}','${fmtD(curHasta)}')" style="float:right;background:none;border:none;color:var(--red);cursor:pointer;font-size:11px">Eliminar</button>
      </div>` : ''}

      <div style="background:var(--bg3);border-radius:10px;padding:12px;margin-bottom:10px;text-align:center">
        <div style="font-size:11px;color:var(--text2);margin-bottom:3px">Total del período</div>
        <div style="font-size:24px;font-weight:500;color:${total>0?'#e24b4a':'#94a3b8'}">${fmt(total)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${gp.length} gasto${gp.length!==1?'s':''}</div>
      </div>

      ${esActual && vencida ? `<button onclick="window._nuevoPeriodo()" style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:500;cursor:pointer;margin-bottom:10px">✂️ Registrar corte y abrir nuevo período</button>` : ''}

      <button onclick="window._openExc()" style="width:100%;padding:8px;border-radius:8px;border:1px dashed #e2e8f0;background:transparent;color:var(--text2);font-size:12px;cursor:pointer;margin-bottom:10px">
        📅 Ajustar fecha de corte por día inhábil
      </button>

      ${gp.length
        ? gp.sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))).map(g=>`
          <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:15px">${getMotivoIcon(g.motivo)||'📋'}</span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:500;color:var(--text)">${g.motivo}</div>
              <div style="font-size:11px;color:var(--text2)">${g.fecha}${g.comentarios?' · '+g.comentarios:''}</div>
            </div>
            <div style="font-size:13px;font-weight:500;color:var(--text)">${fmt(g.cantidad)}</div>
          </div>`).join('')
        : '<div style="text-align:center;padding:16px;color:var(--text2);font-size:13px">Sin gastos en este período</div>'}
      <div class="modal-actions" style="margin-top:12px">
        <button class="mbtn sec" onclick="closeModal('modal-corte-tarjeta')">Cerrar</button>
      </div>`;
  }

  window._prevP = () => {
    const ant = periodoAnterior(cfg, cuenta, curDesde);
    curDesde = ant.desde; curHasta = ant.hasta; render();
  };
  window._nextP = () => {
    if (isFuturo()) return;
    const sig = periodoSiguiente(cfg, cuenta, curHasta);
    if (sig.desde > dActual) return;
    curDesde = sig.desde; curHasta = sig.hasta; render();
  };
  window._nuevoPeriodo = () => {
    const sig = periodoSiguiente(cfg, cuenta, hActual);
    dActual = sig.desde; hActual = sig.hasta;
    curDesde = sig.desde; curHasta = sig.hasta;
    showToast(`Nuevo período: ${fmtD(sig.desde)} → ${fmtD(sig.hasta)}`);
    render(); renderCortes();
  };
  window._openExc = () => {
    // Abrir modal de excepción para la fecha de corte del período actual
    document.getElementById('exc-cuenta').textContent  = cuenta;
    document.getElementById('exc-fecha-orig').textContent = fmtD(curHasta);
    document.getElementById('exc-fecha-nueva').value   = fmtD(curHasta);
    document.getElementById('exc-nota').value          = '';
    window._excCuenta    = cuenta;
    window._excFechaOrig = fmtD(curHasta);
    openModal('modal-excepcion');
  };
  window._eliminarExc = (cta, fo) => eliminarExcepcion(cta, fo);

  render();
  openModal('modal-corte-tarjeta');
}

async function guardarExcepcion() {
  const nuevaFecha = document.getElementById('exc-fecha-nueva').value;
  const nota       = document.getElementById('exc-nota').value;
  if (!nuevaFecha) { showToast('Ingresa la nueva fecha de corte'); return; }
  // Eliminar excepción previa para este período si existía
  excepciones = excepciones.filter(e =>
    !(e.Cuenta === window._excCuenta && e.FechaOriginal === window._excFechaOrig)
  );
  excepciones.push({
    Cuenta: window._excCuenta,
    FechaOriginal: window._excFechaOrig,
    FechaExcepcion: nuevaFecha,
    Nota: nota
  });
  await saveData();
  closeModal('modal-excepcion');
  showToast('Fecha de corte ajustada ✓');
  // Reabrir el modal del tarjeta con datos actualizados
  openCorteTarjeta(window._excCuenta);
}

async function eliminarExcepcion(cuenta, fechaOrig) {
  excepciones = excepciones.filter(e => !(e.Cuenta===cuenta && e.FechaOriginal===fechaOrig));
  await saveData();
  showToast('Excepción eliminada');
  openCorteTarjeta(cuenta);
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
        <span style="font-size:12px;font-weight:500;color:var(--purple)">${fmt(g.total)}</span>
      </div>`;
    }
    g.cuentas.forEach(c => {
      const s   = saldoCuenta(c);
      const pct = c.meta ? Math.min(100, Math.round(s/c.meta*100)) : 0;
      const ult = c.movimientos.slice(-3).reverse();
      const excluida = !!c.excluirTotal;
      html += `<div class="ahorro-card">
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
            <span class="${pos?'mov-pos':'mov-neg'}">${pos?'+':'-'}${fmt(m.cantidad)}</span>
          </div>`;
        }).join('')}</div>`:''}
        <div class="ahorro-btns">
          <button class="btn-abonar" onclick="openMovAhorro(${c.id},'abono')">+ Abonar</button>
          <button class="btn-retirar" onclick="openMovAhorro(${c.id},'retiro')">− Retirar</button>
          ${tieneOtras?`<button class="btn-retirar" onclick="openTraspaso(${c.id})" style="flex:none;padding:8px 12px;color:var(--green);border-color:var(--green)">⇄</button>`:''}
          <button class="btn-retirar" onclick="editarCuentaAhorro(${c.id})" style="flex:none;padding:8px 12px;color:var(--text2)">✏️</button>
          <button class="btn-retirar" onclick="eliminarCuenta(${c.id})" style="flex:none;padding:8px 12px;color:var(--red);border-color:var(--red)">🗑</button>
        </div>
      </div>`;
    });
  });
  el.innerHTML = html;
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
  c.movimientos.push({ tipo: movMode, cantidad, nota, fecha: today() });
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
  origen.movimientos.push({ tipo:'traspaso-out', cantidad, nota, destino:destinoId, fecha:f });
  destino.movimientos.push({ tipo:'traspaso-in',  cantidad, nota, origen:traspasoOrigenId, fecha:f });
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
    const items = bySem[sem].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)));
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
  const cantidad = parseFloat(document.getElementById('f-cantidad').value);
  if (!cantidad||cantidad<=0) { showToast('Ingresa una cantidad válida'); return; }

  // Verificar saldo si se descuenta de ahorro
  let ahorroSelId = null, ahorroSelNombre = '';
  if (descontarAhorro) {
    const sel = document.getElementById('f-ahorro-cuenta');
    ahorroSelId = parseInt(sel.value);
    const ca = cuentasAhorro.find(x=>x.id===ahorroSelId);
    if (!ca) { showToast('Selecciona una cuenta de ahorro'); return; }
    if (cantidad > saldoCuenta(ca)) { showToast(`Saldo insuficiente en ${ca.nombre}`); return; }
    ahorroSelNombre = ca.nombre;
  }

  const isEditing = !!editingId;
  const gasto = {
    id:          editingId || nextId++,
    fecha:       today(),
    cuenta:      document.getElementById('f-cuenta').value,
    motivo:      document.getElementById('f-motivo').value,
    cantidad,
    comentarios: document.getElementById('f-comentarios-input').value,
    abonado, ignorar, externo,
    semana:      getWeek(new Date()),
    ahorroDesc:  descontarAhorro ? ahorroSelNombre : '',
  };

  if (isEditing) {
    const idx = gastos.findIndex(x=>x.id===editingId);
    if (idx>=0) gastos[idx] = gasto;
  } else {
    gastos.push(gasto);
  }

  // Descontar del ahorro si aplica
  if (descontarAhorro && ahorroSelId && !isEditing) {
    const ca = cuentasAhorro.find(x=>x.id===ahorroSelId);
    if (ca) {
      ca.movimientos.push({
        tipo:'retiro', cantidad,
        nota:`Gasto: ${gasto.motivo}`,
        fecha: today()
      });
      await saveData();
    }
  } else {
    saveLocal();
  }


  resetForm(); editingId=null; showTab('gastos');
  showToast('Gasto guardado ✓');
}

function resetForm() {
  document.getElementById('f-cantidad').value    = '';
  document.getElementById('f-comentarios-input').value = ''; document.getElementById('comentario-dropdown').style.display='none';
  document.getElementById('f-cuenta').selectedIndex = 0;
  document.getElementById('f-motivo').selectedIndex  = 0;
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
      ${g.ignorar?'<span class="badge ignorar">🚫 Ignorado</span>'
        :iE?'<span class="badge ext">📤 Externo pendiente de cobro</span>'
        :iP?'<span class="badge ext-paid">✅ Externo cobrado</span>'
        :`<span class="badge ${g.abonado?'ab':'pend'}">${g.abonado?'✓ Abonado':'✗ Pendiente'}</span>`}
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
  setAb(g.abonado); setIg(g.ignorar||false); setExt(g.externo||'no'); setDescAhorro(false);
  TABS.forEach(t=>{
    document.getElementById('content-'+t).classList.remove('active');
    const te = document.getElementById('tab-'+t); if(te) te.classList.remove('active');
  });
  document.getElementById('content-nuevo').classList.add('active');
  document.getElementById('topbar-title').textContent='Editar Gasto';
}

function editar(id) {
  closeModal('modal-detail');
  const g = gastos.find(x=>x.id===id); if(!g) return;
  editingId=id;
  document.getElementById('f-cuenta').value      = g.cuenta;
  document.getElementById('f-motivo').value       = g.motivo;
  document.getElementById('f-cantidad').value     = g.cantidad;
  document.getElementById('f-comentarios-input').value = g.comentarios||'';
  setAb(g.abonado); setIg(g.ignorar||false); setExt(g.externo||'no'); setDescAhorro(false);
  TABS.forEach(t=>{
    document.getElementById('content-'+t).classList.remove('active');
    document.getElementById('tab-'+t).classList.remove('active');
  });
  document.getElementById('content-nuevo').classList.add('active');
  document.getElementById('tab-nuevo').classList.add('active');
  document.getElementById('topbar-title').textContent='Editar Gasto';
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
    version: 1, fecha: today(),
    gastos, historico, nextId, nextAhorroId,
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
  input.type  = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.gastos && !data.historico) throw new Error('Formato inválido');
      if (!confirm('¿Reemplazar todos los datos con este backup?')) return;
      if (data.gastos)              gastos            = data.gastos.map(normGasto);
      if (data.historico)           historico         = data.historico.map(normGasto);
      if (data.nextId)              nextId            = data.nextId;
      if (data.nextAhorroId)        nextAhorroId      = data.nextAhorroId;
      if (data.excepciones)         excepciones       = data.excepciones;
      if (data.catalogoCuentas)     catalogoCuentas   = data.catalogoCuentas;
      if (data.catalogoMotivos)     catalogoMotivos   = data.catalogoMotivos;
      if (data.catalogoComentarios) catalogoComentarios = data.catalogoComentarios.map(c => typeof c === "string" ? c : (c.nombre || c.Nombre || "")).filter(Boolean);
      if (data.cuentasAhorro)       cuentasAhorro     = data.cuentasAhorro.map(normAhorro);
      saveLocal();
      actualizarSelectCuentas(); actualizarSelectMotivos();
      showTab('menu');
      showToast('Backup restaurado ✓');
    } catch(e) { showToast('Error al leer el archivo'); }
  };
  input.click();
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
async function importarDesdeSheets() {
  const url = prompt('Pega la URL de tu Apps Script para importar datos de Google Sheets:');
  if (!url || !url.includes('script.google.com')) {
    showToast('URL inválida'); return;
  }
  document.getElementById('loading').style.display = 'flex';
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20000);
    const res    = await fetch(`${url}?action=getAll`, { signal: controller.signal });
    const result = await res.json();
    if (result.error) throw new Error(result.error);
    // Aplicar datos de Sheets
    if (result.semana)    gastos    = (result.semana   ||[]).map(normGasto);
    if (result.historico) historico = (result.historico||[]).map(normGasto);
    if (result.excepciones) excepciones = result.excepciones || [];
    if (result.ahorros && result.ahorros.length) {
      cuentasAhorro = result.ahorros.map(normAhorro);
      const ids = cuentasAhorro.map(c=>c.id).filter(Boolean);
      nextAhorroId = ids.length ? Math.max(...ids)+1 : 1;
    }
    const allIds = [...gastos,...historico].map(g=>Number(g.id)).filter(Boolean);
    nextId = allIds.length ? Math.max(...allIds)+1 : 1;
    if (result.catalogos) {
      if (result.catalogos.cuentas?.length)     catalogoCuentas     = result.catalogos.cuentas;
      if (result.catalogos.motivos?.length)     catalogoMotivos     = result.catalogos.motivos;
      if (result.catalogos.comentarios?.length) catalogoComentarios = result.catalogos.comentarios;
    }
    saveLocal();
    actualizarSelectCuentas(); actualizarSelectMotivos();
    showTab('menu');
    showToast(`Importado ${gastos.length} gastos + ${historico.length} histórico ✓`);
  } catch(e) {
    showToast('Error al importar: ' + e.message);
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}


// ════════════════════════════════════════════════════════════
//  NOTIFICACIONES DE CORTE PRÓXIMO
// ════════════════════════════════════════════════════════════
function verificarCortesProximos() {
  const cfg = getCortesConfig();
  const hoy = new Date();
  const alertas = [];
  Object.entries(cfg).forEach(([cuenta, c]) => {
    const { hasta } = getPeriodoActual(c, cuenta);
    const dias = Math.ceil((hasta - hoy) / 864e5);
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
  openModal('modal-ajustes');
}

function guardarAjustes() {
  const val = parseFloat(document.getElementById('ajuste-presupuesto').value);
  if (!val || val <= 0) { showToast('Ingresa un presupuesto válido'); return; }
  PRESUPUESTO = val;
  saveLocal();
  closeModal('modal-ajustes');
  renderMenu();
  showToast('Presupuesto actualizado ✓');
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
    const proxEst = diff < 0 ? `en ${30+diff} días (próx. mes)` : diff===0 ? '¡Hoy!' : diff===1 ? 'Mañana' : `en ${diff} días`;
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
        <button onclick="registrarRecurrente(${i})" style="flex:1;padding:7px;border-radius:8px;border:none;background:linear-gradient(135deg,var(--accent),#8b5cf6);color:white;font-size:11px;font-weight:600;cursor:pointer">✓ Registrar gasto</button>
        <button onclick="editarRecurrente(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:11px;cursor:pointer">✏️</button>
        <button onclick="eliminarRecurrente(${i})" style="padding:7px 10px;border-radius:8px;border:1px solid rgba(255,94,122,.3);background:transparent;color:var(--red);font-size:11px;cursor:pointer">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function registrarRecurrente(i) {
  const r = recurrentes[i];
  if (!r) return;
  // Pre-llenar formulario de nuevo gasto
  showTab('nuevo');
  setTimeout(() => {
    document.getElementById('f-cuenta').value           = r.cuenta;
    document.getElementById('f-motivo').value            = r.motivo;
    document.getElementById('f-cantidad').value          = r.cantidad;
    document.getElementById('f-comentarios-input').value = r.nombre;
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
  const alertas = recurrentes.filter(r => r.activo && r.dia >= hoy.getDate() && r.dia - hoy.getDate() <= 3);
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
  await saveData();
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
  await saveData();
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

async function guardarComentario_cat() {
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
  await saveData();
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

// ── Ocultar/mostrar total ahorrado ───────────────────────────
let ahorroVisible = true;
function toggleAhorroVisible() {
  ahorroVisible = !ahorroVisible;
  const blur = ahorroVisible ? '' : 'blur(8px)';
  // Elementos en pestaña Ahorros
  ['ahorro-big','ahorro-grupos-totales'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.filter = blur;
  });
  // Stat card del Menú
  const sAhorro = document.getElementById('s-ahorro');
  if (sAhorro) sAhorro.style.filter = blur;
  // Botón ojito (puede estar en menú o en ahorros)
  ['btn-eye-ahorro','btn-eye-menu'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = ahorroVisible ? '👁' : '🙈';
  });
}

// ── Init ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  try { loadFromLocal(); } catch(e) { console.error('Error cargando datos:', e); }
  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-app').style.display = 'flex';
  actualizarSelectCuentas();
  actualizarSelectMotivos();
  showTab('menu');
  document.addEventListener('click', cerrarDropdownComentario);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

  // Mostrar banner de recordatorio de actualizar
  mostrarBannerActualizar();

  // Sync en segundo plano con Sheets (no bloquea la UI)
  if (usingSheets()) {
    syncSheetsBackground().then(() => {
      ocultarBannerActualizar();
    });
  }
});

function mostrarBannerActualizar() {
  const banner = document.getElementById('banner-actualizar');
  if (!banner) return;
  const last = localStorage.getItem('lastSync');
  if (usingSheets()) {
    // Si tiene Sheets: mostrar "sincronizando..." y ocultar al terminar
    banner.style.display = 'flex';
    banner.innerHTML = `<span style="font-size:12px;color:var(--text2)">🔄 Sincronizando datos...</span>`;
  } else {
    // Sin Sheets: recordatorio de hacer backup
    const lastBackup = localStorage.getItem('lastBackup');
    if (!lastBackup) {
      banner.style.display = 'flex';
      banner.innerHTML = `<span style="font-size:12px;color:var(--text2)">💾 Sin backup reciente —</span>
        <button onclick="exportarBackup();ocultarBannerActualizar()" style="font-size:12px;color:var(--accent2);background:none;border:none;cursor:pointer;font-weight:600;padding:0 4px">Hacer backup</button>
        <button onclick="ocultarBannerActualizar()" style="font-size:12px;color:var(--text3);background:none;border:none;cursor:pointer;margin-left:4px">✕</button>`;
    }
  }
}

function ocultarBannerActualizar() {
  const banner = document.getElementById('banner-actualizar');
  if (banner) banner.style.display = 'none';
  mostrarEstadoSync(true);
}