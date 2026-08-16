'use strict';

/*
 * Fundación multi-sucursal (Opción B del diseño de la etapa anterior).
 * Nada de esto está conectado a ninguna pantalla todavía — estas
 * pruebas ejercen directamente las funciones nuevas (parámetro opcional
 * `sucursal` en los 3 escritores centralizados de existencia + la hoja
 * nueva EXISTENCIAS_SUCURSAL) para demostrar dos cosas:
 *
 *   1. Cuando NADIE manda una sucursal (el caso de HOY, 100% de las
 *      llamadas reales), el comportamiento es exactamente el de antes
 *      — ya lo prueba el resto de la suite sin haber cambiado una sola
 *      línea, y aquí se repite explícito.
 *   2. Cuando SÍ se manda una sucursal real, la escritura queda aislada
 *      en su propia fila de EXISTENCIAS_SUCURSAL, sin tocar MATRIZ ni
 *      las filas de otras sucursales — la propiedad de aislamiento que
 *      justificó recomendar la Opción B en el diseño.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

prueba({
  id: 'SUC-001', grupo: 'sucursales', nombre: 'Sin sucursal explícita, todo sigue igual que antes', metodo: 'EMPÍRICO',
  objetivo: 'ajustarExistenciaMatrizPorDeltaValidado_ sin 3er argumento debe escribir en MATRIZ como siempre y NO crear la hoja EXISTENCIAS_SUCURSAL',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20);
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const hojaExistencias = entorno.hojas.EXISTENCIAS_SUCURSAL;
    return {
      datos: 'existencia inicial=100 en MATRIZ, +20 sin pasar sucursal',
      esperado: 'MATRIZ=120, la hoja EXISTENCIAS_SUCURSAL no se crea',
      obtenido: `MATRIZ=${existenciaMatriz}, hojaExistenciasSucursalCreada=${!!hojaExistencias}`,
      pasa: existenciaMatriz === 120 && !hojaExistencias,
    };
  },
});

prueba({
  id: 'SUC-002', grupo: 'sucursales', nombre: 'Escribir en una sucursal real no toca MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'Pasar sucursal="S02" debe crear/actualizar una fila en EXISTENCIAS_SUCURSAL y dejar MATRIZ.Existencia intacta',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 30, 'S02');
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const filaSucursal = entorno.leerHoja('EXISTENCIAS_SUCURSAL')[1];
    return {
      datos: 'MATRIZ.COD-001=100 (sin tocar), S02 recibe +30 desde 0',
      esperado: 'MATRIZ sigue en 100, EXISTENCIAS_SUCURSAL tiene 1 fila (COD-001, S02, 30)',
      obtenido: `MATRIZ=${existenciaMatriz}, filaSucursal=${JSON.stringify(filaSucursal)}`,
      pasa: existenciaMatriz === 100 && filaSucursal && filaSucursal[0] === 'COD-001' && filaSucursal[1] === 'S02' && filaSucursal[2] === 30,
    };
  },
});

prueba({
  id: 'SUC-003', grupo: 'sucursales', nombre: 'Escribir en una sucursal no afecta a otra', metodo: 'EMPÍRICO',
  objetivo: 'Dos escrituras en S02 y S05 para el mismo código deben quedar en filas separadas, cada una con su propio valor',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 50, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S05');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 30, 'S05'); // segunda escritura a la MISMA fila de S05
    const filas = entorno.leerHoja('EXISTENCIAS_SUCURSAL').slice(1);
    const s02 = filas.find(f => f[1] === 'S02');
    const s05 = filas.find(f => f[1] === 'S05');
    return {
      datos: 'S02 recibe +50, S05 recibe +10 y luego +30 más',
      esperado: '2 filas: S02=50, S05=40 (10+30, misma fila actualizada, no duplicada)',
      obtenido: `filas=${filas.length}, S02=${s02 && s02[2]}, S05=${s05 && s05[2]}`,
      pasa: filas.length === 2 && s02[2] === 50 && s05[2] === 40,
    };
  },
});

prueba({
  id: 'SUC-004', grupo: 'sucursales', nombre: 'Validación de existencia negativa funciona por sucursal', metodo: 'EMPÍRICO',
  objetivo: 'ajustarExistenciaMatrizPorDeltaValidado_ debe bloquear una salida que deje negativa la existencia DE ESA sucursal, aunque MATRIZ (S01) tenga stock de sobra',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    // COD-001 tiene 100 en MATRIZ (S01), pero S03 arranca en 0.
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -20, 'S03'); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    return {
      datos: 'S03 existencia local=0, intenta salida de 20 (MATRIZ/S01 tiene 100, pero es irrelevante para S03)',
      esperado: 'bloqueado con "Existencia insuficiente", MATRIZ (S01) no se toca',
      obtenido: bloqueado ? mensaje : 'PERMITIDO',
      pasa: bloqueado && /insuficiente/i.test(mensaje) && existenciaMatriz === 100,
    };
  },
});

prueba({
  id: 'SUC-005', grupo: 'sucursales', nombre: 'Lectura de S01 cae a MATRIZ antes de tener fila propia', metodo: 'EMPÍRICO',
  objetivo: 'obtenerExistenciaSucursal_(codigo, "S01") debe leer MATRIZ.Existencia mientras no exista una migración real hacia EXISTENCIAS_SUCURSAL',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const existencia = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S01');
    return {
      datos: 'COD-001 en MATRIZ=100, sin fila en EXISTENCIAS_SUCURSAL',
      esperado: '100 (leído de MATRIZ)',
      obtenido: `${existencia}`,
      pasa: existencia === 100,
    };
  },
});

prueba({
  id: 'SUC-006', grupo: 'sucursales', nombre: 'Simulación de 6 sucursales (Fase 10 del diseño, ahora con código real)', metodo: 'EMPÍRICO',
  objetivo: 'Producto X en S01..S06 con las cantidades del pedido: S03 (0) no puede tomar 20 unidades, y S06 (200) permanece aislada e intacta',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('actualizarExistenciaMatriz_', 'COD-001', 100); // S01 = MATRIZ, la única fuente hoy
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 50, 'S02');
    // S03 se queda en 0 (no se escribe nada = 0 por default)
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 75, 'S04');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20, 'S05');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 200, 'S06');

    const s01 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S01');
    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const s03 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S03');
    const s04 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S04');
    const s05 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S05');
    const s06Antes = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S06');

    let s03Bloqueada = false;
    try { entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', -20, 'S03'); }
    catch (e) { s03Bloqueada = true; }

    const s06Despues = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S06');
    const total = s01 + s02 + s03 + s04 + s05 + s06Antes;

    return {
      datos: `S01=${s01} S02=${s02} S03=${s03} S04=${s04} S05=${s05} S06=${s06Antes} (total=${total})`,
      esperado: 'total=445; S03 solicita 20 y se bloquea (existencia insuficiente); S06 sigue en 200 sin ninguna acción especial',
      obtenido: `total=${total}, s03Bloqueada=${s03Bloqueada}, S06 antes=${s06Antes} después=${s06Despues}`,
      pasa: total === 445 && s03Bloqueada === true && s06Antes === 200 && s06Despues === 200,
    };
  },
});

prueba({
  id: 'SUC-007', grupo: 'sucursales', nombre: 'actualizarExistenciaMatriz_ (valor absoluto) también respeta la sucursal', metodo: 'EMPÍRICO',
  objetivo: 'La variante de "fijar valor absoluto" debe desviarse a EXISTENCIAS_SUCURSAL igual que la de delta cuando recibe una sucursal real',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    entorno.invocar('actualizarExistenciaMatriz_', 'COD-002', 77, 'S04');
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10];
    const filaSucursal = entorno.leerHoja('EXISTENCIAS_SUCURSAL')[1];
    return {
      datos: 'COD-002 MATRIZ=5 (AZUCAR), se fija S04=77',
      esperado: 'MATRIZ sigue en 5, EXISTENCIAS_SUCURSAL tiene (COD-002, S04, 77)',
      obtenido: `MATRIZ=${existenciaMatriz}, filaSucursal=${JSON.stringify(filaSucursal)}`,
      pasa: existenciaMatriz === 5 && filaSucursal[1] === 'S04' && filaSucursal[2] === 77,
    };
  },
});

/*
 * FASE 11 — modelo de permisos multi-sucursal (autorizado en esta
 * ronda). Columna G ("Sucursal") de USUARIOS + obtenerAccesoSucursalApp,
 * mismo shape y criterio que obtenerAccesoRequisicionesApp.
 */

prueba({
  id: 'SUC-008', grupo: 'sucursales', nombre: 'Un usuario de sucursal ve solo su propia sucursal', metodo: 'EMPÍRICO',
  objetivo: 'obtenerAccesoSucursalApp debe devolver la sucursal capturada en USUARIOS y esTodasLasSucursales=false para un OPERADOR normal',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');
    const acceso = entorno.invocar('obtenerAccesoSucursalApp', token);
    return {
      datos: 'USUARIOS.sucursal2@tagers.com tiene Sucursal=S02',
      esperado: 'sucursal=S02, esTodasLasSucursales=false',
      obtenido: `sucursal=${acceso.sucursal}, esTodasLasSucursales=${acceso.esTodasLasSucursales}`,
      pasa: acceso.sucursal === 'S02' && acceso.esTodasLasSucursales === false,
    };
  },
});

prueba({
  id: 'SUC-009', grupo: 'sucursales', nombre: 'ADMIN ve todas las sucursales sin importar su propia Sucursal', metodo: 'EMPÍRICO',
  objetivo: 'obtenerAccesoSucursalApp debe dar esTodasLasSucursales=true para rol ADMIN, igual que ya hace obtenerAccesoRequisicionesApp con Área',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const acceso = entorno.invocar('obtenerAccesoSucursalApp', token);
    return {
      datos: 'rol=ADMIN, sin Sucursal capturada en USUARIOS',
      esperado: 'esTodasLasSucursales=true (cae a S01 por default, pero el rol ya le da acceso a todas)',
      obtenido: `sucursal=${acceso.sucursal}, esTodasLasSucursales=${acceso.esTodasLasSucursales}`,
      pasa: acceso.esTodasLasSucursales === true,
    };
  },
});

prueba({
  id: 'SUC-010', grupo: 'sucursales', nombre: 'Usuario corporativo (Sucursal=TODAS) sin ser ADMIN también ve todas', metodo: 'EMPÍRICO',
  objetivo: 'Un usuario con Sucursal="TODAS" capturada a mano debe tener esTodasLasSucursales=true aunque su rol no sea ADMIN',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'corporativo@tagers.com', 'Corporativo', 'SUPERVISOR');
    const acceso = entorno.invocar('obtenerAccesoSucursalApp', token);
    return {
      datos: 'rol=SUPERVISOR, USUARIOS.Sucursal=TODAS',
      esperado: 'esTodasLasSucursales=true',
      obtenido: `sucursal=${acceso.sucursal}, esTodasLasSucursales=${acceso.esTodasLasSucursales}`,
      pasa: acceso.esTodasLasSucursales === true,
    };
  },
});

prueba({
  id: 'SUC-011', grupo: 'sucursales', nombre: 'Usuario sin Sucursal migrada sigue viendo S01 (sin perder acceso)', metodo: 'EMPÍRICO',
  objetivo: 'Un usuario ya existente, sin la columna Sucursal capturada, debe resolver a S01 — la migración no le quita nada',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'operador@tagers.com', 'Operador Prueba', 'OPERADOR');
    const acceso = entorno.invocar('obtenerAccesoSucursalApp', token);
    return {
      datos: 'USUARIOS.operador@tagers.com sin Sucursal capturada',
      esperado: 'sucursal=S01 (default), esTodasLasSucursales=false',
      obtenido: `sucursal=${acceso.sucursal}, esTodasLasSucursales=${acceso.esTodasLasSucursales}`,
      pasa: acceso.sucursal === 'S01' && acceso.esTodasLasSucursales === false,
    };
  },
});

/*
 * FASE 12 — transferencias entre sucursales (autorizado en esta
 * ronda). Ejemplo exacto del diseño: S02=100 KG, S05=10 KG,
 * transferencia de 30 KG -> S02=70 KG, S05=40 KG.
 */

prueba({
  id: 'SUC-012', grupo: 'sucursales', nombre: 'Transferencia S02→S05 da el resultado exacto del diseño', metodo: 'EMPÍRICO',
  objetivo: 'transferirEntreSucursalesApp: S02=100, S05=10, transferir 30 -> S02=70, S05=40',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 100, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S05');

    const r = entorno.invocar('transferirEntreSucursalesApp', 'COD-001', 'S02', 'S05', 30, tokenAdmin);

    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const s05 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S05');

    return {
      datos: 'S02=100 KG, S05=10 KG, transferencia de 30 KG',
      esperado: 'S02=70 KG, S05=40 KG',
      obtenido: `S02=${s02}, S05=${s05}, folio=${r.folio}`,
      pasa: s02 === 70 && s05 === 40 && /^TR-/.test(r.folio),
    };
  },
});

prueba({
  id: 'SUC-013', grupo: 'sucursales', nombre: 'La transferencia registra Kardex en AMBAS sucursales', metodo: 'EMPÍRICO',
  objetivo: 'transferirEntreSucursalesApp debe generar 2 filas de Kardex (salida en origen, entrada en destino) con el mismo folio',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 100, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S05');

    const r = entorno.invocar('transferirEntreSucursalesApp', 'COD-001', 'S02', 'S05', 30, tokenAdmin);
    const kardex = entorno.leerHoja('KARDEX').slice(1).filter(f => f[3] === r.folio);

    const salida = kardex.find(f => f[2] === 'TRANSFERENCIA-SALIDA');
    const entrada = kardex.find(f => f[2] === 'TRANSFERENCIA-ENTRADA');

    return {
      datos: `folio=${r.folio}`,
      esperado: '2 filas de Kardex con ese folio: 1 TRANSFERENCIA-SALIDA (Salida=30, 100→70) y 1 TRANSFERENCIA-ENTRADA (Entrada=30, 10→40)',
      obtenido: `filas=${kardex.length}, salida=${salida ? `${salida[7]}→${salida[9]} (mov=${salida[7]===''?'':salida[6]})` : 'NO'}, entrada=${entrada ? `${entrada[8]}→${entrada[9]}` : 'NO'}`,
      pasa: kardex.length === 2 && !!salida && !!entrada && salida[7] === 30 && salida[8] === 100 && salida[9] === 70 && entrada[6] === 30 && entrada[8] === 10 && entrada[9] === 40,
    };
  },
});

prueba({
  id: 'SUC-014', grupo: 'sucursales', nombre: 'Transferencia bloqueada si el origen no tiene suficiente', metodo: 'EMPÍRICO',
  objetivo: 'transferirEntreSucursalesApp debe bloquear la transferencia si sucursalOrigen tiene menos de lo pedido, y no debe tocar ninguna de las dos sucursales',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 10, 'S02');
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 5, 'S05');

    let bloqueado = false, mensaje = '';
    try { entorno.invocar('transferirEntreSucursalesApp', 'COD-001', 'S02', 'S05', 30, tokenAdmin); }
    catch (e) { bloqueado = true; mensaje = e.message; }

    const s02 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S02');
    const s05 = entorno.invocar('obtenerExistenciaSucursal_', 'COD-001', 'S05');

    return {
      datos: 'S02=10, intenta transferir 30 a S05',
      esperado: 'bloqueado, S02 sigue en 10 y S05 sigue en 5 (nada se mueve)',
      obtenido: bloqueado ? `${mensaje} — S02=${s02}, S05=${s05}` : 'PERMITIDO',
      pasa: bloqueado && /insuficiente/i.test(mensaje) && s02 === 10 && s05 === 5,
    };
  },
});

prueba({
  id: 'SUC-015', grupo: 'sucursales', nombre: 'Transferencia bloqueada entre la misma sucursal', metodo: 'EMPÍRICO',
  objetivo: 'transferirEntreSucursalesApp debe rechazar origen y destino iguales',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    let bloqueado = false;
    try { entorno.invocar('transferirEntreSucursalesApp', 'COD-001', 'S02', 'S02', 10, tokenAdmin); }
    catch (e) { bloqueado = true; }
    return { datos: 'origen=destino=S02', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'SUC-016', grupo: 'sucursales', nombre: 'Solo Almacén/Admin puede transferir', metodo: 'EMPÍRICO',
  objetivo: 'transferirEntreSucursalesApp debe bloquear a un OPERADOR normal (mismo criterio que Compras/Recepción)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');
    let bloqueado = false;
    try { entorno.invocar('transferirEntreSucursalesApp', 'COD-001', 'S02', 'S05', 10, token); }
    catch (e) { bloqueado = true; }
    return { datos: 'rol=OPERADOR', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});
