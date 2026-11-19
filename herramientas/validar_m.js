'use strict';
// Valida la SINTAXIS de cada consulta M con el parser oficial de Microsoft (@microsoft/powerquery-parser).
// No ejecuta las consultas (eso requiere Excel o Power BI Desktop).
const PQP = require('@microsoft/powerquery-parser');
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'powerquery');
let malos = 0;
(async () => {
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pq')).sort()) {
    const texto = fs.readFileSync(path.join(dir, f), 'utf8');
    const r = await PQP.TaskUtils.tryLexParse(PQP.DefaultSettings, texto);
    if (PQP.TaskUtils.isParseStageOk(r)) console.log('  ✔ sintaxis M válida: ' + f);
    else { malos++; const e = r.error || r; console.log('  ✘ ' + f + ': ' + (e.message || JSON.stringify(e).slice(0, 300))); }
  }
  process.exit(malos ? 1 : 0);
})();
