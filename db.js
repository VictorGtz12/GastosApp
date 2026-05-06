// ════════════════════════════════════════════════════════════
//  GASTOS SEMANALES — IndexedDB Cache Layer
//  Caché adicional para versiones, sync history y grandes datasets
//  localStorage sigue siendo la fuente de verdad principal
// ════════════════════════════════════════════════════════════

const DB_NAME = 'GastosDB_v1';
const DB_VERSION = 1;
const DB_STORES = {
  appData:    '++id, key',
  versions:   '++id, savedAt, origen',
  syncHistory:'++id, ts, tipo',
  conciliacion:'++id, clave',
  tags:       '++id, nombre',
};

let _dbPromise = null;

function _openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      Object.entries(DB_STORES).forEach(([name, keyPath]) => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath });
        }
      });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return _dbPromise;
}

async function _getStore(name, mode = 'readonly') {
  const db = await _openDB();
  const tx = db.transaction(name, mode);
  return tx.objectStore(name);
}

// ── App Data ─────────────────────────────────────────────────
async function dbSaveAppData(data) {
  try {
    const store = await _getStore('appData', 'readwrite');
    store.put({ id: 1, key: 'appData', data, savedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    console.warn('[DB] save error:', e);
    return false;
  }
}

async function dbLoadAppData() {
  try {
    const store = await _getStore('appData');
    const result = await new Promise((res, rej) => {
      const req = store.get(1);
      req.onsuccess = () => res(req.result?.data || null);
      req.onerror = () => rej(null);
    });
    return result;
  } catch (e) {
    console.warn('[DB] load error:', e);
    return null;
  }
}

// ── Version History (extendido) ──────────────────────────────
async function dbSaveVersion(entry) {
  try {
    const store = await _getStore('versions', 'readwrite');
    entry.id = Date.now();
    store.put(entry);
    // Mantener solo las últimas 100 versiones
    const count = await new Promise((res, rej) => {
      const req = store.count();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(0);
    });
    if (count > 100) {
      const cursor = store.openCursor();
      let deleted = 0;
      const toDelete = count - 100;
      cursor.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur && deleted < toDelete) {
          store.delete(cur.primaryKey);
          deleted++;
          cur.continue();
        }
      };
    }
    return true;
  } catch (e) {
    console.warn('[DB] save version error:', e);
    return false;
  }
}

async function dbLoadVersions(limit = 50) {
  try {
    const store = await _getStore('versions');
    const all = await new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej([]);
    });
    return all.sort((a, b) => b.savedAt?.localeCompare(a.savedAt)).slice(0, limit);
  } catch (e) {
    console.warn('[DB] load versions error:', e);
    return [];
  }
}

// ── Sync History (extendido) ─────────────────────────────────
async function dbSaveSyncEntry(entry) {
  try {
    const store = await _getStore('syncHistory', 'readwrite');
    entry.id = Date.now();
    store.put(entry);
    // Mantener solo las últimas 200 entradas
    const count = await new Promise((res, rej) => {
      const req = store.count();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(0);
    });
    if (count > 200) {
      const cursor = store.openCursor();
      let deleted = 0;
      const toDelete = count - 200;
      cursor.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur && deleted < toDelete) {
          store.delete(cur.primaryKey);
          deleted++;
          cur.continue();
        }
      };
    }
    return true;
  } catch (e) {
    console.warn('[DB] save sync error:', e);
    return false;
  }
}

async function dbLoadSyncHistory(limit = 50) {
  try {
    const store = await _getStore('syncHistory');
    const all = await new Promise((res, rej) => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej([]);
    });
    return all.sort((a, b) => b.ts?.localeCompare(a.ts)).slice(0, limit);
  } catch (e) {
    console.warn('[DB] load sync error:', e);
    return [];
  }
}

// ── Conciliación Data ────────────────────────────────────────
async function dbSaveConciliacion(clave, data) {
  try {
    const store = await _getStore('conciliacion', 'readwrite');
    store.put({ id: clave, clave, data, savedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    console.warn('[DB] save conciliacion error:', e);
    return false;
  }
}

async function dbLoadConciliacion(clave) {
  try {
    const store = await _getStore('conciliacion');
    const result = await new Promise((res, rej) => {
      const req = store.get(clave);
      req.onsuccess = () => res(req.result?.data || null);
      req.onerror = () => rej(null);
    });
    return result;
  } catch (e) {
    return null;
  }
}

async function dbDeleteConciliacion(clave) {
  try {
    const store = await _getStore('conciliacion', 'readwrite');
    store.delete(clave);
    return true;
  } catch (e) {
    return false;
  }
}

// ── Stats ────────────────────────────────────────────────────
async function dbGetStats() {
  try {
    const db = await _openDB();
    const stats = {};
    for (const [name] of Object.entries(DB_STORES)) {
      if (db.objectStoreNames.contains(name)) {
        const tx = db.transaction(name, 'readonly');
        const store = tx.objectStore(name);
        stats[name] = await new Promise((res) => {
          const req = store.count();
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(0);
        });
      }
    }
    return stats;
  } catch (e) {
    return {};
  }
}

// ── Migración desde localStorage ─────────────────────────────
let _migrado = false;

async function dbMigrarSiNecesario() {
  if (_migrado) return;
  if (localStorage.getItem('dbMigrado') === '1') { _migrado = true; return; }
  try {
    // Migrar versiones
    const versiones = JSON.parse(localStorage.getItem('versionHistorial') || '[]');
    if (versiones.length > 0) {
      for (const v of versiones) {
        await dbSaveVersion(v);
      }
    }
    // Migrar sync history
    const syncHist = JSON.parse(localStorage.getItem('syncHistorial') || '[]');
    if (syncHist.length > 0) {
      for (const s of syncHist) {
        await dbSaveSyncEntry(s);
      }
    }
    localStorage.setItem('dbMigrado', '1');
    _migrado = true;
    console.log('[DB] Migración completada');
  } catch (e) {
    console.warn('[DB] Migración falló (no crítico):', e);
  }
}

// Exponer globalmente
window.DB = {
  saveAppData: dbSaveAppData,
  loadAppData: dbLoadAppData,
  saveVersion: dbSaveVersion,
  loadVersions: dbLoadVersions,
  saveSyncEntry: dbSaveSyncEntry,
  loadSyncHistory: dbLoadSyncHistory,
  saveConciliacion: dbSaveConciliacion,
  loadConciliacion: dbLoadConciliacion,
  deleteConciliacion: dbDeleteConciliacion,
  getStats: dbGetStats,
  migrar: dbMigrarSiNecesario,
};
