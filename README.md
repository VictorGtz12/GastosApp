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
- Sincronización estructurada con Supabase (multi-dispositivo)
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
| Historial sync | `modal-historial-sync` | — | Log de sincronizaciones |
| Backup confirmación | `modal-backup-confirm` | — | Confirmar restauración de backup |
| Catálogo cuenta | `modal-cat-cuenta` | — | Editar cuenta del catálogo |
| Catálogo motivo | `modal-cat-motivo` | — | Editar motivo del catálogo |
| Regla automática | `modal-regla-auto` | — | Regla de auto-categorización |
| Historial ahorro | `modal-hist-ahorro` | — | Movimientos de una cuenta de ahorro |

### Navegación (Drawer / menú lateral)

El drawer (menú hamburguesa) queda solo para navegación y cuenta: Historial, Catálogos, Recurrentes, Conciliación, Alertas, Mis Recordatorios, Ajustes y Cerrar sesión. Las herramientas de datos viven dentro de Ajustes para no saturar el menú.

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

### Opción A — Netlify

1. Ve a app.netlify.com/drop
2. Arrastra la carpeta del proyecto → URL pública al instante

### Opción B — Servidor estático

Publica la carpeta en cualquier hosting estático compatible con HTML, CSS y JS.

---

## Instalar como app en el celular

**iPhone (Safari):** Compartir → Agregar a pantalla de inicio

**Android (Chrome):** Menú → Agregar a pantalla de inicio

---

## Sincronización con Supabase

La app usa tablas estructuradas en Supabase. No sube un JSON gigante como fuente
principal de datos.

### Comportamiento del sync

| Evento | Acción |
|--------|--------|
| Guardar un gasto | Sube automáticamente en segundo plano |
| Abrir la app | Descarga cambios remotos desde tablas |
| Conflicto de versión | Conserva el cambio local más reciente por timestamp |
| Sin internet | Guarda local, sube al reconectarse |

### Supabase estructurado

La app ya no depende de un único JSON gigante para Supabase. El archivo
`supabase-schema.sql` crea tablas `gs_*` para gastos, catálogos, ahorros,
movimientos, recurrentes, deudas y ajustes.

1. Ejecuta `supabase-schema.sql` una vez en el SQL Editor de Supabase.
2. Crea o confirma el usuario principal Victor en Authentication.
3. Confirma que `supabase-app-users-workspaces.sql` tenga el correo de Victor: `vedu.gutierrez@gmail.com`.
4. Ejecuta `supabase-app-users-workspaces.sql` para asignar los datos existentes a la base personal de Victor y activar RLS por base.
5. Entra a la app con correo y contraseña. Supabase queda siempre activo; ya no hay switch en Ajustes.

Con las tablas creadas, la app usa Supabase estructurado como sync principal.
Cada fila guarda `workspace_id`, las políticas RLS solo permiten ver/modificar
bases donde el usuario sea miembro y el respaldo local queda separado por base
en el navegador.

### Usuarios de la app

La app usa Supabase Auth solo como motor interno de sesión; no se crean keys por
usuario. Cada usuario tiene su perfil en `app_users` y una base personal en
`app_workspaces`.

- Crear usuario está en **Ajustes** y solo aparece para el admin
  `vedu.gutierrez@gmail.com`; el login solo permite entrar.
- Si Supabase Auth tiene el registro público activado, el admin puede dar de alta
  usuarios desde la app. Al entrar por primera vez, se crea su perfil interno y
  su base personal vacía.
- Si quieres controlar quién puede usar la app, desactiva el registro público en
  Supabase y crea los usuarios manualmente en **Authentication**, o agrega una
  función admin segura. Luego el usuario entra desde la app con su correo y
  contraseña.
- Para compartir la base de Victor con otro usuario, agrega una fila en
  `app_workspace_members` con rol `viewer`, `editor` o `admin`.

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
| `tasks.html` | Módulo de tareas independiente |

---

## Backup

- **Backup JSON:** Ajustes → Herramientas de datos → Backup JSON — descarga los datos de la base activa
- **Restaurar:** Ajustes → Herramientas de datos → Restaurar JSON — carga con confirmación sobre la base activa
- **Excel:** Ajustes → Herramientas de datos → Exportar Excel — exporta la base activa a Excel

---

## Seguridad

- URL del Worker se guarda en `localStorage` — no en el código
- La API key de Anthropic solo vive en variables secretas de Cloudflare Workers
- No compartas tu repo `GastosApp` si tiene datos sensibles

---

## Tecnologías

- HTML + CSS + JS puro (sin frameworks)
- Supabase REST API para sync estructurado
- PDF.js para extracción de texto
- SheetJS para Excel
- Cloudflare Workers + Anthropic API para conciliación con IA
- Web App Manifest + Service Worker (PWA)

---

*Versión 2.4*
