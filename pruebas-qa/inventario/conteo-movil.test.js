'use strict';

/*
 * TAGERS WMS MOBILE — obtenerRacksDelConteoApp y obtenerSiguientePendienteRackApp
 * (📁 App.gs.gs) alimentan el flujo "Conteo cíclico" de MobileApp.html
 * (Seleccionar rack → mostrar progreso → capturar siguiente pendiente
 * DENTRO de ese rack). El guardado real de cada captura sigue siendo
 * guardarConteoFisico (Código.gs, ya probado en otras suites) — estas
 * 2 funciones solo acotan la consulta "cuál sigue" a un rack específico,
 * cosa que Desktop no necesita (su flujo es a nivel de folio completo).
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConConteo() {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

  const filas = entorno.hojas.CONTEO_CICLICO._filas();
  // folio CC-1: rack A con 2 productos (1 ya contado), rack B con 1 producto pendiente.
  filas.push(['CC-1', new Date(), 'Admin', 'COD-001', 'HARINA DE TRIGO', 'A-01', 100, '', '', 'PENDIENTE', 'A']);
  filas.push(['CC-1', new Date(), 'Admin', 'COD-002', 'AZUCAR ESTANDAR', 'A-02', 5, 5, 0, 'CONTADO', 'A']);
  filas.push(['CC-1', new Date(), 'Admin', 'COD-003', 'SAL DE MESA', 'B-01', 50, '', '', 'PENDIENTE', 'B']);
  // folio distinto (CC-2) no debe mezclarse con CC-1.
  filas.push(['CC-2', new Date(), 'Admin', 'COD-004', 'RAJAS POBLANAS 0.5 KG', 'C-01', 12, '', '', 'PENDIENTE', 'C']);

  return { entorno, token };
}

prueba({
  id: 'CONTM-001', grupo: 'inventario', nombre: 'obtenerRacksDelConteoApp agrupa por rack y cuenta contados/pendientes correctamente',
  metodo: 'EMPÍRICO',
  objetivo: 'Folio CC-1 con rack A (2 productos, 1 contado) y rack B (1 producto, 0 contados) debe regresar ambos racks con sus totales exactos, sin mezclar CC-2',
  ejecutar() {
    const { entorno, token } = entornoConConteo();
    const racks = entorno.invocar('obtenerRacksDelConteoApp', 'CC-1', token);

    const porRack = {};
    racks.forEach(r => { porRack[r.rack] = r; });

    return {
      datos: 'CC-1: rack A (COD-001 pendiente, COD-002 contado), rack B (COD-003 pendiente); CC-2: rack C (no debe aparecer)',
      esperado: 'racks=["A","B"], A: total=2 contados=1 pendientes=1; B: total=1 contados=0 pendientes=1',
      obtenido: JSON.stringify(racks),
      pasa: racks.length === 2
        && porRack.A && porRack.A.total === 2 && porRack.A.contados === 1 && porRack.A.pendientes === 1
        && porRack.B && porRack.B.total === 1 && porRack.B.contados === 0 && porRack.B.pendientes === 1,
    };
  },
});

prueba({
  id: 'CONTM-002', grupo: 'inventario', nombre: 'obtenerSiguientePendienteRackApp regresa el primer producto sin contar de ESE rack, no de otro',
  metodo: 'EMPÍRICO',
  objetivo: 'Pedir el siguiente pendiente del rack A debe regresar COD-001 (el pendiente de A), nunca COD-003 (que es de B)',
  ejecutar() {
    const { entorno, token } = entornoConConteo();
    const resultado = entorno.invocar('obtenerSiguientePendienteRackApp', 'CC-1', 'A', token);

    return {
      datos: 'Rack A: COD-001 pendiente, COD-002 ya contado',
      esperado: 'total=2, contados=1, siguiente.codigo="COD-001"',
      obtenido: JSON.stringify(resultado),
      pasa: resultado.total === 2 && resultado.contados === 1
        && resultado.siguiente && resultado.siguiente.codigo === 'COD-001',
    };
  },
});

prueba({
  id: 'CONTM-003', grupo: 'inventario', nombre: 'obtenerSiguientePendienteRackApp regresa siguiente=null cuando el rack ya está completo',
  metodo: 'EMPÍRICO',
  objetivo: 'Un rack sin productos pendientes (todos contados) debe regresar siguiente=null para que la pantalla muestre "rack terminado"',
  ejecutar() {
    const { entorno, token } = entornoConConteo();
    // Completa el único pendiente del rack B directamente en la hoja.
    // _filas() incluye la fila de encabezado en el índice 0, igual que
    // leerHoja() — los índices de ambas coinciden 1:1.
    const filas = entorno.leerHoja('CONTEO_CICLICO');
    const filaB = filas.findIndex(f => f[3] === 'COD-003');
    entorno.hojas.CONTEO_CICLICO._filas()[filaB][7] = 50; // Físico
    entorno.hojas.CONTEO_CICLICO._filas()[filaB][9] = 'CONTADO';

    const resultado = entorno.invocar('obtenerSiguientePendienteRackApp', 'CC-1', 'B', token);

    return {
      datos: 'Rack B: único producto (COD-003) ya marcado como contado',
      esperado: 'total=1, contados=1, siguiente=null',
      obtenido: JSON.stringify(resultado),
      pasa: resultado.total === 1 && resultado.contados === 1 && resultado.siguiente === null,
    };
  },
});

prueba({
  id: 'CONTM-004', grupo: 'inventario', nombre: 'obtenerRacksDelConteoApp y obtenerSiguientePendienteRackApp exigen sesión activa',
  metodo: 'EMPÍRICO',
  objetivo: 'Ambas funciones deben rechazar un token inválido antes de leer CONTEO_CICLICO, igual que el resto del backend',
  ejecutar() {
    const { entorno } = entornoConConteo();
    let lanzo1 = false, lanzo2 = false;
    try { entorno.invocar('obtenerRacksDelConteoApp', 'CC-1', 'token-invalido'); } catch (e) { lanzo1 = true; }
    try { entorno.invocar('obtenerSiguientePendienteRackApp', 'CC-1', 'A', 'token-invalido'); } catch (e) { lanzo2 = true; }

    return {
      datos: 'token="token-invalido"',
      esperado: 'ambas funciones lanzan error',
      obtenido: `lanzo1=${lanzo1}, lanzo2=${lanzo2}`,
      pasa: lanzo1 === true && lanzo2 === true,
    };
  },
});

prueba({
  id: 'CONTM-005', grupo: 'inventario', nombre: 'Flujo completo: capturar con guardarConteoFisico refleja el avance en obtenerSiguientePendienteRackApp',
  metodo: 'EMPÍRICO',
  objetivo: 'Después de guardarConteoFisico sobre la fila de COD-001 (rack A), volver a consultar el rack A debe mostrar contados=2 y siguiente=null (ya no queda pendiente en A)',
  ejecutar() {
    const { entorno, token } = entornoConConteo();

    const antes = entorno.invocar('obtenerSiguientePendienteRackApp', 'CC-1', 'A', token);
    entorno.invocar('guardarConteoFisico', antes.siguiente.fila, 100, token);
    const despues = entorno.invocar('obtenerSiguientePendienteRackApp', 'CC-1', 'A', token);

    return {
      datos: `Fila de COD-001 (rack A) capturada con cantidad física=100 (fila ${antes.siguiente.fila})`,
      esperado: 'despues.contados=2, despues.siguiente=null',
      obtenido: JSON.stringify(despues),
      pasa: despues.contados === 2 && despues.siguiente === null,
    };
  },
});
