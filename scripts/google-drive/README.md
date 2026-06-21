# JARVEX · Google Drive

Módulo Node para guardar info en Google Drive de forma estructurada (carpeta por
obra + subcarpetas para facturas, evidencias de movimientos, reportes diarios con
sus fotos, documentos, etc.). Funciones modulares para **crear carpetas, subir,
borrar y listar**.

> ⚠️ Es **Node-only**: la clave privada del service account NUNCA debe ir al
> navegador. Estos scripts corren del lado servidor (o tu PC). Para que la app web
> suba archivos, después se expone esto como una función backend (Edge Function).

## Lo importante sobre la autenticación (leer esto)

Tu `credenciales.json` es un **service account**
(`claude-drive-jarvex-proyect@proyecto-guardar-jarvex.iam.gserviceaccount.com`).

- ✅ El service account **crea carpetas y lista** sin problema (ya probado).
- ❌ El service account **NO puede SUBIR archivos a un Drive personal**: no tiene
  cuota de almacenamiento propia. Google responde:
  *"Service Accounts do not have storage quota. Leverage shared drives, or use OAuth delegation instead."*

Hay dos formas de habilitar las **subidas**:

### Opción A — OAuth con tu cuenta (recomendado para Gmail personal)
Los archivos quedan en **tu** Drive (usan tus 15 GB) y los owna tu cuenta.

1. Google Cloud → mismo proyecto → **APIs y servicios → Credenciales →
   Crear credenciales → ID de cliente de OAuth → tipo "App de escritorio"**.
   Descargá el JSON y guardalo como `scripts/google-drive/oauth-client.json`.
   (Si la pantalla de consentimiento pide "usuarios de prueba", agregá tu Gmail.)
2. Autorizá una vez:
   ```bash
   cd scripts/google-drive
   node drive-cli.js authorize
   ```
   Abrí la URL, aceptá, pegá el código. Se guarda el `refresh_token` en
   `.drive-config.json`. Desde ahí, **todas las operaciones usan tu cuenta** y las
   subidas funcionan.

### Opción B — Unidad compartida (Shared Drive)
Sólo si tenés **Google Workspace**. Creás una Unidad compartida, la compartís con
el email del service account, y las subidas funcionan con el SA (ya pasamos
`supportsAllDrives: true`). Con un Gmail personal esto no está disponible.

## Setup de la carpeta raíz

Ya compartiste **"Datos JARVEX"** con el service account, y quedó configurada como
raíz. Si querés cambiarla:
```bash
node drive-cli.js set-root <folderId>     # el ID sale de la URL .../folders/<ID>
```
Para OAuth (Opción A), compartí esa misma carpeta también con tu cuenta (ya es
tuya si la creaste vos).

## Uso (CLI)

```bash
cd scripts/google-drive

node drive-cli.js whoami                      # estado de auth
node drive-cli.js test                        # conexión + lista la raíz
node drive-cli.js ls [folderId]               # listar
node drive-cli.js mkdir "Facturas" [parentId] # crear carpeta
node drive-cli.js upload ./factura.pdf [parentId]   # subir (requiere authorize)
node drive-cli.js rm <fileId> [--permanente]  # borrar (papelera / permanente)
node drive-cli.js init-obra "MEJORAMIENTO, AMPLIACION ..."   # estructura de la obra
```

`init-obra` crea (idempotente):
```
<Obra>/
  Facturas/
  Evidencias de Movimientos de Insumos/
  Reportes Diarios/   → Fotos/
  Fotos de Avance/
  Documentos/
```

## Uso (como módulo, desde otro script Node)

```js
import { getDrive, asegurarCarpeta, subirArchivo, borrarArchivo, listar } from './drive.js';
import { getDriveOAuth, hayOAuth } from './oauth.js';
import { estructuraObra, carpetaReporteDiario } from './estructura-obra.js';

const drive = hayOAuth() ? await getDriveOAuth() : await getDrive();
const { carpetas } = await estructuraObra(drive, ROOT_ID, 'MEJORAMIENTO ...');
// subir una factura:
await subirArchivo(drive, { filePath: './factura.pdf', parentId: carpetas['Facturas'] });
// fotos de un reporte diario:
const dest = await carpetaReporteDiario(drive, carpetas['Reportes Diarios'], '2026-06-21', 'Eddy');
await subirArchivo(drive, { buffer, nombre: 'avance1.jpg', mimeType: 'image/jpeg', parentId: dest });
```

## Archivos
- `drive.js` — auth service account + ops modulares (crear/buscar/subir/borrar/listar).
- `oauth.js` — auth OAuth de usuario (para que las subidas funcionen en Drive personal).
- `estructura-obra.js` — estructura de carpetas por obra + carpeta del reporte diario.
- `config.js` — guarda `rootFolderId` y el `refresh_token` en `.drive-config.json`.
- `drive-cli.js` — CLI.

## Seguridad
`credenciales.json`, `oauth-client.json` y `.drive-config.json` están en
`.gitignore` — **nunca** se commitean. No los compartas.
