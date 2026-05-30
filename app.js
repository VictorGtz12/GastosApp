// ════════════════════════════════════════════════════════════
//  GASTOS SEMANALES — app.js v3
// ════════════════════════════════════════════════════════════
const APP_VERSION = 'v2.43';
const SYNC_REPAIR_VERSION = 'savings-sync-stable-ids-v1';

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

// Catálogo de etiquetas (tags) — 2026
let catalogoTags = [
  '#comida','#viaje','#salud','#escuela','#trabajo','#regalo',
  '#casa','#transporte','#suscripcion','#ropa','#tecnologia','#mascotas'
];
let reglasAutomaticas = [
  { texto:'Amazon', cuenta:'', motivo:'Compra en Linea' },
  { texto:'Mercado Libre', cuenta:'', motivo:'Compra en Linea' },
  { texto:'Caffenio', cuenta:'', motivo:'Comida' },
  { texto:'Starbucks', cuenta:'', motivo:'Comida' },
  { texto:'Costco', cuenta:'', motivo:'Mandado' },
  { texto:'Walmart', cuenta:'', motivo:'Mandado' },
  { texto:'Apple', cuenta:'', motivo:'Servicios' },
  { texto:'HBO', cuenta:'', motivo:'Servicios' }
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
let ajustesPresupuesto = []; // [{semana, cantidad, ahorroId, ahorroNombre, fecha}]

let abonado = false;
let abonoTarjeta = false;
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
//  SINCRONIZACIÓN — Supabase estructurado
// ════════════════════════════════════════════════════════════

function isTravelMode() { return localStorage.getItem('modoViaje') === '1'; }
function hasPendingSync() {
  const lm = new Date(localStorage.getItem('localModified') || 0).getTime();
  const ls = new Date(localStorage.getItem('lastSync') || 0).getTime();
  const lsb = new Date(localStorage.getItem('lastSyncSupabase') || 0).getTime();
  return lm > Math.max(ls, lsb) + 3000 || getPendingSyncOps().length > 0;
}

// ── Supabase Sync ────────────────────────────────────────────
const SUPABASE_URL  = 'https://iskzbiozycpvnkkverfg.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_VXLcIr88JZDRMn7-k7XJUw_y4k9nceQ';
const SUPABASE_STRUCTURED_SCHEMA = 1;

function getSupabaseDeviceId() {
  let id = localStorage.getItem('supabaseDeviceId');
  if (!id) { id = 'device_' + Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem('supabaseDeviceId', id); }
  return id;
}
function usingSupabase() { return localStorage.getItem('supabaseEnabled') === '1'; }

function makeLocalId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getPendingSyncOps() {
  try { return JSON.parse(localStorage.getItem('pendingSyncOps') || '[]'); }
  catch(e) { return []; }
}

function setPendingSyncOps(ops) {
  localStorage.setItem('pendingSyncOps', JSON.stringify((ops || []).slice(-200)));
}

function queueSyncOperation(type, details = {}) {
  if (syncBloqueado) return;
  const ops = getPendingSyncOps();
  ops.push({ id: makeLocalId('op'), type, details, ts: new Date().toISOString(), deviceId: getSupabaseDeviceId() });
  setPendingSyncOps(ops);
}

function clearPendingSyncOps() {
  localStorage.removeItem('pendingSyncOps');
}

// ── Supabase estructurado ────────────────────────────────────
// Las tablas gs_* son la fuente remota principal; localStorage queda como cache offline.
let _structuredSupabaseAvailable = true;

function sbHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}

async function sbFetch(path, opts = {}) {
  const headers = sbHeaders(opts.headers || {});
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers });
  if (res.status === 404 || res.status === 400) {
    const txt = await res.text().catch(() => '');
    if (/relation .* does not exist|Could not find the table|schema cache/i.test(txt)) {
      _structuredSupabaseAvailable = false;
    }
    throw new Error(txt || `HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res;
}

function supabaseStructuredReady() {
  return usingSupabase() && _structuredSupabaseAvailable;
}

function structuredTouch(obj) {
  return { ...obj, updatedAt: obj.updatedAt || new Date().toISOString() };
}

function structuredRow(id, data, extra = {}) {
  const now = new Date().toISOString();
  return {
    id: String(id),
    data,
    updated_at: data.updatedAt || now,
    updated_by_device: getSupabaseDeviceId(),
    ...extra
  };
}

function structuredMovimientoId(cuentaId, movId, index = 0) {
  return `${cuentaId}:${movId}:${index}`;
}

function structuredMovimientoIndex(rowId) {
  const parts = String(rowId || '').split(':');
  const idx = Number(parts[2]);
  return Number.isFinite(idx) ? idx : 0;
}

function structuredMovimientoRowId(cuentaId, mov, index = 0) {
  if (mov?._syncId) return mov._syncId;
  if (mov?.uid) return `${cuentaId}:uid:${mov.uid}`;
  return structuredMovimientoId(cuentaId, mov?.movId, index);
}

function cleanMovimientoForStructured(mov, cuentaId) {
  const { _syncId, _syncIndex, ...data } = mov || {};
  return { ...data, cuentaId };
}

function getStructuredDeleted() {
  try { return JSON.parse(localStorage.getItem('supabaseStructuredDeleted') || '{}'); }
  catch(e) { return {}; }
}

function setStructuredDeleted(data) {
  localStorage.setItem('supabaseStructuredDeleted', JSON.stringify(data));
}

function markStructuredDeleted(table, id) {
  if (!id) return;
  const deleted = getStructuredDeleted();
  if (!deleted[table]) deleted[table] = [];
  const row = { id: String(id), deleted_at: new Date().toISOString(), updated_by_device: getSupabaseDeviceId() };
  deleted[table] = [row, ...deleted[table].filter(x => x.id !== row.id)].slice(0, 500);
  setStructuredDeleted(deleted);
}

function clearStructuredDeleted(table, ids) {
  const deleted = getStructuredDeleted();
  if (!deleted[table]) return;
  const done = new Set(ids.map(String));
  deleted[table] = deleted[table].filter(x => !done.has(String(x.id)));
  setStructuredDeleted(deleted);
}

function getStructuredDirty() {
  try { return JSON.parse(localStorage.getItem('supabaseStructuredDirty') || '{}'); }
  catch(e) { return {}; }
}

function markStructuredDirty(key) {
  const dirty = getStructuredDirty();
  dirty[key] = true;
  localStorage.setItem('supabaseStructuredDirty', JSON.stringify(dirty));
}

function clearStructuredDirty(keys) {
  const dirty = getStructuredDirty();
  keys.forEach(k => delete dirty[k]);
  localStorage.setItem('supabaseStructuredDirty', JSON.stringify(dirty));
}

function structuredLastSyncMs() {
  return Math.max(
    new Date(localStorage.getItem('lastSyncSupabase') || 0).getTime(),
    new Date(localStorage.getItem('lastSync') || 0).getTime()
  );
}

function filterIncrementalPayload(payload) {
  const lastSync = structuredLastSyncMs();
  const pendingOps = getPendingSyncOps();
  if (!lastSync) return null;
  if (pendingOps.some(op => op.type === 'corte' || op.type === 'restore' || op.type === 'import' || op.type === 'snapshot')) {
    return payload;
  }
  const dirty = getStructuredDirty();
  const changed = row => {
    const ts = row?.data?.updatedAt || row?.updated_at;
    return ts && new Date(ts).getTime() > lastSync - 5000;
  };
  return {
    ...payload,
    gastos: payload.gastos.filter(changed),
    cuentas: dirty.cuentas ? payload.cuentas : [],
    catalogos: dirty.catalogos ? payload.catalogos : [],
    cuentasAhorro: dirty.cuentasAhorro ? payload.cuentasAhorro : [],
    movimientosAhorro: payload.movimientosAhorro.filter(changed),
    recurrentes: dirty.recurrentes ? payload.recurrentes : [],
    deudas: dirty.deudas ? payload.deudas : [],
    settings: payload.settings
  };
}

function buildStructuredPayload() {
  const snap = buildSnapshot();
  const now = new Date().toISOString();
  const maxGastoId = Math.max(0, ...[...snap.gastos, ...snap.historico].map(g => Number(g.id) || 0));
  const maxMovId = Math.max(0, ...snap.cuentasAhorro.flatMap(c => (c.movimientos || []).map(m => Number(m.movId) || 0)));
  return {
    gastos: [
      ...snap.gastos.map(g => structuredRow(g.id, structuredTouch(g), { estado: 'activo', deleted_at: null })),
      ...snap.historico.map(g => structuredRow(g.id, structuredTouch(g), { estado: 'historico', deleted_at: null }))
    ],
    cuentas: snap.catalogoCuentas.map(c => structuredRow(c.nombre, c, { deleted_at: null })),
    catalogos: [
      ...snap.catalogoMotivos.map(m => structuredRow(`motivo:${m}`, { tipo: 'motivo', valor: m, updatedAt: now }, { tipo: 'motivo', valor: m, deleted_at: null })),
      ...snap.catalogoComentarios.map(c => structuredRow(`comentario:${c}`, { tipo: 'comentario', valor: c, updatedAt: now }, { tipo: 'comentario', valor: c, deleted_at: null })),
      ...(snap.catalogoTags || []).map(t => structuredRow(`tag:${t}`, { tipo: 'tag', valor: t, updatedAt: now }, { tipo: 'tag', valor: t, deleted_at: null })),
      ...snap.reglasAutomaticas.map((r, i) => structuredRow(`regla:${r.id || r.uid || `${r.texto || ''}:${r.cuenta || ''}:${r.motivo || ''}`}`, { ...r, tipo: 'regla', updatedAt: now }, { tipo: 'regla', valor: r.texto || String(i), deleted_at: null }))
    ],
    cuentasAhorro: snap.cuentasAhorro.map(c => {
      const { movimientos, ...cuenta } = c;
      return structuredRow(c.id, { ...cuenta, updatedAt: now }, { deleted_at: null });
    }),
    movimientosAhorro: snap.cuentasAhorro.flatMap(c => (c.movimientos || []).map((m, i) => {
      const rowId = structuredMovimientoRowId(c.id, m, i);
      return structuredRow(rowId, cleanMovimientoForStructured(m, c.id), { cuenta_id: String(c.id), mov_id: String(m.movId), deleted_at: null });
    })),
    recurrentes: snap.recurrentes.map(r => structuredRow(r.id, r, { deleted_at: null })),
    deudas: snap.deudas.map(d => structuredRow(d.id, d, { deleted_at: null })),
    settings: structuredRow('main', {
      schema: SUPABASE_STRUCTURED_SCHEMA,
      savedAt: snap.savedAt,
      nextId: Math.max(Number(snap.nextId) || 1, maxGastoId + 1),
      nextAhorroId: snap.nextAhorroId,
      nextRecId: snap.nextRecId,
      nextDeudaId: snap.nextDeudaId,
      nextMovId: Math.max(Number(snap.nextMovId) || 1, maxMovId + 1),
      presupuesto: snap.presupuesto,
      excepciones: snap.excepciones || [],
      ajustesPresupuesto: snap.ajustesPresupuesto || [],
      updatedAt: now
    }, {})
  };
}

function summarizeSnapshotForSync(snap = buildSnapshot()) {
  const savings = (snap.cuentasAhorro || []).map(c => ({
    id: c.id,
    nombre: c.nombre,
    movimientos: (c.movimientos || []).length,
    saldo: Number(saldoCuenta(c).toFixed(2))
  }));
  return {
    gastosActivos: (snap.gastos || []).length,
    historico: (snap.historico || []).length,
    totalGastos: (snap.gastos || []).length + (snap.historico || []).length,
    cuentasAhorro: savings.length,
    movimientosAhorro: savings.reduce((s, c) => s + c.movimientos, 0),
    saldoAhorro: Number(savings.reduce((s, c) => s + c.saldo, 0).toFixed(2)),
    nextId: snap.nextId,
    nextMovId: snap.nextMovId
  };
}

function summarizeRemoteRows(gRows, caRows, movRows, settingsRows) {
  const activeGastos = gRows.filter(r => !r.deleted_at && r.estado !== 'historico');
  const histGastos = gRows.filter(r => !r.deleted_at && r.estado === 'historico');
  const activeMovs = movRows.filter(r => !r.deleted_at);
  const saldoAhorro = activeMovs.reduce((sum, r) => {
    const m = r.data || {};
    const amount = Number(m.cantidad || 0);
    return sum + ((m.tipo === 'abono' || m.tipo === 'traspaso-in') ? amount : -amount);
  }, 0);
  const settings = settingsRows[0]?.data || {};
  return {
    gastosActivos: activeGastos.length,
    historico: histGastos.length,
    totalGastos: activeGastos.length + histGastos.length,
    cuentasAhorro: caRows.filter(r => !r.deleted_at).length,
    movimientosAhorro: activeMovs.length,
    saldoAhorro: Number(saldoAhorro.toFixed(2)),
    nextId: settings.nextId || 0,
    nextMovId: settings.nextMovId || 0
  };
}

function diffSyncSummaries(local, remote) {
  const labels = {
    gastosActivos: 'Gastos activos',
    historico: 'Histórico',
    totalGastos: 'Total gastos',
    cuentasAhorro: 'Cuentas ahorro',
    movimientosAhorro: 'Movimientos ahorro',
    saldoAhorro: 'Saldo ahorro',
    nextId: 'Siguiente gasto',
    nextMovId: 'Siguiente mov.'
  };
  return Object.keys(labels)
    .filter(k => String(local[k]) !== String(remote[k]))
    .map(k => ({ key: k, label: labels[k], local: local[k], remote: remote[k] }));
}

function validateStructuredPayload(payload, opts = {}) {
  const errors = [];
  const idsByEstado = {};
  (payload.gastos || []).forEach(row => {
    if (!row.id) errors.push('Hay un gasto sin ID.');
    if (!idsByEstado[row.id]) idsByEstado[row.id] = new Set();
    idsByEstado[row.id].add(row.estado || 'activo');
    if (!row.data?.fecha || !row.data?.cuenta || !row.data?.motivo || !(Number(row.data?.cantidad) > 0)) {
      errors.push(`Gasto ${row.id} incompleto o con cantidad inválida.`);
    }
  });
  Object.entries(idsByEstado).forEach(([id, estados]) => {
    if (estados.has('activo') && estados.has('historico')) errors.push(`Gasto ${id} existe activo e histórico a la vez.`);
  });
  const movimientoIds = new Set();
  (payload.movimientosAhorro || []).forEach(row => {
    if (!row.id) errors.push('Hay un movimiento de ahorro sin ID estable.');
    if (movimientoIds.has(row.id)) errors.push(`Movimiento de ahorro duplicado: ${row.id}`);
    movimientoIds.add(row.id);
    if (!row.cuenta_id || !row.data?.tipo || !(Number(row.data?.cantidad) > 0)) {
      errors.push(`Movimiento de ahorro ${row.id || '?'} incompleto.`);
    }
  });
  const maxGastoId = Math.max(0, ...(payload.gastos || []).map(r => Number(r.id) || 0));
  const maxMovId = Math.max(0, ...(payload.movimientosAhorro || []).map(r => Number(r.mov_id) || 0));
  const settings = payload.settings?.data || {};
  if (Number(settings.nextId || 0) <= maxGastoId) errors.push('nextId no puede ser menor o igual al gasto máximo.');
  if (Number(settings.nextMovId || 0) <= maxMovId) errors.push('nextMovId no puede ser menor o igual al movimiento máximo.');
  if (opts.full && (payload.cuentas || []).length === 0) errors.push('El catálogo de cuentas está vacío.');
  if (opts.full && (payload.catalogos || []).filter(r => r.tipo === 'motivo').length === 0) errors.push('El catálogo de motivos está vacío.');
  return errors;
}

async function sbUpsert(table, rows, onConflict = 'id') {
  if (!rows.length) return true;
  await sbFetch(`${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(rows)
  });
  return true;
}

async function sbSoftDelete(table, rows) {
  const done = [];
  for (const row of rows || []) {
    await sbFetch(`${table}?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        deleted_at: row.deleted_at,
        updated_at: row.deleted_at,
        updated_by_device: row.updated_by_device || getSupabaseDeviceId()
      })
    });
    done.push(row.id);
  }
  return done;
}

async function remoteStructuredSettings() {
  try {
    const rows = await sbSelect('gs_app_settings', 'select=data,updated_at&id=eq.main&limit=1');
    return rows[0] || null;
  } catch(e) {
    console.warn('Supabase settings guard error:', e.message);
    return null;
  }
}

function localPayloadLooksOlder(localSettings, remoteSettings) {
  const local = localSettings?.data || {};
  const remote = remoteSettings?.data || {};
  return Number(remote.nextId || 0) > Number(local.nextId || 0) ||
    Number(remote.nextAhorroId || 0) > Number(local.nextAhorroId || 0) ||
    Number(remote.nextMovId || 0) > Number(local.nextMovId || 0) ||
    Number(remote.nextRecId || 0) > Number(local.nextRecId || 0) ||
    Number(remote.nextDeudaId || 0) > Number(local.nextDeudaId || 0);
}

let _supabaseUploadLock = false;
let _supabaseUploadQueued = false;

async function uploadSupabaseStructured(opts = {}) {
  if (!supabaseStructuredReady()) return false;
  if (_supabaseUploadLock) {
    _supabaseUploadQueued = true;
    return true;
  }
  _supabaseUploadLock = true;
  mostrarEstadoSync(false, 'subiendo');
  let payload = buildStructuredPayload();
  const deleted = getStructuredDeleted();
  try {
    const remoteSettings = await remoteStructuredSettings();
    if (remoteSettings && localPayloadLooksOlder(payload.settings, remoteSettings)) {
      console.warn('[Sync Supabase] Cache local vieja: se descarga remoto antes de subir.');
      setTimeout(async () => {
        const ok = await downloadSupabase(true);
        if (ok) {
          actualizarSelectCuentas();
          actualizarSelectMotivos();
          renderMenu();
          showTab(tabActualGlobal);
          mostrarEstadoSync(true);
        }
      }, 50);
      return false;
    }
    if (!opts.full) {
      payload = filterIncrementalPayload(payload);
      if (!payload) {
        console.warn('[Sync Supabase] Sin marca de sync previa: se descarga remoto antes de subir.');
        setTimeout(() => downloadSupabase(true), 50);
        return false;
      }
    }
    const validationErrors = validateStructuredPayload(payload, { full: !!opts.full });
    if (validationErrors.length) {
      console.warn('[Sync Supabase] Subida bloqueada por validación:', validationErrors);
      localStorage.setItem('lastSyncError', validationErrors.slice(0, 5).join(' · '));
      mostrarEstadoSync(false, 'error');
      showToast('Sync bloqueado: datos inválidos. Revisa consola.');
      return false;
    }

    await Promise.all([
      sbUpsert('gs_gastos', payload.gastos),
      sbUpsert('gs_cuentas', payload.cuentas),
      sbUpsert('gs_catalogos', payload.catalogos),
      sbUpsert('gs_cuentas_ahorro', payload.cuentasAhorro),
      sbUpsert('gs_movimientos_ahorro', payload.movimientosAhorro),
      sbUpsert('gs_recurrentes', payload.recurrentes),
      sbUpsert('gs_deudas', payload.deudas),
      sbUpsert('gs_app_settings', [payload.settings])
    ]);

    const deleteMap = {
      gastos: 'gs_gastos',
      cuentasAhorro: 'gs_cuentas_ahorro',
      movimientosAhorro: 'gs_movimientos_ahorro',
      recurrentes: 'gs_recurrentes',
      deudas: 'gs_deudas',
      cuentas: 'gs_cuentas',
      catalogos: 'gs_catalogos'
    };
    const deleteResults = await Promise.all(Object.entries(deleteMap).map(async ([key, table]) => ({
      key,
      done: await sbSoftDelete(table, deleted[key] || [])
    })));
    deleteResults.forEach(({ key, done }) => {
      if (done.length) clearStructuredDeleted(key, done);
    });
    clearStructuredDirty(['cuentas', 'catalogos', 'cuentasAhorro', 'recurrentes', 'deudas']);

    const ts = new Date().toISOString();
    localStorage.setItem('lastSyncSupabase', ts);
    localStorage.setItem('lastStructuredSyncSupabase', ts);
    localStorage.setItem('lastSync', ts);
    localStorage.setItem('localModified', ts);
    localStorage.removeItem('lastSyncError');
    clearPendingSyncOps();
    registrarEntradaHistorialSync('subida', 'supabase');
    return true;
  } catch(e) {
    console.warn('Supabase structured upload error:', e.message);
    return false;
  } finally {
    _supabaseUploadLock = false;
    if (_supabaseUploadQueued) {
      _supabaseUploadQueued = false;
      setTimeout(() => uploadSupabaseStructured().then(ok => {
        if (ok) mostrarEstadoSync(true);
      }), 50);
    }
  }
}

async function sbSelect(table, query = 'select=*') {
  const res = await sbFetch(`${table}?${query}`, { headers: { 'Accept': 'application/json' } });
  return await res.json();
}

async function downloadSupabaseStructured(force = false) {
  if (!supabaseStructuredReady()) return false;
  mostrarEstadoSync(false, 'descargando');
  try {
    const [gRows, cRows, catRows, caRows, movRows, recRows, deudaRows, settingsRows] = await Promise.all([
      sbSelect('gs_gastos', 'select=id,estado,data,updated_at,deleted_at&order=updated_at.asc'),
      sbSelect('gs_cuentas', 'select=id,data,updated_at,deleted_at&order=updated_at.asc'),
      sbSelect('gs_catalogos', 'select=id,tipo,valor,data,updated_at,deleted_at&order=updated_at.asc'),
      sbSelect('gs_cuentas_ahorro', 'select=id,data,updated_at,deleted_at&order=updated_at.asc'),
      sbSelect('gs_movimientos_ahorro', 'select=id,cuenta_id,mov_id,data,updated_at,deleted_at&order=updated_at.asc'),
      sbSelect('gs_recurrentes', 'select=id,data,updated_at,deleted_at&order=updated_at.asc'),
      sbSelect('gs_deudas', 'select=id,data,updated_at,deleted_at&order=updated_at.asc'),
      sbSelect('gs_app_settings', 'select=id,data,updated_at&id=eq.main&limit=1')
    ]);

    const hasRemote = gRows.length || cRows.length || caRows.length || settingsRows.length;
    if (!hasRemote) return false;

    const remoteLatest = [
      ...gRows, ...cRows, ...catRows, ...caRows, ...movRows, ...recRows, ...deudaRows, ...settingsRows
    ].reduce((max, r) => Math.max(max, new Date(r.updated_at || r.data?.updatedAt || 0).getTime()), 0);
    const localModified = new Date(localStorage.getItem('localModified') || 0).getTime();
    const yaSync = !!localStorage.getItem('lastStructuredSyncSupabase');
    if (!force && yaSync && localModified > remoteLatest + 5000) {
      console.warn('[Sync Supabase estructurado] Local mas nuevo, no se descarga remoto viejo.');
      showSyncConflict({
        local: summarizeSnapshotForSync(),
        remote: summarizeRemoteRows(gRows, caRows, movRows, settingsRows),
        localModified,
        remoteLatest
      });
      return 'skip';
    }

    const activeRows = rows => rows.filter(r => !r.deleted_at).map(r => r.data);
    const remoteGastos = gRows.filter(r => !r.deleted_at).map(r => ({ ...r.data, _estado: r.estado }));
    gastos = remoteGastos.filter(g => g._estado !== 'historico').map(g => { delete g._estado; return normGasto(g); });
    historico = remoteGastos.filter(g => g._estado === 'historico').map(g => { delete g._estado; return normGasto(g); });

    if (cRows.length) catalogoCuentas = activeRows(cRows);
    const cats = catRows.filter(r => !r.deleted_at);
    const motivos = cats.filter(r => r.tipo === 'motivo').map(r => r.valor || r.data?.valor).filter(Boolean);
    const comentarios = cats.filter(r => r.tipo === 'comentario').map(r => r.valor || r.data?.valor).filter(Boolean);
    const tags = cats.filter(r => r.tipo === 'tag').map(r => r.valor || r.data?.valor).filter(Boolean);
    const reglas = cats.filter(r => r.tipo === 'regla').map(r => r.data).filter(Boolean);
    if (motivos.length) catalogoMotivos = [...new Set(motivos)];
    if (comentarios.length) catalogoComentarios = [...new Set(comentarios)];
    if (tags.length) catalogoTags = [...new Set(tags)];
    if (reglas.length) reglasAutomaticas = reglas.map(({ tipo, updatedAt, ...r }) => r);

    const movsByCuenta = {};
    movRows.filter(r => !r.deleted_at).forEach(r => {
      const cuentaId = Number(r.cuenta_id || r.data?.cuentaId);
      if (!movsByCuenta[cuentaId]) movsByCuenta[cuentaId] = [];
      const { cuentaId: _cuentaId, updatedAt, ...mov } = r.data || {};
      movsByCuenta[cuentaId].push({
        ...mov,
        updatedAt: updatedAt || r.updated_at || null,
        _syncId: String(r.id),
        _syncIndex: structuredMovimientoIndex(r.id)
      });
    });
    Object.keys(movsByCuenta).forEach(cuentaId => {
      movsByCuenta[cuentaId].sort((a, b) => {
        if (a._syncIndex !== b._syncIndex) return a._syncIndex - b._syncIndex;
        return Number(a.movId || 0) - Number(b.movId || 0);
      });
    });
    cuentasAhorro = caRows.filter(r => !r.deleted_at).map(r => normAhorro({
      ...r.data,
      movimientos: movsByCuenta[Number(r.id)] || []
    }));

    recurrentes = activeRows(recRows);
    deudas = activeRows(deudaRows);

    const settings = settingsRows[0]?.data || {};
    if (settings.nextId) nextId = settings.nextId;
    if (settings.nextAhorroId) nextAhorroId = settings.nextAhorroId;
    if (settings.nextRecId) nextRecId = settings.nextRecId;
    if (settings.nextDeudaId) nextDeudaId = settings.nextDeudaId;
    if (settings.nextMovId) nextMovId = settings.nextMovId;
    if (settings.presupuesto) PRESUPUESTO = settings.presupuesto;
    if (settings.excepciones) excepciones = settings.excepciones;
    if (settings.ajustesPresupuesto) ajustesPresupuesto = settings.ajustesPresupuesto;

    syncBloqueado = true;
    saveLocal();
    syncBloqueado = false;
    const ts = new Date().toISOString();
    localStorage.setItem('lastSyncSupabase', ts);
    localStorage.setItem('lastStructuredSyncSupabase', ts);
    localStorage.setItem('lastSync', ts);
    localStorage.setItem('localModified', ts);
    registrarEntradaHistorialSync('descarga', 'supabase');
    return true;
  } catch(e) {
    console.warn('Supabase structured download error:', e.message);
    return false;
  }
}

async function uploadSupabase() {
  if (!usingSupabase()) return false;
  return await uploadSupabaseStructured();
}

async function downloadSupabase(force = false) {
  if (!usingSupabase()) return false;
  const structured = await downloadSupabaseStructured(force);
  if (structured === 'skip') {
    console.warn('[Sync Supabase] Descarga omitida por cache local mas reciente; no se sube automaticamente.');
    return false;
  }
  return structured === true;
}

function showSyncConflict(info) {
  window._syncConflictInfo = info;
  localStorage.setItem('syncConflictPending', '1');
  const body = document.getElementById('sync-conflict-body');
  if (!body) return;
  const diffs = diffSyncSummaries(info.local, info.remote);
  const localTime = info.localModified ? new Date(info.localModified).toLocaleString('es-MX') : '—';
  const remoteTime = info.remoteLatest ? new Date(info.remoteLatest).toLocaleString('es-MX') : '—';
  body.innerHTML = `
    <div style="font-size:12px;color:var(--text2);margin-bottom:10px">
      El cache de este dispositivo parece más reciente que Supabase. Revisa diferencias antes de decidir.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:8px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Este dispositivo</div>
        <div style="font-size:12px;color:var(--text2)">${localTime}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:8px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Supabase</div>
        <div style="font-size:12px;color:var(--text2)">${remoteTime}</div>
      </div>
    </div>
    ${diffs.length ? diffs.map(d => `
      <div style="display:grid;grid-template-columns:1.2fr .9fr .9fr;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:12px;color:var(--text)">${d.label}</div>
        <div style="font-size:12px;color:var(--orange);text-align:right">${d.local}</div>
        <div style="font-size:12px;color:var(--green);text-align:right">${d.remote}</div>
      </div>`).join('') : '<div class="empty">No hay diferencias de conteo visibles.</div>'}
  `;
  openModal('modal-sync-conflict');
  mostrarEstadoSync(false, 'conflict');
}

async function resolverSyncConflict(accion) {
  closeModal('modal-sync-conflict');
  localStorage.removeItem('syncConflictPending');
  if (accion === 'download') {
    syncBloqueado = true;
    const ok = await downloadSupabaseStructured(true);
    syncBloqueado = false;
    if (ok) {
      actualizarSelectCuentas();
      actualizarSelectMotivos();
      renderMenu();
      showTab(tabActualGlobal);
      mostrarEstadoSync(true);
      showToast('Datos descargados desde Supabase ✓');
    }
    return;
  }
  if (accion === 'upload') {
    guardarBackupMinimo('antes-subir-conflicto');
    queueSyncOperation('snapshot', { reason: 'resolver-conflicto-subir-local' });
    const ok = await uploadSupabaseStructured({ full: true });
    showToast(ok ? 'Cache local subido a Supabase ✓' : 'No se pudo subir cache local');
  }
}

let _supabaseDownloadLock = false;

async function pullSupabaseIfIdle(render = false) {
  if (!usingSupabase() || isTravelMode() || !navigator.onLine || _supabaseDownloadLock || hasPendingSync()) return false;
  _supabaseDownloadLock = true;
  try {
    const ok = await downloadSupabase();
    if (ok && render) {
      actualizarSelectCuentas();
      actualizarSelectMotivos();
      renderMenu();
      showTab(tabActualGlobal);
      mostrarEstadoSync(true);
    }
    return ok;
  } finally {
    _supabaseDownloadLock = false;
  }
}

function buildSnapshot() {
  return {
    version:3, savedAt:new Date().toISOString(),
    gastos, historico, nextId, cuentasAhorro, nextAhorroId,
    excepciones, catalogoCuentas, catalogoMotivos, catalogoComentarios, catalogoTags, reglasAutomaticas,
    recurrentes, nextRecId, deudas, nextDeudaId, nextMovId, presupuesto:PRESUPUESTO,
    ajustesPresupuesto,
  };
}

function guardarBackupMinimo(reason = 'auto') {
  try {
    const snap = buildSnapshot();
    const backup = {
      id: makeLocalId('backup'),
      reason,
      savedAt: snap.savedAt,
      summary: summarizeSnapshotForSync(snap),
      data: {
        gastos: snap.gastos,
        historico: snap.historico,
        cuentasAhorro: snap.cuentasAhorro,
        nextId: snap.nextId,
        nextMovId: snap.nextMovId,
        nextAhorroId: snap.nextAhorroId,
        presupuesto: snap.presupuesto,
        ajustesPresupuesto: snap.ajustesPresupuesto
      }
    };
    const backups = JSON.parse(localStorage.getItem('backupsMinimos') || '[]');
    backups.unshift(backup);
    localStorage.setItem('backupsMinimos', JSON.stringify(backups.slice(0, 5)));
    return backup;
  } catch(e) {
    console.warn('No se pudo guardar backup mínimo:', e);
    return null;
  }
}

function applySnapshot(snap, opts = {}) {
  if (!snap || snap.version < 2) return false;

  // Proteccion: no sobrescribir datos locales mas nuevos con remotos mas viejos
  // EXCEPCIONES: forzado, local vacio, o dispositivo nunca ha sincronizado con este remoto
  const yaSync = !!localStorage.getItem('lastSync');
  if (!opts.force && gastos.length > 0 && snap.savedAt && yaSync) {
    const remoteSavedAt = new Date(snap.savedAt).getTime();
    const localSavedAt  = new Date(localStorage.getItem('lastSync') || 0).getTime();
    const localModified = new Date(localStorage.getItem('localModified') || 0).getTime();
    const localTs = Math.max(localSavedAt, localModified);
    if (remoteSavedAt < localTs - 5000) { // 5s de tolerancia
      console.warn('[Sync] Remoto mas antiguo que local, ignorando. Remoto:', snap.savedAt, 'Local:', new Date(localTs).toISOString());
      return 'skip';
    }
  }
  // Dispositivo nuevo (sin lastSync): siempre aplicar remoto
  if (!yaSync && gastos.length > 0) {
    console.log('[Sync] Dispositivo nuevo, aplicando remoto sin comparar timestamps');
  }

  // Guardar version anterior en historial antes de aplicar
  if (gastos.length > 0) guardarVersionHistorial('auto');
  if (snap.gastos)              gastos              = snap.gastos.map(normGasto);
  if (snap.historico)           historico           = snap.historico.map(normGasto);
  if (snap.nextId)              nextId              = snap.nextId;
  if (snap.cuentasAhorro)       cuentasAhorro       = snap.cuentasAhorro.map(normAhorro);
  if (snap.nextAhorroId)        nextAhorroId        = snap.nextAhorroId;
  if (snap.excepciones)         excepciones         = snap.excepciones;
  if (snap.catalogoCuentas)     catalogoCuentas     = snap.catalogoCuentas;
  if (snap.catalogoMotivos)     catalogoMotivos     = snap.catalogoMotivos;
  if (snap.catalogoComentarios) catalogoComentarios = snap.catalogoComentarios.map(c=>typeof c==='string'?c:(c.nombre||''));
  if (snap.catalogoTags)        catalogoTags        = snap.catalogoTags;
  if (snap.reglasAutomaticas)   reglasAutomaticas   = snap.reglasAutomaticas;
  if (snap.recurrentes)         recurrentes         = snap.recurrentes;
  if (snap.nextRecId)           nextRecId           = snap.nextRecId;
  if (snap.deudas)              deudas              = snap.deudas;
  if (snap.nextDeudaId)         nextDeudaId         = snap.nextDeudaId;
  if (snap.nextMovId)           nextMovId           = snap.nextMovId || 1;
  if (snap.presupuesto)         PRESUPUESTO         = snap.presupuesto;
  if (snap.ajustesPresupuesto)  ajustesPresupuesto  = snap.ajustesPresupuesto;
  return true;
}

// ── Historial de Sync ───────────────────────────────────────
function registrarEntradaHistorialSync(tipo, fuente = 'supabase') {
  try {
    const hist = JSON.parse(localStorage.getItem('syncHistorial') || '[]');
    const snap = buildSnapshot();
    hist.unshift({
      tipo,    // 'subida' | 'descarga'
      fuente,
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
      const fuenteLabel = 'Supabase';
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

function saveData(opts = {}) { saveLocal(); }

async function refreshData() {
  if (!navigator.onLine) {
    loadFromLocal(); actualizarSelectCuentas(); actualizarSelectMotivos();
    showTab(tabActualGlobal);
    mostrarEstadoSync(false);
    showToast('Sin internet: cambios guardados offline');
    return;
  }

  // Supabase sync (download primero, luego upload)
  if (usingSupabase()) {
    const down = await downloadSupabase();
    if (!localStorage.getItem('syncConflictPending')) {
      if (down || hasPendingSync()) await uploadSupabase();
    }
  }
  if (usingSupabase()) localStorage.setItem('localModified', localStorage.getItem('lastSyncSupabase') || new Date().toISOString());
  loadFromLocal();
  actualizarSelectCuentas(); actualizarSelectMotivos();
  showTab(tabActualGlobal);
  mostrarEstadoSync(true);
  showToast('Vista actualizada ✓');
}

function mostrarEstadoSync(ok, estado = null) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.style.display = 'inline'; el.style.cursor = 'pointer'; el.onclick = () => refreshData();
  if (estado === 'subiendo') {
    el.textContent = '⟳ Subiendo';
    el.style.color = 'var(--text3)';
    return;
  }
  if (estado === 'descargando') {
    el.textContent = '⟳ Descargando';
    el.style.color = 'var(--text3)';
    return;
  }
  if (estado === 'conflict') {
    el.textContent = '⚠️ Conflicto';
    el.style.color = 'var(--orange)';
    const b = document.getElementById('banner-pendientes'); if (b) b.style.display = 'flex';
    return;
  }
  if (estado === 'error') {
    el.textContent = '⚠️ Error sync';
    el.style.color = 'var(--red)';
    const b = document.getElementById('banner-pendientes'); if (b) b.style.display = 'flex';
    return;
  }
  if (isTravelMode()) {
    el.textContent = hasPendingSync() ? 'Modo viaje · sin subir' : 'Modo viaje';
    el.style.color = hasPendingSync() ? 'var(--orange)' : 'var(--accent2)';
    const b = document.getElementById('banner-pendientes');
    if (b) b.style.display = hasPendingSync() ? 'flex' : 'none';
    return;
  }
  const localMod = new Date(localStorage.getItem('localModified')||0).getTime();
  const lastSync = new Date(localStorage.getItem('lastSync')||0).getTime();
  const pendingOps = getPendingSyncOps();
  if (localMod > lastSync + 3000 || pendingOps.length) {
    el.textContent = pendingOps.length ? `⬆️ ${pendingOps.length} pendiente${pendingOps.length === 1 ? '' : 's'}` : '⬆️ Cambios sin subir';
    el.style.color = 'var(--orange)';
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

// Historial de versiones
const MAX_VERSIONES = 20;

function guardarVersionHistorial(origen) {
  try {
    const snap = buildSnapshot();
    snap.savedAt = new Date().toISOString();
    const versiones = JSON.parse(localStorage.getItem('versionHistorial') || '[]');
    const entry = {
      savedAt:   snap.savedAt,
      origen:    origen || 'manual',
      gastos:    snap.gastos.length,
      historico: snap.historico.length,
      snap:      JSON.stringify(snap)
    };
    versiones.unshift(entry);
    localStorage.setItem('versionHistorial', JSON.stringify(versiones.slice(0, MAX_VERSIONES)));
  } catch(e) { console.warn('Error guardando version:', e); }
}

async function verVersionHistorial() {
  const body = document.getElementById('version-historial-body');
  if (!body) return;
  body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3)">Cargando...</div>';
  openModal('modal-version-historial');

  const local = JSON.parse(localStorage.getItem('versionHistorial') || '[]');
  const localMarcadas = local.map(v => ({...v, _fuente: 'local'}));
  const todas = [...localMarcadas];
  todas.sort((a,b) => b.savedAt.localeCompare(a.savedAt));
  window._versionesCache = todas;

  if (!todas.length) { body.innerHTML = '<div class="empty">Sin versiones guardadas</div>'; return; }

  body.innerHTML = todas.map((v, i) => {
    const fecha = new Date(v.savedAt);
    const hora  = fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const dia   = fecha.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    const ico   = v._fuente === 'supabase' ? 'Supabase' : 'Local';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text)">${dia} ${hora}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">${ico} - ${v.gastos} gastos - ${v.origen||'auto'}</div>
        </div>
        <button onclick="restaurarVersionCache(${i})" style="padding:5px 12px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent2);font-size:11px;cursor:pointer;font-weight:600">Restaurar</button>
      </div>
    </div>`;
  }).join('');
}

function restaurarVersionCache(idx) {
  const v = window._versionesCache?.[idx];
  if (!v) return;
  const fecha = new Date(v.savedAt).toLocaleString('es-MX');
  if (!confirm('Restaurar version del ' + fecha + '?')) return;
  guardarVersionHistorial('manual');
  const snap = JSON.parse(v.snap);
  const ok = applySnapshot(snap, { force: true });
  if (ok && ok !== 'skip') {
    saveLocal(); closeModal('modal-version-historial'); showTab(tabActualGlobal || 'menu');
    showToast('Version restaurada');
    setTimeout(() => { uploadSupabase(); }, 1500);
  }
}

function restaurarVersion(idx) {
  const versiones = JSON.parse(localStorage.getItem('versionHistorial') || '[]');
  const v = versiones[idx];
  if (!v) return;
  const fecha = new Date(v.savedAt).toLocaleString('es-MX');
  if (!confirm('Restaurar version del ' + fecha + '?')) return;
  guardarVersionHistorial('manual');
  const snap = JSON.parse(v.snap);
  const ok = applySnapshot(snap, { force: true });
  if (ok && ok !== 'skip') {
    saveLocal();
    closeModal('modal-version-historial');
    showTab(tabActualGlobal || 'menu');
    showToast('Version restaurada');
    setTimeout(() => { uploadSupabase(); }, 1500);
  }
}

function limpiarVersionHistorial() {
  if (!confirm('Limpiar todo el historial de versiones?')) return;
  localStorage.removeItem('versionHistorial');
  verVersionHistorial();
}

// Exportar conciliacion
function exportarConciliacion() {
  const clave = `${concilCuenta}|${concilPeriodo}`;
  const [, hasta] = concilPeriodo.split('|');
  const desde = periodoDesde(concilPeriodo);
  const all = [...gastos, ...historico];
  const items = gastosEnPeriodo(all, concilCuenta,
    new Date(desde + 'T00:00:00'), new Date(hasta + 'T23:59:59'));

  // Cabecera
  const rows = [
    ['Conciliacion Bancaria - ' + concilCuenta],
    ['Periodo: ' + desde + ' a ' + hasta],
    ['Generado: ' + new Date().toLocaleDateString('es-MX')],
    [],
    // Gastos en app
    ['GASTOS EN APP'],
    ['Estado', 'Fecha', 'Motivo', 'Comentarios', 'Monto'],
    ...items.map(g => [
      conciliados[clave]?.[g.id] ? 'Conciliado' : 'Pendiente',
      g.fecha, g.motivo, g.comentarios || '', g.cantidad
    ]),
    [],
    // Movimientos banco
    ['MOVIMIENTOS EN BANCO'],
    ['Fecha', 'Descripcion', 'Monto'],
    ...(window._bancMovs || []).map(m => [m.fecha, m.descripcion, m.monto]),
    [],
    // No encontrados
    ['EN BANCO SIN REGISTRAR'],
    ['Fecha', 'Descripcion', 'Monto'],
    ...(window._noConcilBanco || []).map(m => [m.fecha, m.descripcion, m.monto]),
  ];

  // Generar CSV
  const csv = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'conciliacion-' + concilCuenta + '-' + hasta + '.csv';
  a.click(); URL.revokeObjectURL(url);
  showToast('Conciliacion exportada');
}

// Alertas de corte
async function solicitarPermisosNotificacion() {
  if (!('Notification' in window)) { showToast('Tu navegador no soporta notificaciones'); return false; }
  if (Notification.permission === 'granted') return true;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

async function programarAlertasCorte() {
  const ok = await solicitarPermisosNotificacion();
  if (!ok) { showToast('Activa las notificaciones para recibir alertas'); return; }
  // Abrir modal de configuracion
  const cfg = getCortesConfig();
  const cuentas = Object.keys(cfg);
  const alertCfg = JSON.parse(localStorage.getItem('alertasConfig') || '{}');

  // Render cuentas checkboxes
  const elCuentas = document.getElementById('alertas-cuentas');
  if (elCuentas) {
    elCuentas.innerHTML = '<div style="font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Tarjetas</div>' +
      cuentas.map(c => {
        const checked = alertCfg[c] !== false;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <input type="checkbox" id="alerta-${c}" ${checked?'checked':''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)">
          <label for="alerta-${c}" style="font-size:13px;cursor:pointer;flex:1">${c}</label>
        </div>`;
      }).join('');
  }

  // Render dias chips
  const diasSeleccionados = JSON.parse(localStorage.getItem('alertasDias') || '[1,3]');
  const opcionesDias = [1,2,3,5,7,10,14];
  const elDias = document.getElementById('alertas-dias-chips');
  if (elDias) {
    elDias.innerHTML = opcionesDias.map(d =>
      `<div class="chip ${diasSeleccionados.includes(d)?'active':''}" id="alerta-dia-${d}"
        onclick="toggleAlertaDia(${d})"
        style="padding:6px 14px;border-radius:20px;border:1px solid var(--border2);background:${diasSeleccionados.includes(d)?'var(--accent)':'var(--bg3)'};color:${diasSeleccionados.includes(d)?'white':'var(--text2)'};font-size:12px;cursor:pointer;font-weight:500">
        ${d} dia${d>1?'s':''}
      </div>`
    ).join('');
  }

  // Hora guardada
  const hora = localStorage.getItem('alertasHora') || '09:00';
  const elHora = document.getElementById('alertas-hora');
  if (elHora) elHora.value = hora;

  openModal('modal-alertas');
}

function toggleAlertaDia(d) {
  const dias = JSON.parse(localStorage.getItem('alertasDias') || '[1,3]');
  const idx = dias.indexOf(d);
  if (idx >= 0) dias.splice(idx, 1); else dias.push(d);
  localStorage.setItem('alertasDias', JSON.stringify(dias));
  // Update chip style
  const el = document.getElementById('alerta-dia-' + d);
  if (el) {
    const activo = dias.includes(d);
    el.style.background = activo ? 'var(--accent)' : 'var(--bg3)';
    el.style.color = activo ? 'white' : 'var(--text2)';
    el.style.borderColor = activo ? 'var(--accent)' : 'var(--border2)';
  }
}

async function guardarAlertasCorte() {
  const cfg = getCortesConfig();
  const cuentas = Object.keys(cfg);
  const dias = JSON.parse(localStorage.getItem('alertasDias') || '[1,3]');
  const hora = document.getElementById('alertas-hora')?.value || '09:00';
  const [hh, mm] = hora.split(':').map(Number);

  // Guardar config de cuentas
  const alertCfg = {};
  cuentas.forEach(c => {
    alertCfg[c] = document.getElementById('alerta-' + c)?.checked !== false;
  });
  localStorage.setItem('alertasConfig', JSON.stringify(alertCfg));
  localStorage.setItem('alertasHora', hora);

  if (!dias.length) { showToast('Selecciona al menos un dia de anticipacion'); return; }

  const sw = navigator.serviceWorker?.controller;
  let programadas = 0;

  cuentas.forEach(cuenta => {
    if (alertCfg[cuenta] === false) return;
    const key = getPeriodoActualKey(cuenta);
    if (!key) return;
    const hasta = key.split('|')[1];
    if (!hasta) return;
    const fechaCorte = new Date(hasta + 'T12:00:00');

    dias.forEach(d => {
      const alertDate = new Date(fechaCorte);
      alertDate.setDate(alertDate.getDate() - d);
      alertDate.setHours(hh, mm, 0, 0);
      const delay = alertDate - Date.now();
      if (delay <= 0) return;
      const title = 'Corte de ' + cuenta + ' en ' + d + ' dia' + (d > 1 ? 's' : '');
      const body  = 'Tu corte es el ' + hasta + '. Revisa tus gastos pendientes.';
      if (sw) {
        sw.postMessage({ type: 'SCHEDULE_NOTIFICATION', title, body, delay, tag: 'corte-'+cuenta+'-'+d });
      } else {
        setTimeout(() => new Notification(title, { body, icon: 'icon-192.png' }), delay);
      }
      programadas++;
    });
  });

  closeModal('modal-alertas');
  showToast(programadas + ' alerta' + (programadas !== 1 ? 's' : '') + ' de corte programada' + (programadas !== 1 ? 's' : ''));
}

// Indicador offline
function actualizarEstadoRed() {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (isTravelMode()) {
    mostrarEstadoSync(false);
    return;
  }
  if (!navigator.onLine) {
    el.style.display = 'inline'; el.style.cursor = 'default'; el.onclick = null;
    el.textContent = 'Sin internet'; el.style.color = 'var(--red)';
  } else {
    mostrarEstadoSync(true);
  }
}
window.addEventListener('online',  () => { actualizarEstadoRed(); if (!isTravelMode() && typeof syncUp === 'function') syncUp(); });
window.addEventListener('offline', () => actualizarEstadoRed());
window.addEventListener('focus', () => { pullSupabaseIfIdle(true); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') pullSupabaseIfIdle(true);
});

let syncBloqueado = false;

function iniciarAutoSync() {
  if (!usingSupabase() || isTravelMode()) return;
  // Respaldo: reintenta subidas pendientes y trae cambios de otros dispositivos.
  setInterval(async () => {
    if (syncBloqueado || isTravelMode() || !navigator.onLine) return;
    const lm = new Date(localStorage.getItem('localModified')||0).getTime();
    const ls = new Date(localStorage.getItem('lastSync')||0).getTime();
    if (lm > ls + 3000) {
      const up = await uploadSupabase();
      if (up) mostrarEstadoSync(true);
    } else {
      await pullSupabaseIfIdle(true);
    }
  }, 15 * 1000);
}




// ════════════════════════════════════════════════════════════
//  ALMACENAMIENTO LOCAL — localStorage
// ════════════════════════════════════════════════════════════

function saveLocal() {
  try {
    const data = {
      gastos, historico, nextId, nextAhorroId,
      cuentasAhorro, excepciones,
      catalogoCuentas, catalogoMotivos, catalogoComentarios, reglasAutomaticas,
      presupuesto: PRESUPUESTO,
      recurrentes, nextRecId, deudas, nextDeudaId, nextMovId,
      ajustesPresupuesto,
    };
    localStorage.setItem('appData_v1', JSON.stringify(data));
    const ts = new Date().toISOString();
    localStorage.setItem('localModified', ts);
    if (!syncBloqueado) queueSyncOperation('snapshot', { tab: tabActualGlobal || 'menu' });
    // Sincronizar automáticamente en segundo plano
    if (!syncBloqueado) {
      if (isTravelMode() || !navigator.onLine) {
        mostrarEstadoSync(false);
        return;
      }
      clearTimeout(window._autoSyncTimer);
      window._autoSyncTimer = setTimeout(async () => {
        if (isTravelMode() || !navigator.onLine) return;
        // Dispositivo nuevo: no subir hasta que se descargue primero
        if (!localStorage.getItem('lastSync') && !localStorage.getItem('lastSyncSupabase') && usingSupabase()) return;
        // No subir si no hay cambios reales desde el último sync
        if (!hasPendingSync()) { mostrarEstadoSync(true); return; }
        const up = usingSupabase() ? await uploadSupabase() : true;
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
      }, 50); // casi inmediato, sin bloquear el render del guardado
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
      if (data.catalogoTags)        catalogoTags        = data.catalogoTags;
  if (data.catalogoComentarios) catalogoComentarios = data.catalogoComentarios.map(c => typeof c === 'string' ? c : (c.nombre || c.Nombre || '')).filter(Boolean);
      if (data.reglasAutomaticas)   reglasAutomaticas   = data.reglasAutomaticas;
      if (data.cuentasAhorro)       cuentasAhorro       = data.cuentasAhorro.map(normAhorro);
      if (data.presupuesto)         PRESUPUESTO         = data.presupuesto;
      if (data.recurrentes)         recurrentes         = data.recurrentes  || [];
      if (data.nextRecId)           nextRecId           = data.nextRecId;
      if (data.deudas)              deudas              = data.deudas       || [];
    if (data.nextDeudaId)         nextDeudaId         = data.nextDeudaId;
    if (data.nextMovId)           nextMovId           = data.nextMovId || 1;
    if (data.ajustesPresupuesto)  ajustesPresupuesto  = data.ajustesPresupuesto;
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
    reembolsoPersona: x.reembolsoPersona || x.ReembolsoPersona || '',
    reembolsoFecha:   x.reembolsoFecha || x.ReembolsoFecha || '',
    reembolsoNota:    x.reembolsoNota || x.ReembolsoNota || '',
    semana:       x.semana || x.Semana || getWeek(new Date()),
    ahorroDesc:   x.ahorroDesc || x.AhorroDesc || '',
    periodoCorte: x.periodoCorte || null,
    updatedAt:    x.updatedAt || null,
    tags:         x.tags || [],
    abonoTarjeta: x.abonoTarjeta === true,
  };
}

function normAhorro(c) {
  const excluir = c.excluirTotal === true || c.excluirTotal === 'SI' || c.excluirTotal === 'true';
  // Si no hay nextMovId global, asignar uno inicial
  if (typeof nextMovId === 'undefined' || nextMovId < 1) nextMovId = 1;
  const rawMovimientos = c.movimientos || c.mv || [];
  return {
    id:           c.id || c.ID,
    nombre:       c.nombre || c.Nombre || c.no || '',
    meta:         Number(c.meta || c.Meta || c.me) || 0,
    grupo:        c.grupo || c.Grupo || c.gr || 'General',
    excluirTotal: excluir,
    movimientos:  rawMovimientos.map(m => ({
      tipo:     m.tipo || m.ti || '',
      cantidad: Number(m.cantidad ?? m.ca) || 0,
      nota:     m.nota ?? m.nt ?? '',
      fecha:    String(m.fecha || m.fe || '').slice(0, 10),
      destino:  m.destino ? Number(m.destino) : undefined,
      origen:   m.origen  ? Number(m.origen)  : undefined,
      gastoId:  m.gastoId,
      uid:      m.uid,
      updatedAt: m.updatedAt || null,
      _syncId:  m._syncId,
      _syncIndex: m._syncIndex,
      movId:    m.movId ?? nextMovId++, // ← asignar movId faltante (nullish coalescing)
    })),
  };
}


// ── Navegación ────────────────────────────────────────────────
const TABS = ['menu','gastos','nuevo','externos','cortes','ahorros','dashboard','historico','catalogos','recurrentes','conciliacion'];
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
    ahorros:'Mis Ahorros', dashboard:'Dashboard',
    historico:'Historial',
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
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'conciliacion') renderConciliacion();
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard() {
  // Widgets
  const totAhorro = cuentasAhorro.filter(c => !c.excluirTotal).reduce((s, c) => s + saldoCuenta(c), 0);
  document.getElementById('dashboard-ahorro-total').textContent = fmt(totAhorro);

  const ahora = new Date();
  const mesAct = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
  const gastosMes = [...gastos, ...historico].filter(g => g.fecha && g.fecha.startsWith(mesAct) && !g.ignorar);
  const totalMes = gastosMes.reduce((s, g) => s + g.cantidad, 0);
  document.getElementById('dashboard-gasto-mensual').textContent = fmt(totalMes);

  const deudasAct = deudas.filter(d => (d.mesesPagados || 0) < (d.mesesTotal || 1));
  const totalDeuda = deudasAct.reduce((s, d) => s + (d.mesesTotal - (d.mesesPagados || 0)) * (d.cuota || 0), 0);
  document.getElementById('dashboard-deuda-total').textContent = fmt(totalDeuda);

  // Gastos hoy
  const hoy = new Date().toISOString().slice(0, 10);
  const gastosHoy = gastos.filter(g => g.fecha === hoy && !g.ignorar);
  document.getElementById('dashboard-gastos-hoy').textContent = fmt(gastosHoy.reduce((s, g) => s + g.cantidad, 0));
  document.getElementById('dashboard-gastos-hoy-count').textContent = `${gastosHoy.length} gasto${gastosHoy.length !== 1 ? 's' : ''}`;

  // Cortes próximos (7 días)
  const cfg = getCortesConfig();
  const cortesProx = Object.entries(cfg).map(([cuenta]) => {
    const key = getPeriodoActualKey(cuenta);
    if (!key) return null;
    const hasta = key.split('|')[1];
    if (!hasta) return null;
    const dias = Math.ceil((new Date(hasta + 'T12:00:00') - new Date()) / 864e5);
    if (dias < 0 || dias > 7) return null;
    return { cuenta, dias, hasta };
  }).filter(Boolean).sort((a, b) => a.dias - b.dias);

  const elCortes = document.getElementById('dashboard-cortes-proximos');
  if (cortesProx.length) {
    elCortes.innerHTML = cortesProx.map(c =>
      `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px">
        <span>${c.cuenta}</span>
        <span style="color:${c.dias === 0 ? 'var(--red)' : 'var(--orange)'}">${c.dias === 0 ? 'Hoy' : c.dias + ' día' + (c.dias > 1 ? 's' : '')}</span>
      </div>`
    ).join('');
  } else {
    elCortes.innerHTML = '<div style="font-size:12px;color:var(--text3)">Sin cortes próximos</div>';
  }

  // Gráficas Chart.js
  setTimeout(() => {
    renderGraficosDashboard();
  }, 100);
}

// ── Gráficas del Dashboard (Chart.js) ─────────────────────────
function renderGraficosDashboard() {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js no disponible; se omiten gráficas.');
    return;
  }
  renderChartGastoMensual();
  renderChartGastoPorCategoria();
  renderChartEgresosUltimos();
  renderChartAhorroHistorico();
}

function renderChartGastoMensual() {
  const ctx = document.getElementById('chart-gasto-mensual');
  if (!ctx) return;
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const ahora = new Date();
  const data = [], labels = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(`${meses[d.getMonth()]} ${d.getFullYear()}`);
      data.push([...gastos, ...historico].filter(g => g.fecha && g.fecha.startsWith(m) && !g.ignorar)
      .reduce((s, g) => s + g.cantidad, 0));
  }
  if (window._chartGastoMensual) window._chartGastoMensual.destroy();
  window._chartGastoMensual = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Gasto mensual', data, backgroundColor: 'rgba(14,165,233,0.6)', borderColor: 'rgba(14,165,233,1)', borderWidth: 2, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '$' + fmt(ctx.parsed.y) } } },
      scales: { y: { ticks: { callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0)) }, grid: { color: 'rgba(255,255,255,0.04)' } }, x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 9 } } } } }
  });
}

function renderChartGastoPorCategoria() {
  const ctx = document.getElementById('chart-gasto-categoria');
  if (!ctx) return;
  const ahora = new Date();
  const mesAct = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
  const gastosMes = [...gastos, ...historico].filter(g => g.fecha && g.fecha.startsWith(mesAct) && !g.ignorar);
  const cats = {};
  gastosMes.forEach(g => { if (!cats[g.motivo]) cats[g.motivo] = 0; cats[g.motivo] += g.cantidad; });
  const colors = ['#0ea5e9','#8b5cf6','#f59e0b','#ef4444','#22c55e','#ec4899','#14b8a6','#f97316','#6366f1','#84cc16','#06b6d4','#d946ef','#10b981','#eab308','#3b82f6'];
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (window._chartGastoCat) window._chartGastoCat.destroy();
  window._chartGastoCat = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: colors.slice(0, entries.length), borderWidth: 2, borderColor: 'var(--bg)' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 10 }, boxWidth: 12, boxHeight: 12 } }, tooltip: { callbacks: { label: ctx => { const t = ctx.dataset.data.reduce((a,b)=>a+b,0); return ctx.label + ': $' + fmt(ctx.parsed) + ' (' + ((ctx.parsed/t)*100).toFixed(1) + '%)'; } } } }, cutout: '60%' }
  });
}

function renderChartEgresosUltimos() {
  const ctx = document.getElementById('chart-egresos');
  if (!ctx) return;
  const labels = [], data = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const str = d.toISOString().slice(0, 10);
    labels.push(str.slice(5));
    data.push(gastos.filter(g => g.fecha === str && !g.ignorar).reduce((s, g) => s + g.cantidad, 0));
  }
  if (window._chartEgresos) window._chartEgresos.destroy();
  window._chartEgresos = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Gastos diarios', data, borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => '$' + fmt(ctx.parsed.y) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0)) }, grid: { color: 'rgba(255,255,255,0.04)' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 15, font: { size: 8 } } } } }
  });
}

function renderChartAhorroHistorico() {
  const ctx = document.getElementById('chart-ahorro');
  if (!ctx) return;
  const ahora = new Date();
  const labels = [], data = [];
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    labels.push(`${meses[d.getMonth()]} ${d.getFullYear()}`);
    const mesKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const ingresos = gastos.filter(g => g.fecha && g.fecha.startsWith(mesKey) && g.abonado && !g.ignorar).reduce((s,g)=>s+g.cantidad,0);
    const egresos  = gastos.filter(g => g.fecha && g.fecha.startsWith(mesKey) && !g.abonado && !g.ignorar).reduce((s,g)=>s+g.cantidad,0);
    const acum = data.length > 0 ? data[data.length-1] + (ingresos - egresos) : (ingresos - egresos);
    data.push(Math.max(0, acum));
  }
  if (window._chartAhorro) window._chartAhorro.destroy();
  window._chartAhorro = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Ahorro acumulado', data, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { size: 10 }, boxWidth: 12, boxHeight: 12 } }, tooltip: { callbacks: { label: ctx => '$' + fmt(ctx.parsed.y) } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0)) }, grid: { color: 'rgba(255,255,255,0.04)' } }, x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 9 } } } } }
  });
}

// ── Menú ──────────────────────────────────────────────────────
function renderMenu() {
  const activos = gastos.filter(g => !g.ignorar);
  const total   = activos.reduce((s, g) => s + g.cantidad, 0);
  // Calcular presupuesto ajustado: suma ACUMULADA de todos los aumentos, sin filtrar por semana
  const ajusteSemana = (ajustesPresupuesto || [])
    .reduce((s, a) => s + a.cantidad, 0);
  const presupuestoAjustado = PRESUPUESTO + ajusteSemana;
  const pct     = Math.min(100, Math.round(total / presupuestoAjustado * 100));
  const disp    = Math.max(0, presupuestoAjustado - total);
  const extPend = [...gastos, ...historico].filter(g => g.externo === 'externo').reduce((s,g) => s+g.cantidad, 0);
  const totA    = cuentasAhorro.filter(c=>!c.excluirTotal).reduce((s, c) => s + saldoCuenta(c), 0);

  document.getElementById('s-total').textContent = fmt(total);
  const dispEl = document.getElementById('s-disp');
  dispEl.textContent  = fmt(disp);
  dispEl.className = 'stat-val ' + (disp < 500 ? 'red' : 'green');
  dispEl.style.cursor = 'pointer';
  dispEl.onclick = () => abrirAumentarPresupuesto();
  dispEl.title = 'Toca para aumentar presupuesto desde ahorro';
  document.getElementById('s-ext').textContent    = fmt(extPend);
  document.getElementById('s-ahorro').textContent = fmt(totA);
  document.getElementById('p-nums').textContent   = fmt(total) + ' / ' + fmt(presupuestoAjustado);

  const fill = document.getElementById('p-fill');
  fill.style.width  = pct + '%';
  fill.className    = 'progress-fill' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '');
  document.getElementById('p-pct').textContent   = pct + '% usado';
  const restaEl = document.getElementById('p-resta');
  if (ajusteSemana > 0) {
    restaEl.innerHTML = 'Resta ' + fmt(disp) + ' <span style="font-size:10px;color:var(--accent2)">(+' + fmt(ajusteSemana) + ' ajustado)</span>';
  } else {
    restaEl.textContent = 'Resta ' + fmt(disp);
  }
  // Hacer clic en Resta para abrir modal de aumentar presupuesto
  restaEl.style.cursor = 'pointer';
  restaEl.onclick = () => abrirAumentarPresupuesto();
  restaEl.title = 'Toca para aumentar presupuesto desde ahorro';

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
  const histPendientes = historico
    .filter(g => !g.abonado && !g.ignorar && g.externo === 'no')
    .map(g => ({...g, _esHistorico: true, _histPendiente: true}));
  const histAlert = document.getElementById('gastos-hist-pend-alert');
  const histAlertText = document.getElementById('gastos-hist-pend-text');
  if (histAlert) {
    histAlert.style.display = histPendientes.length && activeFilter !== 'hist-pendiente' ? 'flex' : 'none';
    if (histAlertText) {
      const totalHistPend = histPendientes.reduce((s, g) => s + Number(g.cantidad || 0), 0);
      histAlertText.textContent = `${histPendientes.length} pendiente${histPendientes.length !== 1 ? 's' : ''} por ${fmt(totalHistPend)}`;
    }
  }

  let list = gastos.filter(g => {
    if (activeFilter === 'pendiente') return !g.abonado;
    if (activeFilter === 'abonado')   return g.abonado;
    if (activeFilter === 'ignorar')   return g.ignorar;
    if (activeFilter === 'externo')   return g.externo !== 'no';
    if (activeFilter === 'hist-pendiente') return false;
    return true;
  }).filter(g => !q ||
    g.motivo.toLowerCase().includes(q) ||
    g.cuenta.toLowerCase().includes(q) ||
    (g.comentarios||'').toLowerCase().includes(q) ||
    String(g.cantidad).includes(q)
  );
  if (activeFilter === 'pendiente' || activeFilter === 'hist-pendiente') {
    const histMatches = histPendientes.filter(g => !q ||
      g.motivo.toLowerCase().includes(q) ||
      g.cuenta.toLowerCase().includes(q) ||
      (g.comentarios||'').toLowerCase().includes(q) ||
      String(g.cantidad).includes(q)
    );
    list = [...list, ...histMatches];
  }
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
    const historicoBloqueaMasivo = modoMasivo && g._esHistorico;
    const seleccionado = modoMasivo && !g._esHistorico && seleccionMasiva.has(g.id);
    return `<div class="gasto-item ${iE?'ext-pend':iP?'ext-paid':''}" style="${g.ignorar?'opacity:.55':''}${seleccionado?';border-color:var(--accent);background:rgba(108,99,255,.08)':''}" onclick="${modoMasivo&&!g._esHistorico?`toggleSeleccionMasiva(${g.id})`:''}">
      ${modoMasivo && !g._esHistorico
        ? `<div style="width:22px;height:22px;border-radius:6px;border:2px solid ${seleccionado?'var(--accent)':'var(--border2)'};background:${seleccionado?'var(--accent)':'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0">${seleccionado?'<span style="color:white;font-size:12px">✓</span>':''}</div>`
        : `<div class="gasto-icon" onclick="openDetail(${g.id})">${getMotivoIcon(g.motivo)||'📋'}</div>`
      }
      <div class="gasto-info" onclick="${modoMasivo&&!g._esHistorico?`toggleSeleccionMasiva(${g.id})`:`openDetail(${g.id})`}">
        <div class="gasto-motivo">${g.motivo}${g.ahorroDesc?` <span style="font-size:10px;color:var(--purple)">🐷 ${g.ahorroDesc}</span>`:''}${g._esHistorico?' <span style="font-size:9px;background:rgba(108,99,255,.2);color:var(--accent2);padding:1px 5px;border-radius:6px">historial</span>':''}${g._histPendiente?' <span style="font-size:9px;background:rgba(255,159,67,.16);color:var(--orange);padding:1px 5px;border-radius:6px;font-weight:600">sin abonar</span>':''}</div>
        <div class="gasto-meta">${g.cuenta}${g.comentarios?' · '+g.comentarios:''} · ${g.fecha}</div>
        <div class="badges">
          ${g.ignorar ? '<span class="badge ignorar">🚫 Ignorado</span>' : ''}
          ${!g.ignorar && iE ? '<span class="badge ext">📤 Externo</span>' : ''}
          ${!g.ignorar && iP ? '<span class="badge ext-paid">✅ Cobrado</span>' : ''}
          ${!iE && !iP ? `<span class="badge ${g.abonado?'ab':'pend'}">${g.abonado?'✓ Abonado':'✗ Pendiente'}</span>` : ''}
          ${historicoBloqueaMasivo ? '<span style="font-size:9px;background:rgba(108,99,255,.15);color:var(--accent2);border:1px solid rgba(108,99,255,.3);padding:1px 6px;border-radius:6px;font-weight:600">Edita en historial</span>' : ''}
          ${gastoPendienteSync(g) ? '<span style="font-size:9px;background:rgba(255,159,67,.15);color:var(--orange);border:1px solid rgba(255,159,67,.3);padding:1px 6px;border-radius:6px;font-weight:600">⬆️ Sin sync</span>' : ''}
          ${g.desdeConciliador ? '<span style="font-size:9px;background:rgba(108,99,255,.15);color:var(--accent2);border:1px solid rgba(108,99,255,.3);padding:1px 6px;border-radius:6px;font-weight:600">🏦 Banco</span>' : ''}
          ${g.abonoTarjeta ? '<span style="font-size:9px;background:rgba(34,211,165,.15);color:var(--green);border:1px solid rgba(34,211,165,.3);padding:1px 6px;border-radius:6px;font-weight:600">🏦 Abono</span>' : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <div class="gasto-monto" onclick="openDetail(${g.id})" style="${g.ignorar||iP?'text-decoration:line-through;color:var(--text2)':iE?'color:var(--orange)':''}">${fmt(g.cantidad)}</div>
        ${g._esHistorico&&!modoMasivo?`<button onclick="editarHistorico(${g.id})" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:5px 8px;font-size:11px;cursor:pointer;flex-shrink:0">✏️</button>`:''}
        ${!g._esHistorico&&!modoMasivo?`<button onclick="editarDirecto(${g.id})" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:5px 8px;font-size:11px;cursor:pointer;flex-shrink:0">✏️</button>`:''}
      </div>
    </div>`;
  }).join('');
}

function setFilter(f) {
  if (f === 'hist-pendiente' && modoMasivo) {
    modoMasivo = false;
    seleccionMasiva.clear();
    const toolbar = document.getElementById('toolbar-masiva');
    const btn = document.getElementById('btn-edicion-masiva');
    if (toolbar) toolbar.style.display = 'none';
    if (btn) {
      btn.textContent = '✏️ Editar';
      btn.style.borderColor = 'var(--border2)';
      btn.style.color = 'var(--text2)';
    }
    actualizarConteoMasiva();
  }
  activeFilter = f;
  ['todos','pendiente','abonado','hist-pendiente','ignorar','externo'].forEach(x =>
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
    const promesaVencida = !iP && g.reembolsoFecha && new Date(g.reembolsoFecha + 'T23:59:59') < new Date();
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
      ${(g.reembolsoPersona || g.reembolsoFecha || g.reembolsoNota) ? `
        <div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.18);font-size:11px;color:var(--text2);line-height:1.45">
          ${g.reembolsoPersona ? `<div><strong style="color:var(--text)">Persona:</strong> ${g.reembolsoPersona}</div>` : ''}
          ${g.reembolsoFecha ? `<div><strong style="color:${promesaVencida?'var(--orange)':'var(--text)'}">Promesa:</strong> ${g.reembolsoFecha}${promesaVencida?' · vencida':''}</div>` : ''}
          ${g.reembolsoNota ? `<div><strong style="color:var(--text)">Nota:</strong> ${g.reembolsoNota}</div>` : ''}
        </div>` : ''}
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

  const estados = Object.entries(cfg).map(([cuenta, c]) => {
    const key    = getPeriodoActualKey(cuenta);
    const hasta  = key ? key.split('|')[1] : null;
    const desde  = key ? periodoDesde(key) : null;
    // Usar gastosEnPeriodo que ya maneja fechas correctamente
    const gp = hasta && desde ? gastosEnPeriodo(all, cuenta,
      new Date(desde + 'T00:00:00'),
      new Date(hasta + 'T23:59:59')
    ) : [];
    const gastosPeriodo = gp.filter(g => !g.abonoTarjeta);
    const abonosPeriodo = gp.filter(g => g.abonoTarjeta);
    const totalGastos = gastosPeriodo.reduce((s,g) => s+g.cantidad, 0);
    const totalAbonos = abonosPeriodo.reduce((s,g) => s+g.cantidad, 0);
    const total = totalGastos - totalAbonos; // abonos reducen la deuda
    const sinAbonar = gastosPeriodo.filter(g => !g.abonado && g.externo === 'no').reduce((s,g) => s+g.cantidad, 0);
    const histPend = historico.filter(g => g.cuenta === cuenta && !g.abonado && g.externo === 'no' && !g.abonoTarjeta).reduce((s,g) => s+g.cantidad, 0);
    const externosPend = all.filter(g => g.cuenta === cuenta && g.externo === 'externo' && !g.abonoTarjeta).reduce((s,g) => s+g.cantidad, 0);
    const diasR  = hasta ? Math.ceil((new Date(hasta+'T12:00:00') - hoy) / 864e5) : 0;
    const vencida = diasR < 0;
    return { cuenta, c, key, hasta, desde, gp, total, totalGastos, totalAbonos, sinAbonar, histPend, externosPend, diasR, vencida };
  });

  const totalPeriodo = estados.reduce((s,e) => s + e.total, 0);
  const totalSinAbonar = estados.reduce((s,e) => s + e.sinAbonar, 0);
  const totalHistPend = estados.reduce((s,e) => s + e.histPend, 0);
  const totalExternos = estados.reduce((s,e) => s + e.externosPend, 0);

  const resumen = `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:13px;margin-bottom:12px">
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Estado de tarjeta</div>
    <div class="stat-grid" style="margin-bottom:0">
      <div class="stat-card"><div class="stat-label">Deuda en periodo</div><div class="stat-val red">${fmt(totalPeriodo)}</div></div>
      <div class="stat-card"><div class="stat-label">Sin abonar</div><div class="stat-val orange">${fmt(totalSinAbonar)}</div></div>
      <div class="stat-card"><div class="stat-label">Hist. pendiente</div><div class="stat-val orange">${fmt(totalHistPend)}</div></div>
      <div class="stat-card"><div class="stat-label">Por cobrar</div><div class="stat-val green">${fmt(totalExternos)}</div></div>
    </div>
  </div>`;

  const cards = estados.map(({cuenta, c, desde, hasta, totalGastos, totalAbonos, total, sinAbonar, histPend, externosPend, diasR, vencida}) => {
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
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <span style="font-size:10px;background:rgba(239,68,68,.12);color:var(--red);padding:2px 6px;border-radius:6px">Gastos ${fmt(totalGastos)}</span>
        ${totalAbonos ? `<span style="font-size:10px;background:rgba(34,211,165,.12);color:var(--green);padding:2px 6px;border-radius:6px">Abonos ${fmt(totalAbonos)}</span>` : ''}
        ${sinAbonar ? `<span style="font-size:10px;background:rgba(255,159,67,.14);color:var(--orange);padding:2px 6px;border-radius:6px">Sin abonar ${fmt(sinAbonar)}</span>` : ''}
        ${histPend ? `<span style="font-size:10px;background:rgba(255,159,67,.14);color:var(--orange);padding:2px 6px;border-radius:6px">Hist. ${fmt(histPend)}</span>` : ''}
        ${externosPend ? `<span style="font-size:10px;background:rgba(34,211,165,.12);color:var(--green);padding:2px 6px;border-radius:6px">Por cobrar ${fmt(externosPend)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('cortes-list').innerHTML = resumen + cards;
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
    const gastosPeriodo = gp.filter(g => !g.abonoTarjeta);
    const abonosPeriodo = gp.filter(g => g.abonoTarjeta);
    const totalGastos = gastosPeriodo.reduce((s,g) => s+g.cantidad, 0);
    const totalAbonos = abonosPeriodo.reduce((s,g) => s+g.cantidad, 0);
    const total = totalGastos - totalAbonos;

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
        <div style="font-size:11px;color:var(--text2);margin-bottom:3px">Deuda del período</div>
        <div style="font-size:26px;font-weight:700;color:${total>0?'var(--red)':total<0?'var(--green)':'var(--text2)'}">${fmt(total)}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">
          ${gastosPeriodo.length} gasto${gastosPeriodo.length!==1?'s':''}
          ${abonosPeriodo.length ? `· ${abonosPeriodo.length} abono${abonosPeriodo.length!==1?'s':''}` : ''}
        </div>
      </div>

      ${totalAbonos ? `<div style="background:rgba(34,211,165,.08);border:1px solid rgba(34,211,165,.2);border-radius:10px;padding:10px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:var(--green);font-weight:500">🏦 Abonos recibidos</span>
        <span style="font-size:16px;font-weight:700;color:var(--green)">${fmt(totalAbonos)}</span>
      </div>` : ''}

      ${esActual && vencida ? `<button onclick="showToast('Haz el corte semanal desde el Menú')" style="width:100%;padding:10px;border-radius:8px;border:none;background:var(--accent);color:white;font-size:13px;font-weight:500;cursor:pointer;margin-bottom:10px">✂️ Ir al corte semanal</button>` : ''}

      <button onclick="window._openExc()" style="width:100%;padding:8px;border-radius:8px;border:1px dashed var(--border2);background:transparent;color:var(--text2);font-size:12px;cursor:pointer;margin-bottom:10px">
        📅 Ajustar fecha de corte por día inhábil
      </button>

      ${gp.length
        ? gp.sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0)||String(b.fecha).localeCompare(String(a.fecha))).map(g=>`
          <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:16px">${g.abonoTarjeta ? '🏦' : getMotivoIcon(g.motivo)}</span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;color:${g.abonoTarjeta?'var(--green)':'var(--text)'}">${g.abonoTarjeta ? 'Abono' : g.motivo}</div>
              <div style="font-size:11px;color:var(--text2)">${String(g.fecha).slice(0,10)}${g.comentarios?' · '+g.comentarios:''}</div>
            </div>
            <div style="font-size:14px;font-weight:700;color:${g.abonoTarjeta?'var(--green)':'var(--text)'}">${g.abonoTarjeta?'-':''}${fmt(g.cantidad)}</div>
          </div>`).join('')
        : '<div style="text-align:center;padding:20px;color:var(--text2);font-size:13px">Sin movimientos en este período</div>'}

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
      // Últimos 3 movimientos ordenados por fecha descendente
      const ult = [...c.movimientos].sort((a,b) => {
        const fA = a.fecha || '', fB = b.fecha || '';
        if (fA !== fB) return fB.localeCompare(fA);
        return ((b.movId||0) - (a.movId||0));
      }).slice(0, 3);
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
  return { ...campos, uid: campos.uid || makeLocalId('mov'), movId: nextMovId++, updatedAt: new Date().toISOString() };
}

function verHistorialAhorro(id) {
  const c = cuentasAhorro.find(x => x.id === id);
  if (!c) return;
  const saldoFinal = saldoCuenta(c);

  // Ordenar por fecha descendente (más reciente primero) y movId como desempate
  const ordenados = c.movimientos.map((m, idx) => ({ m, idx })).sort((a,b) => {
    const fA = a.m.fecha || '', fB = b.m.fecha || '';
    if (fA !== fB) return fB.localeCompare(fA); // descendente por fecha
    return ((b.m.movId||0) - (a.m.movId||0));    // descendente por movId como desempate
  });
  // Calcular saldo acumulado desde el más antiguo (orden cronológico inverso)
  const crono = [...ordenados].reverse();
  let saldoAcum = 0;
  const movsConSaldo = crono.map(({ m, idx }) => {
    const pos = m.tipo === 'abono' || m.tipo === 'traspaso-in';
    saldoAcum += pos ? m.cantidad : -m.cantidad;
    return { ...m, _idx: idx, saldoAcum };
  }).reverse(); // regresar a orden descendente (más reciente primero)

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
        const esTraspaso = m.tipo === 'traspaso-in' || m.tipo === 'traspaso-out';
        return `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:${color}">${label}</div>
            <div style="font-size:11px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.fecha}${nota?' · '+nota:''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:14px;font-weight:700;color:${color}">${pos?'+':'-'}${fmt(m.cantidad)}</div>
            <div style="font-size:10px;color:var(--text3)">${fmt(m.saldoAcum)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;margin-left:4px">
            <button onclick="event.stopPropagation();editarMovimientoAhorro(${c.id},${m._idx})" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:6px;padding:4px 7px;font-size:10px;cursor:pointer" title="Editar movimiento">✏️</button>
            <button onclick="event.stopPropagation();eliminarMovimientoAhorro(${c.id},${m._idx})" style="background:rgba(255,94,122,.1);border:1px solid rgba(255,94,122,.3);color:var(--red);border-radius:6px;padding:4px 7px;font-size:10px;cursor:pointer" title="Eliminar movimiento">🗑</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="empty">Sin movimientos registrados</div>';

  openModal('modal-hist-ahorro');
}

function editarMovimientoAhorro(cuentaId, movIndex) {
  const c = cuentasAhorro.find(x => x.id === cuentaId);
  if (!c) return;
  const m = c.movimientos[movIndex];
  if (!m) return;
  window._editarMovIndex = movIndex;

  const esTraspaso = m.tipo === 'traspaso-in' || m.tipo === 'traspaso-out';

  document.getElementById('editar-mov-cuenta-id').value = cuentaId;
  document.getElementById('editar-mov-id').value = m.movId;
  document.getElementById('editar-mov-fecha').value = m.fecha || today();
  document.getElementById('editar-mov-cantidad').value = m.cantidad;
  document.getElementById('editar-mov-nota').value = m.nota || '';

  // Mostrar tipo actual y deshabilitar cambio si es traspaso
  const tipoDisplay = document.getElementById('editar-mov-tipo-display');
  const tipoLabels = { 'abono':'Abono', 'retiro':'Retiro', 'traspaso-in':'Entrada (traspaso)', 'traspaso-out':'Salida (traspaso)' };
  tipoDisplay.textContent = tipoLabels[m.tipo] || m.tipo;
  tipoDisplay.style.color = m.tipo === 'abono' || m.tipo === 'traspaso-in' ? 'var(--green)' : 'var(--red)';

  // Si es traspaso, advertir que se editarán ambas cuentas
  const advertencia = document.getElementById('editar-mov-advertencia');
  if (esTraspaso) {
    const otraCuenta = cuentasAhorro.find(x => x.id === (m.destino || m.origen));
    advertencia.style.display = 'block';
    advertencia.textContent = `⚠️ Este movimiento es parte de un traspaso con "${otraCuenta?.nombre || '?'}". Los cambios se aplicarán a ambas cuentas.`;
  } else {
    advertencia.style.display = 'none';
  }

  document.getElementById('modal-editar-mov-ahorro-title').textContent = `✏️ Editar movimiento - ${c.nombre}`;
  openModal('modal-editar-mov-ahorro');
}

function confirmarEditarMovAhorro() {
  const cuentaId = parseInt(document.getElementById('editar-mov-cuenta-id').value);
  const movIndex = Number(window._editarMovIndex);
  const c = cuentasAhorro.find(x => x.id === cuentaId);
  if (!c) return;
  const m = c.movimientos[movIndex];
  if (!m) return;

  const nuevaCantidad = parseFloat(document.getElementById('editar-mov-cantidad').value);
  if (!nuevaCantidad || nuevaCantidad <= 0) { showToast('Ingresa una cantidad válida'); return; }
  const nuevaNota = document.getElementById('editar-mov-nota').value || '';
  const nuevaFecha = document.getElementById('editar-mov-fecha').value || today();

  const esTraspaso = m.tipo === 'traspaso-in' || m.tipo === 'traspaso-out';

  // Actualizar este movimiento
  m.cantidad = nuevaCantidad;
  m.nota = nuevaNota;
  m.fecha = nuevaFecha;
  m.updatedAt = new Date().toISOString();

  // Si es traspaso, actualizar también el movimiento emparejado
  if (esTraspaso) {
    const otroId = m.destino || m.origen;
    if (otroId) {
      const otraCuenta = cuentasAhorro.find(x => x.id === otroId);
      if (otraCuenta) {
        const otroMov = otraCuenta.movimientos.find(x =>
          (m.tipo === 'traspaso-out' && x.tipo === 'traspaso-in' && x.origen === cuentaId) ||
          (m.tipo === 'traspaso-in' && x.tipo === 'traspaso-out' && x.destino === cuentaId)
        );
      if (otroMov) {
          otroMov.cantidad = nuevaCantidad;
          otroMov.nota = nuevaNota;
          otroMov.fecha = nuevaFecha;
          otroMov.updatedAt = new Date().toISOString();
        }
      }
    }
  }

  saveLocal();
  closeModal('modal-editar-mov-ahorro');
  showToast('Movimiento actualizado ✓');
  // Volver a abrir el historial para reflejar cambios
  verHistorialAhorro(cuentaId);
}

function eliminarMovimientoAhorro(cuentaId, movIndex) {
  window._eliminarMovCuentaId = cuentaId;
  window._eliminarMovIndex = movIndex;
  const c = cuentasAhorro.find(x => x.id === cuentaId);
  const m = c?.movimientos[movIndex];
  if (!c || !m) return;
  const esTraspaso = m.tipo === 'traspaso-in' || m.tipo === 'traspaso-out';
  document.getElementById('confirm-eliminar-desc').textContent =
    `${m.tipo === 'abono' || m.tipo === 'traspaso-in' ? 'Abono' : 'Retiro'} de ${fmt(m.cantidad)} - ${c.nombre}${esTraspaso ? ' (traspaso)' : ''}${esTraspaso ? ' · Se eliminará de ambas cuentas' : ''}`;
  // Cambiar texto del modal para que sea claro
  const modalTitle = document.querySelector('#modal-confirm-eliminar h2');
  if (modalTitle) modalTitle.textContent = '🗑 Eliminar movimiento';
  const modalBody = document.querySelector('#modal-confirm-eliminar p');
  if (modalBody) modalBody.textContent = '¿Seguro que quieres eliminar este movimiento?' + (esTraspaso ? ' También se eliminará de la otra cuenta.' : '');
  openModal('modal-confirm-eliminar');
  // Reemplazar temporalmente confirmarEliminar
  window._confirmarEliminarOriginal = window.confirmarEliminarMovimientoAhorro;
  window.confirmarEliminar = confirmarEliminarMovimientoAhorroHandler;
}

function confirmarEliminarMovimientoAhorroHandler() {
  const cuentaId = window._eliminarMovCuentaId;
  const movIndex = window._eliminarMovIndex;
  const c = cuentasAhorro.find(x => x.id === cuentaId);
  if (!c) return;
  const m = c.movimientos[movIndex];
  if (!m) return;

  const esTraspaso = m.tipo === 'traspaso-in' || m.tipo === 'traspaso-out';

  // Eliminar movimiento emparejado si es traspaso
  if (esTraspaso) {
    const otroId = m.destino || m.origen;
    if (otroId) {
      const otraCuenta = cuentasAhorro.find(x => x.id === otroId);
      if (otraCuenta) {
        const idxOtro = otraCuenta.movimientos.findIndex(x =>
          (m.tipo === 'traspaso-out' && x.tipo === 'traspaso-in' && x.origen === cuentaId) ||
          (m.tipo === 'traspaso-in' && x.tipo === 'traspaso-out' && x.destino === cuentaId)
        );
        if (idxOtro >= 0) {
          const otroMov = otraCuenta.movimientos[idxOtro];
          markStructuredDeleted('movimientosAhorro', structuredMovimientoRowId(otraCuenta.id, otroMov, idxOtro));
          otraCuenta.movimientos.splice(idxOtro, 1);
        }
      }
    }
  }

  // Eliminar este movimiento
  const idx = movIndex;
  if (idx >= 0) {
    markStructuredDeleted('movimientosAhorro', structuredMovimientoRowId(c.id, m, idx));
    c.movimientos.splice(idx, 1);
  }

  saveLocal();
  closeModal('modal-confirm-eliminar');
  showToast('Movimiento eliminado ✓');

  // Restaurar el handler original de confirmarEliminar
  window.confirmarEliminar = window._confirmarEliminarOriginal || confirmarEliminar;
  renderAhorros();
  renderMenu();
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
    if (c) { c.nombre=nombre; c.meta=meta; c.grupo=grupo; c.excluirTotal=excluirTotal; c.updatedAt = new Date().toISOString(); }
    markStructuredDirty('cuentasAhorro');
    saveLocal();
    closeModal('modal-nueva-cuenta');
    showToast('Cuenta actualizada ✓');
  } else {
    // Crear nueva
    const saldoInicial = parseFloat(document.getElementById('nc-saldo-inicial').value) || 0;
    const movimientos  = saldoInicial > 0
      ? [nuevoMov({ tipo:'abono', cantidad: saldoInicial, nota:'Saldo inicial', fecha: today() })]
      : [];
    const nueva = { id: nextAhorroId++, nombre, meta, grupo, excluirTotal, movimientos };
    cuentasAhorro.push(nueva);
    markStructuredDirty('cuentasAhorro');
    saveLocal();
    closeModal('modal-nueva-cuenta');
    showToast('Cuenta creada ✓');
  }
  renderAhorros(); renderMenu();
}

async function eliminarCuenta(id) {
  if (!confirm('¿Eliminar esta cuenta de ahorro?')) return;
  const cuenta = cuentasAhorro.find(x => x.id === id);
  if (cuenta) {
    markStructuredDeleted('cuentasAhorro', id);
    (cuenta.movimientos || []).forEach((m, i) => markStructuredDeleted('movimientosAhorro', structuredMovimientoRowId(id, m, i)));
  }
  markStructuredDirty('cuentasAhorro');
  cuentasAhorro = cuentasAhorro.filter(x=>x.id!==id);
  saveLocal();
  showToast('Cuenta eliminada');
  renderAhorros(); renderMenu();
}

// ── Histórico ─────────────────────────────────────────────────
let histView = 'semana';

function renderHistorico() {
  const el = document.getElementById('historico-list');
  if (!historico.length) {
    el.innerHTML = '<div class="empty">Sin historial aún.<br>Haz tu primer corte semanal.</div>';
    return;
  }
  // Update button styles
  const btnSem = document.getElementById('hv-semana');
  const btnMes = document.getElementById('hv-mes');
  if (btnSem) { btnSem.style.background = histView==='semana'?'var(--accent)':'transparent'; btnSem.style.color = histView==='semana'?'white':'var(--text2)'; }
  if (btnMes) { btnMes.style.background = histView==='mes'?'var(--accent)':'transparent'; btnMes.style.color = histView==='mes'?'white':'var(--text2)'; }
  if (histView === 'mes') { renderHistoricoMes(el); return; }
  const bySem = {};
  historico.forEach(g => { if(!bySem[g.semana])bySem[g.semana]=[]; bySem[g.semana].push(g); });
  el.innerHTML = Object.keys(bySem).sort((a,b)=>b.localeCompare(a)).map(sem => {
    const items = bySem[sem].sort((a,b)=>(Number(b.id)||0)-(Number(a.id)||0)||String(b.fecha).localeCompare(String(a.fecha)));
    const total = items.filter(g=>!g.ignorar).reduce((s,g)=>s+g.cantidad,0);
    return `<div class="semana-group">
      <div class="semana-header"><span>Semana ${sem}</span><span>${fmt(total)}</span></div>
      ${items.map(g=>`<div class="hist-item" style="${g.ignorar?'opacity:.5':''}" onclick="editarHistorico(${g.id})">
        <div style="font-size:17px">${getMotivoIcon(g.motivo)||'📋'}</div>
        <div class="hist-info">
          <div class="hist-motivo">${g.motivo}${g.externo!=='no'?` <span style="font-size:9px;color:${g.externo==='pagado'?'#0d9488':'#d97706'}">${g.externo==='pagado'?'✅':'📤'}</span>`:''}</div>
          <div class="hist-meta">${g.cuenta} · ${g.fecha}${g.comentarios?' · '+g.comentarios:''}</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">
            ${g.abonado?'<span style="font-size:9px;background:rgba(34,211,165,.15);color:var(--green);padding:1px 5px;border-radius:6px;font-weight:600">✓ Abonado</span>':''}
            ${g.ignorar?'<span style="font-size:9px;background:rgba(255,159,67,.15);color:var(--orange);padding:1px 5px;border-radius:6px;font-weight:600">Ignorado</span>':''}
            ${g.desdeConciliador?'<span style="font-size:9px;background:rgba(108,99,255,.15);color:var(--accent2);padding:1px 5px;border-radius:6px;font-weight:600">🏦 Banco</span>':''}
            ${g.abonoTarjeta?'<span style="font-size:9px;background:rgba(34,211,165,.15);color:var(--green);border:1px solid rgba(34,211,165,.3);padding:1px 6px;border-radius:6px;font-weight:600">🏦 Abono</span>':''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="hist-monto" style="${g.ignorar?'text-decoration:line-through':''}">${fmt(g.cantidad)}</div>
          <button onclick="event.stopPropagation();editarHistorico(${g.id})" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:8px;padding:4px 7px;font-size:11px;cursor:pointer;flex-shrink:0">✏️</button>
        </div>
      </div>`).join('')}
    </div>`;
  }).join('');
}

// ── Formulario nuevo gasto ────────────────────────────────────
function setAbonoTarjeta(v) {
  abonoTarjeta = !!v;
  document.getElementById('abono-tarjeta-si').classList.toggle('sel-no',!v);
  document.getElementById('abono-tarjeta-no').classList.toggle('sel-no',v);
}

function toggleAbonoTarjetaVisibility() {
  const sel = document.getElementById('f-cuenta');
  const cuenta = sel ? sel.value : '';
  const cfg = getCortesConfig();
  const esTarjeta = !!cfg[cuenta];
  const wrap = document.getElementById('abono-tarjeta-wrap');
  if (wrap) {
    wrap.style.display = esTarjeta ? '' : 'none';
    if (!esTarjeta && abonoTarjeta) setAbonoTarjeta(false);
  }
}

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
  const wrap = document.getElementById('reembolso-wrap');
  if (wrap) wrap.style.display = v !== 'no' ? 'block' : 'none';
}
function setDescAhorro(v){
  descontarAhorro = v;
  document.getElementById('desc-no').className ='tog'+(v?'':' sel-no');
  document.getElementById('desc-si').className ='tog'+(v?' sel-si':'');
  document.getElementById('ahorro-selector-wrap').style.display = v ? 'block' : 'none';
  if (v) refreshAhorroSelector();
}

function llenarReembolsoForm(g) {
  const rp = document.getElementById('f-reembolso-persona');
  const rf = document.getElementById('f-reembolso-fecha');
  const rn = document.getElementById('f-reembolso-nota');
  if (rp) rp.value = g?.reembolsoPersona || '';
  if (rf) rf.value = g?.reembolsoFecha || '';
  if (rn) rn.value = g?.reembolsoNota || '';
}

// Actualiza selector de cuentas de ahorro en el form
function refreshAhorroSelector() {
  const sel = document.getElementById('f-ahorro-cuenta');
  if (!sel) return;
  sel.innerHTML = cuentasAhorro.map(c =>
    `<option value="${c.id}">${c.nombre} (${fmt(saldoCuenta(c))})</option>`
  ).join('');
}

function buscarRetiroAhorroPorGasto(cuenta, gasto) {
  if (!cuenta || !gasto) return -1;
  return cuenta.movimientos.findIndex(m =>
    m.tipo === 'retiro' && (
      m.gastoId === gasto.id ||
      (!m.gastoId &&
       m.cantidad === gasto.cantidad &&
       m.fecha === gasto.fecha &&
       (m.nota || '').includes(gasto.motivo))
    )
  );
}

function upsertRetiroAhorroGasto(gasto, ahorroId, gastoAnterior = null) {
  const ca = cuentasAhorro.find(x => x.id === ahorroId);
  if (!ca) return;
  let idx = buscarRetiroAhorroPorGasto(ca, gasto);
  if (idx < 0 && gastoAnterior) idx = buscarRetiroAhorroPorGasto(ca, gastoAnterior);
  const campos = {
    tipo: 'retiro',
    cantidad: gasto.cantidad,
    nota: `Gasto: ${gasto.motivo}`,
    fecha: gasto.fecha,
    gastoId: gasto.id
  };
  if (idx >= 0) {
    ca.movimientos[idx] = { ...ca.movimientos[idx], ...campos };
    ca.movimientos[idx].updatedAt = new Date().toISOString();
    for (let i = ca.movimientos.length - 1; i > idx; i--) {
      const m = ca.movimientos[i];
      if (m.tipo === 'retiro' && m.gastoId === gasto.id) ca.movimientos.splice(i, 1);
    }
  } else {
    ca.movimientos.push(nuevoMov(campos));
  }
}

function normalizarTextoRegla(txt) {
  return String(txt || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function aplicarReglaAutomatica(origen = 'comentario') {
  if (editingId) return;
  const input = document.getElementById('f-comentarios-input');
  const texto = normalizarTextoRegla(input?.value || '');
  if (!texto) return;
  const regla = reglasAutomaticas.find(r => {
    const needle = normalizarTextoRegla(r.texto);
    return needle && texto.includes(needle);
  });
  if (!regla) return;

  const cuentaSel = document.getElementById('f-cuenta');
  const motivoSel = document.getElementById('f-motivo');
  let cambios = [];
  if (regla.cuenta && cuentaSel && getCuentas().includes(regla.cuenta)) {
    cuentaSel.value = regla.cuenta;
    cambios.push(regla.cuenta);
  }
  if (regla.motivo && motivoSel && catalogoMotivos.includes(regla.motivo)) {
    motivoSel.value = regla.motivo;
    cambios.push(regla.motivo);
  }
  if (cambios.length && origen !== 'silencioso') showToast('Regla aplicada: ' + cambios.join(' · '));
}

async function guardarGasto() {
  syncBloqueado = true; // bloquear sync durante guardado
  aplicarReglaAutomatica('silencioso');
  const cantidad = parseFloat(document.getElementById('f-cantidad').value);
  if (!cantidad||cantidad<=0) { syncBloqueado = false; showToast('Ingresa una cantidad válida'); return; }

  const isEditing = !!editingId;
  const isHistorico = window._editandoHistorico === true;
  let gastoAnterior = null;
  if (isEditing && !isHistorico) {
    const _idx = gastos.findIndex(x => x.id === editingId);
    gastoAnterior = _idx >= 0 ? gastos[_idx] : null;
  }

  // Verificar saldo si se descuenta de ahorro
  let ahorroSelId = null, ahorroSelNombre = '';
  if (descontarAhorro) {
    const sel = document.getElementById('f-ahorro-cuenta');
    ahorroSelId = parseInt(sel.value);
    const ca = cuentasAhorro.find(x=>x.id===ahorroSelId);
    if (!ca) { syncBloqueado = false; showToast('Selecciona una cuenta de ahorro'); return; }
    // Si es edición y el gasto anterior ya tenía descuento en esta misma cuenta,
    // la cantidad ya fue descontada previamente. Solo verificar si AUMENTÓ.
    if (gastoAnterior && gastoAnterior.ahorroDesc === ca.nombre) {
      const diferencia = cantidad - gastoAnterior.cantidad;
      if (diferencia > 0 && diferencia > saldoCuenta(ca)) {
        syncBloqueado = false;
        showToast(`Saldo insuficiente en ${ca.nombre}`);
        return;
      }
    } else if (cantidad > saldoCuenta(ca)) {
      syncBloqueado = false;
      showToast(`Saldo insuficiente en ${ca.nombre}`);
      return;
    }
    ahorroSelNombre = ca.nombre;
  }
  const gasto = {
    id:           editingId || nextId++,
    fecha:        document.getElementById('f-fecha')?.value || today(),
    cuenta:       document.getElementById('f-cuenta').value,
    motivo:       document.getElementById('f-motivo').value,
    cantidad,
    comentarios:  document.getElementById('f-comentarios-input').value,
    abonado:      abonoTarjeta ? true : abonado,
    ignorar, externo,
    abonoTarjeta,
    reembolsoPersona: externo !== 'no' ? (document.getElementById('f-reembolso-persona')?.value || '').trim() : '',
    reembolsoFecha:   externo !== 'no' ? (document.getElementById('f-reembolso-fecha')?.value || '') : '',
    reembolsoNota:    externo !== 'no' ? (document.getElementById('f-reembolso-nota')?.value || '').trim() : '',
    semana:       getWeek(new Date()),
    ahorroDesc:   descontarAhorro ? ahorroSelNombre : '',
    updatedAt:    new Date().toISOString(),
    periodoCorte: calcularPeriodoCorte(document.getElementById('f-cuenta').value, document.getElementById('f-fecha')?.value || today()),
    desdeConciliador: window._desdeConciliador ? true : undefined,
  };

  if (isEditing && isHistorico) {
    window._editandoHistorico = false;
    const idx = historico.findIndex(x=>x.id===editingId);
    if (idx >= 0) historico[idx] = {...historico[idx], ...gasto, semana: historico[idx].semana};
    const _volverConcil = !!window._desdeConciliador;
    window._desdeConciliador = null;
    syncBloqueado = false;
    resetForm(); editingId=null;
    saveLocal();
    showTab('historico');
    showToast('Gasto del historial actualizado ✓');
    return;
  }
  if (isEditing) {
    const idx = gastos.findIndex(x=>x.id===editingId);

    // Si el gasto anterior tenía descuento de ahorro y el nuevo no (o cambió de cuenta)
    if (gastoAnterior?.ahorroDesc && (!descontarAhorro || ahorroSelNombre !== gastoAnterior.ahorroDesc)) {
      const cuentaAnterior = cuentasAhorro.find(c => c.nombre === gastoAnterior.ahorroDesc);
      if (cuentaAnterior) {
        const movIdx = buscarRetiroAhorroPorGasto(cuentaAnterior, gastoAnterior);
        if (movIdx !== -1) {
          // Guardar estado pendiente para aplicar después de confirmación
          window._guardarGastoPendiente = {
            gasto, gastoAnterior, idx, cuentaAnterior,
            ahorroSelId, descontarAhorro,
            _volverConcil: !!window._desdeConciliador
          };
          window._desdeConciliador = null;
          const accion = descontarAhorro ? 'cambiar de cuenta' : 'desactivar';
          modalConfirmar(
            `⚠️ Este gasto tenía activado "Descontar de ${cuentaAnterior.nombre}" por ${fmt(gastoAnterior.cantidad)}. Al ${accion}, se registrará un ABONO de ${fmt(gastoAnterior.cantidad)} en "${cuentaAnterior.nombre}" para devolver el saldo. ¿Continuar?`,
            _confirmarGuardarGastoConRevertAhorro
          );
          syncBloqueado = false;
          return;
        }
      }
    }
    if (idx >= 0) gastos[idx] = gasto;
  } else {
    gastos.push(gasto);
  }

  // Descontar del ahorro si aplica (nuevo o edición con ahorro)
  if (descontarAhorro && ahorroSelId) {
    upsertRetiroAhorroGasto(gasto, ahorroSelId, gastoAnterior);
  }

  // Guardar todo junto
  syncBloqueado = false;
  saveLocal();
  const _volverConcil = !!window._desdeConciliador;
  window._desdeConciliador = null;
  resetForm(); editingId=null;
  showTab(_volverConcil ? 'conciliacion' : 'gastos');
  showToast('Gasto guardado ✓');
}

function _confirmarGuardarGastoConRevertAhorro() {
  const pending = window._guardarGastoPendiente;
  if (!pending) return;
  const { gasto, gastoAnterior, idx, cuentaAnterior, ahorroSelId, descontarAhorro } = pending;

  // Registrar un ABONO en la cuenta anterior para devolver el saldo
  cuentaAnterior.movimientos.push(nuevoMov({
    tipo: 'abono',
    cantidad: gastoAnterior.cantidad,
    nota: `Devolución - ${gastoAnterior.motivo} (editado)`,
    fecha: gasto.fecha || today()
  }));

  // Si el nuevo gasto tiene descuento en otra cuenta, agregar el retiro allí
  if (descontarAhorro && ahorroSelId) {
    upsertRetiroAhorroGasto(gasto, ahorroSelId);
  }

  // Actualizar el gasto
  if (idx >= 0) gastos[idx] = gasto;

  window._guardarGastoPendiente = null;
  syncBloqueado = false;
  saveLocal();
  resetForm();
  editingId = null;
  showTab(pending._volverConcil ? 'conciliacion' : 'gastos');
  showToast('Gasto guardado ✓');
}

function resetForm() {
  document.getElementById('f-cantidad').value    = '';
  document.getElementById('f-comentarios-input').value = ''; document.getElementById('comentario-dropdown').style.display='none';
  const rp = document.getElementById('f-reembolso-persona'); if (rp) rp.value = '';
  const rf = document.getElementById('f-reembolso-fecha'); if (rf) rf.value = '';
  const rn = document.getElementById('f-reembolso-nota'); if (rn) rn.value = '';
  document.getElementById('f-cuenta').selectedIndex = 0;
  document.getElementById('f-motivo').selectedIndex  = 0;
  const fe = document.getElementById('f-fecha'); if (fe) fe.value = today();
  setAb(false); setAbonoTarjeta(false); setIg(false); setExt('no'); setDescAhorro(false);
  document.getElementById('abono-tarjeta-wrap').style.display = 'none';
}
function cancelForm() {
  editingId=null; resetForm();
  showTab(gastos.length?'gastos':'menu');
}

// ── Detalle / Editar / Eliminar ───────────────────────────────
function openDetail(id) {
  const g = gastos.find(x=>x.id===id) || historico.find(x=>x.id===id);
  if(!g) return;
  const esHistorico = !gastos.some(x => x.id === id);
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
    ${(g.reembolsoPersona || g.reembolsoFecha || g.reembolsoNota) ? `
      <div style="font-size:12px;color:var(--text2);margin-bottom:9px;padding:8px 10px;border-radius:8px;background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.18)">
        ${g.reembolsoPersona ? `<div><strong style="color:var(--text)">Reembolso:</strong> ${g.reembolsoPersona}</div>` : ''}
        ${g.reembolsoFecha ? `<div><strong style="color:var(--text)">Fecha prometida:</strong> ${g.reembolsoFecha}</div>` : ''}
        ${g.reembolsoNota ? `<div><strong style="color:var(--text)">Nota:</strong> ${g.reembolsoNota}</div>` : ''}
      </div>` : ''}
    <div class="badges" style="margin-bottom:12px">
      ${esHistorico?'<span style="font-size:9px;background:rgba(108,99,255,.2);color:var(--accent2);padding:1px 5px;border-radius:6px;font-weight:600">historial</span>':''}
      ${g.ignorar?'<span class="badge ignorar">🚫 Ignorado</span>':''}
      ${!g.ignorar && iE?'<span class="badge ext">📤 Externo pendiente de cobro</span>':''}
      ${!g.ignorar && iP?'<span class="badge ext-paid">✅ Externo cobrado</span>':''}
      ${!iE && !iP?`<span class="badge ${g.abonado?'ab':'pend'}">${g.abonado?'✓ Abonado':'✗ Pendiente'}</span>`:''}
    </div>
    ${!esHistorico&&iE?`<button class="btn-marcar-pagado" onclick="marcarExterno(${g.id},'pagado');closeModal('modal-detail');renderGastos()">✅ Marcar como cobrado</button>`:''}
    ${!esHistorico&&iP?`<button class="btn-marcar-pend" onclick="marcarExterno(${g.id},'externo');closeModal('modal-detail');renderGastos()">↩ Marcar como pendiente</button>`:''}
    <div class="modal-actions" style="margin-top:${iE||iP?'10px':'0'}">
      <button class="mbtn sec" onclick="closeModal('modal-detail')">Cerrar</button>
      ${!esHistorico?`<button class="mbtn danger" onclick="eliminar(${g.id})">Eliminar</button>`:''}
      <button class="mbtn prim" onclick="${esHistorico?`closeModal('modal-detail');editarHistorico(${g.id})`:`editar(${g.id})`}">Editar</button>
    </div>`;
  openModal('modal-detail');
}

function editarHistorico(id) {
  const g = historico.find(x => x.id === id);
  if (!g) return;
  // Mover temporalmente a gastos para editar
  editingId = id;
  // Llenar el formulario
  showTab('nuevo');
  setTimeout(() => {
    document.getElementById('f-cantidad').value = g.cantidad;
    document.getElementById('f-fecha').value    = g.fecha;
    document.getElementById('f-cuenta').value   = g.cuenta;
    // Motivo
    const motSel = document.getElementById('f-motivo');
    if (motSel) { motSel.value = g.motivo; }
    const coSel = document.getElementById('f-comentarios-input');
    if (coSel) coSel.value = g.comentarios || '';
    setAb(g.abonado !== false);
    setIg(!!g.ignorar);
    setExt(g.externo || 'no');
    llenarReembolsoForm(g);
    toggleAbonoTarjetaVisibility();
    if (g.abonoTarjeta) setAbonoTarjeta(true);
    // Marcar que es del historico
    window._editandoHistorico = true;
    showToast('Editando gasto del historial');
  }, 150);
}

function editarDirecto(id) {
  const g = gastos.find(x=>x.id===id); if(!g) return;
  editingId=id;
  document.getElementById('f-cuenta').value            = g.cuenta;
  document.getElementById('f-motivo').value             = g.motivo;
  document.getElementById('f-cantidad').value           = g.cantidad;
  document.getElementById('f-comentarios-input').value  = g.comentarios||'';
  const fe = document.getElementById('f-fecha'); if (fe) fe.value = g.fecha || today();
  setAb(g.abonado); setIg(g.ignorar||false); setExt(g.externo||'no'); llenarReembolsoForm(g);
  toggleAbonoTarjetaVisibility();
  if (g.abonoTarjeta) setAbonoTarjeta(true);
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
  setAb(g.abonado); setIg(g.ignorar||false); setExt(g.externo||'no'); llenarReembolsoForm(g);
  toggleAbonoTarjetaVisibility();
  if (g.abonoTarjeta) setAbonoTarjeta(true);
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
  if (gasto) markStructuredDeleted('gastos', gasto.id);
  gastos = gastos.filter(x => x.id !== window._eliminarId);
  saveLocal();
  closeModal('modal-confirm-eliminar');
  showToast('Gasto eliminado');
  renderGastos(); renderMenu();
}

// ── Corte semanal ─────────────────────────────────────────────
function openCorte() {
  const total = gastos.reduce((s, g) => s + Number(g.cantidad || 0), 0);
  const pendientes = gastos.filter(g => !g.abonado && !g.ignorar && g.externo === 'no').length;
  document.getElementById('corte-count').textContent = gastos.length;
  const totalEl = document.getElementById('corte-total');
  if (totalEl) totalEl.textContent = fmt(total);
  const pendEl = document.getElementById('corte-pendientes');
  if (pendEl) pendEl.textContent = pendientes;
  openModal('modal-corte-sem');
}

async function hacerCorte() {
  if (window._corteEnCurso) return;
  if (!gastos.length) { closeModal('modal-corte-sem'); showToast('No hay gastos que cortar'); return; }
  window._corteEnCurso = true;
  try {
    const corteAt = new Date().toISOString();
    const gastosCortados = gastos.map(g => ({ ...g, updatedAt: corteAt, corteAt }));
    guardarBackupMinimo('antes-corte');
    queueSyncOperation('corte', { count: gastos.length, total: gastos.reduce((s, g) => s + Number(g.cantidad || 0), 0), corteAt });
    historico = [...gastosCortados, ...historico];
    gastos = [];
    // Reiniciar ajustes de presupuesto acumulados al comenzar nueva semana
    const teniaAjustes = ajustesPresupuesto.length > 0;
    ajustesPresupuesto = [];
    syncBloqueado = true;
    saveLocal();
    syncBloqueado = false;
    closeModal('modal-corte-sem');
    clearTimeout(window._autoSyncTimer);
    renderMenu();
    renderGastos();
    if (usingSupabase() && !isTravelMode() && navigator.onLine) {
      const ok = await uploadSupabaseStructured({ full: true });
      if (ok) mostrarEstadoSync(true);
      else mostrarEstadoSync(false);
      if (ok) {
        const remoteRows = await sbSelect('gs_gastos', 'select=id,estado,deleted_at&estado=neq.historico&deleted_at=is.null&limit=1');
        if (remoteRows.length) {
          mostrarEstadoSync(false, 'error');
          showToast('Corte local hecho, pero Supabase aún tiene activos');
          return;
        }
      }
    }
    showToast(teniaAjustes ? '¡Corte realizado! Presupuesto reiniciado a la base ✓' : '¡Corte semanal realizado! ✓');
  } finally {
    syncBloqueado = false;
    window._corteEnCurso = false;
  }
}

// ── Exportar Excel ────────────────────────────────────────────
function exportarExcel() {
  if (typeof XLSX==='undefined') { showToast('Cargando...'); return; }
  const wb = XLSX.utils.book_new();
  const hdr = ['ID','Fecha','Cuenta','Motivo','Cantidad','Comentarios','Abonado','Externo','Reembolso Persona','Reembolso Fecha','Reembolso Nota','Ignorar','Ahorro','Semana'];
  const cols = [{wch:6},{wch:13},{wch:13},{wch:20},{wch:13},{wch:24},{wch:10},{wch:14},{wch:20},{wch:15},{wch:28},{wch:10},{wch:18},{wch:11}];
  const toR = g => [g.id,g.fecha,g.cuenta,g.motivo,g.cantidad,g.comentarios||'',
    g.abonado?'SI':'NO',g.externo||'no',g.reembolsoPersona||'',g.reembolsoFecha||'',g.reembolsoNota||'',g.ignorar?'SI':'NO',g.ahorroDesc||'',g.semana];
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

// ── Aumentar presupuesto desde ahorro ─────────────────────────
function abrirAumentarPresupuesto() {
  const cuentasConSaldo = cuentasAhorro.filter(c => saldoCuenta(c) > 0);
  if (!cuentasConSaldo.length) {
    showToast('No hay cuentas de ahorro con saldo disponible');
    return;
  }
  const semanaAct = getWeek(new Date());
  // Suma ACUMULADA de todos los aumentos (sin filtrar por semana)
  const ajusteSemana = (ajustesPresupuesto || [])
    .reduce((s, a) => s + a.cantidad, 0);
  const activos = gastos.filter(g => !g.ignorar);
  const total = activos.reduce((s, g) => s + g.cantidad, 0);
  const disp = Math.max(0, PRESUPUESTO + ajusteSemana - total);

  document.getElementById('aum-presup-semana').textContent = semanaAct;
  document.getElementById('aum-presup-original').textContent = fmt(PRESUPUESTO);
  document.getElementById('aum-presup-ajuste').textContent = ajusteSemana > 0 ? fmt(ajusteSemana) : '$0.00';
  document.getElementById('aum-presup-total').textContent = fmt(PRESUPUESTO + ajusteSemana);
  document.getElementById('aum-presup-gastado').textContent = fmt(total);
  document.getElementById('aum-presup-disponible').textContent = fmt(disp);

  const sel = document.getElementById('aum-ahorro-select');
  sel.innerHTML = cuentasConSaldo.map(c =>
    `<option value="${c.id}">${c.nombre} (${fmt(saldoCuenta(c))})</option>`
  ).join('');
  document.getElementById('aum-cantidad').value = '';
  openModal('modal-aumentar-presupuesto');
}

function confirmarAumentarPresupuesto() {
  const cantidad = parseFloat(document.getElementById('aum-cantidad').value);
  if (!cantidad || cantidad <= 0) { showToast('Ingresa una cantidad válida'); return; }
  const ahorroId = parseInt(document.getElementById('aum-ahorro-select').value);
  const ca = cuentasAhorro.find(x => x.id === ahorroId);
  if (!ca) { showToast('Selecciona una cuenta de ahorro'); return; }
  if (cantidad > saldoCuenta(ca)) { showToast(`Saldo insuficiente en ${ca.nombre}`); return; }

  // Registrar retiro en la cuenta de ahorro
  ca.movimientos.push(nuevoMov({
    tipo: 'retiro',
    cantidad,
    nota: `Ajuste presupuesto semanal`,
    fecha: today()
  }));

  // Registrar ajuste de presupuesto
  const semanaAct = getWeek(new Date());
  ajustesPresupuesto.push({
    semana: semanaAct,
    cantidad,
    ahorroId: ca.id,
    ahorroNombre: ca.nombre,
    fecha: today()
  });

  saveLocal();
  closeModal('modal-aumentar-presupuesto');
  showToast(`+${fmt(cantidad)} agregado al presupuesto desde ${ca.nombre} ✓`);
  renderMenu();
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
  const hdr = ['ID','Fecha','Cuenta','Motivo','Cantidad','Comentarios','Abonado','Externo','Reembolso Persona','Reembolso Fecha','Reembolso Nota','Ignorar','Ahorro','Semana','Abono Tarjeta'];
  const toR = g => [g.id,g.fecha,g.cuenta,g.motivo,g.cantidad,g.comentarios||'',
    g.abonado?'SI':'NO',g.externo||'no',g.reembolsoPersona||'',g.reembolsoFecha||'',g.reembolsoNota||'',g.ignorar?'SI':'NO',g.ahorroDesc||'',g.semana,
    g.abonoTarjeta?'SI':'NO'];
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
function mostrarVersionCache() {
  const el = document.getElementById('app-version-label');
  if (el) el.textContent = APP_VERSION;
  const drawer = document.getElementById('drawer-version-label');
  if (drawer) drawer.textContent = APP_VERSION;
}

function abrirAjustes() {
  mostrarVersionCache();
  document.getElementById('ajuste-presupuesto').value = PRESUPUESTO;
  const wu = document.getElementById('ajuste-worker-url');
  if (wu) wu.value = localStorage.getItem('workerUrl') || '';
  // Supabase
  const sbEnabled = document.getElementById('ajuste-supabase-enabled');
  const modoViaje = document.getElementById('ajuste-modo-viaje');
  const deviceIdEl = document.getElementById('supabase-device-id');
  if (sbEnabled) sbEnabled.checked = usingSupabase();
  if (modoViaje) modoViaje.checked = isTravelMode();
  if (deviceIdEl) deviceIdEl.textContent = getSupabaseDeviceId();
  openModal('modal-ajustes');
}

async function guardarAjustes() {
  const val = parseFloat(document.getElementById('ajuste-presupuesto').value);
  if (!val || val <= 0) { showToast('Presupuesto inválido'); return; }
  PRESUPUESTO = val;

  // Guardar config directamente en localStorage sin disparar autoSync
  const wu = document.getElementById('ajuste-worker-url');
  if (wu) { const v = wu.value.trim(); v ? localStorage.setItem('workerUrl', v) : localStorage.removeItem('workerUrl'); }

  const sbEl = document.getElementById('ajuste-supabase-enabled');
  const travelEl = document.getElementById('ajuste-modo-viaje');
  if (sbEl) sbEl.checked ? localStorage.setItem('supabaseEnabled','1') : localStorage.removeItem('supabaseEnabled');
  ['git'+'hubToken', 'git'+'hubDisabled', 'git'+'hubSha'].forEach(k => localStorage.removeItem(k));
  if (travelEl) travelEl.checked ? localStorage.setItem('modoViaje','1') : localStorage.removeItem('modoViaje');

  // Dispositivo nuevo O sin datos: forzar descarga remota
  const esNuevo = (!localStorage.getItem('lastSync') && !localStorage.getItem('lastSyncSupabase')) || gastos.length === 0;
  closeModal('modal-ajustes');

  if (isTravelMode()) {
    syncBloqueado = true;
    saveLocal();
    syncBloqueado = false;
    renderMenu();
    mostrarEstadoSync(false);
    showToast('Modo viaje activo: sync automatico pausado');
  } else if (esNuevo && usingSupabase()) {
    // Dispositivo nuevo: descargar PRIMERO, luego guardar local
    syncBloqueado = true;
    clearTimeout(window._autoSyncTimer);
    showToast('🔄 Descargando datos de la nube...');

    let ok = false;
    // force=true: ignorar timestamps, bajar el mas reciente sin importar device_id
    ok = await downloadSupabase(true);

    syncBloqueado = false;
    // saveLocal con sync bloqueado para no disparar upload
    syncBloqueado = true;
    saveLocal();
    syncBloqueado = false;
    showTab('menu');
    renderMenu();
    showToast(ok && ok !== 'skip' ? '✅ Sincronizado correctamente' : '⚠️ Sin datos remotos, usando local');
  } else {
    // Dispositivo conocido: guardar normal
    syncBloqueado = true;
    saveLocal();
    syncBloqueado = false;
    if (usingSupabase() && navigator.onLine) await uploadSupabase();
    renderMenu();
    showToast('Ajustes guardados ✓');
  }
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
  r.updatedAt = new Date().toISOString();
  markStructuredDirty('recurrentes');
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
  r.updatedAt = new Date().toISOString();
  markStructuredDirty('recurrentes');
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
  const cantidadRaw = document.getElementById('rec-cantidad').value;
  const cantidad = cantidadRaw === '' ? 0 : parseFloat(cantidadRaw);
  const dia      = parseInt(document.getElementById('rec-dia').value);
  if (!nombre || !dia || dia<1 || dia>31 || Number.isNaN(cantidad) || cantidad<0) { showToast('Completa todos los campos'); return; }
  const obj = { id: 0, nombre, cuenta, motivo, cantidad, dia, activo: true, updatedAt: new Date().toISOString() };
  if (window._editRecIdx !== null) {
    obj.id = recurrentes[window._editRecIdx].id;
    recurrentes[window._editRecIdx] = obj;
  } else {
    obj.id = nextRecId++;
    recurrentes.push(obj);
  }
  markStructuredDirty('recurrentes');
  saveLocal();
  closeModal('modal-rec-servicio');
  showToast('Servicio guardado ✓');
  renderServicios();
}

function eliminarRecurrente(i) {
  if (!confirm(`¿Eliminar "${recurrentes[i].nombre}"?`)) return;
  markStructuredDeleted('recurrentes', recurrentes[i].id);
  markStructuredDirty('recurrentes');
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
  deudas[i].updatedAt = new Date().toISOString();
  markStructuredDirty('deudas');
  if (deudas[i].mesesPagados >= d.mesesTotal) showToast(`¡${d.nombre} liquidada! 🎉`);
  saveLocal();
}

function abrirNuevaDeuda() {
  window._editDeudaIdx = null;
  ['deuda-nombre','deuda-cuenta','deuda-total','deuda-cuota','deuda-meses','deuda-dia'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const pagadosEl = document.getElementById('deuda-pagados');
  if (pagadosEl) pagadosEl.value = '0';
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
  document.getElementById('deuda-pagados').value = d.mesesPagados || 0;
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
  const pagados = parseInt(document.getElementById('deuda-pagados').value) || 0;
  if (!nombre||!total||!cuota||!meses||!dia) { showToast('Completa todos los campos'); return; }
  if (pagados >= meses) { showToast('Los meses pagados no pueden ser mayores al total'); return; }
  const obj = { nombre, cuenta, total, cuota, mesesTotal: meses, mesesPagados: pagados, diaCorte: dia, fechaInicio: today(), updatedAt: new Date().toISOString() };
  if (window._editDeudaIdx !== null) {
    obj.id = deudas[window._editDeudaIdx].id;
    deudas[window._editDeudaIdx] = obj;
  } else {
    obj.id = nextDeudaId++;
    deudas.push(obj);
  }
  markStructuredDirty('deudas');
  saveLocal();
  closeModal('modal-deuda');
  showToast('Deuda guardada ✓');
  renderDeudas();
}

function eliminarDeuda(i) {
  if (!confirm(`¿Eliminar deuda "${deudas[i].nombre}"?`)) return;
  markStructuredDeleted('deudas', deudas[i].id);
  markStructuredDirty('deudas');
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
  if (!usingSupabase() || !g.updatedAt) return false;
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
  if (!todosConcil && items.length > 0) {
    if (!confirm(`¿Marcar los ${items.length} gastos como conciliados?`)) return;
  }
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
    const charRaros = (pdfText.match(/[^\x00-\xFF]/g) || []).length;
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
  const obj = { nombre, color, tieneCorte, diaCorte, updatedAt: new Date().toISOString() };
  if (window._editCuentaIdx !== null) {
    catalogoCuentas[window._editCuentaIdx] = obj;
  } else {
    if (catalogoCuentas.find(c => c.nombre.toLowerCase() === nombre.toLowerCase())) {
      showToast('Ya existe una cuenta con ese nombre'); return;
    }
    catalogoCuentas.push(obj);
  }
  markStructuredDirty('cuentas');
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
  markStructuredDeleted('cuentas', c.nombre);
  markStructuredDirty('cuentas');
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
  markStructuredDirty('catalogos');
  saveLocal();
  closeModal('modal-cat-motivo');
  showToast('Motivo guardado ✓');
  renderCatMotivos();
  actualizarSelectMotivos();
}

async function eliminarMotivo(i) {
  if (!confirm(`¿Eliminar el motivo "${catalogoMotivos[i]}"?`)) return;
  markStructuredDeleted('catalogos', `motivo:${catalogoMotivos[i]}`);
  markStructuredDirty('catalogos');
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

function normalizarCatalogoComentarios() {
  if (!catalogoComentarios || catalogoComentarios.length === 0) {
    catalogoComentarios = [
      'Starbucks','Caffenio','Amazon','Mercado Libre','Chipotles',
      'Carls Jr','Jack In The Box','DQ','Pizza','Tacos','Sams',
      'Walmart','Oxxo','Hot Dogs','HBO MAX','Apple One','Boneless',
      '260','Costco','Gas','Luz','Agua','Internet'
    ];
  }
  const vistos = new Set();
  catalogoComentarios = catalogoComentarios.map(c =>
    typeof c === 'string' ? c : (c.nombre || c.Nombre || String(c))
  ).map(c => c.trim()).filter(c => {
    const key = c.toLowerCase();
    if (!c || vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });
  return catalogoComentarios;
}

function precargarComentarioDropdown() {
  normalizarCatalogoComentarios();
  const dropdown = document.getElementById('comentario-dropdown');
  const input = document.getElementById('f-comentarios-input');
  if (!dropdown || !input) return;
  openComentarioDropdown();
}

// El campo comentarios es un combo: dropdown + input libre
function openComentarioDropdown() {
  const dropdown = document.getElementById('comentario-dropdown');
  const input    = document.getElementById('f-comentarios-input');
  if (!dropdown || !input) return;
  const q        = input.value.trim().toLowerCase();

  const todos = normalizarCatalogoComentarios();

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
  aplicarReglaAutomatica();
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
  renderReglasAutomaticas();
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
  markStructuredDirty('catalogos');
  saveLocal();
  closeModal('modal-cat-comentario');
  showToast('Comentario guardado ✓');
  renderCatComentarios();
}

async function eliminarComentario(i) {
  if (!confirm(`¿Eliminar "${catalogoComentarios[i]}" del catálogo?`)) return;
  markStructuredDeleted('catalogos', `comentario:${catalogoComentarios[i]}`);
  markStructuredDirty('catalogos');
  catalogoComentarios.splice(i, 1);
  await saveData();
  showToast('Eliminado');
  renderCatComentarios();
}

function renderReglasAutomaticas() {
  const el = document.getElementById('cat-reglas-list');
  if (!el) return;
  if (!reglasAutomaticas.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 0">Sin reglas automaticas</div>';
    return;
  }
  el.innerHTML = reglasAutomaticas.map((r, i) => `
    <div style="background:var(--bg2);border-radius:10px;border:1px solid var(--border);padding:11px 13px;margin-bottom:7px;display:flex;align-items:center;gap:10px">
      <span style="font-size:16px">⚡</span>
      <span style="flex:1;font-size:13px;color:var(--text)">
        <strong>${r.texto}</strong>
        <span style="display:block;font-size:11px;color:var(--text2);margin-top:2px">${r.cuenta || 'Cuenta igual'} · ${r.motivo || 'Motivo igual'}</span>
      </span>
      <button onclick="editarReglaAuto(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;font-size:12px;color:var(--text2);cursor:pointer">Editar</button>
      <button onclick="eliminarReglaAuto(${i})" style="padding:6px 10px;border-radius:8px;border:1px solid #fee2e2;background:transparent;font-size:12px;color:var(--red);cursor:pointer">🗑</button>
    </div>`).join('');
}

function llenarSelectRegla(cuenta = '', motivo = '') {
  const sc = document.getElementById('regla-cuenta');
  const sm = document.getElementById('regla-motivo');
  if (sc) sc.innerHTML = '<option value="">No cambiar</option>' + getCuentas().map(c => `<option value="${c}"${c===cuenta?' selected':''}>${c}</option>`).join('');
  if (sm) sm.innerHTML = '<option value="">No cambiar</option>' + catalogoMotivos.map(m => `<option value="${m}"${m===motivo?' selected':''}>${m}</option>`).join('');
}

function nuevaReglaAuto() {
  window._editReglaIdx = null;
  document.getElementById('regla-modal-title').textContent = 'Nueva regla';
  document.getElementById('regla-texto').value = '';
  llenarSelectRegla();
  openModal('modal-regla-auto');
}

function editarReglaAuto(i) {
  const r = reglasAutomaticas[i];
  if (!r) return;
  window._editReglaIdx = i;
  document.getElementById('regla-modal-title').textContent = 'Editar regla';
  document.getElementById('regla-texto').value = r.texto || '';
  llenarSelectRegla(r.cuenta || '', r.motivo || '');
  openModal('modal-regla-auto');
}

function guardarReglaAuto() {
  const texto = document.getElementById('regla-texto').value.trim();
  if (!texto) { showToast('Ingresa el texto de la regla'); return; }
  const regla = {
    texto,
    cuenta: document.getElementById('regla-cuenta')?.value || '',
    motivo: document.getElementById('regla-motivo')?.value || ''
  };
  if (!regla.cuenta && !regla.motivo) { showToast('Elige cuenta o motivo'); return; }
  if (window._editReglaIdx !== null && window._editReglaIdx !== undefined) {
    reglasAutomaticas[window._editReglaIdx] = regla;
  } else {
    reglasAutomaticas.push(regla);
  }
  markStructuredDirty('catalogos');
  saveLocal();
  closeModal('modal-regla-auto');
  renderReglasAutomaticas();
  showToast('Regla guardada ✓');
}

function eliminarReglaAuto(i) {
  const r = reglasAutomaticas[i];
  if (r) markStructuredDeleted('catalogos', `regla:${i}:${r.texto || ''}:${r.cuenta || ''}:${r.motivo || ''}`);
  markStructuredDirty('catalogos');
  reglasAutomaticas.splice(i, 1);
  saveLocal();
  renderReglasAutomaticas();
  showToast('Regla eliminada');
}


// ── Menú lateral (drawer) ─────────────────────────────────────
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  mostrarVersionCache();
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
    root.style.setProperty('--accent',  '#6c63ff');
    root.style.setProperty('--accent2', '#a78bfa');
    root.style.setProperty('--green',   '#22d3a5');
    root.style.setProperty('--red',     '#ff5e7a');
    root.style.setProperty('--orange',  '#ff9f43');
    document.body.style.background = '#f0f2f5';
  } else if (modo === 'revolut') {
    root.style.setProperty('--bg',      '#000000');
    root.style.setProperty('--bg2',     '#111111');
    root.style.setProperty('--bg3',     '#1a1a1a');
    root.style.setProperty('--text',    '#ffffff');
    root.style.setProperty('--text2',   '#888888');
    root.style.setProperty('--text3',   '#555555');
    root.style.setProperty('--border',  'rgba(255,255,255,.06)');
    root.style.setProperty('--border2', 'rgba(255,255,255,.1)');
    root.style.setProperty('--topbar1', '#000000');
    root.style.setProperty('--topbar2', '#111111');
    root.style.setProperty('--accent',  '#0066ff');
    root.style.setProperty('--accent2', '#4d94ff');
    root.style.setProperty('--green',   '#00d09c');
    root.style.setProperty('--red',     '#ff3d5a');
    root.style.setProperty('--orange',  '#ff8c00');
    root.style.setProperty('--purple',  '#7b61ff');
    document.body.style.background = '#000000';
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
    root.style.setProperty('--accent',  '#6c63ff');
    root.style.setProperty('--accent2', '#a78bfa');
    root.style.setProperty('--green',   '#22d3a5');
    root.style.setProperty('--red',     '#ff5e7a');
    root.style.setProperty('--orange',  '#ff9f43');
    document.body.style.background = '#0f1117';
  }
  localStorage.setItem('tema', modo);
  const btn = document.getElementById('btn-tema');
  const temas = { oscuro: '☀️ Modo claro', claro: '🌑 Tema Revolut', revolut: '🌙 Modo oscuro' };
  if (btn) btn.textContent = temas[modo] || '☀️ Modo claro';
}
function toggleTema() {
  const actual = localStorage.getItem('tema') || 'oscuro';
  const siguiente = { oscuro: 'claro', claro: 'revolut', revolut: 'oscuro' };
  aplicarTema(siguiente[actual] || 'oscuro');
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
  // Widget del Dashboard
  const dashboardAhorro = document.getElementById('dashboard-ahorro-total');
  if (dashboardAhorro) dashboardAhorro.style.filter = blur;
  // Botones ojito
  ['btn-eye-ahorro','btn-eye-menu','btn-eye-dashboard'].forEach(id => {
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
  normalizarCatalogoComentarios();
  // Inicializar fecha
  const fechaEl = document.getElementById('f-fecha');
  if (fechaEl) fechaEl.value = new Date().toISOString().slice(0,10);
  aplicarTema(localStorage.getItem('tema') || 'oscuro');
  // Inicializar IndexedDB (no crítico, en segundo plano)
  try { if (window.DB) DB.migrar(); } catch(e) {}

  // Renderizar menú con datos locales INMEDIATAMENTE
  showTab('menu');
  renderMenu();
  aplicarVisibilidadAhorros(); // aplicar estado inicial (oculto)
  document.addEventListener('click', cerrarDropdownComentario);
  iniciarAutoSync();
  if (isTravelMode()) {
    mostrarEstadoSync(false);
  } else if (usingSupabase() && navigator.onLine) {
    const needsSyncRepair = localStorage.getItem('syncRepairVersion') !== SYNC_REPAIR_VERSION;
    if (needsSyncRepair) {
      localStorage.removeItem('supabaseStructuredDeleted');
      localStorage.removeItem('supabaseStructuredDirty');
    }
    downloadSupabase(needsSyncRepair).then(async ok => {
      if (ok && needsSyncRepair) localStorage.setItem('syncRepairVersion', SYNC_REPAIR_VERSION);
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
        const up = await uploadSupabase();
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

function renderHistoricoMes(el) {
  const byMes = {};
  historico.forEach(g => {
    const mes = (g.fecha || '').slice(0, 7);
    if (!byMes[mes]) byMes[mes] = [];
    byMes[mes].push(g);
  });
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  el.innerHTML = Object.keys(byMes).sort((a,b)=>b.localeCompare(a)).map(mes => {
    const items = byMes[mes].filter(g => !g.ignorar);
    const total = items.reduce((s,g)=>s+g.cantidad, 0);
    const [y, m] = mes.split('-');
    const label = (meses[parseInt(m)-1]||m) + ' ' + y;
    const porCuenta = {};
    items.forEach(g => { porCuenta[g.cuenta] = (porCuenta[g.cuenta]||0) + g.cantidad; });
    const porMotivo = {};
    items.forEach(g => { porMotivo[g.motivo] = (porMotivo[g.motivo]||0) + g.cantidad; });
    const topMotivos = Object.entries(porMotivo).sort((a,b)=>b[1]-a[1]).slice(0,3);
    return `<div class="semana-group">
      <div class="semana-header"><span>${label}</span><span>${fmt(total)}</span></div>
      <div style="padding:8px 12px;display:flex;flex-direction:column;gap:4px">
        ${Object.entries(porCuenta).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2)">
            <span>${c}</span><span>${fmt(v)}</span>
          </div>`).join('')}
        ${topMotivos.length ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
          ${topMotivos.map(([m,v])=>`<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3)"><span>${m}</span><span>${fmt(v)}</span></div>`).join('')}
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}
