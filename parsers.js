// ════════════════════════════════════════════════════════════
//  PARSERS BANCARIOS — PDF extractions for each bank
// ════════════════════════════════════════════════════════════

/**
 * Detecta el banco a partir del texto extraído del PDF.
 * Retorna: 'amex' | 'bbva' | 'banamex' | 'banorte' | 'hsbc' | 'santander' | 'mercadolibre' | null
 */
function detectarBanco(texto, cuentaExplicita) {
  const nombreCuenta = (cuentaExplicita || concilCuenta || '').toLowerCase();
  const mapaCuentas = {
    'banamex':     'banamex',
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
  const t = texto.toLowerCase();
  if (t.includes('american express') || t.includes('americanexpress.com.mx')) return 'amex';
  if (t.includes('bbva mexico') || t.includes('bbva.mx') || t.includes('grupo financiero bbva')) return 'bbva';
  if (t.includes('banamex') || t.includes('costco banamex') || t.includes('citibanamex')) return 'banamex';
  if (t.includes('banorte') || t.includes('banorte.mx') || t.includes('uniclick')) return 'banorte';
  if (t.includes('hsbc') || t.includes('hsbc.com') || t.includes('xenos d2e')) return 'hsbc';
  if (t.includes('santander') || t.includes('supernet') || t.includes('vista mensual')) return 'santander';
  if (t.includes('mercado libre') || t.includes('mercadolibre') || t.includes('mercado pago')) return 'mercadolibre';
  return null;
}

function mesEsToNum(mes) {
  const meses = { 'ene':1,'feb':2,'mar':3,'abr':4,'may':5,'jun':6,
    'jul':7,'ago':8,'sep':9,'oct':10,'nov':11,'dic':12,
    'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
    'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12 };
  return meses[(mes || '').toLowerCase().slice(0,3)];
}

function parseMonto(str) {
  return parseFloat(str.replace(/,/g, '')) || 0;
}

function inferirAnio(texto) {
  const m = texto.match(/20(2[3-9]|[3-9]\d)/);
  return m ? parseInt(m[0]) : new Date().getFullYear();
}

// ── AMERICAN EXPRESS ────────────────────────────────────────────
function parsearAmex(texto) {
  const anio = inferirAnio(texto);
  const movimientos = [];
  // Amex formato típico: "09 ENE CARGO INTERNACIONAL 1,234.56"
  const lines = texto.split('\n');
  let capturar = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes('RESUMEN DE OPERACIONES') || t.includes('DETALLE DE MOVIMIENTOS')) { capturar = true; continue; }
    if (t.includes('TOTAL DE CARGOS') || t.includes('TOTAL DE PAGOS') || t.includes('SALDO ANTERIOR')) break;
    if (!capturar) continue;
    // Buscar patrón: DIA MES DESCRIPCION MONTO
    const m = t.match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+(\d[\d,]*\.?\d*)$/);
    if (m) {
      const dia = parseInt(m[1]);
      const mes = mesEsToNum(m[2]);
      const desc = m[3].trim();
      const monto = parseMonto(m[4]);
      if (mes && dia && monto > 0) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`,
          descripcion: desc,
          monto
        });
      }
    }
  }
  return movimientos;
}

// ── BBVA ───────────────────────────────────────────────────────
function parsearBBVA(texto) {
  const movimientos = [];
  const anio = inferirAnio(texto);
  // Formato típico: "01 ENE CARGO POR 1,234.56" o "01/01 CARGO 1,234.56"
  const lines = texto.split('\n');
  let enTabla = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes('MOVIMIENTOS') || t.includes('DETALLE')) { enTabla = true; continue; }
    if (t.includes('SALDO FINAL') || t.includes('TOTAL')) { if (enTabla) break; }
    if (!enTabla) continue;
    // Formato: DD/MM o DD MES
    let m = t.match(/^(\d{1,2})\/(\d{1,2})\s+(.+?)\s+([\d,]+\.?\d*)\s*$/);
    if (m) {
      const mes = parseInt(m[2]);
      movimientos.push({
        fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
        descripcion: m[3].trim(),
        monto: parseMonto(m[4])
      });
      continue;
    }
    m = t.match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+([\d,]+\.?\d*)\s*$/);
    if (m) {
      const mes = mesEsToNum(m[2]);
      if (mes) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
          descripcion: m[3].trim(),
          monto: parseMonto(m[4])
        });
      }
    }
  }
  return movimientos;
}

// ── BANAMEX ─────────────────────────────────────────────────────
function parsearBanamex(texto) {
  const movimientos = [];
  const anio = inferirAnio(texto);
  const lines = texto.split('\n');
  let enTabla = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes('DETALLE DE MOVIMIENTOS') || t.includes('MOVIMIENTOS DEL PERIODO') || t.includes('CARGOS DEL PERIODO')) { enTabla = true; continue; }
    if (t.includes('TOTAL DE CARGOS') || t.includes('TOTAL DE PAGOS') || t.includes('SALDO ANTERIOR')) { enTabla = false; }
    if (!enTabla) continue;
    // Formato: "01 ENE DESCRIPCION 1,234.56"
    const m = t.match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+([\d,]+\.?\d*)\s*$/);
    if (m) {
      const mes = mesEsToNum(m[2]);
      if (mes) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
          descripcion: m[3].trim(),
          monto: parseMonto(m[4])
        });
      }
    }
  }
  return movimientos;
}

// ── BANORTE ─────────────────────────────────────────────────────
function parsearBanorte(texto) {
  const movimientos = [];
  const anio = inferirAnio(texto);
  const lines = texto.split('\n');
  let enTabla = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes('DETALLE DE OPERACIONES') || t.includes('MOVIMIENTOS') || t.includes('COMPRAS EN M.N.')) { enTabla = true; continue; }
    if (t.includes('SALDO FINAL') || t.includes('TOTAL')) { enTabla = false; }
    if (!enTabla) continue;
    // Formato: "01/ENE DESCRIPCION $1,234.56"
    let m = t.match(/^(\d{1,2})\/([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+\$?([\d,]+\.?\d*)\s*$/);
    if (m) {
      const mes = mesEsToNum(m[2]);
      if (mes) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
          descripcion: m[3].trim(),
          monto: parseMonto(m[4])
        });
      }
      continue;
    }
    // Formato alternativo: "01 ENE DESCRIPCION 1,234.56"
    m = t.match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+([\d,]+\.?\d*)\s*$/);
    if (m) {
      const mes = mesEsToNum(m[2]);
      if (mes) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
          descripcion: m[3].trim(),
          monto: parseMonto(m[4])
        });
      }
    }
  }
  return movimientos;
}

// ── HSBC ───────────────────────────────────────────────────────
function parsearHSBC(texto) {
  const movimientos = [];
  const anio = inferirAnio(texto);
  const lines = texto.split('\n');
  let enTabla = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes('DETALLE') || t.includes('MOVIMIENTOS') || t.includes('TRANSACCIONES')) { enTabla = true; continue; }
    if (t.includes('SALDO TOTAL') || t.includes('TOTAL A PAGAR') || t.includes('SALDO ANTERIOR')) { enTabla = false; }
    if (!enTabla) continue;
    // Formato HSBC: "01/01 DESCRIPCION 1,234.56" o "01 ENE DESCRIPCION 1,234.56"
    let m = t.match(/^(\d{1,2})\/(\d{1,2})\s+(.+?)\s+([\d,]+\.?\d*)\s*$/);
    if (m) {
      movimientos.push({
        fecha: `${anio}-${String(parseInt(m[2])).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
        descripcion: m[3].trim().replace(/[^\x20-\x7EÀ-ÿ]/g, ''),
        monto: parseMonto(m[4])
      });
      continue;
    }
    m = t.match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+([\d,]+\.?\d*)\s*$/);
    if (m) {
      const mes = mesEsToNum(m[2]);
      if (mes) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
          descripcion: m[3].trim().replace(/[^\x20-\x7EÀ-ÿ]/g, ''),
          monto: parseMonto(m[4])
        });
      }
    }
  }
  return movimientos;
}

// ── SANTANDER ─────────────────────────────────────────────────
function parsearSantander(texto) {
  const movimientos = [];
  const anio = inferirAnio(texto);
  const lines = texto.split('\n');
  let enTabla = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes('MOVIMIENTOS') || t.includes('DETALLE') || t.includes('CARGOS POR COMPRAS')) { enTabla = true; continue; }
    if (t.includes('SALDO') && (t.includes('TOTAL') || t.includes('FINAL') || t.includes('ANTERIOR'))) { enTabla = false; }
    if (!enTabla) continue;
    // Formato: "01/ENE DESCRIPCION 1,234.56-"
    let m = t.match(/^(\d{1,2})\/([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+([\d,]+\.?\d*)-?\s*$/);
    if (m) {
      const mes = mesEsToNum(m[2]);
      if (mes) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
          descripcion: m[3].trim(),
          monto: parseMonto(m[4])
        });
      }
    }
  }
  return movimientos;
}

// ── MERCADO LIBRE / MERCADO PAGO ─────────────────────────────
function parsearMercadoLibre(texto) {
  const movimientos = [];
  const anio = inferirAnio(texto);
  const lines = texto.split('\n');
  let enTabla = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.includes('DETALLE') || t.includes('MOVIMIENTOS') || t.includes('ACTIVIDAD')) { enTabla = true; continue; }
    if (t.includes('SALDO') || t.includes('TOTAL')) { enTabla = false; }
    if (!enTabla) continue;
    // Formato: "01 ENE DESCRIPCION $1,234.56"
    let m = t.match(/^(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]{3,5})\s+(.+?)\s+\$?([\d,]+\.?\d*)\s*$/);
    if (m) {
      const mes = mesEsToNum(m[2]);
      if (mes) {
        movimientos.push({
          fecha: `${anio}-${String(mes).padStart(2,'0')}-${String(parseInt(m[1])).padStart(2,'0')}`,
          descripcion: m[3].trim(),
          monto: parseMonto(m[4])
        });
      }
    }
  }
  return movimientos;
}

// ── PARSEADOR PRINCIPAL ─────────────────────────────────────────
function parsearEstadoCuentaBanco(texto, cuentaExplicita) {
  const banco = detectarBanco(texto, cuentaExplicita);
  if (!banco) return null;
  const parsers = {
    'amex': parsearAmex,
    'bbva': parsearBBVA,
    'banamex': parsearBanamex,
    'banorte': parsearBanorte,
    'hsbc': parsearHSBC,
    'santander': parsearSantander,
    'mercadolibre': parsearMercadoLibre,
  };
  const movimientos = parsers[banco] ? parsers[banco](texto) : [];
  return { banco, movimientos };
}

// ── Extraer texto de PDF (usando PDF.js si disponible) ────────
async function extraerTextoPDF(base64) {
  try {
    if (typeof pdfjsLib === 'undefined') {
      console.warn('pdfjsLib no disponible');
      return '';
    }
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    let fullText = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }
    return fullText;
  } catch(e) {
    console.warn('Error al extraer texto PDF:', e);
    return '';
  }
}
