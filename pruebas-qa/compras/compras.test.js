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

prueba({
  id: 'COM-010', grupo: 'compras', nombre: 'Editar una OC PENDIENTE reemplaza proveedor/observaciones/productos', metodo: 'EMPÍRICO',
  objetivo: 'editarOrdenCompraApp debe sobrescribir proveedor, observaciones y el detalle completo (agregar, quitar, cambiar cantidad/precio), sin cambiar el folio',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR VIEJO', 'obs original', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20 },
    ], token);
    // Quita COD-002, cambia cantidad/precio de COD-001, agrega COD-003 nuevo.
    const res = entorno.invocar('editarOrdenCompraApp', oc.folio, 'PROVEEDOR NUEVO', 'obs editada', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 25, udm: 'KG', precio: 16 },
      { codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 3, udm: 'KG', precio: 8 },
    ], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio);
    const filaOrden = entorno.leerHoja('ORDENES_COMPRA').find(f => f[0] === oc.folio);
    return {
      datos: `${oc.folio}: PROVEEDOR VIEJO con COD-001(10,$15)+COD-002(5,$20) → editada a PROVEEDOR NUEVO con COD-001(25,$16)+COD-003(3,$8)`,
      esperado: 'mismo folio, proveedor/observaciones actualizados, 2 líneas (COD-002 fuera, COD-003 nueva), total=25×16+3×8=424',
      obtenido: `folio=${res.folio}, proveedorHoja=${filaOrden[2]}, obsHoja=${filaOrden[6]}, items=${detalle.items.length}, codigos=${detalle.items.map(i=>i.codigo).join(',')}, cod001Cant=${detalle.items.find(i=>i.codigo==='COD-001').cantidad}, total=${res.total}`,
      pasa: res.folio === oc.folio && filaOrden[2] === 'PROVEEDOR NUEVO' && filaOrden[6] === 'obs editada'
        && detalle.items.length === 2 && !detalle.items.some(i => i.codigo === 'COD-002')
        && detalle.items.some(i => i.codigo === 'COD-003') && detalle.items.find(i=>i.codigo==='COD-001').cantidad === 25
        && res.total === 424,
    };
  },
});

prueba({
  id: 'COM-011', grupo: 'compras', nombre: 'No se puede editar una OC que ya no está PENDIENTE', metodo: 'EMPÍRICO',
  objetivo: 'editarOrdenCompraApp debe rechazar edición en PARCIAL, RECIBIDA y CANCELADA — solo PENDIENTE es editable',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });

    const ocParcial = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 }], token);
    entorno.invocar('registrarRecepcionOCApp', ocParcial.folio, [{ codigo: 'COD-001', cantidadRecibida: 4 }], token);
    let bloqueadoParcial = false;
    try { entorno.invocar('editarOrdenCompraApp', ocParcial.folio, 'OTRO', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 1, udm: 'KG', precio: 1 }], token); }
    catch (e) { bloqueadoParcial = true; }

    const ocCancelada = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [{ codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20 }], token);
    entorno.invocar('cancelarOrdenCompraApp', ocCancelada.folio, token);
    let bloqueadoCancelada = false;
    try { entorno.invocar('editarOrdenCompraApp', ocCancelada.folio, 'OTRO', '', [{ codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 1, udm: 'KG', precio: 1 }], token); }
    catch (e) { bloqueadoCancelada = true; }

    return {
      datos: 'una OC PARCIAL (recepción parcial) y otra CANCELADA',
      esperado: 'ambas bloqueadas para editar',
      obtenido: `bloqueadoParcial=${bloqueadoParcial}, bloqueadoCancelada=${bloqueadoCancelada}`,
      pasa: bloqueadoParcial && bloqueadoCancelada,
    };
  },
});

prueba({
  id: 'COM-012', grupo: 'compras', nombre: 'Editar no deja filas huérfanas de otras OCs en DETALLE_OC', metodo: 'EMPÍRICO',
  objetivo: 'editarOrdenCompraApp debe borrar y reescribir solo las filas de DETALLE_OC de la OC editada, sin tocar las de otras órdenes',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const ocOtra = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR OTRO', '', [{ codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20 }], token);
    const ocEditar = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 }], token);
    entorno.invocar('editarOrdenCompraApp', ocEditar.folio, 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 7, udm: 'KG', precio: 15 },
      { codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 2, udm: 'KG', precio: 8 },
    ], token);
    const filasDetalleEditada = entorno.leerHoja('DETALLE_OC').filter(f => f[0] === ocEditar.folio);
    const detalleOtra = entorno.invocar('obtenerDetalleOCApp', ocOtra.folio);
    return {
      datos: `${ocOtra.folio} sin tocar; ${ocEditar.folio} editada de 1 línea a 2`,
      esperado: `DETALLE_OC de ${ocEditar.folio} tiene exactamente 2 filas (no 3, no filas viejas); ${ocOtra.folio} conserva su única línea intacta`,
      obtenido: `filasEditada=${filasDetalleEditada.length}, itemsOtra=${detalleOtra.items.length}, codigoOtra=${detalleOtra.items[0] && detalleOtra.items[0].codigo}`,
      pasa: filasDetalleEditada.length === 2 && detalleOtra.items.length === 1 && detalleOtra.items[0].codigo === 'COD-002',
    };
  },
});

prueba({
  id: 'COM-013', grupo: 'compras', nombre: 'Editar puede agregarle Presentación a una línea que no la tenía', metodo: 'EMPÍRICO',
  objetivo: 'editarOrdenCompraApp debe guardar presentacion/piezasOrdenadas cuando se editan (bug real reportado: la UI de edición no tenía campo para Presentación, así que quedaba en "—" aunque el usuario la capturara)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // Se crea SIN presentación (como el caso real: "CEBOLLA EN POLVO" cantidad=5, sin paquete).
    const oc = entorno.invocar('generarOrdenCompraApp', 'SAMS', '', [
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20 },
    ], token);
    // Se edita para decir "son bolsas de 1kg" — el frontend deriva piezasOrdenadas = cantidad/presentacion = 5.
    entorno.invocar('editarOrdenCompraApp', oc.folio, 'SAMS', '', [
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20, presentacion: 1, piezasOrdenadas: 5 },
    ], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio);
    const item = detalle.items[0];
    return {
      datos: 'línea creada sin presentación, editada para agregarle presentación=1kg (5 piezas)',
      esperado: 'presentacion=1, piezasOrdenadas=5 quedan guardados (antes del fix se perdían, la UI no tenía cómo capturarlos)',
      obtenido: `presentacion=${item.presentacion}, piezasOrdenadas=${item.piezasOrdenadas}`,
      pasa: item.presentacion === 1 && item.piezasOrdenadas === 5,
    };
  },
});
