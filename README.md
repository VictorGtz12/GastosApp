# Gastos Semanales v2.78

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
- Sincronización estructurada con FastAPI + SQLite (multi-dispositivo)
- Modo oscuro / claro / Revolut
- Exportar a Excel y backup JSON
- Conciliación bancaria con estado de cuenta PDF o imagen
- Despensa: catálogo de productos separado de lotes, entradas, salidas FEFO, transferencias, desechos, ajustes, códigos de barras y OCR de caducidad

---

## Mapa de vistas (para pedir cambios a la IA)

Usa este mapa para indicar exactamente qué vista y función quieres modificar. Así la IA puede localizar el código directamente sin explorar todo el proyecto.

### Archivos principales

| Archivo | Contiene |
|---------|----------|
| `index.html` | Estructura HTML, estilos CSS (inline), todos los modales |
| `app.js` | Estado, gastos, cuentas, sincronización y cálculos |
| `mobile-ui.js` | Navegación móvil, borradores, filtros, actividad e interacciones |
| `movement-filters.js` | Rangos locales de fechas, filtros combinados y totales de Movimientos |
| `task-sync.js` | Caché atómico de recordatorios por usuario/base y sincronización por revisión |
| `mobile.css` | Diseño para iPhone, áreas seguras y controles táctiles |
| `theme.js` | Paleta compartida por Gastos y Recordatorios |
| `despensa.js` | Módulo Despensa: productos, lotes, movimientos, escáner y OCR |
| `cloudflare-worker.js` | Proxy para IA (conciliación con imagen) |

### Tabs / Vistas principales

Cada vista tiene su contenedor HTML `id="content-{nombre}"` y su función `render{Nombre}()` en `app.js`.

| Tab | ID HTML | Función JS | Descripción |
|-----|---------|------------|-------------|
| Inicio | `content-menu` | `renderMenu()` + `uiRenderHome()` | Presupuesto, próximos cargos y últimos movimientos |
| Nuevo gasto | `content-nuevo` | — | Formulario para agregar/editar un gasto |
| Movimientos | `content-gastos` | `renderGastos()` + `uiRenderMovements()` | Gastos agrupados por fecha, período, búsqueda y filtros |
| Por cobrar | `content-externos` | `renderExternos()` | Gastos por cobrar / ya cobrados |
| Cortes | `content-cortes` | `renderCortes()` | Vista por tarjeta con período de corte |
| Ahorros | `content-ahorros` | `renderAhorros()` | Cuentas de ahorro, saldo, movimientos |
| Historial | `content-historico` | `renderHistorico()` | Semanas pasadas agrupadas por mes |
| Catálogos | `content-catalogos` | `renderCatalogos()` | Cuentas y motivos personalizados |
| Recurrentes | `content-recurrentes` | `renderRecurrentes()` | Servicios fijos y deudas |
| Conciliación | `content-conciliacion` | `renderConciliacion()` | Comparar estado de cuenta con gastos registrados |
| Despensa | `content-despensa` | `renderDespensa()` | Inventario de productos por lotes |
| Reportes | `content-dashboard` | `renderDashboard()` | Gráficas y comparaciones |
| Más | `content-mas` | `uiRenderMore()` | Herramientas, recordatorios, ajustes y sesión |

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
| Catálogo cuenta | `modal-cat-cuenta` | — | Editar cuenta del catálogo |
| Catálogo motivo | `modal-cat-motivo` | — | Editar motivo del catálogo |
| Regla automática | `modal-regla-auto` | — | Regla de auto-categorización |
| Historial ahorro | `modal-hist-ahorro` | — | Movimientos de una cuenta de ahorro |

### Navegación en iPhone

La barra inferior contiene **Inicio, Movimientos, Cuentas, Reportes y Más**. El botón **+ Gasto** abre la captura desde cualquier sección financiera. En Cuentas se alterna entre Tarjetas y Ahorros; en Movimientos se accede a Por cobrar e Historial.

La captura separa Gasto de Abono a tarjeta y deja las opciones de reembolso, ahorro y exclusión del presupuesto dentro de **Más opciones**. Los borradores se guardan por usuario y base en este dispositivo. Al guardar se vuelve a la pantalla de origen y se conservan los filtros. Los abonos nuevos se excluyen del presupuesto y reducen la deuda de la tarjeta.

El diseño respeta las áreas seguras de iOS, permite ampliar con zoom y oculta la barra inferior cuando el teclado reduce el área visible. Recordatorios comparte la paleta y los controles móviles. El cierre semanal se encuentra al final de Inicio.

### Verificación móvil

Las pruebas usan datos ficticios y bloquean las peticiones a servicios externos. Requieren Node.js y las dependencias de desarrollo; la aplicación sigue funcionando sin compilación ni dependencias de Node.

```sh
npm install
npx playwright install webkit chromium
npm run test:filters
npm run test:mobile
```

El script levanta un servidor temporal en `127.0.0.1`, prueba WebKit en tamaños de iPhone de 320 a 430 px, verifica borradores, filtros, ediciones, ahorro, abonos y guardado sin conexión, y guarda capturas en `test-results/`. La reapertura de la PWA sin conexión se comprueba en Chromium; WebKit en Windows presenta limitaciones para simular esa navegación. Las pruebas emulan el navegador; cámara, OCR y notificaciones deben revisarse en un iPhone físico.

### Revisión de flujos en v2.78

- Captura: al vaciar el formulario se elimina el borrador anterior. Editar gastos con cuentas o categorías retiradas conserva sus valores. Los abonos mantienen su operación y quedan fuera del presupuesto; sus opciones irrelevantes se ocultan. Los importes se validan hasta centavos.
- Guardado: ahorros, traspasos, catálogos, deudas, servicios, despensa y cierre semanal revierten los cambios en memoria y las marcas pendientes si falla el guardado local. Los formularios conservan sus datos para reintentar. Un error de navegación posterior a un guardado no revierte el movimiento ya persistido.
- Ahorros y catálogos: renombrar conserva referencias, reglas y borradores. Se rechazan nombres duplicados y valores negativos. Un retiro enlazado se edita desde su gasto; las ediciones de historial se resuelven por identificador estable. El saldo se calcula en centavos.
- Tarjetas y conciliación: los cortes de fin de mes respetan febrero y años bisiestos. Las excepciones guardan su fecha original y admiten cambios entre meses. Una extracción tardía se descarta si cambian base, cuenta, período o movimientos. Las marcas de conciliación se conservan en este dispositivo por usuario/base. Registrar un cargo del banco completa el formulario inmediatamente y retira una sola fila pendiente al guardar.
- Despensa: los ajustes exigen una cantidad explícita, actualizan la cantidad al elegir otro lote y permiten corregir lotes con saldo cero. Cerrar escáner u OCR libera la cámara y descarta permisos o resultados que lleguen tarde.
- Ajustes: guardar después de cerrar una semana no provoca una descarga forzada sobre el historial. Un error de almacenamiento restaura el presupuesto y libera el bloqueo de sincronización.
- Recordatorios: el caché aparece antes de renovar la sesión. La primera sincronización combina capturas locales con datos remotos; las revisiones posteriores y las eliminaciones pendientes se conservan durante las peticiones. Las respuestas de otra base no se aplican. El servidor admite paginación por `offset`.
- Repeticiones: las series antiguas siguen generando ocurrencias actuales, completar una no completa las siguientes y los días 29–31 se ajustan al último día del mes. Calendario y filtros de completadas se actualizan al marcar una ocurrencia.

Los avisos de Recordatorios usan temporizadores mientras la app está abierta. Editar, completar o eliminar cancela el aviso anterior; los plazos largos no desbordan el temporizador. La interfaz indica esta limitación: **no se garantiza entrega con la app cerrada**. La entrega en segundo plano requeriría un programador de notificaciones push en el servidor.

`tests/flows.cjs` y `tests/reminders.cjs` forman parte de `npm run test:mobile`. Usan cuentas y archivos ficticios, simulan cuotas de almacenamiento y respuestas tardías, y no acceden a servicios de producción. La revisión visual cubre WebKit de 320 a 430 px y los tres temas. Cámara, lectura real de códigos, OCR y permisos/entrega de notificaciones necesitan validación en un iPhone físico; las pruebas locales comprueban su ciclo de apertura/cierre con simulaciones.

### Filtros de Movimientos en v2.77

**Semana actual** incluye las fechas de lunes a domingo de la semana local del dispositivo. El rango aparece debajo del selector y se actualiza al volver a la app después de un cambio de día, incluso sin conexión. Se consulta tanto gastos abiertos como archivados por su fecha; el cierre manual de una semana no cambia ese rango. **Semanas anteriores** termina el domingo anterior y **Todas las fechas** elimina únicamente la restricción temporal.

Período, estado, cuenta, categoría, tipo, presupuesto y búsqueda se combinan por intersección. Solo hay tres estados: Todos los estados, Sin abonar y Abonados. Los abonos a tarjeta son operaciones distintas y se consultan con Tipo; los estados de abono se aplican a gastos. Un gasto fuera del presupuesto o por cobrar conserva su propio estado de abono. La búsqueda admite tildes, varias palabras e importes con formato monetario y siempre respeta el período.

Las cuentas y categorías se muestran sin opciones repetidas e incluyen valores que solo existen en movimientos antiguos. Cada identificador aparece una vez; si existe en gastos abiertos y en el historial, se utiliza la copia abierta, igual que al abrir su detalle. Los totales suman las compras visibles, incluidas las excluidas del presupuesto, y muestran los abonos por separado.

El aviso de pendientes anteriores usa la cuenta, categoría, tipo, presupuesto y búsqueda actuales. **Ver anteriores** cambia el período a Semanas anteriores y el estado a Sin abonar. Los pendientes antiguos nunca se agregan silenciosamente a la semana actual.

La selección masiva solo incluye gastos abiertos visibles. Cambiar filtros elimina las selecciones ocultas; cambiar de cuenta recalcula el período de corte. Los abonos no pueden convertirse en pendientes ni asignarse a débito. Si falla el guardado local, se revierte el cambio y se conserva la selección para reintentar.

`npm run test:filters` verifica 1,215 combinaciones, límites de semana, mes y año, días bisiestos, zonas horarias y duplicados. `tests/movement-ui.cjs`, incluido en `npm run test:mobile`, comprueba los filtros y la edición masiva en WebKit para iPhone. El módulo también se incluye en el caché de la PWA y en los archivos públicos permitidos por el servidor.

### Correcciones verificadas en v2.76

- La subida reconoce únicamente las operaciones y revisiones incluidas en su petición. Los cambios posteriores siguen pendientes y una descarga tardía no los sobrescribe.
- Cada base conserva su cola y marcas de sincronización al cambiar de workspace. Las respuestas de una base anterior no modifican la base actual.
- Un fallo de red al renovar sesión conserva la sesión local; una respuesta de credenciales rechazadas sí la cierra. El inicio muestra el caché aunque falle la consulta del perfil.
- Editar gastos del historial también ajusta sus retiros de ahorro. Cambiar el ahorro de origen registra una reversión y no reutiliza retiros ya revertidos. Eliminar el gasto también elimina el retiro remoto.
- Los traspasos nuevos comparten un identificador entre sus dos movimientos; la edición y eliminación encuentran la contraparte correcta. Cancelar una eliminación de ahorro conserva el comportamiento de eliminar gastos.
- Registrar servicios o cuotas ya no los marca como pagados al abrir el formulario. Solo se cuentan al guardar; editar la cuota no la cuenta de nuevo y eliminar su gasto enlazado revierte el contador.
- Si falla la escritura local del gasto, se conservan su formulario y borrador y se revierte la modificación en memoria para evitar duplicados al reintentar.
- IndexedDB usa claves válidas. Se conservan los almacenes existentes y se crean los que faltan al actualizar a la versión 2.
- Las notas de gastos se muestran como texto. El servidor protege identidad, roles, membresías y filas de otras bases, y solo publica los archivos de la aplicación.
- La comprobación del cierre semanal respeta los filtros de estado y borrado del servidor.

Las pruebas adicionales viven en `tests/regressions.cjs` y se ejecutan con `npm run test:mobile`. Las pruebas del servidor usan una base SQLite temporal:

```sh
python -m pip install -r backend/requirements-dev.txt
python -m unittest discover -s backend/tests -v
```

Para publicar esta revisión también hay que actualizar el backend y reiniciar su servicio, además de los archivos de la PWA. No se modifican los registros de la base de producción durante las pruebas.

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
2. Publica únicamente los HTML, JS, CSS, manifest e iconos de la app. No incluyas `backend/`, `backups/`, `.git/` ni bases SQLite.

### Opción B — Servidor estático

Publica la carpeta en cualquier hosting estático compatible con HTML, CSS y JS.

---

## Instalar como app en el celular

**iPhone (Safari):** Compartir → Agregar a pantalla de inicio

**Android (Chrome):** Menú → Agregar a pantalla de inicio

---

## Sincronización con SQLite / FastAPI

La app usa un backend FastAPI con SQLite como fuente central de datos. El navegador conserva una copia local para uso offline y sincroniza contra el servidor cuando hay conexión.

Servidor actual:

```text
http://45.76.0.95:8010
```

La base SQLite no se sube al repo. El archivo queda en:

```text
backend/data/gastosapp.sqlite
```

Documentación de despliegue:

```text
backend/README.md
```

### Comportamiento del Sync

| Evento | Acción |
|--------|--------|
| Guardar un gasto | Guarda local e intenta subir al servidor en segundo plano |
| Abrir la app | Muestra cache local primero y descarga cambios del servidor |
| Subida | El backend aplica cambios en transacción y deduplica por `workspace_id + id` |
| Sin internet | Guarda local, deja pendientes y sube al reconectarse |
| Conflicto | Muestra diferencia entre cache local y servidor antes de sobrescribir |

### Usuarios de la App

La sesión se maneja dentro del backend FastAPI. Cada usuario tiene su perfil en `app_users`, sus bases en `app_workspaces` y permisos en `app_workspace_members`.

- Crear usuario está en **Ajustes** y solo aparece para el admin `vedu.gutierrez@gmail.com`.
- Cada usuario puede tener su base personal separada.
- El admin puede seleccionar cualquier base desde Configuración.
- Para compartir una base, agrega membresía con rol `viewer`, `editor` o `admin`.

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

- **DB SQLite:** Ajustes → Herramientas de datos → Descargar DB SQLite — descarga la base completa desde el servidor
- **Excel:** Ajustes → Herramientas de datos → Exportar Excel — genera un reporte de consulta

---

## Seguridad

- URL del Worker se guarda en `localStorage` — no en el código
- La API key de Anthropic solo vive en variables secretas de Cloudflare Workers
- No compartas archivos `.sqlite` si tienen datos sensibles
- Cámara y escáner de Despensa requieren HTTPS en iPhone/PWA; en HTTP se debe usar captura manual

---

## Tecnologías

- HTML + CSS + JS puro (sin frameworks)
- FastAPI + SQLite para sync estructurado
- PDF.js para extracción de texto
- SheetJS para Excel
- Cloudflare Workers + Anthropic API para conciliación con IA
- ZXing / BarcodeDetector para códigos de barras cuando el navegador lo permite
- Tesseract.js para OCR local de fechas de caducidad
- Web App Manifest + Service Worker (PWA)

---

*Versión 2.78*
