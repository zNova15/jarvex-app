#!/usr/bin/env node
// CLI del módulo de Google Drive de JARVEX. Ver README.md.
//
// Autenticación: si autorizaste OAuth (node drive-cli.js authorize) usa TU cuenta
// (las subidas funcionan y quedan en tu Drive). Si no, usa el service account
// (sólo crea carpetas y lista — el SA no tiene cuota para subir a un Drive personal).
import readline from 'node:readline';
import { getDrive as getDriveSA, emailServiceAccount, crearCarpeta, subirArchivo, borrarArchivo, listar } from './drive.js';
import { estructuraObra } from './estructura-obra.js';
import { getRootFolderId, setRootFolderId } from './config.js';
import { hayOAuth, getDriveOAuth, urlAutorizacion, intercambiarCodigo } from './oauth.js';

const [cmd, ...args] = process.argv.slice(2);
const print = (x) => console.log(JSON.stringify(x, null, 2));

// Cliente Drive: OAuth si está autorizado (subidas OK), si no service account.
async function cliente() {
  if (hayOAuth()) return getDriveOAuth();
  return getDriveSA();
}

function preguntar(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a); }));
}

async function main() {
  switch (cmd) {
    case 'whoami':
      console.log('Service account:', emailServiceAccount());
      console.log('OAuth de usuario:', hayOAuth() ? 'autorizado ✓ (las subidas van a tu Drive)' : 'no autorizado (subidas deshabilitadas — corré "authorize")');
      break;

    case 'set-root': {
      if (!args[0]) throw new Error('Pasá el folderId. Ej: node drive-cli.js set-root 1AbC...');
      setRootFolderId(args[0]);
      console.log('rootFolderId guardado:', args[0]);
      break;
    }

    case 'auth-url':
      console.log('Abrí esta URL, aceptá y copiá el código:\n');
      console.log(urlAutorizacion());
      break;

    case 'authorize': {
      console.log('1) Abrí esta URL en tu navegador (logueado con la cuenta de Drive):\n');
      console.log('   ' + urlAutorizacion() + '\n');
      console.log('2) Aceptá los permisos y copiá el código que te da Google.');
      const code = await preguntar('3) Pegá el código acá y Enter: ');
      await intercambiarCodigo(code);
      console.log('✓ Autorizado. El refresh_token quedó en .drive-config.json. Ya podés subir archivos.');
      break;
    }

    case 'test': {
      const drive = await cliente();
      console.log('Auth:', hayOAuth() ? 'OAuth de usuario ✓' : 'service account (' + emailServiceAccount() + ')');
      const root = getRootFolderId();
      console.log('rootFolderId:', root || '(no configurado — usá set-root)');
      if (root) print(await listar(drive, root));
      break;
    }

    case 'ls': { const drive = await cliente(); print(await listar(drive, args[0] || getRootFolderId())); break; }
    case 'mkdir': { const drive = await cliente(); print(await crearCarpeta(drive, args[0], args[1] || getRootFolderId())); break; }
    case 'upload': { const drive = await cliente(); print(await subirArchivo(drive, { filePath: args[0], parentId: args[1] || getRootFolderId() })); break; }
    case 'rm': { const drive = await cliente(); print(await borrarArchivo(drive, args[0], { permanente: args.includes('--permanente') })); break; }

    case 'init-obra': {
      const drive = await cliente();
      const root = getRootFolderId();
      if (!root) throw new Error('Configurá la carpeta raíz: node drive-cli.js set-root <folderId>');
      const nombre = args.filter(a => !a.startsWith('--')).join(' ').trim();
      if (!nombre) throw new Error('Pasá el nombre de la obra. Ej: node drive-cli.js init-obra "MEJORAMIENTO ..."');
      print(await estructuraObra(drive, root, nombre));
      break;
    }

    default:
      console.log(`JARVEX · Google Drive CLI

  node drive-cli.js whoami                     Estado de autenticación (service account + OAuth).
  node drive-cli.js set-root <folderId>        Guarda el ID de la carpeta compartida raíz.
  node drive-cli.js authorize                  Autoriza tu cuenta (necesario para SUBIR archivos).
  node drive-cli.js test                       Verifica conexión y lista la carpeta raíz.
  node drive-cli.js ls [folderId]              Lista una carpeta (raíz por defecto).
  node drive-cli.js mkdir <nombre> [parentId]  Crea una carpeta.
  node drive-cli.js upload <archivo> [parent]  Sube un archivo (requiere authorize).
  node drive-cli.js rm <fileId> [--permanente] Borra (papelera, o permanente).
  node drive-cli.js init-obra "<nombre obra>"  Crea la estructura de carpetas de una obra.`);
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
