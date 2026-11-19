'use strict';
// Prueba REAL (solo lectura) de Radar MP Pro contra la API de Mercado Público: corre el Code.gs real en el simulador,
// con UrlFetchApp → curl. Uso: MP_TICKET=TU_TICKET_AQUI node prueba_real_pro.js   (MP_TICKET=TU_TICKET_AQUI; el ticket de ejemplo está publicado en https://www.chilecompra.cl/api/)
// No envía correos (sin dirección configurada). Limita el volumen para no abusar del ticket compartido.
process.env.TZ = 'America/Santiago';
const fs = require('fs'), path = require('path');
const { crearEntorno, configurar } = require('./simulador_gas_pro');
const TICKET = process.env.MP_TICKET || 'TU_TICKET_AQUI';
if (TICKET === 'TU_TICKET_AQUI') { console.error('Define tu ticket: MP_TICKET=TU_TICKET_AQUI node ' + require('path').basename(__filename) + ' · Para una prueba rápida puedes usar el ticket de ejemplo que ChileCompra publica en https://www.chilecompra.cl/api/'); process.exit(1); }
const perfil = JSON.parse(fs.readFileSync(path.join(__dirname, 'perfil_muestra.json'), 'utf8'));
const codigos = {};
const env = crearEntorno({ real: true, verbose: true, alResponder: (url, code) => { codigos[code] = (codigos[code] || 0) + 1; } });
env.exp.instalarRadar();
configurar(env, { correo: '', claves: perfil.claves.map(k => [k.palabra, k.peso]), excluir: perfil.excluir, organismos: perfil.organismos_oc,
  diasCompetencia: 1, fichasPorLote: Number(process.env.LOTE || 12), maxFichasDia: Number(process.env.MAX_FICHAS || 24), puntajeMin: 30 });
env.props.MP_TICKET = TICKET;
const t0 = Date.now();
env.exp.ejecutarRadar();
let vueltas = 0;
while (env.triggers.some(t => t.f === 'continuarRadar') && vueltas++ < Number(process.env.VUELTAS || 6)) env.exp.continuarRadar();
const seg = Math.round((Date.now() - t0) / 1000);
const T = n => env.tabla(n).slice(1).filter(r => r[0] !== '' && r[0] != null);
const lic = T('Licitaciones'), L = env.exp.L;
const r = [];
r.push('PRUEBA REAL · Radar MP Pro · ' + new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' }) + ' (hora de Chile)');
r.push('Llamadas HTTP: ' + env.llamadas.length + ' · respuestas por código HTTP: ' + JSON.stringify(codigos) + ' · lotes de continuación: ' + vueltas + ' · duración: ' + seg + ' s');
r.push('Esperas por reintento/pausa (ms): total ' + env.esperas.reduce((a, b) => a + b, 0) + ' en ' + env.esperas.length + ' pausas');
r.push('');
r.push('Registro:');
T('Registro').forEach(x => r.push('  ' + [x[1], x[2], x[3], 'activas=' + x[4], 'candidatas=' + x[5], 'fichas=' + x[6], 'nuevas=' + x[7], 'competencia=' + x[8], 'llamadasHoy=' + x[9]].join(' | ')));
r.push('');
r.push('Licitaciones incorporadas: ' + lic.length + ' · Ítems: ' + T('Ítems').length + ' · Competencia: ' + T('Competencia').length + ' líneas · Historial: ' + T('Historial').length);
r.push('Con monto visible: ' + lic.filter(f => f[L['Monto estimado']] !== '').length + ' · con región: ' + lic.filter(f => f[L['Región']]).length + ' · con rubro: ' + lic.filter(f => f[L['Rubro principal']]).length);
r.push('Top 5 por puntaje:');
lic.slice().sort((a, b) => b[L['Puntaje']] - a[L['Puntaje']]).slice(0, 5).forEach(f => r.push('  ' + f[L['Puntaje']] + ' | ' + f[0] + ' | ' + String(f[1]).slice(0, 60) + ' | ' + f[L['Región']] + ' | ' + f[L['Motivos']]));
const comp = T('Competencia');
if (comp.length) { r.push('Competencia (primeras 5 líneas):'); comp.slice(0, 5).forEach(c => r.push('  ' + c[0] + ' | ' + c[2] + ' | ' + c[7] + ' | ' + String(c[9]).slice(0, 40) + ' | precio unitario ' + c[12])); }
const todo = JSON.stringify(Object.values(env.hojas).map(h => h.datos)) + JSON.stringify(env.logs);
r.push('');
r.push('¿Aparece el ticket en hojas o registro? ' + (todo.includes(TICKET) ? 'SÍ (FALLA)' : 'no'));
const salida = r.join('\n');
console.log('\n' + salida);
fs.writeFileSync(path.join(__dirname, 'salida_prueba_real_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.txt'), salida.replace(new RegExp(TICKET, 'g'), '***') + '\n');
