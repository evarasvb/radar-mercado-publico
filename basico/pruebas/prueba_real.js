'use strict';
// Prueba REAL de solo lectura contra la API de Mercado Público.
// Uso: MP_TICKET=<tu ticket> node prueba_real.js   (MP_TICKET=TU_TICKET_AQUI; el ticket de ejemplo está publicado en https://www.chilecompra.cl/api/)
// Hace 1 consulta de licitaciones activas + hasta 2 fichas, con pausas. No envía correos.
process.env.TZ = 'America/Santiago';
const { crearEntorno, configurar } = require('./simulador_gas');
const TICKET = process.env.MP_TICKET || 'TU_TICKET_AQUI';
if (TICKET === 'TU_TICKET_AQUI') { console.error('Define tu ticket: MP_TICKET=TU_TICKET_AQUI node ' + require('path').basename(__filename) + ' · Para una prueba rápida puedes usar el ticket de ejemplo que ChileCompra publica en https://www.chilecompra.cl/api/'); process.exit(1); }
const env = crearEntorno({ real: true, verbose: true });
configurar(env, { correo: '', claves: (process.env.CLAVES || 'calibracion,aseo*').split(','), maxFichas: 2 });
env.props.MP_TICKET = TICKET;
const t = Date.now();
env.exp.ejecutarRadar();
const reg = env.hojas['Registro'].getDataRange().getValues();
console.log('\nRegistro:'); reg.forEach(r => console.log('  ' + r.map(v => v instanceof Date ? v.toISOString() : v).join(' | ')));
const op = env.hojas['Oportunidades'].getDataRange().getValues();
console.log('\nOportunidades: ' + (op.length - 1) + ' filas. Primeras 5:');
op.slice(0, 6).forEach(r => console.log('  ' + r.slice(0, 16).map(v => v instanceof Date ? v.toLocaleString('es-CL') : String(v).slice(0, 40)).join(' | ')));
console.log('\nLlamadas a la API: ' + env.llamadas.length + ' · duración ' + Math.round((Date.now() - t) / 1000) + ' s');
