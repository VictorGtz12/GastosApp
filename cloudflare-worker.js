/**
 * Gastos App — Cloudflare Worker
 * Proxy para llamadas a la API de Anthropic desde el navegador.
 * 
 * SETUP:
 * 1. Ve a https://workers.cloudflare.com y crea una cuenta gratis
 * 2. Crea un nuevo Worker y pega este código
 * 3. Ve a Settings → Variables → Add variable:
 *    Name: ANTHROPIC_API_KEY
 *    Value: sk-ant-... (tu API key de Anthropic)
 *    Type: Secret
 * 4. Copia la URL del worker (ej: gastos-proxy.TU_USUARIO.workers.dev)
 * 5. En la app: ☰ → Ajustes → pega la URL del worker
 */

const ALLOWED_ORIGIN = '*'; // Cambia a tu dominio si quieres restringir
                              // ej: 'https://victorgtz12.github.io'

export default {
  async fetch(request, env) {

    // Manejar CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Solo aceptar POST
    if (request.method !== 'POST') {
      return json({ error: 'Método no permitido' }, 405);
    }

    // Verificar que tenemos el API key
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'API key no configurada en el Worker' }, 500);
    }

    try {
      const body = await request.json();
      const { pdfText, prompt: clientPrompt, gastos, cuenta, periodo, movimientosBanco } = body;

      // Si el cliente envió un prompt ya construido (con movimientos parseados), lo usamos
      // Si no, construimos el prompt aquí (compatibilidad hacia atrás)
      let prompt;
      if (clientPrompt) {
        prompt = clientPrompt;
      } else {
        if (!pdfText) return json({ error: 'Falta el texto del PDF o el prompt' }, 400);
        prompt = `Eres un asistente de conciliación bancaria experto. Analiza el siguiente texto extraído de un estado de cuenta bancario.

ESTADO DE CUENTA (texto extraído del PDF):
${pdfText.slice(0, 8000)}

MIS GASTOS REGISTRADOS para ${cuenta} del período ${periodo}:
${gastos.map(g => `- ID:${g.id} | ${g.fecha} | ${g.motivo}${g.comentarios?' - '+g.comentarios:''} | $${g.cantidad}`).join('\n')}

Compara los cargos del estado de cuenta con mis gastos registrados y devuelve SOLO un JSON válido con este formato exacto:
{
  "conciliados": [1, 2, 3],
  "no_conciliados_app": [4, 5],
  "no_conciliados_banco": [
    { "fecha": "2026-04-19", "descripcion": "OXXO COMPRA", "monto": 150.00 }
  ],
  "resumen": "Se conciliaron X de Y gastos."
}

Criterios:
- Considera conciliado si el monto coincide exactamente o diferencia menor a $1
- La fecha puede variar ±3 días (por procesamiento bancario)
- Usa la descripción del banco como pista adicional al motivo/comentario
- Los IDs en "conciliados" y "no_conciliados_app" son los IDs de MIS GASTOS
- "no_conciliados_banco" son cargos en el banco que NO encontré en mis gastos`;
      }

      // Llamar a la API de Anthropic
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', // Haiku: rápido y barato para esta tarea
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) {
        const err = await response.text();
        return json({ error: `Anthropic error: ${response.status} — ${err}` }, 502);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';

      // Extraer JSON de la respuesta
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return json({ error: 'No se pudo parsear respuesta de IA', raw: text }, 500);

      const resultado = JSON.parse(match[0]);
      
      // Si el cliente envió movimientos ya parseados, agregarlos al resultado
      if (movimientosBanco && movimientosBanco.length > 0 && !resultado.movimientos_banco?.length) {
        resultado.movimientos_banco = movimientosBanco;
      }
      
      return json(resultado);

    } catch (e) {
      return json({ error: e.message }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    }
  });
}
