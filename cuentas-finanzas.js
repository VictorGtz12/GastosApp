// ════════════════════════════════════════════════════════════
//  CUENTAS, CORTES, AHORROS, RECURRENTES, DEUDAS, CATÁLOGOS
// ════════════════════════════════════════════════════════════

// ── Cortes de tarjeta ────────────────────────────────────────
function renderCortes() {
  const all = [...gastos, ...historico];
  const cfg = getCortesConfig();
  const el = document.getElementById('cortes-list');
  const cuentas = Object.keys(cfg);
  if (!cuentas.length) { el.innerHTML = '<div class="empty">Sin cuentas con fecha de corte configurada</div>'; return; }

  let html = '';
  cuentas.forEach(cuenta => {
    const diaCorte = cfg[cuenta];
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = ahora.getMonth();
    const hoy = ahora.getDate();

    let fechaCorte, fechaInicio;
    if (hoy >= diaCorte) {
      fechaCorte = new Date(anio, mes, diaCorte);
      fechaCorte.setMonth(fechaCorte.getMonth() + 1);
      fechaInicio = new Date(anio, mes, diaCorte);
    } else {
      fechaCorte = new Date(anio, mes, diaCorte);
      const mesInicio = mes - 1;
      fechaInicio = new Date(anio, mesInicio, diaCorte);
    }

    // Verificar excepciones
    const periodoKey = `${cuenta}|${fechaCorte.toISOString().slice(0,10)}`;
    const excepcion = excepciones.find(e => e.Cuenta === cuenta && e.FechaOriginal === `${cuenta}|${fechaCorte.toISOString().slice(0,10)}`);
    if (excepcion) {
      fechaCorte = new Date(excepcion.FechaExcepcion + 'T12:00:00');
    }

    const desdeStr = fechaInicio.toISOString().slice(0,10);
    const hastaStr = fechaCorte.toISOString().slice(0,10);

    const gastosPeriodo = all.filter(g =>
      g.cuenta === cuenta &&
      g.fecha >= desdeStr && g.fecha < hastaStr
    );
    const total = gastosPeriodo.reduce((s,g) => s + (g.ignorar ? 0 : g.cantidad), 0);
    const totalReal = gastosPeriodo.reduce((s,g) => s + g.cantidad, 0);

    const diasRestantes = Math.round((fechaCorte - ahora) / 86400000);
    const estaVencido = diasRestantes < 0;
    const estaProximo = diasRestantes >= 0 && diasRestantes <= 3;

    const count = gastosPeriodo.length;

    html += `<div class="tarjeta-card" onclick="openCorteTarjeta('${cuenta}')">
      <div class="tarjeta-header">
        <div class="tarjeta-nombre">
          <span class="dot" style="background:${getCuentaColor(cuenta)}"></span>
          ${cuenta}
          ${estaVencido ? '<span style="color:var(--red);font-size:10px">⚠️ Vencido</span>' : ''}
          ${estaProximo ? `<span style="color:var(--orange);font-size:10px">🔜 ${diasRestantes}d</span>` : ''}
        </div>
        <div class="tarjeta-monto">${fmt(total)}</div>
      </div>
      <div class="tarjeta-info">
        ${desdeStr} → ${hastaStr} · ${count} gasto${count!==1?'s':''}
        ${total !== totalReal ? `· Ignorados: ${fmt(totalReal-total)}` : ''}
      </div>
      ${gastosPeriodo.length ? `<div style="margin-top:8px">${gastosPeriodo.slice(0,5).map(g =>
        `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)"><span>${g.fecha} ${g.motivo}${g.comentarios?' · '+g.comentarios:''}</span><span style="font-weight:600;color:${g.ignorar?'var(--text3)':'var(--text)'}">${fmt(g.cantidad)}</span></div>`
      ).join('')}${gastosPeriodo.length>5?`<div style="font-size:10px;color:var(--text3);margin-top:4px">+${gastosPeriodo.length-5} más</div>`:''}</div>` : ''}
      <div class="action-row" style="margin-top:10px">
        <button class="btn-abonar" onclick="event.stopPropagation();openCorteTarjeta('${cuenta}')">Ver detalle</button>
      </div>
    </div>`;
  });

  // Banner cortes próximos (usado en el menú principal)
  const banner = document.getElementById('banner-cortes');
  if (banner) {
    const proximos = Object.keys(cfg).filter(c => {
      const dia = cfg[c];
      const ahora = new Date();
      const diasRest = (new Date(ahora.getFullYear(), ahora.getMonth() + (ahora.getDate() > dia ? 1 : 0), dia) - ahora) / 86400000;
      return diasRest >= 0 && diasRest <= 5;
    });
    if (proximos.length) {
      banner.style.display = 'block';
      banner.innerHTML = `<div style="font-size:10px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">⚠️ Cortes próximos</div>
        ${proximos.map(c => `<div style="font-size:12px;color:var(--text);margin-bottom:3px">${c} — ${cfg[c]} del mes</div>`).join('')}`;
    } else {
      banner.style.display = 'none';
    }
  }

  el.innerHTML = html || '<div class="empty">Sin tarjetas con corte</div>';
}

function openCorteTarjeta(cuenta) {
  const cfg = getCortesConfig();
  const diaCorte = cfg[cuenta];
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth();
  const hoy = ahora.getDate();

  let fechaCorte, fechaInicio;
  if (hoy >= diaCorte) {
    fechaCorte = new Date(anio, mes, diaCorte);
    fechaCorte.setMonth(fechaCorte.getMonth() + 1);
    fechaInicio = new Date(anio, mes, diaCorte);
  } else {
    fechaCorte = new Date(anio, mes, diaCorte);
    fechaInicio = new Date(anio, mes - 1, diaCorte);
  }

  const hastaStr = fechaCorte.toISOString().slice(0,10);
  const desdeStr = fechaInicio.toISOString().slice(0,10);

  const all = [...gastos, ...historico];
  const gastosPeriodo = all.filter(g =>
    g.cuenta === cuenta &&
    g.fecha >= desdeStr && g.fecha < hastaStr
  );
  const total = gastosPeriodo.reduce((s,g) => s + g.cantidad, 0);
  const totalReal = gastosPeriodo.reduce((s,g) => s + (g.ignorar ? 0 : g.cantidad), 0);

  const body = document.getElementById('modal-corte-body');
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span class="dot" style="background:${getCuentaColor(cuenta)};width:12px;height:12px"></span>
      <h2 style="margin:0">${cuenta}</h2>
    </div>
    <div style="margin-bottom:14px;font-size:13px;color:var(--text2)">
      ${desdeStr} → ${hastaStr}
      <span style="float:right;font-weight:700;color:${totalReal > 0 ? 'var(--red)' : 'var(--text)'}">Total: ${fmt(totalReal)}</span>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button onclick="guardarExcepcionCorte('${cuenta}')" style="flex:1;padding:9px;border-radius:10px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);font-size:12px;cursor:pointer">📅 Ajustar fecha de corte</button>
    </div>
    <div id="modal-corte-gastos">
      ${!gastosPeriodo.length ? '<div class="empty">Sin gastos en este período</div>' :
        gastosPeriodo.map(g => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:13px;font-weight:600;color:${g.ignorar?'var(--text3)':'var(--text)'}">${g.motivo}${g.comentarios?' · '+g.comentarios:''}</div>
              <div style="font-size:11px;color:var(--text3)">${g.fecha}${g.ignorar?' · Ignorado':''}</div>
            </div>
            <span style="font-size:14px;font-weight:700;color:${g.ignorar?'var(--text3)':'var(--text)'}">${fmt(g.cantidad)}</span>
          </div>
        `).join('')
      }
    </div>
    <div class="modal-actions">
      <button class="mbtn sec" onclick="closeModal('modal-corte-tarjeta')">Cerrar</button>
    </div>`;
  openModal('modal-corte-tarjeta');
}

function guardarExcepcionCorte(cuenta) {
  closeModal('modal-corte-tarjeta');
  document.getElementById('exc-cuenta').textContent = cuenta;
  document.getElementById('exc-fecha-orig').textContent = document.querySelector('.tarjeta-info')?.textContent?.split('→')?.[1]?.trim() || '';
  document.getElementById('exc-fecha-nueva').value = '';
  document.getElementById('exc-nota').value = '';
  openModal('modal-excepcion');
}

// ── Ahorros ──────────────────────────────────────────────────
function renderAhorros() {
  const el = document.getElementById('ahorros-list');
  const totalAhorro = cuentasAhorro
    .filter(c => !(c.excluirTotal === true || c.excluirTotal === 'SI' || c.excluirTotal === 'true'))
    .reduce((s, c) => s + saldoCuenta(c), 0);
  const bigEl = document.getElementById('ahorro-big');
  if (bigEl) bigEl.textContent = fmt(totalAhorro);

  // Totales por grupo
  const grupos = {};
  cuentasAhorro.forEach(c => {
    const g = c.grupo || 'General';
    if (!grupos[g]) grupos[g] = { total: 0, excluir: false };
    grupos[g].total += saldoCuenta(c);
    if (c.excluirTotal === true || c.excluirTotal === 'SI' || c.excluirTotal === 'true') grupos[g].excluir = true;
  });
  const gruposEl = document.getElementById('ahorro-grupos-totales');
  if (gruposEl) {
    gruposEl.innerHTML = Object.entries(grupos).map(([g, info]) =>
      `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);padding:2px 0">
        <span>${info.excluir ? '🚫' : ''} ${g}</span>
        <span style="font-weight:600;color:var(--purple)">${fmt(info.total)}</span>
      </div>`
    ).join('');
  }

  if (!cuentasAhorro.length) {
    el.innerHTML = '<div class="empty">Sin cuentas de ahorro aún 🐷</div>';
    return;
  }
  el.innerHTML = cuentasAhorro.map(c => {
    const saldo = saldoCuenta(c);
    const meta = c.meta || 0;
    const pct = meta > 0 ? Math.min(Math.round(saldo / meta * 100), 100) : 0;
    const excluir = c.excluirTotal === true || c.excluirTotal === 'SI' || c.excluirTotal === 'true';
    const ultimos = (c.movimientos || []).slice(-3).reverse();
    return `<div class="ahorro-card" draggable="true"
      ontouchstart="onAhorroTouchStart(event,'${c.id}')" ontouchmove="onAhorroTouchMove(event)" ontouchend="onAhorroTouchEnd(event,'${c.id}')"
      ondragstart="onAhorroDragStart(event,'${c.id}')" ondragend="onAhorroDragEnd(event)" ondragover="onAhorroDragOver(event)" ondragleave="onAhorroDragLeave(event)" ondrop="onAhorroDrop(event,'${c.id}')">
      <div class="ahorro-header" onclick="verHistorialAhorro('${c.id}')">
        <div>
          <div class="ahorro-nombre">${excluir ? '🚫 ' : ''}${c.nombre} ${c.grupo ? '<span style="font-size:10px;color:var(--text3)">· '+c.grupo+'</span>' : ''}</div>
          <div style="font-size:10px;color:var(--text3);margin-top:2px">${(c.movimientos||[]).length} movimientos</div>
        </div>
        <div class="ahorro-total">${fmt(saldo)}</div>
      </div>
      ${meta > 0 ? `
        <div class="ahorro-progress"><div class="ahorro-fill" style="width:${pct}%"></div></div>
        <div class="ahorro-meta-row">
          <span>${fmt(saldo)} / ${fmt(meta)}</span>
          <span>${pct}%</span>
        </div>` : ''}
      ${ultimos.length ? `<div style="margin-bottom:8px">${ultimos.map(m => {
        const esPos = m.tipo === 'abono' || (m.tipo === 'movimiento' && m.cantidad > 0);
        const tipoLbl = m.tipo === 'abono' ? '💰' : m.tipo === 'retiro' ? '💸' : esPos ? '+' : '-';
        return `<div class="mov-item">
          <span>${tipoLbl} ${m.nota || ''}</span>
          <span class="${esPos ? 'mov-pos' : 'mov-neg'}">${esPos ? '+' : '-'}${fmt(Math.abs(m.cantidad))}</span>
        </div>`;
      }).join('')}</div>` : ''}
      <div class="ahorro-btns" onclick="event.stopPropagation()">
        <button class="btn-abonar" onclick="openMovAhorro('${c.id}','abono')">💰 Abonar</button>
        <button class="btn-retirar" onclick="openMovAhorro('${c.id}','retiro')">💸 Retirar</button>
        <button class="btn-retirar" onclick="openTraspaso('${c.id}')" style="font-size:10px">↔️ Traspaso</button>
        <button class="btn-retirar" onclick="editarCuentaAhorro('${c.id}')" style="font-size:10px">✏️</button>
      </div>
    </div>`;
  }).join('');
}

function nuevoMov(campos) {
  return { ...campos, movId: nextMovId++ };
}

function saldoCuenta(c) {
  return (c.movimientos || []).reduce((s, m) => {
    if (m.tipo === 'abono' || (m.tipo === 'movimiento' && m.cantidad > 0)) return s + Math.abs(m.cantidad);
    return s - Math.abs(m.cantidad);
  }, c.saldoInicial || 0);
}

function verHistorialAhorro(id) {
  const c = cuentasAhorro.find(x => x.id === id);
  if (!c) return;
  document.getElementById('hist-ahorro-titulo').textContent = c.nombre;
  document.getElementById('hist-ahorro-saldo').textContent = `Saldo: ${fmt(saldoCuenta(c))}`;
  const movs = (c.movimientos || []).slice().reverse();
  document.getElementById('hist-ahorro-lista').innerHTML = movs.length
    ? movs.map(m => {
        const esPos = m.tipo === 'abono' || (m.tipo === 'movimiento' && m.cantidad > 0);
        return `<div class="mov-item">
          <span style="font-size:12px">${m.fecha || ''} ${m.nota || ''}</span>
          <span class="${esPos?'mov-pos':'mov-neg'}">${esPos?'+':'-'}${fmt(Math.abs(m.cantidad))}</span>
        </div>`;
      }).join('')
    : '<div class="empty">Sin movimientos</div>';
  openModal('modal-hist-ahorro');
}

function openMovAhorro(id, tipo) {
  movCuentaId = id; movMode = tipo;
  document.getElementById('modal-ahorro-title').textContent = tipo === 'abono' ? '💰 Abonar' : '💸 Retirar';
  document.getElementById('modal-ahorro-btn').textContent = tipo === 'abono' ? 'Abonar' : 'Retirar';
  document.getElementById('ahorro-cantidad').value = '';
  document.getElementById('ahorro-nota').value = '';
  openModal('modal-ahorro');
}

function confirmarMovAhorro() {
  const cantidad = parseFloat(document.getElementById('ahorro-cantidad').value) || 0;
  const nota = document.getElementById('ahorro-nota').value.trim();
  if (cantidad <= 0) { showToast('Ingresa una cantidad válida'); return; }
  const c = cuentasAhorro.find(x => x.id === movCuentaId);
  if (!c) return;
  if (!c.movimientos) c.movimientos = [];
  c.movimientos.push(nuevoMov({
    fecha: today(), cantidad,
    tipo: movMode,
    nota: nota || (movMode === 'abono' ? 'Abono' : 'Retiro')
  }));
  saveLocal();
  closeModal('modal-ahorro');
  const tabla = document.getElementById('tab-ahorros');
  if (tabla && tabla.classList.contains('active')) renderAhorros();
  if (document.getElementById('content-menu')?.classList.contains('active')) renderMenu();
  showToast(movMode === 'abono' ? '💰 Abonado ✓' : '💸 Retiro registrado ✓');
}

function openTraspaso(origenId) {
  traspasoOrigenId = origenId;
  const origen = cuentasAhorro.find(c => c.id === origenId);
  const destinos = cuentasAhorro.filter(c => c.id !== origenId);
  if (!destinos.length) { showToast('Necesitas al menos 2 cuentas de ahorro'); return; }
  const body = document.getElementById('modal-traspaso-body');
  body.innerHTML = `
    <h2 style="margin-bottom:12px">↔️ Traspaso desde ${origen?.nombre}</h2>
    <div class="field"><label>Cantidad <span class="req">*</span></label><input type="number" id="tras-cantidad" placeholder="0.00" step="0.01" min="0" inputmode="decimal"></div>
    <div class="field"><label>Destino <span class="req">*</span></label><select id="tras-destino">${destinos.map(d => `<option value="${d.id}">${d.nombre}</option>`).join('')}</select></div>
    <div class="field"><label>Nota (opcional)</label><input type="text" id="tras-nota" placeholder="Ej. Ahorro compartido..."></div>
    <div class="modal-actions">
      <button class="mbtn sec" onclick="closeModal('modal-traspaso')">Cancelar</button>
      <button class="mbtn purple" onclick="confirmarTraspaso()">Hacer traspaso</button>
    </div>`;
  openModal('modal-traspaso');
}

function confirmarTraspaso() {
  const cantidad = parseFloat(document.getElementById('tras-cantidad').value) || 0;
  const destinoId = document.getElementById('tras-destino').value;
  const nota = document.getElementById('tras-nota').value.trim() || 'Traspaso';
  if (cantidad <= 0 || !destinoId) { showToast('Completa todos los campos'); return; }
  const origen = cuentasAhorro.find(c => c.id === traspasoOrigenId);
  const destino = cuentasAhorro.find(c => c.id === destinoId);
  if (!origen || !destino) return;
  if (!origen.movimientos) origen.movimientos = [];
  if (!destino.movimientos) destino.movimientos = [];
  const hoy = today();
  origen.movimientos.push(nuevoMov({ fecha: hoy, cantidad, tipo: 'retiro', nota: `Traspaso → ${destino.nombre}: ${nota}` }));
  destino.movimientos.push(nuevoMov({ fecha: hoy, cantidad, tipo: 'abono', nota: `Traspaso ← ${origen.nombre}: ${nota}` }));
  saveLocal();
  closeModal('modal-traspaso');
  renderAhorros();
  showToast('Traspaso realizado ✓');
}

function openNuevaCuenta() {
  _editAhorroId = null;
  document.getElementById('nc-modal-title').textContent = 'Nueva cuenta de ahorro';
  document.getElementById('nc-nombre').value = '';
  document.getElementById('nc-saldo-inicial').value = '';
  document.getElementById('nc-meta').value = '';
  document.getElementById('nc-grupo').value = '';
  document.getElementById('nc-excluir').checked = false;
  openModal('modal-nueva-cuenta');
}

function editarCuentaAhorro(id) {
  const c = cuentasAhorro.find(x=>x.id===id);
  if (!c) return;
  _editAhorroId = id;
  document.getElementById('nc-modal-title').textContent = 'Editar cuenta de ahorro';
  document.getElementById('nc-nombre').value = c.nombre;
  document.getElementById('nc-saldo-inicial').value = c.saldoInicial || 0;
  document.getElementById('nc-meta').value = c.meta || '';
  document.getElementById('nc-grupo').value = c.grupo || '';
  document.getElementById('nc-excluir').checked = c.excluirTotal === true || c.excluirTotal === 'SI' || c.excluirTotal === 'true';
  openModal('modal-nueva-cuenta');
}

function crearCuentaAhorro() {
  const nombre = document.getElementById('nc-nombre').value.trim();
  if (!nombre) { showToast('Ingresa un nombre'); return; }
  const data = {
    id: _editAhorroId || 'ah' + Date.now(),
    nombre,
    saldoInicial: parseFloat(document.getElementById('nc-saldo-inicial').value) || 0,
    meta: parseFloat(document.getElementById('nc-meta').value) || 0,
    grupo: document.getElementById('nc-grupo').value.trim() || '',
    excluirTotal: document.getElementById('nc-excluir').checked ? 'SI' : 'NO',
    movimientos: _editAhorroId ? (cuentasAhorro.find(c=>c.id===_editAhorroId)?.movimientos || []) : [],
    createdAt: _editAhorroId ? undefined : new Date().toISOString()
  };
  if (_editAhorroId) {
    const idx = cuentasAhorro.findIndex(c => c.id === _editAhorroId);
    if (idx >= 0) { cuentasAhorro[idx] = data; }
  } else {
    cuentasAhorro.push(data);
  }
  saveLocal();
  closeModal('modal-nueva-cuenta');
  renderAhorros();
  showToast('Cuenta guardada ✓');
}

// Drag & drop para reordenar cuentas de ahorro
let touchClone = null;
let dragModeActivo = false;
let _dragAhorroId = null;

function toggleDragMode() {
  dragModeActivo = !dragModeActivo;
  document.getElementById('btn-drag-mode').textContent = dragModeActivo ? '✅ Hecho' : '↕️ Reordenar cuentas';
  renderAhorros();
}

function onAhorroDragStart(e, id) {
  if (!dragModeActivo) { e.preventDefault(); return; }
  _dragAhorroId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
}

function onAhorroDragEnd(e) {
  e.currentTarget.style.opacity = '1';
}

function onAhorroDragOver(e) {
  e.preventDefault();
  e.currentTarget.style.borderColor = 'var(--accent)';
}

function onAhorroDragLeave(e) {
  e.currentTarget.style.borderColor = '';
}

function onAhorroDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  if (_dragAhorroId && _dragAhorroId !== targetId) {
    const fromIdx = cuentasAhorro.findIndex(c => c.id === _dragAhorroId);
    const toIdx = cuentasAhorro.findIndex(c => c.id === targetId);
    if (fromIdx >= 0 && toIdx >= 0) {
      const [item] = cuentasAhorro.splice(fromIdx, 1);
      cuentasAhorro.splice(toIdx, 0, item);
      saveLocal();
      renderAhorros();
    }
  }
  _dragAhorroId = null;
}

function onAhorroTouchStart(e, id) {
  if (!dragModeActivo) return;
  const touch = e.touches[0];
  _dragAhorroId = id;
  const el = e.currentTarget;
  touchClone = el.cloneNode(true);
  touchClone.style.position = 'fixed';
  touchClone.style.width = el.offsetWidth + 'px';
  touchClone.style.opacity = '0.7';
  touchClone.style.pointerEvents = 'none';
  touchClone.style.zIndex = '999';
  touchClone.style.left = (touch.clientX - el.offsetWidth / 2) + 'px';
  touchClone.style.top = (touch.clientY - 20) + 'px';
  document.body.appendChild(touchClone);
}

function onAhorroTouchMove(e) {
  if (!touchClone) return;
  e.preventDefault();
  const touch = e.touches[0];
  touchClone.style.left = (touch.clientX - touchClone.offsetWidth / 2) + 'px';
  touchClone.style.top = (touch.clientY - 20) + 'px';
}

function onAhorroTouchEnd(e, id) {
  if (!touchClone) return;
  document.body.removeChild(touchClone);
  touchClone = null;
  if (_dragAhorroId && _dragAhorroId !== id) {
    const fromIdx = cuentasAhorro.findIndex(c => c.id === _dragAhorroId);
    const toIdx = cuentasAhorro.findIndex(c => c.id === id);
    if (fromIdx >= 0 && toIdx >= 0) {
      const [item] = cuentasAhorro.splice(fromIdx, 1);
      cuentasAhorro.splice(toIdx, 0, item);
      saveLocal();
      renderAhorros();
    }
  }
  _dragAhorroId = null;
}

// ── Recurrentes ──────────────────────────────────────────────
let recTab = 'servicios';

function renderRecurrentes() {
  const btnS = document.getElementById('rtab-servicios');
  const btnD = document.getElementById('rtab-deudas');
  btnS.style.background = recTab === 'servicios' ? 'var(--accent)' : 'transparent';
  btnS.style.color = recTab === 'servicios' ? 'white' : 'var(--text2)';
  btnD.style.background = recTab === 'deudas' ? 'var(--accent)' : 'transparent';
  btnD.style.color = recTab === 'deudas' ? 'white' : 'var(--text2)';
  document.getElementById('rec-panel-servicios').style.display = recTab === 'servicios' ? 'block' : 'none';
  document.getElementById('rec-panel-deudas').style.display = recTab === 'deudas' ? 'block' : 'none';
  if (recTab === 'servicios') renderServicios();
  else renderDeudas();
}

function setRecTab(t) { recTab = t; renderRecurrentes(); }

function verificarRecurrentesProximos() {
  const hoy = new Date();
  const proximos = recurrentes.filter(r => {
    if (!r.dia || !r.cantidad) return false;
    const diff = r.dia - hoy.getDate();
    return diff >= 0 && diff <= 5;
  });
  const banner = document.getElementById('banner-recurrentes');
  if (!banner) return;
  if (proximos.length) {
    banner.style.display = 'block';
    banner.innerHTML = `<div style="font-size:10px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">💳 Cargos próximos</div>` +
      proximos.map(r => `<div style="font-size:12px;color:var(--text);margin-bottom:3px">${r.nombre} — $${fmt(r.cantidad)} (día ${r.dia})</div>`).join('');
  } else {
    banner.style.display = 'none';
  }
}

function renderServicios() {
  const el = document.getElementById('rec-servicios-list');
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  const bannerRec = document.getElementById('banner-rec-tab');
  if (bannerRec) {
    const proximos = recurrentes.filter(r => r.dia && r.cantidad && !r.ocultar).filter(r => {
      const diff = r.dia - hoy.getDate();
      return diff >= 0 && diff <= 5;
    });
    if (proximos.length) {
      bannerRec.style.display = 'flex';
      bannerRec.innerHTML = proximos.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span>🔜 ${r.nombre} — día ${r.dia}</span><span style="font-weight:600;color:var(--orange)">${fmt(r.cantidad)}</span></div>`).join('');
    } else {
      bannerRec.style.display = 'none';
    }
  }

  if (!recurrentes.length) {
    el.innerHTML = '<div class="empty">Sin servicios recurrentes</div>';
    return;
  }
  el.innerHTML = recurrentes.map((r, i) => {
    const pagadoEsteMes = recurrenteYaPagado(r);
    return `<div class="ext-item ${pagadoEsteMes?'pagado':''}">
      <div class="ext-item-header">
        <div class="ext-nombre">
          <span class="dot" style="background:${r.cuenta?getCuentaColor(r.cuenta):'var(--accent)'}"></span>
          ${r.nombre}
          ${r.ocultar ? '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--bg3);color:var(--text3);margin-left:4px">oculto</span>' : ''}
        </div>
        <div class="ext-monto ${pagadoEsteMes?'pagado':''}">${fmt(r.cantidad)}</div>
      </div>
      <div class="ext-meta">
        ${r.cuenta} · ${r.motivo || ''} · Cobra día ${r.dia}${r.ocultar ? '' : ''}
        ${pagadoEsteMes ? '✅ Pagado este mes' : `🔴 ${r.dia - hoy.getDate() > 0 ? `Faltan ${r.dia - hoy.getDate()} días` : r.dia - hoy.getDate() === 0 ? 'Hoy' : 'Pasado'}`}
      </div>
      <div class="action-row" style="margin-top:8px">
        ${!pagadoEsteMes ? `<button class="btn-marcar-pagado" onclick="marcarPagadoManual(${i})">✅ Marcar pagado este mes</button>` :
          `<button class="btn-marcar-pend" onclick="desmarcarPagado(${i})">↩ Desmarcar</button>`}
        <button class="btn-marcar-pend" onclick="registrarRecurrente(${i})" style="font-size:10px">📝 Registrar gasto</button>
        <button class="btn-retirar" onclick="editarRecurrente(${i})" style="padding:5px 8px;font-size:10px">✏️</button>
        <button class="btn-retirar" onclick="eliminarRecurrente(${i})" style="padding:5px 8px;font-size:10px;color:var(--red)">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function recurrenteYaPagado(r) {
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`;
  return (r.pagados || []).includes(mesActual);
}

function marcarPagadoManual(i) {
  const r = recurrentes[i];
  if (!r.pagados) r.pagados = [];
  const mesActual = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  if (!r.pagados.includes(mesActual)) r.pagados.push(mesActual);
  saveLocal(); renderRecurrentes(); showToast('✅ Marcado pagado');
}

function desmarcarPagado(i) {
  const r = recurrentes[i];
  const mesActual = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  if (r.pagados) r.pagados = r.pagados.filter(m => m !== mesActual);
  saveLocal(); renderRecurrentes(); showToast('↩ Desmarcado');
}

function registrarRecurrente(i) {
  const r = recurrentes[i];
  if (!r.cantidad || !r.cuenta || !r.motivo) { showToast('Completa cuenta, motivo y cantidad'); return; }
  showTab('nuevo');
  setTimeout(() => {
    document.getElementById('f-cuenta').value = r.cuenta;
    document.getElementById('f-motivo').value = r.motivo;
    document.getElementById('f-cantidad').value = r.cantidad;
    document.getElementById('f-comentarios-input').value = r.nombre;
    document.getElementById('f-fecha').value = today();
    setAb(true);
    showToast('Datos precargados ✓');
  }, 150);
}

function abrirNuevoRecurrente() {
  window._editRecIdx = null;
  document.getElementById('rec-nombre').value = '';
  document.getElementById('rec-cantidad').value = '';
  document.getElementById('rec-dia').value = '';
  actualizarSelectCuentasRec();
  actualizarSelectMotivosRec();
  openModal('modal-rec-servicio');
}

function actualizarSelectCuentasRec() {
  const sel = document.getElementById('rec-cuenta');
  if (sel) sel.innerHTML = catalogoCuentas.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
}

function actualizarSelectMotivosRec() {
  const sel = document.getElementById('rec-motivo');
  if (sel) sel.innerHTML = catalogoMotivos.map(m => `<option value="${m}">${m}</option>`).join('');
}

function editarRecurrente(i) {
  const r = recurrentes[i];
  window._editRecIdx = i;
  document.getElementById('rec-nombre').value = r.nombre;
  document.getElementById('rec-cuenta').value = r.cuenta;
  document.getElementById('rec-motivo').value = r.motivo;
  document.getElementById('rec-cantidad').value = r.cantidad;
  document.getElementById('rec-dia').value = r.dia;
  actualizarSelectCuentasRec();
  actualizarSelectMotivosRec();
  openModal('modal-rec-servicio');
}

function guardarRecurrente() {
  const nombre   = document.getElementById('rec-nombre').value.trim();
  const cuenta   = document.getElementById('rec-cuenta').value;
  const motivo   = document.getElementById('rec-motivo').value;
  const cantidad = parseFloat(document.getElementById('rec-cantidad').value) || 0;
  const dia      = parseInt(document.getElementById('rec-dia').value);
  if (!nombre || !dia || dia < 1 || dia > 31) { showToast('Completa los campos requeridos'); return; }

  const data = { nombre, cuenta, motivo, cantidad, dia };
  if (window._editRecIdx !== null && window._editRecIdx !== undefined) {
    recurrentes[window._editRecIdx] = { ...recurrentes[window._editRecIdx], ...data };
  } else {
    recurrentes.push(data);
  }
  saveLocal();
  closeModal('modal-rec-servicio');
  renderRecurrentes();
  showToast('Servicio guardado ✓');
}

function eliminarRecurrente(i) {
  if (!confirm(`¿Eliminar "${recurrentes[i].nombre}"?`)) return;
  recurrentes.splice(i, 1);
  saveLocal(); renderRecurrentes(); showToast('Eliminado ✓');
}

// ── Deudas a meses sin intereses ─────────────────────────────
function renderDeudas() {
  const el = document.getElementById('rec-deudas-list');
  if (!deudas.length) {
    el.innerHTML = '<div class="empty">Sin compras a meses</div>';
    return;
  }
  el.innerHTML = deudas.map((d, i) => {
    const pagados = d.pagados || 0;
    const totalMeses = d.meses || 1;
    const cuota = d.cuotaMensual || 0;
    const restantes = Math.max(0, totalMeses - pagados);
    const restanteTotal = restantes * cuota;
    const pct = totalMeses > 0 ? Math.round(pagados / totalMeses * 100) : 0;
    return `<div class="ext-item ${restantes===0?'pagado':''}">
      <div class="ext-item-header">
        <div class="ext-nombre">
          <span class="dot" style="background:${d.cuenta?getCuentaColor(d.cuenta):'var(--accent)'}"></span>
          ${d.nombre}
        </div>
        <div class="ext-monto ${restantes===0?'pagado':''}">${fmt(cuota)}/mes</div>
      </div>
      <div class="ext-meta">${d.cuenta} · Mes ${pagados+1} de ${totalMeses} · Restan ${restantes} meses (${fmt(restanteTotal)})</div>
      <div style="height:5px;background:var(--bg3);border-radius:3px;margin:8px 0;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${restantes===0?'var(--green)':'var(--accent)'};border-radius:3px;transition:width .3s"></div>
      </div>
      <div class="action-row">
        ${restantes > 0 ? `<button class="btn-marcar-pagado" onclick="registrarPagoDeuda(${i})">✅ Pagar mes ${pagados+1}</button>` : '<span style="font-size:12px;color:var(--green);padding:9px 0">✅ Liquidada</span>'}
        <button class="btn-retirar" onclick="editarDeuda(${i})" style="font-size:10px">✏️</button>
        <button class="btn-retirar" onclick="eliminarDeuda(${i})" style="font-size:10px;color:var(--red)">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function registrarPagoDeuda(i) {
  const d = deudas[i];
  if (!d.pagados) d.pagados = 0;
  d.pagados = Math.min(d.pagados + 1, d.meses || 1);
  // Registrar el gasto
  if (d.cuotaMensual && d.cuenta && d.motivo) {
    const nuevoGasto = {
      id: Date.now(), fecha: today(), cuenta: d.cuenta, motivo: d.motivo || 'Meses',
      cantidad: d.cuotaMensual, comentarios: d.nombre,
      abonado: true, externo: 'no', ignorar: false
    };
    gastos.push(nuevoGasto);
  }
  saveLocal(); renderDeudas(); showToast('✅ Pago registrado');
}

function calcularCuotaDeuda() {
  const total = parseFloat(document.getElementById('deuda-total').value) || 0;
  const meses = parseInt(document.getElementById('deuda-meses').value) || 1;
  if (total > 0 && meses > 0) {
    document.getElementById('deuda-cuota').value = (total / meses).toFixed(2);
  }
}

function abrirNuevaDeuda() {
  window._editDeudaIdx = null;
  document.getElementById('deuda-nombre').value = '';
  document.getElementById('deuda-total').value = '';
  document.getElementById('deuda-meses').value = '';
  document.getElementById('deuda-cuota').value = '';
  document.getElementById('deuda-dia').value = '';
  document.getElementById('deuda-pagados').value = '0';
  const sel = document.getElementById('deuda-cuenta');
  sel.innerHTML = catalogoCuentas.filter(c => c.tieneCorte).map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
  sel.value = '';
  openModal('modal-deuda');
}

function editarDeuda(i) {
  const d = deudas[i];
  window._editDeudaIdx = i;
  document.getElementById('deuda-nombre').value = d.nombre;
  document.getElementById('deuda-total').value = d.totalCompra || 0;
  document.getElementById('deuda-meses').value = d.meses;
  document.getElementById('deuda-cuota').value = d.cuotaMensual;
  document.getElementById('deuda-dia').value = d.diaCorte;
  document.getElementById('deuda-pagados').value = d.pagados || 0;
  const sel = document.getElementById('deuda-cuenta');
  sel.innerHTML = catalogoCuentas.filter(c => c.tieneCorte).map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
  sel.value = d.cuenta || '';
  openModal('modal-deuda');
}

function guardarDeuda() {
  const nombre  = document.getElementById('deuda-nombre').value.trim();
  const cuenta  = document.getElementById('deuda-cuenta').value;
  const total   = parseFloat(document.getElementById('deuda-total').value) || 0;
  const meses   = parseInt(document.getElementById('deuda-meses').value) || 1;
  const cuota   = parseFloat(document.getElementById('deuda-cuota').value) || (total/meses);
  const dia     = parseInt(document.getElementById('deuda-dia').value);
  const pagados = parseInt(document.getElementById('deuda-pagados').value) || 0;
  if (!nombre || !cuenta || !dia) { showToast('Completa los campos requeridos'); return; }

  const data = { nombre, cuenta, totalCompra: total, meses, cuotaMensual: cuota, diaCorte: dia, pagados, motivo: document.getElementById('deuda-motivo')?.value || 'Meses' };
  if (window._editDeudaIdx !== null && window._editDeudaIdx !== undefined) {
    deudas[window._editDeudaIdx] = { ...deudas[window._editDeudaIdx], ...data };
  } else {
    deudas.push(data);
  }
  saveLocal();
  closeModal('modal-deuda');
  renderDeudas();
  showToast('Deuda guardada ✓');
}

function eliminarDeuda(i) {
  if (!confirm(`¿Eliminar deuda "${deudas[i].nombre}"?`)) return;
  deudas.splice(i, 1);
  saveLocal(); renderDeudas(); showToast('Eliminada ✓');
}

// ── Catálogos ────────────────────────────────────────────────
let catalogoTab = 'cuentas';

function renderCatalogos() {
  ['cuentas','motivos','comentarios'].forEach(t => {
    const panel = document.getElementById(`cat-panel-${t}`);
    if (panel) panel.style.display = t === catalogoTab ? 'block' : 'none';
    const btn = document.getElementById(`ctab-${t}`);
    if (btn) {
      btn.style.background = t === catalogoTab ? 'var(--accent)' : 'transparent';
      btn.style.color = t === catalogoTab ? 'white' : 'var(--text2)';
    }
  });
  if (catalogoTab === 'cuentas') renderCatCuentas();
  else if (catalogoTab === 'motivos') renderCatMotivos();
  else if (catalogoTab === 'comentarios') renderCatComentarios();
}

function setCatalogoTab(t) { catalogoTab = t; renderCatalogos(); }

// ── Catálogo de Cuentas ───────────────────────────────────────
function renderCatCuentas() {
  const el = document.getElementById('cat-cuentas-list');
  el.innerHTML = catalogoCuentas.map((c, i) =>
    `<div class="saldo-row"><div class="saldo-nombre"><span class="dot" style="background:${c.color||'#888'}"></span>${c.nombre}${c.tieneCorte?' · Corte día '+c.diaCorte:''}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="editarCuenta(${i})" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer">✏️</button>
        <button onclick="eliminarCuentaCat(${i})" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,94,122,.3);background:transparent;color:var(--red);cursor:pointer">🗑</button>
      </div></div>`
  ).join('');
}

function nuevaCuenta_cat() {
  document.getElementById('cc-nombre').value    = '';
  document.getElementById('cc-color').value     = '#0d9488';
  document.getElementById('cc-tiene-corte').checked = false;
  document.getElementById('cc-dia-wrap').style.display = 'none';
  document.getElementById('cc-dia').value       = '';
  window._editCuentaIdx = null;
  document.getElementById('cc-modal-title').textContent = 'Nueva cuenta';
  openModal('modal-cat-cuenta');
}

function editarCuenta(i) {
  const c = catalogoCuentas[i];
  window._editCuentaIdx = i;
  document.getElementById('cc-nombre').value    = c.nombre;
  document.getElementById('cc-color').value     = c.color || '#0d9488';
  document.getElementById('cc-tiene-corte').checked = !!c.tieneCorte;
  document.getElementById('cc-dia-wrap').style.display = c.tieneCorte ? 'block' : 'none';
  document.getElementById('cc-dia').value       = c.diaCorte || '';
  document.getElementById('cc-modal-title').textContent = 'Editar cuenta';
  openModal('modal-cat-cuenta');
}

function guardarCuenta_cat() {
  const nombre = document.getElementById('cc-nombre').value.trim();
  if (!nombre) { showToast('Ingresa un nombre'); return; }
  const data = {
    nombre,
    color: document.getElementById('cc-color').value,
    tieneCorte: document.getElementById('cc-tiene-corte').checked,
    diaCorte: parseInt(document.getElementById('cc-dia').value) || 0,
  };
  if (window._editCuentaIdx !== null && window._editCuentaIdx !== undefined) {
    catalogoCuentas[window._editCuentaIdx] = data;
  } else {
    catalogoCuentas.push(data);
  }
  saveLocal();
  closeModal('modal-cat-cuenta');
  renderCatalogos();
  actualizarSelectCuentas();
  showToast('Cuenta guardada ✓');
}

function eliminarCuentaCat(i) {
  if (!confirm(`¿Eliminar "${catalogoCuentas[i].nombre}"?`)) return;
  catalogoCuentas.splice(i, 1);
  saveLocal(); renderCatalogos(); actualizarSelectCuentas();
}

function actualizarSelectCuentas() {
  const sel = document.getElementById('f-cuenta');
  if (sel) sel.innerHTML = catalogoCuentas.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
}

// ── Catálogo de Motivos ───────────────────────────────────────
function renderCatMotivos() {
  const el = document.getElementById('cat-motivos-list');
  el.innerHTML = catalogoMotivos.map((m, i) =>
    `<div class="saldo-row"><span style="font-size:13px;color:var(--text)">${getMotivoIcon(m)} ${m}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="editarMotivo(${i})" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer">✏️</button>
        <button onclick="eliminarMotivo(${i})" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,94,122,.3);background:transparent;color:var(--red);cursor:pointer">🗑</button>
      </div></div>`
  ).join('');
}

function nuevoMotivo() {
  document.getElementById('cm-nombre').value = '';
  window._editMotivoIdx = null;
  document.getElementById('cm-modal-title').textContent = 'Nuevo motivo';
  openModal('modal-cat-motivo');
}

function editarMotivo(i) {
  window._editMotivoIdx = i;
  document.getElementById('cm-nombre').value = catalogoMotivos[i];
  document.getElementById('cm-modal-title').textContent = 'Editar motivo';
  openModal('modal-cat-motivo');
}

function guardarMotivo_cat() {
  const nombre = document.getElementById('cm-nombre').value.trim();
  if (!nombre) { showToast('Ingresa un nombre'); return; }
  if (window._editMotivoIdx !== null && window._editMotivoIdx !== undefined) {
    catalogoMotivos[window._editMotivoIdx] = nombre;
  } else {
    catalogoMotivos.push(nombre);
  }
  saveLocal();
  closeModal('modal-cat-motivo');
  renderCatalogos();
  actualizarSelectMotivos();
  showToast('Motivo guardado ✓');
}

function eliminarMotivo(i) {
  if (!confirm(`¿Eliminar "${catalogoMotivos[i]}"?`)) return;
  catalogoMotivos.splice(i, 1);
  saveLocal(); renderCatalogos(); actualizarSelectMotivos();
}

function actualizarSelectMotivos() {
  const sel = document.getElementById('f-motivo');
  if (sel) sel.innerHTML = catalogoMotivos.map(m => `<option value="${m}">${getMotivoIcon(m)} ${m}</option>`).join('');
}

// ── Catálogo de Comentarios y Reglas ──────────────────────────
function renderCatComentarios() {
  const el = document.getElementById('cat-comentarios-list');
  el.innerHTML = catalogoComentarios.map((c, i) =>
    `<div class="saldo-row"><span style="font-size:13px;color:var(--text)">💬 ${c}</span>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="editarComentario(${i})" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer">✏️</button>
        <button onclick="eliminarComentario(${i})" style="font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid rgba(255,94,122,.3);background:transparent;color:var(--red);cursor:pointer">🗑</button>
      </div></div>`
  ).join('');
  renderReglasAutomaticas();
}

function nuevoComentario() {
  document.getElementById('ccom-nombre').value = '';
  window._editComentarioIdx = null;
  openModal('modal-cat-comentario');
}

function guardarComentarioCat() {
  const nombre = document.getElementById('ccom-nombre').value.trim();
  if (!nombre) { showToast('Ingresa un nombre'); return; }
  if (window._editComentarioIdx !== null && window._editComentarioIdx !== undefined) {
    catalogoComentarios[window._editComentarioIdx] = nombre;
  } else {
    catalogoComentarios.push(nombre);
  }
  saveLocal();
  closeModal('modal-cat-comentario');
  renderCatComentarios();
  showToast('Lugar guardado ✓');
}

function editarComentario(i) {
  window._editComentarioIdx = i;
  document.getElementById('ccom-nombre').value = catalogoComentarios[i];
  openModal('modal-cat-comentario');
}

function eliminarComentario(i) {
  if (!confirm(`¿Eliminar "${catalogoComentarios[i]}"?`)) return;
  catalogoComentarios.splice(i, 1);
  saveLocal(); renderCatComentarios();
}

// ── Reglas Automáticas ───────────────────────────────────────
function renderReglasAutomaticas() {
  const el = document.getElementById('cat-reglas-list');
  if (!el) return;
  if (!reglasAutomaticas.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px 0">Sin reglas aún</div>';
    return;
  }
  el.innerHTML = reglasAutomaticas.map((r, i) =>
    `<div class="saldo-row">
      <span style="font-size:12px;color:var(--text)">"${r.texto}" → ${r.cuenta||'*'} · ${r.motivo||'*'}</span>
      <div style="display:flex;gap:4px">
        <button onclick="editarReglaAuto(${i})" style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer">✏️</button>
        <button onclick="eliminarReglaAuto(${i})" style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,94,122,.3);background:transparent;color:var(--red);cursor:pointer">🗑</button>
      </div></div>`
  ).join('');
}

function llenarSelectRegla(cuenta = '', motivo = '') {
  const sc = document.getElementById('regla-cuenta');
  if (sc) sc.innerHTML = '<option value="">Cualquier cuenta</option>' + catalogoCuentas.map(c => `<option value="${c.nombre}" ${c.nombre===cuenta?'selected':''}>${c.nombre}</option>`).join('');
  const sm = document.getElementById('regla-motivo');
  if (sm) sm.innerHTML = '<option value="">Cualquier motivo</option>' + catalogoMotivos.map(m => `<option value="${m}" ${m===motivo?'selected':''}>${getMotivoIcon(m)} ${m}</option>`).join('');
}

function nuevaReglaAuto() {
  window._editReglaIdx = null;
  document.getElementById('regla-texto').value = '';
  llenarSelectRegla();
  openModal('modal-regla-auto');
}

function editarReglaAuto(i) {
  const r = reglasAutomaticas[i];
  window._editReglaIdx = i;
  document.getElementById('regla-texto').value = r.texto;
  llenarSelectRegla(r.cuenta, r.motivo);
  openModal('modal-regla-auto');
}

function guardarReglaAuto() {
  const texto = document.getElementById('regla-texto').value.trim();
  if (!texto) { showToast('Ingresa el texto a buscar'); return; }
  const data = { texto, cuenta: document.getElementById('regla-cuenta').value, motivo: document.getElementById('regla-motivo').value };
  if (window._editReglaIdx !== null && window._editReglaIdx !== undefined) {
    reglasAutomaticas[window._editReglaIdx] = data;
  } else {
    reglasAutomaticas.push(data);
  }
  saveLocal();
  closeModal('modal-regla-auto');
  renderReglasAutomaticas();
  showToast('Regla guardada ✓');
}

function eliminarReglaAuto(i) {
  reglasAutomaticas.splice(i, 1);
  saveLocal(); renderReglasAutomaticas();
}
