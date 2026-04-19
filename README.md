# 💳 Gastos Semanales

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

---

## 🚀 Instalación

### Opción A — GitHub Pages (recomendada, gratis)

#### 1. Crea un repositorio en GitHub

1. Ve a [github.com](https://github.com) e inicia sesión (o crea una cuenta gratis)
2. Clic en **+** → **New repository**
3. Configura:
   - **Repository name**: `GastosApp`
   - **Visibility**: `Public` ⚠️ (requerido para GitHub Pages gratis)
4. Clic en **Create repository**

#### 2. Sube los archivos

Desde la página del repo recién creado:
1. Clic en **uploading an existing file**
2. Arrastra o selecciona todos los archivos:
   - `index.html`
   - `app.js`
   - `manifest.json`
   - `sw.js`
   - `icon-192.png`
   - `icon-512.png`
3. Clic en **Commit changes**

#### 3. Activa GitHub Pages

1. Ve a **Settings** en tu repo
2. Menú izquierdo → **Pages**
3. **Source**: `Deploy from a branch`
4. **Branch**: `main` / `/ (root)`
5. Clic en **Save**
6. En 1-2 minutos tu app estará en:
   ```
   https://TU_USUARIO.github.io/GastosApp/
   ```

---

### Opción B — Netlify (más fácil, sin cuenta de GitHub)

1. Ve a [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arrastra la carpeta completa del proyecto
3. Obtienes una URL pública al instante

---

### Opción C — Servidor propio o local

1. Copia todos los archivos a cualquier servidor web o carpeta local
2. Abre `index.html` en el navegador
3. La sincronización con GitHub funciona desde cualquier origen

---

## 📱 Instalar como app en el celular

### iPhone — Safari
1. Abre la URL en **Safari** (no funciona con Chrome en iPhone)
2. Toca el botón compartir **(□↑)**
3. Selecciona **"Agregar a pantalla de inicio"**
4. Toca **Agregar**

### Android — Chrome
1. Abre la URL en **Chrome**
2. Toca el menú **(⋮)** → **"Agregar a pantalla de inicio"**
3. O acepta el banner de instalación que aparece automáticamente

---

## 🔑 Sincronización con GitHub

La sincronización permite usar la app en múltiples dispositivos con los mismos datos.

### Paso 1 — Crear Personal Access Token

1. En GitHub: foto de perfil → **Settings**
2. Menú izquierdo → **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
3. Clic en **Generate new token**
4. Configura:
   - **Token name**: `GastosApp`
   - **Expiration**: la duración que prefieras
   - **Repository access**: `Only select repositories` → selecciona `GastosApp`
   - **Permissions** → **Contents**: `Read and Write`
5. Clic en **Generate token**
6. **Copia el token** (empieza con `github_pat_...`) — solo se muestra una vez

### Paso 2 — Configurar en la app

1. En la app: **☰** → **GitHub Sync** → **Configurar token**
2. Pega tu token → **Guardar**
3. La app sincroniza automáticamente:
   - Si GitHub tiene datos → los descarga
   - Si GitHub está vacío → sube tus datos locales

### Paso 3 — Otros dispositivos

Repite el Paso 2 en cada dispositivo adicional. Los datos de GitHub tienen prioridad al configurar por primera vez.

### Cómo funciona el sync

| Evento | Acción |
|--------|--------|
| Abrir la app | Descarga cambios de GitHub en segundo plano |
| Guardar un gasto | Aparece `⬆️ Sin subir` en el topbar |
| Sincronizar ahora | Sube todos los cambios a GitHub |
| Auto-sync | Cada 5 minutos sube cambios pendientes |
| Sin internet | Guarda local, sube al reconectarse |

---

## ⚙️ Personalización inicial

### Cambiar propietario del repositorio
En `app.js` edita las líneas al inicio del archivo:
```javascript
const GITHUB_OWNER  = 'TU_USUARIO_GITHUB';
const GITHUB_REPO   = 'TU_REPO';
```

### Cambiar presupuesto semanal
En la app: **☰ → Ajustes → Presupuesto semanal**

### Configurar cuentas y días de corte
En la app: **☰ → Catálogos → Cuentas**

### Cuentas y cortes predeterminados

| Cuenta      | Día de corte |
|-------------|:------------:|
| Banamex     | 3            |
| Santander   | 4            |
| HSBC        | 12           |
| Amex        | 13           |
| BBVA        | 21           |
| MercadoPago | 21           |
| Banorte     | 25           |
| Débito      | Sin corte    |

---

## 📁 Archivos del proyecto

| Archivo          | Descripción                                |
|------------------|--------------------------------------------|
| `index.html`     | Estructura, estilos y modales de la app    |
| `app.js`         | Toda la lógica y funcionalidades           |
| `manifest.json`  | Configuración PWA para instalar como app   |
| `sw.js`          | Service worker (funcionalidad offline)     |
| `icon-192.png`   | Ícono 192×192 px                           |
| `icon-512.png`   | Ícono 512×512 px                           |

---

## 💾 Respaldo de datos

**Backup manual:** `☰ → Backup JSON` — descarga archivo `.json` con todos tus datos

**Restaurar:** `☰ → Restaurar backup JSON` — carga un archivo de backup

**Historial en GitHub:** cada sync guarda un commit en tu repo. Para ver versiones anteriores: repo → archivo `datos.json` → **History**

**Exportar a Excel:** `☰ → Exportar Excel` — genera `.xlsx` con todas las pestañas

---

## ⚠️ Seguridad

- El token de GitHub vive en `localStorage` de cada dispositivo — no se sube al código
- Si limpias el caché del navegador, necesitas volver a pegar el token
- El archivo `datos.json` en tu repo contiene todos tus datos — no compartas el repo con personas no autorizadas
- **Nunca** pongas el token directamente en el código fuente si el repo es público

---

## 🛠️ Tecnologías utilizadas

- HTML + CSS + JavaScript puro (sin frameworks ni dependencias)
- `localStorage` para almacenamiento local
- GitHub API para sincronización
- SheetJS para exportación a Excel
- Web App Manifest + Service Worker (PWA)

---

*Versión 2.1*