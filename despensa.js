// Despensa - producto maestro separado de lotes/inventario.

let pantryView = 'inicio';
let pantryActiveProductId = null;
let pantryFlow = null;
let pantryScanner = { stream: null, controls: null, callback: null, lastCode: '', lastAt: 0 };
let pantryOcr = { stream: null, targetInput: null, productId: null, originalText: '' };

const PANTRY_EXPIRY_LIMITS = { normal: 14, warning: 7, attention: 3 };
const PANTRY_WASTE_REASONS = ['Caducado','En mal estado','Empaque dañado','Derramado','Contaminado','Calidad','Sobrante/no consumido','Otro'];

function pantryNow() { return new Date().toISOString(); }
function pantryId(prefix) { return makeLocalId(prefix); }
function pantryToday() { return today(); }
function pantryActive(items) { return (items || []).filter(x => x && x.activo !== false); }
function pantryProduct(id) { return pantryProducts.find(p => String(p.id) === String(id)); }
function pantryCategory(id) { return pantryCategories.find(c => String(c.id) === String(id)); }
function pantryLocation(id) { return pantryLocations.find(l => String(l.id) === String(id)); }
function pantryName(list, id, fallback) { return list.find(x => String(x.id) === String(id))?.nombre || fallback || 'Sin definir'; }
function pantryQty(lots = pantryLots) { return lots.reduce((s, l) => s + Number(l.quantity || 0), 0); }
function pantryLotsForProduct(productId) { return pantryLots.filter(l => String(l.product_id) === String(productId) && Number(l.quantity || 0) > 0); }
function pantryEsc(value) { return escapeHtml(value ?? ''); }

function normalizePantryState() {
  const now = pantryNow();
  if (!Array.isArray(pantryProducts)) pantryProducts = [];
  if (!Array.isArray(pantryBarcodes)) pantryBarcodes = [];
  if (!Array.isArray(pantryCategories) || !pantryCategories.length) {
    pantryCategories = PANTRY_DEFAULT_CATEGORIES.map((nombre, i) => ({ id: `cat_${i + 1}`, nombre, activo: true, createdAt: now, updatedAt: now }));
  }
  if (!Array.isArray(pantryLocations) || !pantryLocations.length) {
    pantryLocations = PANTRY_DEFAULT_LOCATIONS.map((nombre, i) => ({ id: `loc_${i + 1}`, nombre, activo: true, createdAt: now, updatedAt: now }));
  }
  if (!Array.isArray(pantryLots)) pantryLots = [];
  if (!Array.isArray(pantryMovements)) pantryMovements = [];
  if (!Array.isArray(pantryMovementLines)) pantryMovementLines = [];
  if (!Array.isArray(pantryExpirationProfiles)) pantryExpirationProfiles = [];
  if (!Array.isArray(pantryOcrCorrections)) pantryOcrCorrections = [];
  pantryCategories.forEach((c, i) => { c.id = c.id || `cat_${i + 1}`; c.activo = c.activo !== false; });
  pantryLocations.forEach((l, i) => { l.id = l.id || `loc_${i + 1}`; l.activo = l.activo !== false; });
  pantryProducts.forEach(p => {
    p.id = p.id || pantryId('prod');
    p.activo = p.activo !== false;
    p.created_at = p.created_at || p.createdAt || now;
    p.updated_at = p.updated_at || p.updatedAt || now;
    p.updatedAt = p.updatedAt || p.updated_at;
  });
  pantryLots.forEach(l => {
    l.id = l.id || pantryId('lot');
    l.quantity = Math.max(0, Number(l.quantity || 0));
    l.updatedAt = l.updatedAt || l.updated_at || now;
    l.created_at = l.created_at || l.createdAt || now;
    l.updated_at = l.updated_at || l.updatedAt || now;
  });
}

function pantryMark(keys) {
  keys.forEach(k => markStructuredDirty(k));
  queueSyncOperation('pantry', { keys });
}

function pantryTransactionSnapshot() {
  return cloneData({financial:expenseTransactionSnapshot(),pantryProducts,pantryBarcodes,pantryCategories,pantryLocations,pantryLots,pantryMovements,pantryMovementLines,pantryExpirationProfiles,pantryOcrCorrections});
}
function restorePantryTransaction(snapshot) {
  ({pantryProducts,pantryBarcodes,pantryCategories,pantryLocations,pantryLots,pantryMovements,pantryMovementLines,pantryExpirationProfiles,pantryOcrCorrections}=snapshot);
  restoreExpenseTransaction(snapshot.financial);
}
function savePantry(keys = ['pantry']) {
  normalizePantryState();
  pantryMark(keys);
  saveLocal();
  renderDespensa();
}

function renderDespensa(view = pantryView) {
  normalizePantryState();
  pantryView = view || 'inicio';
  const nav = document.getElementById('pantry-subnav');
  const body = document.getElementById('pantry-body');
  if (!nav || !body) return;
  const searchFocused = document.activeElement?.id === 'pantry-search';
  const searchSelection = document.activeElement?.selectionStart;
  const tabs = [['inicio','Inicio'], ['inventario','Inventario'], ['caducidad','Caducidad'], ['ajustes','Más']];
  nav.innerHTML = tabs.map(([id, label]) => `<button type="button" class="chip ${pantryView === id ? 'active' : ''}" aria-pressed="${pantryView === id}" onclick="renderDespensa('${id}')">${label}</button>`).join('');
  if (pantryView === 'ajustes') body.innerHTML = `<div class="more-list">${[['productos','Productos','Catálogo y códigos de barras'],['categorias','Categorías','Organiza tus productos'],['ubicaciones','Ubicaciones','Dónde guardas cada producto'],['historial','Historial','Entradas, consumos y movimientos']].map(([id,label,sub]) => `<button type="button" class="more-item" onclick="renderDespensa('${id}')"><span><strong>${label}</strong><small>${sub}</small></span></button>`).join('')}</div>`;
  else if (pantryView === 'inventario') body.innerHTML = renderPantryInventory();
  else if (pantryView === 'productos') body.innerHTML = renderPantryProducts();
  else if (pantryView === 'caducidad') body.innerHTML = renderPantryExpiry();
  else if (pantryView === 'categorias') body.innerHTML = renderPantrySimpleCatalog('category');
  else if (pantryView === 'ubicaciones') body.innerHTML = renderPantrySimpleCatalog('location');
  else if (pantryView === 'historial') body.innerHTML = renderPantryHistory();
  else body.innerHTML = renderPantryHome();
  if (searchFocused) { const input = document.getElementById('pantry-search'); if (input) { input.focus({preventScroll:true}); if (searchSelection != null) input.setSelectionRange(searchSelection,searchSelection); } }
}

function renderPantryHome() {
  const activeProducts = pantryActive(pantryProducts);
  const lots = pantryLots.filter(l => Number(l.quantity || 0) > 0);
  const soon = lots.filter(l => pantryExpiryState(l).rank > 0 && pantryExpiryState(l).rank < 4);
  const expired = lots.filter(l => pantryExpiryState(l).rank === 4);
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Productos</div><div class="stat-val">${activeProducts.length}</div></div>
      <div class="stat-card"><div class="stat-label">Unidades</div><div class="stat-val green">${pantryQty(lots)}</div></div>
      <div class="stat-card"><div class="stat-label">Por caducar</div><div class="stat-val orange">${soon.length}</div></div>
      <div class="stat-card"><div class="stat-label">Caducados</div><div class="stat-val red">${expired.length}</div></div>
    </div>
    <div class="pantry-quick">
      <button type="button" onclick="openPantryEntry()">${uiIcon('plus')}<br>Agregar existencias<br><span class="pantry-meta">Escanea o elige un producto</span></button>
      <button type="button" onclick="openPantryExit()">${uiIcon('check')}<br>Consumir producto<br><span class="pantry-meta">Descontar del inventario</span></button>
      <button type="button" onclick="scanPantryForHome()">${uiIcon('scan')}<br>Escanear código<br><span class="pantry-meta">Encuentra un producto</span></button>
      <button type="button" onclick="renderDespensa('inventario')">${uiIcon('search')}<br>Buscar en inventario<br><span class="pantry-meta">Existencias y ubicaciones</span></button>
    </div>
    <div class="section-heading"><h3>Por caducar</h3><button type="button" class="text-button" onclick="renderDespensa('caducidad')">Ver todos</button></div>
    ${soon.length ? soon.slice().sort(pantryLotSort).slice(0,4).map(renderLotCard).join('') : '<div class="card"><p class="muted">No tienes productos próximos a caducar.</p></div>'}
    ${expired.length ? `<div class="card"><div class="card-title">Caducados</div>${expired.slice(0, 5).map(renderLotCard).join('')}</div>` : ''}
  `;
}

function pantrySearchValue() { return (document.getElementById('pantry-search')?.value || '').trim().toLowerCase(); }

function renderPantryInventory() {
  const searchText = document.getElementById('pantry-search')?.value || '';
  const q = pantrySearchValue();
  const cat = document.getElementById('pantry-filter-category')?.value || '';
  const loc = document.getElementById('pantry-filter-location')?.value || '';
  const mode = document.getElementById('pantry-filter-mode')?.value || 'disponibles';
  const grouped = pantryActive(pantryProducts).map(p => {
    let lots = pantryLotsForProduct(p.id);
    if (loc) lots = lots.filter(l => String(l.location_id) === String(loc));
    if (mode === 'proximos') lots = lots.filter(l => { const s = pantryExpiryState(l); return s.rank > 0 && s.rank < 4; });
    if (mode === 'caducados') lots = lots.filter(l => pantryExpiryState(l).rank === 4);
    if (mode === 'sin-fecha') lots = lots.filter(l => !l.expiration_date);
    return { p, lots, total: pantryQty(lots) };
  }).filter(x => x.total > 0)
    .filter(x => !q || pantryProductLabel(x.p).toLowerCase().includes(q))
    .filter(x => !cat || String(x.p.category_id) === String(cat));
  return `
    <div class="search-wrap"><span class="search-icon">🔍</span><input id="pantry-search" placeholder="Buscar producto..." oninput="renderDespensa('inventario')" value="${pantryEsc(searchText)}"></div>
    <div class="filter-row">
      <select id="pantry-filter-category" onchange="renderDespensa('inventario')" style="flex:1;padding:8px;border-radius:10px;border:1px solid var(--border2);background:var(--bg3);color:var(--text)"><option value="">Categoría</option>${pantryActive(pantryCategories).map(c => `<option value="${pantryEsc(c.id)}" ${String(cat) === String(c.id) ? 'selected' : ''}>${pantryEsc(c.nombre)}</option>`).join('')}</select>
      <select id="pantry-filter-location" onchange="renderDespensa('inventario')" style="flex:1;padding:8px;border-radius:10px;border:1px solid var(--border2);background:var(--bg3);color:var(--text)"><option value="">Ubicación</option>${pantryActive(pantryLocations).map(l => `<option value="${pantryEsc(l.id)}" ${String(loc) === String(l.id) ? 'selected' : ''}>${pantryEsc(l.nombre)}</option>`).join('')}</select>
    </div>
    <div class="filter-row"><select id="pantry-filter-mode" onchange="renderDespensa('inventario')" style="width:100%;padding:8px;border-radius:10px;border:1px solid var(--border2);background:var(--bg3);color:var(--text)">
      ${[['disponibles','Disponibles'],['proximos','Próximos a caducar'],['caducados','Caducados'],['sin-fecha','Sin caducidad']].map(([id,l]) => `<option value="${id}" ${mode === id ? 'selected' : ''}>${l}</option>`).join('')}
    </select></div>
    ${grouped.length ? grouped.map(g => renderInventoryProduct(g.p, g.lots)).join('') : '<div class="empty">Sin inventario disponible</div>'}
  `;
}

function renderInventoryProduct(p, lots) {
  return `<div class="pantry-card">
    <div class="pantry-row">${pantryPhoto(p)}<div class="pantry-main"><div class="pantry-title">${pantryEsc(pantryProductLabel(p))}</div><div class="pantry-meta">${pantryQty(lots)} unidad(es) · ${pantryEsc(pantryName(pantryCategories, p.category_id, 'Sin categoría'))}</div></div></div>
    <div style="margin-top:10px">${lots.slice().sort(pantryLotSort).map(renderLotCard).join('')}</div>
    <div class="pantry-actions"><button class="prim" onclick="openPantryEntry('${pantryEsc(p.id)}')">Entrada</button><button onclick="openPantryExit('${pantryEsc(p.id)}')">Salida</button><button onclick="openPantryTransfer('${pantryEsc(p.id)}')">Mover</button><button class="danger" onclick="openPantryWaste('${pantryEsc(p.id)}')">Tirar</button></div>
  </div>`;
}

function renderLotCard(l) {
  const p = pantryProduct(l.product_id);
  const state = pantryExpiryState(l);
  return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:9px;margin-bottom:6px">
    <div style="display:flex;justify-content:space-between;gap:8px">
      <div style="min-width:0">
        <div class="pantry-title" style="font-size:12px">${pantryEsc(p ? pantryProductLabel(p) : 'Producto')}</div>
        <div class="pantry-meta">${Number(l.quantity || 0)} · ${pantryExpirationLabel(l)} · ${pantryEsc(pantryName(pantryLocations, l.location_id, 'Sin ubicación'))}${l.lot_number ? ` · Lote ${pantryEsc(l.lot_number)}` : ''}</div>
        <span class="pantry-status ${state.cls}">${state.label}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-self:center">
        ${state.rank === 4 ? `<button onclick="openPantryWaste('${pantryEsc(l.product_id)}','${pantryEsc(l.id)}')" style="padding:6px 9px;border-radius:8px;border:1px solid rgba(255,94,122,.35);background:rgba(255,94,122,.1);color:var(--red);font-size:11px">Tirar</button>` : ''}
        <button onclick="openPantryAdjustment('${pantryEsc(l.id)}')" style="padding:6px 9px;border-radius:8px;border:1px solid var(--border2);background:var(--bg2);color:var(--text2);font-size:11px">Ajustar</button>
      </div>
    </div>
  </div>`;
}

function renderPantryProducts() {
  const searchText = document.getElementById('pantry-search')?.value || '';
  const q = pantrySearchValue();
  const products = pantryActive(pantryProducts)
    .filter(p => !q || pantryProductLabel(p).toLowerCase().includes(q) || pantryBarcodes.some(b => String(b.product_id) === String(p.id) && String(b.barcode).includes(q)));
  return `
    <div class="search-wrap"><span class="search-icon">🔍</span><input id="pantry-search" placeholder="Buscar producto o código..." oninput="renderDespensa('productos')" value="${pantryEsc(searchText)}"></div>
    <button class="btn-teal" style="width:100%;margin-bottom:12px" onclick="openPantryProductForm()">+ Alta de producto</button>
    ${products.length ? products.map(p => `<div class="pantry-card">
      <div class="pantry-row">${pantryPhoto(p)}<div class="pantry-main"><div class="pantry-title">${pantryEsc(pantryProductLabel(p))}</div><div class="pantry-meta">${pantryEsc(pantryName(pantryCategories, p.category_id, 'Sin categoría'))} · Ubicación sugerida: ${pantryEsc(pantryName(pantryLocations, p.default_location_id, 'Sin definir'))}</div></div></div>
      <div class="pantry-actions"><button onclick="openPantryProductForm('${pantryEsc(p.id)}')">Editar</button><button class="prim" onclick="openPantryEntry('${pantryEsc(p.id)}')">Entrada</button><button onclick="openPantryLots('${pantryEsc(p.id)}')">Ver lotes</button><button onclick="openPantryProductMovements('${pantryEsc(p.id)}')">Ver movimientos</button></div>
    </div>`).join('') : '<div class="empty">Aún no hay productos registrados</div>'}`;
}

function renderPantryExpiry() {
  const lots = pantryLots.filter(l => Number(l.quantity || 0) > 0 && l.expiration_date).sort(pantryLotSort);
  return lots.length ? lots.map(renderLotCard).join('') : '<div class="empty">No hay productos con caducidad registrada</div>';
}

function renderPantryHistory() {
  const rows = pantryMovements.slice().sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows.length ? rows.slice(0, 120).map(m => {
    const lines = pantryMovementLines.filter(l => String(l.movement_id) === String(m.id));
    return `<div class="pantry-card"><div class="pantry-title">${pantryMovementLabel(m.type)} · ${new Date(m.created_at || m.updatedAt || Date.now()).toLocaleString('es-MX')}</div>
      <div class="pantry-meta">${pantryEsc(pantryProduct(m.product_id)?.nombre || 'Movimiento')} ${m.reason ? `· ${pantryEsc(m.reason)}` : ''}</div>
      <div class="pantry-meta">${lines.map(l => `${Number(l.quantity || 0)} ${pantryName(pantryLocations, l.source_location_id || l.destination_location_id || '', '')}`).join(' · ')}</div>
    </div>`;
  }).join('') : '<div class="empty">Sin movimientos todavía</div>';
}

function renderPantrySimpleCatalog(type) {
  const isCat = type === 'category';
  const list = isCat ? pantryCategories : pantryLocations;
  return `<button class="btn-teal" style="width:100%;margin-bottom:12px" onclick="openPantryCatalogForm('${type}')">+ Agregar ${isCat ? 'categoría' : 'ubicación'}</button>
    ${pantryActive(list).map(item => `<div class="pantry-card"><div class="pantry-row"><div class="pantry-main"><div class="pantry-title">${pantryEsc(item.nombre)}</div></div><button onclick="openPantryCatalogForm('${type}','${pantryEsc(item.id)}')" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2)">Editar</button></div></div>`).join('')}`;
}

function pantryPhoto(p) {
  return p?.photo ? `<img class="pantry-photo" src="${pantryEsc(p.photo)}" alt="">` : '<div class="pantry-photo">🥫</div>';
}

function pantryProductLabel(p) {
  return [p?.nombre, p?.marca, p?.presentacion].filter(Boolean).join(' · ') || 'Producto sin nombre';
}

function pantryExpirationLabel(l) {
  if (!l.expiration_date) return 'Sin fecha';
  if (l.expiration_precision === 'MONTH') {
    const [y, m] = l.expiration_date.split('-');
    return `Caduca en ${new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-MX', { month:'long', year:'numeric' })}`;
  }
  return fmtD(l.expiration_date);
}

function pantryExpiryState(l) {
  if (!l.expiration_date) return { rank: 0, cls: 'ok', label: 'Sin caducidad' };
  const exp = new Date(l.expiration_date + 'T00:00:00');
  const now = new Date(pantryToday() + 'T00:00:00');
  const days = Math.floor((exp - now) / 86400000);
  if (days < 0) return { rank: 4, cls: 'danger', label: `Caducado hace ${Math.abs(days)} d` };
  if (days <= PANTRY_EXPIRY_LIMITS.attention) return { rank: 3, cls: 'danger', label: days === 0 ? 'Caduca hoy' : `Urgente ${days} d` };
  if (days <= PANTRY_EXPIRY_LIMITS.warning) return { rank: 2, cls: 'warn', label: `Atención ${days} d` };
  if (days <= PANTRY_EXPIRY_LIMITS.normal) return { rank: 1, cls: 'warn', label: `Por caducar ${days} d` };
  return { rank: 0, cls: 'ok', label: `${days} días` };
}

function pantryLotSort(a, b) {
  if (!a.expiration_date && b.expiration_date) return 1;
  if (a.expiration_date && !b.expiration_date) return -1;
  return String(a.expiration_date || '9999').localeCompare(String(b.expiration_date || '9999'));
}

function pantryMovementLabel(type) {
  return ({ ENTRY:'Entrada', EXIT:'Salida', TRANSFER:'Movimiento', ADJUSTMENT:'Ajuste', WASTE:'Tirar', DISCARD:'Tirar' })[type] || type || 'Movimiento';
}

function pantrySelectOptions(list, selected = '') {
  return pantryActive(list).map(x => `<option value="${pantryEsc(x.id)}" ${String(selected) === String(x.id) ? 'selected' : ''}>${pantryEsc(x.nombre)}</option>`).join('');
}

function pantryProductOptions(selected = '', onlyWithStock = false) {
  return pantryActive(pantryProducts)
    .filter(p => !onlyWithStock || pantryQty(pantryLotsForProduct(p.id)) > 0)
    .map(p => `<option value="${pantryEsc(p.id)}" ${String(selected) === String(p.id) ? 'selected' : ''}>${pantryEsc(pantryProductLabel(p))}</option>`).join('');
}

function openPantryModal(html) {
  const body = document.getElementById('pantry-form-body');
  if (!body) return;
  body.innerHTML = html;
  openModal('modal-pantry-form');
}

function openPantryProductForm(productId = '', origin = '') {
  const p = pantryProduct(productId) || {};
  const barcode = pantryBarcodes.find(b => String(b.product_id) === String(productId) && b.principal !== false)?.barcode || pantryFlow?.barcode || '';
  openPantryModal(`
    <h2>${productId ? 'Editar producto' : 'Alta de producto'}</h2>
    <div class="field"><label>Foto</label><input type="file" id="pantry-prod-photo" accept="image/*" capture="environment" onchange="previewPantryPhoto(event)"><div id="pantry-photo-preview" style="margin-top:8px">${p.photo ? `<img src="${pantryEsc(p.photo)}" style="width:70px;height:70px;border-radius:12px;object-fit:cover">` : ''}</div></div>
    <div class="field"><label>Código de barras</label><div style="display:flex;gap:8px"><input type="text" id="pantry-prod-barcode" value="${pantryEsc(barcode)}" placeholder="Escanear o escribir" inputmode="numeric"><button class="mbtn sec" type="button" onclick="startPantryScanner(code=>{document.getElementById('pantry-prod-barcode').value=code})" style="flex:0 0 auto">📷</button></div></div>
    <div class="field"><label>Nombre <span class="req">*</span></label><input type="text" id="pantry-prod-name" value="${pantryEsc(p.nombre || '')}" placeholder="Ej. Pan Bimbo Blanco"></div>
    <div class="field"><label>Marca</label><input type="text" id="pantry-prod-brand" value="${pantryEsc(p.marca || '')}" placeholder="Opcional"></div>
    <div class="field"><label>Presentación</label><input type="text" id="pantry-prod-pack" value="${pantryEsc(p.presentacion || '')}" placeholder="Ej. 680 g, botella 600 ml"></div>
    <div class="field"><label>Categoría</label><select id="pantry-prod-category">${pantrySelectOptions(pantryCategories, p.category_id || pantryCategories[0]?.id)}</select></div>
    <div class="field"><label>Ubicación predeterminada</label><select id="pantry-prod-location">${pantrySelectOptions(pantryLocations, p.default_location_id || pantryLocations[0]?.id)}</select><div style="font-size:11px;color:var(--text3);margin-top:4px">Solo es sugerencia para futuras entradas; no crea inventario.</div></div>
    <div class="modal-actions"><button class="mbtn sec" onclick="closeModal('modal-pantry-form')">Cancelar</button><button class="mbtn prim" onclick="savePantryProduct('${pantryEsc(productId)}','${pantryEsc(origin)}')">Guardar</button></div>
  `);
}

async function previewPantryPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const data = await compressPantryImage(file);
  event.target.dataset.photo = data;
  document.getElementById('pantry-photo-preview').innerHTML = `<img src="${data}" style="width:70px;height:70px;border-radius:12px;object-fit:cover">`;
}

function compressPantryImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.onload = () => {
      const max = 640;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    }; img.onerror = reject; img.src = reader.result; };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function savePantryProduct(...args) { return runLocalTransaction(()=>savePantryProductImpl(...args),pantryTransactionSnapshot,restorePantryTransaction); }
function savePantryProductImpl(productId = '', origin = '') {
  const name = document.getElementById('pantry-prod-name').value.trim();
  if (!name) { showToast('Nombre requerido'); return; }
  const now = pantryNow();
  const photo = document.getElementById('pantry-prod-photo')?.dataset.photo;
  const barcode = (document.getElementById('pantry-prod-barcode').value || '').trim();
  if (barcode && pantryBarcodes.some(b => b.activo !== false && b.barcode === barcode && String(b.product_id) !== String(productId))) {
    showToast('Ese código ya está asignado a otro producto');
    return;
  }
  let p = pantryProduct(productId);
  if (!p) {
    p = { id: pantryId('prod'), created_at: now, activo: true };
    pantryProducts.push(p);
  }
  Object.assign(p, {
    barcode,
    nombre: name,
    marca: document.getElementById('pantry-prod-brand').value.trim(),
    presentacion: document.getElementById('pantry-prod-pack').value.trim(),
    category_id: document.getElementById('pantry-prod-category').value,
    default_location_id: document.getElementById('pantry-prod-location').value,
    photo: photo || p.photo || '',
    updated_at: now,
    updatedAt: now
  });
  if (barcode) {
    pantryBarcodes.filter(b => String(b.product_id) === String(p.id)).forEach(b => { b.principal = false; b.updatedAt = now; });
    const existing = pantryBarcodes.find(b => b.barcode === barcode);
    if (existing) Object.assign(existing, { product_id: p.id, principal: true, activo: true, updatedAt: now });
    else pantryBarcodes.push({ id: pantryId('bar'), product_id: p.id, barcode, principal: true, activo: true, created_at: now, updatedAt: now });
  }
  savePantry(['pantryProducts','pantryBarcodes']);
  closeModal('modal-pantry-form');
  showToast('Producto guardado');
  if (origin === 'entry' || pantryFlow?.origin === 'entry') {
    openPantryEntry(p.id);
  } else {
    renderDespensa('productos');
  }
}

function findPantryProductByBarcode(code) {
  const b = pantryBarcodes.find(x => x.activo !== false && String(x.barcode) === String(code));
  return b ? pantryProduct(b.product_id) : null;
}

function openPantryEntry(productId = '') {
  pantryFlow = { type: 'entry', productId: productId || '', origin: 'entry' };
  openPantryModal(renderPantryEntryForm(productId));
}

function renderPantryEntryForm(productId = '') {
  const p = pantryProduct(productId);
  return `
    <h2>Entrada</h2>
    <div class="field"><label>Producto <span class="req">*</span></label><div style="display:flex;gap:8px"><select id="pantry-entry-product" onchange="pantryEntryProductChanged()" style="flex:1">${pantryProductOptions(productId, false)}</select><button class="mbtn sec" type="button" onclick="scanPantryForEntry()" style="flex:0 0 auto">📷</button></div><button class="btn-cancel" style="width:100%;margin-top:8px" onclick="openPantryProductForm('', 'entry')">Registrar producto nuevo</button></div>
    ${!pantryProducts.length ? '<div class="auth-error" style="display:block">Primero registra un producto maestro. No se creará inventario hasta confirmar una entrada.</div>' : ''}
    <div class="field"><label>Cantidad <span class="req">*</span></label><input type="number" id="pantry-entry-qty" min="0.01" step="0.01" inputmode="decimal" value="1"></div>
    <div class="field"><label>Ubicación efectiva <span class="req">*</span></label><select id="pantry-entry-location">${pantrySelectOptions(pantryLocations, p?.default_location_id || pantryLocations[0]?.id)}</select></div>
    <div class="field"><label>Caducidad</label><div style="display:flex;gap:8px"><input type="date" id="pantry-entry-exp"><button class="mbtn sec" style="flex:0 0 auto" onclick="startPantryOcr('pantry-entry-exp','${pantryEsc(productId)}')">Escanear fecha</button></div><label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="pantry-entry-no-exp" onchange="document.getElementById('pantry-entry-exp').disabled=this.checked">Sin fecha de caducidad</label><input type="hidden" id="pantry-entry-exp-precision" value="DAY"><input type="hidden" id="pantry-entry-exp-source" value="manual"><input type="hidden" id="pantry-entry-exp-confidence" value=""></div>
    <div class="field"><label>Número de lote</label><input type="text" id="pantry-entry-lot" placeholder="Opcional"></div>
    <div id="pantry-entry-compatible"></div>
    <div class="modal-actions"><button class="mbtn sec" onclick="closeModal('modal-pantry-form')">Cancelar</button><button class="mbtn prim" onclick="confirmPantryEntry()">Confirmar entrada</button></div>
  `;
}

function pantryEntryProductChanged() {
  const id = document.getElementById('pantry-entry-product').value;
  const p = pantryProduct(id);
  if (p?.default_location_id) document.getElementById('pantry-entry-location').value = p.default_location_id;
}

function scanPantryForEntry() {
  startPantryScanner(code => {
    const p = findPantryProductByBarcode(code);
    if (p) {
      openPantryEntry(p.id);
      showToast('Producto encontrado');
    } else {
      pantryFlow = { type: 'entry', origin: 'entry', barcode: code };
      openPantryModal(`<h2>Producto no registrado</h2><p>Código ${pantryEsc(code)}</p><div class="modal-actions"><button class="mbtn sec" onclick="openPantryEntry()">Buscar otro</button><button class="mbtn prim" onclick="openPantryProductForm('', 'entry')">Registrar producto</button></div>`);
    }
  });
}

function confirmPantryEntry(...args) { return runLocalTransaction(()=>confirmPantryEntryImpl(...args),pantryTransactionSnapshot,restorePantryTransaction); }
function confirmPantryEntryImpl() {
  const productId = document.getElementById('pantry-entry-product')?.value;
  const qty = Number(document.getElementById('pantry-entry-qty')?.value || 0);
  const loc = document.getElementById('pantry-entry-location')?.value;
  if (!pantryProduct(productId) || !Number.isFinite(qty) || !(qty > 0) || !pantryLocation(loc)) { showToast('Completa producto, cantidad y ubicación'); return; }
  const noExp = document.getElementById('pantry-entry-no-exp')?.checked;
  const exp = noExp ? '' : (document.getElementById('pantry-entry-exp')?.value || '');
  const lotNumber = (document.getElementById('pantry-entry-lot')?.value || '').trim();
  const compatible = pantryLots.find(l => String(l.product_id) === String(productId) && String(l.location_id) === String(loc) && String(l.expiration_date || '') === String(exp || '') && String(l.lot_number || '') === String(lotNumber || ''));
  const now = pantryNow();
  const lot = compatible || { id: pantryId('lot'), product_id: productId, quantity: 0, created_at: now, entry_date: pantryToday() };
  Object.assign(lot, {
    quantity: Number(lot.quantity || 0) + qty,
    location_id: loc,
    expiration_date: exp || null,
    expiration_precision: exp ? (document.getElementById('pantry-entry-exp-precision')?.value || 'DAY') : null,
    lot_number: lotNumber,
    expiration_source: exp ? (document.getElementById('pantry-entry-exp-source')?.value || 'manual') : 'none',
    expiration_confidence: document.getElementById('pantry-entry-exp-confidence')?.value || null,
    expiration_original_text: pantryOcr.originalText || '',
    updated_at: now,
    updatedAt: now
  });
  if (!compatible) pantryLots.push(lot);
  recordPantryMovement('ENTRY', productId, [{ lot_id: lot.id, product_id: productId, quantity: qty, destination_location_id: loc }]);
  learnPantryExpiration(productId, exp);
  savePantry(['pantryLots','pantryMovements','pantryMovementLines','pantryExpirationProfiles']);
  closeModal('modal-pantry-form');
  showToast('Entrada registrada');
}

function recordPantryMovement(type, productId, lines, extra = {}) {
  const now = pantryNow();
  const movement = { id: pantryId('pmov'), type, product_id: productId || '', user_id: currentUserId() || '', reason: extra.reason || '', notes: extra.notes || '', created_at: now, updatedAt: now };
  pantryMovements.push(movement);
  lines.forEach((line, i) => pantryMovementLines.push({ id: pantryId('pline'), movement_id: movement.id, line_index: i, created_at: now, updatedAt: now, ...line }));
  return movement;
}

function openPantryExit(productId = '') { openPantryOutForm('EXIT', productId); }
function openPantryWaste(productId = '', lotId = '') { openPantryOutForm('WASTE', productId, lotId); }

function openPantryOutForm(type, productId = '', preferredLotId = '') {
  const onlyStock = true;
  openPantryModal(`
    <h2>${type === 'WASTE' ? 'Tirar' : 'Salida'}</h2>
    <div class="field"><label>Producto <span class="req">*</span></label><div style="display:flex;gap:8px"><select id="pantry-out-product" onchange="refreshPantryOutLots('${type}')" style="flex:1">${pantryProductOptions(productId, onlyStock)}</select><button class="mbtn sec" type="button" onclick="scanPantryForOut('${type}')" style="flex:0 0 auto">📷</button></div></div>
    <div class="field"><label>Cantidad <span class="req">*</span></label><input type="number" id="pantry-out-qty" min="0.01" step="0.01" inputmode="decimal" value="1" oninput="refreshPantryOutLots('${type}')"></div>
    ${type === 'WASTE' ? `<div class="field"><label>Motivo</label><select id="pantry-out-reason">${PANTRY_WASTE_REASONS.map(r => `<option>${pantryEsc(r)}</option>`).join('')}</select></div>` : ''}
    <div id="pantry-out-lots"></div>
    <div class="modal-actions"><button class="mbtn sec" onclick="closeModal('modal-pantry-form')">Cancelar</button><button class="mbtn prim" onclick="confirmPantryOut('${type}')">Confirmar</button></div>
  `);
  if (productId) document.getElementById('pantry-out-product').value = productId;
  refreshPantryOutLots(type, preferredLotId);
}

function refreshPantryOutLots(type, preferredLotId = '') {
  const productId = document.getElementById('pantry-out-product')?.value;
  const qty = Number(document.getElementById('pantry-out-qty')?.value || 0);
  const wrap = document.getElementById('pantry-out-lots');
  if (!wrap || !productId) return;
  const lots = pantryLotsForProduct(productId).slice().sort(pantryLotSort);
  const suggestion = suggestPantryLots(lots, qty, preferredLotId);
  wrap.innerHTML = `<div class="card-title">Lotes disponibles · sugerencia FEFO editable</div>` + lots.map(l => {
    const s = suggestion.find(x => String(x.lot_id) === String(l.id));
    return `<div class="pantry-card"><div class="pantry-meta">${Number(l.quantity || 0)} disponibles · ${pantryExpirationLabel(l)} · ${pantryEsc(pantryName(pantryLocations, l.location_id))}</div><input type="number" class="pantry-out-lot-qty" data-lot="${pantryEsc(l.id)}" min="0" max="${Number(l.quantity || 0)}" step="1" value="${s ? s.quantity : 0}" style="width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1px solid var(--border2);background:var(--bg3);color:var(--text)"></div>`;
  }).join('');
}

function suggestPantryLots(lots, qty, preferredLotId = '') {
  let remaining = Number(qty || 0);
  const result = [];
  const ordered = preferredLotId ? lots.slice().sort((a,b) => String(a.id) === String(preferredLotId) ? -1 : String(b.id) === String(preferredLotId) ? 1 : pantryLotSort(a,b)) : lots;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.quantity || 0), remaining);
    if (take > 0) result.push({ lot_id: lot.id, quantity: take });
    remaining -= take;
  }
  return result;
}

function scanPantryForOut(type) {
  startPantryScanner(code => {
    const p = findPantryProductByBarcode(code);
    if (!p || pantryQty(pantryLotsForProduct(p.id)) <= 0) showToast('Producto sin existencia');
    else openPantryOutForm(type, p.id);
  });
}

function confirmPantryOut(...args) { return runLocalTransaction(()=>confirmPantryOutImpl(...args),pantryTransactionSnapshot,restorePantryTransaction); }
function confirmPantryOutImpl(type) {
  const productId = document.getElementById('pantry-out-product')?.value;
  const requested = Number(document.getElementById('pantry-out-qty')?.value || 0);
  const selected = Array.from(document.querySelectorAll('.pantry-out-lot-qty')).map(el => ({ lot: pantryLots.find(l => String(l.id) === String(el.dataset.lot)), quantity: Number(el.value || 0) })).filter(x => x.lot && x.quantity > 0);
  const total = selected.reduce((s, x) => s + x.quantity, 0);
  if (!productId || !Number.isFinite(requested) || !(requested > 0) || Math.abs(total - requested) > 0.0001) { showToast('La selección debe sumar la cantidad indicada'); return; }
  if (selected.some(x => x.quantity > Number(x.lot.quantity || 0))) { showToast('No puede quedar inventario negativo'); return; }
  selected.forEach(x => { x.lot.quantity = Number(x.lot.quantity || 0) - x.quantity; x.lot.updated_at = pantryNow(); x.lot.updatedAt = x.lot.updated_at; });
  recordPantryMovement(type, productId, selected.map(x => ({ lot_id: x.lot.id, product_id: productId, quantity: x.quantity, source_location_id: x.lot.location_id })), { reason: document.getElementById('pantry-out-reason')?.value || '' });
  savePantry(['pantryLots','pantryMovements','pantryMovementLines']);
  closeModal('modal-pantry-form');
  showToast(type === 'WASTE' ? 'Desecho registrado' : 'Salida registrada');
}

function openPantryTransfer(productId = '') {
  openPantryModal(`
    <h2>Movimiento rápido</h2>
    <div class="field"><label>Producto</label><select id="pantry-transfer-product" onchange="refreshPantryTransferLots()">${pantryProductOptions(productId, true)}</select></div>
    <div id="pantry-transfer-lots"></div>
    <div class="field"><label>Destino</label><select id="pantry-transfer-dest">${pantrySelectOptions(pantryLocations)}</select></div>
    <div class="modal-actions"><button class="mbtn sec" onclick="closeModal('modal-pantry-form')">Cancelar</button><button class="mbtn prim" onclick="confirmPantryTransfer()">Mover</button></div>
  `);
  if (productId) document.getElementById('pantry-transfer-product').value = productId;
  refreshPantryTransferLots();
}

function openPantryAdjustment(lotId = '') {
  const lot = pantryLots.find(l => String(l.id) === String(lotId));
  const productId = lot?.product_id || '';
  openPantryModal(`
    <h2>Ajuste de inventario</h2>
    <div class="field"><label>Producto</label><select id="pantry-adj-product" onchange="refreshPantryAdjustmentLots()">${pantryProductOptions(productId, false)}</select></div>
    <div class="field"><label>Lote</label><select id="pantry-adj-lot" onchange="updatePantryAdjustmentQuantity()"></select></div>
    <div class="field"><label>Cantidad física real</label><input type="number" id="pantry-adj-qty" min="0" step="0.01" inputmode="decimal" value="${lot ? Number(lot.quantity || 0) : 0}"></div>
    <div class="field"><label>Motivo / nota</label><input type="text" id="pantry-adj-reason" placeholder="Ej. conteo físico, merma no registrada..."></div>
    <div class="modal-actions"><button class="mbtn sec" onclick="closeModal('modal-pantry-form')">Cancelar</button><button class="mbtn prim" onclick="confirmPantryAdjustment()">Registrar ajuste</button></div>
  `);
  if (productId) document.getElementById('pantry-adj-product').value = productId;
  refreshPantryAdjustmentLots(lotId);
}

function refreshPantryAdjustmentLots(selected = '') {
  const productId = document.getElementById('pantry-adj-product')?.value;
  const select = document.getElementById('pantry-adj-lot');
  if (!select) return;
  const lots = pantryLots.filter(l=>String(l.product_id)===String(productId)).sort(pantryLotSort);
  select.innerHTML = lots.map(l => `<option value="${pantryEsc(l.id)}" ${String(selected) === String(l.id) ? 'selected' : ''}>${Number(l.quantity || 0)} · ${pantryExpirationLabel(l)} · ${pantryEsc(pantryName(pantryLocations, l.location_id))}</option>`).join('');
  updatePantryAdjustmentQuantity();
}
function updatePantryAdjustmentQuantity() {
  const lot=pantryLots.find(l=>String(l.id)===String(document.getElementById('pantry-adj-lot')?.value));
  document.getElementById('pantry-adj-qty').value=lot?Number(lot.quantity||0):'';
}

function confirmPantryAdjustment(...args) { return runLocalTransaction(()=>confirmPantryAdjustmentImpl(...args),pantryTransactionSnapshot,restorePantryTransaction); }
function confirmPantryAdjustmentImpl() {
  const lot = pantryLots.find(l => String(l.id) === String(document.getElementById('pantry-adj-lot')?.value));
  const raw=document.getElementById('pantry-adj-qty')?.value;
  const physical = Number(raw);
  if (!lot || !raw?.trim() || !Number.isFinite(physical) || physical < 0) { showToast('Selecciona lote y cantidad válida'); return; }
  const before = Number(lot.quantity || 0);
  const delta = physical - before;
  if (delta === 0) { showToast('No hay diferencia que ajustar'); return; }
  const now = pantryNow();
  lot.quantity = physical;
  lot.updated_at = now; lot.updatedAt = now;
  recordPantryMovement('ADJUSTMENT', lot.product_id, [{
    lot_id: lot.id,
    product_id: lot.product_id,
    quantity: delta,
    quantity_before: before,
    quantity_after: physical,
    source_location_id: lot.location_id
  }], { reason: document.getElementById('pantry-adj-reason')?.value || 'Ajuste físico' });
  savePantry(['pantryLots','pantryMovements','pantryMovementLines']);
  closeModal('modal-pantry-form');
  showToast('Ajuste registrado');
}

function refreshPantryTransferLots() {
  const productId = document.getElementById('pantry-transfer-product')?.value;
  const wrap = document.getElementById('pantry-transfer-lots');
  if (!wrap) return;
  const lots = pantryLotsForProduct(productId).slice().sort(pantryLotSort);
  wrap.innerHTML = lots.map(l => `<div class="pantry-card"><label class="pantry-meta">${Number(l.quantity || 0)} · ${pantryExpirationLabel(l)} · ${pantryEsc(pantryName(pantryLocations, l.location_id))}</label><input type="number" class="pantry-transfer-lot-qty" data-lot="${pantryEsc(l.id)}" min="0" max="${Number(l.quantity || 0)}" step="1" value="0" style="width:100%;margin-top:8px;padding:9px;border-radius:8px;border:1px solid var(--border2);background:var(--bg3);color:var(--text)"></div>`).join('');
}

function confirmPantryTransfer(...args) { return runLocalTransaction(()=>confirmPantryTransferImpl(...args),pantryTransactionSnapshot,restorePantryTransaction); }
function confirmPantryTransferImpl() {
  const productId = document.getElementById('pantry-transfer-product')?.value;
  const dest = document.getElementById('pantry-transfer-dest')?.value;
  const selected = Array.from(document.querySelectorAll('.pantry-transfer-lot-qty')).map(el => ({ lot: pantryLots.find(l => String(l.id) === String(el.dataset.lot)), quantity: Number(el.value || 0) })).filter(x => x.lot && x.quantity > 0);
  if (!productId || !dest || !selected.length) { showToast('Selecciona lote, cantidad y destino'); return; }
  if (selected.some(x => x.quantity > Number(x.lot.quantity || 0))) { showToast('No puede quedar inventario negativo'); return; }
  const now = pantryNow();
  const lines = [];
  selected.forEach(x => {
    if (String(x.lot.location_id) === String(dest)) return;
    x.lot.quantity = Number(x.lot.quantity || 0) - x.quantity;
    x.lot.updated_at = now; x.lot.updatedAt = now;
    const target = pantryLots.find(l => String(l.product_id) === String(productId) && String(l.location_id) === String(dest) && String(l.expiration_date || '') === String(x.lot.expiration_date || '') && String(l.lot_number || '') === String(x.lot.lot_number || ''));
    const newLot = target || { ...x.lot, id: pantryId('lot'), quantity: 0, location_id: dest, created_at: now };
    newLot.quantity = Number(newLot.quantity || 0) + x.quantity;
    newLot.updated_at = now; newLot.updatedAt = now;
    if (!target) pantryLots.push(newLot);
    lines.push({ lot_id: x.lot.id, destination_lot_id: newLot.id, product_id: productId, quantity: x.quantity, source_location_id: x.lot.location_id, destination_location_id: dest });
  });
  if (!lines.length) { showToast('El destino es igual al origen'); return; }
  recordPantryMovement('TRANSFER', productId, lines);
  savePantry(['pantryLots','pantryMovements','pantryMovementLines']);
  closeModal('modal-pantry-form');
  showToast('Movimiento registrado');
}

function openPantryLots(productId) {
  const p = pantryProduct(productId);
  openPantryModal(`<h2>${pantryEsc(pantryProductLabel(p))}</h2>${pantryLotsForProduct(productId).sort(pantryLotSort).map(renderLotCard).join('') || '<div class="empty">Sin lotes</div>'}<div class="modal-actions"><button class="mbtn" onclick="closeModal('modal-pantry-form')">Cerrar</button></div>`);
}

function openPantryProductMovements(productId) {
  const p = pantryProduct(productId);
  const rows = pantryMovements.filter(m => String(m.product_id) === String(productId)).sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  openPantryModal(`<h2>${pantryEsc(pantryProductLabel(p))}</h2>${rows.length ? rows.slice(0, 80).map(m => `<div class="pantry-card"><div class="pantry-title">${pantryMovementLabel(m.type)}</div><div class="pantry-meta">${new Date(m.created_at || m.updatedAt || Date.now()).toLocaleString('es-MX')} ${m.reason ? `· ${pantryEsc(m.reason)}` : ''}</div></div>`).join('') : '<div class="empty">Sin movimientos para este producto</div>'}<div class="modal-actions"><button class="mbtn" onclick="closeModal('modal-pantry-form')">Cerrar</button></div>`);
}

function openPantryCatalogForm(type, id = '') {
  const list = type === 'category' ? pantryCategories : pantryLocations;
  if(list.some(x=>String(x.id)!==String(id) && x.activo!==false && normalizarTextoRegla(x.nombre)===normalizarTextoRegla(name))){showToast('Ya existe ese nombre');return;}
  const item = list.find(x => String(x.id) === String(id)) || {};
  openPantryModal(`<h2>${id ? 'Editar' : 'Agregar'} ${type === 'category' ? 'categoría' : 'ubicación'}</h2><div class="field"><label>Nombre</label><input id="pantry-catalog-name" value="${pantryEsc(item.nombre || '')}"></div><div class="modal-actions"><button class="mbtn sec" onclick="closeModal('modal-pantry-form')">Cancelar</button><button class="mbtn prim" onclick="savePantryCatalog('${type}','${pantryEsc(id)}')">Guardar</button></div>`);
}

function savePantryCatalog(...args) { return runLocalTransaction(()=>savePantryCatalogImpl(...args),pantryTransactionSnapshot,restorePantryTransaction); }
function savePantryCatalogImpl(type, id = '') {
  const name = document.getElementById('pantry-catalog-name').value.trim();
  if (!name) { showToast('Nombre requerido'); return; }
  const list = type === 'category' ? pantryCategories : pantryLocations;
  const key = type === 'category' ? 'pantryCategories' : 'pantryLocations';
  const item = list.find(x => String(x.id) === String(id)) || { id: pantryId(type === 'category' ? 'pcat' : 'ploc'), createdAt: pantryNow(), activo: true };
  item.nombre = name; item.updatedAt = pantryNow();
  if (!list.includes(item)) list.push(item);
  savePantry([key]);
  closeModal('modal-pantry-form');
  renderDespensa(type === 'category' ? 'categorias' : 'ubicaciones');
}

function stopPantryCamera(kind) {
  const state=kind==='scan'?pantryScanner:pantryOcr;
  state.session=(state.session||0)+1;
  try{state.controls?.stop?.();}catch{}
  state.stream?.getTracks?.().forEach(track=>track.stop());state.stream=null;state.controls=null;state.reading=false;
  const video=document.getElementById(kind==='scan'?'pantry-scan-video':'pantry-ocr-video');if(video)video.srcObject=null;
}
async function startPantryScanner(callback) {
  stopPantryCamera('scan');const session=pantryScanner.session;
  pantryScanner.lastCode='';pantryScanner.lastAt=0;
  pantryScanner.callback = callback;
  openModal('modal-pantry-scan');
  const status = document.getElementById('pantry-scan-status');
  try {
    const video = document.getElementById('pantry-scan-video');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if(session!==pantryScanner.session){stream.getTracks().forEach(track=>track.stop());return;}
    pantryScanner.stream=stream;
    video.srcObject = pantryScanner.stream;
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','qr_code','data_matrix'] });
      const tick = async () => {
        if (!pantryScanner.stream || session!==pantryScanner.session) return;
        const codes = await detector.detect(video).catch(() => []);
        if(session!==pantryScanner.session)return;
        if (codes[0]?.rawValue) return pantryScannerFound(codes[0].rawValue);
        requestAnimationFrame(tick);
      };
      tick();
    } else if (window.ZXingBrowser?.BrowserMultiFormatReader) {
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        if (session===pantryScanner.session && result?.getText) pantryScannerFound(result.getText());
      });
      if(session!==pantryScanner.session){controls?.stop?.();return;}
      pantryScanner.controls=controls;
    } else {
      status.textContent = 'Lector no disponible. Ingresa el código manualmente.';
    }
  } catch(e) {
    if(session!==pantryScanner.session)return;
    pantryScanner.stream?.getTracks?.().forEach(t => t.stop());
    pantryScanner.stream = null;
    status.textContent = 'No se pudo abrir la cámara. Ingresa manualmente.';
  }
}

function pantryScannerFound(code) {
  const now = Date.now();
  if (pantryScanner.lastCode === code && now - pantryScanner.lastAt < 1600) return;
  pantryScanner.lastCode = code; pantryScanner.lastAt = now;
  if (navigator.vibrate) navigator.vibrate(60);
  const cb = pantryScanner.callback;
  closePantryScanner();
  if (cb) cb(String(code).trim());
}

function closePantryScanner() { closeModal('modal-pantry-scan'); }

function manualPantryBarcode() {
  const code = prompt('Código de barras');
  if (code) pantryScannerFound(code);
}

async function startPantryOcr(inputId, productId = '') {
  stopPantryCamera('ocr');const session=pantryOcr.session;
  pantryOcr.targetInput = inputId;
  pantryOcr.productId = productId || document.getElementById('pantry-entry-product')?.value || '';
  openModal('modal-pantry-ocr');
  const status = document.getElementById('pantry-ocr-status');
  try {
    const video = document.getElementById('pantry-ocr-video');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    if(session!==pantryOcr.session){stream.getTracks().forEach(track=>track.stop());return;}
    pantryOcr.stream=stream;
    video.srcObject = pantryOcr.stream;
    status.textContent = 'Enfoca la fecha y toca Escanear';
  } catch(e) {
    if(session!==pantryOcr.session)return;
    status.textContent = 'No se pudo abrir la cámara. Puedes escribir la fecha manualmente.';
  }
}

async function capturePantryExpiration() {
  const session=pantryOcr.session;
  if(pantryOcr.reading)return;
  const status = document.getElementById('pantry-ocr-status');
  const video = document.getElementById('pantry-ocr-video');
  const canvas = document.getElementById('pantry-ocr-canvas');
  if (!window.Tesseract) { status.textContent = 'OCR no disponible. Ingresa la fecha manualmente.'; return; }
  if(!pantryOcr.stream || video.readyState<2){status.textContent='Espera a que abra la cámara o escribe la fecha manualmente.';return;}
  pantryOcr.reading=true;
  status.textContent = 'Leyendo fecha...';
  const w = video.videoWidth || 1280, h = video.videoHeight || 720;
  const sx = Math.round(w * .12), sy = Math.round(h * .34), sw = Math.round(w * .76), sh = Math.round(h * .2);
  canvas.width = sw; canvas.height = sh;
  try{canvas.getContext('2d').drawImage(video,sx,sy,sw,sh,0,0,sw,sh);}catch{pantryOcr.reading=false;status.textContent='No se pudo capturar la imagen. Intenta de nuevo o escribe la fecha.';return;}
  const result = await Tesseract.recognize(canvas, 'eng+spa').catch(e => ({ data: { text: '' }, error: e }));
  if(session!==pantryOcr.session)return;
  pantryOcr.reading=false;
  const text = result.data?.text || '';
  pantryOcr.originalText = text;
  const parsed = parsePantryExpirationText(text, pantryOcr.productId);
  if (!parsed.date) { status.textContent = 'No detecté una fecha clara. Intenta de nuevo o captura manual.'; return; }
  closePantryOcr();
  showPantryOcrSuggestion(parsed, text);
}

function closePantryOcr() { closeModal('modal-pantry-ocr'); }

function showPantryOcrSuggestion(parsed, text) {
  const label = pantryExpirationLabel({ expiration_date: parsed.date, expiration_precision: parsed.precision });
  const finalDate = prompt(`Fecha sugerida (${Math.round(parsed.confidence * 100)}%): ${label}\nPuedes editarla antes de aceptar.`, parsed.date);
  if (!finalDate) return;
  acceptPantryOcrDate(parsed.date, parsed.precision, parsed.confidence, finalDate, text);
}

function acceptPantryOcrDate(suggested, precision, confidence, finalDate = suggested, text = '') {
  const input = document.getElementById(pantryOcr.targetInput);
  if (input) input.value = finalDate;
  const noExp = document.getElementById('pantry-entry-no-exp'); if (noExp) noExp.checked = false;
  const p = document.getElementById('pantry-entry-exp-precision'); if (p) p.value = precision || 'DAY';
  const s = document.getElementById('pantry-entry-exp-source'); if (s) s.value = 'ocr';
  const c = document.getElementById('pantry-entry-exp-confidence'); if (c) c.value = confidence || '';
  if (finalDate !== suggested) {
    pantryOcrCorrections.push({ id: pantryId('ocr'), product_id: pantryOcr.productId || '', original_text: text || pantryOcr.originalText || '', suggested_date: suggested, confirmed_date: finalDate, confidence, created_at: pantryNow(), updatedAt: pantryNow() });
    markStructuredDirty('pantryOcrCorrections');
  }
}

function setPantryExpirationNoDate() {
  const input = document.getElementById(pantryOcr.targetInput || 'pantry-entry-exp');
  if (input) input.value = '';
  const noExp = document.getElementById('pantry-entry-no-exp'); if (noExp) { noExp.checked = true; document.getElementById('pantry-entry-exp').disabled = true; }
  closePantryOcr();
}

function parsePantryExpirationText(text, productId = '') {
  const src = String(text || '').toUpperCase().replace(/[.,]/g, ' ');
  const monthMap = { ENE:1, JAN:1, FEB:2, MAR:3, ABR:4, APR:4, MAY:5, JUN:6, JUL:7, AGO:8, AUG:8, SEP:9, SEPT:9, OCT:10, NOV:11, DIC:12, DEC:12 };
  const candidates = [];
  const push = (date, precision, token, index) => {
    if (!date) return;
    const d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    const now = new Date(pantryToday() + 'T00:00:00');
    const years = (d - now) / 31536000000;
    let confidence = .45;
    const before = src.slice(Math.max(0, index - 28), index);
    if (/(EXP|CAD|CADUCA|VENCE|VENCIMIENTO|CONSUMIR ANTES|BEST BEFORE|USE BY|BB)/.test(before)) confidence += .3;
    if (/(FAB|MFG|MFD|PROD|PRODUC)/.test(before)) confidence -= .35;
    if (years >= 0 && years <= 8) confidence += .2;
    if (years < -1 || years > 12) confidence -= .4;
    if (/\d{1,2}:\d{2}/.test(token)) confidence -= .5;
    const profile = pantryExpirationProfiles.find(p => String(p.product_id) === String(productId));
    if (profile?.last_successful_format && token.includes(profile.last_successful_format)) confidence += .05;
    candidates.push({ date, precision, token, confidence: Math.max(0, Math.min(1, confidence)) });
  };
  const normalizeYear = y => Number(y) < 100 ? 2000 + Number(y) : Number(y);
  const iso = (y,m,d=1) => `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const patterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g,
    /(\d{1,2})\s+(ENE|JAN|FEB|MAR|ABR|APR|MAY|JUN|JUL|AGO|AUG|SEP|SEPT|OCT|NOV|DIC|DEC)\s+(\d{2,4})/g,
    /(ENE|JAN|FEB|MAR|ABR|APR|MAY|JUN|JUL|AGO|AUG|SEP|SEPT|OCT|NOV|DIC|DEC)\s+(\d{1,2})\s+(\d{2,4})/g,
    /(\d{1,2})[\/\-](\d{2,4})/g
  ];
  let m;
  while ((m = patterns[0].exec(src))) push(iso(normalizeYear(m[3]), m[2], m[1]), 'DAY', m[0], m.index);
  while ((m = patterns[1].exec(src))) push(iso(m[1], m[2], m[3]), 'DAY', m[0], m.index);
  while ((m = patterns[2].exec(src))) push(iso(normalizeYear(m[3]), monthMap[m[2]], m[1]), 'DAY', m[0], m.index);
  while ((m = patterns[3].exec(src))) push(iso(normalizeYear(m[3]), monthMap[m[1]], m[2]), 'DAY', m[0], m.index);
  while ((m = patterns[4].exec(src))) push(iso(normalizeYear(m[2]), m[1], 1), 'MONTH', m[0], m.index);
  const compact = /\b(\d{6}|\d{8})\b/g;
  while ((m = compact.exec(src))) {
    const t = m[1];
    if (t.length === 8) push(iso(t.slice(0,4), t.slice(4,6), t.slice(6,8)), 'DAY', t, m.index);
    else {
      push(iso(normalizeYear(t.slice(4,6)), t.slice(2,4), t.slice(0,2)), 'DAY', t, m.index);
      push(iso(normalizeYear(t.slice(0,2)), t.slice(2,4), t.slice(4,6)), 'DAY', t, m.index);
    }
  }
  candidates.sort((a,b) => b.confidence - a.confidence);
  return candidates[0] || { date: '', precision: 'DAY', confidence: 0 };
}

function learnPantryExpiration(productId, date) {
  if (!productId || !date) return;
  const now = pantryNow();
  let p = pantryExpirationProfiles.find(x => String(x.product_id) === String(productId));
  if (!p) {
    p = { id: pantryId('pprof'), product_id: productId, successful_scans: 0, failed_scans: 0, keywords: [], created_at: now };
    pantryExpirationProfiles.push(p);
  }
  p.successful_scans = Number(p.successful_scans || 0) + 1;
  p.last_successful_format = 'YYYY-MM-DD';
  p.updated_at = now; p.updatedAt = now;
}

window.addEventListener('DOMContentLoaded', () => {
  normalizePantryState();
});

function scanPantryForHome() {
  startPantryScanner(code => {
    const product = findPantryProductByBarcode(code);
    if (product) openPantryLots(product.id);
    else {
      pantryFlow = { type: 'entry', origin: 'entry', barcode: code };
      openPantryModal(`<h2>Producto no registrado</h2><p>Código ${pantryEsc(code)}</p><div class="modal-actions"><button class="mbtn sec" onclick="closeModal('modal-pantry-form')">Volver</button><button class="mbtn prim" onclick="openPantryProductForm('', 'entry')">Registrar producto</button></div>`);
    }
  });
}
