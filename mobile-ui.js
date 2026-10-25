/* Presentation and navigation for the iPhone PWA. Financial state stays in app.js. */
const UI_ICONS = {
  home:'<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  list:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M2 10h20M6 15h4"/>',
  chart:'<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow:'<path d="m9 5 7 7-7 7"/>',
  back:'<path d="m14 5-7 7 7 7"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 8a7 7 0 0 1 11.6-3L20 8M4 16l2.9 3A7 7 0 0 0 18.5 16"/>',
  wallet:'<path d="M20 8V5H6a3 3 0 0 0 0 6h15v7a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V8"/><path d="M21 11h-5v5h5M17 13.5h.1"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pantry:'<path d="M5 7h14l-1 14H6ZM8 7V3h8v4M9 12h6M9 16h4"/>',
  repeat:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 21h4"/>',
  logout:'<path d="M9 4H4v16h5M12 12h9m-4-4 4 4-4 4"/>',
  filter:'<path d="M4 6h16M7 12h10M10 18h4"/>',
  scan:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7v10M10 7v10M14 7v10M17 7v10"/>',
  food:'<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M20 21V3c-5 0-5 10 0 10"/>',
  bag:'<path d="M4 7h16l-1 14H5ZM8 8V6a4 4 0 0 1 8 0v2"/>',
  health:'<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  refund:'<path d="m8 3-5 5 5 5M3 8h10a7 7 0 0 1 0 14"/>',
  transfer:'<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  hidden:'<path d="m3 3 18 18M10 5a11 11 0 0 1 2 0c6 0 10 7 10 7a19 19 0 0 1-4 4M6 6a20 20 0 0 0-4 6s4 7 10 7a11 11 0 0 0 5-1"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2"/>'
};
function uiIcon(name, cls = '') {
  return `<svg class="ui-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${UI_ICONS[name] || UI_ICONS.list}</svg>`;
}
function uiCategoryIcon(category) {
  const text = String(category || '').toLowerCase();
  return uiIcon(/comida|restaurante/.test(text) ? 'food' : /mandado|abarrote|compra/.test(text) ? 'bag' : /farmacia|salud/.test(text) ? 'health' : /ahorro|atm/.test(text) ? 'wallet' : /reembolso/.test(text) ? 'refund' : /servicio/.test(text) ? 'repeat' : 'list');
}
const uiState = { origin:'menu', scroll:{}, skipDraft:false, restoring:false, formScope:null, period:'semana', account:'', category:'', categoryManual:false, accountManual:false, creditMode:false, saving:false, lastTab:'menu' };
function uiText(id,text) { const el=document.getElementById(id); if(el && el.textContent !== text) el.textContent=text; }
function uiCategoryWasEdited() { return uiState.categoryManual; }
function uiAccountWasEdited() { return uiState.accountManual; }
function uiDraftKey() { return `expenseDraft:${currentUserId() || 'local'}:${currentWorkspaceId() || 'personal'}`; }
function uiCaptureDraft() {
  if (uiState.restoring || uiState.skipDraft || tabActualGlobal !== 'nuevo' || uiState.formScope !== uiDraftKey()) return;
  const ids = ['f-cantidad','f-cuenta','f-motivo','f-comentarios-input','f-fecha','f-ahorro-cuenta','f-reembolso-persona','f-reembolso-fecha','f-reembolso-nota'];
  const fields = Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.value || '']));
  const meaningful = fields['f-cantidad'] || fields['f-comentarios-input'] || editingId;
  if (!meaningful) return;
  try {
    localStorage.setItem(uiDraftKey(), JSON.stringify({ fields, abonado, abonoTarjeta, ignorar, externo, descontarAhorro, editingId, historico:!!window._editandoHistorico, bank:window._desdeConciliador || null, origin:uiState.origin, categoryManual:uiState.categoryManual, accountManual:uiState.accountManual }));
    uiText('draft-status','Borrador guardado en este iPhone');
  } catch { document.getElementById('draft-status').textContent = 'El borrador no pudo guardarse en este dispositivo'; }
}
function uiRestoreDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(uiDraftKey()) || 'null'); } catch { return; }
  if (!draft?.fields) return;
  if (draft.editingId && !(draft.historico ? historico : gastos).some(g => g.id === draft.editingId)) return;
  uiState.restoring = true;
  try {
    editingId = draft.editingId || null;
    window._editandoHistorico = !!draft.historico;
    window._desdeConciliador = draft.bank || null;
    uiState.categoryManual = !!draft.categoryManual; uiState.accountManual=!!draft.accountManual;
    setAb(!!draft.abonado); setAbonoTarjeta(!!draft.abonoTarjeta); setIg(!!draft.ignorar); setExt(draft.externo || 'no'); setDescAhorro(!!draft.descontarAhorro);
    for (const [id,value] of Object.entries(draft.fields)) {
      const input = document.getElementById(id);
      if (input && (input.tagName !== 'SELECT' || Array.from(input.options).some(o => o.value === value))) input.value = value;
    }
    toggleAbonoTarjetaVisibility();
    document.getElementById('draft-notice').hidden = false;
    document.getElementById('draft-status').textContent = 'Tu borrador está listo para continuar';
  } finally { uiState.restoring = false; }
}
function uiDiscardDraft() {
  try { localStorage.removeItem(uiDraftKey()); } catch {}
  uiState.restoring = true;
  resetForm(); editingId = null; window._editandoHistorico = false; window._desdeConciliador = null;
  uiState.restoring = false; uiState.categoryManual = false; uiState.accountManual = false;
  document.getElementById('draft-notice').hidden = true;
  document.getElementById('draft-status').textContent = 'Se guarda automáticamente como borrador';
  document.getElementById('expense-options').open = false;
  uiUpdateForm();
}
function uiBeforeNavigation(tab) {
  const previous = tabActualGlobal;
  if (previous === 'nuevo' && tab !== 'nuevo') uiCaptureDraft();
  uiState.scroll[previous] = window.scrollY;
  if (tab === 'nuevo' && previous !== 'nuevo') {
    uiState.origin = previous;
    const scopeChanged = uiState.formScope && uiState.formScope !== uiDraftKey();
    uiState.formScope = uiDraftKey();
    if (scopeChanged) { resetForm(); editingId = null; window._editandoHistorico = false; window._desdeConciliador = null; }
    if (!editingId && !window._desdeConciliador) {
      resetForm(); uiState.categoryManual = false; uiState.accountManual = false;
      document.getElementById('draft-notice').hidden = true;
      document.getElementById('expense-options').open = false;
      uiRestoreDraft();
    }
  }
  uiState.skipDraft = false;
}
function uiAfterNavigation(tab) {
  const destination = tab === 'nuevo' ? uiState.origin : tab;
  const group = ['externos','historico','gastos'].includes(destination) ? 'gastos' : ['ahorros','cortes'].includes(destination) ? 'cortes' : ['menu','dashboard'].includes(destination) ? destination : 'mas';
  document.querySelectorAll('.tabs .tab').forEach(el => {
    const active = el.dataset.tab === group;
    el.classList.toggle('active',active);
    if (active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current');
  });
  document.body.classList.toggle('form-mode',tab === 'nuevo');
  document.querySelectorAll('[data-account-view]').forEach(el => { const active = el.dataset.accountView === tab; el.classList.toggle('active',active); el.setAttribute('aria-pressed',active); });
  document.querySelectorAll('[data-movement-view]').forEach(el => { const active = el.dataset.movementView === tab; el.classList.toggle('active',active); el.setAttribute('aria-pressed',active); });
  document.getElementById('topbar-title').textContent = ({menu:'Inicio',gastos:'Movimientos',cortes:'Cuentas',ahorros:'Cuentas',externos:'Por cobrar',dashboard:'Reportes',mas:'Más',nuevo:editingId?'Editar movimiento':'Nuevo gasto'})[tab] || document.getElementById('topbar-title').textContent;
  if (tab === 'mas') uiRenderMore();
  if (tab === 'menu') uiRenderHome();
  if (tab === 'nuevo') uiUpdateForm();
  if (tab === 'cortes') uiAccountActions();
  if (tab === 'conciliacion') uiReconciliationSteps();
  document.querySelectorAll('.content').forEach(el => el.setAttribute('aria-hidden',!el.classList.contains('active')));
  if (tab !== uiState.lastTab) {
    const target = uiState.scroll[tab] || 0;
    requestAnimationFrame(() => window.scrollTo(0,tab === 'nuevo' ? 0 : target));
    uiState.lastTab = tab;
  }
}
function uiExpenseDestination(fallback = 'gastos') {
  return TABS.includes(uiState.origin) && uiState.origin !== 'nuevo' ? uiState.origin : fallback;
}
function uiExpenseSaved() {
  try { localStorage.removeItem(uiDraftKey()); } catch {}
  uiState.skipDraft = true; uiState.categoryManual = false;
  document.getElementById('draft-notice').hidden = true;
  document.getElementById('draft-status').textContent = 'Se guarda automáticamente como borrador';
  document.getElementById('form-error').style.display = 'none';
}
function uiCancelExpense() {
  uiCaptureDraft();
  const destination = uiExpenseDestination('menu');
  uiState.skipDraft = true;
  editingId = null; window._editandoHistorico = false; window._desdeConciliador = null;
  resetForm(); showTab(destination);
}
function uiStartEdit(id,isHistoric=false) {
  const record=(isHistoric?historico:gastos).find(g=>g.id===id); if(!record)return;
  closeModal('modal-detail');
  uiState.formScope=uiDraftKey();uiState.restoring=true;
  resetForm();editingId=id;window._editandoHistorico=isHistoric;window._desdeConciliador=null;
  uiState.creditMode=!!record.abonoTarjeta;uiState.categoryManual=true;uiState.accountManual=true;
  for(const [field,value] of Object.entries({'f-cantidad':record.cantidad,'f-cuenta':record.cuenta,'f-motivo':record.motivo,'f-comentarios-input':record.comentarios||'','f-fecha':record.fecha||today()}))document.getElementById(field).value=value;
  setAb(!!record.abonado);setIg(!!record.ignorar);setExt(record.externo||'no');llenarReembolsoForm(record);toggleAbonoTarjetaVisibility();setAbonoTarjeta(!!record.abonoTarjeta);
  setDescAhorro(!!record.ahorroDesc);
  if(record.ahorroDesc){const account=cuentasAhorro.find(c=>c.nombre===record.ahorroDesc);if(account)document.getElementById('f-ahorro-cuenta').value=account.id;}
  uiState.restoring=false;
  document.getElementById('draft-notice').hidden=true;
  document.getElementById('expense-options').open=!!record.ahorroDesc || record.externo!=='no' || !!record.ignorar;
  showTab('nuevo');uiUpdateForm();
}
function uiSetOperation(value) {
  if (value === 'abono' && !getCortesConfig()[document.getElementById('f-cuenta').value]) {
    const first = Object.keys(getCortesConfig())[0];
    if (!first) { showToast('Agrega una tarjeta en Catálogos para registrar un abono'); return; }
    document.getElementById('f-cuenta').value = first;
  }
  setAbonoTarjeta(value === 'abono');
  if (value === 'abono') { setAb(true); setExt('no'); setIg(true); }
  else { setAb(false); setIg(false); }
  uiUpdateForm(); uiCaptureDraft();
}
function uiUpdateForm() {
  const isCredit = !!getCortesConfig()[document.getElementById('f-cuenta')?.value];
  if (!isCredit && abonoTarjeta) setAbonoTarjeta(false);
  if (uiState.creditMode && !isCredit) { setAb(false); setIg(false); }
  uiState.creditMode=abonoTarjeta;
  document.querySelectorAll('[data-operation]').forEach(el => { const active = (el.dataset.operation === 'abono') === abonoTarjeta; el.classList.toggle('active',active); el.setAttribute('aria-pressed',active); });
  const special = externo !== 'no' || descontarAhorro || (ignorar && !abonoTarjeta);
  if (special) document.getElementById('expense-options').open = true;
  uiText('operation-note',abonoTarjeta ? 'El abono reduce la deuda de la tarjeta y se excluye del presupuesto semanal.' : '');
  uiText('expense-save',editingId ? 'Guardar cambios' : abonoTarjeta ? 'Guardar abono' : 'Guardar gasto');
  uiText('expense-form-title',editingId ? 'Ajusta los detalles' : abonoTarjeta ? 'Un abono a tu tarjeta' : '¿Cuánto gastaste?');
  document.querySelectorAll('#expense-form .tog').forEach(el => el.setAttribute('aria-pressed', /sel-no|sel-si|sel-ig|sel-ext/.test(el.className)));
}
async function uiSubmitExpense(event) {
  event?.preventDefault();
  if (uiState.saving) return;
  const error = document.getElementById('form-error');
  const amount = Number(document.getElementById('f-cantidad').value);
  let message = '';
  if (!Number.isFinite(amount) || amount <= 0) message = 'Escribe un importe mayor que cero.';
  else if (!getCuentas().includes(document.getElementById('f-cuenta').value)) message = 'Selecciona una cuenta válida.';
  else if (!catalogoMotivos.includes(document.getElementById('f-motivo').value)) message = 'Selecciona una categoría válida.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(document.getElementById('f-fecha').value)) message = 'Selecciona la fecha del movimiento.';
  if (message) { error.textContent = message; error.style.display = 'block'; error.scrollIntoView({block:'center'}); return; }
  error.style.display = 'none';
  uiState.saving = true; const btn = document.getElementById('expense-save'); btn.disabled = true;
  try { await guardarGasto(); }
  catch (err) { console.error('No se pudo guardar el movimiento',err); error.textContent = 'No se pudo guardar. Tu borrador sigue disponible; vuelve a intentarlo.'; error.style.display = 'block'; }
  finally { syncBloqueado = false; uiState.saving = false; btn.disabled = false; }
}
function uiRuleApplied(changes) {
  document.getElementById('rule-hint').textContent = changes.length ? `Sugerencia automática: ${changes.join(' · ')}. Puedes cambiarla.` : '';
}
const uiModalFocus = new Map();
function uiModalOpened(id) {
  const overlay=document.getElementById(id);const modal=overlay?.querySelector('.modal');if(!modal)return;
  uiModalFocus.set(id,document.activeElement);
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.tabIndex=-1;
  const title=modal.querySelector('h2');
  if(title){title.id ||= `${id}-title`;modal.setAttribute('aria-labelledby',title.id);}
  requestAnimationFrame(()=>{if(overlay.classList.contains('open'))modal.focus({preventScroll:true});});
}
function uiModalClosed(id) {
  const previous=uiModalFocus.get(id);uiModalFocus.delete(id);
  requestAnimationFrame(()=>{if(!document.querySelector('.overlay.open') && previous?.isConnected && previous.getClientRects().length)previous.focus({preventScroll:true});});
}
function uiRenderHome() {
  if (!document.getElementById('home-recent')) return;
  const now = new Date();
  document.getElementById('home-date').textContent = now.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'});
  const weekStart = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay()+6)%7);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
  document.getElementById('hero-week').textContent = `${weekStart.toLocaleDateString('es-MX',{day:'numeric',month:'short'})} — ${weekEnd.toLocaleDateString('es-MX',{day:'numeric',month:'short'})}`;
  const recent = [...gastos,...historico].sort(uiSortMovements).slice(0,4);
  document.getElementById('home-recent').innerHTML = recent.length ? `<div class="movement-list">${recent.map(g => uiMovementRow(g)).join('')}</div>` : uiEmpty('Tus movimientos empiezan aquí','Agrega tu primer gasto para ver cómo va tu semana.','Registrar gasto','nuevo');
  const upcoming = [];
  for (const cuenta of Object.keys(getCortesConfig())) {
    const end = getPeriodoActualKey(cuenta)?.split('|')[1];
    if (end) { const date = new Date(end+'T12:00:00'); if ((date-now)/864e5 <= 7) upcoming.push({date,title:cuenta,sub:'Corte de tarjeta',tab:'cortes'}); }
  }
  for (const r of recurrentes.filter(r => r.activo)) {
    if (recurrenteYaPagado(r)) continue;
    const day = Math.min(Number(r.dia)||1,new Date(now.getFullYear(),now.getMonth()+1,0).getDate());
    let date = new Date(now.getFullYear(),now.getMonth(),day,12);
    const todayStart = new Date(now.getFullYear(),now.getMonth(),now.getDate());
    if (date < todayStart) date = new Date(now.getFullYear(),now.getMonth()+1,Math.min(Number(r.dia)||1,new Date(now.getFullYear(),now.getMonth()+2,0).getDate()),12);
    if ((date-now)/864e5 <= 7) upcoming.push({date,title:r.nombre,sub:`Cargo recurrente · ${fmt(r.cantidad)}`,tab:'recurrentes'});
  }
  upcoming.sort((a,b)=>a.date-b.date);
  document.getElementById('home-upcoming').innerHTML = upcoming.length ? upcoming.slice(0,5).map(a=>`<div class="upcoming-row"><div class="upcoming-date"><b>${a.date.getDate()}</b><small>${a.date.toLocaleDateString('es-MX',{month:'short'})}</small></div><button type="button" data-go="${a.tab}"><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.sub)}</span></button>${uiIcon('arrow')}</div>`).join('') : '<p class="muted">Sin cortes ni cargos próximos en los siguientes 7 días.</p>';
  aplicarVisibilidadAhorros();
}
function uiEmpty(title,description,action,tab) {
  return `<div class="empty">${uiIcon('list')}<strong>${escapeHtml(title)}</strong>${escapeHtml(description)}${action?`<br><button type="button" class="text-button" data-go="${tab}">${escapeHtml(action)}</button>`:''}</div>`;
}
function uiSortMovements(a,b) { return String(b.fecha).localeCompare(String(a.fecha)) || Number(b.id)-Number(a.id); }
function uiMovementRow(g, selectable = false) {
  const historic = historico.some(item=>item.id===g.id) && !gastos.some(item=>item.id===g.id);
  const selected = selectable && !historic && seleccionMasiva.has(g.id);
  const status = g.ignorar ? 'Fuera del presupuesto' : g.externo === 'externo' ? 'Por cobrar' : g.externo === 'pagado' ? 'Cobrado' : g.abonoTarjeta ? 'Abono a tarjeta' : g.abonado ? 'Abonado' : 'Sin abonar';
  const title = g.comentarios || g.motivo;
  return `<button type="button" class="movement-row ${selected?'selected':''} ${g.ignorar?'excluded':''}" data-movement="${Number(g.id)}" data-selectable="${selectable && !historic}" ${selectable && !historic?`aria-pressed="${selected}"`:''}>
    <span class="movement-icon">${selectable && !historic ? uiIcon(selected?'check':'plus') : uiCategoryIcon(g.motivo)}</span>
    <span class="movement-copy"><span class="movement-title">${escapeHtml(title)}</span><span class="movement-meta">${escapeHtml(g.cuenta)} · ${escapeHtml(g.motivo)}${historic?' · Historial':''}</span></span>
    <span class="movement-amount ${g.abonoTarjeta?'credit':''}">${g.abonoTarjeta?'− ':''}${fmt(g.cantidad)}<span class="movement-status">${escapeHtml(status)}${gastoPendienteSync(g)?' · Local':''}</span></span>
  </button>`;
}
function uiMovementMatches(g) {
  const q = normalizarTextoRegla(document.getElementById('search-in').value);
  if (q && !normalizarTextoRegla(`${g.comentarios || ''} ${g.cuenta} ${g.motivo} ${g.cantidad}`).includes(q)) return false;
  if (uiState.account && g.cuenta !== uiState.account) return false;
  if (uiState.category && g.motivo !== uiState.category) return false;
  if (activeFilter === 'pendiente' && g.abonado) return false;
  if (activeFilter === 'abonado' && !g.abonado) return false;
  if (activeFilter === 'ignorar' && !g.ignorar) return false;
  if (activeFilter === 'externo' && g.externo === 'no') return false;
  if (activeFilter === 'hist-pendiente' && (!g._esHistorico || g.abonado || g.ignorar || g.externo !== 'no')) return false;
  const date = String(g.fecha || '').slice(0,10);
  if (uiState.period === 'hoy' && date !== today()) return false;
  if (uiState.period === 'mes' && !date.startsWith(today().slice(0,7))) return false;
  if (uiState.period === 'semana') {
    // Current working week is the same collection used by the weekly budget.
    if (g._esHistorico && activeFilter !== 'hist-pendiente' && activeFilter !== 'pendiente') return false;
  }
  return true;
}
function uiRenderMovements() {
  if (!document.getElementById('movement-period')) return;
  uiState.period = document.getElementById('movement-period').value;
  uiState.account = document.getElementById('movement-account').value;
  uiState.category = document.getElementById('movement-category').value;
  const all = [...gastos.map(g=>({...g,_esHistorico:false})),...historico.map(g=>({...g,_esHistorico:true}))];
  const list = all.filter(uiMovementMatches).sort(uiSortMovements);
  const total = list.filter(g=>!g.ignorar && !g.abonoTarjeta).reduce((s,g)=>s+Number(g.cantidad||0),0);
  document.getElementById('movement-count').textContent = `${list.length} movimiento${list.length===1?'':'s'} · ${fmt(total)}`;
  const hasFilters = activeFilter !== 'todos' || uiState.period !== 'semana' || uiState.account || uiState.category || document.getElementById('search-in').value;
  document.getElementById('clear-movement-filters').hidden = !hasFilters;
  const groups = new Map(); for (const g of list) { const date = g.fecha || 'Sin fecha'; if (!groups.has(date)) groups.set(date,[]); groups.get(date).push(g); }
  let html = activeFilter === 'pendiente' ? renderResumenSinAbonarPorCuenta(list) : '';
  for (const [date,items] of groups) {
    const value = items.filter(g=>!g.ignorar && !g.abonoTarjeta).reduce((s,g)=>s+Number(g.cantidad||0),0);
    const label = date === today() ? 'Hoy' : /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date+'T12:00:00').toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short',year:date.slice(0,4)!==today().slice(0,4)?'numeric':undefined}) : date;
    html += `<div class="day-heading"><span>${escapeHtml(label)}</span><span>${fmt(value)}</span></div><div class="movement-list">${items.map(g=>uiMovementRow(g,modoMasivo)).join('')}</div>`;
  }
  document.getElementById('gastos-list').innerHTML = html || uiEmpty(hasFilters?'Sin coincidencias':'Todavía no hay gastos',hasFilters?'Prueba otro período o limpia los filtros.':'Registra una compra y aparecerá aquí.',hasFilters?'':'Registrar gasto','nuevo');
  const count = historico.filter(g=>!g.abonado&&!g.ignorar&&g.externo==='no').length;
  const alert = document.getElementById('gastos-hist-pend-alert');
  alert.style.display = count && activeFilter !== 'hist-pendiente' ? 'flex':'none';
  document.getElementById('gastos-hist-pend-text').textContent = `${count} movimiento${count===1?'':'s'} de semanas anteriores`;
}
function uiClearMovementFilters() {
  document.getElementById('search-in').value = '';
  document.getElementById('movement-period').value = 'semana';
  document.getElementById('movement-account').value = '';
  document.getElementById('movement-category').value = '';
  setFilter('todos');
}
function uiPopulateFilters() {
  const account = document.getElementById('movement-account'); const category = document.getElementById('movement-category');
  const a = account.value; const c = category.value;
  account.innerHTML = '<option value="">Todas las cuentas</option>'+getCuentas().map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  category.innerHTML = '<option value="">Todas las categorías</option>'+catalogoMotivos.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (getCuentas().includes(a)) account.value=a;
  if (catalogoMotivos.includes(c)) category.value=c;
}
function uiRenderMore() {
  const group = (title,items) => `<div class="more-group"><h3 class="more-group-title">${title}</h3><div class="more-list">${items.map(([icon,title,sub,action,value])=>`<${action==='href'?'a':'button'} ${action==='href'?`href="${value}"`:`type="button" data-${action}="${value}"`} class="more-item">${uiIcon(icon)}<span><strong>${title}</strong><small>${sub}</small></span>${uiIcon('arrow')}</${action==='href'?'a':'button'}>`).join('')}</div></div>`;
  document.getElementById('more-body').innerHTML = group('Tu día a día',[
    ['pantry','Despensa','Inventario, caducidad y escáner','go','despensa'],
    ['repeat','Recurrentes y deudas','Servicios y compras a meses','go','recurrentes'],
    ['calendar','Recordatorios','Tareas, notas y pendientes','href','tasks.html'],
    ['check','Conciliación bancaria','Revisa tu estado de cuenta','action','reconcile']
  ])+group('Personalización',[
    ['settings','Ajustes','Presupuesto, apariencia y herramientas de datos','action','settings'],
    ['list','Catálogos y reglas','Cuentas, categorías y comercios','go','catalogos'],
    ['bell','Alertas de corte','Configura tus recordatorios','action','alerts'],
    ['clock','Historial por semana','Consulta semanas cerradas','go','historico']
  ])+`<button type="button" class="more-item danger" data-action="logout">${uiIcon('logout')}<span>Cerrar sesión</span></button><p class="form-note" style="text-align:center">Gastos · ${APP_VERSION}</p>`;
}
function uiAccountActions() {
  document.querySelectorAll('#cortes-list .tarjeta-card').forEach(card=>{
    const name = card.querySelector('.tarjeta-nombre')?.textContent.trim();
    if (!getCuentas().includes(name) || card.querySelector('[data-concile-account]')) return;
    const row = document.createElement('div'); row.className='action-row';
    row.innerHTML=`<button type="button" class="btn-retirar" data-concile-account="${escapeHtml(name)}" onclick="event.stopPropagation();uiOpenReconciliation(this.dataset.concileAccount)">Conciliar</button><button type="button" class="btn-retirar" data-credit-account="${escapeHtml(name)}" onclick="event.stopPropagation();uiOpenCredit(this.dataset.creditAccount)">Registrar abono</button>`;
    card.append(row);
  });
}
function uiOpenReconciliation(account) {
  closeModal('modal-corte-tarjeta');
  abrirConciliacion();
  if (account) { document.getElementById('concil-cuenta').value = account; actualizarPeriodosConcil(); }
  uiReconciliationSteps();
}
function uiOpenCredit(account) {
  const open = () => {
    closeModal('modal-corte-tarjeta');
    showTab('nuevo'); uiDiscardDraft();
    document.getElementById('f-cuenta').value=account;
    uiSetOperation('abono');
  };
  let draft;
  try { draft=JSON.parse(localStorage.getItem(uiDraftKey()) || 'null'); } catch {}
  if(draft?.fields?.['f-cantidad'] || draft?.fields?.['f-comentarios-input']) modalConfirmar('Tienes un borrador pendiente. ¿Descartarlo y comenzar un abono a esta tarjeta?',open);
  else open();
}
function uiReconciliationSteps() {
  const status = document.getElementById('concil-pdf-status');
  const busy = /procesando|extrayendo|analizando|leyendo/i.test(status?.textContent || '');
  const result = (window._bancMovs || []).length || /\d+.*conciliad/i.test(status?.textContent || '');
  document.querySelectorAll('#reconciliation-steps li').forEach((el,i)=>{ el.classList.toggle('active',i===(result?2:busy?1:0)); el.classList.toggle('complete',i<(result?2:busy?1:0)); });
  document.getElementById('concil-review-note').textContent = result ? 'Revisa las coincidencias y los cargos pendientes antes de registrar cambios. Las coincidencias posibles necesitan tu revisión.' : 'Elige tu tarjeta y período, después sube el PDF o las imágenes de tu estado de cuenta.';
}
function uiSyncStatus(ok,estado) {
  const el = document.getElementById('sync-status'); if (!el) return;
  const banner = document.getElementById('banner-pendientes');
  el.style.display='inline';el.style.cursor='pointer';el.onclick=()=>verColaSync();
  const pending = hasPendingSync();
  const problem = usingServerAuth() && (estado==='error' || estado==='conflict');
  banner.style.display=problem?'flex':'none';
  let text = 'Guardado en este dispositivo',color='var(--text3)';
  if (!usingServerAuth()) { text='Inicia sesión para sincronizar'; el.onclick=()=>openModal('modal-auth'); }
  else if (estado==='subiendo'||estado==='descargando') text='Sincronizando…';
  else if (estado==='conflict') { text='Hay cambios que revisar';color='var(--orange)'; }
  else if (estado==='error') { text='No se pudo sincronizar';color='var(--red)'; }
  else if (!navigator.onLine) text=pending?'Sin conexión · guardado en el iPhone':'Sin conexión · copia local';
  else if (isTravelMode()) text=pending?'Modo viaje · guardado en el iPhone':'Modo viaje';
  else if (pending) text='Guardado en el iPhone · pendiente de sincronizar';
  else if (ok && localStorage.getItem('lastSync')) { text='Sincronizado';color='var(--green)'; }
  el.textContent=text;el.style.color=color;
  if (problem) { document.getElementById('sync-banner-title').textContent=estado==='conflict'?'Revisa las diferencias entre dispositivos':'Tus cambios siguen guardados en este iPhone'; }
}

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=uiIcon(el.dataset.icon));
  uiPopulateFilters();
  document.querySelectorAll('.overlay').forEach(overlay=>{ const modal=overlay.querySelector('.modal'); if(modal){ modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true'); const title=modal.querySelector('h2');if(title){ title.id ||= `${overlay.id}-title`;modal.setAttribute('aria-labelledby',title.id); }else modal.setAttribute('aria-label','Detalles y acciones'); } });
  document.querySelectorAll('label:not([for])').forEach(label=>{ const input=label.parentElement.querySelector('input,select,textarea');if(input?.id)label.htmlFor=input.id; });
  // Existing div toggles remain keyboard accessible, including dynamically rendered controls.
  const accessibleControls = root => root.querySelectorAll('.tog,.chip[onclick],.drawer-item[onclick]').forEach(el=>{if(el.tagName!=='BUTTON'){el.setAttribute('role','button');el.tabIndex=0;}});
  accessibleControls(document);
  document.addEventListener('keydown',event=>{
    if((event.key==='Enter'||event.key===' ') && event.target.matches('[role=button]')){event.preventDefault();event.target.click();}
    if(event.key==='Tab'){
      const overlays=[...document.querySelectorAll('.overlay.open')];const modal=overlays.at(-1)?.querySelector('.modal');if(!modal)return;
      const controls=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
      if(!controls.length){event.preventDefault();return;}
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && (document.activeElement===first || document.activeElement===modal)){event.preventDefault();last.focus();}
      else if(!event.shiftKey && (document.activeElement===last || document.activeElement===modal)){event.preventDefault();first.focus();}
    }
  });
  document.addEventListener('click',event=>{
    const go=event.target.closest('[data-go]'); if(go){showTab(go.dataset.go);return;}
    const movement=event.target.closest('[data-movement]');if(movement){ const id=Number(movement.dataset.movement);if(movement.dataset.selectable==='true'){toggleSeleccionMasiva(id);}else openDetail(id);return;}
    const account=event.target.closest('[data-concile-account]');if(account){event.stopPropagation();uiOpenReconciliation(account.dataset.concileAccount);return;}
    const credit=event.target.closest('[data-credit-account]');if(credit){event.stopPropagation();uiOpenCredit(credit.dataset.creditAccount);return;}
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(action==='settings')abrirAjustes();if(action==='alerts')programarAlertasCorte();if(action==='reconcile')uiOpenReconciliation();if(action==='logout')cerrarSesion();
    if(event.target.closest('#expense-form .tog')){uiUpdateForm();uiCaptureDraft();}
  });
  const form=document.getElementById('expense-form');
  form.addEventListener('input',()=>uiCaptureDraft());
  form.addEventListener('change',event=>{if(event.target.id==='f-motivo')uiState.categoryManual=true;if(event.target.id==='f-cuenta')uiState.accountManual=true;uiUpdateForm();uiCaptureDraft();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')uiCaptureDraft();});
  window.addEventListener('pagehide',uiCaptureDraft);
  window.addEventListener('online',()=>uiSyncStatus(true));window.addEventListener('offline',()=>uiSyncStatus(false));
  if(window.visualViewport){let fullHeight=window.visualViewport.height;const keyboard=()=>{const focused=document.activeElement?.matches('input,textarea,select');if(!focused)fullHeight=Math.max(fullHeight,window.visualViewport.height);document.body.classList.toggle('keyboard-open',!!focused && fullHeight-window.visualViewport.height>140);};window.visualViewport.addEventListener('resize',keyboard);document.addEventListener('focusout',()=>setTimeout(keyboard,150));}
  const observer=new MutationObserver(()=>{uiReconciliationSteps();accessibleControls(document.getElementById('pantry-body'));});
  observer.observe(document.getElementById('concil-pdf-status'),{childList:true,characterData:true,subtree:true});
  uiAfterNavigation(tabActualGlobal);
});
