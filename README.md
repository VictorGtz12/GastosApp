# 💳 Gastos Semanales v2.4

App web para control de gastos con tarjetas de crédito, ahorros y servicios recurrentes. Funciona como PWA instalable en iPhone y Android.

---

## ✨ Funcionalidades

- Registro de gastos por cuenta, motivo y fecha
- Presupuesto semanal con barra de progreso
- Cortes por tarjeta con períodos configurables
- Cuentas de ahorro con abonos, retiros y traspasos
- Servicios recurrentes con recordatorio de pago
- Gastos externos (por cobrar / cobrados)
- Historial y resumen mensual
- Búsqueda global
- Sincronización con GitHub (multi-dispositivo)
- Modo oscuro / claro
- Exportar a Excel y backup JSON
- **Conciliación bancaria** con estado de cuenta PDF o imagen

---

## 🔄 Conciliación bancaria

Sube el PDF de tu estado de cuenta y la app compara automáticamente los cargos del banco contra tus gastos registrados.

### Bancos soportados

| Banco | Método |
|-------|--------|
| Amex | PDF (parser automático) |
| Banamex | PDF (parser automático) |
| BBVA | PDF (parser automático) |
| Banorte | PDF (parser automático) |
| Mercado Pago | PDF (parser automático) |
| HSBC | Imagen (PDF sin texto legible) |
| Santander | Imagen (PDF sin texto legible) |

### Cómo usar

1. Ve a **☰ → Conciliación**
2. Selecciona la tarjeta y el período
3. Toca **Conciliar con estado de cuenta PDF**
4. Si el PDF no tiene texto, aparece la opción de **subir imágenes** de las tablas de movimientos

### Resultados

- ✅ **Verde** — gasto conciliado (monto ±$1, fecha ±3 días)
- 🟡 **Amarillo** — posible match (mismo monto, fecha diferente) — botón para conciliar manualmente
- 🔴 **Rojo** — cargo en banco sin registrar en la app

### Configurar Worker (requerido para HSBC, Santander y conciliación con IA)

1. Ve a [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**
2. Pega el contenido de `cloudflare-worker.js`
3. Ve a **Settings → Variables** → agrega variable secreta:
   - Nombre: `ANTHROPIC_API_KEY`
   - Valor: tu API key de [console.anthropic.com](https://console.anthropic.com)
4. Copia la URL del Worker
5. En la app: **☰ → Ajustes** → pega la URL del Worker → **Guardar**

---

## 🚀 Instalación

### Opción A — GitHub Pages (recomendada, gratis)

1. Crea un repo público en GitHub llamado `GastosApp`
2. Sube todos los archivos del proyecto
3. Ve a **Settings → Pages → Deploy from branch → main**
4. Tu app estará en `https://TU_USUARIO.github.io/GastosApp/`

### Opción B — Netlify

1. Ve a [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arrastra la carpeta del proyecto → URL pública al instante

---

## 📱 Instalar como app en el celular

**iPhone (Safari):** Compartir **(□↑)** → Agregar a pantalla de inicio

**Android (Chrome):** Menú **(⋮)** → Agregar a pantalla de inicio

---

## 🔑 Sincronización con GitHub

### Crear token

1. GitHub → foto de perfil → **Settings → Developer settings → Fine-grained tokens**
2. **Generate new token** con permisos **Contents: Read and Write** en tu repo `GastosApp`
3. Copia el token (`github_pat_...`)

### Configurar

En la app: **☰ → GitHub Sync → Configurar token** → pega el token

### Comportamiento del sync

| Evento | Acción |
|--------|--------|
| Guardar un gasto | Sube automáticamente en 1.5 segundos |
| Abrir la app | Descarga cambios remotos |
| Conflicto de versión | Reintenta con SHA actualizado automáticamente |
| Sin internet | Guarda local, sube al reconectarse |

---

## ⚙️ Personalización

Edita en `app.js`:
```javascript
const GITHUB_OWNER = 'TU_USUARIO_GITHUB';
const GITHUB_REPO  = 'TU_REPO';
```

### Cuentas y cortes predeterminados

| Cuenta | Día de corte |
|--------|:------------:|
| Banamex | 3 |
| Santander | 4 |
| HSBC | 12 |
| Amex | 13 |
| BBVA | 21 |
| MercadoPago | 21 |
| Banorte | 25 |
| Débito | Sin corte |

---

## 📁 Archivos

| Archivo | Descripción |
|---------|-------------|
| `index.html` | Estructura, estilos y modales |
| `app.js` | Toda la lógica |
| `cloudflare-worker.js` | Proxy IA para conciliación con imagen |
| `manifest.json` | Configuración PWA |
| `sw.js` | Service worker (offline) |
| `icon-192.png` / `icon-512.png` | Íconos |

---

## 💾 Backup

- **Backup JSON:** `☰ → Backup JSON` — descarga con todos los datos
- **Restaurar:** `☰ → Restaurar backup JSON` — carga con confirmación
- **Excel:** `☰ → Exportar Excel` — pestañas: Gastos, Historial, Ahorros, Recurrentes, Deudas
- **GitHub:** cada sync es un commit — ve al historial de `datos.json` para versiones anteriores

---

## ⚠️ Seguridad

- Token de GitHub y URL del Worker se guardan en `localStorage` — no en el código
- La API key de Anthropic solo vive en variables secretas de Cloudflare Workers
- No compartas tu repo `GastosApp` si tiene datos sensibles

---

## 🛠️ Tecnologías

- HTML + CSS + JS puro (sin frameworks)
- GitHub API para sync
- PDF.js para extracción de texto
- SheetJS para Excel
- Cloudflare Workers + Anthropic API para conciliación con IA
- Web App Manifest + Service Worker (PWA)

---

*Versión 2.4*
