// ════════════════════════════════════════════════════════════
//  GASTOS SEMANALES — Apps Script v2 (JSON Snapshot)
//
//  Guarda y recupera toda la app como un solo JSON.
//  Sin conflictos, sin merge. El cliente siempre manda.
//
//  INSTRUCCIONES:
//  1. Abre tu Google Sheet
//  2. Extensiones → Apps Script
//  3. Borra todo y pega este código
//  4. Implementar → Nueva implementación → App web
//     · Ejecutar como: Yo
//     · Acceso: Cualquier persona
//  5. Copia la URL y configúrala en ☰ → Configurar Sheets sync
// ════════════════════════════════════════════════════════════

const SNAPSHOT_SHEET = 'Snapshot';
const SNAPSHOT_KEY   = 'datos';

function doGet(e) {
  try {
    const a = (e.parameter || {}).action || 'getSnapshot';
    if (a === 'getSnapshot') return json(getSnapshot());
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

// ── Obtener hoja Snapshot (crear si no existe) ────────────────
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

  // Buscar fila existente
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === SNAPSHOT_KEY) {
      sh.getRange(i + 1, 2).setValue(str);
      sh.getRange(i + 1, 3).setValue(now);
      return { ok: true, updatedAt: now };
    }
  }
  // No existe — crear
  sh.appendRow([SNAPSHOT_KEY, str, now]);
  return { ok: true, updatedAt: now };
}

// ── Obtener snapshot ──────────────────────────────────────────
function getSnapshot() {
  const sh   = getSnapshotSheet();
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === SNAPSHOT_KEY) {
      return {
        snapshot:  vals[i][1],
        updatedAt: vals[i][2]
      };
    }
  }
  return { snapshot: null, updatedAt: null };
}