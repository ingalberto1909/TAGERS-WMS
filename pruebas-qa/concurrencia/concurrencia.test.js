'use strict';

/*
 * Pruebas de concurrencia. Nota metodológica importante (léela antes de
 * juzgar "solo son llamadas secuenciales"):
 *
 * El propio backend de producción serializa TODA escritura relevante con
 * un único LockService.getScriptLock() por proyecto (conBloqueoApp_ en
 * 📁 App.gs.gs / Código.gs). Apps Script no tiene hilos: dos peticiones
 * que llegan "al mismo tiempo" de verdad se encolan en ese lock y se
 * ejecutan una tras otra — nunca en paralelo real. Por eso invocar la
 * función real dos veces EN SECUENCIA, contra el MISMO estado compartido
 * (mismo `entorno`), es una reproducción EMPÍRICA fiel de lo que pasa del
 * otro lado del lock, no una aproximación.
 *
 * Lo que esta carpeta NO puede probar — y se declara así en el reporte
 * final en vez de fingir que sí — es si dos peticiones HTTP concurrentes
 * de verdad contra el despliegue real de Apps Script se encolan sin
 * pisarse (eso depende de la infraestructura de Google, no del código
 * fuente que podemos cargar y ejecutar aquí). Ver "NO TESTEABLE SIN
 * ENTORNO CONTROLADO" en el reporte.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'CONC-001', grupo: 'concurrencia', nombre: 'Tres salidas simultáneas, solo alcanza para dos', metodo: 'EMPÍRICO',
  objetivo: 'Con existencia=10 y 3 salidas de 5 cada una "a la vez", exactamente 2 se aplican y 1 se rechaza — nunca negativo, nunca 3 aplicadas',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10] = 10; // AZUCAR

    const resultados = [1, 2, 3].map(n => {
      try { entorno.invocar('registrarSalidaApp', { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', token }); return 'aplicada'; }
      catch (e) { return 'rechazada'; }
    });
    const aplicadas = resultados.filter(r => r === 'aplicada').length;
    const existenciaFinal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];

    return {
      datos: 'existencia=10, 3 salidas de 5 c/u',
      esperado: 'exactamente 2 aplicadas, 1 rechazada, existencia final=0',
      obtenido: `resultados=[${resultados.join(',')}], existenciaFinal=${existenciaFinal}`,
      pasa: aplicadas === 2 && existenciaFinal === 0,
    };
  },
});

prueba({
  id: 'CONC-002', grupo: 'concurrencia', nombre: 'Folios de conteo cíclico no colisionan entre el flujo manual y el legado', metodo: 'EMPÍRICO',
  objetivo: 'generarConteoRacksApp (flujo activo) y generarConteoRacks (Código.gs, diálogo legado) comparten el mismo consecutivo diario protegido por lock — dos generaciones "a la vez" no deben repetir folio (bug corregido en Fase 2/Sección B)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const r1 = entorno.invocar('generarConteoRacksApp', ['A'], token);
    // generarConteoRacks (Código.gs) es la ruta legada de diálogo de Sheets:
    // no regresa el folio (lo muestra con getUi().alert(), pensado para un
    // humano viendo la hoja) — se lee el folio real escrito en CONTEO_CICLICO.
    entorno.invocar('generarConteoRacks', ['A']);
    const foliosEnHoja = entorno.leerHoja('CONTEO_CICLICO').slice(1).map(f => f[0]);
    const foliosUnicos = [...new Set(foliosEnHoja)];
    return {
      datos: 'una generación por la SPA activa, otra por el diálogo legado, mismo día',
      esperado: 'exactamente 2 folios distintos, consecutivo estricto 001 y 002 (bug J2 corregido: antes podía saltar a -006)',
      obtenido: `folios=${foliosUnicos.join(',')}`,
      pasa: foliosUnicos.length === 2 && foliosUnicos.includes(r1.folio) && foliosUnicos.some(f => f.endsWith('-001')) && foliosUnicos.some(f => f.endsWith('-002')),
    };
  },
});

prueba({
  id: 'CONC-006', grupo: 'concurrencia', nombre: 'El consecutivo de folio de conteo no salta números', metodo: 'EMPÍRICO',
  objetivo: 'Un conteo que abarca varios productos (varias filas, un solo folio) no debe hacer que el SIGUIENTE conteo del día salte de -001 a -006 (bug J2 corregido)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // El fixture estándar tiene varios productos en rack "A" -> el primer folio genera varias filas.
    const r1 = entorno.invocar('generarConteoRacksApp', ['A'], token);
    const filasDelPrimerFolio = entorno.leerHoja('CONTEO_CICLICO').slice(1).filter(f => f[0] === r1.folio).length;
    const r2 = entorno.invocar('generarConteoRacksApp', ['A'], token);
    return {
      datos: `1er folio (${r1.folio}) generó ${filasDelPrimerFolio} filas (1 por producto en rack A)`,
      esperado: 'el 2º folio del día es exactamente el siguiente consecutivo (-002), sin importar cuántas filas generó el 1º',
      obtenido: `folio1=${r1.folio}, folio2=${r2.folio}`,
      pasa: filasDelPrimerFolio > 1 && r2.folio === r1.folio.replace('-001', '-002'),
    };
  },
});

prueba({
  id: 'CONC-003', grupo: 'concurrencia', nombre: 'Dos OCs generadas seguidas el mismo día no repiten folio', metodo: 'EMPÍRICO',
  objetivo: 'generarOrdenCompraApp reserva su consecutivo dentro del lock — dos compras "a la vez" no deben terminar con el mismo folio OC-YYYYMMDD-NNN',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc1 = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR A', '', [{ codigo: 'COD-001', producto: 'HARINA', cantidad: 1, udm: 'KG', precio: 1 }], token);
    const oc2 = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR B', '', [{ codigo: 'COD-002', producto: 'AZUCAR', cantidad: 1, udm: 'KG', precio: 1 }], token);
    return {
      datos: '2 OCs generadas seguidas, mismo día',
      esperado: 'folios distintos',
      obtenido: `folio1=${oc1.folio}, folio2=${oc2.folio}`,
      pasa: oc1.folio !== oc2.folio,
    };
  },
});

prueba({
  id: 'CONC-004', grupo: 'concurrencia', nombre: 'Aprobación y rechazo simultáneos de la MISMA discrepancia: gana el primero, el segundo no aplica nada', metodo: 'EMPÍRICO',
  objetivo: 'Si dos supervisores intentan resolver la misma fila "al mismo tiempo" (uno aprueba, otro rechaza), el que llegue primero decide el estado y el segundo no debe poder pisarlo (bug J1 corregido: rechazarDiscrepancia ahora también es idempotente)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10] = 100;
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA DE TRIGO', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);

    const rAprobar = entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'primero en llegar', undefined);
    // El "segundo" intenta rechazar la misma fila después de que ya fue aprobada.
    const rRechazar = entorno.invocar('rechazarDiscrepancia', 2, 'llega tarde', undefined);

    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const kardexFilas = entorno.leerHoja('KARDEX').length - 1;
    const filaFinal = entorno.leerHoja('DISCREPANCIAS')[1];

    return {
      datos: 'fila aprobada primero (ajusta MATRIZ a 90), luego alguien intenta "rechazarla" sin haber refrescado su pantalla',
      esperado: 'rechazar no hace nada (yaProcesada:true); MATRIZ sigue en 90; 1 sola fila en KARDEX; el estado de la fila se queda en APROBADO, no se pisa a RECHAZADO',
      obtenido: `aprobar.yaProcesada=${rAprobar.yaProcesada}, rechazar.yaProcesada=${rRechazar.yaProcesada}, MATRIZ=${existencia}, kardex=${kardexFilas}, estadoFinalFila=${filaFinal[9]}`,
      pasa: rAprobar.yaProcesada === false && rRechazar.yaProcesada === true && existencia === 90 && kardexFilas === 1 && filaFinal[9] === 'APROBADO',
    };
  },
});

prueba({
  id: 'CONC-005', grupo: 'concurrencia', nombre: 'Rechazar la misma discrepancia dos veces no se duplica', metodo: 'EMPÍRICO',
  objetivo: 'rechazarDiscrepancia debe ser idempotente igual que aprobarDiscrepancia (bug J1 corregido)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA DE TRIGO', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);

    const r1 = entorno.invocar('rechazarDiscrepancia', 2, 'primer rechazo', undefined);
    const r2 = entorno.invocar('rechazarDiscrepancia', 2, 'segundo rechazo, distinto comentario', undefined);
    const filaFinal = entorno.leerHoja('DISCREPANCIAS')[1];

    return {
      datos: 'misma fila rechazada 2 veces con comentarios distintos',
      esperado: '1ª: yaProcesada=false, aplica. 2ª: yaProcesada=true, el comentario del 2º intento NO sobreescribe el del 1º',
      obtenido: `r1.yaProcesada=${r1.yaProcesada}, r2.yaProcesada=${r2.yaProcesada}, comentario=${filaFinal[12]}`,
      pasa: r1.yaProcesada === false && r2.yaProcesada === true && filaFinal[12] === 'primer rechazo',
    };
  },
});
