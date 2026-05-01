// ══════════════════════════════════════════════════════════════════════════
//  SUNAT UBL 2.1 — Generador de XML para comprobantes electrónicos (Perú)
//  Genera XML válido conforme al estándar UBL 2.1 publicado por SUNAT
//  (Manual del Programador). Independiente del OSE / PSE: el XML resultante
//  contiene un placeholder <ext:UBLExtensions> donde el OSE inyecta la
//  firma digital ds:Signature antes de enviarlo a SUNAT.
//
//  Tipos de comprobante soportados:
//    01 = Factura electrónica         (Invoice)
//    03 = Boleta de venta electrónica (Invoice)
//    07 = Nota de crédito             (CreditNote)
//    08 = Nota de débito              (DebitNote)
//    09 = Guía de remisión electrónica remitente (DespatchAdvice)
//
//  Encoding: ISO-8859-1 (exigido por SUNAT).
//  Moneda: PEN (default) y USD.
//  IGV: 18% por default; permite items exonerados / inafectos vía
//       TaxExemptionReasonCode (Catálogo SUNAT 07).
// ══════════════════════════════════════════════════════════════════════════

// ─── Helpers de formato ──────────────────────────────────────────────────
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmt2 = (n) => round2(n).toFixed(2);
const fmt2str = (n) => Number(n || 0).toFixed(2);

export function escapeXML(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function formatRUC(ruc) {
  return String(ruc || '').replace(/\D/g, '').slice(0, 11);
}

// Convierte número a letras (estilo SUNAT: "SON CIENTO DIECIOCHO CON 00/100 SOLES")
export function numberToWords(amount, currency = 'PEN') {
  const n = Number(amount) || 0;
  const entero = Math.floor(Math.abs(n));
  const cent = Math.round((Math.abs(n) - entero) * 100);
  const moneda = currency === 'USD' ? 'DOLARES AMERICANOS' : 'SOLES';

  const UNI = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
               'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE',
               'DIECIOCHO', 'DIECINUEVE', 'VEINTE'];
  const DEC = ['', '', 'VEINTI', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
               'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  const dosDigitos = (v) => {
    if (v <= 20) return UNI[v];
    if (v < 30)  return 'VEINTI' + UNI[v - 20].toLowerCase().toUpperCase();
    const d = Math.floor(v / 10), u = v % 10;
    return DEC[d] + (u ? ' Y ' + UNI[u] : '');
  };
  const tresDigitos = (v) => {
    if (v === 0)   return '';
    if (v === 100) return 'CIEN';
    const c = Math.floor(v / 100), r = v % 100;
    return (CEN[c] + (r ? ' ' + dosDigitos(r) : '')).trim();
  };
  const seisDigitos = (v) => {
    if (v === 0) return 'CERO';
    const miles = Math.floor(v / 1000), resto = v % 1000;
    let out = '';
    if (miles > 0) out += (miles === 1 ? 'MIL' : tresDigitos(miles) + ' MIL');
    if (resto > 0) out += (out ? ' ' : '') + tresDigitos(resto);
    return out;
  };
  const millones = (v) => {
    if (v === 0) return 'CERO';
    if (v < 1_000_000) return seisDigitos(v);
    const mill = Math.floor(v / 1_000_000), resto = v % 1_000_000;
    let out = (mill === 1 ? 'UN MILLON' : seisDigitos(mill) + ' MILLONES');
    if (resto > 0) out += ' ' + seisDigitos(resto);
    return out;
  };

  const palabras = millones(entero);
  const centStr = String(cent).padStart(2, '0');
  return `SON ${palabras} CON ${centStr}/100 ${moneda}`;
}

// Calcula totales de IGV a partir de items
// Cada item: { cantidad, precio_unitario, igv_pct (default 18), tax_exemption_code (default '10'=gravado) }
// Catálogo SUNAT 07 - Tipo de afectación al IGV:
//   '10' = Gravado (operación onerosa)
//   '20' = Exonerado
//   '30' = Inafecto
export function calcularTotalesIGV(items) {
  let totalGravado = 0;
  let totalExonerado = 0;
  let totalInafecto = 0;
  let totalIGV = 0;
  const lineas = [];

  for (const it of (items || [])) {
    const cant = Number(it.cantidad) || 0;
    const precio = Number(it.precio_unitario) || 0; // sin IGV
    const igvPct = it.igv_pct !== undefined ? Number(it.igv_pct) : 18;
    const code = it.tax_exemption_code || '10';

    const subtotal = round2(cant * precio);
    let igv = 0;
    let totalLinea = subtotal;
    if (code === '10') {
      igv = round2(subtotal * (igvPct / 100));
      totalLinea = round2(subtotal + igv);
      totalGravado += subtotal;
      totalIGV += igv;
    } else if (code === '20') {
      totalExonerado += subtotal;
    } else {
      totalInafecto += subtotal;
    }

    lineas.push({
      ...it,
      cantidad: cant,
      precio_unitario: precio,
      igv_pct: code === '10' ? igvPct : 0,
      tax_exemption_code: code,
      subtotal,
      igv,
      total_linea: totalLinea,
      precio_con_igv: cant > 0 ? round2(totalLinea / cant) : 0,
    });
  }

  totalGravado   = round2(totalGravado);
  totalExonerado = round2(totalExonerado);
  totalInafecto  = round2(totalInafecto);
  totalIGV       = round2(totalIGV);
  const totalVenta = round2(totalGravado + totalExonerado + totalInafecto + totalIGV);

  return {
    lineas,
    total_gravado: totalGravado,
    total_exonerado: totalExonerado,
    total_inafecto: totalInafecto,
    total_igv: totalIGV,
    total_venta: totalVenta,
  };
}

// ─── Bloques XML reutilizables ───────────────────────────────────────────
function ublExtensionsPlaceholder() {
  return `  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <!-- Placeholder: el OSE/PSE inyecta aquí la firma digital ds:Signature -->
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;
}

function partySupplier(emisor) {
  const ruc = formatRUC(emisor.ruc);
  const razon = escapeXML(emisor.razon_social || emisor.nombre || '');
  const nomCom = escapeXML(emisor.nombre_comercial || emisor.razon_social || '');
  const direccion = escapeXML(emisor.direccion || '');
  const ubigeo = escapeXML(emisor.ubigeo || '000000');
  const dist = escapeXML(emisor.distrito || '');
  const prov = escapeXML(emisor.provincia || '');
  const dep = escapeXML(emisor.departamento || '');
  return `  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${nomCom}]]></cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName><![CDATA[${razon}]]></cbc:RegistrationName>
        <cbc:CompanyID schemeID="6" schemeName="SUNAT:Identificador de Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${ruc}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID schemeID="6" schemeName="SUNAT:Identificador de Documento de Identidad" schemeAgencyName="PE:SUNAT">${ruc}</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${razon}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${ubigeo}</cbc:ID>
          <cbc:AddressTypeCode listAgencyName="PE:SUNAT" listName="Establecimientos anexos">0000</cbc:AddressTypeCode>
          <cbc:CitySubdivisionName>${dist}</cbc:CitySubdivisionName>
          <cbc:CityName>${prov}</cbc:CityName>
          <cbc:CountrySubentity>${dep}</cbc:CountrySubentity>
          <cbc:District>${dist}</cbc:District>
          <cac:AddressLine>
            <cbc:Line><![CDATA[${direccion}]]></cbc:Line>
          </cac:AddressLine>
          <cac:Country>
            <cbc:IdentificationCode listID="ISO 3166-1" listAgencyName="United Nations Economic Commission for Europe" listName="Country">PE</cbc:IdentificationCode>
          </cac:Country>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>`;
}

// schemeID del cliente: 1=DNI, 6=RUC, 4=Carnet ext, 7=Pasaporte, 0=Sin documento
function partyCustomer(cliente) {
  const tipoDoc = cliente.tipo_documento || (String(cliente.documento || '').length === 11 ? '6' : '1');
  const doc = String(cliente.documento || '0').replace(/\s/g, '');
  const razon = escapeXML(cliente.razon_social || cliente.nombre || 'CLIENTE VARIOS');
  const direccion = escapeXML(cliente.direccion || '-');
  return `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${tipoDoc}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${escapeXML(doc)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${razon}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cac:AddressLine>
            <cbc:Line><![CDATA[${direccion}]]></cbc:Line>
          </cac:AddressLine>
          <cac:Country>
            <cbc:IdentificationCode listID="ISO 3166-1" listAgencyName="United Nations Economic Commission for Europe" listName="Country">PE</cbc:IdentificationCode>
          </cac:Country>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>`;
}

function signatureBlock(emisor) {
  const ruc = formatRUC(emisor.ruc);
  const razon = escapeXML(emisor.razon_social || emisor.nombre || '');
  return `  <cac:Signature>
    <cbc:ID>${ruc}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>${ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name><![CDATA[${razon}]]></cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#SignatureSP</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>`;
}

function taxTotalBlock(totales, currency) {
  const blocks = [];
  if (totales.total_gravado > 0) {
    blocks.push(`      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${fmt2(totales.total_gravado)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">${fmt2(totales.total_igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">1000</cbc:ID>
            <cbc:Name>IGV</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`);
  }
  if (totales.total_exonerado > 0) {
    blocks.push(`      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${fmt2(totales.total_exonerado)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">0.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">9997</cbc:ID>
            <cbc:Name>EXO</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`);
  }
  if (totales.total_inafecto > 0) {
    blocks.push(`      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${fmt2(totales.total_inafecto)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">0.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">9998</cbc:ID>
            <cbc:Name>INA</cbc:Name>
            <cbc:TaxTypeCode>FRE</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`);
  }
  return `  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${fmt2(totales.total_igv)}</cbc:TaxAmount>
${blocks.join('\n')}
  </cac:TaxTotal>`;
}

function legalMonetaryTotal(totales, currency, tag = 'LegalMonetaryTotal') {
  const baseImponible = round2(totales.total_gravado + totales.total_exonerado + totales.total_inafecto);
  return `  <cac:${tag}>
    <cbc:LineExtensionAmount currencyID="${currency}">${fmt2(baseImponible)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${fmt2(totales.total_venta)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${fmt2(totales.total_venta)}</cbc:PayableAmount>
  </cac:${tag}>`;
}

// linaName: 'InvoiceLine' | 'CreditNoteLine' | 'DebitNoteLine'
// quantityTag: 'InvoicedQuantity' | 'CreditedQuantity' | 'DebitedQuantity'
function buildLines(lineas, currency, lineName, quantityTag) {
  return lineas.map((l, i) => {
    const idx = i + 1;
    const cant = Number(l.cantidad) || 0;
    const unit = l.unidad_medida || 'NIU'; // NIU = Unidad (Catalogo SUNAT 03)
    const desc = escapeXML(l.descripcion || 'Producto');
    const code = l.tax_exemption_code || '10';
    const igvPct = code === '10' ? (l.igv_pct !== undefined ? l.igv_pct : 18) : 0;

    let taxScheme;
    if (code === '10') {
      taxScheme = { id: '1000', name: 'IGV', type: 'VAT' };
    } else if (code === '20') {
      taxScheme = { id: '9997', name: 'EXO', type: 'VAT' };
    } else {
      taxScheme = { id: '9998', name: 'INA', type: 'FRE' };
    }

    return `  <cac:${lineName}>
    <cbc:ID>${idx}</cbc:ID>
    <cbc:${quantityTag} unitCode="${unit}" unitCodeListID="UN/ECE rec 20" unitCodeListAgencyName="United Nations Economic Commission for Europe">${cant}</cbc:${quantityTag}>
    <cbc:LineExtensionAmount currencyID="${currency}">${fmt2(l.subtotal)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="${currency}">${fmt2(l.precio_con_igv)}</cbc:PriceAmount>
        <cbc:PriceTypeCode listName="SUNAT:Indicador de Tipo de Precio" listAgencyName="PE:SUNAT" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16">01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${currency}">${fmt2(l.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${currency}">${fmt2(l.subtotal)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${currency}">${fmt2(l.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${fmt2(igvPct)}</cbc:Percent>
          <cbc:TaxExemptionReasonCode listAgencyName="PE:SUNAT" listName="SUNAT:Codigo de Tipo de Afectacion del IGV" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07">${code}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">${taxScheme.id}</cbc:ID>
            <cbc:Name>${taxScheme.name}</cbc:Name>
            <cbc:TaxTypeCode>${taxScheme.type}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${desc}]]></cbc:Description>
      ${l.codigo_producto ? `<cac:SellersItemIdentification><cbc:ID>${escapeXML(l.codigo_producto)}</cbc:ID></cac:SellersItemIdentification>` : ''}
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${fmt2(l.precio_unitario)}</cbc:PriceAmount>
    </cac:Price>
  </cac:${lineName}>`;
  }).join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
//  GENERADOR: Factura electrónica (tipo 01) — UBL Invoice
// ═══════════════════════════════════════════════════════════════════════
export function generateFacturaXML(comprobante, emisor, cliente, items) {
  return _generateInvoice(comprobante, emisor, cliente, items, '01', '0101');
}

// ═══════════════════════════════════════════════════════════════════════
//  GENERADOR: Boleta de venta electrónica (tipo 03) — UBL Invoice
// ═══════════════════════════════════════════════════════════════════════
export function generateBoletaXML(comprobante, emisor, cliente, items) {
  return _generateInvoice(comprobante, emisor, cliente, items, '03', '0101');
}

function _generateInvoice(comprobante, emisor, cliente, items, invoiceTypeCode, listID) {
  const currency = comprobante.moneda || 'PEN';
  const totales = calcularTotalesIGV(items);
  const serie = escapeXML(comprobante.serie || (invoiceTypeCode === '01' ? 'F001' : 'B001'));
  const correlativo = String(comprobante.correlativo || '1').padStart(8, '0');
  const id = `${serie}-${correlativo}`;
  const fecha = comprobante.fecha_emision || new Date().toISOString().slice(0, 10);
  const hora = comprobante.hora_emision || new Date().toTimeString().slice(0, 8);
  const venc = comprobante.fecha_vencimiento || fecha;
  const leyenda = numberToWords(totales.total_venta, currency);

  const xml = `<?xml version="1.0" encoding="ISO-8859-1" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
${ublExtensionsPlaceholder()}
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>${escapeXML(fecha)}</cbc:IssueDate>
  <cbc:IssueTime>${escapeXML(hora)}</cbc:IssueTime>
  <cbc:DueDate>${escapeXML(venc)}</cbc:DueDate>
  <cbc:InvoiceTypeCode listID="${listID}" listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01" name="Tipo de Operacion">${invoiceTypeCode}</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000"><![CDATA[${leyenda}]]></cbc:Note>
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listName="Currency" listAgencyName="United Nations Economic Commission for Europe">${currency}</cbc:DocumentCurrencyCode>
${signatureBlock(emisor)}
${partySupplier(emisor)}
${partyCustomer(cliente)}
${taxTotalBlock(totales, currency)}
${legalMonetaryTotal(totales, currency)}
${buildLines(totales.lineas, currency, 'InvoiceLine', 'InvoicedQuantity')}
</Invoice>`;
  return xml;
}

// ═══════════════════════════════════════════════════════════════════════
//  GENERADOR: Nota de crédito (tipo 07) — UBL CreditNote
//  motivoCodigo: Catálogo SUNAT 09 (01=anulación, 02=anulación error en RUC,
//                03=corrección por error en descripción, 06=devolución total,
//                07=devolución parcial, 13=ajuste de operaciones, etc.)
//  documentoAfectado: { tipo: '01'|'03', serie_correlativo: 'F001-00000123' }
// ═══════════════════════════════════════════════════════════════════════
export function generateNotaCreditoXML(comprobante, emisor, cliente, items, motivoCodigo, documentoAfectado) {
  return _generateNoteXML(comprobante, emisor, cliente, items, motivoCodigo, documentoAfectado, 'credit');
}

// ═══════════════════════════════════════════════════════════════════════
//  GENERADOR: Nota de débito (tipo 08) — UBL DebitNote
//  motivoCodigo: Catálogo SUNAT 10 (01=intereses por mora, 02=aumento valor,
//                03=penalidades)
// ═══════════════════════════════════════════════════════════════════════
export function generateNotaDebitoXML(comprobante, emisor, cliente, items, motivoCodigo, documentoAfectado) {
  return _generateNoteXML(comprobante, emisor, cliente, items, motivoCodigo, documentoAfectado, 'debit');
}

function _generateNoteXML(comprobante, emisor, cliente, items, motivoCodigo, documentoAfectado, kind) {
  const currency = comprobante.moneda || 'PEN';
  const totales = calcularTotalesIGV(items);
  const serieDefault = kind === 'credit' ? 'FC01' : 'FD01';
  const serie = escapeXML(comprobante.serie || serieDefault);
  const correlativo = String(comprobante.correlativo || '1').padStart(8, '0');
  const id = `${serie}-${correlativo}`;
  const fecha = comprobante.fecha_emision || new Date().toISOString().slice(0, 10);
  const hora = comprobante.hora_emision || new Date().toTimeString().slice(0, 8);
  const leyenda = numberToWords(totales.total_venta, currency);
  const motivo = escapeXML(comprobante.motivo_descripcion || (kind === 'credit' ? 'Anulación de la operación' : 'Cargo adicional'));
  const docAfTipo = (documentoAfectado && documentoAfectado.tipo) || '01';
  const docAfId   = escapeXML((documentoAfectado && documentoAfectado.serie_correlativo) || '');

  const isCredit = kind === 'credit';
  const rootName = isCredit ? 'CreditNote' : 'DebitNote';
  const ns = isCredit
    ? 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2'
    : 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2';
  const lineName  = isCredit ? 'CreditNoteLine' : 'DebitNoteLine';
  const quantTag  = isCredit ? 'CreditedQuantity' : 'DebitedQuantity';
  const refBlock  = isCredit
    ? `  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>${docAfId}</cbc:ReferenceID>
    <cbc:ResponseCode>${escapeXML(motivoCodigo || '01')}</cbc:ResponseCode>
    <cbc:Description><![CDATA[${motivo}]]></cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${docAfId}</cbc:ID>
      <cbc:DocumentTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">${docAfTipo}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`
    : `  <cac:DiscrepancyResponse>
    <cbc:ReferenceID>${docAfId}</cbc:ReferenceID>
    <cbc:ResponseCode>${escapeXML(motivoCodigo || '01')}</cbc:ResponseCode>
    <cbc:Description><![CDATA[${motivo}]]></cbc:Description>
  </cac:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${docAfId}</cbc:ID>
      <cbc:DocumentTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">${docAfTipo}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`;
  const monetaryTag = isCredit ? 'LegalMonetaryTotal' : 'RequestedMonetaryTotal';

  const xml = `<?xml version="1.0" encoding="ISO-8859-1" standalone="no"?>
<${rootName} xmlns="${ns}"
            xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
            xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
            xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
            xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
${ublExtensionsPlaceholder()}
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>${escapeXML(fecha)}</cbc:IssueDate>
  <cbc:IssueTime>${escapeXML(hora)}</cbc:IssueTime>
  <cbc:Note languageLocaleID="1000"><![CDATA[${leyenda}]]></cbc:Note>
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listName="Currency" listAgencyName="United Nations Economic Commission for Europe">${currency}</cbc:DocumentCurrencyCode>
${refBlock}
${signatureBlock(emisor)}
${partySupplier(emisor)}
${partyCustomer(cliente)}
${taxTotalBlock(totales, currency)}
${legalMonetaryTotal(totales, currency, monetaryTag)}
${buildLines(totales.lineas, currency, lineName, quantTag)}
</${rootName}>`;
  return xml;
}

// ═══════════════════════════════════════════════════════════════════════
//  GENERADOR: Guía de remisión electrónica remitente (tipo 09)
//  UBL DespatchAdvice — versión simplificada (GRE 2022 v1.0).
//  guia: { serie, correlativo, fecha_emision, motivo_traslado ('01'..'13'),
//          modalidad_traslado ('01'=transp.publico, '02'=privado),
//          fecha_inicio_traslado, peso_total_kg, num_bultos, observaciones }
//  destinatario: { tipo_documento, documento, razon_social }
//  items: [{ cantidad, unidad_medida, descripcion, codigo_producto }]
//  transporte: {
//     // si modalidad = '02' (privado):
//     vehiculo_placa, conductor_dni, conductor_nombres, conductor_apellidos, conductor_licencia,
//     // si modalidad = '01' (publico):
//     transportista_ruc, transportista_razon, transportista_mtc,
//     // direcciones
//     punto_partida_ubigeo, punto_partida_direccion,
//     punto_llegada_ubigeo, punto_llegada_direccion
//  }
// ═══════════════════════════════════════════════════════════════════════
export function generateGRERemitenteXML(guia, emisor, destinatario, items, transporte) {
  const serie = escapeXML(guia.serie || 'T001');
  const correlativo = String(guia.correlativo || '1').padStart(8, '0');
  const id = `${serie}-${correlativo}`;
  const fecha = guia.fecha_emision || new Date().toISOString().slice(0, 10);
  const hora = guia.hora_emision || new Date().toTimeString().slice(0, 8);
  const fechaInicio = guia.fecha_inicio_traslado || fecha;
  const motivo = escapeXML(guia.motivo_traslado || '01'); // 01=Venta
  const modalidad = escapeXML(guia.modalidad_traslado || '02'); // 02=Privado
  const peso = Number(guia.peso_total_kg || 0).toFixed(3);
  const bultos = Number(guia.num_bultos || items.length || 1);
  const obs = escapeXML(guia.observaciones || '');

  const t = transporte || {};
  const partidaUbi = escapeXML(t.punto_partida_ubigeo || '000000');
  const partidaDir = escapeXML(t.punto_partida_direccion || '-');
  const llegadaUbi = escapeXML(t.punto_llegada_ubigeo || '000000');
  const llegadaDir = escapeXML(t.punto_llegada_direccion || '-');

  let transportistaBlock = '';
  if (modalidad === '01') {
    // Transporte público
    const tRuc = formatRUC(t.transportista_ruc);
    const tRazon = escapeXML(t.transportista_razon || '');
    const tMtc = escapeXML(t.transportista_mtc || '');
    transportistaBlock = `      <cac:CarrierParty>
        <cac:PartyIdentification>
          <cbc:ID schemeID="6">${tRuc}</cbc:ID>
        </cac:PartyIdentification>
        <cac:PartyLegalEntity>
          <cbc:RegistrationName><![CDATA[${tRazon}]]></cbc:RegistrationName>
        </cac:PartyLegalEntity>
      </cac:CarrierParty>
      ${tMtc ? `<cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID>${tMtc}</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>` : ''}`;
  } else {
    // Transporte privado: vehículo + conductor del emisor
    const placa = escapeXML(t.vehiculo_placa || '');
    const dni = escapeXML(t.conductor_dni || '');
    const lic = escapeXML(t.conductor_licencia || '');
    const nom = escapeXML(t.conductor_nombres || '');
    const ape = escapeXML(t.conductor_apellidos || '');
    transportistaBlock = `      ${placa ? `<cac:TransportMeans><cac:RoadTransport><cbc:LicensePlateID>${placa}</cbc:LicensePlateID></cac:RoadTransport></cac:TransportMeans>` : ''}
      ${dni ? `<cac:DriverPerson>
        <cbc:ID schemeID="1">${dni}</cbc:ID>
        <cbc:FirstName><![CDATA[${nom}]]></cbc:FirstName>
        <cbc:FamilyName><![CDATA[${ape}]]></cbc:FamilyName>
        <cbc:JobTitle>Principal</cbc:JobTitle>
        ${lic ? `<cac:IdentityDocumentReference><cbc:ID>${lic}</cbc:ID></cac:IdentityDocumentReference>` : ''}
      </cac:DriverPerson>` : ''}`;
  }

  const lineas = (items || []).map((it, i) => {
    const idx = i + 1;
    const cant = Number(it.cantidad) || 0;
    const unit = it.unidad_medida || 'NIU';
    const desc = escapeXML(it.descripcion || 'Producto');
    const cod = escapeXML(it.codigo_producto || `ITEM-${idx}`);
    return `  <cac:DespatchLine>
    <cbc:ID>${idx}</cbc:ID>
    <cbc:DeliveredQuantity unitCode="${unit}">${cant}</cbc:DeliveredQuantity>
    <cac:OrderLineReference>
      <cbc:LineID>${idx}</cbc:LineID>
    </cac:OrderLineReference>
    <cac:Item>
      <cbc:Description><![CDATA[${desc}]]></cbc:Description>
      <cac:SellersItemIdentification>
        <cbc:ID>${cod}</cbc:ID>
      </cac:SellersItemIdentification>
    </cac:Item>
  </cac:DespatchLine>`;
  }).join('\n');

  const destDoc = String(destinatario.documento || '0');
  const destTipo = destinatario.tipo_documento || (destDoc.length === 11 ? '6' : '1');
  const destRazon = escapeXML(destinatario.razon_social || destinatario.nombre || '-');

  const xml = `<?xml version="1.0" encoding="ISO-8859-1" standalone="no"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
                xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
                xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
                xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
                xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1"
                xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
${ublExtensionsPlaceholder()}
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${id}</cbc:ID>
  <cbc:IssueDate>${escapeXML(fecha)}</cbc:IssueDate>
  <cbc:IssueTime>${escapeXML(hora)}</cbc:IssueTime>
  <cbc:DespatchAdviceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">09</cbc:DespatchAdviceTypeCode>
  ${obs ? `<cbc:Note><![CDATA[${obs}]]></cbc:Note>` : ''}
${signatureBlock(emisor)}
  <cac:DespatchSupplierParty>
    <cbc:CustomerAssignedAccountID>${formatRUC(emisor.ruc)}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${escapeXML(emisor.razon_social || '')}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:DespatchSupplierParty>
  <cac:DeliveryCustomerParty>
    <cbc:CustomerAssignedAccountID>${escapeXML(destDoc)}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>${destTipo}</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${destRazon}]]></cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:DeliveryCustomerParty>
  <cac:Shipment>
    <cbc:ID>${id}</cbc:ID>
    <cbc:HandlingCode listAgencyName="PE:SUNAT" listName="Motivo de traslado" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo20">${motivo}</cbc:HandlingCode>
    <cbc:GrossWeightMeasure unitCode="KGM">${peso}</cbc:GrossWeightMeasure>
    <cbc:TotalTransportHandlingUnitQuantity>${bultos}</cbc:TotalTransportHandlingUnitQuantity>
    <cac:ShipmentStage>
      <cbc:TransportModeCode listName="Modalidad de traslado" listAgencyName="PE:SUNAT" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo18">${modalidad}</cbc:TransportModeCode>
      <cac:TransitPeriod>
        <cbc:StartDate>${escapeXML(fechaInicio)}</cbc:StartDate>
      </cac:TransitPeriod>
${transportistaBlock}
    </cac:ShipmentStage>
    <cac:Delivery>
      <cac:DeliveryAddress>
        <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${llegadaUbi}</cbc:ID>
        <cac:AddressLine><cbc:Line><![CDATA[${llegadaDir}]]></cbc:Line></cac:AddressLine>
      </cac:DeliveryAddress>
    </cac:Delivery>
    <cac:OriginAddress>
      <cbc:ID schemeAgencyName="PE:INEI" schemeName="Ubigeos">${partidaUbi}</cbc:ID>
      <cac:AddressLine><cbc:Line><![CDATA[${partidaDir}]]></cbc:Line></cac:AddressLine>
    </cac:OriginAddress>
  </cac:Shipment>
${lineas}
</DespatchAdvice>`;
  return xml;
}

// Exposición global (compatible con la convención window.* del proyecto)
if (typeof window !== 'undefined') {
  window.__sunatUBL = {
    generateFacturaXML,
    generateBoletaXML,
    generateNotaCreditoXML,
    generateNotaDebitoXML,
    generateGRERemitenteXML,
    formatRUC,
    escapeXML,
    numberToWords,
    calcularTotalesIGV,
  };
}
