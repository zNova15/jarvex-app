// ══════════════════════════════════════════════════════════════════════════
//  ConfigSUNATPage — Configuración de credenciales SUNAT y certificado
//  digital para emisión electrónica.
//
//  Flujo:
//    1. User carga su .pfx (certificado digital tributario) + password.
//    2. Validamos: parseamos cert, mostramos CN/RUC/validez/emisor.
//    3. User completa: usuario SOL, password SOL, modo (homologación/prod).
//    4. Para guardar localmente, pedimos un "master password" y ciframos
//       con PBKDF2 + AES-GCM (WebCrypto). Cert va a IndexedDB (tamaño),
//       resto a localStorage.
//    5. "Probar conexión" envía un sendBill dummy a SUNAT homologación.
//
//  Seguridad:
//    - NUNCA se persiste password SOL ni password .pfx en plaintext.
//    - El master password se pide cada sesión (no se persiste).
//    - Si el user no quiere cifrar, no se persiste nada y debe re-ingresar
//      las credenciales en cada uso.
// ══════════════════════════════════════════════════════════════════════════

import React from "react";
import { loadPfxCertificate, extractCertInfo } from "../lib/sunat-signer.js";

const { useState: uS, useEffect: uE, useMemo: uM } = React;

const Icon = (props) => window.JxIcon ? <window.JxIcon {...props}/> : null;

// ─── IndexedDB helpers (cert binario) ────────────────────────────────────
const IDB_NAME = 'jx_sunat_v1';
const IDB_STORE = 'cert_blobs';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDelete(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Cifrado simétrico PBKDF2 + AES-GCM ─────────────────────────────────
async function deriveKey(masterPassword, saltBytes) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(masterPassword), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
function randomBytes(n) {
  const b = new Uint8Array(n); crypto.getRandomValues(b); return b;
}
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64ToBuf(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encryptString(plain, masterPassword) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(masterPassword, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return { ct: bufToB64(ct), iv: bufToB64(iv), salt: bufToB64(salt) };
}
async function decryptString({ ct, iv, salt }, masterPassword) {
  const key = await deriveKey(masterPassword, b64ToBuf(salt));
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(iv) }, key, b64ToBuf(ct));
  return new TextDecoder().decode(buf);
}

// ─── localStorage shape ──────────────────────────────────────────────────
const LS_KEY = 'jx_sunat_config_v1';
function readConfig() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function writeConfig(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch {}
}

// ─── Component ───────────────────────────────────────────────────────────
function ConfigSUNATPage({ showToast }) {
  const toast = showToast || ((m) => alert(m));

  // Form state
  const [pfxFile, setPfxFile] = uS(null);
  const [pfxPassword, setPfxPassword] = uS('');
  const [certInfo, setCertInfo] = uS(null);
  const [certPem, setCertPem] = uS('');         // public cert PEM
  const [pfxBytesB64, setPfxBytesB64] = uS(''); // raw .pfx bytes en b64 (para persistir cifrado)
  const [ruc, setRuc] = uS('');
  const [solUser, setSolUser] = uS('');
  const [solPassword, setSolPassword] = uS('');
  const [ambiente, setAmbiente] = uS('homologacion');
  const [masterPassword, setMasterPassword] = uS('');
  const [persistEnc, setPersistEnc] = uS(true);

  const [loadingCert, setLoadingCert] = uS(false);
  const [savingCfg, setSavingCfg] = uS(false);
  const [testingConn, setTestingConn] = uS(false);
  const [hasStoredCfg, setHasStoredCfg] = uS(false);
  const [error, setError] = uS('');

  // Detectar si hay config cifrada guardada
  uE(() => {
    const cfg = readConfig();
    setHasStoredCfg(Boolean(cfg?.encrypted));
    if (cfg?.ambiente) setAmbiente(cfg.ambiente);
    if (cfg?.ruc) setRuc(cfg.ruc);
    if (cfg?.certInfo) setCertInfo(cfg.certInfo);
  }, []);

  // ─── Cargar .pfx ──────────────────────────────────────────────────────
  async function handlePfxLoad() {
    setError('');
    if (!pfxFile) { setError('Seleccioná un archivo .pfx'); return; }
    if (!pfxPassword) { setError('Ingresá la password del certificado'); return; }
    setLoadingCert(true);
    try {
      const buf = await pfxFile.arrayBuffer();
      const { publicCertPem, privateKeyPem, certInfo: info } = await loadPfxCertificate(buf, pfxPassword);
      setCertInfo(info);
      setCertPem(publicCertPem);
      // Convertir buffer a b64 para persistir cifrado
      setPfxBytesB64(bufToB64(buf));

      if (info.ruc && ruc && info.ruc !== ruc) {
        setError(`⚠ RUC del cert (${info.ruc}) no coincide con RUC ingresado (${ruc})`);
      } else if (info.ruc && !ruc) {
        setRuc(info.ruc);
      }

      // Limpiar privateKey de memoria asap (lo regenramos al firmar)
      // privateKeyPem queda en closure, GC lo limpia al re-render
      void privateKeyPem;

      toast('Certificado cargado: ' + (info.cn || info.subject));
    } catch (e) {
      setError(e.message || String(e));
      setCertInfo(null);
    } finally {
      setLoadingCert(false);
    }
  }

  // ─── Guardar configuración (cifrada) ──────────────────────────────────
  async function handleSave() {
    setError('');
    if (!certInfo || !certPem || !pfxBytesB64) { setError('Cargá primero el certificado'); return; }
    if (!ruc || !/^\d{11}$/.test(ruc)) { setError('RUC inválido'); return; }
    if (!solUser) { setError('Ingresá usuario SOL'); return; }
    if (!solPassword) { setError('Ingresá password SOL'); return; }
    if (persistEnc && !masterPassword) { setError('Ingresá un master password (mínimo 8 chars)'); return; }
    if (persistEnc && masterPassword.length < 8) { setError('Master password muy corto (mín 8)'); return; }

    setSavingCfg(true);
    try {
      if (persistEnc) {
        // Cifrar el bundle de secretos
        const secrets = JSON.stringify({
          pfxB64: pfxBytesB64,
          pfxPassword,
          solPassword,
        });
        const encrypted = await encryptString(secrets, masterPassword);

        // Cert binario va a IndexedDB; metadata + cifra a localStorage
        await idbPut('pfx_blob_enc', encrypted);

        writeConfig({
          ruc,
          solUser,
          ambiente,
          certInfo,
          certPem,
          encrypted: true,
          // sólo guardamos el iv+salt de re-derivación, no el ct (en idb)
          encMeta: { iv: encrypted.iv, salt: encrypted.salt },
          updatedAt: new Date().toISOString(),
        });
        toast('Configuración guardada cifrada con AES-GCM');
      } else {
        // Modo "no persistir secretos": sólo metadata pública
        writeConfig({
          ruc,
          solUser,
          ambiente,
          certInfo,
          encrypted: false,
          updatedAt: new Date().toISOString(),
        });
        await idbDelete('pfx_blob_enc');
        toast('Configuración guardada sin cifrar (re-ingresar passwords cada vez)');
      }
      setHasStoredCfg(persistEnc);
    } catch (e) {
      setError('Error al guardar: ' + (e.message || e));
    } finally {
      setSavingCfg(false);
    }
  }

  // ─── Probar conexión SUNAT ────────────────────────────────────────────
  async function handleTestConnection() {
    setError('');
    if (!ruc || !solUser || !solPassword) { setError('Completá RUC, usuario y password SOL'); return; }
    setTestingConn(true);
    try {
      // Test mínimo: enviamos un envelope vacío y miramos el faultcode.
      // SUNAT homologación devuelve 0151 (archivo inexistente) con creds OK,
      // o 0125 (usuario inválido) con creds malas. Eso nos dice si las
      // credenciales pasan WS-Security.
      const { sendBillToSUNAT } = await import('../lib/sunat-sender.js');
      const dummyBase64 = btoa('dummy'); // contenido inválido a propósito
      const result = await sendBillToSUNAT({
        zipBase64: dummyBase64,
        zipFilename: `${ruc}-01-F001-1.zip`,
        ruc, sol_user: solUser, sol_password: solPassword,
        ambiente,
      });
      // Cualquier respuesta que no sea fault de auth = credenciales OK
      if (result.success) {
        toast('Conexión OK (¡raro que aceptara dummy!)');
      } else if (/0125|0102|0103/.test(String(result.code))) {
        setError('Credenciales SOL inválidas (' + result.code + '): ' + result.message);
      } else {
        // 0151 / 0152 / archivo inválido = creds OK, archivo malo = esperado
        toast('Credenciales OK — SUNAT respondió: ' + (result.code || 'sin código'));
      }
    } catch (e) {
      setError('Error en test: ' + (e.message || e));
    } finally {
      setTestingConn(false);
    }
  }

  // ─── Borrar config guardada ───────────────────────────────────────────
  async function handleClear() {
    if (!confirm('¿Borrar configuración SUNAT guardada?')) return;
    try {
      localStorage.removeItem(LS_KEY);
      await idbDelete('pfx_blob_enc');
      setHasStoredCfg(false);
      setCertInfo(null); setCertPem(''); setPfxBytesB64('');
      toast('Configuración borrada');
    } catch (e) { setError('Error al borrar: ' + e.message); }
  }

  // ─── Render helpers ───────────────────────────────────────────────────
  const certValid = certInfo?.validTo && new Date(certInfo.validTo) > new Date();

  return (
    <div className="page" style={{ padding: 20, maxWidth: 900 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <div style={{ width:40, height:40, borderRadius:10, background:'rgba(242,183,5,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Icon name="shield" size={20} color="var(--amber)" />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>Configuración SUNAT</h2>
          <div style={{ fontSize: 13, color: 'var(--muted, #888)' }}>
            Certificado digital + credenciales SOL para emisión electrónica
          </div>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: 'rgba(220,53,69,.12)', color: '#dc3545', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {hasStoredCfg && (
        <div style={{ padding: 12, background: 'rgba(40,167,69,.10)', color: '#28a745', borderRadius: 8, marginBottom: 16 }}>
          ✓ Configuración guardada en este dispositivo (cifrada)
        </div>
      )}

      {/* ── Sección 1: Certificado .pfx ── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>1. Certificado digital (.pfx)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label>Archivo .pfx</label>
            <input type="file" accept=".pfx,.p12" onChange={(e) => setPfxFile(e.target.files?.[0] || null)} />
          </div>
          <div>
            <label>Password del certificado</label>
            <input type="password" value={pfxPassword} onChange={(e) => setPfxPassword(e.target.value)} />
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={handlePfxLoad}
          disabled={loadingCert || !pfxFile}
        >
          {loadingCert ? 'Cargando...' : 'Validar certificado'}
        </button>

        {certInfo && (
          <div style={{ marginTop: 14, padding: 12, background: 'rgba(255,255,255,.04)', borderRadius: 8, fontSize: 13 }}>
            <div><b>Sujeto (CN):</b> {certInfo.cn || certInfo.subject}</div>
            <div><b>Emisor:</b> {certInfo.issuer}</div>
            <div><b>RUC detectado:</b> {certInfo.ruc || <span style={{color:'#dc3545'}}>no encontrado</span>}</div>
            <div><b>Vigencia:</b> {certInfo.validFrom?.slice(0,10)} → {certInfo.validTo?.slice(0,10)}
              {' '}<span style={{ color: certValid ? '#28a745' : '#dc3545' }}>
                {certValid ? '(vigente)' : '(VENCIDO)'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Sección 2: Credenciales SOL + RUC ── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>2. Credenciales SUNAT Operaciones en Línea (SOL)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label>RUC emisor</label>
            <input type="text" value={ruc} onChange={(e) => setRuc(e.target.value.replace(/\D/g,'').slice(0,11))} placeholder="20100070970" />
          </div>
          <div>
            <label>Ambiente</label>
            <select value={ambiente} onChange={(e) => setAmbiente(e.target.value)}>
              <option value="homologacion">Homologación (beta — gratis, RUC 20000000001)</option>
              <option value="produccion">Producción</option>
            </select>
          </div>
          <div>
            <label>Usuario SOL (sin RUC)</label>
            <input type="text" value={solUser} onChange={(e) => setSolUser(e.target.value)} placeholder="MODDATOS" />
          </div>
          <div>
            <label>Password SOL</label>
            <input type="password" value={solPassword} onChange={(e) => setSolPassword(e.target.value)} placeholder="moddatos" />
          </div>
        </div>
      </div>

      {/* ── Sección 3: Persistencia cifrada ── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>3. Persistencia local</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input type="checkbox" checked={persistEnc} onChange={(e) => setPersistEnc(e.target.checked)} />
          Guardar cert + passwords cifrados (PBKDF2 250k iter + AES-GCM)
        </label>
        {persistEnc && (
          <div>
            <label>Master password (min 8, no se persiste)</label>
            <input type="password" value={masterPassword} onChange={(e) => setMasterPassword(e.target.value)} />
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              Si lo perdés, hay que re-cargar el .pfx y las credenciales SOL.
            </div>
          </div>
        )}
      </div>

      {/* ── Acciones ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={savingCfg || !certInfo}>
          {savingCfg ? 'Guardando...' : 'Guardar configuración'}
        </button>
        <button className="btn" onClick={handleTestConnection} disabled={testingConn || !solUser || !solPassword}>
          {testingConn ? 'Probando...' : 'Probar conexión SUNAT'}
        </button>
        {hasStoredCfg && (
          <button className="btn btn-ghost" onClick={handleClear} style={{ color: '#dc3545' }}>
            Borrar config guardada
          </button>
        )}
      </div>

      <div style={{ marginTop: 24, padding: 12, fontSize: 12, color: '#888', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        <b>Notas:</b><br/>
        • Modo homologación: usá RUC 20000000001, user MODDATOS, pass moddatos para tests.<br/>
        • El certificado digital tributario cuesta ~S/200/año (Reniec, Camerfirma, Llama.pe).<br/>
        • La firma se hace en este navegador. La key privada NUNCA se envía a ningún server.<br/>
        • SUNAT requiere conexión a /api/sunat-bill (proxy). Sin internet, los XMLs quedan en cola.
      </div>
    </div>
  );
}

// Registro global (convención JARVEX, ver main.jsx / jx-app.jsx)
if (typeof window !== 'undefined') {
  window.ConfigSUNATPage = ConfigSUNATPage;
}

export default ConfigSUNATPage;
