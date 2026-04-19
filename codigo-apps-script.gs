// ════════════════════════════════════════════════════════════
//  GASTOS SEMANALES — Google Apps Script (versión completa)
//
//  INSTRUCCIONES:
//  1. Abre tu Google Sheet
//  2. Extensiones → Apps Script
//  3. Borra todo y pega este código completo
//  4. Implementar → Nueva implementación → App web
//     · Ejecutar como: Yo
//     · Acceso: Cualquier persona
//  5. Copia la URL y pégala en app.js (SCRIPT_URL)
// ════════════════════════════════════════════════════════════

const SHEET = {
  SEMANA:          'Semana',
  HISTORICO:       'Historico',
  AH_CUENTAS:     'Ahorros_Cuentas',
  AH_MOVS:        'Ahorros_Movimientos',
  EXCEPCIONES:     'ExcepcionesCorte',
  CAT_CUENTAS:     'Catalogo_Cuentas',
  CAT_MOTIVOS:     'Catalogo_Motivos',
  CAT_COMENTARIOS: 'Catalogo_Comentarios',
  META:            'AppMeta',
};

const HDR_META = ['Clave','Valor'];

const HDR_GASTO = ['ID','Fecha','Cuenta','Motivo','Cantidad','Comentarios',
                   'Abonado','Ignorar','Externo','Semana','AhorroDesc'];
const HDR_AH_C  = ['ID','Nombre','Meta','Grupo','ExcluirTotal'];
const HDR_AH_M  = ['AhorroID','Tipo','Cantidad','Nota','Fecha','Destino','Origen'];
const HDR_EXC   = ['Cuenta','FechaOriginal','FechaExcepcion','Nota'];
const HDR_CAT_C = ['Nombre','Color','TieneCorte','DiaCorte'];
const HDR_CAT_M   = ['Motivo'];
const HDR_CAT_COM = ['Comentario'];

// ── Entry points ─────────────────────────────────────────────
function doGet(e) {
  try {
    const a = (e.parameter || {}).action || 'getAll';
    if (a === 'getAll') return json(getAllData());
    return json({ error: 'Accion no reconocida' });
  } catch (err) { return json({ error: err.message }); }
}

function doPost(e) {
  try {
    const { action, data } = JSON.parse(e.postData.contents);
    const map = {
      addGasto:           () => addGasto(data),
      updateGasto:        () => updateGasto(data),
      deleteGasto:        () => deleteRow(SHEET.SEMANA, data.id),
      hacerCorte:         () => hacerCorte(),
      saveAhorros:        () => saveAhorros(data),
      updateAhorroCuenta: () => updateAhorroCuenta(data),
      deleteAhorroCuenta: () => deleteAhorroCuenta(data.id),
      saveExcepciones:    () => saveExcepciones(data),
      saveCatalogos:      () => saveCatalogos(data),
      saveMeta:           () => saveMeta(data),
    };
    if (!map[action]) return json({ error: 'Accion no reconocida' });
    return json(map[action]());
  } catch (err) { return json({ error: err.message }); }
}

// ── GET ALL ──────────────────────────────────────────────────
function getAllData() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const meta = readMeta(ss);
  return {
    semana:       readGastos(ss, SHEET.SEMANA),
    historico:    readGastos(ss, SHEET.HISTORICO),
    ahorros:      readAhorros(ss),
    excepciones:  readExcepciones(ss),
    catalogos:    readCatalogos(ss),
    recurrentes:  meta.recurrentes  || [],
    deudas:       meta.deudas       || [],
    presupuesto:  meta.presupuesto  || 3400.09,
    nextRecId:    meta.nextRecId    || 1,
    nextDeudaId:  meta.nextDeudaId  || 1,
  };
}

// ── GASTOS ───────────────────────────────────────────────────
function readGastos(ss, name) {
  const sh  = getOrCreate(ss, name, HDR_GASTO);
  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) return [];
  const hdr = raw[0];
  return raw.slice(1).map(row => {
    const o = {};
    hdr.forEach((h, i) => o[h] = row[i]);
    o.Cantidad = Number(o.Cantidad) || 0;
    o.Abonado  = o.Abonado  === true || o.Abonado  === 'SI';
    o.Ignorar  = o.Ignorar  === true || o.Ignorar  === 'SI';
    o.Externo  = o.Externo  || 'no';
    // Normalizar fecha: quitar hora si viene como Date o ISO string
    if (o.Fecha instanceof Date) {
      o.Fecha = Utilities.formatDate(o.Fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else if (o.Fecha && String(o.Fecha).includes('T')) {
      o.Fecha = String(o.Fecha).slice(0, 10);
    }
    return o;
  });
}

function addGasto(data) {
  const sh = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), SHEET.SEMANA, HDR_GASTO);
  sh.appendRow(gastoRow(data));
  return { ok: true };
}

function updateGasto(data) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = getOrCreate(ss, SHEET.SEMANA, HDR_GASTO);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(data.ID)) {
      sh.getRange(i + 1, 1, 1, HDR_GASTO.length).setValues([gastoRow(data)]);
      return { ok: true };
    }
  }
  return { error: 'No encontrado' };
}

function deleteRow(sheetName, id) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = getOrCreate(ss, sheetName, HDR_GASTO);
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]) === String(id)) { sh.deleteRow(i + 1); return { ok: true }; }
  }
  return { error: 'No encontrado' };
}

function hacerCorte() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const sem  = getOrCreate(ss, SHEET.SEMANA,    HDR_GASTO);
  const hist = getOrCreate(ss, SHEET.HISTORICO, HDR_GASTO);
  const data = sem.getDataRange().getValues();
  if (data.length <= 1) return { ok: true, moved: 0 };
  data.slice(1).forEach(row => hist.appendRow(row));
  sem.clearContents();
  setHeaders(sem, HDR_GASTO);
  return { ok: true, moved: data.length - 1 };
}

function gastoRow(d) {
  return HDR_GASTO.map(h => {
    if (h === 'Abonado' || h === 'Ignorar') return d[h] ? 'SI' : 'NO';
    if (h === 'Fecha') {
      // Siempre guardar fecha como string yyyy-MM-dd
      const v = d[h];
      if (!v) return '';
      if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      return String(v).slice(0, 10);
    }
    return d[h] !== undefined ? d[h] : '';
  });
}

// ── AHORROS ──────────────────────────────────────────────────
function readAhorros(ss) {
  const shC = getOrCreate(ss, SHEET.AH_CUENTAS, HDR_AH_C);
  const shM = getOrCreate(ss, SHEET.AH_MOVS,    HDR_AH_M);
  const rawC = shC.getDataRange().getValues();
  const rawM = shM.getDataRange().getValues();
  if (rawC.length <= 1) return [];
  const hdrC = rawC[0], hdrM = rawM[0];
  const movs = rawM.length > 1 ? rawM.slice(1).map(r => {
    const o = {}; hdrM.forEach((h, i) => o[h] = r[i]); return o;
  }) : [];
  return rawC.slice(1).map(row => {
    const o = {}; hdrC.forEach((h, i) => o[h] = row[i]);
    o.id           = Number(o.ID);
    o.nombre       = o.Nombre;
    o.meta         = Number(o.Meta) || 0;
    o.grupo        = o.Grupo || 'General';
    o.excluirTotal = o.ExcluirTotal === 'SI' || o.ExcluirTotal === true;
    o.movimientos = movs
      .filter(m => String(m.AhorroID) === String(o.ID))
      .map(m => ({
        tipo:     m.Tipo,
        cantidad: Number(m.Cantidad) || 0,
        nota:     m.Nota || '',
        fecha:    m.Fecha,
        destino:  m.Destino ? Number(m.Destino) : undefined,
        origen:   m.Origen  ? Number(m.Origen)  : undefined,
      }));
    return o;
  });
}

function saveAhorros(data) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shC = getOrCreate(ss, SHEET.AH_CUENTAS, HDR_AH_C);
  const shM = getOrCreate(ss, SHEET.AH_MOVS,    HDR_AH_M);
  shC.clearContents(); setHeaders(shC, HDR_AH_C);
  shM.clearContents(); setHeaders(shM, HDR_AH_M);
  (data.cuentas || []).forEach(c => {
    shC.appendRow([c.id, c.nombre, c.meta || 0, c.grupo || 'General', c.excluirTotal ? 'SI' : 'NO']);
    (c.movimientos || []).forEach(m =>
      shM.appendRow([c.id, m.tipo, m.cantidad, m.nota||'', m.fecha, m.destino||'', m.origen||''])
    );
  });
  return { ok: true };
}

function updateAhorroCuenta(data) {
  // Actualiza o inserta UNA cuenta (upsert) sin tocar las demás
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shC = getOrCreate(ss, SHEET.AH_CUENTAS, HDR_AH_C);
  const shM = getOrCreate(ss, SHEET.AH_MOVS,    HDR_AH_M);

  // Upsert en cuentas
  const rowsC = shC.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < rowsC.length; i++) {
    if (String(rowsC[i][0]) === String(data.id)) {
      shC.getRange(i+1,1,1,HDR_AH_C.length).setValues([[
        data.id, data.nombre, data.meta||0,
        data.grupo||'General', data.excluirTotal?'SI':'NO'
      ]]);
      found = true; break;
    }
  }
  if (!found) {
    shC.appendRow([data.id, data.nombre, data.meta||0,
                   data.grupo||'General', data.excluirTotal?'SI':'NO']);
  }

  // Reemplazar movimientos de esta cuenta solamente
  const rowsM = shM.getDataRange().getValues();
  // Borrar filas de esta cuenta (de abajo hacia arriba)
  for (let i = rowsM.length-1; i >= 1; i--) {
    if (String(rowsM[i][0]) === String(data.id)) shM.deleteRow(i+1);
  }
  // Re-insertar movimientos
  (data.movimientos||[]).forEach(m =>
    shM.appendRow([data.id, m.tipo, m.cantidad, m.nota||'',
                   String(m.fecha||'').slice(0,10), m.destino||'', m.origen||''])
  );
  return { ok: true };
}

function deleteAhorroCuenta(id) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const shC = getOrCreate(ss, SHEET.AH_CUENTAS, HDR_AH_C);
  const shM = getOrCreate(ss, SHEET.AH_MOVS,    HDR_AH_M);
  const rowsC = shC.getDataRange().getValues();
  for (let i = rowsC.length-1; i >= 1; i--) {
    if (String(rowsC[i][0]) === String(id)) shC.deleteRow(i+1);
  }
  const rowsM = shM.getDataRange().getValues();
  for (let i = rowsM.length-1; i >= 1; i--) {
    if (String(rowsM[i][0]) === String(id)) shM.deleteRow(i+1);
  }
  return { ok: true };
}


// ── EXCEPCIONES DE CORTE ─────────────────────────────────────
function readExcepciones(ss) {
  const sh  = getOrCreate(ss, SHEET.EXCEPCIONES, HDR_EXC);
  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) return [];
  const hdr = raw[0];
  return raw.slice(1).map(row => {
    const o = {}; hdr.forEach((h, i) => o[h] = row[i]); return o;
  });
}

function saveExcepciones(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate(ss, SHEET.EXCEPCIONES, HDR_EXC);
  sh.clearContents(); setHeaders(sh, HDR_EXC);
  (data || []).forEach(e =>
    sh.appendRow([e.Cuenta, e.FechaOriginal, e.FechaExcepcion, e.Nota || ''])
  );
  return { ok: true };
}

// ── CATÁLOGOS ─────────────────────────────────────────────────
function readCatalogos(ss) {
  const result = {};
  const shC = ss.getSheetByName(SHEET.CAT_CUENTAS);
  const shM   = ss.getSheetByName(SHEET.CAT_MOTIVOS);
  const shCom = ss.getSheetByName(SHEET.CAT_COMENTARIOS);
  if (shC) {
    const raw = shC.getDataRange().getValues();
    if (raw.length > 1) result.cuentas = raw.slice(1).map(r => ({
      nombre: r[0], color: r[1],
      tieneCorte: r[2] === 'SI' || r[2] === true,
      diaCorte: Number(r[3]) || null
    }));
  }
  if (shM) {
    const raw = shM.getDataRange().getValues();
    if (raw.length > 1) result.motivos = raw.slice(1).map(r => r[0]).filter(Boolean);
  }
  if (shCom) {
    const raw = shCom.getDataRange().getValues();
    if (raw.length > 1) result.comentarios = raw.slice(1).map(r => r[0]).filter(Boolean);
  }
  return result;
}

function saveCatalogos(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // Cuentas
  const shC = getOrCreate(ss, SHEET.CAT_CUENTAS, HDR_CAT_C);
  shC.clearContents(); setHeaders(shC, HDR_CAT_C);
  (data.cuentas || []).forEach(c =>
    shC.appendRow([c.nombre, c.color, c.tieneCorte ? 'SI' : 'NO', c.diaCorte || ''])
  );
  // Motivos
  const shM = getOrCreate(ss, SHEET.CAT_MOTIVOS, HDR_CAT_M);
  shM.clearContents(); setHeaders(shM, HDR_CAT_M);
  (data.motivos || []).forEach(m => shM.appendRow([m]));
  // Comentarios
  const shCom = getOrCreate(ss, SHEET.CAT_COMENTARIOS, HDR_CAT_COM);
  shCom.clearContents(); setHeaders(shCom, HDR_CAT_COM);
  (data.comentarios || []).forEach(c => shCom.appendRow([c]));
  return { ok: true };
}

// ── HELPERS ──────────────────────────────────────────────────
function getOrCreate(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); setHeaders(sh, headers); }
  return sh;
}

function setHeaders(sh, headers) {
  if (sh.getRange(1, 1).getValue() !== headers[0]) {
    const range = sh.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
    range.setFontWeight('bold');
    range.setBackground('#e2f0ef');
    sh.setFrozenRows(1);
  }
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── META (recurrentes, deudas, presupuesto, etc.) ────────────
function readMeta(ss) {
  const sh  = getOrCreate(ss, SHEET.META, HDR_META);
  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) return {};
  const obj = {};
  raw.slice(1).forEach(row => {
    const key = row[0], val = row[1];
    try { obj[key] = JSON.parse(val); } catch(e) { obj[key] = val; }
  });
  return obj;
}

function saveMeta(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreate(ss, SHEET.META, HDR_META);
  sh.clearContents();
  setHeaders(sh, HDR_META);
  const entries = [
    ['recurrentes',  JSON.stringify(data.recurrentes  || [])],
    ['deudas',       JSON.stringify(data.deudas        || [])],
    ['presupuesto',  JSON.stringify(data.presupuesto   || 3400.09)],
    ['nextRecId',    JSON.stringify(data.nextRecId     || 1)],
    ['nextDeudaId',  JSON.stringify(data.nextDeudaId   || 1)],
  ];
  // También guardar excepciones aquí si vienen
  if (data.excepciones) entries.push(['excepciones', JSON.stringify(data.excepciones)]);
  // Catálogos
  if (data.catalogos) {
    saveCatalogos(data.catalogos);
  }
  // Excepciones en su hoja separada también
  if (data.excepciones) {
    saveExcepciones(data.excepciones);
  }
  entries.forEach(e => sh.appendRow(e));
  return { ok: true };
}