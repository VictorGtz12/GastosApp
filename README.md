# Gastos Semanales — App Web

Control de gastos semanales con tarjetas, ahorros, externos y catálogos.

---

## Archivos del proyecto

| Archivo                  | Descripción                                        |
|--------------------------|----------------------------------------------------|
| `index.html`             | App completa (estructura + estilos)                |
| `app.js`                 | Toda la lógica, datos y exportación Excel          |
| `codigo-apps-script.gs`  | Backend para Google Sheets (base de datos)         |
| `manifest.json`          | Para instalar como app en iPhone/Android           |
| `sw.js`                  | Service worker (funciona sin internet)             |

---

## Configuración inicial (Google Sheets)

### Paso 1 — Crear el Google Sheet
Ve a sheets.google.com y crea una hoja nueva.

### Paso 2 — Pegar el Apps Script
- Extensiones → Apps Script
- Borra todo → pega el contenido de `codigo-apps-script.gs`
- Guarda con Ctrl+S

### Paso 3 — Publicar como API
- Implementar → Nueva implementación
- Tipo: Aplicación web
- Ejecutar como: Yo / Acceso: Cualquier persona
- Copia la URL generada

### Paso 4 — Conectar la app
En `app.js` línea 7, cambia:
  const SCRIPT_URL = 'PEGA_AQUI_TU_URL_DE_APPS_SCRIPT';
por tu URL real.

---

## Opciones de hospedaje

### Netlify (más fácil)
1. app.netlify.com/drop → arrastra la carpeta completa
2. Obtienes URL pública al instante

### GitHub Pages
1. Crea repo público en github.com
2. Sube todos los archivos
3. Settings → Pages → Branch: main

### iPhone — agregar al home screen
1. Abre la URL en Safari
2. Botón compartir → "Agregar a pantalla de inicio"
3. Se instala como app nativa sin App Store

---

## Funcionalidades

**Gastos**
- Registro por cuenta y motivo
- Presupuesto semanal ($3,400.09)
- Campos: Abonado, Externo, Ignorar (excluye del presupuesto)
- Descontar directamente de una cuenta de ahorro
- Corte semanal → mueve al historial

**Externos**
- Vista separada de gastos del trabajo
- Marcar como cobrado / pendiente
- Total por cobrar visible en el menú

**Cortes por Tarjeta**
- Período activo con días restantes
- Navegación ilimitada hacia atrás
- Ajustar fecha por días inhábiles (excepción por período)
- Botón para registrar nuevo período cuando vence

**Ahorros**
- Múltiples cuentas con meta
- Abonar, retirar, traspasar entre cuentas
- Saldo inicial al crear
- Historial de movimientos

**Catálogos**
- Gestión de cuentas: nombre, color, día de corte
- Gestión de motivos: agregar, editar, eliminar
- Los selectores del formulario se actualizan en tiempo real

**General**
- Botón Actualizar para sincronizar sin recargar
- Exportar Excel (Semana, Histórico, Externos, Ahorros)
- Funciona sin internet (datos locales como caché)
- Todo se guarda en Google Sheets automáticamente

---

## Pestañas de Google Sheets generadas

| Pestaña                | Contenido                        |
|------------------------|----------------------------------|
| Semana                 | Gastos de la semana actual       |
| Historico              | Gastos de semanas anteriores     |
| Ahorros_Cuentas        | Cuentas de ahorro                |
| Ahorros_Movimientos    | Movimientos de cada cuenta       |
| ExcepcionesCorte       | Fechas de corte ajustadas        |
| Catalogo_Cuentas       | Catálogo de cuentas              |
| Catalogo_Motivos       | Catálogo de motivos              |

---

## Configuración de cortes (predeterminada)

| Tarjeta     | Día de corte |
|-------------|-------------|
| Banamex     | 3           |
| Santander   | 4           |
| HSBC        | 9           |
| Amex        | 13          |
| BBVA        | 21          |
| MercadoPago | 21          |
| Banorte     | 22          |
| Débito      | Sin corte   |

Puedes modificar estos días en Catálogos → Cuentas dentro de la app.
