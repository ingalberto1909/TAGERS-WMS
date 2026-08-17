'use strict';

/*
 * Compara dos corridas (baseline vs. actual) por id de prueba.
 * Regla del usuario: "si una prueba que antes PASABA ahora FALLA, detén
 * el proceso" — eso es exactamente lo que regresiones[] captura.
 */
function compararConBaseline(baselineResultados, actuales) {
  const porId = {};
  baselineResultados.forEach(r => { porId[r.id] = r; });

  const regresiones = [];   // antes PASS, ahora no-PASS
  const corregidas = [];    // antes no-PASS, ahora PASS
  const nuevas = [];        // no existían en baseline
  const sinCambio = [];

  actuales.forEach(actual => {
    const antes = porId[actual.id];
    if (!antes) { nuevas.push(actual); return; }
    if (antes.estado === 'PASS' && actual.estado !== 'PASS') {
      regresiones.push({ id: actual.id, nombre: actual.nombre, antes: antes.estado, ahora: actual.estado, obtenido: actual.obtenido });
    } else if (antes.estado !== 'PASS' && actual.estado === 'PASS') {
      corregidas.push({ id: actual.id, nombre: actual.nombre, antes: antes.estado, ahora: actual.estado });
    } else {
      sinCambio.push({ id: actual.id, nombre: actual.nombre, estado: actual.estado });
    }
  });

  return { regresiones, corregidas, nuevas, sinCambio };
}

function imprimirComparacion(cmp) {
  console.log('\n' + '='.repeat(78));
  console.log('COMPARACIÓN CONTRA BASELINE');
  console.log('='.repeat(78));

  if (cmp.corregidas.length) {
    console.log('\n✅ CORREGIDAS (antes fallaban, ahora pasan):');
    cmp.corregidas.forEach(c => console.log(`   ${c.id} ${c.nombre}: ${c.antes} -> ${c.ahora}`));
  }
  if (cmp.regresiones.length) {
    console.log('\n🔴 REGRESIONES (antes pasaban, ahora NO):');
    cmp.regresiones.forEach(r => console.log(`   ${r.id} ${r.nombre}: ${r.antes} -> ${r.ahora}  (${r.obtenido})`));
  } else {
    console.log('\n🟢 Sin regresiones.');
  }
  if (cmp.nuevas.length) {
    console.log(`\nℹ️  ${cmp.nuevas.length} prueba(s) nueva(s) sin baseline previa.`);
  }
  console.log(`\nSin cambio: ${cmp.sinCambio.length}`);
}

module.exports = { compararConBaseline, imprimirComparacion };
