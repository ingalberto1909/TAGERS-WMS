'use strict';

/*
 * Re-validación de Compras: selección de producto, distintos proveedores
 * en OCs separadas, recepción parcial y total, tope a lo pedido,
 * cancelación y su bloqueo tras recibida, cambio de precio en recepción.
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
  id: 'COM-001', grupo: 'compras', nombre: 'OC con varios productos de un mismo proveedor', metodo: 'EMPÍRICO',
  objetivo: 'generarOrdenCompraApp debe crear un folio único con todas las líneas del pedido, sin perder ninguna al agregar productos después de otros',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // Simula "seleccionar un producto, luego otro, luego un tercero" — llegan juntos al enviar, como hace el frontend.
    const r = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 20, udm: 'KG', precio: 22 },
      { codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 5, udm: 'KG', precio: 8 },
    ], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', r.folio);
    return {
      datos: '3 productos agregados en secuencia a la misma OC',
      esperado: '3 líneas en el detalle, ninguna perdida',
      obtenido: `productos=${detalle.items.length}, códigos=${detalle.items.map(i => i.codigo).join(',')}`,
      pasa: detalle.items.length === 3 && ['COD-001', 'COD-002', 'COD-003'].every(c => detalle.items.some(i => i.codigo === c)),
    };
  },
});

prueba({
  id: 'COM-002', grupo: 'compras', nombre: 'Dos OCs a proveedores distintos no se mezclan', metodo: 'EMPÍRICO',
  objetivo: 'Cada OC guarda su propio proveedor y su propio detalle, sin cruzarse entre folios',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc1 = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR A', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);
    const oc2 = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR B', '', [
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20 },
    ], token);
    const detalle1 = entorno.invocar('obtenerDetalleOCApp', oc1.folio);
    const detalle2 = entorno.invocar('obtenerDetalleOCApp', oc2.folio);
    return {
      datos: `OC1=${oc1.folio}(PROVEEDOR A), OC2=${oc2.folio}(PROVEEDOR B)`,
      esperado: 'folios distintos, cada OC conserva su proveedor y solo su propio producto',
      obtenido: `folio1≠folio2=${oc1.folio !== oc2.folio}, prov1=${detalle1.proveedor}, prov2=${detalle2.proveedor}, items1=${detalle1.items.length}, items2=${detalle2.items.length}`,
      pasa: oc1.folio !== oc2.folio && detalle1.proveedor === 'PROVEEDOR A' && detalle2.proveedor === 'PROVEEDOR B'
        && detalle1.items.length === 1 && detalle2.items.length === 1,
    };
  },
});

prueba({
  id: 'COM-003', grupo: 'compras', nombre: 'Recepción parcial deja la OC en estado PARCIAL', metodo: 'EMPÍRICO',
  objetivo: 'registrarRecepcionOCApp debe marcar PARCIAL cuando se recibe menos de lo pedido en al menos un producto',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 20, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 12 }], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio);
    return {
      datos: 'pedido=20, recibido=12',
      esperado: 'estado=PARCIAL, recibido=12',
      obtenido: `estado=${detalle.estado}, recibido=${detalle.items[0].recibido}`,
      pasa: detalle.estado === 'PARCIAL' && detalle.items[0].recibido === 12,
    };
  },
});

prueba({
  id: 'COM-004', grupo: 'compras', nombre: 'Completar la recepción parcial cierra la OC como RECIBIDA', metodo: 'EMPÍRICO',
  objetivo: 'Una segunda recepción que complete lo pedido debe pasar el estado de PARCIAL a RECIBIDA y sumar la existencia de ambos movimientos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 20, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 12 }], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 8 }], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio);
    const existencia = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    return {
      datos: 'pedido=20, recibido en dos partes: 12 + 8, existencia inicial=100',
      esperado: 'estado=RECIBIDA, recibido=20, existencia=120',
      obtenido: `estado=${detalle.estado}, recibido=${detalle.items[0].recibido}, existencia=${existencia}`,
      pasa: detalle.estado === 'RECIBIDA' && detalle.items[0].recibido === 20 && existencia === 120,
    };
  },
});

prueba({
  id: 'COM-005', grupo: 'compras', nombre: 'No se puede recibir de más', metodo: 'EMPÍRICO',
  objetivo: 'registrarRecepcionOCApp topa la cantidad aplicada a lo que falta por recibir (bug de sobre-recepción)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 30 }], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio);
    return {
      datos: 'pedido=10, intenta recibir=30',
      esperado: 'recibido=10 (topado), estado=RECIBIDA',
      obtenido: `recibido=${detalle.items[0].recibido}, estado=${detalle.estado}`,
      pasa: detalle.items[0].recibido === 10 && detalle.estado === 'RECIBIDA',
    };
  },
});

prueba({
  id: 'COM-006', grupo: 'compras', nombre: 'No se puede recibir una OC ya cancelada', metodo: 'EMPÍRICO',
  objetivo: 'registrarRecepcionOCApp debe rechazar recepciones sobre una OC CANCELADA',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('cancelarOrdenCompraApp', oc.folio, token);
    let bloqueado = false;
    try { entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 5 }], token); }
    catch (e) { bloqueado = true; }
    return { datos: 'OC cancelada, intenta recibir', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'COM-007', grupo: 'compras', nombre: 'No se puede cancelar una OC ya recibida', metodo: 'EMPÍRICO',
  objetivo: 'cancelarOrdenCompraApp debe rechazar cancelar una OC en estado RECIBIDA',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 10 }], token);
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('cancelarOrdenCompraApp', oc.folio, token); } catch (e) { bloqueado = true; mensaje = e.message; }
    return { datos: 'OC ya RECIBIDA, intenta cancelar', esperado: 'bloqueado', obtenido: bloqueado ? mensaje : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'COM-008', grupo: 'compras', nombre: 'Cambio de precio en recepción queda en HISTORIAL_PRECIOS', metodo: 'EMPÍRICO',
  objetivo: 'Si el precio de factura llega distinto al de MATRIZ, se actualiza el costo y se registra el histórico',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 10, precioFactura: 18 }], token);
    const costoMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[17];
    const historial = entorno.leerHoja('HISTORIAL_PRECIOS').length - 1;
    return {
      datos: 'MATRIZ tenía costo=10, llega factura con precio=18',
      esperado: 'MATRIZ.CostoUnitario=18, 1 fila en HISTORIAL_PRECIOS',
      obtenido: `costoMatriz=${costoMatriz}, filasHistorial=${historial}`,
      pasa: costoMatriz === 18 && historial === 1,
    };
  },
});

prueba({
  id: 'COM-009', grupo: 'compras', nombre: 'Bloqueo de rol en Compras (CONSULTA)', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoAlmacenApp_ debe bloquear a CONSULTA de generar una OC',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'consulta@tagers.com', nombre: 'C', rol: 'CONSULTA' });
    let bloqueado = false;
    try { entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [{ codigo: 'COD-001', producto: 'HARINA', cantidad: 1, udm: 'KG', precio: 1 }], token); }
    catch (e) { bloqueado = true; }
    return { datos: 'rol=CONSULTA', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});
