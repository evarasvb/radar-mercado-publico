/**
 * RADAR DE OPORTUNIDADES · API de Mercado Público (licitaciones)
 * Plantilla del libro «Véndele al Estado y No Mueras en el Intento», Volumen 7, capítulo 6.
 * Autor: Enrique Evaristo Varas Bahamonde · FirmaVB · Versión 1.0 (noviembre de 2026)
 *
 * Qué hace: una vez al día consulta las licitaciones publicadas («activas»), busca tus
 * palabras clave en el nombre, evita duplicados por código, completa datos de la ficha,
 * anota todo en la hoja «Oportunidades», deja constancia en «Registro» y te envía un resumen.
 *
 * Fuentes verificadas el 18-11-2026 (vuelve a revisarlas antes de modificar el código):
 *  - https://www.chilecompra.cl/api/  (página oficial de la API; api.mercadopublico.cl redirige ahí)
 *  - Diccionario de datos de licitaciones (PDF oficial de ChileCompra, marzo de 2026)
 *  - Condiciones de uso: un ticket por persona, 10.000 solicitudes diarias por ticket,
 *    control por IP y rechazo de peticiones simultáneas.
 *
 * Tu ticket NO va en la planilla: se guarda en las Propiedades del script (menú Radar MP).
 * Las columnas Decisión, Responsable y Notas son de tu equipo: el script nunca las escribe.
 */

const RADAR = {
  VERSION: '1.0',
  API_LICITACIONES: 'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json',
  FICHA_URL: 'https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=',
  ZONA: 'America/Santiago',
  HOJA_CONFIG: 'Configuración',
  HOJA_OPORT: 'Oportunidades',
  HOJA_REG: 'Registro',
  HOJA_REVISADAS: '_revisadas',
  PROP_TICKET: 'MP_TICKET',
  PROP_ULTIMO_OK: 'ULTIMA_CONSULTA_OK',
  PAUSA_MS: 2000,              // espera entre consultas: la API rechaza peticiones simultáneas
  REINTENTOS: 4,               // intentos por consulta antes de declarar la falla
  ESPERAS_MS: [10000, 30000, 60000],
  TOPE_DIARIO_PROPIO: 9000,    // margen bajo el límite oficial de 10.000 solicitudes por ticket
  TIEMPO_MAX_MS: 4.5 * 60 * 1000 // Apps Script corta cada ejecución a los 6 minutos
};

// Estados de licitación documentados por ChileCompra.
const ESTADOS = { 5: 'Publicada', 6: 'Cerrada', 7: 'Desierta', 8: 'Adjudicada', 18: 'Revocada', 19: 'Suspendida' };

// Columnas de la hoja Oportunidades (no cambies el orden de las 16 primeras).
const COLS = ['Detectada', 'Código', 'Nombre', 'Palabra clave', 'Coincidió en', 'Estado', 'Cierre',
  'Organismo', 'Unidad de compra', 'Región', 'Tipo', 'Monto estimado', 'Moneda', 'Ficha',
  'Última vez vista activa', 'Detalle', 'Decisión', 'Responsable', 'Notas'];
const C = {}; COLS.forEach(function (n, i) { C[n] = i; });
const COLS_SCRIPT = 16; // el script solo escribe las columnas A a P

// ---------------------------------------------------------------- menú
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Radar MP')
    .addItem('1. Guardar mi ticket', 'guardarTicket')
    .addItem('2. Probar conexión', 'probarConexion')
    .addItem('3. Ejecutar ahora', 'ejecutarRadar')
    .addItem('4. Activar ejecución diaria', 'activarEjecucionDiaria')
    .addItem('5. Desactivar ejecución diaria', 'desactivarEjecucionDiaria')
    .addSeparator()
    .addItem('Crear o reparar hojas', 'prepararHojas')
    .addToUi();
}

function guardarTicket() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Ticket de la API de Mercado Público',
    'Pega tu ticket. Se guardará en las Propiedades del script, no en la planilla.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const t = String(r.getResponseText() || '').trim();
  if (!/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(t)) {
    ui.alert('Ese texto no tiene el formato de un ticket (8-4-4-4-12 caracteres). No se guardó nada.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(RADAR.PROP_TICKET, t);
  ui.alert('Ticket guardado. Ahora usa «2. Probar conexión».');
}

function probarConexion() {
  prepararHojas();
  const ticket = PropertiesService.getScriptProperties().getProperty(RADAR.PROP_TICKET);
  const ui = SpreadsheetApp.getUi();
  if (!ticket) { ui.alert('Primero guarda tu ticket (menú Radar MP › 1).'); return; }
  const r = consultarApi_({ estado: 'activas' }, ticket);
  if (r.ok) {
    registrar_('OK', 'Prueba de conexión correcta', { activas: r.data.Listado.length });
    ui.alert('Conexión correcta. La API informó ' + r.data.Listado.length + ' licitaciones activas.');
  } else {
    registrar_('ERROR', 'Prueba de conexión fallida: ' + r.error, {});
    ui.alert('La prueba falló: ' + r.error + '\nEsto NO significa que no haya licitaciones. Revisa el Registro.');
  }
}

function activarEjecucionDiaria() {
  desactivarEjecucionDiaria();
  const cfg = leerConfig_();
  ScriptApp.newTrigger('ejecutarRadar').timeBased().everyDays(1).atHour(cfg.hora).inTimezone(RADAR.ZONA).create();
  registrar_('OK', 'Ejecución diaria activada cerca de las ' + cfg.hora + ':00 (hora de Chile)', {});
  try { SpreadsheetApp.getUi().alert('Listo. El radar correrá cada día cerca de las ' + cfg.hora + ':00.'); } catch (e) {}
}

function desactivarEjecucionDiaria() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ejecutarRadar') ScriptApp.deleteTrigger(t);
  });
}

// ---------------------------------------------------------------- ejecución principal
function ejecutarRadar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { registrar_('ADVERTENCIA', 'Otra ejecución estaba en curso; esta se omitió', {}); return; }
  const t0 = Date.now();
  const st = { activas: 0, coincidencias: 0, nuevas: 0, fichas: 0 };
  let cfg = null;
  try {
    prepararHojas();
    cfg = leerConfig_();
    const props = PropertiesService.getScriptProperties();
    const ticket = props.getProperty(RADAR.PROP_TICKET);
    if (!ticket) return fallar_(cfg, 'No hay ticket guardado (menú Radar MP › 1).', st, t0);
    if (!cfg.claves.length) return fallar_(cfg, 'La hoja Configuración no tiene palabras clave.', st, t0);

    // 1. Consulta de licitaciones activas. Una falla aquí detiene todo: nunca se informa como «sin resultados».
    const r = consultarApi_({ estado: 'activas' }, ticket);
    if (!r.ok) return fallar_(cfg, 'No se pudo consultar la API: ' + r.error, st, t0);
    const lista = r.data.Listado;
    st.activas = lista.length;
    if (lista.length === 0) {
      return fallar_(cfg, 'La API respondió sin licitaciones activas. Es improbable: revisa manualmente en mercadopublico.cl antes de concluir algo.', st, t0);
    }
    if (typeof r.data.Cantidad === 'number' && r.data.Cantidad !== lista.length) {
      registrar_('ADVERTENCIA', 'Cantidad informada (' + r.data.Cantidad + ') distinta del listado recibido (' + lista.length + ')', st);
    }
    props.setProperty(RADAR.PROP_ULTIMO_OK, ahoraTexto_());

    // 2. Coincidencias por nombre y deduplicación por CodigoExterno.
    const hoja = hojaOport_();
    const existentes = codigosExistentes_(hoja);
    const activasSet = {};
    const nuevas = [];
    lista.forEach(function (lic) {
      const cod = String(lic.CodigoExterno || '').trim();
      if (!cod) return;
      activasSet[cod] = true;
      const m = coincide_(lic.Nombre, cfg.claves);
      if (!m || coincide_(lic.Nombre, cfg.excluir)) return;
      st.coincidencias++;
      if (existentes[cod] || nuevas.some(function (n) { return n[C['Código']] === cod; })) return;
      nuevas.push(filaBase_(lic, m, 'Nombre'));
    });

    // 3. (Opcional) búsqueda en la descripción de licitaciones que no coincidieron por nombre.
    if (cfg.fichasDescripcion > 0) {
      buscarEnDescripcion_(lista, existentes, nuevas, cfg, ticket, st, t0);
    }

    if (nuevas.length) {
      hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, COLS_SCRIPT).setValues(nuevas);
      st.nuevas = nuevas.length;
    }

    // 4. Marca cuáles de tus oportunidades siguen apareciendo como activas.
    marcarVistas_(hoja, activasSet);

    // 5. Completa datos desde la ficha (organismo, región, monto) y aplica filtros opcionales.
    completarFichas_(hoja, cfg, ticket, st, t0);

    // 6. Resumen por correo.
    const nuevasCodigos = nuevas.map(function (n) { return n[C['Código']]; });
    enviarResumen_(cfg, hoja, nuevasCodigos, st);
    registrar_('OK', 'Ejecución completa', st, t0);
  } catch (e) {
    fallar_(cfg, 'Error inesperado: ' + ocultarTicket_(String(e && e.message || e)), st, t0);
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- consultas a la API
function consultarApi_(params, ticket) {
  const q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); });
  q.push('ticket=' + encodeURIComponent(ticket));
  const url = RADAR.API_LICITACIONES + '?' + q.join('&');
  let ultimo = 'sin respuesta';
  for (let i = 0; i < RADAR.REINTENTOS; i++) {
    if (i > 0) Utilities.sleep(RADAR.ESPERAS_MS[Math.min(i - 1, RADAR.ESPERAS_MS.length - 1)]);
    // Cada intento cuenta para el límite oficial de solicitudes diarias del ticket.
    if (!contarLlamada_()) return { ok: false, error: 'Se alcanzó el tope diario propio de consultas (' + RADAR.TOPE_DIARIO_PROPIO + '). Se reanuda mañana.' };
    let code = 0, texto = '', json = null;
    try {
      const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
      code = resp.getResponseCode();
      texto = resp.getContentText('UTF-8');
    } catch (e) {
      ultimo = 'error de red: ' + ocultarTicket_(String(e && e.message || e));
      continue; // reintenta
    }
    try { json = JSON.parse(texto); } catch (e) { json = null; }
    if (code === 200 && json && Array.isArray(json.Listado)) return { ok: true, data: json };
    const codApi = json && json.Codigo, msj = json && json.Mensaje;
    ultimo = 'HTTP ' + code + (codApi ? ' · código ' + codApi : '') + (msj ? ' · ' + msj : (json ? '' : ' · respuesta no es JSON'));
    if (codApi === 203) return { ok: false, error: ultimo + ' (revisa tu ticket)' }; // ticket no válido: reintentar no sirve
    const reintentable = code === 429 || codApi === 10500 || code >= 500 || code === 0 || (code === 200 && !json);
    if (!reintentable) return { ok: false, error: ultimo };
  }
  return { ok: false, error: ultimo + ' (tras ' + RADAR.REINTENTOS + ' intentos)' };
}

function consultarFicha_(codigo, ticket) {
  Utilities.sleep(RADAR.PAUSA_MS);
  const r = consultarApi_({ codigo: codigo }, ticket);
  if (!r.ok) return r;
  const lic = r.data.Listado[0];
  if (!lic || String(lic.CodigoExterno) !== String(codigo)) return { ok: false, error: 'la ficha no trajo el código pedido' };
  return { ok: true, lic: lic };
}

function contarLlamada_() {
  const props = PropertiesService.getScriptProperties();
  const k = 'LLAMADAS_' + Utilities.formatDate(new Date(), RADAR.ZONA, 'yyyyMMdd');
  const n = Number(props.getProperty(k) || 0);
  if (n >= RADAR.TOPE_DIARIO_PROPIO) return false;
  props.setProperty(k, String(n + 1));
  return true;
}

function llamadasHoy_() {
  const k = 'LLAMADAS_' + Utilities.formatDate(new Date(), RADAR.ZONA, 'yyyyMMdd');
  return Number(PropertiesService.getScriptProperties().getProperty(k) || 0);
}

// ---------------------------------------------------------------- coincidencias
function normalizar_(s) {
  return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

/** Devuelve la primera palabra clave que aparece como palabra o frase completa. «aseo*» acepta aseos, aseo, etc. */
function coincide_(texto, claves) {
  const t = normalizar_(texto);
  for (let i = 0; i < claves.length; i++) {
    const raw = String(claves[i]).trim();
    if (!raw) continue;
    const prefijo = /\*$/.test(raw);
    const k = normalizar_(raw.replace(/\*$/, '')).trim();
    if (!k) continue;
    if (prefijo ? t.indexOf(' ' + k) >= 0 : t.indexOf(' ' + k + ' ') >= 0) return raw;
  }
  return null;
}

// ---------------------------------------------------------------- hoja Oportunidades
function filaBase_(lic, clave, donde) {
  const f = new Array(COLS_SCRIPT).fill('');
  const cod = String(lic.CodigoExterno).trim();
  f[C['Detectada']] = new Date();
  f[C['Código']] = cod;
  f[C['Nombre']] = lic.Nombre || '';
  f[C['Palabra clave']] = clave;
  f[C['Coincidió en']] = donde;
  f[C['Estado']] = ESTADOS[lic.CodigoEstado] || lic.Estado || ('código ' + lic.CodigoEstado);
  f[C['Cierre']] = fechaLocal_(lic.FechaCierre || (lic.Fechas && lic.Fechas.FechaCierre));
  f[C['Ficha']] = RADAR.FICHA_URL + encodeURIComponent(cod);
  f[C['Última vez vista activa']] = new Date();
  f[C['Detalle']] = 'pendiente';
  return f;
}

function codigosExistentes_(hoja) {
  const out = {};
  const n = hoja.getLastRow() - 1;
  if (n < 1) return out;
  hoja.getRange(2, C['Código'] + 1, n, 1).getValues().forEach(function (r, i) {
    if (r[0]) out[String(r[0]).trim()] = i + 2;
  });
  return out;
}

function marcarVistas_(hoja, activasSet) {
  const n = hoja.getLastRow() - 1;
  if (n < 1) return;
  const cods = hoja.getRange(2, C['Código'] + 1, n, 1).getValues();
  const rango = hoja.getRange(2, C['Última vez vista activa'] + 1, n, 1);
  const vistas = rango.getValues();
  const hoy = new Date();
  let cambios = false;
  cods.forEach(function (r, i) { if (activasSet[String(r[0]).trim()]) { vistas[i][0] = hoy; cambios = true; } });
  if (cambios) rango.setValues(vistas);
}

function completarFichas_(hoja, cfg, ticket, st, t0) {
  const n = hoja.getLastRow() - 1;
  if (n < 1) return;
  const rango = hoja.getRange(2, 1, n, COLS_SCRIPT);
  const filas = rango.getValues();
  let consultadas = 0, cambios = false;
  for (let i = 0; i < filas.length; i++) {
    const det = String(filas[i][C['Detalle']]);
    if (det !== 'pendiente' && det.indexOf('reintentar') !== 0) continue;
    if (consultadas >= cfg.maxFichas || Date.now() - t0 > RADAR.TIEMPO_MAX_MS) break; // sigue en la próxima ejecución
    const r = consultarFicha_(filas[i][C['Código']], ticket);
    consultadas++;
    cambios = true;
    if (!r.ok) { filas[i][C['Detalle']] = 'reintentar: ' + r.error.slice(0, 80); continue; }
    aplicarFicha_(filas[i], r.lic, cfg);
  }
  st.fichas += consultadas;
  if (cambios) rango.setValues(filas);
}

function aplicarFicha_(fila, lic, cfg) {
  const comp = lic.Comprador || {};
  fila[C['Estado']] = lic.Estado || ESTADOS[lic.CodigoEstado] || fila[C['Estado']];
  const cierre = fechaLocal_((lic.Fechas && lic.Fechas.FechaCierre) || lic.FechaCierre);
  if (cierre) fila[C['Cierre']] = cierre;
  fila[C['Organismo']] = comp.NombreOrganismo || '';
  fila[C['Unidad de compra']] = comp.NombreUnidad || '';
  fila[C['Región']] = String(comp.RegionUnidad || '').trim();
  fila[C['Tipo']] = lic.Tipo || '';
  // El monto solo se anota si la ficha lo declara visible (VisibilidadMonto = 1).
  fila[C['Monto estimado']] = (Number(lic.VisibilidadMonto) === 1 && lic.MontoEstimado != null) ? lic.MontoEstimado : '';
  fila[C['Moneda']] = lic.Moneda || '';
  fila[C['Detalle']] = filtroOk_(fila, comp, cfg);
}

function filtroOk_(fila, comp, cfg) {
  if (cfg.regiones.length) {
    const reg = normalizar_(comp.RegionUnidad);
    const ok = cfg.regiones.some(function (r) { return reg.indexOf(normalizar_(r).trim()) >= 0; });
    if (!ok) return 'fuera de filtro (región)';
  }
  if (cfg.organismos.length) {
    const ok = cfg.organismos.some(function (o) { return String(o).trim() === String(comp.CodigoOrganismo || '').trim(); });
    if (!ok) return 'fuera de filtro (organismo)';
  }
  return 'ok';
}

function buscarEnDescripcion_(lista, existentes, nuevas, cfg, ticket, st, t0) {
  const hojaRev = hojaRevisadas_();
  const revisadas = {};
  const n = hojaRev.getLastRow();
  if (n > 0) hojaRev.getRange(1, 1, n, 1).getValues().forEach(function (r) { revisadas[String(r[0])] = true; });
  const yaEnNuevas = {};
  nuevas.forEach(function (f) { yaEnNuevas[f[C['Código']]] = true; });
  const marcar = [];
  let hechas = 0;
  for (let i = 0; i < lista.length && hechas < cfg.fichasDescripcion; i++) {
    const cod = String(lista[i].CodigoExterno || '').trim();
    if (!cod || existentes[cod] || yaEnNuevas[cod] || revisadas[cod]) continue;
    if (Date.now() - t0 > RADAR.TIEMPO_MAX_MS / 2) break; // deja tiempo para completar fichas y avisar
    const r = consultarFicha_(cod, ticket);
    hechas++;
    if (!r.ok) continue; // no se marca como revisada: se intentará otro día
    marcar.push([cod, new Date()]);
    const texto = (r.lic.Nombre || '') + ' ' + (r.lic.Descripcion || '');
    const m = coincide_(texto, cfg.claves);
    if (m && !coincide_(texto, cfg.excluir)) {
      const f = filaBase_(r.lic, m, 'Descripción');
      aplicarFicha_(f, r.lic, cfg);
      nuevas.push(f);
      st.coincidencias++;
    }
  }
  st.fichas += hechas;
  if (marcar.length) hojaRev.getRange(hojaRev.getLastRow() + 1, 1, marcar.length, 2).setValues(marcar);
}

// ---------------------------------------------------------------- correo
function enviarResumen_(cfg, hoja, codigos, st) {
  if (!cfg.correo) { registrar_('ADVERTENCIA', 'Sin correo configurado: no se envió resumen', st); return; }
  const n = hoja.getLastRow() - 1;
  const filas = n > 0 ? hoja.getRange(2, 1, n, COLS_SCRIPT).getValues() : [];
  const set = {}; codigos.forEach(function (c) { set[c] = true; });
  const mostrar = filas.filter(function (f) { return set[f[C['Código']]] && String(f[C['Detalle']]).indexOf('fuera de filtro') !== 0; });
  if (!mostrar.length && !cfg.avisarSinNovedades) return;
  const fecha = Utilities.formatDate(new Date(), RADAR.ZONA, 'dd-MM-yyyy');
  const asunto = mostrar.length
    ? 'Radar MP: ' + mostrar.length + ' oportunidad(es) nueva(s) · ' + fecha
    : 'Radar MP: consulta correcta, sin novedades · ' + fecha;
  let html = '<p>Se revisaron <b>' + st.activas + '</b> licitaciones activas informadas por la API de Mercado Público.</p>';
  if (mostrar.length) {
    html += '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:13px">' +
      '<tr><th>Código</th><th>Nombre</th><th>Organismo</th><th>Región</th><th>Cierre</th><th>Palabra</th></tr>';
    mostrar.forEach(function (f) {
      html += '<tr><td><a href="' + esc_(f[C['Ficha']]) + '">' + esc_(f[C['Código']]) + '</a></td><td>' + esc_(f[C['Nombre']]) +
        '</td><td>' + esc_(f[C['Organismo']] || '(ficha pendiente)') + '</td><td>' + esc_(f[C['Región']]) +
        '</td><td>' + esc_(fmtFecha_(f[C['Cierre']])) + '</td><td>' + esc_(f[C['Palabra clave']]) + '</td></tr>';
    });
    html += '</table>';
  } else {
    html += '<p>No aparecieron licitaciones nuevas con tus palabras clave. La consulta funcionó; «sin novedades» no es lo mismo que «falló».</p>';
  }
  html += '<p style="color:#555">Verifica siempre la ficha y las bases en mercadopublico.cl antes de decidir. Fuente de los datos: Dirección ChileCompra.</p>';
  enviarCorreo_(cfg.correo, asunto, html, st);
}

function enviarCorreo_(correo, asunto, html, st) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) { registrar_('ADVERTENCIA', 'Sin cuota diaria de correo: el resumen no se envió', st); return; }
    MailApp.sendEmail({ to: correo, subject: asunto, htmlBody: html, name: 'Radar MP' });
  } catch (e) {
    registrar_('ERROR', 'No se pudo enviar el correo: ' + String(e && e.message || e), st);
  }
}

function fallar_(cfg, mensaje, st, t0) {
  registrar_('ERROR', mensaje, st, t0);
  if (cfg && cfg.correo) {
    const ultimo = PropertiesService.getScriptProperties().getProperty(RADAR.PROP_ULTIMO_OK) || 'sin registro';
    enviarCorreo_(cfg.correo, 'Radar MP: FALLÓ la consulta · revisa manualmente',
      '<p><b>El radar no pudo completar la consulta.</b> Esto no significa que no haya oportunidades.</p><p>Detalle: ' + esc_(mensaje) +
      '</p><p>Última consulta correcta: ' + esc_(ultimo) + '</p><p>Mientras se resuelve, busca manualmente en mercadopublico.cl con tus palabras clave.</p>', st);
  }
}

// ---------------------------------------------------------------- configuración, hojas y registro
function leerConfig_() {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RADAR.HOJA_CONFIG);
  const datos = h.getDataRange().getValues();
  const par = {};
  datos.forEach(function (r) { if (r[0]) par[normalizar_(r[0]).trim()] = r[1]; });
  const val = function (etiqueta, def) { const v = par[normalizar_(etiqueta).trim()]; return (v === '' || v == null) ? def : v; };
  const lista = function (col) {
    const out = [];
    for (let i = 1; i < datos.length; i++) { const v = String(datos[i][col] == null ? '' : datos[i][col]).trim(); if (v) out.push(v); }
    return out;
  };
  const si = function (v) { return /^(si|sí|s|yes|true|1)$/i.test(String(v).trim()); };
  const hora = Math.max(0, Math.min(23, parseInt(val('Hora de ejecución diaria (0 a 23)', 7), 10) || 7));
  return {
    correo: String(val('Correo para el resumen', '')).trim(),
    hora: hora,
    avisarSinNovedades: si(val('Avisar aunque no haya novedades (SI/NO)', 'SI')),
    maxFichas: Math.max(0, parseInt(val('Máximo de fichas a completar por ejecución', 40), 10) || 0),
    fichasDescripcion: Math.max(0, parseInt(val('Fichas extra para buscar en la descripción (0 = no)', 0), 10) || 0),
    claves: lista(4), excluir: lista(5), regiones: lista(6), organismos: lista(7)
  };
}

function prepararHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(RADAR.HOJA_CONFIG);
  if (!h) {
    h = ss.insertSheet(RADAR.HOJA_CONFIG);
    h.getRange(1, 1, 6, 3).setValues([
      ['Parámetro', 'Valor', 'Ayuda'],
      ['Correo para el resumen', '', 'Dirección que recibe el resumen diario y los avisos de falla.'],
      ['Hora de ejecución diaria (0 a 23)', 7, 'Hora de Chile. Después de cambiarla, usa el menú 4 otra vez.'],
      ['Avisar aunque no haya novedades (SI/NO)', 'SI', 'SI permite distinguir «sin novedades» de «no funcionó».'],
      ['Máximo de fichas a completar por ejecución', 40, 'Cada ficha es una consulta adicional a la API.'],
      ['Fichas extra para buscar en la descripción (0 = no)', 0, 'Opcional y lento: revisa la descripción de licitaciones que no coincidieron por nombre.']]);
    h.getRange(1, 5, 1, 4).setValues([['Palabras clave', 'Excluir si contiene', 'Regiones (opcional)', 'Códigos de organismo (opcional)']]);
    h.getRange(1, 1, 1, 8).setFontWeight('bold');
  }
  h = ss.getSheetByName(RADAR.HOJA_OPORT);
  if (!h) { h = ss.insertSheet(RADAR.HOJA_OPORT); h.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold'); h.setFrozenRows(1); }
  h = ss.getSheetByName(RADAR.HOJA_REG);
  if (!h) {
    h = ss.insertSheet(RADAR.HOJA_REG);
    h.getRange(1, 1, 1, 9).setValues([['Fecha', 'Nivel', 'Mensaje', 'Activas recibidas', 'Coincidencias', 'Nuevas', 'Fichas consultadas', 'Llamadas API hoy', 'Duración (s)']]).setFontWeight('bold');
    h.setFrozenRows(1);
  }
}

function hojaOport_() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RADAR.HOJA_OPORT); }

function hojaRevisadas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(RADAR.HOJA_REVISADAS);
  if (!h) { h = ss.insertSheet(RADAR.HOJA_REVISADAS); h.hideSheet(); }
  return h;
}

function registrar_(nivel, mensaje, st, t0) {
  st = st || {};
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RADAR.HOJA_REG);
  const fila = [new Date(), nivel, ocultarTicket_(mensaje), st.activas || 0, st.coincidencias || 0, st.nuevas || 0,
    st.fichas || 0, llamadasHoy_(), t0 ? Math.round((Date.now() - t0) / 1000) : ''];
  if (h) h.appendRow(fila);
  console.log(nivel + ' · ' + ocultarTicket_(mensaje));
}

// ---------------------------------------------------------------- utilidades
function ocultarTicket_(s) { return String(s).replace(/ticket=[^&\s]+/gi, 'ticket=***').replace(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi, '***'); }

/** «2026-11-19T15:00:00» (hora local informada por la API) → Date en hora de Chile, sin conversiones de zona. */
function fechaLocal_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

function fmtFecha_(d) { return (d instanceof Date) ? Utilities.formatDate(d, RADAR.ZONA, 'dd-MM-yyyy HH:mm') : String(d || ''); }
function ahoraTexto_() { return Utilities.formatDate(new Date(), RADAR.ZONA, 'dd-MM-yyyy HH:mm'); }
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
