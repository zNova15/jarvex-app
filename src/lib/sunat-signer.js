// ══════════════════════════════════════════════════════════════════════════
//  SUNAT XAdES-BES Signer — firma digital de XMLs UBL 2.1 en el navegador
//  Complementa src/lib/sunat-ubl.js (que genera XMLs SIN firmar). SUNAT
//  exige firma XAdES-BES dentro del placeholder
//  <ext:UBLExtensions>/<ext:UBLExtension>/<ext:ExtensionContent>.
//
//  Algoritmos:
//    - Canonicalización XML 1.0 (c14n)              (no exclusive c14n)
//    - DigestMethod: SHA-256
//    - SignatureMethod: RSA-SHA256
//
//  Estrategia primaria: usar `xadesjs` (PKI.js + WebCrypto) que implementa
//  el estándar XAdES-BES tal como SUNAT lo pide. Para parsear el .pfx
//  (PKCS#12) se usa `node-forge`, ya que xadesjs trabaja con CryptoKey/PEM
//  y no con PKCS#12 binario.
//
//  Si las libs no están instaladas o fallan en bundling Vite, las funciones
//  lanzan un Error con instrucciones claras de instalación. El código
//  React puede capturar y mostrar el mensaje al usuario.
//
//  IMPORTANTE: este archivo NO toca sunat-ubl.js. La firma se inyecta como
//  string-replace sobre el XML emitido por aquel.
// ══════════════════════════════════════════════════════════════════════════

const INSTALL_HINT =
  'Instalá las dependencias de firma:  npm install xadesjs @peculiar/x509 node-forge --legacy-peer-deps';

// Imports diferidos: si no están instaladas, las funciones tiran un Error
// controlado, en vez de romper todo el bundle al cargar el módulo.
async function loadDeps() {
  try {
    const [forge, xadesMod, x509Mod] = await Promise.all([
      import('node-forge'),
      import('xadesjs'),
      import('@peculiar/x509'),
    ]);
    return {
      forge: forge.default || forge,
      xadesjs: xadesMod.default || xadesMod,
      x509: x509Mod.default || x509Mod,
    };
  } catch (e) {
    const err = new Error(`No se pudieron cargar las libs de firma. ${INSTALL_HINT}`);
    err.cause = e;
    throw err;
  }
}

// ─── PKCS#12 (.pfx / .p12) loader ────────────────────────────────────────
// Recibe ArrayBuffer (de un <input type="file">) y la password del
// certificado. Devuelve { publicCertPem, privateKeyPem, certInfo }.
//
// node-forge maneja PKCS#12 puro JS: no requiere binarios nativos. Funciona
// bien en Vite/browser. Asegurate de tener un polyfill para Buffer si hace
// falta (Vite + plugin-inject lo resuelve).
export async function loadPfxCertificate(pfxArrayBuffer, password) {
  const { forge } = await loadDeps();

  // forge espera "binary string". Convertir ArrayBuffer → binary string.
  const bytes = new Uint8Array(pfxArrayBuffer);
  let binStr = '';
  for (let i = 0; i < bytes.byteLength; i++) binStr += String.fromCharCode(bytes[i]);

  const p12Asn1 = forge.asn1.fromDer(binStr);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  // Extraer key bag (PKCS8ShroudedKeyBag o KeyBag)
  let keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
  if (!keyBag || !keyBag.length) {
    keyBag = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];
  }
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
  if (!keyBag || !keyBag.length) throw new Error('No se encontró la llave privada en el .pfx (¿password incorrecta?)');
  if (!certBag || !certBag.length) throw new Error('No se encontró el certificado público en el .pfx');

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag[0].key);
  const cert = certBag[0].cert;
  const publicCertPem = forge.pki.certificateToPem(cert);

  const certInfo = certInfoFromForgeCert(cert);
  return { publicCertPem, privateKeyPem, certInfo };
}

function certInfoFromForgeCert(cert) {
  const subjectAttrs = (cert.subject?.attributes || []).reduce((a, x) => {
    a[x.shortName || x.name] = x.value;
    return a;
  }, {});
  const issuerAttrs = (cert.issuer?.attributes || []).reduce((a, x) => {
    a[x.shortName || x.name] = x.value;
    return a;
  }, {});
  // RUC suele venir en serialNumber del subject (formato Reniec/Camerfirma)
  // o como OID 2.5.4.5. Buscar pattern de 11 dígitos.
  const allValues = Object.values(subjectAttrs).join(' ');
  const rucMatch = allValues.match(/\b(\d{11})\b/);
  return {
    subject: subjectAttrs.CN || subjectAttrs.commonName || allValues,
    cn: subjectAttrs.CN || subjectAttrs.commonName || '',
    issuer: issuerAttrs.CN || issuerAttrs.commonName || Object.values(issuerAttrs).join(' '),
    validFrom: cert.validity?.notBefore?.toISOString?.() || null,
    validTo: cert.validity?.notAfter?.toISOString?.() || null,
    ruc: rucMatch ? rucMatch[1] : null,
    serialNumber: cert.serialNumber || null,
  };
}

// Permite re-extraer info desde un PEM (para guardarlo cifrado y leerlo después)
export async function extractCertInfo(certPem) {
  const { forge } = await loadDeps();
  const cert = forge.pki.certificateFromPem(certPem);
  return certInfoFromForgeCert(cert);
}

// ─── Firmador XAdES-BES ──────────────────────────────────────────────────
// Inyecta <ds:Signature> con XAdES-BES dentro del placeholder
// <ext:ExtensionContent> ya presente en el UBL generado.
//
// Algoritmos exigidos por SUNAT:
//   - C14N (xml-c14n11 o xml-c14n; usamos C14N 1.0 clásico)
//   - SHA-256 para digest y firma
export async function signXMLDocument(xmlString, privateKeyPem, certPem) {
  const { xadesjs, forge } = await loadDeps();

  // xadesjs requiere WebCrypto. En browser está en window.crypto. En tests
  // node se puede polyfillear con @peculiar/webcrypto, pero JARVEX corre
  // siempre en browser, así que asumimos crypto.subtle.
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('WebCrypto no disponible: la firma SUNAT requiere navegador moderno con crypto.subtle');
  }

  // Convertir privateKeyPem → CryptoKey (RSASSA-PKCS1-v1_5 / SHA-256)
  const cryptoKey = await pemToCryptoKey(privateKeyPem);

  // Limpiar el certificado: SUNAT espera el contenido base64 SIN headers
  // PEM (sin "-----BEGIN CERTIFICATE-----\n...").
  const certBase64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

  // Parsear el XML como Document
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) throw new Error('XML inválido: ' + parserError.textContent);

  // xadesjs toma un Document y produce un <ds:Signature> Element
  const xmlSignature = new xadesjs.SignedXml();
  await xmlSignature.Sign(
    { name: 'RSASSA-PKCS1-v1_5' },              // signature algo
    cryptoKey,
    xmlDoc,
    {
      keyValue: cryptoKey,
      references: [
        {
          // Referenciar el documento entero
          hash: 'SHA-256',
          transforms: ['enveloped', 'c14n'],
        },
      ],
      signingCertificate: certBase64,
      signatureAlgorithm: 'RSASSA-PKCS1-v1_5',  // → http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
      canonicalizationAlgorithm: 'c14n',         // C14N 1.0
      productionPlace: { country: 'PE' },
      // SUNAT exige Id="SignatureSP" en el ds:Signature (convención)
      id: 'SignatureSP',
    }
  );

  const signatureNode = xmlSignature.GetXml(); // Element <ds:Signature>
  const signatureXml = new XMLSerializer().serializeToString(signatureNode);

  // Inyectar dentro de <ext:ExtensionContent>...</ext:ExtensionContent>.
  // El placeholder es un comentario; lo reemplazamos por la firma.
  const placeholderRegex = /(<ext:ExtensionContent>)([\s\S]*?)(<\/ext:ExtensionContent>)/;
  if (!placeholderRegex.test(xmlString)) {
    throw new Error('El XML no tiene <ext:ExtensionContent> — ¿se generó con sunat-ubl.js?');
  }
  const signed = xmlString.replace(placeholderRegex, `$1${signatureXml}$3`);
  return signed;

  // NOTA: si xadesjs falla con "RSASSA-PKCS1-v1_5: not supported" en algún
  // navegador, alternativa: usar `signatureAlgorithm: 'RsaPkcs1'` o caer
  // a la implementación manual con WebCrypto + canonicalización propia
  // (ver _manualSignFallback abajo, comentado como TODO).
}

// PEM (PKCS#1 o PKCS#8) → CryptoKey
async function pemToCryptoKey(pem) {
  const { forge } = await loadDeps();
  // node-forge convierte PKCS#1 a PKCS#8 fácilmente
  const privateKey = forge.pki.privateKeyFromPem(pem);
  const pkcs8Asn1 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey));
  const pkcs8Der = forge.asn1.toDer(pkcs8Asn1).getBytes();
  // binary string → Uint8Array
  const buf = new Uint8Array(pkcs8Der.length);
  for (let i = 0; i < pkcs8Der.length; i++) buf[i] = pkcs8Der.charCodeAt(i) & 0xff;

  return await window.crypto.subtle.importKey(
    'pkcs8',
    buf.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
}

// ─── TODO: fallback manual sin xadesjs ───────────────────────────────────
// Si xadesjs explota en bundling Vite (sucedió en algunos proyectos por
// tipings de @peculiar/asn1-schema), esta función implementaría el flujo
// a mano: c14n del nodo → SHA-256 digest → construir <SignedInfo> → c14n
// → firmar con WebCrypto → armar <ds:Signature> a string. Está documentada
// en https://www.w3.org/TR/xmldsig-core/. Dejado para iteración futura.
//
// async function _manualSignFallback(xmlString, privateKeyPem, certPem) {
//   throw new Error('Fallback manual XAdES-BES no implementado todavía');
// }
