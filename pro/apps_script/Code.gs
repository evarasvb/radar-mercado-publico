/**
 * RADAR MP PRO · Inteligencia de oportunidades con la API de Mercado Público
 * Bonus descargable del libro «Véndele al Estado y No Mueras en el Intento», Volumen 7, capítulo 6.
 * Autor: Enrique Evaristo Varas Bahamonde · FirmaVB · Versión Pro 2.0 (noviembre de 2026)
 *
 * Qué agrega sobre la versión básica del capítulo:
 *  - Palabras clave con peso, exclusiones, regiones, montos, organismos favoritos y rubros UNSPSC.
 *  - Descarga incremental de licitaciones activas + ficha completa de cada nueva, en lotes reanudables
 *    (respeta el corte de 6 minutos de Apps Script con continuación automática por activadores).
 *  - Puntaje de calce 0-100 explicado («Motivos»), pipeline comercial con etapas, historial de cambios.
 *  - Inteligencia de competencia: órdenes de compra de tus organismos favoritos (quién vende y a qué precio)
 *    y adjudicaciones de las licitaciones que sigues.
 *  - Dashboard con KPIs, gráficos nativos, controles de filtro, QUERY/FILTER/SPARKLINE y segmentadores.
 *  - Correo diario HTML con las mejores oportunidades y los cierres próximos.
 *  - Hojas «PBI_…» listas para publicar como CSV y conectar desde Power BI o Excel (Power Query).
 *
 * Fuentes verificadas el 18-11-2026: https://www.chilecompra.cl/api/ (licitaciones.json y ordenesdecompra.json).
 * Límites oficiales: 10.000 solicitudes diarias por ticket y SIN peticiones simultáneas (HTTP 429, código 10500).
 * Descargas masivas: ChileCompra recomienda hacerlas entre las 22:00 y las 07:00.
 *
 * Tu ticket NO va en la planilla: se guarda en las Propiedades del script (menú Radar MP Pro › Guardar mi ticket).
 * Las columnas Etapa, Responsable, Próxima acción, Fecha próxima acción y Notas son de tu equipo:
 * el script solo escribe «Nueva» al crear la fila y nunca más las toca.
 */

const RADAR = {
  VERSION: '2.0',
  API: 'https://api.mercadopublico.cl/servicios/v1/publico/',
  FICHA_URL: 'https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=',
  ZONA: 'America/Santiago',
  PROP_TICKET: 'MP_TICKET',
  PROP_ESTADO: 'RADAR_ESTADO',
  PROP_ULTIMO_OK: 'ULTIMA_CONSULTA_OK',
  PROP_ULTIMO_CORREO: 'ULTIMO_CORREO',
  PAUSA_MS: 1500,                 // separación mínima entre consultas (la API rechaza simultáneas)
  REINTENTOS: 4,
  ESPERAS_MS: [10000, 30000, 60000],
  TOPE_DIARIO_PROPIO: 9000,       // margen bajo el límite oficial de 10.000
  TIEMPO_MAX_MS: 4.5 * 60 * 1000, // Apps Script corta a los 6 minutos: se guarda el avance antes
  MARGEN_LLAMADA_MS: 75 * 1000,   // no se inicia una consulta si quedan menos de 75 s de presupuesto
  MAX_CONTINUACIONES_DIA: 18,     // 18 lotes × 4,5 min ≈ 81 min: bajo la cuota de 90 min/día de activadores (cuentas gmail.com)
  CACHE_SEG: 6 * 60 * 60
};

const HOJAS = {
  INICIO: 'Inicio', CONFIG: 'Configuración', LIC: 'Licitaciones', ITEMS: 'Ítems', COMP: 'Competencia',
  HIST: 'Historial', DASH: 'Dashboard', REG: 'Registro', PBI_LIC: 'PBI_Licitaciones', PBI_ITEMS: 'PBI_Items',
  PBI_COMP: 'PBI_Competencia', AUX: '_dash', COLA: '_cola', VISTAS: '_vistas', HECHOS: '_hechos'
};

const ESTADOS = { 5: 'Publicada', 6: 'Cerrada', 7: 'Desierta', 8: 'Adjudicada', 18: 'Revocada', 19: 'Suspendida' };
const ETAPAS = ['Nueva', 'Revisar', 'Postular', 'Postulada', 'Descartada', 'Ganada', 'Perdida'];
const COLORES_ETAPA = { Nueva: '#e8f0fe', Revisar: '#fff4c2', Postular: '#ffe0b2', Postulada: '#d1c4e9', Descartada: '#eeeeee', Ganada: '#c8e6c9', Perdida: '#ffcdd2' };

// Columnas de «Licitaciones». Las 28 primeras las escribe el script; las 5 últimas son del equipo.
const LIC_COLS = ['Código', 'Nombre', 'Puntaje', 'Motivos', 'Estado MP', 'Tipo', 'Organismo', 'Cód. organismo',
  'Unidad de compra', 'Región', 'Comuna', 'Monto estimado', 'Moneda', 'Publicación', 'Cierre', 'Días al cierre',
  'Fin de preguntas', 'Adjudicación estimada', 'Rubro principal', 'UNSPSC principal', 'N° ítems', 'Ítems (resumen)',
  'Descripción', 'Ficha', 'Detectada', 'Última vez activa', 'Detalle', 'Resultado adjudicación',
  'Etapa', 'Responsable', 'Próxima acción', 'Fecha próxima acción', 'Notas'];
const L = {}; LIC_COLS.forEach(function (n, i) { L[n] = i; });
const LIC_SCRIPT = 28;
const ITEM_COLS = ['Código licitación', 'Correlativo', 'Código producto', 'Código categoría', 'Categoría', 'Producto',
  'Descripción', 'Unidad', 'Cantidad', 'Proveedor adjudicado', 'RUT adjudicado', 'Cantidad adjudicada', 'Monto unitario adjudicado'];
const COMP_COLS = ['Fuente', 'Fecha', 'Código', 'Nombre', 'Organismo', 'Cód. organismo', 'Región', 'Proveedor', 'RUT proveedor',
  'Producto', 'UNSPSC', 'Cantidad', 'Precio unitario', 'Total línea', 'Moneda', 'Licitación relacionada', 'Estado'];
const HIST_COLS = ['Fecha', 'Código', 'Evento', 'Antes', 'Después', 'Detalle'];
const REG_COLS = ['Fecha', 'Nivel', 'Fase', 'Mensaje', 'Activas', 'Candidatas', 'Fichas', 'Nuevas', 'Líneas competencia', 'Llamadas API hoy', 'Duración (s)'];

// ================================================================ menú e instalador
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Radar MP Pro')
    .addItem('★ Instalar o reparar (un clic)', 'instalarRadar')
    .addItem('Guardar mi ticket', 'guardarTicket')
    .addItem('Probar conexión', 'probarConexion')
    .addSeparator()
    .addItem('Ejecutar ahora', 'ejecutarRadar')
    .addItem('Actualizar competencia ahora', 'actualizarCompetencia')
    .addItem('Reconstruir dashboard', 'construirDashboard')
    .addItem('Enviar correo de prueba', 'enviarCorreoPrueba')
    .addItem('Preparar hojas para Power BI', 'exportarPowerBI')
    .addSeparator()
    .addItem('Ver estado del ciclo', 'verEstado')
    .addItem('Activar ejecución diaria', 'activarEjecucionDiaria')
    .addItem('Desactivar todo (activadores)', 'desactivarTodo')
    .addToUi();
}

/** Instalador de un clic: crea hojas, formatos, validaciones, dashboard y activadores. Se puede repetir sin perder datos. */
function instalarRadar() {
  prepararHojas();
  construirDashboard();
  activarEjecucionDiaria(true);
  const ticket = PropertiesService.getScriptProperties().getProperty(RADAR.PROP_TICKET);
  registrar_('OK', 'instalación', 'Instalación o reparación completa (versión ' + RADAR.VERSION + ')', {});
  try {
    SpreadsheetApp.getUi().alert('Radar MP Pro instalado.\n\n' +
      (ticket ? '' : '1) Guarda tu ticket (menú › Guardar mi ticket).\n') +
      '2) Completa «Configuración» (palabras clave con peso, regiones, montos, organismos).\n' +
      '3) Usa «Ejecutar ahora». La primera vez puede tardar varios lotes: el radar sigue solo cada minuto hasta terminar.');
  } catch (e) { /* sin interfaz (activador) */ }
}

function guardarTicket() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Ticket de la API de Mercado Público',
    'Pega tu ticket. Se guarda en las Propiedades del script, nunca en la planilla.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const t = String(r.getResponseText() || '').trim();
  if (!/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(t)) {
    ui.alert('Ese texto no tiene el formato de un ticket (8-4-4-4-12 caracteres). No se guardó nada.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(RADAR.PROP_TICKET, t);
  ui.alert('Ticket guardado. Ahora usa «Probar conexión».');
}

function probarConexion() {
  prepararHojas();
  const ticket = PropertiesService.getScriptProperties().getProperty(RADAR.PROP_TICKET);
  const ui = SpreadsheetApp.getUi();
  if (!ticket) { ui.alert('Primero guarda tu ticket.'); return; }
  const ctx = contexto_();
  const r = consultarApi_('licitaciones.json', { estado: 'activas' }, ticket, ctx);
  if (r.ok) {
    registrar_('OK', 'prueba', 'Conexión correcta', { activas: r.data.Listado.length }, ctx.t0);
    ui.alert('Conexión correcta. La API informó ' + r.data.Listado.length + ' licitaciones activas.');
  } else {
    registrar_('ERROR', 'prueba', 'Prueba de conexión fallida: ' + r.error, {}, ctx.t0);
    ui.alert('La prueba falló: ' + r.error + '\nEsto NO significa que no haya licitaciones. Revisa «Registro».');
  }
}

function activarEjecucionDiaria(silencioso) {
  borrarActivadores_(['ejecutarRadar']);
  const cfg = leerConfig_();
  ScriptApp.newTrigger('ejecutarRadar').timeBased().everyDays(1).atHour(cfg.hora).inTimezone(RADAR.ZONA).create();
  registrar_('OK', 'activadores', 'Ejecución diaria activada cerca de las ' + cfg.hora + ':00 (hora de Chile)', {});
  if (silencioso !== true) { try { SpreadsheetApp.getUi().alert('Listo. El radar correrá cada día cerca de las ' + cfg.hora + ':00.'); } catch (e) {} }
}

function desactivarTodo() {
  borrarActivadores_(['ejecutarRadar', 'continuarRadar']);
  registrar_('OK', 'activadores', 'Se desactivaron la ejecución diaria y las continuaciones', {});
}

function borrarActivadores_(nombres) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (nombres.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

function verEstado() {
  const e = leerEstado_();
  const msj = e ? ('Ciclo del ' + e.dia + ' · fase: ' + e.fase + ' · fichas en cola: ' + (e.pendientes || 0) +
    ' · continuaciones: ' + (e.continuaciones || 0)) : 'No hay un ciclo en curso.';
  try { SpreadsheetApp.getUi().alert(msj + '\nLlamadas a la API hoy: ' + llamadasHoy_()); } catch (err) { console.log(msj); }
}

// ================================================================ ciclo principal (reanudable)
/** Activador diario: inicia un ciclo nuevo. */
function ejecutarRadar() { correrCiclo_(true); }
/** Activador de continuación (una vez, al minuto): retoma el ciclo donde quedó. */
function continuarRadar() { borrarActivadores_(['continuarRadar']); correrCiclo_(false); }

/** Solo la fase de competencia, a pedido. */
function actualizarCompetencia() {
  guardarEstado_({ dia: hoyTexto_(), fase: 'COMPETENCIA', continuaciones: 0, st: {}, soloCompetencia: true });
  correrCiclo_(false);
}

function correrCiclo_(nuevo) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { registrar_('ADVERTENCIA', 'ciclo', 'Otra ejecución estaba en curso; esta se omitió', {}); return; }
  const ctx = contexto_();
  let cfg = null, est = null;
  try {
    prepararHojas();
    cfg = leerConfig_();
    ctx.ticket = PropertiesService.getScriptProperties().getProperty(RADAR.PROP_TICKET);
    if (!ctx.ticket) { fallar_(cfg, 'inicio', 'No hay ticket guardado (menú › Guardar mi ticket).', {}, ctx.t0); return; }
    if (!cfg.claves.length && !cfg.organismos.length && !cfg.rubros.length) {
      fallar_(cfg, 'inicio', 'Configuración sin palabras clave, organismos ni rubros: no hay nada que buscar.', {}, ctx.t0); return;
    }
    est = leerEstado_();
    if (nuevo || !est || est.fase === 'FIN') est = { dia: hoyTexto_(), fase: 'ACTIVAS', continuaciones: 0, st: {} };
    else est.continuaciones = (est.continuaciones || 0) + 1;
    if (est.continuaciones > RADAR.MAX_CONTINUACIONES_DIA) {
      registrar_('ADVERTENCIA', est.fase, 'Máximo de continuaciones alcanzado; se retoma en la próxima ejecución diaria', est.st, ctx.t0);
      est.fase = 'FIN'; guardarEstado_(est); return;
    }
    const fases = est.soloCompetencia ? ['COMPETENCIA', 'CIERRE'] : ['ACTIVAS', 'FICHAS', 'SEGUIMIENTO', 'COMPETENCIA', 'CIERRE'];
    while (est.fase !== 'FIN') {
      let terminado;
      if (est.fase === 'ACTIVAS') terminado = faseActivas_(cfg, ctx, est);
      else if (est.fase === 'FICHAS') terminado = faseFichas_(cfg, ctx, est);
      else if (est.fase === 'SEGUIMIENTO') terminado = faseSeguimiento_(cfg, ctx, est);
      else if (est.fase === 'COMPETENCIA') terminado = faseCompetencia_(cfg, ctx, est);
      else if (est.fase === 'CIERRE') terminado = faseCierre_(cfg, ctx, est);
      else terminado = true;
      if (terminado === 'ERROR') { est.fase = 'FIN'; break; }
      if (!terminado) { // se acabó el presupuesto de tiempo o el lote: guarda y programa la continuación
        guardarEstado_(est);
        ScriptApp.newTrigger('continuarRadar').timeBased().after(60 * 1000).create();
        registrar_('INFO', est.fase, 'Lote terminado; continúa en 1 minuto (continuación ' + est.continuaciones + ')', est.st, ctx.t0);
        return;
      }
      const i = fases.indexOf(est.fase);
      est.fase = (i >= 0 && i < fases.length - 1) ? fases[i + 1] : 'FIN';
    }
    guardarEstado_(est);
  } catch (e) {
    fallar_(cfg, est ? est.fase : 'ciclo', 'Error inesperado: ' + ocultarTicket_(String(e && e.message || e)), est ? est.st : {}, ctx.t0);
    if (est) { est.fase = 'FIN'; guardarEstado_(est); }
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- fase 1: activas
function faseActivas_(cfg, ctx, est) {
  const st = est.st;
  const r = consultarApi_('licitaciones.json', { estado: 'activas' }, ctx.ticket, ctx);
  if (!r.ok) return fallar_(cfg, 'ACTIVAS', 'No se pudo consultar la API: ' + r.error, st, ctx.t0);
  const lista = r.data.Listado;
  st.activas = lista.length;
  if (!lista.length) return fallar_(cfg, 'ACTIVAS', 'La API respondió sin licitaciones activas. Es improbable: revisa manualmente antes de concluir algo.', st, ctx.t0);
  PropertiesService.getScriptProperties().setProperty(RADAR.PROP_ULTIMO_OK, ahoraTexto_());

  // Organismos favoritos: una consulta por organismo para saber cuáles activas son suyas.
  const deFavoritos = {};
  for (let i = 0; i < cfg.organismos.length; i++) {
    if (!tiempoParaLlamar_(ctx)) break;
    const ro = consultarApi_('licitaciones.json', { estado: 'activas', CodigoOrganismo: cfg.organismos[i].codigo }, ctx.ticket, ctx);
    if (ro.ok) ro.data.Listado.forEach(function (l) { deFavoritos[String(l.CodigoExterno).trim()] = true; });
    else registrar_('ADVERTENCIA', 'ACTIVAS', 'No se pudo listar el organismo ' + cfg.organismos[i].codigo + ': ' + ro.error, st);
  }

  const hoja = hoja_(HOJAS.LIC);
  const existentes = indiceCodigos_(hoja);
  const vistas = indiceVistas_();
  const activasSet = {}, cola = [];
  lista.forEach(function (lic) {
    const cod = String(lic.CodigoExterno || '').trim();
    if (!cod) return;
    activasSet[cod] = lic;
    if (existentes[cod] || vistas[cod]) return;
    if (coincide_(lic.Nombre, cfg.excluir)) return;
    const nombreCalza = calce_(lic.Nombre, cfg.claves).length > 0;
    if (nombreCalza || deFavoritos[cod] || cfg.amplia) {
      cola.push([cod, nombreCalza ? 'nombre' : (deFavoritos[cod] ? 'organismo favorito' : 'búsqueda amplia'), lic.Nombre || '', new Date()]);
    }
  });
  // Prioridad: primero las que calzan por nombre, luego favoritos, luego búsqueda amplia.
  const orden = { 'nombre': 0, 'organismo favorito': 1, 'búsqueda amplia': 2 };
  cola.sort(function (a, b) { return orden[a[1]] - orden[b[1]]; });
  escribirCola_(cola);
  st.candidatas = cola.length;
  est.pendientes = cola.length;
  actualizarDesdeActivas_(hoja, activasSet);
  registrar_('OK', 'ACTIVAS', lista.length + ' activas; ' + cola.length + ' fichas nuevas en cola', st, ctx.t0);
  return true;
}

function escribirCola_(filas) {
  const hc = hoja_(HOJAS.COLA);
  hc.clearContents();
  hc.getRange(1, 1, 1, 4).setValues([['Código', 'Origen', 'Nombre', 'Encolada']]);
  if (filas.length) hc.getRange(2, 1, filas.length, 4).setValues(filas);
}

/** Actualiza cierre y estado de las filas existentes con lo que trae la lista de activas, y anota el historial. */
function actualizarDesdeActivas_(hoja, activasSet) {
  const n = hoja.getLastRow() - 1;
  if (n < 1) return;
  const rango = hoja.getRange(2, 1, n, LIC_SCRIPT);
  const filas = rango.getValues();
  const hist = [], ahora = new Date();
  filas.forEach(function (f) {
    const cod = String(f[L['Código']]).trim();
    if (!cod) return;
    const lic = activasSet[cod];
    if (lic) {
      f[L['Última vez activa']] = ahora;
      const cierre = fechaLocal_(lic.FechaCierre);
      if (cierre && f[L['Cierre']] instanceof Date && cierre.getTime() !== f[L['Cierre']].getTime()) {
        hist.push([ahora, cod, 'Cambio de cierre', fmtFecha_(f[L['Cierre']]), fmtFecha_(cierre), 'Detectado en la lista de activas']);
        f[L['Cierre']] = cierre;
      } else if (cierre && !(f[L['Cierre']] instanceof Date)) f[L['Cierre']] = cierre;
      const estado = ESTADOS[lic.CodigoEstado];
      if (estado && estado !== f[L['Estado MP']]) {
        hist.push([ahora, cod, 'Cambio de estado MP', f[L['Estado MP']], estado, '']);
        f[L['Estado MP']] = estado;
      }
    } else if (f[L['Estado MP']] === 'Publicada') {
      hist.push([ahora, cod, 'Dejó de estar activa', 'Publicada', 'No activa', 'Ya no aparece en la lista de activas (cerrada, suspendida o revocada)']);
      f[L['Estado MP']] = 'No activa';
    }
    f[L['Días al cierre']] = diasAl_(f[L['Cierre']]);
  });
  rango.setValues(filas);
  agregarHistorial_(hist);
}

// ---------------------------------------------------------------- fase 2: fichas (detalle completo)
function faseFichas_(cfg, ctx, est) {
  const st = est.st;
  const hc = hoja_(HOJAS.COLA);
  const n = hc.getLastRow() - 1;
  if (n < 1) { est.pendientes = 0; return true; }
  const cola = hc.getRange(2, 1, n, 4).getValues();
  const hoja = hoja_(HOJAS.LIC);
  const existentes = indiceCodigos_(hoja);
  const nuevas = [], items = [], vistas = [], hist = [], reintentar = [];
  let i = 0, fichasHoy = (est.dia === hoyTexto_()) ? Number(est.fichasDia || 0) : 0;
  for (; i < cola.length; i++) {
    if (!tiempoParaLlamar_(ctx) || lote_(ctx) >= cfg.fichasPorLote) break;
    if (fichasHoy >= cfg.maxFichasDia) {
      registrar_('ADVERTENCIA', 'FICHAS', 'Tope diario de fichas (' + cfg.maxFichasDia + ') alcanzado; el resto queda en cola para mañana', st);
      est.topeDiario = true; break;
    }
    const cod = String(cola[i][0]).trim();
    if (!cod || existentes[cod]) continue;
    const r = consultarFicha_(cod, ctx);
    if (r.diferido) break;           // sin tiempo para reintentar: queda en cola
    if (!r.cache) { ctx.lote++; fichasHoy++; }
    st.fichas = (st.fichas || 0) + 1;
    if (!r.ok) { registrar_('ADVERTENCIA', 'FICHAS', 'Ficha ' + cod + ': ' + r.error + ' (se reintentará)', st); reintentar.push(cola[i]); continue; }
    const ev = evaluar_(r.lic, cfg);
    vistas.push([cod, new Date(), ev.puntaje, cola[i][1]]);
    if (ev.excluida) continue;
    if (cola[i][1] === 'búsqueda amplia' && ev.puntaje < cfg.puntajeMin) continue; // en búsqueda amplia solo entra lo que calza
    nuevas.push(filaDesdeFicha_(r.lic, ev));
    itemsDesdeFicha_(r.lic).forEach(function (it) { items.push(it); });
    hist.push([new Date(), cod, 'Detectada', '', 'Nueva', 'Puntaje ' + ev.puntaje + ' · origen: ' + cola[i][1]]);
    existentes[cod] = true;
  }
  est.fichasDia = fichasHoy;
  if (nuevas.length) {
    const ini = hoja.getLastRow() + 1;
    hoja.getRange(ini, 1, nuevas.length, LIC_SCRIPT).setValues(nuevas.map(function (f) { return f.slice(0, LIC_SCRIPT); }));
    hoja.getRange(ini, L['Etapa'] + 1, nuevas.length, 1).setValues(nuevas.map(function () { return ['Nueva']; }));
    st.nuevas = (st.nuevas || 0) + nuevas.length;
  }
  agregarFilas_(HOJAS.ITEMS, items, ITEM_COLS.length);
  agregarFilas_(HOJAS.VISTAS, vistas, 4);
  agregarHistorial_(hist);
  const resto = cola.slice(i).concat(reintentar);
  escribirCola_(resto);
  est.pendientes = resto.length;
  if (est.topeDiario) return true;                       // sigue con las otras fases; la cola espera a mañana
  if (resto.length && reintentar.length === resto.length && i >= cola.length) return true; // solo quedan fallidas: mañana
  return resto.length === 0;
}

/** Puntaje de calce 0-100 con motivos legibles. */
function evaluar_(lic, cfg) {
  const comp = lic.Comprador || {};
  const items = (lic.Items && lic.Items.Listado) || [];
  const textoItems = items.map(function (it) { return (it.NombreProducto || '') + ' ' + (it.Descripcion || '') + ' ' + (it.Categoria || ''); }).join(' | ');
  const textoTodo = (lic.Nombre || '') + ' ' + (lic.Descripcion || '') + ' ' + textoItems;
  const motivos = [];
  const excl = coincide_(lic.Nombre + ' ' + (lic.Descripcion || ''), cfg.excluir);
  if (excl) return { puntaje: 0, motivos: 'Excluida por «' + excl + '»', excluida: true };
  let puntaje = 0;
  cfg.claves.forEach(function (k) {
    let mult = 0, donde = '';
    if (calce_(lic.Nombre, [k]).length) { mult = 3; donde = 'nombre'; }
    else if (calce_(lic.Descripcion, [k]).length) { mult = 2; donde = 'descripción'; }
    else if (calce_(textoItems, [k]).length) { mult = 1.5; donde = 'ítems'; }
    if (mult) { const p = Math.round(k.peso * mult * 4); puntaje += p; motivos.push(k.palabra + ' en ' + donde + ' (+' + p + ')'); }
  });
  cfg.rubros.forEach(function (rb) {
    const hit = items.some(function (it) { return String(it.CodigoProducto || '').indexOf(rb.prefijo) === 0 || String(it.CodigoCategoria || '').indexOf(rb.prefijo) === 0; });
    if (hit) { puntaje += rb.peso * 6; motivos.push('rubro UNSPSC ' + rb.prefijo + ' (+' + rb.peso * 6 + ')'); }
  });
  if (cfg.regiones.length) {
    const reg = normalizar_(comp.RegionUnidad);
    if (cfg.regiones.some(function (x) { return reg.indexOf(normalizar_(x).trim()) >= 0; })) { puntaje += 10; motivos.push('región de interés (+10)'); }
    else { puntaje -= 20; motivos.push('fuera de tus regiones (−20)'); }
  }
  if (cfg.organismos.some(function (o) { return String(o.codigo) === String(comp.CodigoOrganismo || '').trim(); })) { puntaje += 15; motivos.push('organismo favorito (+15)'); }
  const monto = montoVisible_(lic);
  if (monto !== '' && (cfg.montoMin || cfg.montoMax)) {
    if ((cfg.montoMin && monto < cfg.montoMin) || (cfg.montoMax && monto > cfg.montoMax)) { puntaje -= 15; motivos.push('monto fuera de rango (−15)'); }
    else { puntaje += 5; motivos.push('monto en rango (+5)'); }
  }
  const dias = diasAl_(fechaLocal_((lic.Fechas && lic.Fechas.FechaCierre) || lic.FechaCierre));
  if (dias !== '' && dias < cfg.diasMinCierre) { puntaje -= 30; motivos.push('cierra en menos de ' + cfg.diasMinCierre + ' días (−30)'); }
  return { puntaje: Math.max(0, Math.min(100, Math.round(puntaje))), motivos: motivos.join('; ') || 'sin calce directo', excluida: false };
}

/** El monto solo se usa si la ficha lo declara visible (VisibilidadMonto = 1). */
function montoVisible_(lic) {
  return (Number(lic.VisibilidadMonto) === 1 && lic.MontoEstimado != null && lic.MontoEstimado !== '') ? Number(lic.MontoEstimado) : '';
}

function filaDesdeFicha_(lic, ev) {
  const f = new Array(LIC_COLS.length).fill('');
  const comp = lic.Comprador || {}, fe = lic.Fechas || {};
  const items = (lic.Items && lic.Items.Listado) || [];
  const cod = String(lic.CodigoExterno).trim();
  f[L['Código']] = cod;
  f[L['Nombre']] = lic.Nombre || '';
  f[L['Puntaje']] = ev.puntaje;
  f[L['Motivos']] = ev.motivos;
  f[L['Estado MP']] = lic.Estado || ESTADOS[lic.CodigoEstado] || '';
  f[L['Tipo']] = lic.Tipo || '';
  f[L['Organismo']] = String(comp.NombreOrganismo || '').trim();
  f[L['Cód. organismo']] = String(comp.CodigoOrganismo || '');
  f[L['Unidad de compra']] = String(comp.NombreUnidad || '').trim();
  f[L['Región']] = String(comp.RegionUnidad || '').trim();
  f[L['Comuna']] = String(comp.ComunaUnidad || '').trim();
  f[L['Monto estimado']] = montoVisible_(lic);
  f[L['Moneda']] = lic.Moneda || '';
  f[L['Publicación']] = fechaLocal_(fe.FechaPublicacion);
  f[L['Cierre']] = fechaLocal_(fe.FechaCierre || lic.FechaCierre);
  f[L['Días al cierre']] = diasAl_(f[L['Cierre']]);
  f[L['Fin de preguntas']] = fechaLocal_(fe.FechaFinal);
  f[L['Adjudicación estimada']] = fechaLocal_(fe.FechaAdjudicacion || fe.FechaEstimadaAdjudicacion);
  const rubro = rubroPrincipal_(items);
  f[L['Rubro principal']] = rubro.nombre;
  f[L['UNSPSC principal']] = rubro.codigo;
  f[L['N° ítems']] = items.length;
  f[L['Ítems (resumen)']] = items.slice(0, 5).map(function (it) { return (it.NombreProducto || '') + ' ×' + (it.Cantidad || ''); }).join(' | ').slice(0, 400);
  f[L['Descripción']] = String(lic.Descripcion || '').replace(/\s+/g, ' ').slice(0, 500);
  f[L['Ficha']] = RADAR.FICHA_URL + encodeURIComponent(cod);
  f[L['Detectada']] = new Date();
  f[L['Última vez activa']] = new Date();
  f[L['Detalle']] = 'ok';
  f[L['Resultado adjudicación']] = resultadoAdjudicacion_(lic, '');
  return f;
}

/** Rubro más frecuente entre los ítems (último nivel de la categoría UNSPSC). */
function rubroPrincipal_(items) {
  const cuenta = {};
  items.forEach(function (it) {
    const k = String(it.CodigoCategoria || '');
    if (!k) return;
    if (!cuenta[k]) cuenta[k] = { n: 0, nombre: String(it.Categoria || '').split('/').pop().trim() };
    cuenta[k].n++;
  });
  let mejor = { codigo: '', nombre: '', n: 0 };
  Object.keys(cuenta).forEach(function (k) { if (cuenta[k].n > mejor.n) mejor = { codigo: k, nombre: cuenta[k].nombre, n: cuenta[k].n }; });
  return mejor;
}

function itemsDesdeFicha_(lic) {
  const cod = String(lic.CodigoExterno).trim();
  return ((lic.Items && lic.Items.Listado) || []).map(function (it) {
    const a = it.Adjudicacion || {};
    return [cod, it.Correlativo || '', String(it.CodigoProducto || ''), String(it.CodigoCategoria || ''),
      String(it.Categoria || '').split('/').pop().trim(), it.NombreProducto || '', String(it.Descripcion || '').slice(0, 300),
      it.UnidadMedida || '', Number(it.Cantidad) || '', a.NombreProveedor || '', a.RutProveedor || '',
      a.Cantidad != null ? Number(a.Cantidad) : '', a.MontoUnitario != null ? Number(a.MontoUnitario) : ''];
  });
}

function resultadoAdjudicacion_(lic, rutPropio) {
  const items = (lic.Items && lic.Items.Listado) || [];
  const ganadores = {};
  items.forEach(function (it) { const a = it.Adjudicacion; if (a && a.NombreProveedor) ganadores[a.RutProveedor || a.NombreProveedor] = a.NombreProveedor; });
  const ruts = Object.keys(ganadores);
  if (!ruts.length) return (lic.CodigoEstado === 7 || lic.Estado === 'Desierta') ? 'Desierta' : '';
  const propio = rutPropio && ruts.some(function (r) { return normRut_(r) === normRut_(rutPropio); });
  const nOf = lic.Adjudicacion && lic.Adjudicacion.NumeroOferentes;
  return (propio ? 'GANADA por tu empresa · ' : 'Adjudicada a ') + ruts.map(function (r) { return ganadores[r]; }).join(', ').slice(0, 200) +
    (nOf ? ' (' + nOf + ' oferentes)' : '');
}

// ---------------------------------------------------------------- fase 3: seguimiento de adjudicaciones
function faseSeguimiento_(cfg, ctx, est) {
  if (!cfg.seguimiento) return true;
  const hoja = hoja_(HOJAS.LIC);
  const n = hoja.getLastRow() - 1;
  if (n < 1) return true;
  const filas = hoja.getRange(2, 1, n, LIC_COLS.length).getValues();
  const hist = [], hecho = est.seguidos || {};
  let cambios = false, completo = true;
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    if (['Postular', 'Postulada', 'Ganada', 'Perdida'].indexOf(String(f[L['Etapa']])) < 0) continue;
    const res0 = String(f[L['Resultado adjudicación']] || '');
    if (res0.indexOf('Adjudicada') === 0 || res0.indexOf('GANADA') === 0 || res0 === 'Desierta') continue;
    const cierre = f[L['Cierre']];
    if (!(cierre instanceof Date) || cierre.getTime() > Date.now()) continue; // aún no cierra
    const cod = String(f[L['Código']]);
    if (hecho[cod]) continue;
    if (!tiempoParaLlamar_(ctx)) { completo = false; break; }
    const r = consultarFicha_(cod, ctx);
    if (r.diferido) { completo = false; break; }
    hecho[cod] = true;
    if (!r.ok) continue;
    const antes = f[L['Estado MP']];
    f[L['Estado MP']] = r.lic.Estado || ESTADOS[r.lic.CodigoEstado] || antes;
    const res = resultadoAdjudicacion_(r.lic, cfg.rutPropio);
    if (res && res !== res0) {
      hist.push([new Date(), cod, 'Resultado de adjudicación', res0, res, 'Sugerencia: actualiza la Etapa a Ganada o Perdida']);
      f[L['Resultado adjudicación']] = res;
      agregarFilas_(HOJAS.COMP, lineasAdjudicacion_(r.lic), COMP_COLS.length); // también alimenta Competencia
    }
    if (antes !== f[L['Estado MP']]) hist.push([new Date(), cod, 'Cambio de estado MP', antes, f[L['Estado MP']], 'Seguimiento']);
    cambios = true;
  }
  est.seguidos = hecho;
  if (cambios) hoja.getRange(2, 1, n, LIC_SCRIPT).setValues(filas.map(function (f) { return f.slice(0, LIC_SCRIPT); }));
  agregarHistorial_(hist);
  return completo;
}

function lineasAdjudicacion_(lic) {
  const comp = lic.Comprador || {};
  const fecha = fechaLocal_((lic.Adjudicacion && lic.Adjudicacion.Fecha) || (lic.Fechas && lic.Fechas.FechaAdjudicacion));
  return ((lic.Items && lic.Items.Listado) || []).filter(function (it) { return it.Adjudicacion && it.Adjudicacion.NombreProveedor; }).map(function (it) {
    const a = it.Adjudicacion, cant = Number(a.Cantidad) || 0, pu = Number(a.MontoUnitario) || 0;
    return ['Adjudicación', fecha, String(lic.CodigoExterno), lic.Nombre || '', String(comp.NombreOrganismo || '').trim(), String(comp.CodigoOrganismo || ''),
      String(comp.RegionUnidad || '').trim(), a.NombreProveedor, a.RutProveedor || '', it.NombreProducto || '', String(it.CodigoProducto || ''),
      cant, pu, cant * pu, lic.Moneda || '', String(lic.CodigoExterno), lic.Estado || ''];
  });
}

// ---------------------------------------------------------------- fase 4: competencia (órdenes de compra)
/**
 * Para cada organismo favorito y cada día de la ventana configurada, lista sus órdenes de compra
 * (ordenesdecompra.json?fecha=ddmmaaaa&CodigoOrganismo=…) y lee el detalle de cada OC: proveedor, ítems y precios.
 * Si definiste rubros UNSPSC, solo guarda las líneas de esos rubros. Cada día y cada OC se procesan una sola vez (_hechos).
 */
function faseCompetencia_(cfg, ctx, est) {
  const st = est.st;
  if (cfg.diasCompetencia < 1) return true;
  const hechos = indiceHechos_();
  const lineas = [], marcas = [];
  let completo = adjudicacionesDelRubro_(cfg, ctx, st, hechos, lineas, marcas);
  if (!cfg.organismos.length) { guardarCompetencia_(st, lineas, marcas); return completo; }
  for (let d = 1; d <= cfg.diasCompetencia && completo; d++) {
    const ddmmaaaa = Utilities.formatDate(new Date(Date.now() - d * 864e5), RADAR.ZONA, 'ddMMyyyy');
    for (let o = 0; o < cfg.organismos.length && completo; o++) {
      const org = cfg.organismos[o].codigo;
      const clave = 'OCLISTA|' + org + '|' + ddmmaaaa;
      if (hechos[clave]) continue;
      let lista = cacheGet_(clave);
      if (!lista) {
        if (!tiempoParaLlamar_(ctx)) { completo = false; break; }
        const r = consultarApi_('ordenesdecompra.json', { fecha: ddmmaaaa, CodigoOrganismo: org }, ctx.ticket, ctx);
        if (r.diferido) { completo = false; break; }
        if (!r.ok) { registrar_('ADVERTENCIA', 'COMPETENCIA', 'OC del organismo ' + org + ' del ' + ddmmaaaa + ': ' + r.error, st); continue; }
        lista = r.data.Listado.map(function (x) { return String(x.Codigo); });
        cachePut_(clave, lista);
      }
      let pendientes = 0;
      for (let k = 0; k < lista.length; k++) {
        const oc = lista[k];
        if (hechos['OC|' + oc]) continue;
        if (!tiempoParaLlamar_(ctx) || lote_(ctx) >= cfg.fichasPorLote) { completo = false; pendientes++; break; }
        const r = consultarApi_('ordenesdecompra.json', { codigo: oc }, ctx.ticket, ctx);
        if (r.diferido) { completo = false; pendientes++; break; }
        ctx.lote++;
        if (!r.ok || !r.data.Listado[0]) { pendientes++; continue; }
        lineasOC_(r.data.Listado[0], cfg).forEach(function (l) { lineas.push(l); });
        hechos['OC|' + oc] = 'ok'; marcas.push(['OC|' + oc, new Date()]);
      }
      if (!pendientes) { hechos[clave] = 'ok'; marcas.push([clave, new Date()]); }
    }
  }
  guardarCompetencia_(st, lineas, marcas);
  return completo;
}

function guardarCompetencia_(st, lineas, marcas) {
  if (lineas.length) { agregarFilas_(HOJAS.COMP, lineas, COMP_COLS.length); st.competencia = (st.competencia || 0) + lineas.length; }
  agregarFilas_(HOJAS.HECHOS, marcas, 2);
}

/**
 * Quién gana en TU rubro: lista las licitaciones adjudicadas de cada día de la ventana
 * (licitaciones.json?fecha=ddmmaaaa&estado=adjudicada), filtra por tus palabras clave en el nombre
 * y lee la ficha de cada una: proveedor adjudicado, cantidad, monto unitario y número de oferentes.
 */
function adjudicacionesDelRubro_(cfg, ctx, st, hechos, lineas, marcas) {
  if (!cfg.adjudicacionesRubro || !cfg.claves.length) return true;
  for (let d = 1; d <= cfg.diasCompetencia; d++) {
    const ddmmaaaa = Utilities.formatDate(new Date(Date.now() - d * 864e5), RADAR.ZONA, 'ddMMyyyy');
    const clave = 'ADJLISTA|' + ddmmaaaa;
    if (hechos[clave]) continue;
    let lista = cacheGet_(clave);
    if (!lista) {
      if (!tiempoParaLlamar_(ctx)) return false;
      const r = consultarApi_('licitaciones.json', { fecha: ddmmaaaa, estado: 'adjudicada' }, ctx.ticket, ctx);
      if (r.diferido) return false;
      if (!r.ok) { registrar_('ADVERTENCIA', 'COMPETENCIA', 'Adjudicadas del ' + ddmmaaaa + ': ' + r.error, st); continue; }
      lista = r.data.Listado.filter(function (l) { return calce_(l.Nombre, cfg.claves).length && !coincide_(l.Nombre, cfg.excluir); })
        .map(function (l) { return String(l.CodigoExterno); });
      cachePut_(clave, lista);
    }
    let pendientes = 0;
    for (let k = 0; k < lista.length; k++) {
      const cod = lista[k];
      if (hechos['ADJ|' + cod]) continue;
      if (!tiempoParaLlamar_(ctx) || lote_(ctx) >= cfg.fichasPorLote) return false;
      const r = consultarFicha_(cod, ctx);
      if (r.diferido) return false;
      if (!r.cache) ctx.lote++;
      if (!r.ok) { pendientes++; continue; }
      lineasAdjudicacion_(r.lic).forEach(function (l) { lineas.push(l); });
      hechos['ADJ|' + cod] = 'ok'; marcas.push(['ADJ|' + cod, new Date()]);
    }
    if (!pendientes) { hechos[clave] = 'ok'; marcas.push([clave, new Date()]); }
  }
  return true;
}

/** Una línea por ítem de la OC: quién vendió, qué, cuánto y a qué precio neto unitario. */
function lineasOC_(oc, cfg) {
  const comp = oc.Comprador || {}, prov = oc.Proveedor || {};
  const fecha = fechaLocal_((oc.Fechas && (oc.Fechas.FechaEnvio || oc.Fechas.FechaCreacion)) || '');
  const items = (oc.Items && oc.Items.Listado) || [];
  return items.filter(function (it) {
    if (!cfg.rubros.length) return true;
    const cp = String(it.CodigoProducto || ''), cc = String(it.CodigoCategoria || '');
    return cfg.rubros.some(function (rb) { return cp.indexOf(rb.prefijo) === 0 || cc.indexOf(rb.prefijo) === 0; });
  }).map(function (it) {
    const cant = Number(it.Cantidad) || 0, pu = Number(it.PrecioNeto) || 0;
    return ['Orden de compra', fecha, String(oc.Codigo), oc.Nombre || '', String(comp.NombreOrganismo || '').trim(), String(comp.CodigoOrganismo || ''),
      String(comp.RegionUnidad || '').trim(), String(prov.Nombre || prov.NombreSucursal || '').trim(), prov.RutSucursal || '',
      String(it.Producto || it.EspecificacionComprador || '').slice(0, 200), String(it.CodigoProducto || ''), cant, pu,
      Number(it.Total) || cant * pu, it.Moneda || oc.TipoMoneda || '', oc.CodigoLicitacion || '', oc.Estado || ''];
  });
}

// ---------------------------------------------------------------- fase 5: cierre
function faseCierre_(cfg, ctx, est) {
  const hoja = hoja_(HOJAS.LIC);
  const n = hoja.getLastRow() - 1;
  if (n > 0) { // recalcula «Días al cierre»
    const r = hoja.getRange(2, L['Cierre'] + 1, n, 2);
    r.setValues(r.getValues().map(function (x) { return [x[0], diasAl_(x[0])]; }));
  }
  exportarPowerBI(true);
  enviarResumen_(cfg, est);
  registrar_('OK', 'CIERRE', 'Ciclo completo', est.st, ctx.t0);
  return true;
}

// ================================================================ API
function contexto_() { return { t0: Date.now(), lote: 0, ultimaLlamada: 0, ticket: null }; }
function lote_(ctx) { return ctx.lote || 0; }
function tiempoParaLlamar_(ctx) { return (Date.now() - ctx.t0) < (RADAR.TIEMPO_MAX_MS - RADAR.MARGEN_LLAMADA_MS); }

function consultarApi_(recurso, params, ticket, ctx) {
  const q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); });
  q.push('ticket=' + encodeURIComponent(ticket));
  const url = RADAR.API + recurso + '?' + q.join('&');
  let ultimo = 'sin respuesta';
  for (let i = 0; i < RADAR.REINTENTOS; i++) {
    if (i > 0) {
      const espera = RADAR.ESPERAS_MS[Math.min(i - 1, RADAR.ESPERAS_MS.length - 1)];
      if (ctx && (Date.now() - ctx.t0 + espera) > (RADAR.TIEMPO_MAX_MS - RADAR.MARGEN_LLAMADA_MS)) {
        return { ok: false, diferido: true, error: ultimo + ' (sin tiempo para reintentar: sigue en el próximo lote)' };
      }
      Utilities.sleep(espera);
    }
    // Nunca dos consultas seguidas sin pausa: la API rechaza peticiones simultáneas.
    if (ctx && ctx.ultimaLlamada) { const falta = RADAR.PAUSA_MS - (Date.now() - ctx.ultimaLlamada); if (falta > 0) Utilities.sleep(falta); }
    if (!contarLlamada_()) return { ok: false, error: 'Se alcanzó el tope diario propio de consultas (' + RADAR.TOPE_DIARIO_PROPIO + '). Se reanuda mañana.' };
    let code = 0, texto = '', json = null;
    try {
      const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
      code = resp.getResponseCode();
      texto = resp.getContentText('UTF-8');
    } catch (e) {
      ultimo = 'error de red: ' + ocultarTicket_(String(e && e.message || e));
      if (ctx) ctx.ultimaLlamada = Date.now();
      continue;
    }
    if (ctx) ctx.ultimaLlamada = Date.now();
    try { json = JSON.parse(texto); } catch (e) { json = null; }
    if (code === 200 && json && Array.isArray(json.Listado)) return { ok: true, data: json };
    const codApi = json && json.Codigo, msj = json && json.Mensaje;
    ultimo = 'HTTP ' + code + (codApi ? ' · código ' + codApi : '') + (msj ? ' · ' + msj : (json ? '' : ' · respuesta no es JSON'));
    if (codApi === 203) return { ok: false, error: ultimo + ' (revisa tu ticket)' };
    const reintentable = code === 429 || codApi === 10500 || code >= 500 || code === 0 || (code === 200 && !json);
    if (!reintentable) return { ok: false, error: ultimo };
  }
  return { ok: false, error: ultimo + ' (tras ' + RADAR.REINTENTOS + ' intentos)' };
}

function consultarFicha_(codigo, ctx) {
  const enCache = cacheGet_('LIC|' + codigo);
  if (enCache) return { ok: true, lic: enCache, cache: true };
  const r = consultarApi_('licitaciones.json', { codigo: codigo }, ctx.ticket, ctx);
  if (!r.ok) return r;
  const lic = r.data.Listado[0];
  if (!lic || String(lic.CodigoExterno) !== String(codigo)) return { ok: false, error: 'la ficha no trajo el código pedido' };
  cachePut_('LIC|' + codigo, lic);
  return { ok: true, lic: lic };
}

function cacheGet_(k) {
  try { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function cachePut_(k, v) {
  try { const s = JSON.stringify(v); if (s.length < 95000) CacheService.getScriptCache().put(k, s, RADAR.CACHE_SEG); } catch (e) { /* la caché es opcional */ }
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
  return Number(PropertiesService.getScriptProperties().getProperty('LLAMADAS_' + Utilities.formatDate(new Date(), RADAR.ZONA, 'yyyyMMdd')) || 0);
}

// ================================================================ coincidencias
function normalizar_(s) {
  return ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}
/** Primera palabra (o frase) de la lista que aparece completa. «aseo*» acepta aseo, aseos… */
function coincide_(texto, lista) {
  const t = normalizar_(texto);
  for (let i = 0; i < lista.length; i++) {
    const raw = String(lista[i] && lista[i].palabra != null ? lista[i].palabra : lista[i]).trim();
    if (!raw) continue;
    const pref = /\*$/.test(raw);
    const k = normalizar_(raw.replace(/\*$/, '')).trim();
    if (!k) continue;
    if (pref ? t.indexOf(' ' + k) >= 0 : t.indexOf(' ' + k + ' ') >= 0) return raw;
  }
  return null;
}
/** Palabras clave ({palabra, peso}) que aparecen en el texto. */
function calce_(texto, claves) { return claves.filter(function (k) { return coincide_(texto, [k.palabra]); }); }
function normRut_(r) { return String(r || '').replace(/[^0-9kK]/g, '').toUpperCase(); }

// ================================================================ correo diario
function enviarResumen_(cfg, est) {
  const st = est.st || {};
  if (!cfg.correo) { registrar_('ADVERTENCIA', 'CIERRE', 'Sin correo configurado: no se envió resumen', st); return; }
  const props = PropertiesService.getScriptProperties();
  const desde = Number(props.getProperty(RADAR.PROP_ULTIMO_CORREO) || 0);
  const filas = filasLic_();
  const nuevas = filas.filter(function (f) { return f[L['Detectada']] instanceof Date && f[L['Detectada']].getTime() > desde && Number(f[L['Puntaje']]) >= cfg.puntajeMin; })
    .sort(function (a, b) { return b[L['Puntaje']] - a[L['Puntaje']]; }).slice(0, cfg.topCorreo);
  const proximas = filas.filter(function (f) {
    const d = f[L['Días al cierre']];
    return d !== '' && d >= 0 && d <= 7 && ['Descartada', 'Ganada', 'Perdida', 'Postulada'].indexOf(String(f[L['Etapa']])) < 0 && Number(f[L['Puntaje']]) >= cfg.puntajeMin;
  }).sort(function (a, b) { return a[L['Días al cierre']] - b[L['Días al cierre']]; }).slice(0, 15);
  if (!nuevas.length && !proximas.length && !cfg.avisarSinNovedades) return;
  const html = htmlResumen_(cfg, st, nuevas, proximas);
  const asunto = 'Radar MP Pro · ' + nuevas.length + ' nueva(s) sobre ' + cfg.puntajeMin + ' pts · ' + proximas.length + ' cierre(s) en 7 días · ' +
    Utilities.formatDate(new Date(), RADAR.ZONA, 'dd-MM-yyyy');
  if (enviarCorreo_(cfg.correo, asunto, html, st)) props.setProperty(RADAR.PROP_ULTIMO_CORREO, String(Date.now()));
}

function enviarCorreoPrueba() {
  const cfg = leerConfig_();
  if (!cfg.correo) { SpreadsheetApp.getUi().alert('Primero escribe un correo en «Configuración».'); return; }
  enviarResumen_(Object.assign({}, cfg, { avisarSinNovedades: true }), { st: { activas: '(prueba)' } });
  SpreadsheetApp.getUi().alert('Correo de prueba enviado a ' + cfg.correo + ' (revisa también spam).');
}

function htmlResumen_(cfg, st, nuevas, proximas) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const url = ss.getUrl ? ss.getUrl() : '';
  const estilo = 'font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222';
  const td = 'padding:6px;border-bottom:1px solid #eee;vertical-align:top';
  const barra = function (p) {
    const w = Math.max(4, Math.round(Number(p) || 0)); const c = p >= 70 ? '#2e7d32' : (p >= 40 ? '#f9a825' : '#9e9e9e');
    return '<div style="background:#eee;width:100px;height:8px;border-radius:4px"><div style="background:' + c + ';width:' + w + 'px;height:8px;border-radius:4px"></div></div>';
  };
  const fila = function (f, extra) {
    return '<tr><td style="' + td + '"><b style="font-size:15px">' + esc_(f[L['Puntaje']]) + '</b>' + barra(f[L['Puntaje']]) + '</td>' +
      '<td style="' + td + '"><a href="' + esc_(f[L['Ficha']]) + '" style="color:#0b57d0;text-decoration:none"><b>' + esc_(f[L['Nombre']]) + '</b></a><br>' +
      '<span style="color:#666">' + esc_(f[L['Código']]) + ' · ' + esc_(f[L['Organismo']]) + ' · ' + esc_(f[L['Región']]) + '</span><br>' +
      '<span style="color:#888;font-size:12px">' + esc_(f[L['Motivos']]) + '</span></td>' +
      '<td style="' + td + ';white-space:nowrap">' + (f[L['Monto estimado']] !== '' ? '$' + miles_(f[L['Monto estimado']]) : '<span style="color:#999">no informado</span>') + '</td>' +
      '<td style="' + td + ';white-space:nowrap">' + esc_(fmtFecha_(f[L['Cierre']])) + (extra ? '<br><b style="color:#c62828">' + esc_(extra) + '</b>' : '') + '</td></tr>';
  };
  const tabla = function (titulo, lista, conDias) {
    if (!lista.length) return '<h3 style="margin:18px 0 6px">' + titulo + '</h3><p style="color:#666">Nada por ahora.</p>';
    return '<h3 style="margin:18px 0 6px">' + titulo + '</h3><table cellspacing="0" style="border-collapse:collapse;width:100%;' + estilo + '">' +
      '<tr style="background:#f3f6fb;text-align:left"><th style="padding:6px">Puntaje</th><th style="padding:6px">Licitación</th><th style="padding:6px">Monto est.</th><th style="padding:6px">Cierre</th></tr>' +
      lista.map(function (f) { return fila(f, conDias ? ('en ' + f[L['Días al cierre']] + ' días') : ''); }).join('') + '</table>';
  };
  return '<div style="' + estilo + ';max-width:760px">' +
    '<div style="background:#0d2b4e;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0"><b style="font-size:18px">Radar MP Pro</b><br>' +
    '<span style="opacity:.85">' + Utilities.formatDate(new Date(), RADAR.ZONA, 'dd-MM-yyyy') + ' · ' + esc_(st.activas || 0) + ' licitaciones activas revisadas · ' +
    esc_(st.fichas || 0) + ' fichas leídas</span></div>' +
    tabla('Mejores oportunidades nuevas (puntaje ≥ ' + cfg.puntajeMin + ')', nuevas, false) +
    tabla('Cierran en los próximos 7 días', proximas, true) +
    (url ? '<p><a href="' + esc_(url) + '" style="background:#0b57d0;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Abrir el dashboard</a></p>' : '') +
    '<p style="color:#777;font-size:12px">Verifica siempre la ficha y las bases en mercadopublico.cl antes de decidir. «Sin novedades» no es lo mismo que «falló»: si el radar falla, recibirás un aviso aparte. Fuente: API de Mercado Público (Dirección ChileCompra).</p></div>';
}

function enviarCorreo_(correo, asunto, html, st) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) { registrar_('ADVERTENCIA', 'correo', 'Sin cuota diaria de correo: no se envió', st); return false; }
    MailApp.sendEmail({ to: correo, subject: asunto, htmlBody: html, name: 'Radar MP Pro' });
    return true;
  } catch (e) {
    registrar_('ERROR', 'correo', 'No se pudo enviar el correo: ' + String(e && e.message || e), st);
    return false;
  }
}

function fallar_(cfg, fase, mensaje, st, t0) {
  registrar_('ERROR', fase, mensaje, st, t0);
  if (cfg && cfg.correo) {
    const ultimo = PropertiesService.getScriptProperties().getProperty(RADAR.PROP_ULTIMO_OK) || 'sin registro';
    enviarCorreo_(cfg.correo, 'Radar MP Pro: FALLÓ la consulta · revisa manualmente',
      '<p><b>El radar no pudo completar la consulta.</b> Esto no significa que no haya oportunidades.</p><p>Detalle: ' + esc_(mensaje) +
      '</p><p>Última consulta correcta: ' + esc_(ultimo) + '</p><p>Mientras se resuelve, busca manualmente en mercadopublico.cl.</p>', st);
  }
  return 'ERROR';
}

// ================================================================ Power BI / Excel
/**
 * Escribe hojas planas PBI_* con encabezados sin tildes, fechas ISO (texto) y números sin formato.
 * Publícalas con Archivo › Compartir › Publicar en la Web › (hoja) › Valores separados por comas (.csv)
 * y usa cada enlace en Power Query. No incluyen Responsable, Próxima acción ni Notas (datos internos).
 */
function exportarPowerBI(silencioso) {
  const iso = function (d) { return d instanceof Date ? Utilities.formatDate(d, RADAR.ZONA, "yyyy-MM-dd'T'HH:mm:ss") : ''; };
  const plano = function (r) { return r.map(function (v) { return v instanceof Date ? iso(v) : v; }); };
  const lic = filasLic_().map(function (f) {
    return [f[L['Código']], f[L['Nombre']], f[L['Puntaje']], f[L['Estado MP']], f[L['Tipo']], f[L['Organismo']], String(f[L['Cód. organismo']]),
      f[L['Unidad de compra']], f[L['Región']], f[L['Comuna']], f[L['Monto estimado']], f[L['Moneda']], iso(f[L['Publicación']]), iso(f[L['Cierre']]),
      iso(f[L['Adjudicación estimada']]), f[L['Rubro principal']], String(f[L['UNSPSC principal']]), f[L['N° ítems']], f[L['Etapa']],
      f[L['Resultado adjudicación']], iso(f[L['Detectada']]), f[L['Ficha']]];
  });
  escribirTabla_(HOJAS.PBI_LIC, PBI_LIC_COLS, lic);
  escribirTabla_(HOJAS.PBI_ITEMS, PBI_ITEM_COLS, datos_(HOJAS.ITEMS, ITEM_COLS.length).map(plano));
  escribirTabla_(HOJAS.PBI_COMP, PBI_COMP_COLS, datos_(HOJAS.COMP, COMP_COLS.length).map(plano));
  if (silencioso !== true) {
    try {
      SpreadsheetApp.getUi().alert('Hojas PBI_Licitaciones, PBI_Items y PBI_Competencia actualizadas.\n' +
        'Publícalas como CSV (Archivo › Compartir › Publicar en la Web) y pega cada enlace en Power Query.\n' +
        'Ojo: lo publicado queda visible para quien tenga el enlace (no incluye Notas ni Responsable).');
    } catch (e) {}
  }
}
const PBI_LIC_COLS = ['codigo', 'nombre', 'puntaje', 'estado_mp', 'tipo', 'organismo', 'codigo_organismo', 'unidad', 'region', 'comuna',
  'monto_estimado', 'moneda', 'fecha_publicacion', 'fecha_cierre', 'fecha_adjudicacion', 'rubro', 'unspsc', 'n_items', 'etapa', 'resultado', 'detectada', 'url_ficha'];
const PBI_ITEM_COLS = ['codigo_licitacion', 'correlativo', 'codigo_producto', 'codigo_categoria', 'categoria', 'producto', 'descripcion', 'unidad',
  'cantidad', 'proveedor_adjudicado', 'rut_adjudicado', 'cantidad_adjudicada', 'monto_unitario_adjudicado'];
const PBI_COMP_COLS = ['fuente', 'fecha', 'codigo', 'nombre', 'organismo', 'codigo_organismo', 'region', 'proveedor', 'rut_proveedor', 'producto',
  'unspsc', 'cantidad', 'precio_unitario', 'total_linea', 'moneda', 'licitacion_relacionada', 'estado'];

function escribirTabla_(nombre, encabezado, filas) {
  const h = hoja_(nombre);
  h.clearContents();
  h.getRange(1, 1, 1, encabezado.length).setValues([encabezado]).setFontWeight('bold');
  if (filas.length) {
    const r = h.getRange(2, 1, filas.length, encabezado.length);
    r.setNumberFormat('@');  // texto plano: el CSV publicado sale sin separador de miles ni formato regional
    r.setValues(filas.map(function (f) { return f.map(function (v) { return v === '' || v == null ? '' : String(v); }); }));
  }
}

// ================================================================ dashboard
/**
 * Construye (o reconstruye) la hoja Dashboard:
 *  - Controles (celdas amarillas con desplegable) de región, etapa, puntaje mínimo y horizonte de cierre: filtran todo.
 *  - Hoja auxiliar _dash: FILTER con los controles + QUERY/COUNTIFS que agregan por región, organismo, rubro,
 *    tramo de monto, día de cierre y proveedor (competencia).
 *  - 6 KPIs con fórmulas, 2 SPARKLINE de tendencia, top 15 por puntaje con barra SPARKLINE de calce.
 *  - 6 gráficos nativos (EmbeddedChart) y 2 segmentadores (slicers) en la hoja Licitaciones.
 */
function construirDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const d = hoja_(HOJAS.DASH);
  const a = hoja_(HOJAS.AUX);
  d.getCharts().forEach(function (c) { d.removeChart(c); });
  d.clear(); a.clear();
  const col = function (nombre) { return letra_(L[nombre] + 1); };
  const rng = function (nombre) { return "'" + HOJAS.LIC + "'!" + col(nombre) + '2:' + col(nombre); };
  const LIC = "'" + HOJAS.LIC + "'!";

  // --- encabezado y controles
  d.getRange('A1').setValue('RADAR MP PRO · DASHBOARD').setFontSize(18).setFontWeight('bold').setFontColor('#0d2b4e');
  d.getRange('A2').setFormula('="Actualizado: "&TEXT(NOW(),"dd-mm-yyyy hh:mm")&"  ·  Fuente: API Mercado Público (ChileCompra)"').setFontColor('#666666');
  d.getRange('A4:H4').setValues([['Región', 'Todas', 'Etapa', 'Todas', 'Puntaje mínimo', 0, 'Cierra en (días)', 'Todos']]);
  ['A4', 'C4', 'E4', 'G4'].forEach(function (c) { d.getRange(c).setFontWeight('bold').setFontColor('#555555').setHorizontalAlignment('right'); });
  // La lista de regiones sale de tus propios datos (así coincide exactamente con lo que informa la API).
  a.getRange('Z1').setValue('Todas');
  a.getRange('Z2').setFormula('=IFERROR(SORT(UNIQUE(FILTER(TRIM(' + rng('Región') + '),' + rng('Región') + '<>""))),"")');
  d.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(a.getRange('Z1:Z40'), true).setAllowInvalid(true).build());
  d.getRange('D4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Todas'].concat(ETAPAS), true).build());
  d.getRange('F4').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 100).build());
  d.getRange('H4').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Todos', '3', '7', '15', '30'], true).build());
  ['B4', 'D4', 'F4', 'H4'].forEach(function (c) { d.getRange(c).setBackground('#fff8e1').setFontWeight('bold'); });

  // --- datos filtrados en _dash!A:K
  const sel = ['Código', 'Nombre', 'Puntaje', 'Región', 'Organismo', 'Rubro principal', 'Monto estimado', 'Cierre', 'Días al cierre', 'Etapa', 'Ficha'];
  const cond = [
    '(' + rng('Código') + '<>"")',
    '((Dashboard!$B$4="Todas")+(TRIM(' + rng('Región') + ')=TRIM(Dashboard!$B$4))>0)',
    '((Dashboard!$D$4="Todas")+(' + rng('Etapa') + '=Dashboard!$D$4)>0)',
    '(N(' + rng('Puntaje') + ')>=N(Dashboard!$F$4))',
    '((Dashboard!$H$4="Todos")+((' + rng('Días al cierre') + '<>"")*(N(' + rng('Días al cierre') + ')>=0)*(N(' + rng('Días al cierre') + ')<=VALUE(Dashboard!$H$4&"")))>0)'
  ];
  a.getRange(1, 1, 1, sel.length).setValues([sel]);
  a.getRange('A2').setFormula('=IFERROR(FILTER({' + sel.map(rng).join(',') + '},' + cond.join('*') + '),"")');

  // --- agregaciones para los gráficos
  a.getRange('M1').setFormula('=IFERROR(QUERY(A2:K,"select D, count(A) where A is not null and D is not null group by D order by count(A) desc limit 16 label D \'Región\', count(A) \'Oportunidades\'",0),{"Región","Oportunidades";"(sin datos)",0})');
  a.getRange('P1').setFormula('=IFERROR(QUERY(A2:K,"select E, count(A), sum(G) where A is not null and E is not null group by E order by count(A) desc limit 10 label E \'Organismo\', count(A) \'Oportunidades\', sum(G) \'Monto\'",0),{"Organismo","Oportunidades","Monto";"(sin datos)",0,0})');
  a.getRange('T1').setFormula('=IFERROR(QUERY(A2:K,"select F, count(A) where A is not null and F is not null group by F order by count(A) desc limit 8 label F \'Rubro\', count(A) \'Oportunidades\'",0),{"Rubro","Oportunidades";"(sin datos)",0})');
  a.getRange('AB1:AC1').setValues([['Tramo de monto', 'Oportunidades']]);
  TRAMOS_MONTO.forEach(function (t, i) {
    a.getRange(i + 2, 28).setValue(t[0]);
    a.getRange(i + 2, 29).setFormula('=COUNTIFS($G$2:$G,">="&' + t[1] + ',$G$2:$G,"<"&' + t[2] + ')');
  });
  a.getRange('AB7').setValue('No informado');
  a.getRange('AC7').setFormula('=COUNTIFS($A$2:$A,"<>",$G$2:$G,"")');
  a.getRange('AE1:AF1').setValues([['Día de cierre', 'Cierres']]);
  for (let i = 0; i < 8; i++) {
    a.getRange(i + 2, 31).setFormula('=TODAY()+' + i).setNumberFormat('ddd dd-mm');
    a.getRange(i + 2, 32).setFormula('=COUNTIFS($H$2:$H,">="&AE' + (i + 2) + ',$H$2:$H,"<"&(AE' + (i + 2) + '+1))');
  }
  a.getRange('AH1').setFormula("=IFERROR(QUERY('" + HOJAS.COMP + "'!A2:Q,\"select H, sum(N), count(C) where H is not null and N is not null group by H order by sum(N) desc limit 10 label H 'Proveedor', sum(N) 'Total vendido', count(C) 'Líneas'\",0),{\"Proveedor\",\"Total vendido\",\"Líneas\";\"(sin datos)\",0,0})");
  a.getRange('AL1').setValue('Detecciones por día (30)');
  a.getRange('AL2').setFormula('=ARRAYFORMULA(COUNTIFS(' + LIC + col('Detectada') + '2:' + col('Detectada') + ',">="&(TODAY()-SEQUENCE(30,1,29,-1)),' +
    LIC + col('Detectada') + '2:' + col('Detectada') + ',"<"&(TODAY()-SEQUENCE(30,1,29,-1)+1)))');

  // --- KPIs (fila 6 etiqueta, fila 7 valor)
  const etapa = LIC + col('Etapa') + '2:' + col('Etapa');
  const kpis = [
    ['Oportunidades', '=COUNTIF(\'_dash\'!A2:A,"?*")'],
    ['Puntaje promedio', '=IFERROR(ROUND(AVERAGE(\'_dash\'!C2:C),0),0)'],
    ['Monto estimado total', '=SUM(\'_dash\'!G2:G)'],
    ['Cierran en 7 días', '=COUNTIFS(\'_dash\'!I2:I,">=0",\'_dash\'!I2:I,"<=7")'],
    ['En Postular / Postulada', '=COUNTIF(\'_dash\'!J2:J,"Postular")+COUNTIF(\'_dash\'!J2:J,"Postulada")'],
    ['Tasa de adjudicación', '=IFERROR(COUNTIF(' + etapa + ',"Ganada")/(COUNTIF(' + etapa + ',"Ganada")+COUNTIF(' + etapa + ',"Perdida")),"—")']
  ];
  kpis.forEach(function (k, i) {
    const c = 1 + i * 2;
    d.getRange(6, c).setValue(k[0]).setFontColor('#555555').setFontSize(9);
    d.getRange(7, c).setFormula(k[1]).setFontSize(20).setFontWeight('bold').setFontColor('#0d2b4e');
    d.getRange(6, c, 2, 2).setBackground('#f3f6fb');
  });
  d.getRange(7, 5).setNumberFormat('$#,##0');
  d.getRange(7, 11).setNumberFormat('0%');
  d.getRange('A8').setValue('Detecciones últimos 30 días').setFontColor('#555555').setFontSize(9);
  d.getRange('C8').setFormula('=SPARKLINE(\'_dash\'!AL2:AL31,{"charttype","column";"color","#0b57d0"})');
  d.getRange('E8').setValue('Cierres próximos 8 días').setFontColor('#555555').setFontSize(9);
  d.getRange('G8').setFormula('=SPARKLINE(\'_dash\'!AF2:AF9,{"charttype","column";"color","#c62828"})');

  // --- Top 15 (QUERY sobre los datos filtrados) + barra de calce con SPARKLINE
  d.getRange('A10').setValue('TOP 15 POR PUNTAJE (según los filtros)').setFontWeight('bold').setFontColor('#0d2b4e');
  d.getRange('A11').setFormula('=IFERROR(QUERY(\'_dash\'!A2:K,"select C, A, B, E, D, G, H, I, J where A is not null order by C desc limit 15 label C \'Puntaje\', A \'Código\', B \'Nombre\', E \'Organismo\', D \'Región\', G \'Monto est.\', H \'Cierre\', I \'Días\', J \'Etapa\'",0),"Sin oportunidades con estos filtros")');
  d.getRange('A11:K11').setFontWeight('bold').setBackground('#0d2b4e').setFontColor('#ffffff');
  d.getRange('F12:F26').setNumberFormat('$#,##0');
  d.getRange('G12:G26').setNumberFormat('dd-mm-yyyy hh:mm');
  d.getRange('J11').setValue('Calce');
  for (let i = 12; i <= 26; i++) d.getRange(i, 10).setFormula('=IF(A' + i + '="","",SPARKLINE(A' + i + ',{"charttype","bar";"max",100;"color1",IF(A' + i + '>=70,"#2e7d32",IF(A' + i + '>=40,"#f9a825","#9e9e9e"))}))');
  [60, 120, 380, 260, 170, 110, 120, 50, 90, 110, 60, 60].forEach(function (w, i) { d.setColumnWidth(i + 1, w); });

  // --- gráficos nativos
  const graf = function (tipo, rango, fila, colAnc, titulo, opciones) {
    let b = d.newChart().setChartType(tipo).addRange(rango).setPosition(fila, colAnc, 0, 0)
      .setOption('title', titulo).setOption('legend', { position: 'none' }).setOption('width', 560).setOption('height', 300);
    Object.keys(opciones || {}).forEach(function (k) { b = b.setOption(k, opciones[k]); });
    d.insertChart(b.build());
  };
  const CT = Charts.ChartType;
  graf(CT.BAR, a.getRange('M1:N17'), 28, 1, 'Oportunidades por región', { colors: ['#0b57d0'] });
  graf(CT.BAR, a.getRange('P1:Q11'), 28, 5, 'Top 10 organismos compradores', { colors: ['#00897b'] });
  graf(CT.PIE, a.getRange('T1:U9'), 44, 1, 'Rubros (UNSPSC) más frecuentes', { legend: { position: 'right' }, pieHole: 0.4 });
  graf(CT.COLUMN, a.getRange('AB1:AC7'), 44, 5, 'Oportunidades por tramo de monto estimado (CLP)', { colors: ['#6a1b9a'] });
  graf(CT.COLUMN, a.getRange('AE1:AF9'), 60, 1, 'Cierres de los próximos 7 días', { colors: ['#c62828'] });
  graf(CT.BAR, a.getRange('AH1:AI11'), 60, 5, 'Competencia: proveedores con más ventas y adjudicaciones', { colors: ['#ef6c00'] });

  // --- segmentadores (slicers) en Licitaciones: filtran la vista del pipeline
  try {
    const hl = hoja_(HOJAS.LIC);
    hl.getSlicers().forEach(function (s) { s.remove(); });
    const datos = hl.getRange(1, 1, Math.max(2, hl.getMaxRows()), LIC_COLS.length);
    hl.insertSlicer(datos, 2, 3).setColumnFilterCriteria(L['Región'] + 1, null).setTitle('Región');
    hl.insertSlicer(datos, 2, 6).setColumnFilterCriteria(L['Etapa'] + 1, null).setTitle('Etapa');
  } catch (e) { registrar_('ADVERTENCIA', 'dashboard', 'No se pudieron crear los segmentadores: ' + e.message, {}); }

  a.hideSheet();
  d.setFrozenRows(4);
  ss.setActiveSheet(d);
}

const TRAMOS_MONTO = [['Hasta $1 MM', 0, 1e6], ['$1 a 10 MM', 1e6, 1e7], ['$10 a 50 MM', 1e7, 5e7], ['$50 a 200 MM', 5e7, 2e8], ['Más de $200 MM', 2e8, 1e15]];
const REGIONES_CHILE = ['Región de Arica y Parinacota', 'Región de Tarapacá', 'Región de Antofagasta', 'Región de Atacama', 'Región de Coquimbo',
  'Región de Valparaíso', 'Región Metropolitana de Santiago', 'Región del Libertador General Bernardo O´Higgins', 'Región del Maule', 'Región del Ñuble',
  'Región del Biobío', 'Región de la Araucanía', 'Región de Los Ríos', 'Región de Los Lagos', 'Región Aysén del General Carlos Ibáñez del Campo',
  'Región de Magallanes y de la Antártica'];

// ================================================================ hojas, formato y configuración
function prepararHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(HOJAS.INICIO);
  if (!h) {
    h = ss.insertSheet(HOJAS.INICIO);
    h.getRange(1, 1, 9, 1).setValues([['RADAR MP PRO · Bonus del Vol. 7 «Véndele al Estado y No Mueras en el Intento»'],
      ['1) Menú Radar MP Pro › ★ Instalar o reparar (un clic).'], ['2) Menú › Guardar mi ticket (se guarda fuera de la planilla).'],
      ['3) Completa «Configuración»: palabras clave con peso 1 a 5, exclusiones, regiones, montos, organismos favoritos y rubros.'],
      ['4) Menú › Ejecutar ahora. El primer ciclo puede tomar varios lotes de ~5 minutos: sigue solo.'],
      ['5) Trabaja en «Licitaciones»: cambia la Etapa (Nueva → Revisar → Postular → Postulada → Ganada / Perdida / Descartada).'],
      ['6) Mira «Dashboard» y usa sus filtros amarillos. «Competencia» muestra quién vende y a qué precio a tus organismos favoritos.'],
      ['Fuente: API pública de Mercado Público (Dirección ChileCompra). Verifica siempre las bases antes de postular.'],
      ['Autor: Enrique Evaristo Varas Bahamonde · FirmaVB · firmavb.cl']]);
    h.getRange('A1').setFontSize(16).setFontWeight('bold');
    h.setColumnWidth(1, 900);
  }
  h = ss.getSheetByName(HOJAS.CONFIG);
  if (!h) {
    h = ss.insertSheet(HOJAS.CONFIG);
    h.getRange(1, 1, 17, 3).setValues([
      ['Parámetro', 'Valor', 'Ayuda'],
      ['Correo para alertas', '', 'Recibe el resumen diario y los avisos de falla.'],
      ['Hora de ejecución diaria (0 a 23)', 6, 'Hora de Chile. ChileCompra recomienda descargas masivas entre 22:00 y 07:00.'],
      ['Puntaje mínimo para alertar (0 a 100)', 35, 'Solo las oportunidades con este puntaje o más van al correo.'],
      ['Fichas por lote', 40, 'Consultas de detalle por ejecución de ~5 minutos.'],
      ['Máximo de fichas por día', 800, 'Tope propio. El límite oficial es 10.000 consultas diarias por ticket.'],
      ['Búsqueda amplia (SI/NO)', 'NO', 'SI: lee la ficha de TODAS las activas nuevas para buscar en descripción e ítems. Más completo, más lento.'],
      ['Monto mínimo (CLP)', '', 'Vacío = sin mínimo. Fuera de rango resta 15 puntos.'],
      ['Monto máximo (CLP)', '', 'Vacío = sin máximo.'],
      ['Días mínimos al cierre', 3, 'Si cierra antes, resta 30 puntos (no alcanzas a preparar la oferta).'],
      ['Avisar aunque no haya novedades (SI/NO)', 'SI', 'SI permite distinguir «sin novedades» de «no funcionó».'],
      ['Días hacia atrás para competencia', 3, 'Órdenes de compra de tus organismos favoritos y adjudicaciones de tu rubro de los últimos N días (0 = desactivar).'],
      ['Seguir adjudicación de mis postulaciones (SI/NO)', 'SI', 'Relee la ficha de las licitaciones en Postular / Postulada ya cerradas.'],
      ['RUT de mi empresa (opcional)', '', 'Para marcar «GANADA por tu empresa» cuando la API informe la adjudicación.'],
      ['Oportunidades en el correo', 10, 'Cuántas nuevas mostrar como máximo.'],
      ['Adjudicaciones de mi rubro (SI/NO)', 'SI', 'Lee las licitaciones adjudicadas de los últimos días que calzan con tus palabras clave: quién ganó, a qué precio y con cuántos oferentes.'],
      ['Versión', RADAR.VERSION, '']]);
    h.getRange(1, 5, 1, 12).setValues([['Palabra clave', 'Peso (1-5)', '', 'Excluir si contiene', '', 'Regiones de interés', '',
      'Cód. organismo favorito', 'Nombre (referencia)', '', 'Rubro UNSPSC (prefijo)', 'Peso (1-5)']]);
    h.getRange(2, 5, 3, 2).setValues([['aseo*', 3], ['limpieza', 3], ['mantencion*', 2]]);
    h.getRange('A1:P1').setFontWeight('bold').setBackground('#0d2b4e').setFontColor('#ffffff');
    h.getRange('B2:B15').setBackground('#fff8e1');
    h.getRange('F2:F60').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 5).setHelpText('Peso de 1 (poco) a 5 (clave)').build());
    h.getRange('P2:P60').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 5).build());
    h.getRange('J2:J20').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(REGIONES_CHILE, true).setAllowInvalid(true).build());
    ['B7', 'B11', 'B13', 'B16'].forEach(function (c) { h.getRange(c).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['SI', 'NO'], true).build()); });
    h.setColumnWidth(1, 290); h.setColumnWidth(3, 460);
    h.setFrozenRows(1);
  }
  h = ss.getSheetByName(HOJAS.LIC);
  if (!h) {
    h = ss.insertSheet(HOJAS.LIC);
    h.getRange(1, 1, 1, LIC_COLS.length).setValues([LIC_COLS]).setFontWeight('bold').setBackground('#0d2b4e').setFontColor('#ffffff').setWrap(true);
    h.getRange(1, L['Etapa'] + 1, 1, 5).setBackground('#7b1fa2');
    h.setFrozenRows(1); h.setFrozenColumns(2);
    formatearLicitaciones_(h);
  }
  [[HOJAS.ITEMS, ITEM_COLS], [HOJAS.COMP, COMP_COLS], [HOJAS.HIST, HIST_COLS], [HOJAS.REG, REG_COLS]].forEach(function (p) {
    let x = ss.getSheetByName(p[0]);
    if (!x) {
      x = ss.insertSheet(p[0]);
      x.getRange(1, 1, 1, p[1].length).setValues([p[1]]).setFontWeight('bold').setBackground('#0d2b4e').setFontColor('#ffffff');
      x.setFrozenRows(1);
    }
  });
  [HOJAS.COLA, HOJAS.VISTAS, HOJAS.HECHOS, HOJAS.AUX].forEach(function (n) { let x = ss.getSheetByName(n); if (!x) { x = ss.insertSheet(n); x.hideSheet(); } });
  if (!ss.getSheetByName(HOJAS.DASH)) ss.insertSheet(HOJAS.DASH, 0);
}

/** Validación de Etapa, formato condicional (etapas, escala de puntaje, cierres próximos, descartadas tachadas). */
function formatearLicitaciones_(h) {
  const max = Math.max(h.getMaxRows(), 1000);
  const rEtapa = h.getRange(2, L['Etapa'] + 1, max - 1, 1);
  rEtapa.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ETAPAS, true).setAllowInvalid(false).build());
  h.getRange(2, L['Fecha próxima acción'] + 1, max - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build()).setNumberFormat('dd-mm-yyyy');
  const reglas = [];
  ETAPAS.forEach(function (e) {
    reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(e).setBackground(COLORES_ETAPA[e]).setRanges([rEtapa]).build());
  });
  const rPunt = h.getRange(2, L['Puntaje'] + 1, max - 1, 1);
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.NUMBER, '0')
    .setGradientMidpointWithValue('#fff59d', SpreadsheetApp.InterpolationType.NUMBER, '40')
    .setGradientMaxpointWithValue('#66bb6a', SpreadsheetApp.InterpolationType.NUMBER, '100').setRanges([rPunt]).build());
  const rDias = h.getRange(2, L['Días al cierre'] + 1, max - 1, 1);
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(0, 3).setBackground('#ffcdd2').setBold(true).setRanges([rDias]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(3.05, 7).setBackground('#ffe0b2').setRanges([rDias]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letra_(L['Etapa'] + 1) + '2="Descartada"')
    .setFontColor('#9e9e9e').setStrikethrough(true).setRanges([h.getRange(2, 1, max - 1, 2)]).build());
  h.setConditionalFormatRules(reglas);
  [L['Publicación'], L['Cierre'], L['Fin de preguntas'], L['Adjudicación estimada'], L['Detectada'], L['Última vez activa']].forEach(function (c) {
    h.getRange(2, c + 1, max - 1, 1).setNumberFormat('dd-mm-yyyy hh:mm');
  });
  h.getRange(2, L['Monto estimado'] + 1, max - 1, 1).setNumberFormat('$#,##0');
  h.getRange(2, L['Días al cierre'] + 1, max - 1, 1).setNumberFormat('0.0');
  h.setColumnWidth(L['Nombre'] + 1, 360); h.setColumnWidth(L['Motivos'] + 1, 300);
}

/** Registra en Historial cada cambio de Etapa hecho a mano (activador simple, sin permisos extra). */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const h = e.range.getSheet();
    if (h.getName() !== HOJAS.LIC || e.range.getColumn() !== L['Etapa'] + 1 || e.range.getRow() < 2 || e.range.getNumRows() !== 1) return;
    const cod = h.getRange(e.range.getRow(), 1).getValue();
    agregarHistorial_([[new Date(), cod, 'Cambio de etapa', e.oldValue || '', e.value || '', 'Editado en la planilla']]);
  } catch (err) { /* nunca bloquear la edición */ }
}

function leerConfig_() {
  const datos = hoja_(HOJAS.CONFIG).getDataRange().getValues();
  const par = {};
  datos.forEach(function (r) { if (r[0]) par[normalizar_(r[0]).trim()] = r[1]; });
  const val = function (et, def) { const v = par[normalizar_(et).trim()]; return (v === '' || v == null) ? def : v; };
  const num = function (et, def) { const v = Number(String(val(et, def)).replace(/[^0-9.\-]/g, '')); return isNaN(v) ? def : v; };
  const si = function (et, def) { return String(val(et, def)).trim().toUpperCase() === 'SI'; };
  const col = function (c) { return datos.slice(1).map(function (r) { return r[c]; }); };
  const claves = [], rubros = [], organismos = [];
  col(4).forEach(function (p, i) { if (String(p || '').trim()) claves.push({ palabra: String(p).trim(), peso: Math.max(1, Math.min(5, Number(col(5)[i]) || 1)) }); });
  col(14).forEach(function (p, i) { const s = String(p || '').replace(/[^0-9]/g, ''); if (s) rubros.push({ prefijo: s, peso: Math.max(1, Math.min(5, Number(col(15)[i]) || 1)) }); });
  col(11).forEach(function (p, i) { const s = String(p || '').trim(); if (s) organismos.push({ codigo: s, nombre: String(col(12)[i] || '') }); });
  return {
    correo: String(val('Correo para alertas', '')).trim(),
    hora: Math.min(23, Math.max(0, parseInt(val('Hora de ejecución diaria (0 a 23)', 6), 10) || 0)),
    puntajeMin: num('Puntaje mínimo para alertar (0 a 100)', 35),
    fichasPorLote: Math.max(1, num('Fichas por lote', 40)),
    maxFichasDia: Math.max(1, num('Máximo de fichas por día', 800)),
    amplia: si('Búsqueda amplia (SI/NO)', 'NO'),
    montoMin: num('Monto mínimo (CLP)', 0), montoMax: num('Monto máximo (CLP)', 0),
    diasMinCierre: num('Días mínimos al cierre', 3),
    avisarSinNovedades: si('Avisar aunque no haya novedades (SI/NO)', 'SI'),
    diasCompetencia: Math.max(0, Math.min(30, num('Días hacia atrás para competencia', 3))),
    seguimiento: si('Seguir adjudicación de mis postulaciones (SI/NO)', 'SI'),
    rutPropio: String(val('RUT de mi empresa (opcional)', '')).trim(),
    topCorreo: Math.max(1, num('Oportunidades en el correo', 10)),
    adjudicacionesRubro: si('Adjudicaciones de mi rubro (SI/NO)', 'SI'),
    claves: claves,
    excluir: col(7).map(function (x) { return String(x || '').trim(); }).filter(String),
    regiones: col(9).map(function (x) { return String(x || '').trim(); }).filter(String),
    organismos: organismos,
    rubros: rubros
  };
}

// ================================================================ utilidades de hojas
function hoja_(nombre) { const ss = SpreadsheetApp.getActiveSpreadsheet(); return ss.getSheetByName(nombre) || ss.insertSheet(nombre); }
function datos_(nombre, ncol) { const h = hoja_(nombre); const n = h.getLastRow() - 1; return n > 0 ? h.getRange(2, 1, n, ncol).getValues() : []; }
function filasLic_() { return datos_(HOJAS.LIC, LIC_COLS.length).filter(function (f) { return String(f[0]).trim(); }); }
function agregarFilas_(nombre, filas, ncol) { if (!filas || !filas.length) return; const h = hoja_(nombre); h.getRange(h.getLastRow() + 1, 1, filas.length, ncol).setValues(filas); }
function agregarHistorial_(filas) { agregarFilas_(HOJAS.HIST, filas, HIST_COLS.length); }
function indiceCodigos_(h) {
  const out = {}; const n = h.getLastRow() - 1;
  if (n > 0) h.getRange(2, 1, n, 1).getValues().forEach(function (r, i) { if (r[0]) out[String(r[0]).trim()] = i + 2; });
  return out;
}
function indiceVistas_() { const out = {}; datos_(HOJAS.VISTAS, 1).forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = true; }); return out; }
function indiceHechos_() {
  const out = {}; const h = hoja_(HOJAS.HECHOS); const n = h.getLastRow();
  if (n > 0) h.getRange(1, 1, n, 1).getValues().forEach(function (r) { if (r[0]) out[String(r[0])] = 'ok'; });
  return out;
}
function leerEstado_() { const s = PropertiesService.getScriptProperties().getProperty(RADAR.PROP_ESTADO); try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function guardarEstado_(e) { PropertiesService.getScriptProperties().setProperty(RADAR.PROP_ESTADO, JSON.stringify(e)); }

function registrar_(nivel, fase, mensaje, st, t0) {
  st = st || {};
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJAS.REG);
  const fila = [new Date(), nivel, fase, ocultarTicket_(mensaje), st.activas || 0, st.candidatas || 0, st.fichas || 0, st.nuevas || 0,
    st.competencia || 0, llamadasHoy_(), t0 ? Math.round((Date.now() - t0) / 1000) : ''];
  if (h) h.appendRow(fila);
  console.log(nivel + ' · ' + fase + ' · ' + ocultarTicket_(mensaje));
}

// ================================================================ utilidades
function ocultarTicket_(s) { return String(s).replace(/ticket=[^&\s]+/gi, 'ticket=***').replace(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi, '***'); }
/** «2026-11-19T15:00:00» (hora local informada por la API) → Date en hora de Chile, sin conversiones de zona. */
function fechaLocal_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return '';
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
function diasAl_(d) { return (d instanceof Date) ? Math.round((d.getTime() - Date.now()) / 864e5 * 10) / 10 : ''; }
function letra_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function fmtFecha_(d) { return (d instanceof Date) ? Utilities.formatDate(d, RADAR.ZONA, 'dd-MM-yyyy HH:mm') : String(d || ''); }
function ahoraTexto_() { return Utilities.formatDate(new Date(), RADAR.ZONA, 'dd-MM-yyyy HH:mm'); }
function hoyTexto_() { return Utilities.formatDate(new Date(), RADAR.ZONA, 'yyyy-MM-dd'); }
function miles_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
