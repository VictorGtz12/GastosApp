# Gastos Semanales v2.4

App web para control de gastos con tarjetas de crédito, ahorros y servicios recurrentes. Funciona como PWA instalable en iPhone y Android.

---

## Funcionalidades

- Registro de gastos por cuenta, motivo y fecha
- Presupuesto semanal con barra de progreso
- Cortes por tarjeta con períodos configurables
- Cuentas de ahorro con abonos, retiros y traspasos
- Servicios recurrentes con recordatorio de pago
- Gastos externos (por cobrar / cobrados)
- Historial y resumen mensual
- Búsqueda global
- Sincronización con GitHub (multi-dispositivo)
- Modo oscuro / claro / Revolut
- Exportar a Excel y backup JSON
- Conciliación bancaria con estado de cuenta PDF o imagen

---

## Mapa de vistas (para pedir cambios a la IA)

Usa este mapa para indicar exactamente qué vista y función quieres modificar. Así la IA puede localizar el código directamente sin explorar todo el proyecto.

### Archivos principales

| Archivo | Contiene |
|---------|----------|
| `index.html` | Estructura HTML, estilos CSS (inline), todos los modales |
| `app.js` | Toda la lógica JS (~5 500 líneas) |
| `cloudflare-worker.js` | Proxy para IA (conciliación con imagen) |

### Tabs / Vistas principales

Cada vista tiene su contenedor HTML `id="content-{nombre}"` y su función `render{Nombre}()` en `app.js`.

| Tab | ID HTML | Función JS | Descripción |
|-----|---------|------------|-------------|
| Menu | `content-menu` | `renderMenu()` | Resumen semanal, presupuesto, saldos por cuenta |
| Nuevo gasto | `content-nuevo` | — | Formulario para agregar/editar un gasto |
| Mis Gastos | `content-gastos` | `renderGastos()` | Lista de gastos de la semana actual, filtros, edición masiva |
| Externos | `content-externos` | `renderExternos()` | Gastos por cobrar / ya cobrados |
| Cortes | `content-cortes` | `renderCortes()` | Vista por tarjeta con período de corte |
| Ahorros | `content-ahorros` | `renderAhorros()` | Cuentas de ahorro, saldo, movimientos |
| Historial | `content-historico` | `renderHistorico()` | Semanas pasadas agrupadas por mes |
| Catálogos | `content-catalogos` | `renderCatalogos()` | Cuentas y motivos personalizados |
| Recurrentes | `content-recurrentes` | `renderRecurrentes()` | Servicios fijos y deudas |
| Conciliación | `content-conciliacion` | `renderConciliacion()` | Comparar estado de cuenta con gastos registrados |

### Modales principales

| Modal | ID | Abre con | Descripción |
|-------|----|----------|-------------|
| Ajustes | `modal-ajustes` | `openAjustes()` | Presupuesto, tema, cuentas predeterminadas |
| Detalle gasto | `modal-detail` | click en gasto | Detalle y acciones de un gasto |
| Corte tarjeta | `modal-corte-tarjeta` | click en tarjeta | Gastos del período de corte |
| Corte semanal | `modal-corte-sem` | — | Cerrar semana actual |
| Ahorro (mov.) | `modal-ahorro` | `abrirModalAhorro()` | Abonar / retirar de cuenta de ahorro |
| Traspaso | `modal-traspaso` | `abrirTraspaso()` | Mover dinero entre cuentas de ahorro |
| Nueva cuenta ahorro | `modal-nueva-cuenta` | — | Crear cuenta de ahorro |
| Servicio recurrente | `modal-rec-servicio` | `abrirModalServicio()` | Agregar / editar servicio |
| Deuda | `modal-deuda` | `abrirModalDeuda()` | Agregar / editar deuda |
| Estadísticas | `modal-estadisticas` | `openEstadisticas()` | Gráficas por semana / cuenta / motivo |
| Alertas | `modal-alertas` | `openAlertas()` | Cortes y recurrentes próximos |
| GitHub Sync | `modal-github-token` | `openGithubToken()` | Configurar token de sincronización |
| Historial sync | `modal-historial-sync` | — | Log de sincronizaciones |
| Backup confirmación | `modal-backup-confirm` | — | Confirmar restauración de backup |
| Catálogo cuenta | `modal-cat-cuenta` | — | Editar cuenta del catálogo |
| Catálogo motivo | `modal-cat-motivo` | — | Editar motivo del catálogo |
| Regla automática | `modal-regla-auto` | — | Regla de auto-categorización |
| Historial ahorro | `modal-hist-ahorro` | — | Movimientos de una cuenta de ahorro |

### Navegación (Drawer / menú lateral)

El drawer (menú hamburguesa) da acceso a: Historial, Catálogos, Recurrentes, Conciliación, Estadísticas, Alertas, Ajustes, GitHub Sync, Backup, Exportar Excel.

---

## Cómo pedir cambios a la IA (plantilla)

Para cambios eficientes, incluye:

```
Vista: [nombre del tab o modal]
Archivo: [index.html / app.js / cloudflare-worker.js]
Función/ID: [renderXxx() / modal-xxx / content-xxx]
Cambio: [descripción concisa de qué modificar]
```

**Ejemplos:**

```
Vista: Mis Gastos
Archivo: app.js
Función: renderGastos()
Cambio: Agregar filtro por rango de monto (mínimo y máximo)
```

```
Vista: Modal Ajustes
Archivo: index.html + app.js
ID: modal-ajustes / openAjustes()
Cambio: Añadir campo para configurar el día de inicio de semana
```

```
Vista: Menu
Archivo: app.js
Función: renderMenu()
Cambio: Mostrar porcentaje del presupuesto gastado por cuenta debajo de cada saldo
```

---

## Conciliación bancaria

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

### Resultados

- Verde — gasto conciliado (monto ±$1, fecha ±3 días)
- Amarillo — posible match (mismo monto, fecha diferente) — botón para conciliar manualmente
- Rojo — cargo en banco sin registrar en la app

### Configurar Worker (requerido para HSBC, Santander y conciliación con IA)

1. Ve a dash.cloudflare.com → Workers & Pages → Create Worker
2. Pega el contenido de `cloudflare-worker.js`
3. Ve a Settings → Variables → agrega variable secreta `ANTHROPIC_API_KEY` con tu API key
4. Copia la URL del Worker
5. En la app: Ajustes → pega la URL del Worker → Guardar

---

## Instalación

### Opción A — GitHub Pages (recomendada, gratis)

1. Crea un repo público en GitHub llamado `GastosApp`
2. Sube todos los archivos del proyecto
3. Ve a Settings → Pages → Deploy from branch → main
4. Tu app estará en `https://TU_USUARIO.github.io/GastosApp/`

### Opción B — Netlify

1. Ve a app.netlify.com/drop
2. Arrastra la carpeta del proyecto → URL pública al instante

---

## Instalar como app en el celular

**iPhone (Safari):** Compartir → Agregar a pantalla de inicio

**Android (Chrome):** Menú → Agregar a pantalla de inicio

---

## Sincronización con GitHub

### Crear token

1. GitHub → Settings → Developer settings → Fine-grained tokens
2. Generate new token con permisos Contents: Read and Write en tu repo `GastosApp`
3. Copia el token (`github_pat_...`)

### Configurar

En la app: Drawer → GitHub Sync → Configurar token → pega el token

### Comportamiento del sync

| Evento | Acción |
|--------|--------|
| Guardar un gasto | Sube automáticamente en 1.5 segundos |
| Abrir la app | Descarga cambios remotos |
| Conflicto de versión | Reintenta con SHA actualizado automáticamente |
| Sin internet | Guarda local, sube al reconectarse |

---

## Personalización

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

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `index.html` | Estructura HTML, estilos CSS, modales |
| `app.js` | Toda la lógica (~5 500 líneas) |
| `cloudflare-worker.js` | Proxy IA para conciliación con imagen |
| `manifest.json` | Configuración PWA |
| `sw.js` | Service worker (offline) |
| `icon-192.png` / `icon-512.png` | Íconos |
| `datos.json` | Datos sincronizados con GitHub |
| `tasks.html` / `tasks.json` | Módulo de tareas independiente |

---

## Backup

- **Backup JSON:** Drawer → Backup JSON — descarga con todos los datos
- **Restaurar:** Drawer → Restaurar backup JSON — carga con confirmación
- **Excel:** Drawer → Exportar Excel — pestañas: Gastos, Historial, Ahorros, Recurrentes, Deudas
- **GitHub:** cada sync es un commit — ve al historial de `datos.json` para versiones anteriores

---

## Seguridad

- Token de GitHub y URL del Worker se guardan en `localStorage` — no en el código
- La API key de Anthropic solo vive en variables secretas de Cloudflare Workers
- No compartas tu repo `GastosApp` si tiene datos sensibles

---

## Tecnologías

- HTML + CSS + JS puro (sin frameworks)
- GitHub API para sync
- PDF.js para extracción de texto
- SheetJS para Excel
- Cloudflare Workers + Anthropic API para conciliación con IA
- Web App Manifest + Service Worker (PWA)

---

*Versión 2.4*
