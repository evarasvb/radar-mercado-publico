'use strict';
process.env.TZ = 'America/Santiago';
const assert = require('assert'), fs = require('fs'), path = require('path');
const { crearEntorno, configurar } = require('./simulador_gas');
const ACT = fs.readFileSync(path.join(__dirname, 'fixture_activas_20261118.json'), 'utf8');
const FICHA = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_ficha_1001-22-LE26.json'), 'utf8'));
const TICKET = require('crypto').randomUUID().toUpperCase(); // ticket ficticio generado al vuelo (formato válido): estas pruebas no salen a internet
let ok = 0;
function prueba(nombre, fn) { fn(); ok++; console.log('✔ ' + nombre); }

// Ficha simulada para cualquier código: reutiliza la estructura real y cambia código y región según el caso.
function fichaPara(codigo, region, desc) {
  const f = JSON.parse(JSON.stringify(FICHA));
  const l = f.Listado[0];
  l.CodigoExterno = codigo;
  if (region) l.Comprador.RegionUnidad = region;
  if (desc) l.Descripcion = desc;
  return { code: 200, body: JSON.stringify(f) };
}
function normal(url) {
  if (/estado=activas/.test(url)) return { code: 200, body: ACT };
  const m = /codigo=([^&]+)/.exec(url);
  if (m) return fichaPara(decodeURIComponent(m[1]));
  return { code: 400, body: '{"Codigo":400,"Mensaje":"no simulado"}' };
}
const filasOport = env => env.hojas['Oportunidades'].getDataRange().getValues().slice(1).filter(f => f[1]);
const registro = env => env.hojas['Registro'].getDataRange().getValues().slice(1);

prueba('normalización y coincidencias por palabra completa', () => {
  const env = crearEntorno({ responder: normal });
  const c = env.exp.coincide_;
  assert.strictEqual(c('CALIBRACIÓN EQUIPOS', ['calibracion']), 'calibracion');
  assert.strictEqual(c('Servicio de aseo y ornato', ['ASEO']), 'ASEO');
  assert.strictEqual(c('Servicios de aseos varios', ['aseo']), null);
  assert.strictEqual(c('Servicios de aseos varios', ['aseo*']), 'aseo*');
  assert.strictEqual(c('Mantención de paseo peatonal', ['aseo*']), null);
  assert.strictEqual(c('Arriendo de camionetas 4x4', ['camioneta*']), 'camioneta*');
  assert.strictEqual(c('Compra de papel', ['papel higiénico']), null);
  assert.strictEqual(c('Compra de papel higienico', ['papel higiénico']), 'papel higiénico');
});

prueba('fecha de cierre se conserva en hora de Chile', () => {
  const env = crearEntorno({ responder: normal });
  const d = env.exp.fechaLocal_('2026-11-19T15:00:00');
  assert.strictEqual(d.getHours(), 15); assert.strictEqual(d.getDate(), 19);
  assert.strictEqual(env.exp.fechaLocal_(null), '');
});

prueba('ejecución normal: coincide, deduplica, completa fichas y envía resumen', () => {
  const env = crearEntorno({ responder: normal });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['calibracion', 'vigilancia'], maxFichas: 5 });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  const filas = filasOport(env);
  assert.ok(filas.length >= 2, 'debería encontrar al menos 2 coincidencias, encontró ' + filas.length);
  const codigos = filas.map(f => f[1]);
  assert.strictEqual(new Set(codigos).size, codigos.length, 'sin duplicados');
  assert.ok(codigos.includes('1001-22-LE26'));
  const f = filas.find(x => x[1] === '1001-22-LE26');
  assert.strictEqual(f[2], 'CALIBRACION EQUIPOS E INSTRUMENTOS DE LABORATORIO');
  assert.strictEqual(f[5], 'Publicada');
  assert.ok(f[6] instanceof Date && f[6].getHours() === 15);
  assert.ok(String(f[13]).endsWith('idlicitacion=1001-22-LE26'));
  const completas = filas.filter(x => x[15] === 'ok').length;
  assert.strictEqual(completas, Math.min(5, filas.length), 'respeta el máximo de fichas por ejecución');
  assert.ok(env.esperas.filter(ms => ms === 2000).length >= completas, 'pausa entre consultas');
  assert.strictEqual(env.correos.length, 1);
  assert.ok(/oportunidad\(es\) nueva\(s\)/.test(env.correos[0].subject));
  assert.ok(!JSON.stringify(env.correos).includes(TICKET), 'el ticket no aparece en el correo');
  assert.ok(!JSON.stringify(env.hojas).includes(TICKET), 'el ticket no aparece en ninguna hoja');
  const reg = registro(env); assert.strictEqual(reg[reg.length - 1][1], 'OK');
  // Segunda ejecución: nada nuevo, completa fichas pendientes, conserva columnas internas.
  const hoja = env.hojas['Oportunidades'];
  hoja.getRange(2, 17, 1, 3).setValues([['Estudiar', 'Ana', 'Pedir visita a terreno']]);
  const antes = filas.length;
  env.exp.ejecutarRadar();
  const filas2 = filasOport(env);
  assert.strictEqual(filas2.length, antes, 'no duplica en la segunda ejecución');
  assert.deepStrictEqual(hoja.getRange(2, 17, 1, 3).getValues()[0], ['Estudiar', 'Ana', 'Pedir visita a terreno']);
  assert.ok(/sin novedades/.test(env.correos[1].subject), 'avisa «sin novedades» cuando la consulta funcionó');
});

prueba('una consulta fallida (429 / peticiones simultáneas) NUNCA se informa como «sin resultados»', () => {
  const env = crearEntorno({ responder: () => ({ code: 429, body: '{"Codigo":10500,"Mensaje":"Lo sentimos. Hemos detectado que existen peticiones simultáneas."}' }) });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['aseo*'] });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.strictEqual(env.llamadas.length, 4, 'reintenta 4 veces');
  assert.deepStrictEqual(env.esperas, [10000, 30000, 60000], 'espera creciente entre intentos');
  assert.strictEqual(filasOport(env).length, 0);
  const reg = registro(env); const ult = reg[reg.length - 1];
  assert.strictEqual(ult[1], 'ERROR'); assert.ok(/10500/.test(ult[2]));
  assert.strictEqual(env.correos.length, 1);
  assert.ok(/FALLÓ/.test(env.correos[0].subject)); assert.ok(!/sin novedades/.test(env.correos[0].subject));
});

prueba('ticket no válido (código 203): no insiste y avisa', () => {
  const env = crearEntorno({ responder: () => ({ code: 203, body: '{"Codigo":203,"Mensaje":"Ticket no válido."}' }) });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['aseo*'] });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.strictEqual(env.llamadas.length, 1);
  assert.ok(/revisa tu ticket/.test(registro(env).pop()[2]));
});

prueba('error de red seguido de éxito: se recupera con reintento', () => {
  const env = crearEntorno({ responder: (url, n) => (n === 1 ? new Error('Timeout ' + url) : normal(url)) });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['calibracion'], maxFichas: 1 });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.strictEqual(registro(env).pop()[1], 'OK');
  assert.ok(filasOport(env).length >= 1);
});

prueba('respuesta vacía o no JSON se trata como falla, no como «cero oportunidades»', () => {
  let env = crearEntorno({ responder: () => ({ code: 200, body: '{"Cantidad":0,"Listado":[]}' }) });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['aseo*'] }); env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.strictEqual(registro(env).pop()[1], 'ERROR'); assert.ok(/FALLÓ/.test(env.correos[0].subject));
  env = crearEntorno({ responder: () => ({ code: 200, body: '<html>Mantención</html>' }) });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['aseo*'] }); env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.strictEqual(env.llamadas.length, 4); assert.strictEqual(registro(env).pop()[1], 'ERROR');
});

prueba('filtro de región: marca «fuera de filtro» y no lo incluye en el correo', () => {
  const env = crearEntorno({ responder: normal });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['calibracion'], regiones: ['Biobío'], maxFichas: 10 });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  const f = filasOport(env).find(x => x[1] === '1001-22-LE26');
  assert.strictEqual(f[15], 'fuera de filtro (región)');
  assert.ok(!env.correos[0].htmlBody.includes('1001-22-LE26'));
});

prueba('palabras excluidas', () => {
  const env = crearEntorno({ responder: normal });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['calibracion'], excluir: ['laboratorio'], maxFichas: 0 });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.ok(!filasOport(env).some(x => x[1] === '1001-22-LE26'));
});

prueba('búsqueda opcional en descripción', () => {
  const env = crearEntorno({ responder: url => {
    const m = /codigo=([^&]+)/.exec(url);
    if (m && decodeURIComponent(m[1]) === '1000-27-LP26') return fichaPara('1000-27-LP26', null, 'Incluye retiro de residuos y desratización de bodegas.');
    return normal(url);
  } });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['desratizacion'], descripcion: 3, maxFichas: 0 });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  const f = filasOport(env).find(x => x[1] === '1000-27-LP26');
  assert.ok(f, 'encuentra por descripción'); assert.strictEqual(f[4], 'Descripción');
  assert.strictEqual(env.hojas['_revisadas'].getLastRow(), 3);
  env.exp.ejecutarRadar();
  assert.strictEqual(env.hojas['_revisadas'].getLastRow(), 6, 'no repite fichas ya revisadas');
});

prueba('sin ticket o sin palabras clave: error claro', () => {
  let env = crearEntorno({ responder: normal });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['aseo*'] });
  env.exp.ejecutarRadar();
  assert.ok(/No hay ticket/.test(registro(env).pop()[2])); assert.strictEqual(env.llamadas.length, 0);
  env = crearEntorno({ responder: normal });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: [] }); env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.ok(/palabras clave/.test(registro(env).pop()[2]));
});

prueba('el ticket se oculta en mensajes de error', () => {
  const env = crearEntorno({ responder: normal });
  const s = env.exp.ocultarTicket_('https://x/licitaciones.json?estado=activas&ticket=' + TICKET + ' falló');
  assert.ok(!s.includes(TICKET) && s.includes('ticket=***'));
});

prueba('activar ejecución diaria crea un único activador a la hora configurada', () => {
  const env = crearEntorno({ responder: normal });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['aseo*'], hora: 8 });
  env.exp.activarEjecucionDiaria(); env.exp.activarEjecucionDiaria();
  assert.strictEqual(env.triggers.length, 1); assert.strictEqual(env.triggers[0].hora, 8);
  assert.strictEqual(env.triggers[0].zona, 'America/Santiago');
});

prueba('guardar ticket valida formato y no lo escribe en la planilla', () => {
  let env = crearEntorno({ responder: normal, ticketPrompt: 'hola' });
  env.exp.prepararHojas(); env.exp.guardarTicket();
  assert.strictEqual(env.props.MP_TICKET, undefined);
  env = crearEntorno({ responder: normal, ticketPrompt: TICKET });
  env.exp.prepararHojas(); env.exp.guardarTicket();
  assert.strictEqual(env.props.MP_TICKET, TICKET);
  assert.ok(!JSON.stringify(env.hojas).includes(TICKET));
});

prueba('sin cuota de correo: registra advertencia y no se cae', () => {
  const env = crearEntorno({ responder: normal, cuotaCorreo: 0 });
  configurar(env, { correo: 'equipo@ejemplo.cl', claves: ['calibracion'], maxFichas: 1 });
  env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  assert.ok(registro(env).some(r => /cuota diaria de correo/.test(r[2])));
});

console.log('\n' + ok + ' pruebas correctas.');
// (añadida) el contador diario cuenta cada intento HTTP y respeta el tope propio
{
  const env = crearEntorno({ responder: () => ({ code: 429, body: '{"Codigo":10500,"Mensaje":"x"}' }) });
  configurar(env, { correo: '', claves: ['aseo*'] }); env.props.MP_TICKET = TICKET;
  env.exp.ejecutarRadar();
  const k = Object.keys(env.props).find(x => x.startsWith('LLAMADAS_'));
  assert.strictEqual(env.props[k], '4');
  env.props[k] = '9000';
  env.exp.ejecutarRadar();
  assert.strictEqual(env.llamadas.length, 4, 'con el tope alcanzado no consulta');
  assert.ok(/tope diario/.test(registro(env).pop()[2]));
  console.log('✔ contador diario por intento y tope propio');
}
