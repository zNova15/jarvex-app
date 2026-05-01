// ══════════════════════════════════════════════════════════════════════════
//  SUNAT Sender — envío SOAP de comprobantes electrónicos firmados
//  Pareja de sunat-signer.js: una vez que tenemos el XML firmado XAdES-BES,
//  hay que zipearlo, encodear base64 y enviarlo al webservice de SUNAT
//  por SOAP 1.1 (servicio "billService").
//
//  Endpoints (path "PSE directo", sin OSE intermediario):
//    Homologación (beta, gratis): https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService
//    Producción:                  https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService
//
//  Autenticación: WS-Security UsernameToken con credenciales SOL.
//  El usuario SOL para firma electrónica se forma como: <RUC><USUARIO>
//  (ej: "20000000001MODDATOS") y la password también es SOL.
//
//  CORS: SUNAT NO permite llamadas directas browser→SUNAT. Por eso el
//  cliente JS hace POST a /api/sunat-bill (función serverless en Vercel)
//  que reenvía el SOAP envelope a SUNAT.
// ══════════════════════════════════════════════════════════════════════════

const ENDPOINTS = {
  homologacion: 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService',
  produccion: 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService',
};

// ─── ZIP del XML firmado ─────────────────────────────────────────────────
// SUNAT espera el XML zipeado. Dentro del ZIP el archivo XML debe llamarse
// EXACTAMENTE igual que el ZIP (sin extensión). Convención:
//   <RUC>-<TIPO>-<SERIE>-<CORRELATIVO>.xml
//   <RUC>-<TIPO>-<SERIE>-<CORRELATIVO>.zip
export async function zipXML(xmlString, filename) {
  // jszip ya está en node_modules (lo usa xlsx). Si falla, instruir.
  let JSZip;
  try {
    const mod = await import('jszip');
    JSZip = mod.default || mod;
  } catch (e) {
    throw new Error('Falta jszip — npm install jszip');
  }
  const baseName = filename.replace(/\.zip$/i, '').replace(/\.xml$/i, '');
  const zip = new JSZip();
  zip.file(`${baseName}.xml`, xmlString);
  const blob = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  // Uint8Array → base64
  let bin = '';
  for (let i = 0; i < blob.length; i++) bin += String.fromCharCode(blob[i]);
  const base64 = btoa(bin);
  return { base64, filename: `${baseName}.zip`, sizeBytes: blob.length };
}

// ─── SOAP envelope builder ───────────────────────────────────────────────
function buildSendBillEnvelope({ ruc, sol_user, sol_password, zipFilename, zipBase64 }) {
  // El usuario de SOL para webservices se forma como RUC+usuarioSOL
  // (ej: "20100070970" + "MODDATOS" = "20100070970MODDATOS")
  const wsUser = `${ruc}${sol_user}`;
  // Escape XML básico (SOL passwords pueden tener símbolos)
  const escapeXml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ser="http://service.sunat.gob.pe"
               xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soap:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(wsUser)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(sol_password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    <ser:sendBill>
      <fileName>${escapeXml(zipFilename)}</fileName>
      <contentFile>${zipBase64}</contentFile>
    </ser:sendBill>
  </soap:Body>
</soap:Envelope>`;
}

// ─── Envío principal a SUNAT (vía proxy serverless) ──────────────────────
//
// Args:
//   zipBase64     - string base64 del .zip que contiene el XML firmado
//   zipFilename   - "20100070970-01-F001-00000001.zip"
//   ruc           - RUC emisor (11 dígitos)
//   sol_user      - usuario SOL (solo el user, sin RUC)
//   sol_password  - password SOL
//   ambiente      - 'homologacion' | 'produccion'
//
// Returns:
//   { success: true, cdrBase64, faultCode?: null, ... }    si SUNAT acepta
//   { success: false, code, message, raw? }                si SUNAT rechaza
export async function sendBillToSUNAT({ zipBase64, zipFilename, ruc, sol_user, sol_password, ambiente = 'homologacion' }) {
  if (!ENDPOINTS[ambiente]) {
    return { success: false, code: 'BAD_AMBIENTE', message: `Ambiente "${ambiente}" inválido` };
  }
  if (!/^\d{11}$/.test(String(ruc || ''))) {
    return { success: false, code: 'BAD_RUC', message: 'RUC inválido (11 dígitos numéricos)' };
  }

  const soapEnvelope = buildSendBillEnvelope({ ruc, sol_user, sol_password, zipFilename, zipBase64 });

  let proxyResp;
  try {
    proxyResp = await fetch('/api/sunat-bill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ soapEnvelope, ambiente }),
    });
  } catch (e) {
    return { success: false, code: 'NETWORK', message: 'No se pudo contactar el proxy /api/sunat-bill: ' + e.message };
  }

  let payload;
  try { payload = await proxyResp.json(); }
  catch { return { success: false, code: 'BAD_PROXY_RESP', message: 'Respuesta del proxy no es JSON', status: proxyResp.status }; }

  if (!proxyResp.ok) {
    return { success: false, code: payload?.code || 'PROXY_ERROR', message: payload?.message || `Proxy devolvió ${proxyResp.status}` };
  }

  // Parsear el SOAP response que viene de SUNAT
  const xmlText = payload.soapResponse || '';
  return parseSunatBillResponse(xmlText, payload.upstreamStatus);
}

// ─── Parser de la respuesta SOAP ─────────────────────────────────────────
// La respuesta exitosa contiene: //sendBillResponse/applicationResponse (CDR
// base64 ya zipeado). El fault contiene faultcode/faultstring.
function parseSunatBillResponse(xmlText, upstreamStatus) {
  if (!xmlText) {
    return { success: false, code: 'EMPTY', message: 'SUNAT devolvió respuesta vacía', status: upstreamStatus };
  }
  // Detectar fault primero
  const faultMatch = xmlText.match(/<faultcode>\s*([\s\S]*?)<\/faultcode>[\s\S]*?<faultstring>\s*([\s\S]*?)<\/faultstring>/i);
  if (faultMatch) {
    return {
      success: false,
      code: faultMatch[1].trim(),
      message: faultMatch[2].trim(),
      raw: xmlText,
    };
  }
  const cdrMatch = xmlText.match(/<applicationResponse>\s*([\s\S]*?)\s*<\/applicationResponse>/i);
  if (cdrMatch) {
    return {
      success: true,
      cdrBase64: cdrMatch[1].trim(),
      raw: xmlText,
    };
  }
  return { success: false, code: 'UNKNOWN', message: 'No pude parsear la respuesta SOAP', raw: xmlText, status: upstreamStatus };
}

// ─── Helper: nombre canónico de archivo ──────────────────────────────────
// Convención SUNAT: <RUC>-<TIPO>-<SERIE>-<CORRELATIVO>
//   tipo: 01 (factura) / 03 (boleta) / 07 (NC) / 08 (ND)
export function buildSunatFilename({ ruc, tipo, serie, correlativo }) {
  const corr = String(correlativo).replace(/^0+/, '') || '0';
  return `${ruc}-${tipo}-${serie}-${corr}`;
}

export const SUNAT_ENDPOINTS = ENDPOINTS;
