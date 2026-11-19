// Simulador de Google Apps Script para probar Radar MP Pro (Code.gs) en Node, sin Google.
// Implementa lo que importa para la lógica (valores, fórmulas, activadores, propiedades, caché, correo, URL fetch)
// y registra como «no-op encadenable» todo lo que es solo formato (colores, anchos, etc.).
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process');

function letraACol(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
function parseA1(a1) {
  const m = /^([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?$/.exec(a1.replace(/\$/g, ''));
  if (!m) throw new Error('A1 no soportado: ' + a1);
  const c1 = letraACol(m[1]), r1 = m[2] ? +m[2] : 1;
  const c2 = m[3] ? letraACol(m[3]) : c1, r2 = m[4] ? +m[4] : (m[3] ? 1000 : r1);
  return { r: r1, c: c1, nr: r2 - r1 + 1, nc: c2 - c1 + 1 };
}
function encadenable(registro) {
  const p = new Proxy(function () {}, {
    get(t, prop) {
      if (prop === 'build') return () => Object.assign({}, registro);
      if (typeof prop === 'symbol') return undefined;
      return (...args) => { registro.llamadas.push([prop, args]); return p; };
    }
  });
  return p;
}
function conRespaldo(obj) {
  // Métodos no implementados = no-op que devuelve el mismo objeto (formato, anchos, colores…).
  const px = new Proxy(obj, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
      return (...args) => { (t._noop || (t._noop = [])).push([prop, args]); return px; };
    }
  });
  return px;
}

function crearEntorno(opciones) {
  opciones = opciones || {};
  const reloj = { base: opciones.ahora ? opciones.ahora.getTime() : Date.now(), extra: 0 };
  const ahora = () => opciones.real ? Date.now() : reloj.base + reloj.extra;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(ahora()); else super(...a); }
    static now() { return ahora(); }
  }
  const hojas = {}, orden = [];
  const correos = [], esperas = [], llamadas = [], triggers = [], logs = [];
  const props = {}, cache = {};

  function Sheet(nombre) { this.nombre = nombre; this.datos = []; this.formulas = {}; this.oculta = false; this.charts = []; this.slicers = []; this.reglas = []; this.validaciones = {}; }
  Sheet.prototype.getName = function () { return this.nombre; };
  Sheet.prototype.getLastRow = function () {
    for (let i = this.datos.length - 1; i >= 0; i--) if ((this.datos[i] || []).some(v => v !== '' && v != null)) return i + 1;
    return 0;
  };
  Sheet.prototype.getLastColumn = function () { return Math.max(0, ...this.datos.map(r => (r || []).length)); };
  Sheet.prototype.getMaxRows = function () { return 1000; };
  Sheet.prototype._get = function (r, c) { return ((this.datos[r - 1] || [])[c - 1]); };
  Sheet.prototype._set = function (r, c, v) { while (this.datos.length < r) this.datos.push([]); const f = this.datos[r - 1]; while (f.length < c) f.push(''); f[c - 1] = v; };
  Sheet.prototype.getRange = function (r, c, nr, nc) {
    if (typeof r === 'string') { const p = parseA1(r); return rango(this, p.r, p.c, p.nr, p.nc); }
    return rango(this, r, c, nr || 1, nc || 1);
  };
  Sheet.prototype.getDataRange = function () { return rango(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); };
  Sheet.prototype.appendRow = function (fila) { const r = this.getLastRow() + 1; fila.forEach((v, i) => this._set(r, i + 1, v)); return this; };
  Sheet.prototype.clear = function () { this.datos = []; this.formulas = {}; return this; };
  Sheet.prototype.clearContents = Sheet.prototype.clear;
  Sheet.prototype.hideSheet = function () { this.oculta = true; return this; };
  Sheet.prototype.getCharts = function () { return this.charts.slice(); };
  Sheet.prototype.removeChart = function (c) { this.charts.splice(this.charts.indexOf(c), 1); };
  Sheet.prototype.newChart = function () { return encadenable({ tipo: 'chart', llamadas: [] }); };
  Sheet.prototype.insertChart = function (c) { this.charts.push(c); return c; };
  Sheet.prototype.getSlicers = function () { return this.slicers.slice(); };
  Sheet.prototype.insertSlicer = function (r, fila, col) {
    const hoja = this; const s = conRespaldo({ rango: r, fila, col, remove() { hoja.slicers.splice(hoja.slicers.indexOf(s), 1); } });
    this.slicers.push(s); return s;
  };
  Sheet.prototype.setConditionalFormatRules = function (r) { this.reglas = r; return this; };
  Sheet.prototype.getConditionalFormatRules = function () { return this.reglas; };

  function rango(sh, r, c, nr, nc) {
    const R = {
      sh, r, c, nr, nc,
      getSheet: () => hojaPx(sh), getRow: () => r, getColumn: () => c, getNumRows: () => nr, getNumColumns: () => nc,
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) { const f = []; for (let j = 0; j < nc; j++) { const v = sh._get(r + i, c + j); f.push(v === undefined ? '' : v); } out.push(f); }
        return out;
      },
      getValue() { const v = sh._get(r, c); return v === undefined ? '' : v; },
      setValues(v) {
        if (v.length !== nr || v.some(f => f.length !== nc)) throw new Error('setValues: dimensiones ' + v.length + 'x' + (v[0] || []).length + ' vs ' + nr + 'x' + nc + ' en ' + sh.nombre);
        v.forEach((f, i) => f.forEach((x, j) => { if (x instanceof RealDate === false && x && typeof x === 'object') throw new Error('valor no serializable en ' + sh.nombre); sh._set(r + i, c + j, x); }));
        return px;
      },
      setValue(v) { sh._set(r, c, v); return px; },
      setFormula(f) { sh.formulas[r + ',' + c] = f; sh._set(r, c, '=' === f[0] ? '(fórmula)' : f); return px; },
      getFormula() { return sh.formulas[r + ',' + c] || ''; },
      setDataValidation(v) { sh.validaciones[r + ',' + c + ',' + nr + ',' + nc] = v; return px; },
      offset(dr, dc, nnr, nnc) { return rango(sh, r + dr, c + dc, nnr || nr, nnc || nc); }
    };
    const px = conRespaldo(R);
    return px;
  }
  const pxCache = new Map();
  function hojaPx(sh) { if (!pxCache.has(sh)) pxCache.set(sh, conRespaldo(sh)); return pxCache.get(sh); }
  const ss = conRespaldo({
    getSheetByName: n => hojas[n] ? hojaPx(hojas[n]) : null,
    insertSheet: (n, idx) => { if (hojas[n]) throw new Error('hoja duplicada ' + n); hojas[n] = new Sheet(n); if (idx === 0) orden.unshift(n); else orden.push(n); return hojaPx(hojas[n]); },
    getSheets: () => orden.map(n => hojaPx(hojas[n])),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/EJEMPLO/edit',
    setActiveSheet: s => s
  });
  const ui = {
    alerts: [], ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'OK', CANCEL: 'CANCEL' },
    alert(m) { this.alerts.push(m); },
    prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => opciones.ticketPrompt || '' }),
    createMenu: () => encadenable({ llamadas: [] })
  };
  const fmt = (d, tz, patron) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return patron.replace("'T'", 'T').replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day')).replace('HH', g('hour')).replace('mm', g('minute')).replace('ss', g('second'));
  };
  function respuesta(code, texto) { return { getResponseCode: () => code, getContentText: () => texto }; }
  const UrlFetchApp = {
    fetch(url) {
      llamadas.push(url);
      if (opciones.real) {
        let out;
        try { out = cp.execFileSync('curl', ['-sS', '-m', '120', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 }); }
        catch (e) { throw new Error('Fallo de red (curl): ' + e.message); }
        const i = out.lastIndexOf('\n');
        if (opciones.alResponder) opciones.alResponder(url, Number(out.slice(i + 1)));
        return respuesta(Number(out.slice(i + 1)), out.slice(0, i));
      }
      reloj.extra += (opciones.latenciaMs || 500);
      const r = opciones.responder(url, llamadas.length);
      if (r instanceof Error) throw r;
      return respuesta(r.code, typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    }
  };
  const sandbox = {
    console: { log: m => { logs.push(m); if (opciones.verbose) console.log('   [log]', m); } },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, getUi: () => ui,
      newDataValidation: () => encadenable({ tipo: 'validacion', llamadas: [] }),
      newConditionalFormatRule: () => encadenable({ tipo: 'regla', llamadas: [] }),
      InterpolationType: { NUMBER: 'NUMBER' }
    },
    Charts: { ChartType: { BAR: 'BAR', PIE: 'PIE', COLUMN: 'COLUMN', LINE: 'LINE' } },
    UrlFetchApp,
    Utilities: {
      sleep: ms => { esperas.push(ms); if (opciones.real) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); else reloj.extra += ms; },
      formatDate: fmt
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) },
    MailApp: {
      getRemainingDailyQuota: () => (opciones.cuotaCorreo == null ? 100 : opciones.cuotaCorreo),
      sendEmail: o => { if (opciones.correoFalla) throw new Error('Mail caído'); correos.push(o); }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => !opciones.bloqueado, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: f => {
        const t = { f, getHandlerFunction: () => f };
        const b = { timeBased: () => b, everyDays: d => (t.dias = d, b), atHour: h => (t.hora = h, b), inTimezone: z => (t.zona = z, b), after: ms => (t.despuesMs = ms, b), create: () => (triggers.push(t), t) };
        return b;
      }
    },
    Date: FakeDate, JSON, Math, Number, String, Object, Array, RegExp, encodeURIComponent, parseInt, Error, isNaN, Map, Set
  };
  vm.createContext(sandbox);
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'apps_script', 'Code.gs'), 'utf8');
  const exportar = ['instalarRadar', 'prepararHojas', 'construirDashboard', 'ejecutarRadar', 'continuarRadar', 'actualizarCompetencia', 'probarConexion',
    'guardarTicket', 'exportarPowerBI', 'enviarCorreoPrueba', 'activarEjecucionDiaria', 'desactivarTodo', 'onEdit', 'onOpen', 'verEstado',
    'evaluar_', 'leerConfig_', 'coincide_', 'normalizar_', 'fechaLocal_', 'ocultarTicket_', 'letra_', 'lineasOC_', 'lineasAdjudicacion_', 'resultadoAdjudicacion_',
    'LIC_COLS', 'L', 'HOJAS', 'ITEM_COLS', 'COMP_COLS', 'RADAR', 'PBI_LIC_COLS'];
  vm.runInContext(codigo + '\n;this.__exp = {' + exportar.map(n => n + ':' + n).join(',') + '};', sandbox);
  const exp = sandbox.__exp;
  const tabla = n => hojas[n] ? hojas[n].getDataRange().getValues ? rango(hojas[n], 1, 1, Math.max(1, hojas[n].getLastRow()), Math.max(1, hojas[n].getLastColumn())).getValues() : [] : [];
  return { ss, hojas, correos, esperas, llamadas, triggers, props, cache, ui, exp, sandbox, reloj, logs, tabla, FakeDate };
}

/** Escribe la configuración como lo haría el usuario en la hoja. */
function configurar(env, cfg) {
  env.exp.prepararHojas();
  const h = env.ss.getSheetByName('Configuración');
  const set = (fila, v) => h.getRange(fila, 2).setValue(v);
  set(2, cfg.correo || '');
  if (cfg.hora != null) set(3, cfg.hora);
  if (cfg.puntajeMin != null) set(4, cfg.puntajeMin);
  if (cfg.fichasPorLote != null) set(5, cfg.fichasPorLote);
  if (cfg.maxFichasDia != null) set(6, cfg.maxFichasDia);
  if (cfg.amplia != null) set(7, cfg.amplia);
  if (cfg.montoMin != null) set(8, cfg.montoMin);
  if (cfg.montoMax != null) set(9, cfg.montoMax);
  if (cfg.diasMinCierre != null) set(10, cfg.diasMinCierre);
  if (cfg.avisar != null) set(11, cfg.avisar);
  if (cfg.diasCompetencia != null) set(12, cfg.diasCompetencia);
  if (cfg.seguimiento != null) set(13, cfg.seguimiento);
  if (cfg.rut != null) set(14, cfg.rut);
  if (cfg.adjRubro != null) set(16, cfg.adjRubro);
  // limpia listas y escribe las nuevas
  for (let r = 2; r <= 60; r++) for (const c of [5, 6, 8, 10, 12, 13, 15, 16]) h.getRange(r, c).setValue('');
  (cfg.claves || []).forEach((k, i) => { h.getRange(i + 2, 5).setValue(k[0]); h.getRange(i + 2, 6).setValue(k[1]); });
  (cfg.excluir || []).forEach((v, i) => h.getRange(i + 2, 8).setValue(v));
  (cfg.regiones || []).forEach((v, i) => h.getRange(i + 2, 10).setValue(v));
  (cfg.organismos || []).forEach((v, i) => h.getRange(i + 2, 12).setValue(v));
  (cfg.rubros || []).forEach((v, i) => { h.getRange(i + 2, 15).setValue(v[0]); h.getRange(i + 2, 16).setValue(v[1]); });
}

module.exports = { crearEntorno, configurar, parseA1 };
