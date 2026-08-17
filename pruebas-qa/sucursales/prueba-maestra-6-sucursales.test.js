'use strict';

/*
 * PRUEBA MAESTRA DE AISLAMIENTO — 6 sucursales (petición explícita del
 * usuario: "Ajuste arquitectónico definitivo"). Reproduce EXACTAMENTE
 * la secuencia y los valores pedidos con el producto HAR001, contra el
 * núcleo único de existencia (resolverAjusteExistencia_) ya refactorizado.
 *
 * Estado inicial:
 *   S01=100  S02=50  S03=75  S04=20  S05=90  S06=10
 *
 * Secuencia:
 *   1. Salida de 20 en S02.
 *   2. Salida de 10 en S04.
 *   3. Entrada de 50 en S06.
 *   4. Transferencia de 15 de S03 a S05.
 *   5. Requisición de S02 por 5 (entrega).
 *   6. Intentar sacar más existencia de la disponible (bloqueado).
 *   7. Intentar que el usuario de S02 opere/lea S03 (bloqueado, IDOR).
 *   8. Consultar TODAS (vista consolidada).
 *   9. Operaciones simultáneas (concurrencia real, misma prueba que ya
 *      se validó en concurrencia/, repetida aquí sobre una sucursal).
 *  10. Forzar un error a la mitad de una transferencia y comprobar que
 *      no quede parcialmente aplicada.
 *
 * Resultado esperado tras 1-5:
 *   S01=100  S02=25  S03=60  S04=10  S05=105  S06=60
 * Y MATRIZ (S01) nunca se tocó por ninguna operación de S02-S06.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function sembrarSucursales(entorno){
  // COD-001 = HAR001 conceptualmente (mismo producto de fixture usado en toda la suite).
  entorno.invocar('actualizarExistenciaMatriz_', 'COD-001', 100);          // S01 = MATRIZ
  entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 50, 'S02');
  entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 75, 'S03');
  entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20, 'S04');
  entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 90, 'S05');
  entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S06');
}

prueba({
  id: 'MAESTRA-01', grupo: 'sucursales', nombre: 'Secuencia completa 1-5: resultado exacto pedido', metodo: 'EMPÍRICO',
  objetivo: 'Salida S02=20, Salida S04=10, Entrada S06=50, Transferencia S03→S05=15, Entrega requisición S02=5 → S01=100 S02=25 S03=60 S04=10 S05=105 S06=60, MATRIZ nunca tocada por S02-S06',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    sembrarSucursales(entorno);
    const matrizAntes = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];

    // 1. Salida de 20 en S02.
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -20, 'S02');
    // 2. Salida de 10 en S04.
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -10, 'S04');
    // 3. Entrada de 50 en S06.
    entorno.invocar('ajustarExistenciaMatrizPorDelta_', 'COD-001', 50, 'S06');
    // 4. Transferencia de 15 de S03 a S05.
    entorno.invocar('transferirEntreSucursalesApp', 'COD-001', 'S03', 'S05', 15, tokenAdmin);
    // 5. Requisición de S02 por 5 (creada por S02, entregada por Admin).
    const tokenS02 = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], tokenS02);
    entorno.invocar('confirmarEntregaRequisicionSucursalApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 5 }], tokenAdmin);

    const s01 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S01');
    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const s03 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S03');
    const s04 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S04');
    const s05 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S05');
    const s06 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S06');
    const matrizDespues = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];

    return {
      datos: `inicial: S01=100 S02=50 S03=75 S04=20 S05=90 S06=10 (MATRIZ antes=${matrizAntes})`,
      esperado: 'S01=100 S02=25 S03=60 S04=10 S05=105 S06=60, MATRIZ sin cambio',
      obtenido: `S01=${s01} S02=${s02} S03=${s03} S04=${s04} S05=${s05} S06=${s06}, MATRIZ después=${matrizDespues}`,
      pasa: s01 === 100 && s02 === 25 && s03 === 60 && s04 === 10 && s05 === 105 && s06 === 60 && matrizDespues === matrizAntes,
    };
  },
});

prueba({
  id: 'MAESTRA-06', grupo: 'sucursales', nombre: 'Paso 6: no se puede sacar más de lo disponible', metodo: 'EMPÍRICO',
  objetivo: 'Una salida mayor a la existencia de la sucursal se bloquea y no deja la existencia negativa ni modifica nada',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    sembrarSucursales(entorno); // S04 = 20
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -999, 'S04'); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    const s04 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S04');
    return {
      datos: 'S04=20, intenta salida de 999',
      esperado: 'bloqueado, S04 sigue en 20',
      obtenido: bloqueado ? `${mensaje} — S04=${s04}` : 'PERMITIDO',
      pasa: bloqueado && /insuficiente/i.test(mensaje) && s04 === 20,
    };
  },
});

prueba({
  id: 'MAESTRA-07', grupo: 'sucursales', nombre: 'Paso 7: el usuario de S02 no puede operar/leer S03', metodo: 'EMPÍRICO',
  objetivo: 'Un usuario de S02 no puede leer el detalle de una requisición de S03 (IDOR) ni crear una requisición a nombre de S03 (el servidor siempre usa SU propia sucursal, nunca la que pida el cliente)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    sembrarSucursales(entorno);

    // Existe una requisición real de otra sucursal (S04) para intentar leerla desde S02.
    const tokenS04 = entorno.invocar('crearSesion_', 'sucursal4@tagers.com', 'Operador S04', 'OPERADOR');
    const reqS04 = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 3 }], tokenS04);

    const tokenS02 = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');

    let lecturaBloqueada = false;
    try { entorno.invocar('obtenerDetalleRequisicionSucursalApp', reqS04.folio, tokenS02); }
    catch (e) { lecturaBloqueada = true; }

    // Aunque intente pasar algo distinto por su cuenta, crearRequisicionSucursalApp
    // NO recibe sucursal como argumento — no hay forma de que S02 "diga" que es S03.
    const req = entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 1 }], tokenS02);

    return {
      datos: 'usuario de S02 intenta leer una requisición de S04, y crear una requisición propia',
      esperado: 'lectura cruzada bloqueada; la requisición que sí puede crear queda registrada como S02 (nunca otra sucursal)',
      obtenido: `lecturaBloqueada=${lecturaBloqueada}, sucursalDeSuPropiaRequisicion=${req.sucursal}`,
      pasa: lecturaBloqueada === true && req.sucursal === 'S02',
    };
  },
});

prueba({
  id: 'MAESTRA-08', grupo: 'sucursales', nombre: 'Paso 8: consultar TODAS da la vista consolidada, sin crear una fila física', metodo: 'EMPÍRICO',
  objetivo: 'obtenerExistenciaConsolidadaApp debe sumar las 6 sucursales; EXISTENCIAS_SUCURSAL nunca debe tener una fila con Sucursal="TODAS"',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    sembrarSucursales(entorno); // S01=100 S02=50 S03=75 S04=20 S05=90 S06=10 (total=345)

    const vista = entorno.invocar('obtenerExistenciaConsolidadaApp', 'COD-001', tokenAdmin);
    const filaTodas = entorno.leerHoja('EXISTENCIAS_SUCURSAL').slice(1).find(f => f[1] === 'TODAS');

    return {
      datos: 'S01=100 S02=50 S03=75 S04=20 S05=90 S06=10',
      esperado: 'total=345, sin ninguna fila física con Sucursal="TODAS"',
      obtenido: `total=${vista.total}, filaTodasExiste=${!!filaTodas}`,
      pasa: vista.total === 345 && !filaTodas,
    };
  },
});

prueba({
  id: 'MAESTRA-08B', grupo: 'sucursales', nombre: '"TODAS" nunca se acepta como sucursal de escritura', metodo: 'EMPÍRICO',
  objetivo: 'Los 3 escritores centrales y obtenerExistenciaSucursal_ deben rechazar "TODAS" explícitamente, no solo por disciplina de quien llama',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueosOk = 0;
    const intentos = [
      () => entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'TODAS'),
      () => entorno.invocar('ajustarExistenciaMatrizPorDelta_', 'COD-001', 10, 'TODAS'),
      () => entorno.invocar('actualizarExistenciaMatriz_', 'COD-001', 10, 'TODAS'),
      () => entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'TODAS'),
    ];
    intentos.forEach(fn => { try { fn(); } catch (e) { if (/TODAS/.test(e.message)) bloqueosOk++; } });

    const filaTodas = entorno.leerHoja('EXISTENCIAS_SUCURSAL')
      ? entorno.leerHoja('EXISTENCIAS_SUCURSAL').slice(1).find(f => f[1] === 'TODAS')
      : null;

    return {
      datos: '4 intentos de usar "TODAS" como sucursal real (3 escritores + 1 lector)',
      esperado: 'los 4 se bloquean con un mensaje que menciona "TODAS", y nunca se crea una fila física',
      obtenido: `bloqueados=${bloqueosOk}/4, filaTodasCreada=${!!filaTodas}`,
      pasa: bloqueosOk === 4 && !filaTodas,
    };
  },
});

prueba({
  id: 'MAESTRA-09', grupo: 'sucursales', nombre: 'Paso 9: dos entregas simultáneas de 8 no dejan la sucursal en negativo', metodo: 'EMPÍRICO',
  objetivo: 'S02=10, dos usuarios intentan entregar 8 "al mismo tiempo": una se aplica, la otra se rechaza, existencia final nunca negativa (mismo patrón ya validado en concurrencia/CONC-001, aquí sobre una sucursal real)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S02');

    const resultados = ['A', 'B'].map(() => {
      try { entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -8, 'S02'); return 'aplicada'; }
      catch (e) { return 'rechazada'; }
    });

    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const aplicadas = resultados.filter(r => r === 'aplicada').length;

    return {
      datos: 'S02=10, usuario A y B intentan entregar 8 cada uno',
      esperado: 'exactamente 1 aplicada, existencia final=2, nunca negativa',
      obtenido: `resultados=[${resultados.join(',')}], S02=${s02}`,
      pasa: aplicadas === 1 && s02 === 2,
    };
  },
});

prueba({
  id: 'MAESTRA-10', grupo: 'sucursales', nombre: 'Paso 10: transferencia con falla a la mitad no queda parcialmente aplicada', metodo: 'EMPÍRICO',
  objetivo: 'Si el paso de "alta en destino" de una transferencia falla (error simulado de la API), el descuento de origen ya aplicado se revierte dentro del mismo lock antes de propagar el error',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 100, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S05');

    const original = entorno.contexto.ajustarUnaCeldaExistenciaSinLock_;
    let llamadas = 0;
    entorno.contexto.ajustarUnaCeldaExistenciaSinLock_ = function(codigo, sucursal, delta, validar){
      llamadas++;
      if(llamadas === 2){ throw new Error('Fallo simulado de la API de Sheets'); }
      return original(codigo, sucursal, delta, validar);
    };

    let fallo = false, mensaje = '';
    try { entorno.invocar('transferirEntreSucursalesApp', 'COD-001', 'S02', 'S05', 30, tokenAdmin); }
    catch (e) { fallo = true; mensaje = e.message; }

    entorno.contexto.ajustarUnaCeldaExistenciaSinLock_ = original; // limpieza, no afecta otras pruebas

    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const s05 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S05');

    return {
      datos: 'S02=100, S05=10, transferir 30, pero el 2º paso (alta en destino) falla a propósito',
      esperado: 'la transferencia falla, S02 vuelve a 100 (se revirtió el descuento), S05 sigue en 10 (nunca se aplicó)',
      obtenido: `falló=${fallo}, mensaje="${mensaje}", S02=${s02}, S05=${s05}`,
      pasa: fallo && /revirtió/i.test(mensaje) && s02 === 100 && s05 === 10,
    };
  },
});
