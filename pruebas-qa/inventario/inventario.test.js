'use strict';

/*
 * FASE 5 del pedido del usuario: 5 casos especiales de inventario con
 * resultado exacto esperado. Los 5 corren contra el código REAL.
 *
 * Nota sobre "concurrencia" en los Casos 1 y 2: el propio backend de
 * producción serializa TODA escritura de existencia con un único
 * LockService.getScriptLock() de proyecto (conBloqueoApp_) — dos
 * solicitudes que en la vida real llegan "al mismo tiempo" quedan
 * encoladas por ese lock y se procesan una tras otra, nunca en paralelo
 * de verdad (Apps Script no tiene hilos). Por eso invocar la función real
 * dos veces EN SECUENCIA es una prueba EMPÍRICA válida del comportamiento
 * bajo concurrencia real, no una aproximación: es exactamente lo que
 * pasa del otro lado del lock. Lo que NO se puede probar aquí (verificar
 * que dos peticiones HTTP simultáneas de Apps Script de verdad se
 * encolan y no se pisan) queda marcado como NO TESTEABLE SIN ENTORNO
 * CONTROLADO en el reporte final.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo, hojasExtra) {
  const entorno = crearEntorno({ hojas: hojasBase(hojasExtra) });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'INV-CASO1', grupo: 'inventario', nombre: 'Caso 1: dos salidas iguales agotan el stock exacto, nunca negativo', metodo: 'EMPÍRICO',
  objetivo: 'Existencia=5, Salida A=5 y Salida B=5 "concurrentes": una se aplica, la otra se rechaza; existencia final=0 (nunca -5/-10, nunca doble movimiento)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    entorno.leerHoja('MATRIZ')[2][10] = 5; // COD-002 AZUCAR, fila 2 (índice 2 = tercera fila = fila de datos #2)

    let okA = false, okB = false, errA = '', errB = '';
    try { entorno.invocar('registrarSalidaApp', { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', token }); okA = true; }
    catch (e) { errA = e.message; }
    try { entorno.invocar('registrarSalidaApp', { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', token }); okB = true; }
    catch (e) { errB = e.message; }

    const existenciaFinal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const filasSalida = entorno.leerHoja('SALIDA').length - 1;
    const unaSiUnaNo = (okA && !okB) || (!okA && okB);

    return {
      datos: 'existencia=5, salida A=5, salida B=5 (secuencial, serializadas por el mismo lock que en producción)',
      esperado: 'una aplicada y otra rechazada, existencia final=0, 1 sola fila en SALIDA',
      obtenido: `A=${okA ? 'aplicada' : 'rechazada(' + errA + ')'}, B=${okB ? 'aplicada' : 'rechazada(' + errB + ')'}, existenciaFinal=${existenciaFinal}, filasSalida=${filasSalida}`,
      pasa: unaSiUnaNo && existenciaFinal === 0 && filasSalida === 1,
    };
  },
});

prueba({
  id: 'INV-CASO2', grupo: 'inventario', nombre: 'Caso 2: entrada y salida concurrentes se suman correctamente', metodo: 'EMPÍRICO',
  objetivo: 'Existencia=100, Entrada=20 y Salida=15 "concurrentes" → resultado final=105, sin importar el orden',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    // COD-001 HARINA ya tiene existencia=100 en el fixture estándar
    entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 20, udm: 'KG', token });
    entorno.invocar('registrarSalidaApp', { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 15, udm: 'KG', token });
    const existenciaFinal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    return {
      datos: 'existencia=100, entrada=20, salida=15',
      esperado: 'existencia final=105',
      obtenido: `existenciaFinal=${existenciaFinal}`,
      pasa: existenciaFinal === 105,
    };
  },
});

prueba({
  id: 'INV-CASO3', grupo: 'inventario', nombre: 'Caso 3: discrepancia aprobada actualiza MATRIZ, KARDEX y AUDITORÍA', metodo: 'EMPÍRICO',
  objetivo: 'Sistema=100, Físico=90, aprobada → MATRIZ=90, KARDEX registra el ajuste (Salida=10, ExistenciaAnterior=100, ExistenciaNueva=90), AUDITORIA_AJUSTES.Diferencia=-10',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10] = 100;
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA DE TRIGO', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);

    entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'ajuste caso 3', undefined);

    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardex = entorno.leerHoja('KARDEX')[1];
    const auditoria = entorno.leerHoja('AUDITORIA_AJUSTES')[1];

    const kardexOk = kardex && kardex[7] === 10 && kardex[8] === 100 && kardex[9] === 90;
    const auditoriaOk = auditoria && Number(auditoria[5]) === -10;

    return {
      datos: 'MATRIZ inicial=100, discrepancia sistema=100/físico=90 (diferencia=-10)',
      esperado: 'MATRIZ=90, KARDEX.Salida=10 (ExistenciaAnterior=100→Nueva=90), AUDITORIA_AJUSTES.Diferencia=-10',
      obtenido: `MATRIZ=${existencia}, KARDEX.Salida=${kardex && kardex[7]}, AUDITORIA.Diferencia=${auditoria && auditoria[5]}`,
      pasa: existencia === 90 && kardexOk && auditoriaOk,
    };
  },
});

prueba({
  id: 'INV-016', grupo: 'inventario', nombre: 'verificarDuplicadosAjusteFolioApp detecta un código con dos ajustes en el mismo folio', metodo: 'EMPÍRICO',
  objetivo: 'Si dos filas de KARDEX tipo=AJUSTE comparten folio y código (huella de una aprobación masiva interrumpida y reintentada), la verificación debe reportarlo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const kardex = entorno.leerHoja('KARDEX');
    kardex.push([new Date(), '10:00:00', 'AJUSTE', 'CC-DUP', 'COD-001', 'HARINA DE TRIGO', '', 10, 100, 90, 'Admin', 'Discrepancia aprobada — conteo CC-DUP: Merma']);
    kardex.push([new Date(), '10:00:02', 'AJUSTE', 'CC-DUP', 'COD-001', 'HARINA DE TRIGO', '', 10, 90, 80, 'Admin', 'Discrepancia aprobada — conteo CC-DUP: Merma (reintento)']);
    kardex.push([new Date(), '10:00:05', 'AJUSTE', 'CC-DUP', 'COD-002', 'AZUCAR ESTANDAR', 5, '', 20, 25, 'Admin', 'Discrepancia aprobada — conteo CC-DUP: Ajuste de sistema']);

    const resultado = entorno.invocar('verificarDuplicadosAjusteFolioApp', 'CC-DUP', token);

    const pasa = resultado.duplicados.length === 1
      && resultado.duplicados[0].codigo === 'COD-001'
      && resultado.duplicados[0].veces === 2;

    return {
      datos: 'KARDEX con COD-001 ajustado 2 veces en folio CC-DUP y COD-002 ajustado 1 vez en el mismo folio',
      esperado: 'duplicados=[COD-001 x2], COD-002 no aparece',
      obtenido: `duplicados=${JSON.stringify(resultado.duplicados.map(d => ({ codigo: d.codigo, veces: d.veces })))}`,
      pasa,
    };
  },
});

prueba({
  id: 'INV-017', grupo: 'inventario', nombre: 'verificarDuplicadosAjusteFolioApp no reporta nada en un folio limpio', metodo: 'EMPÍRICO',
  objetivo: 'Un folio donde cada código se ajustó una sola vez debe regresar duplicados=[]',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const kardex = entorno.leerHoja('KARDEX');
    kardex.push([new Date(), '10:00:00', 'AJUSTE', 'CC-LIMPIO', 'COD-001', 'HARINA DE TRIGO', '', 10, 100, 90, 'Admin', 'Discrepancia aprobada — conteo CC-LIMPIO: Merma']);
    kardex.push([new Date(), '10:00:05', 'AJUSTE', 'CC-LIMPIO', 'COD-002', 'AZUCAR ESTANDAR', 5, '', 20, 25, 'Admin', 'Discrepancia aprobada — conteo CC-LIMPIO: Ajuste de sistema']);
    // Mismo código en OTRO folio no debe contaminar el resultado
    kardex.push([new Date(), '10:00:10', 'AJUSTE', 'CC-OTRO', 'COD-001', 'HARINA DE TRIGO', '', 3, 90, 87, 'Admin', 'Discrepancia aprobada — conteo CC-OTRO: Merma']);

    const resultado = entorno.invocar('verificarDuplicadosAjusteFolioApp', 'CC-LIMPIO', token);

    return {
      datos: 'KARDEX con un ajuste por código en CC-LIMPIO, más un ajuste de COD-001 en un folio distinto (CC-OTRO)',
      esperado: 'duplicados=[] (el ajuste de COD-001 en CC-OTRO no cuenta para CC-LIMPIO)',
      obtenido: `duplicados=${JSON.stringify(resultado.duplicados)}`,
      pasa: resultado.duplicados.length === 0,
    };
  },
});

prueba({
  id: 'INV-018', grupo: 'inventario', nombre: 'verificarDuplicadosAjusteFolioApp exige sesión activa y rol de almacén', metodo: 'EMPÍRICO',
  objetivo: 'Un operador de área (sin acceso de almacén) no debe poder correr la verificación',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    let error = '';
    try { entorno.invocar('verificarDuplicadosAjusteFolioApp', 'CC-DUP', token); }
    catch (e) { error = e.message; }

    return {
      datos: 'token de OPERADOR de área (Cocina)',
      esperado: 'lanza un error explícito, no regresa datos',
      obtenido: `error=${error}`,
      pasa: !!error,
    };
  },
});

prueba({
  id: 'INV-CASO4', grupo: 'inventario', nombre: 'Caso 4: la misma discrepancia aprobada dos veces no se duplica', metodo: 'EMPÍRICO',
  objetivo: '1ª aprobación: AJUSTE APLICADO. 2ª aprobación de la misma fila: NO APLICA NADA (MATRIZ sin cambio, KARDEX sin fila nueva, AUDITORIA sin fila nueva)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10] = 100;
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA DE TRIGO', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);

    const r1 = entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'primera', undefined);
    const existenciaTras1 = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardexTras1 = entorno.leerHoja('KARDEX').length - 1;
    const auditoriaTras1 = entorno.leerHoja('AUDITORIA_AJUSTES').length - 1;

    const r2 = entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'segunda', undefined);
    const existenciaTras2 = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardexTras2 = entorno.leerHoja('KARDEX').length - 1;
    const auditoriaTras2 = entorno.leerHoja('AUDITORIA_AJUSTES').length - 1;

    const pasa = r1.yaProcesada === false && existenciaTras1 === 90 && kardexTras1 === 1 && auditoriaTras1 === 1
      && r2.yaProcesada === true && existenciaTras2 === 90 && kardexTras2 === 1 && auditoriaTras2 === 1;

    return {
      datos: 'misma fila de discrepancia aprobada 2 veces seguidas',
      esperado: '1ª: yaProcesada=false, MATRIZ=90, 1 fila Kardex, 1 fila Auditoría. 2ª: yaProcesada=true, todo igual (sin duplicar)',
      obtenido: `1ª: yaProcesada=${r1.yaProcesada}, MATRIZ=${existenciaTras1}, kardex=${kardexTras1}, auditoria=${auditoriaTras1} | 2ª: yaProcesada=${r2.yaProcesada}, MATRIZ=${existenciaTras2}, kardex=${kardexTras2}, auditoria=${auditoriaTras2}`,
      pasa,
    };
  },
});

prueba({
  id: 'INV-CASO5', grupo: 'inventario', nombre: 'Caso 5: discrepancia rechazada no toca MATRIZ ni se aplica al cerrar el folio', metodo: 'EMPÍRICO',
  objetivo: 'rechazarDiscrepancia no cambia MATRIZ/KARDEX; y el cierre del folio de conteo (cerrarConteoFolioApp) tampoco aplica ese ajuste ya rechazado',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10] = 100;

    // 1) Rechazar la discrepancia directamente
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-5', 'COD-001', 'HARINA DE TRIGO', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);
    entorno.invocar('rechazarDiscrepancia', 2, 'rechazada a propósito', undefined);
    const existenciaTrasRechazo = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardexTrasRechazo = entorno.leerHoja('KARDEX').length - 1;
    const filaDiscrepancia = entorno.leerHoja('DISCREPANCIAS')[1];

    // 2) El folio de conteo que originó esa discrepancia se cierra: el cierre NO debe reaplicar el ajuste ya rechazado
    entorno.hojas.CONTEO_CICLICO._filas().push(['CC-5', new Date(), 'Admin', 'COD-001', 'HARINA DE TRIGO', 'A-01', 100, 90, -10, 'PENDIENTE', 'A']);
    entorno.invocar('cerrarConteoFolioApp', 'CC-5', token);
    const existenciaTrasCierre = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const auditoriaFilas = entorno.leerHoja('AUDITORIA_AJUSTES').length - 1;

    const pasa = existenciaTrasRechazo === 100 && kardexTrasRechazo === 0
      && filaDiscrepancia[9] === 'RECHAZADO' && filaDiscrepancia[13] === 'SIN AJUSTE'
      && existenciaTrasCierre === 100 && auditoriaFilas === 0;

    return {
      datos: 'discrepancia sistema=100/físico=90 rechazada, luego se cierra el folio CC-5 que la originó',
      esperado: 'MATRIZ se mantiene en 100 todo el tiempo; sin fila nueva en KARDEX; el cierre no crea ajuste en AUDITORIA_AJUSTES',
      obtenido: `trasRechazo: MATRIZ=${existenciaTrasRechazo}, kardex=${kardexTrasRechazo}, estado=${filaDiscrepancia[9]} | trasCierre: MATRIZ=${existenciaTrasCierre}, auditoriaAjustes=${auditoriaFilas}`,
      pasa,
    };
  },
});

prueba({
  id: 'INV-006', grupo: 'inventario', nombre: 'Cierre de folio SÍ aplica un ajuste no resuelto individualmente', metodo: 'EMPÍRICO',
  objetivo: 'Control positivo del Caso 5: una diferencia de conteo que NADIE aprobó/rechazó individualmente sí debe aplicarse al cerrar el folio (comportamiento histórico que no debe romperse)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-003')[10] = 50;
    entorno.hojas.CONTEO_CICLICO._filas().push(['CC-6', new Date(), 'Admin', 'COD-003', 'SAL DE MESA', 'A-01', 50, 45, -5, 'PENDIENTE', 'A']);
    entorno.invocar('cerrarConteoFolioApp', 'CC-6', token);
    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-003')[10];
    const auditoriaFilas = entorno.leerHoja('AUDITORIA_AJUSTES').length - 1;
    return {
      datos: 'conteo sistema=50/físico=45 (diferencia=-5), sin resolución individual previa',
      esperado: 'MATRIZ=45, 1 fila nueva en AUDITORIA_AJUSTES',
      obtenido: `MATRIZ=${existencia}, auditoriaAjustes=${auditoriaFilas}`,
      pasa: existencia === 45 && auditoriaFilas === 1,
    };
  },
});

prueba({
  id: 'INV-007', grupo: 'inventario', nombre: 'Aprobar diferencias de Inventario Mensual en lote (getRangeList) escribe la fila correcta de cada una', metodo: 'EMPÍRICO',
  objetivo: 'aprobarDiscrepanciasLoteInventarioMensualApp se reescribió para leer/escribir en bloque (antes: un getRange().getValue()/.setValue() por fila) — debe seguir marcando "APROBADO" exactamente en la fila de cada elemento de la lista, sin tocar las demás, y sin volver a contar las que ya estaban aprobadas',
  ejecutar() {
    const hoy = new Date();
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' }, {
      INVENTARIO_MENSUAL: [
        ['Folio', 'Fecha', 'Usuario', 'Código', 'Producto', 'Ubicación', 'UDM', 'Categoría', 'Existencia Teórica', 'Existencia Física', 'Diferencia', 'Estado'],
        ['INV-1', hoy, 'Admin', 'COD-001', 'HARINA DE TRIGO', 'A-01', 'KG', 'Abarrotes', 100, 90, -10, 'PENDIENTE'],
        ['INV-1', hoy, 'Admin', 'COD-002', 'AZUCAR ESTANDAR', 'A-02', 'KG', 'Abarrotes', 50, 48, -2, 'PENDIENTE'],
        ['INV-1', hoy, 'Admin', 'COD-003', 'SAL DE MESA', 'A-03', 'KG', 'Abarrotes', 30, 30, 0, 'APROBADO'],
      ],
    });

    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    const resultado = entorno.invocar('aprobarDiscrepanciasLoteInventarioMensualApp', [2, 3, 4], token);
    const filas = entorno.leerHoja('INVENTARIO_MENSUAL');
    const auditoriaDespues = entorno.leerHoja('AUDITORIA').length;

    const estadosCorrectos = filas[1][11] === 'APROBADO' && filas[2][11] === 'APROBADO' && filas[3][11] === 'APROBADO';
    const datosIntactos = filas[1][3] === 'COD-001' && filas[2][3] === 'COD-002' && filas[3][3] === 'COD-003';

    return {
      datos: 'fila 2 y 3 PENDIENTE, fila 4 ya APROBADA — se llama con las 3 filas [2,3,4]',
      esperado: 'aprobadas=2 (la ya aprobada no se recuenta), las 3 filas quedan en estado APROBADO, código de cada fila sin alterar, 2 filas nuevas en AUDITORIA',
      obtenido: `aprobadas=${resultado.aprobadas}, estados=[${filas[1][11]},${filas[2][11]},${filas[3][11]}], datosIntactos=${datosIntactos}, auditoria +${auditoriaDespues - auditoriaAntes}`,
      pasa: resultado.aprobadas === 2 && estadosCorrectos && datosIntactos && (auditoriaDespues - auditoriaAntes) === 2,
    };
  },
});

prueba({
  id: 'INV-009', grupo: 'inventario', nombre: 'Cerrar Inventario Mensual con una diferencia sin aprobar ni rechazar bloquea el cierre completo, sin aplicar nada', metodo: 'EMPÍRICO',
  objetivo: 'cerrarInventarioMensualApp debe rechazar el cierre si queda alguna diferencia en un estado distinto de APROBADO/RECHAZADO, y NO debe haber aplicado ningún ajuste a MATRIZ aunque otra línea del mismo folio ya estuviera aprobada (antes de esta corrección, el cierre aplicaba todas las diferencias sin revisar el estado)',
  ejecutar() {
    const hoy = new Date();
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' }, {
      INVENTARIO_MENSUAL: [
        ['Folio', 'Fecha', 'Usuario', 'Código', 'Producto', 'Ubicación', 'UDM', 'Categoría', 'Existencia Teórica', 'Existencia Física', 'Diferencia', 'Estado'],
        ['INV-9', hoy, 'Admin', 'COD-001', 'HARINA DE TRIGO', 'A-01', 'KG', 'Abarrotes', 100, 95, -5, 'DIFERENCIA'],
        ['INV-9', hoy, 'Admin', 'COD-002', 'AZUCAR ESTANDAR', 'A-02', 'KG', 'Abarrotes', 5, 8, 3, 'APROBADO'],
      ],
    });

    const existenciaCOD001Antes = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const existenciaCOD002Antes = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];

    let error = '';
    try { entorno.invocar('cerrarInventarioMensualApp', 'INV-9', 'Supervisor X', token); }
    catch (e) { error = e.message; }

    const existenciaCOD001Despues = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const existenciaCOD002Despues = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const estadoFolio = entorno.leerHoja('INVENTARIO_MENSUAL')[1][11];

    return {
      datos: 'COD-001 con diferencia -5 en estado DIFERENCIA (sin resolver), COD-002 con diferencia +3 ya APROBADA, mismo folio INV-9',
      esperado: 'lanza error mencionando diferencia(s) sin aprobar ni rechazar; existencia de AMBOS productos queda intacta (100 y 5); el folio no queda CERRADO',
      obtenido: `error="${error}", COD-001 ${existenciaCOD001Antes}->${existenciaCOD001Despues}, COD-002 ${existenciaCOD002Antes}->${existenciaCOD002Despues}, estadoFolio=${estadoFolio}`,
      pasa: /sin aprobar ni rechazar/.test(error) && existenciaCOD001Despues === 100 && existenciaCOD002Despues === 5 && estadoFolio !== 'CERRADO',
    };
  },
});

prueba({
  id: 'INV-010', grupo: 'inventario', nombre: 'Cerrar Inventario Mensual aplica SOLO las diferencias aprobadas; una rechazada no toca existencia', metodo: 'EMPÍRICO',
  objetivo: 'con todas las diferencias del folio resueltas (una APROBADA, una RECHAZADA), el cierre debe tener éxito, ajustar existencia solo de la aprobada, y dejar la rechazada exactamente como estaba',
  ejecutar() {
    const hoy = new Date();
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' }, {
      INVENTARIO_MENSUAL: [
        ['Folio', 'Fecha', 'Usuario', 'Código', 'Producto', 'Ubicación', 'UDM', 'Categoría', 'Existencia Teórica', 'Existencia Física', 'Diferencia', 'Estado'],
        ['INV-10', hoy, 'Admin', 'COD-001', 'HARINA DE TRIGO', 'A-01', 'KG', 'Abarrotes', 100, 95, -5, 'RECHAZADO'],
        ['INV-10', hoy, 'Admin', 'COD-002', 'AZUCAR ESTANDAR', 'A-02', 'KG', 'Abarrotes', 5, 8, 3, 'APROBADO'],
      ],
      CONTROL_INVENTARIO: [
        ['Folio', 'Fecha Inicio', 'Responsable', 'Productos', 'Contados', 'Avance %', 'Estado', 'Fecha Cierre', 'Supervisor', 'Productos con Diferencia', 'Exactitud %', 'Valor Ajustado'],
        ['INV-10', hoy, 'Admin', 2, 2, 100, 'ABIERTO', '', '', 0, 0, 0],
      ],
    });

    const resultado = entorno.invocar('cerrarInventarioMensualApp', 'INV-10', 'Supervisor X', token);

    const existenciaCOD001 = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const existenciaCOD002 = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const filas = entorno.leerHoja('INVENTARIO_MENSUAL');
    const ambasCerradas = filas[1][11] === 'CERRADO' && filas[2][11] === 'CERRADO';

    return {
      datos: 'COD-001 rechazada (diferencia -5), COD-002 aprobada (diferencia +3), folio INV-10',
      esperado: 'cierre exitoso; COD-001 se queda en 100 (sin tocar, por estar rechazada); COD-002 pasa a 8 (valor físico aprobado); ambas filas quedan marcadas CERRADO',
      obtenido: `productosConDiferencia=${resultado.productosConDiferencia}, COD-001=${existenciaCOD001}, COD-002=${existenciaCOD002}, ambasCerradas=${ambasCerradas}`,
      pasa: resultado.productosConDiferencia === 1 && existenciaCOD001 === 100 && existenciaCOD002 === 8 && ambasCerradas,
    };
  },
});

prueba({
  id: 'INV-011', grupo: 'inventario', nombre: 'rechazarDiscrepanciaInventarioMensualApp marca RECHAZADO y deja rastro en AUDITORIA', metodo: 'EMPÍRICO',
  objetivo: 'la función nueva debe escribir "RECHAZADO" en la columna Estado de la fila indicada, sin tocar Existencia Física ni Diferencia, y registrar el motivo en AUDITORIA',
  ejecutar() {
    const hoy = new Date();
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' }, {
      INVENTARIO_MENSUAL: [
        ['Folio', 'Fecha', 'Usuario', 'Código', 'Producto', 'Ubicación', 'UDM', 'Categoría', 'Existencia Teórica', 'Existencia Física', 'Diferencia', 'Estado'],
        ['INV-11', hoy, 'Admin', 'COD-001', 'HARINA DE TRIGO', 'A-01', 'KG', 'Abarrotes', 100, 95, -5, 'DIFERENCIA'],
      ],
    });

    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    entorno.invocar('rechazarDiscrepanciaInventarioMensualApp', 2, 'Error de báscula, no es una diferencia real', token);
    const fila = entorno.leerHoja('INVENTARIO_MENSUAL')[1];
    const auditoriaDespues = entorno.leerHoja('AUDITORIA').length;

    return {
      datos: 'fila 2 (COD-001) en estado DIFERENCIA, se rechaza con un comentario',
      esperado: 'columna Estado pasa a RECHAZADO, Física (95) y Diferencia (-5) intactas, 1 fila nueva en AUDITORIA',
      obtenido: `estado=${fila[11]}, fisico=${fila[9]}, diferencia=${fila[10]}, auditoria +${auditoriaDespues - auditoriaAntes}`,
      pasa: fila[11] === 'RECHAZADO' && fila[9] === 95 && fila[10] === -5 && (auditoriaDespues - auditoriaAntes) === 1,
    };
  },
});

prueba({
  id: 'INV-008', grupo: 'inventario', nombre: 'Marcar conteos programados como generados (getRangeList) solo toca las filas indicadas', metodo: 'EMPÍRICO',
  objetivo: 'marcarConteoProgramadoGeneradoApp se reescribió para usar getRangeList + un solo setValue() en vez de un setValue() por fila — debe seguir poniendo la fecha de hoy exactamente en la columna G (ÚltimaGeneración) de cada fila marcada, sin tocar las filas no incluidas',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const prog = entorno.leerHoja('PROGRAMACION_CONTEOS');
    prog.push(['PC-0001', 'A01', 'LUNES', 'SEMANAL', 'Alberto Romero', 'ACTIVO', '']);
    prog.push(['PC-0002', 'B01', 'LUNES', 'SEMANAL', 'Alberto Romero', 'ACTIVO', '']);
    prog.push(['PC-0003', 'C01', 'MARTES', 'SEMANAL', 'Alberto Romero', 'ACTIVO', '']); // no se marca — debe quedar sin tocar

    entorno.invocar('marcarConteoProgramadoGeneradoApp', [2, 3], token);

    const filas = entorno.leerHoja('PROGRAMACION_CONTEOS');
    const filaA01TieneFecha = !!filas[1][6];
    const filaB01TieneFecha = !!filas[2][6];
    const filaC01SigueVacia = filas[3][6] === '' || filas[3][6] === undefined;
    const idsIntactos = filas[1][0] === 'PC-0001' && filas[2][0] === 'PC-0002' && filas[3][0] === 'PC-0003';

    return {
      datos: '3 racks programados (A01, B01, C01) — se marcan como generados solo A01 (fila 2) y B01 (fila 3)',
      esperado: 'A01 y B01 quedan con fecha de hoy en ÚltimaGeneración; C01 (fila 4, no incluida) sigue vacía; ningún ID se altera',
      obtenido: `A01tieneFecha=${filaA01TieneFecha}, B01tieneFecha=${filaB01TieneFecha}, C01sigueVacia=${filaC01SigueVacia}, idsIntactos=${idsIntactos}`,
      pasa: filaA01TieneFecha && filaB01TieneFecha && filaC01SigueVacia && idsIntactos,
    };
  },
});

prueba({
  id: 'INV-012', grupo: 'inventario', nombre: 'Escáner: buscarProductosPorCodigoApp encuentra una coincidencia exacta', metodo: 'EMPÍRICO',
  objetivo: 'El lookup que usa el servicio de escaneo debe regresar exactamente 1 coincidencia para un código único, con los datos necesarios para mostrar el producto sin otra llamada',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    const r = entorno.invocar('buscarProductosPorCodigoApp', 'COD-001', token);
    return {
      datos: 'COD-001 = HARINA DE TRIGO, existencia=100 (fixture estándar)',
      esperado: '1 coincidencia: producto=HARINA DE TRIGO, existencia=100',
      obtenido: `coincidencias=${r.length}, producto=${r[0] && r[0].producto}, existencia=${r[0] && r[0].existencia}`,
      pasa: r.length === 1 && r[0].producto === 'HARINA DE TRIGO' && r[0].existencia === 100,
    };
  },
});

prueba({
  id: 'INV-013', grupo: 'inventario', nombre: 'Escáner: código inexistente regresa arreglo vacío, sin inventar ni tronar', metodo: 'EMPÍRICO',
  objetivo: 'Un código escaneado que no existe en MATRIZ debe regresar [] — la pantalla decide mostrar "producto no encontrado" a partir de un arreglo vacío, no de un error',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    const r = entorno.invocar('buscarProductosPorCodigoApp', '7501234567890', token);
    return {
      datos: 'código "7501234567890" nunca capturado en MATRIZ',
      esperado: 'arreglo vacío ([])',
      obtenido: `coincidencias=${r.length}`,
      pasa: Array.isArray(r) && r.length === 0,
    };
  },
});

prueba({
  id: 'INV-014', grupo: 'inventario', nombre: 'Escáner: un código duplicado en MATRIZ regresa TODAS las coincidencias, sin elegir una', metodo: 'EMPÍRICO',
  objetivo: 'Si dos productos quedaron con el mismo Código (error de captura), buscarProductosPorCodigoApp debe regresar ambos — nunca elegir el primero en silencio, para que el usuario decida en la interfaz',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    // Se duplica el código de COD-002 al de COD-001 a propósito.
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[4] = 'COD-001';

    const r = entorno.invocar('buscarProductosPorCodigoApp', 'COD-001', token);
    const productos = r.map(p => p.producto).sort();

    return {
      datos: 'COD-001 asignado por error a HARINA DE TRIGO y AZUCAR ESTANDAR',
      esperado: '2 coincidencias: HARINA DE TRIGO y AZUCAR ESTANDAR',
      obtenido: `coincidencias=${r.length}, productos=${JSON.stringify(productos)}`,
      pasa: r.length === 2 && productos[0] === 'AZUCAR ESTANDAR' && productos[1] === 'HARINA DE TRIGO',
    };
  },
});

prueba({
  id: 'INV-015', grupo: 'inventario', nombre: 'Escáner: buscarProductoApp (manual, ya existente) sigue devolviendo la primera coincidencia igual que antes', metodo: 'EMPÍRICO',
  objetivo: 'El refactor que reutiliza buscarProductosEnMatrizPorCodigoExacto_ dentro de buscarProductoApp no debe cambiar su contrato ni comportamiento actual para Entradas/Salidas manuales — mismo objeto, sin campo "codigo", sin arreglo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    const r = entorno.invocar('buscarProductoApp', 'COD-001', token);
    const noExiste = entorno.invocar('buscarProductoApp', 'NO-EXISTE', token);
    return {
      datos: 'mismo llamador que ya usan Entradas/Salidas manuales',
      esperado: 'objeto único (no arreglo) con producto=HARINA DE TRIGO; null para un código que no existe',
      obtenido: `tipo=${Array.isArray(r) ? 'arreglo' : 'objeto'}, producto=${r && r.producto}, noExiste=${noExiste}`,
      pasa: !Array.isArray(r) && r.producto === 'HARINA DE TRIGO' && noExiste === null,
    };
  },
});

prueba({
  id: 'INV-019', grupo: 'inventario', nombre: 'INV-202: registrarCambioUbicacionApp mueve rack/ubicación sin tocar existencia ni Kardex', metodo: 'EMPÍRICO',
  objetivo: 'Cambiar de rack/ubicación un producto NO debe registrarse como entrada ni salida — Existencia y Kardex deben quedar exactamente igual, solo cambia MATRIZ.Rack/Ubicación',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    const filaAntes = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001');
    const existenciaAntes = filaAntes[10];
    const kardexAntes = entorno.leerHoja('KARDEX').length;

    const res = entorno.invocar('registrarCambioUbicacionApp', 'COD-001', 'B', 'B-02-N03-P01', token);

    const filaDespues = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001');
    const kardexDespues = entorno.leerHoja('KARDEX').length;
    const auditoria = entorno.leerHoja('AUDITORIA');
    const filaAuditoria = auditoria[auditoria.length - 1];

    return {
      datos: 'COD-001 (HARINA DE TRIGO, existencia=100, rack original) → nuevo rack B, ubicación B-02-N03-P01',
      esperado: 'rack/ubicación actualizados, existencia y Kardex sin cambio, queda registrado en AUDITORIA (módulo INVENTARIO, acción CAMBIO DE UBICACION)',
      obtenido: `rackNuevo=${filaDespues[6]}, ubicacionNueva=${filaDespues[9]}, existenciaAntes=${existenciaAntes}, existenciaDespues=${filaDespues[10]}, ` +
        `kardexAntes=${kardexAntes}, kardexDespues=${kardexDespues}, accionAuditoria=${filaAuditoria[5]}`,
      pasa: res.ok === true && filaDespues[6] === 'B' && filaDespues[9] === 'B-02-N03-P01' &&
        filaDespues[10] === existenciaAntes && kardexDespues === kardexAntes &&
        filaAuditoria[4] === 'INVENTARIO' && filaAuditoria[5] === 'CAMBIO DE UBICACION',
    };
  },
});

prueba({
  id: 'INV-020', grupo: 'inventario', nombre: 'INV-202: registrarCambioUbicacionApp acepta cambiar solo rack o solo ubicación', metodo: 'EMPÍRICO',
  objetivo: 'Si solo se manda un valor nuevo, el otro debe conservar su valor anterior en vez de borrarse',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    const filaAntes = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001');
    const rackOriginal = filaAntes[6];

    const res = entorno.invocar('registrarCambioUbicacionApp', 'COD-001', '', 'A-05-N01-P02', token);
    const filaDespues = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001');

    return {
      datos: `rack original=${rackOriginal}, se manda rack="" (sin cambio) y ubicación nueva=A-05-N01-P02`,
      esperado: `rack se conserva (${rackOriginal}), ubicación cambia a A-05-N01-P02`,
      obtenido: `rackDespues=${filaDespues[6]}, ubicacionDespues=${filaDespues[9]}, res.rackNuevo=${res.rackNuevo}`,
      pasa: filaDespues[6] === rackOriginal && filaDespues[9] === 'A-05-N01-P02' && res.rackNuevo === rackOriginal,
    };
  },
});

prueba({
  id: 'INV-021', grupo: 'inventario', nombre: 'INV-202: registrarCambioUbicacionApp exige sesión y bloquea CONSULTA/SUPERVISOR', metodo: 'EMPÍRICO',
  objetivo: 'Mover un producto de ubicación es una operación de piso (igual que registrar entrada/salida) — debe exigir sesión y bloquear a CONSULTA/SUPERVISOR igual que requerirAccesoOperacionesApp_ ya hace para entradas/salidas',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'consulta@tagers.com', nombre: 'Consulta', rol: 'CONSULTA' });
    let error = '';
    try { entorno.invocar('registrarCambioUbicacionApp', 'COD-001', 'B', '', token); }
    catch (e) { error = e.message; }

    let errorSinSesion = '';
    try { entorno.invocar('registrarCambioUbicacionApp', 'COD-001', 'B', '', undefined); }
    catch (e) { errorSinSesion = e.message; }

    return {
      datos: 'token de CONSULTA, y aparte una llamada sin token',
      esperado: 'ambas lanzan error explícito, ninguna mueve nada',
      obtenido: `errorConsulta=${error}, errorSinSesion=${errorSinSesion}`,
      pasa: !!error && !!errorSinSesion,
    };
  },
});

prueba({
  id: 'INV-022', grupo: 'inventario', nombre: 'INV-202: registrarCambioUbicacionApp rechaza un código que no existe en MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'No debe crear ninguna fila ni modificar nada si el código no existe',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    const filasAntes = entorno.leerHoja('MATRIZ').length;
    let error = '';
    try { entorno.invocar('registrarCambioUbicacionApp', 'NO-EXISTE', 'B', '', token); }
    catch (e) { error = e.message; }
    const filasDespues = entorno.leerHoja('MATRIZ').length;
    return {
      datos: 'código NO-EXISTE, no está en MATRIZ',
      esperado: 'lanza error explícito, MATRIZ sin filas nuevas',
      obtenido: `error=${error}, filasAntes=${filasAntes}, filasDespues=${filasDespues}`,
      pasa: !!error && filasAntes === filasDespues,
    };
  },
});
