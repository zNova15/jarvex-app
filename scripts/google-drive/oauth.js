// ═══════════════════════════════════════════════════════════════════
// OAuth de usuario para Google Drive (para que las SUBIDAS funcionen en un
// Drive personal — el service account no tiene cuota propia).
//
// Setup (una vez):
//  1) En Google Cloud (mismo proyecto) → APIs y servicios → Credenciales →
//     "Crear credenciales" → "ID de cliente de OAuth" → tipo "App de escritorio".
//     Descargá el JSON y guardalo como scripts/google-drive/oauth-client.json
//  2) node drive-cli.js authorize   → abrí la URL, aceptá, pegá el código.
//     Se guarda el refresh_token en .drive-config.json. Listo: las subidas van
//     a TU Drive (las owna tu cuenta y usan tu espacio de 15GB).
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '.drive-config.json');
const SCOPES = ['https://www.googleapis.com/auth/drive'];

function rutaClienteOAuth(custom) {
  const cand = [custom, process.env.OAUTH_CLIENT_PATH, path.resolve(__dirname, 'oauth-client.json')].filter(Boolean);
  for (const c of cand) { try { if (fs.existsSync(c)) return c; } catch {} }
  throw new Error('No encontré oauth-client.json. Creá un "ID de cliente OAuth · App de escritorio" en Google Cloud y guardalo en scripts/google-drive/oauth-client.json (ver oauth.js).');
}

function leerCfg() { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; } }
function guardarCfg(cfg) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); }

export function hayOAuth() { return !!leerCfg().oauthRefreshToken; }

function clienteOAuth2(custom) {
  const raw = JSON.parse(fs.readFileSync(rutaClienteOAuth(custom), 'utf8'));
  const c = raw.installed || raw.web || raw;
  const redirect = (c.redirect_uris && c.redirect_uris[0]) || 'urn:ietf:wg:oauth:2.0:oob';
  return new google.auth.OAuth2(c.client_id, c.client_secret, redirect);
}

/** URL de consentimiento para autorizar (offline → devuelve refresh_token). */
export function urlAutorizacion(custom) {
  return clienteOAuth2(custom).generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
}

/** Intercambia el código de autorización por tokens y guarda el refresh_token. */
export async function intercambiarCodigo(code, custom) {
  const oauth2 = clienteOAuth2(custom);
  const { tokens } = await oauth2.getToken(code.trim());
  if (!tokens.refresh_token) throw new Error('No vino refresh_token. Revocá el acceso en https://myaccount.google.com/permissions y reautorizá (usamos prompt=consent).');
  const cfg = leerCfg();
  cfg.oauthRefreshToken = tokens.refresh_token;
  guardarCfg(cfg);
  return true;
}

/** Cliente Drive autenticado como el USUARIO (subidas owned por tu cuenta). */
export async function getDriveOAuth(custom) {
  const cfg = leerCfg();
  if (!cfg.oauthRefreshToken) throw new Error('No estás autorizado. Corré: node drive-cli.js authorize');
  const oauth2 = clienteOAuth2(custom);
  oauth2.setCredentials({ refresh_token: cfg.oauthRefreshToken });
  return google.drive({ version: 'v3', auth: oauth2 });
}
