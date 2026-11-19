// Simulador mínimo de Google Apps Script para probar Code.gs en Node (sin Google).
// Uso: node prueba_radar.js   (pruebas con datos guardados)   ·  REAL=1 node prueba_real.js (consulta real, solo lectura)
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process');

function crearEntorno(opciones) {
  opciones = opciones || {};
  const hojas = {};
  const correos = [], esperas = [], llamadas = [], triggers = [];
  const props = {};
  function Sheet(nombre) {
    this.nombre = nombre; this.datos = []; this.oculta = false;
  }
  Sheet.prototype.getName = function () { return this.nombre; };
  Sheet.prototype.getLastRow = function () {
    for (let i = this.datos.length - 1; i >= 0; i--) if ((this.datos[i] || []).some(v => v !== '' && v != null)) return i + 1;
    return 0;
  };
  Sheet.prototype.getLastColumn = function () { return Math.max(0, ...this.datos.map(r => (r || []).length)); };
  Sheet.prototype._get = function (r, c) { return ((this.datos[r - 1] || [])[c - 1]); };
  Sheet.prototype._set = function (r, c, v) { while (this.datos.length < r) this.datos.push([]); const fila = this.datos[r - 1]; while (fila.length < c) fila.push(''); fila[c - 1] = v; };
  Sheet.prototype.getRange = function (r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); };
  Sheet.prototype.getDataRange = function () { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); };
  Sheet.prototype.appendRow = function (fila) { const r = this.getLastRow() + 1; fila.forEach((v, i) => this._set(r, i + 1, v)); return this; };
  Sheet.prototype.setFrozenRows = function () { return this; };
  Sheet.prototype.hideSheet = function () { this.oculta = true; return this; };
  function Range(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Range.prototype.getValues = function () {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const f = []; for (let j = 0; j < this.nc; j++) { const v = this.sh._get(this.r + i, this.c + j); f.push(v === undefined ? '' : v); } out.push(f); }
    return out;
  };
  Range.prototype.setValues = function (v) {
    if (v.length !== this.nr || v.some(f => f.length !== this.nc)) throw new Error('setValues: dimensiones no coinciden ' + v.length + 'x' + (v[0] || []).length + ' vs ' + this.nr + 'x' + this.nc);
    v.forEach((f, i) => f.forEach((x, j) => this.sh._set(this.r + i, this.c + j, x))); return this;
  };
  Range.prototype.setFontWeight = function () { return this; };
  const ss = {
    getSheetByName: n => hojas[n] || null,
    insertSheet: n => (hojas[n] = new Sheet(n)),
    getSheets: () => Object.values(hojas)
  };
  const ui = {
    alerts: [], ButtonSet: { OK_CANCEL: 1 }, Button: { OK: 'OK', CANCEL: 'CANCEL' },
    alert: function (m) { this.alerts.push(m); },
    prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => opciones.ticketPrompt || '' }),
    createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} })
  };
  const fmt = (d, tz, patron) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return patron.replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day')).replace('HH', g('hour')).replace('mm', g('minute'));
  };
  function respuesta(code, texto) { return { getResponseCode: () => code, getContentText: () => texto }; }
  const UrlFetchApp = {
    fetch: function (url, op) {
      llamadas.push(url);
      if (opciones.real) {
        let out;
        try { out = cp.execFileSync('curl', ['-sS', '-m', '90', '-w', '\n%{http_code}', url], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }); }
        catch (e) { throw new Error('Fallo de red (curl): ' + e.message); }
        const i = out.lastIndexOf('\n');
        return respuesta(Number(out.slice(i + 1)), out.slice(0, i));
      }
      const r = opciones.responder(url, llamadas.length);
      if (r instanceof Error) throw r;
      return respuesta(r.code, r.body);
    }
  };
  const sandbox = {
    console: { log: m => { if (opciones.verbose) console.log('   [log]', m); } },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui },
    UrlFetchApp,
    Utilities: {
      sleep: ms => { esperas.push(ms); if (opciones.real) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
      formatDate: fmt
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    MailApp: {
      getRemainingDailyQuota: () => (opciones.cuotaCorreo == null ? 100 : opciones.cuotaCorreo),
      sendEmail: o => { if (opciones.correoFalla) throw new Error('Mail caído'); correos.push(o); }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: f => { const t = { f, getHandlerFunction: () => f }; const b = { timeBased: () => b, everyDays: d => (t.dias = d, b), atHour: h => (t.hora = h, b), inTimezone: z => (t.zona = z, b), create: () => (triggers.push(t), t) }; return b; }
    },
    Date, JSON, Math, Number, String, Object, Array, RegExp, encodeURIComponent, parseInt, Error
  };
  vm.createContext(sandbox);
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  vm.runInContext(codigo + '\n;this.__exp = { ejecutarRadar, probarConexion, guardarTicket, activarEjecucionDiaria, prepararHojas, coincide_, normalizar_, fechaLocal_, ocultarTicket_, COLS, C };', sandbox);
  const exp = sandbox.__exp;
  return { ss, hojas, correos, esperas, llamadas, triggers, props, ui, exp, sandbox };
}

function configurar(env, cfg) {
  env.exp.prepararHojas();
  const h = env.hojas['Configuración'];
  h.getRange(2, 2).setValues([[cfg.correo || '']]);
  h.getRange(3, 2).setValues([[cfg.hora == null ? 7 : cfg.hora]]);
  h.getRange(4, 2).setValues([[cfg.sinNovedades || 'SI']]);
  h.getRange(5, 2).setValues([[cfg.maxFichas == null ? 40 : cfg.maxFichas]]);
  h.getRange(6, 2).setValues([[cfg.descripcion || 0]]);
  const listas = [cfg.claves || [], cfg.excluir || [], cfg.regiones || [], cfg.organismos || []];
  listas.forEach((l, j) => l.forEach((v, i) => h.getRange(i + 2, 5 + j).setValues([[v]])));
}

module.exports = { crearEntorno, configurar };
