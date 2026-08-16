'use strict';

const registro = [];

class PruebaSaltada extends Error {
  constructor(razon) { super(razon); this.esSalto = true; }
}

function saltar(razon) { throw new PruebaSaltada(razon || 'sin razón especificada'); }

/**
 * Registra una prueba. `ejecutar` puede ser síncrona o async, y debe
 * regresar { datos, esperado, obtenido, pasa } o llamar saltar('razón').
 * Cualquier excepción NO controlada (no PruebaSaltada) se reporta como
 * ERROR, distinto de FAIL (que es una aserción que sí corrió pero no
 * cumplió lo esperado).
 */
function prueba(def) {
  if (!def.id || !def.nombre || typeof def.ejecutar !== 'function') {
    throw new Error('prueba() requiere {id, nombre, ejecutar}');
  }
  registro.push(def);
}

async function ejecutarTodas(filtro) {
  const resultados = [];
  const seleccion = filtro ? registro.filter(filtro) : registro.slice();

  for (const def of seleccion) {
    const inicio = process.hrtime.bigint();
    let resultado;
    try {
      const salida = await def.ejecutar();
      const duracionMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      resultado = {
        id: def.id,
        nombre: def.nombre,
        grupo: def.grupo || 'sin-grupo',
        objetivo: def.objetivo || '',
        metodo: def.metodo || 'SIMULACIÓN',
        datos: salida.datos || '',
        esperado: salida.esperado,
        obtenido: salida.obtenido,
        estado: salida.pasa ? 'PASS' : 'FAIL',
        duracionMs: Math.round(duracionMs * 100) / 100,
      };
    } catch (e) {
      const duracionMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      if (e instanceof PruebaSaltada) {
        resultado = {
          id: def.id, nombre: def.nombre, grupo: def.grupo || 'sin-grupo', objetivo: def.objetivo || '',
          metodo: def.metodo || 'SIMULACIÓN', datos: '', esperado: '', obtenido: 'SKIP: ' + e.message,
          estado: 'SKIP', duracionMs: Math.round(duracionMs * 100) / 100,
        };
      } else {
        resultado = {
          id: def.id, nombre: def.nombre, grupo: def.grupo || 'sin-grupo', objetivo: def.objetivo || '',
          metodo: def.metodo || 'SIMULACIÓN', datos: '', esperado: '', obtenido: 'ERROR: ' + (e && e.stack ? e.stack : e),
          estado: 'ERROR', duracionMs: Math.round(duracionMs * 100) / 100,
        };
      }
    }
    resultados.push(resultado);
  }
  return resultados;
}

function limpiarRegistro() { registro.length = 0; }

const COLOR = { PASS: '\x1b[32m', FAIL: '\x1b[31m', SKIP: '\x1b[33m', ERROR: '\x1b[35m', reset: '\x1b[0m' };

function imprimirReporte(resultados) {
  let porGrupo = {};
  resultados.forEach(r => { (porGrupo[r.grupo] = porGrupo[r.grupo] || []).push(r); });

  Object.keys(porGrupo).forEach(grupo => {
    console.log('\n' + '='.repeat(78));
    console.log(grupo.toUpperCase());
    console.log('='.repeat(78));
    porGrupo[grupo].forEach(r => {
      const c = COLOR[r.estado] || '';
      console.log(`${c}[${r.estado}]${COLOR.reset} ${r.id} — ${r.nombre} (${r.duracionMs}ms)`);
      if (r.objetivo) console.log(`   objetivo:  ${r.objetivo}`);
      if (r.datos) console.log(`   datos:     ${r.datos}`);
      if (r.esperado !== undefined && r.esperado !== '') console.log(`   esperado:  ${r.esperado}`);
      if (r.obtenido !== undefined && r.obtenido !== '') console.log(`   obtenido:  ${r.obtenido}`);
    });
  });

  const contar = (estado) => resultados.filter(r => r.estado === estado).length;
  console.log('\n' + '-'.repeat(78));
  console.log(
    `TOTAL: ${resultados.length}  ` +
    `${COLOR.PASS}PASS: ${contar('PASS')}${COLOR.reset}  ` +
    `${COLOR.FAIL}FAIL: ${contar('FAIL')}${COLOR.reset}  ` +
    `${COLOR.SKIP}SKIP: ${contar('SKIP')}${COLOR.reset}  ` +
    `${COLOR.ERROR}ERROR: ${contar('ERROR')}${COLOR.reset}`
  );
  console.log('-'.repeat(78));
}

module.exports = { prueba, saltar, ejecutarTodas, limpiarRegistro, imprimirReporte, PruebaSaltada };
