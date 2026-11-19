'use strict';
// Pruebas de Radar MP Pro con respuestas reales de la API, saneadas sin datos personales (pruebas/fixtures) y un simulador de Apps Script.
// Uso: node prueba_radar_pro.js
process.env.TZ = 'America/Santiago';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { crearEntorno, configurar } = require('./simulador_gas_pro');
const D = path.join(__dirname, 'fixtures');
const TICKET = require('crypto').randomUUID().toUpperCase(); // ticket ficticio generado al vuelo (formato válido): estas pruebas no salen a internet
const AHORA = new Date(2026, 10, 18, 22, 30); // 18-11-2026 22:30 hora de Chile (momento de la descarga real)

// ---------- datos reales guardados
const archivoActivas = fs.readdirSync(D).filter(f => /^activas_\d+\.json$/.test(f)).sort().pop();
const ACTIVAS = JSON.parse(fs.readFileSync(path.join(D, archivoActivas), 'utf8'));
const FICHAS = {};
fs.readdirSync(D).filter(f => /^(ficha|adjdet)_.*\.json$/.test(f)).forEach(f => { const l = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')).Listado[0]; if (l) FICHAS[l.CodigoExterno] = l; });
const OC_LISTAS = {}, OC_DET = {}, ADJ_LISTAS = {};
fs.readdirSync(D).filter(f => /^adjudicadas_\d+\.json$/.test(f)).forEach(f => { const m = /(\d{4})(\d{2})(\d{2})/.exec(f); ADJ_LISTAS[m[3] + m[2] + m[1]] = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); });
fs.readdirSync(D).filter(f => /^oc_\d+_\d+\.json$/.test(f)).forEach(f => { const m = /^oc_(\d+)_(\d{4})(\d{2})(\d{2})\.json$/.exec(f); OC_LISTAS[m[1] + '|' + m[4] + m[3] + m[2]] = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); });
fs.readdirSync(D).filter(f => /^ocdet_.*\.json$/.test(f)).forEach(f => { const o = JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')).Listado[0]; if (o) OC_DET[o.Codigo] = o; });
// Lista de activas de prueba: las que tienen ficha guardada + 300 que no calzan (para medir el filtro).
const conFicha = ACTIVAS.Listado.filter(l => FICHAS[l.CodigoExterno]);
const PERFIL0 = JSON.parse(fs.readFileSync(path.join(__dirname, 'perfil_muestra.json'), 'utf8'));
const norm = s => ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim() + ' ';
const calzaNombre = n => PERFIL0.claves.some(k => { const p = k.palabra.endsWith('*'), kk = norm(k.palabra.replace(/\*$/, '')).trim(); return p ? norm(n).includes(' ' + kk) : norm(n).includes(' ' + kk + ' '); });
const LISTA = conFicha.concat(ACTIVAS.Listado.filter(l => !FICHAS[l.CodigoExterno] && !calzaNombre(l.Nombre)).slice(0, 300));
const PERFIL = JSON.parse(fs.readFileSync(path.join(__dirname, 'perfil_muestra.json'), 'utf8'));
const CLAVES = PERFIL.claves.map(k => [k.palabra, k.peso]);

function q(url) { const u = new URL(url); const o = {}; u.searchParams.forEach((v, k) => { o[k] = v; }); o.recurso = u.pathname.split('/').pop(); return o; }
function responderNormal(extra) {
  return (url, n) => {
    if (extra) { const r = extra(url, n); if (r) return r; }
    const p = q(url);
    if (p.recurso === 'licitaciones.json' && p.estado === 'activas' && p.CodigoOrganismo) {
      return { code: 200, body: { Cantidad: 0, Listado: Object.values(FICHAS).filter(f => String(f.Comprador.CodigoOrganismo) === p.CodigoOrganismo && LISTA.some(l => l.CodigoExterno === f.CodigoExterno)).map(f => ({ CodigoExterno: f.CodigoExterno, Nombre: f.Nombre, CodigoEstado: 5, FechaCierre: f.Fechas.FechaCierre })) } };
    }
    if (p.recurso === 'licitaciones.json' && p.estado === 'adjudicada') return { code: 200, body: ADJ_LISTAS[p.fecha] || { Cantidad: 0, Listado: [] } };
    if (p.recurso === 'licitaciones.json' && p.estado === 'activas') return { code: 200, body: { Cantidad: LISTA.length, Listado: LISTA } };
    if (p.recurso === 'licitaciones.json' && p.codigo) return { code: 200, body: { Cantidad: FICHAS[p.codigo] ? 1 : 0, Listado: FICHAS[p.codigo] ? [FICHAS[p.codigo]] : [] } };
    if (p.recurso === 'ordenesdecompra.json' && p.codigo) return { code: 200, body: { Cantidad: 1, Listado: OC_DET[p.codigo] ? [OC_DET[p.codigo]] : [] } };
    if (p.recurso === 'ordenesdecompra.json' && p.fecha) { const l = OC_LISTAS[p.CodigoOrganismo + '|' + p.fecha]; return { code: 200, body: l ? { Cantidad: l.Cantidad, Listado: l.Listado.filter(o => OC_DET[o.Codigo]) } : { Cantidad: 0, Listado: [] } }; } // solo OC cuya ficha real está guardada
    return { code: 404, body: { Codigo: 404, Mensaje: 'no simulado' } };
  };
}
function nuevoEntorno(op) { return crearEntorno(Object.assign({ ahora: AHORA, responder: responderNormal() }, op || {})); }
function listo(env, cfg) { env.exp.instalarRadar(); configurar(env, Object.assign({ correo: 'equipo@ejemplo.cl', claves: CLAVES, excluir: PERFIL.excluir }, cfg || {})); env.props.MP_TICKET = TICKET; }
function cicloCompleto(env, max) { env.exp.ejecutarRadar(); let k = 0; while (env.triggers.some(t => t.f === 'continuarRadar') && k++ < (max || 50)) env.exp.continuarRadar(); return k; }
const lic = env => env.tabla('Licitaciones').slice(1).filter(r => r[0]);
const reg = env => env.tabla('Registro').slice(1);
const col = n => require('./simulador_gas_pro') && LCOLS.indexOf(n);
let LCOLS = null;

let ok = 0, fallas = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ✔ ' + nombre); }
  catch (e) { fallas++; console.log('  ✘ ' + nombre + '\n      ' + (e && e.stack || e).split('\n').slice(0, 3).join('\n      ')); }
}
console.log('Radar MP Pro · pruebas con datos reales guardados (' + archivoActivas + ': ' + ACTIVAS.Listado.length + ' activas, ' + Object.keys(FICHAS).length + ' fichas, ' + Object.keys(OC_DET).length + ' OC)\n');

prueba('instalador de un clic: hojas, dashboard con 6 gráficos, 2 segmentadores, activador diario', () => {
  const env = nuevoEntorno(); env.exp.instalarRadar();
  LCOLS = env.exp.LIC_COLS;
  ['Inicio', 'Configuración', 'Licitaciones', 'Ítems', 'Competencia', 'Historial', 'Registro', 'Dashboard', '_dash', '_cola', '_vistas', '_hechos'].forEach(h => assert.ok(env.hojas[h], 'falta ' + h));
  assert.strictEqual(env.hojas.Dashboard.charts.length, 6);
  assert.strictEqual(env.hojas.Licitaciones.slicers.length, 2);
  assert.deepStrictEqual(env.triggers.map(t => [t.f, t.hora, t.zona]), [['ejecutarRadar', 6, 'America/Santiago']]);
  assert.ok(env.hojas._dash.oculta && env.hojas._cola.oculta);
  assert.ok(env.hojas.Licitaciones.reglas.length >= 10, 'formato condicional');
  // reinstalar no duplica activadores ni gráficos
  env.exp.instalarRadar();
  assert.strictEqual(env.triggers.length, 1); assert.strictEqual(env.hojas.Dashboard.charts.length, 6); assert.strictEqual(env.hojas.Licitaciones.slicers.length, 2);
});

prueba('dashboard: fórmulas apuntan a las columnas correctas (Región, Etapa, Puntaje, Días al cierre)', () => {
  const env = nuevoEntorno(); env.exp.instalarRadar();
  const L = env.exp.L, letra = env.exp.letra_;
  const f = env.hojas._dash.formulas['2,1'];
  assert.ok(f.startsWith('=IFERROR(FILTER({'));
  ['Región', 'Etapa', 'Puntaje', 'Días al cierre'].forEach(n => assert.ok(f.includes("'Licitaciones'!" + letra(L[n] + 1) + '2:' + letra(L[n] + 1)), n));
  assert.strictEqual(letra(L['Región'] + 1), 'J'); assert.strictEqual(letra(L['Etapa'] + 1), 'AC');
  const d = env.hojas.Dashboard.formulas;
  assert.ok(/SPARKLINE/.test(d['8,3']) && /QUERY/.test(d['11,1']));
  assert.ok(Object.keys(env.hojas.Dashboard.validaciones).length >= 4, 'controles con desplegable');
});

prueba('ciclo completo con datos reales: fichas, puntaje, ítems, historial, PBI y correo', () => {
  const env = nuevoEntorno(); listo(env);
  cicloCompleto(env);
  const filas = lic(env), L = env.exp.L;
  assert.ok(filas.length >= 10, 'filas: ' + filas.length);
  filas.forEach(f => {
    assert.ok(f[L['Puntaje']] >= 0 && f[L['Puntaje']] <= 100);
    assert.ok(f[L['Organismo']] && f[L['Región']], 'organismo y región desde la ficha');
    assert.ok(f[L['Cierre']] instanceof Date);
    assert.strictEqual(f[L['Etapa']], 'Nueva');
    assert.ok(f[L['Ficha']].startsWith('https://www.mercadopublico.cl/'));
  });
  // ítems = suma de ítems de las fichas incorporadas
  const esperados = filas.reduce((s, f) => s + (FICHAS[f[0]].Items.Listado.length), 0);
  assert.strictEqual(env.tabla('Ítems').length - 1, esperados);
  assert.strictEqual(env.tabla('Historial').slice(1).filter(r => r[2] === 'Detectada').length, filas.length);
  assert.strictEqual(env.tabla('PBI_Licitaciones').length - 1, filas.length);
  assert.strictEqual(JSON.stringify(env.tabla('PBI_Licitaciones')[0]), JSON.stringify(env.exp.PBI_LIC_COLS));
  assert.ok(!env.exp.PBI_LIC_COLS.some(c => /nota|respons/i.test(c)), 'PBI sin notas internas');
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(env.tabla('PBI_Licitaciones')[1][13]), 'fecha ISO');
  assert.strictEqual(env.correos.length, 1);
  assert.ok(/Radar MP Pro · \d+ nueva/.test(env.correos[0].subject));
  assert.ok(env.correos[0].htmlBody.includes('Mejores oportunidades') && env.correos[0].htmlBody.includes('Cierran en los próximos 7 días'));
  assert.ok(reg(env).some(r => r[3] === 'Ciclo completo'));
  // la exclusión se respeta
  assert.ok(!filas.some(f => /vehiculo|ascensor/i.test(env.exp.normalizar_(f[1]))));
});

prueba('no hay duplicados ni re-consultas: un segundo ciclo no vuelve a pedir fichas ya vistas', () => {
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 0 });
  cicloCompleto(env);
  const n1 = lic(env).length, l1 = env.llamadas.length;
  env.cache && Object.keys(env.cache).forEach(k => delete env.cache[k]);
  cicloCompleto(env);
  assert.strictEqual(lic(env).length, n1);
  const fichas2 = env.llamadas.slice(l1).filter(u => /codigo=/.test(u)).length;
  assert.strictEqual(fichas2, 0, 'fichas pedidas de nuevo: ' + fichas2);
});

prueba('columnas del equipo (Etapa, Responsable, Notas) nunca se sobrescriben', () => {
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 0 });
  cicloCompleto(env);
  const h = env.hojas.Licitaciones, L = env.exp.L;
  h._set(2, L['Etapa'] + 1, 'Revisar'); h._set(2, L['Responsable'] + 1, 'Ana'); h._set(2, L['Notas'] + 1, 'pedir visita a terreno');
  cicloCompleto(env);
  assert.deepStrictEqual([h._get(2, L['Etapa'] + 1), h._get(2, L['Responsable'] + 1), h._get(2, L['Notas'] + 1)], ['Revisar', 'Ana', 'pedir visita a terreno']);
});

prueba('puntaje: nombre pesa más que descripción e ítems; región, organismo favorito, monto y cierre ajustan', () => {
  const env = nuevoEntorno(); env.exp.prepararHojas();
  const base = { Nombre: 'SERVICIO DE ASEO EDIFICIO', Descripcion: 'contratación de limpieza', Comprador: { RegionUnidad: 'Región del Biobío ', CodigoOrganismo: '7248' },
    VisibilidadMonto: 1, MontoEstimado: 5000000, Fechas: { FechaCierre: '2026-12-10T15:00:00' }, Items: { Listado: [{ NombreProducto: 'Servicios de calibración', CodigoProducto: 81141504, CodigoCategoria: '81141500' }] } };
  const cfg = { claves: [{ palabra: 'aseo*', peso: 3 }, { palabra: 'limpieza', peso: 3 }, { palabra: 'calibracion', peso: 2 }], excluir: [], regiones: [], organismos: [], rubros: [], montoMin: 0, montoMax: 0, diasMinCierre: 3 };
  let e = env.exp.evaluar_(base, cfg);
  assert.strictEqual(e.puntaje, 36 + 24 + 12, e.motivos); // 3×3×4 + 3×2×4 + 2×1,5×4
  assert.ok(/aseo\* en nombre/.test(e.motivos) && /limpieza en descripción/.test(e.motivos) && /calibracion en ítems/.test(e.motivos));
  e = env.exp.evaluar_(base, Object.assign({}, cfg, { regiones: ['Región del Biobío'], organismos: [{ codigo: '7248' }], montoMin: 1000000, montoMax: 10000000, rubros: [{ prefijo: '8114', peso: 2 }] }));
  assert.strictEqual(e.puntaje, 100); // 72 + 10 + 15 + 5 + 12 → tope 100
  e = env.exp.evaluar_(base, Object.assign({}, cfg, { regiones: ['Región de Atacama'] }));
  assert.strictEqual(e.puntaje, 72 - 20);
  e = env.exp.evaluar_(Object.assign({}, base, { Fechas: { FechaCierre: '2026-11-19T15:00:00' } }), cfg);
  assert.strictEqual(e.puntaje, 72 - 30, 'cierra mañana');
  e = env.exp.evaluar_(Object.assign({}, base, { VisibilidadMonto: 0 }), Object.assign({}, cfg, { montoMin: 9e9 }));
  assert.strictEqual(e.puntaje, 72, 'monto oculto no penaliza');
  e = env.exp.evaluar_(base, Object.assign({}, cfg, { excluir: ['edificio'] }));
  assert.ok(e.excluida && e.puntaje === 0);
});

prueba('búsqueda amplia: lee fichas que no calzan por nombre y solo agrega las que superan el puntaje mínimo', () => {
  const env = nuevoEntorno(); listo(env, { amplia: 'SI', puntajeMin: 30, diasCompetencia: 0, fichasPorLote: 500 });
  cicloCompleto(env);
  const vistas = env.tabla('_vistas').filter(r => r[0]);
  assert.ok(vistas.length > lic(env).length, 'leyó más fichas de las que agregó');
  assert.ok(lic(env).every(f => f[env.exp.L['Puntaje']] >= 30 || /nombre/.test(env.tabla('Historial').find(h => h[1] === f[0])[5])));
});

prueba('reanudable: con API lenta corta antes de 6 min, programa continuación y termina sin duplicar', () => {
  const env = nuevoEntorno({ latenciaMs: 20000 }); listo(env, { diasCompetencia: 0, fichasPorLote: 500 });
  env.exp.ejecutarRadar();
  assert.ok(env.triggers.some(t => t.f === 'continuarRadar' && t.despuesMs === 60000), 'continuación programada');
  assert.ok(reg(env).some(r => /continúa en 1 minuto/.test(r[3])));
  const enCola = env.tabla('_cola').length - 1;
  assert.ok(enCola > 0, 'quedó cola pendiente');
  const vueltas = cicloCompleto(env) ; // ejecutarRadar reinicia; seguimos hasta terminar
  assert.ok(!env.triggers.some(t => t.f === 'continuarRadar'));
  const cods = lic(env).map(f => f[0]);
  assert.strictEqual(new Set(cods).size, cods.length, 'sin duplicados');
  assert.ok(vueltas >= 1);
});

prueba('lote máximo de fichas: respeta «Fichas por lote» y continúa', () => {
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 0, fichasPorLote: 5 });
  env.exp.ejecutarRadar();
  assert.strictEqual(env.llamadas.filter(u => /codigo=/.test(u)).length, 5);
  assert.ok(env.triggers.some(t => t.f === 'continuarRadar'));
});

prueba('429 «peticiones simultáneas»: reintenta con espera y sigue', () => {
  let veces = 0;
  const env = nuevoEntorno({ responder: responderNormal((url) => (/estado=activas/.test(url) && veces++ < 2) ? { code: 429, body: { Codigo: 10500, Mensaje: 'Lo sentimos. Hemos detectado que existen peticiones simultáneas.' } } : null) });
  listo(env, { diasCompetencia: 0 });
  cicloCompleto(env);
  assert.ok(env.esperas.includes(10000) && env.esperas.includes(30000));
  assert.ok(lic(env).length > 0);
});

prueba('429 persistente sin tiempo para reintentar: la ficha queda en cola (no se pierde ni se marca como vista)', () => {
  const env = nuevoEntorno({ latenciaMs: 1000, responder: responderNormal((url) => /codigo=/.test(url) ? { code: 429, body: { Codigo: 10500, Mensaje: 'simultáneas' } } : null) });
  listo(env, { diasCompetencia: 0 });
  env.exp.ejecutarRadar();
  assert.strictEqual(lic(env).length, 0);
  assert.ok(env.tabla('_cola').length - 1 > 0);
  assert.strictEqual(env.tabla('_vistas').filter(r => r[0]).length, 0);
});

prueba('ticket no válido (203): no insiste, registra ERROR y avisa por correo', () => {
  const env = nuevoEntorno({ responder: () => ({ code: 200, body: { Codigo: 203, Mensaje: 'Ticket no válido.' } }) });
  listo(env);
  env.exp.ejecutarRadar();
  assert.strictEqual(env.llamadas.length, 1);
  assert.ok(reg(env).some(r => r[1] === 'ERROR' && /revisa tu ticket/.test(r[3])));
  assert.ok(/FALLÓ/.test(env.correos[0].subject));
});

prueba('caída de red en activas: es ERROR (nunca «sin novedades»)', () => {
  const env = nuevoEntorno({ responder: () => new Error('DNS caído') });
  listo(env);
  env.exp.ejecutarRadar();
  assert.ok(reg(env).some(r => r[1] === 'ERROR' && /error de red/.test(r[3])));
  assert.ok(env.correos.every(c => !/sin novedades/i.test(c.subject)));
});

prueba('el ticket no aparece en hojas, correos ni registro', () => {
  const env = nuevoEntorno({ responder: responderNormal((url, n) => n === 3 ? new Error('falló ' + url) : null) });
  listo(env, { diasCompetencia: 1, organismos: ['7248'] });
  cicloCompleto(env);
  const todo = JSON.stringify(Object.values(env.hojas).map(h => h.datos)) + JSON.stringify(env.correos) + JSON.stringify(env.logs);
  assert.ok(!todo.includes(TICKET));
});

prueba('cambios en activas: nuevo cierre y licitación que desaparece quedan en Historial', () => {
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 0 });
  cicloCompleto(env);
  const [a, b] = lic(env).map(f => f[0]);
  const original = LISTA.slice();
  LISTA.length = 0;
  original.forEach(l => { if (l.CodigoExterno === b) return; LISTA.push(l.CodigoExterno === a ? Object.assign({}, l, { FechaCierre: '2026-12-30T15:00:00' }) : l); });
  try {
    env.exp.ejecutarRadar();
    const h = env.tabla('Historial');
    assert.ok(h.some(r => r[1] === a && r[2] === 'Cambio de cierre'));
    assert.ok(h.some(r => r[1] === b && r[2] === 'Dejó de estar activa'));
    const fb = lic(env).find(f => f[0] === b);
    assert.strictEqual(fb[env.exp.L['Estado MP']], 'No activa');
  } finally { LISTA.length = 0; original.forEach(l => LISTA.push(l)); }
});

prueba('onEdit: cambiar la Etapa queda en Historial', () => {
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 0 });
  cicloCompleto(env);
  const h = env.ss.getSheetByName('Licitaciones');
  env.exp.onEdit({ range: h.getRange(2, env.exp.L['Etapa'] + 1), oldValue: 'Nueva', value: 'Postular' });
  assert.ok(env.tabla('Historial').some(r => r[2] === 'Cambio de etapa' && r[3] === 'Nueva' && r[4] === 'Postular'));
});

prueba('seguimiento: una postulada ya cerrada se relee y anota el adjudicatario (y GANADA con tu RUT)', () => {
  const adj = Object.values(FICHAS).find(f => f.Items && f.Items.Listado.some(it => it.Adjudicacion && it.Adjudicacion.NombreProveedor));
  assert.ok(adj, 'hay una licitación adjudicada en fixtures');
  const rut = adj.Items.Listado.find(it => it.Adjudicacion).Adjudicacion.RutProveedor;
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 0, rut: rut });
  cicloCompleto(env);
  // simula que el equipo postuló a una licitación (fila existente) cuyo código es el de la adjudicada
  const h = env.hojas.Licitaciones, L = env.exp.L, fila = h.getLastRow() + 1;
  h._set(fila, 1, adj.CodigoExterno); h._set(fila, L['Cierre'] + 1, new env.sandbox.Date(2026, 9, 1)); h._set(fila, L['Estado MP'] + 1, 'Cerrada'); h._set(fila, L['Etapa'] + 1, 'Postulada');
  cicloCompleto(env);
  const res = h._get(fila, L['Resultado adjudicación'] + 1);
  assert.ok(/^GANADA por tu empresa/.test(res), res);
  assert.ok(env.tabla('Competencia').some(r => r[0] === 'Adjudicación' && r[2] === adj.CodigoExterno));
});

prueba('competencia: OC reales de un organismo favorito → proveedor, producto y precio; no repite días ya hechos', () => {
  const orgs = [...new Set(Object.keys(OC_LISTAS).map(k => k.split('|')[0]))];
  assert.ok(orgs.length && Object.keys(OC_DET).length, 'hay OC reales guardadas');
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 2, organismos: orgs, fichasPorLote: 500 });
  cicloCompleto(env);
  const comp = env.tabla('Competencia').slice(1).filter(r => r[0] === 'Orden de compra');
  assert.ok(comp.length > 0);
  comp.forEach(r => { assert.ok(r[7], 'proveedor'); assert.ok(typeof r[12] === 'number'); });
  const l1 = env.llamadas.length;
  env.exp.actualizarCompetencia();
  assert.strictEqual(env.llamadas.slice(l1).filter(u => /ordenesdecompra/.test(u)).length, 0, 'no repite');
});

prueba('adjudicaciones de mi rubro: lista real de adjudicadas → solo las que calzan → proveedor, precio y n° de oferentes', () => {
  const fechaAdj = Object.keys(ADJ_LISTAS)[0];
  assert.ok(fechaAdj, 'hay lista real de adjudicadas');
  const conFichaAdj = ADJ_LISTAS[fechaAdj].Listado.filter(l => FICHAS[l.CodigoExterno] && FICHAS[l.CodigoExterno].Estado === 'Adjudicada');
  assert.ok(conFichaAdj.length, 'hay fichas adjudicadas reales');
  const objetivo = conFichaAdj[0];
  const palabra = norm(objetivo.Nombre).trim().split(' ').filter(w => w.length > 5)[0];
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 2, organismos: [], claves: [[palabra, 3]], excluir: [], fichasPorLote: 500 });
  cicloCompleto(env);
  const filas = env.tabla('Competencia').slice(1).filter(r => r[0] === 'Adjudicación');
  assert.ok(filas.some(r => r[2] === objetivo.CodigoExterno), 'aparece ' + objetivo.CodigoExterno + ' (palabra «' + palabra + '»)');
  filas.forEach(r => { assert.ok(r[7] && r[8], 'proveedor y RUT'); assert.ok(typeof r[12] === 'number' && r[12] > 0, 'monto unitario'); });
  const sinCalce = ADJ_LISTAS[fechaAdj].Listado.filter(l => !norm(l.Nombre).includes(' ' + palabra));
  assert.ok(!filas.some(r => sinCalce.some(l => l.CodigoExterno === r[2])), 'no trae adjudicaciones que no calzan');
  assert.ok(/oferentes\)$/.test(env.exp.resultadoAdjudicacion_(FICHAS[objetivo.CodigoExterno], '')));
});

prueba('competencia con rubro UNSPSC: filtra solo las líneas del rubro', () => {
  const orgs = [...new Set(Object.keys(OC_LISTAS).map(k => k.split('|')[0]))];
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 2, organismos: orgs, rubros: [['99999999', 1]], fichasPorLote: 500, adjRubro: 'NO' });
  cicloCompleto(env);
  assert.strictEqual(env.tabla('Competencia').slice(1).filter(r => r[0] === 'Orden de compra').length, 0);
});

prueba('correo: sin dirección → advertencia; sin cuota → no revienta; «avisar = NO» sin novedades → no envía', () => {
  let env = nuevoEntorno(); listo(env, { correo: '', diasCompetencia: 0 }); cicloCompleto(env);
  assert.strictEqual(env.correos.length, 0); assert.ok(reg(env).some(r => /Sin correo/.test(r[3])));
  env = nuevoEntorno({ cuotaCorreo: 0 }); listo(env, { diasCompetencia: 0 }); cicloCompleto(env);
  assert.ok(reg(env).some(r => /Sin cuota/.test(r[3])));
  env = nuevoEntorno(); listo(env, { diasCompetencia: 0, avisar: 'NO', claves: [['palabraquenoexiste', 1]] }); cicloCompleto(env);
  assert.strictEqual(env.correos.length, 0);
});

prueba('tope diario propio de llamadas: se detiene con mensaje claro', () => {
  const env = nuevoEntorno(); listo(env);
  env.props['LLAMADAS_20261118'] = '9000';
  env.exp.ejecutarRadar();
  assert.strictEqual(env.llamadas.length, 0);
  assert.ok(reg(env).some(r => /tope diario propio/.test(r[3])));
});

prueba('sin ticket o sin nada que buscar: error claro y cero llamadas', () => {
  let env = nuevoEntorno(); env.exp.instalarRadar(); configurar(env, { correo: '', claves: CLAVES }); env.exp.ejecutarRadar();
  assert.ok(reg(env).some(r => /No hay ticket/.test(r[3]))); assert.strictEqual(env.llamadas.length, 0);
  env = nuevoEntorno(); env.exp.instalarRadar(); configurar(env, { correo: '', claves: [] }); env.props.MP_TICKET = TICKET; env.exp.ejecutarRadar();
  assert.ok(reg(env).some(r => /nada que buscar/.test(r[3])));
});

prueba('caché: una ficha ya leída en las últimas 6 h no se vuelve a pedir', () => {
  const env = nuevoEntorno(); listo(env, { diasCompetencia: 0 });
  cicloCompleto(env);
  const cod = lic(env)[0][0];
  assert.ok(env.cache['LIC|' + cod]);
});

prueba('guardar ticket valida formato y no lo escribe en la planilla', () => {
  let env = nuevoEntorno({ ticketPrompt: 'hola' }); env.exp.prepararHojas(); env.exp.guardarTicket();
  assert.strictEqual(env.props.MP_TICKET, undefined);
  env = nuevoEntorno({ ticketPrompt: TICKET }); env.exp.prepararHojas(); env.exp.guardarTicket();
  assert.strictEqual(env.props.MP_TICKET, TICKET);
  assert.ok(!JSON.stringify(Object.values(env.hojas).map(h => h.datos)).includes(TICKET));
});

prueba('desactivar todo borra activador diario y continuaciones', () => {
  const env = nuevoEntorno({ latenciaMs: 20000 }); listo(env, { diasCompetencia: 0, fichasPorLote: 500 });
  env.exp.ejecutarRadar();
  assert.ok(env.triggers.length >= 2);
  env.exp.desactivarTodo();
  assert.strictEqual(env.triggers.length, 0);
});

console.log('\n' + ok + ' pruebas OK · ' + fallas + ' con fallas');
process.exit(fallas ? 1 : 0);
