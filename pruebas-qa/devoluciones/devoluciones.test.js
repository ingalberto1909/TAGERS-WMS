'use strict';

/*
 * INV-04 (auditoría comparativa vs. MarketMan): antes no existía NINGÚN
 * flujo de devolución (cero resultados de "devolución" en todo el
 * repositorio). Estas pruebas cubren los dos casos reales identificados:
 * sucursal→CEDIS (apoyado en transferirEntreSucursalesApp, ya probado) y
 * CEDIS→proveedor (apoyado en registrarSalidaInterna_, ya probado) — no
 * se re-verifica la lógica de esas dos funciones centrales aquí, solo
 * que Devoluciones.gs las use correctamente y deje su propia bitácora.
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
  id: 'DEV-001', grupo: 'devoluciones', nombre: 'Devolución sucursal→CEDIS mueve existencia y queda en la bitácora DEVOLUCIONES', metodo: 'EMPÍRICO',
  objetivo: 'registrarDevolucionSucursalApp debe descontar de la sucursal de origen, sumar a CEDIS (MATRIZ), y escribir una fila propia en DEVOLUCIONES con el motivo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });

    // Seed: S02 ya tiene 20 unidades de COD-001 (ej. de una entrega anterior).
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20, 'S02');

    const resultado = entorno.invocar('registrarDevolucionSucursalApp', 'COD-001', 8, 'S02', 'Sobrante de la entrega pasada', 'Se contó de más', token);

    const existenciaS02 = entorno.leerHoja('EXISTENCIAS_SUCURSAL').find(f => f[0] === 'COD-001' && f[1] === 'S02')[2];
    const existenciaCedis = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const devoluciones = entorno.leerHoja('DEVOLUCIONES');
    const filaDevolucion = devoluciones[devoluciones.length - 1];

    return {
      datos: 'S02 tenía 20 de COD-001 (CEDIS/MATRIZ en 100), se devuelven 8 a CEDIS',
      esperado: 'S02 queda en 12, CEDIS en 108, 1 fila en DEVOLUCIONES tipo SUCURSAL_A_CEDIS con el motivo',
      obtenido: `S02=${existenciaS02}, CEDIS=${existenciaCedis}, tipo=${filaDevolucion[4]}, motivo=${filaDevolucion[7]}, folioTransferencia=${resultado.folio}`,
      pasa: existenciaS02 === 12 && existenciaCedis === 108 && filaDevolucion[4] === 'SUCURSAL_A_CEDIS' && filaDevolucion[7] === 'Sobrante de la entrega pasada' && !!resultado.folio,
    };
  },
});

prueba({
  id: 'DEV-002', grupo: 'devoluciones', nombre: 'Devolución sucursal→CEDIS exige motivo', metodo: 'EMPÍRICO',
  objetivo: 'registrarDevolucionSucursalApp debe rechazar la devolución si no se captura un motivo, sin mover existencia',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20, 'S02');

    let bloqueado = false;
    try { entorno.invocar('registrarDevolucionSucursalApp', 'COD-001', 5, 'S02', '', '', token); }
    catch (e) { bloqueado = true; }

    const existenciaS02 = entorno.leerHoja('EXISTENCIAS_SUCURSAL').find(f => f[0] === 'COD-001' && f[1] === 'S02')[2];

    return {
      datos: 'motivo vacío',
      esperado: 'bloqueado, S02 sigue en 20',
      obtenido: `bloqueado=${bloqueado}, S02=${existenciaS02}`,
      pasa: bloqueado && existenciaS02 === 20,
    };
  },
});

prueba({
  id: 'DEV-003', grupo: 'devoluciones', nombre: 'No se puede devolver más de lo que la sucursal realmente tiene', metodo: 'EMPÍRICO',
  objetivo: 'registrarDevolucionSucursalApp hereda la validación de existencia suficiente de transferirEntreSucursalesApp — debe bloquear y no dejar ninguna fila en DEVOLUCIONES',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 5, 'S02');

    let bloqueado = false;
    try { entorno.invocar('registrarDevolucionSucursalApp', 'COD-001', 50, 'S02', 'Motivo válido', '', token); }
    catch (e) { bloqueado = true; }

    const hojaDevoluciones = entorno.hojas.DEVOLUCIONES;
    const existenciaS02 = entorno.leerHoja('EXISTENCIAS_SUCURSAL').find(f => f[0] === 'COD-001' && f[1] === 'S02')[2];

    return {
      datos: 'S02 tiene 5 de COD-001, se intentan devolver 50',
      esperado: 'bloqueado, S02 sigue en 5, la hoja DEVOLUCIONES no llega a crearse (nada se escribió)',
      obtenido: `bloqueado=${bloqueado}, S02=${existenciaS02}, hojaDevolucionesCreada=${!!hojaDevoluciones}`,
      pasa: bloqueado && existenciaS02 === 5 && !hojaDevoluciones,
    };
  },
});

prueba({
  id: 'DEV-004', grupo: 'devoluciones', nombre: 'Devolución CEDIS→Proveedor descuenta existencia sin tocar la OC original', metodo: 'EMPÍRICO',
  objetivo: 'registrarDevolucionProveedorApp debe generar una SALIDA real (área "DEVOLUCIÓN A PROVEEDOR"), descontar MATRIZ, y dejar el folio de la OC solo como referencia en DEVOLUCIONES — sin tocar el estado de esa OC',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });

    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 30, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 30 }], token);
    const existenciaTrasRecibir = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10]; // 100 + 30 = 130

    const resultado = entorno.invocar('registrarDevolucionProveedorApp', 'COD-001', 'HARINA DE TRIGO', 10, 'KG', 'Producto en mal estado desde el proveedor', oc.folio, '', token);

    const existenciaFinal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const salida = entorno.leerHoja('SALIDA');
    const filaSalida = salida[salida.length - 1];
    const detalleOC = entorno.invocar('obtenerDetalleOCApp', oc.folio, token);
    const devoluciones = entorno.leerHoja('DEVOLUCIONES');
    const filaDevolucion = devoluciones[devoluciones.length - 1];

    return {
      datos: `OC ${oc.folio} recibida completa (existencia sube a ${existenciaTrasRecibir}), se devuelven 10 al proveedor referenciando esa OC`,
      esperado: 'existencia baja 10 más, SALIDA con área="DEVOLUCIÓN A PROVEEDOR", la OC sigue RECIBIDA (sin cambio), DEVOLUCIONES referencia el folio de la OC',
      obtenido: `existenciaFinal=${existenciaFinal}, areaSalida="${filaSalida[7]}", estadoOC=${detalleOC.estado}, folioOCenDevolucion=${filaDevolucion[8]}`,
      pasa: existenciaFinal === existenciaTrasRecibir - 10 && filaSalida[7] === 'DEVOLUCIÓN A PROVEEDOR' && detalleOC.estado === 'RECIBIDA' && filaDevolucion[8] === oc.folio,
    };
  },
});

prueba({
  id: 'DEV-005', grupo: 'devoluciones', nombre: 'obtenerDevolucionesApp lista ambos tipos y filtra por fecha', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDevolucionesApp debe traer devoluciones de sucursal y de proveedor juntas, excluyendo las que caen fuera del rango pedido',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20, 'S02');

    entorno.invocar('registrarDevolucionSucursalApp', 'COD-001', 5, 'S02', 'Sobrante', '', token);
    entorno.invocar('registrarDevolucionProveedorApp', 'COD-003', 'SAL DE MESA', 3, 'KG', 'Empaque dañado', '', '', token);

    // Fuerza la fecha de la primera devolución a hace 60 días, para probar el filtro.
    const devoluciones = entorno.leerHoja('DEVOLUCIONES');
    const hace60Dias = new Date();
    hace60Dias.setDate(hace60Dias.getDate() - 60);
    devoluciones[1][0] = hace60Dias;

    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);
    const lista = entorno.invocar('obtenerDevolucionesApp', hace7Dias.toISOString(), null, token);

    return {
      datos: '1 devolución de sucursal (forzada a hace 60 días) + 1 devolución a proveedor (hoy), se pide desde hace 7 días',
      esperado: 'solo aparece la de proveedor (COD-003), la de sucursal queda fuera del rango',
      obtenido: `cantidad=${lista.length}, tipos=${lista.map(d => d.tipo).join(',')}`,
      pasa: lista.length === 1 && lista[0].tipo === 'CEDIS_A_PROVEEDOR',
    };
  },
});

prueba({
  id: 'DEV-006', grupo: 'devoluciones', nombre: 'Un operador de área (Cocina) no puede registrar ninguna devolución', metodo: 'EMPÍRICO',
  objetivo: 'Ambas funciones exigen acceso de Almacén (heredado de transferirEntreSucursalesApp y de requerirAccesoAlmacenApp_ respectivamente) — un OPERADOR de área queda bloqueado en las dos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    entorno.invocar('ajustarExistenciaMatrizPorDeltaValidado_', 'COD-001', 20, 'S02');

    let bloqueadoSucursal = false, bloqueadoProveedor = false;
    try { entorno.invocar('registrarDevolucionSucursalApp', 'COD-001', 5, 'S02', 'Motivo', '', token); }
    catch (e) { bloqueadoSucursal = true; }
    try { entorno.invocar('registrarDevolucionProveedorApp', 'COD-001', 'HARINA DE TRIGO', 5, 'KG', 'Motivo', '', '', token); }
    catch (e) { bloqueadoProveedor = true; }

    return {
      datos: 'usuario Cocina (OPERADOR de área, sin acceso de Almacén)',
      esperado: 'ambas funciones bloqueadas',
      obtenido: `sucursal=${bloqueadoSucursal ? 'bloqueado' : 'permitido'}, proveedor=${bloqueadoProveedor ? 'bloqueado' : 'permitido'}`,
      pasa: bloqueadoSucursal && bloqueadoProveedor,
    };
  },
});
