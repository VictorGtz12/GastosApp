// ════════════════════════════════════════════════════════════
//  CONCILIACIÓN BANCARIA
// ════════════════════════════════════════════════════════════

let concilCuenta   = '';
let concilPeriodo  = '';
let conciliados    = {}; // { gastoId: true/false }

function abrirConciliacion() {
  closeDrawer();
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
  const all = [...gastos, ...historico];
  const periodos = [...new Set(
    all.filter(g => g.cuenta === cuenta && g.periodoCorte)
       .map(g => g.periodoCorte)
  )].sort((a,b) => b.localeCompare(a));

  const selP = document.getElementById('concil-periodo');
  if (!periodos.length) {
    selP.innerHTML = '<option>Sin períodos disponibles</option>';
    document.getElementById('concil-results').innerHTML =
      '<div class="empty">Sin gastos con período de corte para esta cuenta</div>';
    return;
  }
  selP.innerHTML = periodos.map(p => {
    const [, hasta] = p.split('|');
    return `<option value="${p}">${periodoDesde(p)} → ${hasta}</option>`;
  }).join('');
  concilPeriodo = selP.value;
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

function toggleConcil(gastoId) {
  const clave = `${concilCuenta}|${concilPeriodo}`;
  if (!conciliados[clave]) conciliados[clave] = {};
  conciliados[clave][gastoId] = !conciliados[clave][gastoId];
  renderConciliacion();
}

function conciliarPosible(gastoId) {
  const clave = `${concilCuenta}|${concilPeriodo}`;
  if (!conciliados[clave]) conciliados[clave] = {};
  conciliados[clave][gastoId] = true;
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

function registrarDesdeBanco(mv) {
  window._desdeConciliador = mv;
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

function subirEstadoCuenta() {
  document.getElementById('concil-pdf-input').click();
}

function mostrarSubirImagenes() {
  document.getElementById('concil-img-input').click();
}

async function procesarEstadoCuenta(event) {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.getElementById('concil-pdf-status');
  status.style.display = 'block';
  status.textContent = '📄 Leyendo PDF...';

  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = () => rej(new Error('Error al leer el archivo'));
      r.readAsDataURL(file);
    });

    status.textContent = '📄 Extrayendo texto del PDF...';
    const pdfText = await extraerTextoPDF(base64);
    if (!pdfText || pdfText.length < 50) {
      status.innerHTML = '📷 Este PDF no tiene texto extraíble. <a href="#" onclick="mostrarSubirImagenes();return false" style="color:var(--accent2);text-decoration:underline">Subir imágenes de los movimientos</a>';
      event.target.value = '';
      return;
    }

    const charRaros = (pdfText.match(/[^\x00-\xFF]/g) || []).length;
    const ratioCorrupto = charRaros / pdfText.length;
    if (ratioCorrupto > 0.15) {
      status.innerHTML = '📷 Este PDF tiene codificación no estándar (HSBC). <a href="#" onclick="mostrarSubirImagenes();return false" style="color:var(--accent2);text-decoration:underline">Subir imágenes de los movimientos</a>';
      event.target.value = '';
      return;
    }

    const clave = `${concilCuenta}|${concilPeriodo}`;
    const [, hasta] = concilPeriodo.split('|');
    const desde = periodoDesde(concilPeriodo);
    const all = [...gastos, ...historico];
    const items = gastosEnPeriodo(all, concilCuenta,
      new Date(desde + 'T00:00:00'),
      new Date(hasta + 'T23:59:59')
    );

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

    const workerUrl = localStorage.getItem('workerUrl') || '';
    if (!workerUrl) {
      mostrarTextoPDFParaConciliar(pdfText, items);
      return;
    }

    const movsBanco = parsedForPrompt?.movimientos || [];
    const tieneParseo = movsBanco.length > 0;

    if (tieneParseo) {
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

      const gastosSinConciliar = items.filter(g => !conciliados[clave][g.id]);
      window._posiblesMatches = [];
      window._noConcilBanco = noConcilBanco.filter(mv => {
        const posible = gastosSinConciliar.find(g => Math.abs(g.cantidad - mv.monto) < 1);
        if (posible) {
          window._posiblesMatches.push({ banco: mv, gasto: posible });
          return false;
        }
        return true;
      });

      const concilCount = Object.values(conciliados[clave]).filter(Boolean).length;
      status.textContent = `✅ ${concilCount} de ${items.length} gastos conciliados · ${window._noConcilBanco.length} cargos sin registrar`;
      renderConciliacion();
      if (window._noConcilBanco.length) showToast(`⚠️ ${window._noConcilBanco.length} cargo(s) del banco no encontrados en la app`);
      return;
    }

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

  event.target.value = '';
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

function mostrarTextoPDFParaConciliar(pdfText, items) {
  const status = document.getElementById('concil-pdf-status');
  const lines = pdfText.split('\n').filter(l => l.trim());
  const montoLines = lines.filter(l => /\d+\.\d{2}/.test(l));
  const resumen = `📄 PDF leído. ${lines.length} líneas, ${montoLines.length} con montos. ` +
    `Arriba el PDF para conciliar manualmente con IA (configura Worker en Ajustes).`;
  status.textContent = resumen;
}

function exportarConciliacion() {
  const clave = `${concilCuenta}|${concilPeriodo}`;
  const [, hasta] = concilPeriodo.split('|');
  const desde = periodoDesde(concilPeriodo);
  const all = [...gastos, ...historico];
  const items = gastosEnPeriodo(all, concilCuenta,
    new Date(desde + 'T00:00:00'), new Date(hasta + 'T23:59:59')
  );

  if (typeof XLSX === 'undefined') { showToast('Cargando XLSX...'); return; }

  const wb = XLSX.utils.book_new();
  const data = items.map(g => ({
    Fecha: g.fecha,
    Motivo: g.motivo,
    Comentarios: g.comentarios || '',
    Cantidad: g.cantidad,
    Conciliado: conciliados[clave]?.[g.id] ? 'Sí' : 'No',
    Ignorar: g.ignorar ? 'Sí' : 'No'
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Conciliación');
  XLSX.writeFile(wb, `conciliacion_${concilCuenta}_${desde}_${hasta}.xlsx`);
  showToast('Excel exportado ✓');
}
