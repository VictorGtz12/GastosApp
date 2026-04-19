// ════════════════════════════════════════════════════════════
//  GASTOS SEMANALES — Apps Script v2 (JSON Snapshot)
//
//  Guarda y recupera toda la app como un solo JSON.
//  Sin conflictos. El cliente siempre manda.
//
//  INSTRUCCIONES:
//  1. Abre tu Google Sheet
//  2. Extensiones → Apps Script
//  3. Borra todo y pega este código
//  4. Implementar → Nueva implementación → App web
//     · Ejecutar como: Yo
//     · Acceso: Cualquier persona
//  5. Copia la URL → en la app ☰ → Configurar URL
// ════════════════════════════════════════════════════════════

const SNAPSHOT_SHEET = 'Snapshot';
const SNAPSHOT_KEY   = 'datos';

function doGet(e) {
  try {
    const a = (e.parameter || {}).action || 'getSnapshot';
    if (a === 'getSnapshot')  return json(getSnapshot());
    if (a === 'migrar')       return json(migrarDesdeHojasAntiguas());
    return json({ error: 'Accion no reconocida' });
  } catch(err) { return json({ error: err.message }); }
}

function doPost(e) {
  try {
    const { action, data } = JSON.parse(e.postData.contents);
    if (action === 'saveSnapshot') return json(saveSnapshot(data));
    return json({ error: 'Accion no reconocida' });
  } catch(err) { return json({ error: err.message }); }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Hoja Snapshot ─────────────────────────────────────────────
function getSnapshotSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh   = ss.getSheetByName(SNAPSHOT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SNAPSHOT_SHEET);
    sh.getRange('A1').setValue('key');
    sh.getRange('B1').setValue('value');
    sh.getRange('C1').setValue('updatedAt');
  }
  return sh;
}

// ── Guardar snapshot ──────────────────────────────────────────
function saveSnapshot(data) {
  const sh  = getSnapshotSheet();
  const now = new Date().toISOString();
  const str = JSON.stringify(data);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === SNAPSHOT_KEY) {
      sh.getRange(i+1, 2).setValue(str);
      sh.getRange(i+1, 3).setValue(now);
      return { ok: true, updatedAt: now };
    }
  }
  sh.appendRow([SNAPSHOT_KEY, str, now]);
  return { ok: true, updatedAt: now };
}

// ── Obtener snapshot ──────────────────────────────────────────
function getSnapshot() {
  const sh   = getSnapshotSheet();
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === SNAPSHOT_KEY) {
      return { snapshot: vals[i][1], updatedAt: vals[i][2] };
    }
  }
  return { snapshot: null, updatedAt: null };
}

// ── Migración desde hojas antiguas ───────────────────────────
// Llámalo UNA sola vez desde el navegador:
// TU_URL?action=migrar
function migrarDesdeHojasAntiguas() {
  const snap = getSnapshot();
  if (snap.snapshot) return { ok: false, msg: 'Ya existe snapshot — no se migró' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function readSheet(name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return [];
    const rows = sh.getDataRange().getValues();
    if (rows.length <= 1) return [];
    const hdrs = rows[0].map(h => String(h).trim());
    return rows.slice(1).map(row => {
      const obj = {};
      hdrs.forEach((h,i) => obj[h] = row[i]);
      return obj;
    });
  }

  function normG(r) {
    return {
      id:           Number(r.ID||r.id)||0,
      fecha:        String(r.Fecha||r.fecha||'').slice(0,10),
      cuenta:       r.Cuenta||r.cuenta||'',
      motivo:       r.Motivo||r.motivo||'',
      cantidad:     Number(r.Cantidad||r.cantidad)||0,
      comentarios:  r.Comentarios||r.comentarios||'',
      abonado:      r.Abonado==='SI'||r.abonado===true,
      ignorar:      r.Ignorar==='SI'||r.ignorar===true,
      externo:      r.Externo||r.externo||'no',
      semana:       r.Semana||r.semana||'',
      ahorroDesc:   r.AhorroDesc||r.ahorroDesc||'',
      periodoCorte: null
    };
  }

  const gastos    = readSheet('Semana').map(normG);
  const historico = readSheet('Historico').map(normG);
  const allIds    = [...gastos,...historico].map(g=>g.id).filter(Boolean);
  const nextId    = allIds.length ? Math.max(...allIds)+1 : 1;

  const ahCuentas = readSheet('Ahorros_Cuentas');
  const ahMovs    = readSheet('Ahorros_Movimientos');
  const cuentasAhorro = ahCuentas.map(c => ({
    id:           Number(c.ID||c.id),
    nombre:       c.Nombre||c.nombre||'',
    meta:         Number(c.Meta||c.meta)||0,
    grupo:        c.Grupo||c.grupo||'General',
    excluirTotal: c.ExcluirTotal==='SI'||c.ExcluirTotal===true,
    movimientos:  ahMovs.filter(m=>String(m.AhorroID)===String(c.ID||c.id)).map(m=>({
      tipo:     m.Tipo||'', cantidad: Number(m.Cantidad)||0,
      nota:     m.Nota||'', fecha: String(m.Fecha||'').slice(0,10)
    }))
  }));
  const ahIds = cuentasAhorro.map(c=>c.id).filter(Boolean);

  const catCuentas = readSheet('Catalogo_Cuentas').map(c=>({
    nombre: c.Nombre||'', color: c.Color||'#888',
    tieneCorte: c.TieneCorte==='SI', diaCorte: Number(c.DiaCorte)||null
  }));
  const catMotivos     = readSheet('Catalogo_Motivos').map(m=>m.Motivo||'').filter(Boolean);
  const catComentarios = readSheet('Catalogo_Comentarios').map(c=>c.Comentario||'').filter(Boolean);
  const excepciones    = readSheet('ExcepcionesCorte').map(e=>({
    Cuenta: e.Cuenta||'', FechaOriginal: e.FechaOriginal||'',
    FechaExcepcion: e.FechaExcepcion||'', Nota: e.Nota||''
  }));

  // Leer meta (recurrentes, deudas, presupuesto)
  let recurrentes=[], deudas=[], presupuesto=3400.09, nextRecId=1, nextDeudaId=1;
  const metaSh = ss.getSheetByName('AppMeta');
  if (metaSh) {
    const metaRows = metaSh.getDataRange().getValues().slice(1);
    metaRows.forEach(row => {
      const key=row[0], val=row[1];
      try {
        if (key==='recurrentes')  recurrentes  = JSON.parse(val)||[];
        if (key==='deudas')       deudas       = JSON.parse(val)||[];
        if (key==='presupuesto')  presupuesto  = Number(JSON.parse(val))||3400.09;
        if (key==='nextRecId')    nextRecId    = Number(JSON.parse(val))||1;
        if (key==='nextDeudaId')  nextDeudaId  = Number(JSON.parse(val))||1;
      } catch(e){}
    });
  }

  const data = {
    version: 2, savedAt: new Date().toISOString(),
    gastos, historico, nextId,
    cuentasAhorro, nextAhorroId: ahIds.length ? Math.max(...ahIds)+1 : 1,
    excepciones,
    catalogoCuentas:     catCuentas.length ? catCuentas : null,
    catalogoMotivos:     catMotivos.length ? catMotivos : null,
    catalogoComentarios: catComentarios.length ? catComentarios : null,
    recurrentes, nextRecId, deudas, nextDeudaId, presupuesto
  };

  const result = saveSnapshot(data);
  return { ok: true, migrado: { gastos: gastos.length, historico: historico.length, ahorros: cuentasAhorro.length }, updatedAt: result.updatedAt };
}