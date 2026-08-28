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
    const detalle = entorno.invocar('obtenerDetalleOCApp', r.folio, token);
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
    const detalle1 = entorno.invocar('obtenerDetalleOCApp', oc1.folio, token);
    const detalle2 = entorno.invocar('obtenerDetalleOCApp', oc2.folio, token);
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
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 12 }], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio, token);
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
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 12 }], token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 8 }], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio, token);
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
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 30 }], token);
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio, token);
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
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
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
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
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
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio, token);
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
    entorno.invocar('aprobarOrdenCompraApp', ocParcial.folio, token);
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
    const detalleOtra = entorno.invocar('obtenerDetalleOCApp', ocOtra.folio, token);
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
    const detalle = entorno.invocar('obtenerDetalleOCApp', oc.folio, token);
    const item = detalle.items[0];
    return {
      datos: 'línea creada sin presentación, editada para agregarle presentación=1kg (5 piezas)',
      esperado: 'presentacion=1, piezasOrdenadas=5 quedan guardados (antes del fix se perdían, la UI no tenía cómo capturarlos)',
      obtenido: `presentacion=${item.presentacion}, piezasOrdenadas=${item.piezasOrdenadas}`,
      pasa: item.presentacion === 1 && item.piezasOrdenadas === 5,
    };
  },
});

prueba({
  id: 'COM-014', grupo: 'compras', nombre: 'Generar una OC con Presentación la refleja en MATRIZ columna T', metodo: 'EMPÍRICO',
  objetivo: 'generarOrdenCompraApp debe sincronizar la Presentación capturada en la línea hacia MATRIZ (columna T) del producto, para que el catálogo quede al día',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const presentacionAntes = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[19];
    entorno.invocar('generarOrdenCompraApp', 'SAMS', '', [
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 5, udm: 'KG', precio: 20, presentacion: 2, piezasOrdenadas: 2.5 },
    ], token);
    const presentacionDespues = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[19];
    return {
      datos: 'COD-002 sin presentación en MATRIZ; se genera una OC con presentación=2kg en la línea',
      esperado: 'MATRIZ.Presentación(COD-002) pasa de vacío a 2',
      obtenido: `antes="${presentacionAntes}", despues=${presentacionDespues}`,
      pasa: presentacionDespues === 2,
    };
  },
});

prueba({
  id: 'COM-015', grupo: 'compras', nombre: 'Editar Presentación también actualiza MATRIZ, sin borrarla si la línea no la trae', metodo: 'EMPÍRICO',
  objetivo: 'editarOrdenCompraApp debe sincronizar Presentación hacia MATRIZ igual que al generar, pero NUNCA borrar la de MATRIZ cuando una línea se edita sin capturarla (0/vacío no debe pisar un valor ya guardado)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });

    // COD-001 (HARINA DE TRIGO) ya trae una Presentación capturada de antes (25kg) — simula
    // el caso real: el catálogo ya tiene el dato, y una edición sin capturarlo no debe borrarlo.
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[19] = 25;
    const presentacionOriginal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[19];

    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);

    // Edita cambiando la cantidad, SIN capturar presentación en esta línea.
    entorno.invocar('editarOrdenCompraApp', oc.folio, 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 12, udm: 'KG', precio: 15 },
    ], token);
    const presentacionTrasEdicionSinCapturar = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[19];

    // Ahora sí la cambia explícitamente a 10kg.
    entorno.invocar('editarOrdenCompraApp', oc.folio, 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 12, udm: 'KG', precio: 15, presentacion: 10, piezasOrdenadas: 1.2 },
    ], token);
    const presentacionTrasEdicionCapturada = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[19];

    return {
      datos: `MATRIZ.Presentación(COD-001) original=${presentacionOriginal}; se edita sin tocarla, luego se edita a 10`,
      esperado: `sin capturarla en la línea queda igual (${presentacionOriginal}, no se borra); al capturarla explícitamente pasa a 10`,
      obtenido: `sinCapturar=${presentacionTrasEdicionSinCapturar}, capturada=${presentacionTrasEdicionCapturada}`,
      pasa: presentacionTrasEdicionSinCapturar === presentacionOriginal && presentacionTrasEdicionCapturada === 10,
    };
  },
});

prueba({
  id: 'COM-016', grupo: 'compras', nombre: 'Sugerencias de requisición: combina fórmula Min/Máx con el consumo histórico real', metodo: 'EMPÍRICO',
  objetivo: 'obtenerSugerenciasRequisicionAutomaticaApp debe traer los productos bajo mínimo con ambas sugerencias, y quedarse con la MAYOR de las dos como cantidadSugerida',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });

    // Se compraron 120 en el año, pero ya se consumieron — hoy vuelve a estar
    // bajo mínimo (existencia=5, mínimo=10, máximo=100). El historial de LO
    // COMPRADO no depende de la existencia actual, son cosas distintas.
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 120, udm: 'KG', precio: 22 },
    ], token);
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-002', cantidadRecibida: 120 }], token);
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10] = 5; // simula que ya se consumió lo recibido
    entorno.invocar('invalidarCacheHoja_', 'MATRIZ');

    const sugerencias = entorno.invocar('obtenerSugerenciasRequisicionAutomaticaApp', token);
    const linea = sugerencias.find(s => s.codigo === 'COD-002');

    // Fórmula: puntoMedio(10,100)=55, existencia=5 -> sugeridoPorFormula=50.
    // Historial: 120 recibidos en los últimos 12 meses -> promedioMensual=10.
    return {
      datos: 'COD-002: existencia=5, mínimo=10, máximo=100, se recibieron 120 en una sola compra reciente',
      esperado: 'sugeridoPorFormula=50 (fórmula Min/Máx), sugeridoPorHistorial=10 (120/12 meses), cantidadSugerida=50 (la mayor de las dos)',
      obtenido: linea ? `sugeridoPorFormula=${linea.sugeridoPorFormula}, sugeridoPorHistorial=${linea.sugeridoPorHistorial}, cantidadSugerida=${linea.cantidadSugerida}, tieneHistorial=${linea.tieneHistorial}` : 'NO ENCONTRADO',
      pasa: !!linea && linea.sugeridoPorFormula === 50 && linea.sugeridoPorHistorial === 10 && linea.cantidadSugerida === 50 && linea.tieneHistorial === true,
    };
  },
});

prueba({
  id: 'COM-017', grupo: 'compras', nombre: 'Sugerencias de requisición: sin historial de compras, se queda solo con la fórmula', metodo: 'EMPÍRICO',
  objetivo: 'Un producto bajo mínimo que nunca se ha comprado (sin líneas en DETALLE_OC) debe aparecer con tieneHistorial=false y cantidadSugerida=sugeridoPorFormula, sin tronar por falta de datos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    // COD-002 bajo mínimo por defecto, CERO compras registradas en esta prueba.
    const sugerencias = entorno.invocar('obtenerSugerenciasRequisicionAutomaticaApp', token);
    const linea = sugerencias.find(s => s.codigo === 'COD-002');

    return {
      datos: 'COD-002 bajo mínimo, sin ninguna OC recibida en el historial',
      esperado: 'tieneHistorial=false, sugeridoPorHistorial=0, cantidadSugerida=sugeridoPorFormula',
      obtenido: linea ? `tieneHistorial=${linea.tieneHistorial}, sugeridoPorHistorial=${linea.sugeridoPorHistorial}, cantidadSugerida=${linea.cantidadSugerida}, sugeridoPorFormula=${linea.sugeridoPorFormula}` : 'NO ENCONTRADO',
      pasa: !!linea && linea.tieneHistorial === false && linea.sugeridoPorHistorial === 0 && linea.cantidadSugerida === linea.sugeridoPorFormula,
    };
  },
});

prueba({
  id: 'COM-018', grupo: 'compras', nombre: 'Sugerencias de requisición: una compra de hace más de 12 meses no cuenta en el histórico', metodo: 'EMPÍRICO',
  objetivo: 'obtenerHistorialComprasPorCodigo_ debe ignorar recepciones cuya OC tiene fecha anterior a hace 12 meses — el consumo histórico es una ventana móvil, no "desde siempre"',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });

    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', cantidad: 240, udm: 'KG', precio: 22 },
    ], token);
    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-002', cantidadRecibida: 240 }], token);
    entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-002')[10] = 5; // simula que ya se consumió lo recibido — vuelve a estar bajo mínimo

    // Se "envejece" la OC a hace 13 meses, directo en la hoja (no hay parámetro de fecha en generarOrdenCompraApp).
    const filaOC = entorno.leerHoja('ORDENES_COMPRA').find(f => f[0] === oc.folio);
    const hace13Meses = new Date();
    hace13Meses.setMonth(hace13Meses.getMonth() - 13);
    filaOC[1] = hace13Meses;
    entorno.invocar('invalidarCacheHoja_', 'MATRIZ');

    const sugerencias = entorno.invocar('obtenerSugerenciasRequisicionAutomaticaApp', token);
    const linea = sugerencias.find(s => s.codigo === 'COD-002');

    return {
      datos: '240 unidades recibidas, pero la OC se fechó hace 13 meses (fuera de la ventana de 12 meses)',
      esperado: 'tieneHistorial=false — la compra existe pero está fuera de la ventana de 12 meses, no debe contarse',
      obtenido: linea ? `tieneHistorial=${linea.tieneHistorial}, totalUltimos12Meses=${linea.totalUltimos12Meses}` : 'NO ENCONTRADO',
      pasa: !!linea && linea.tieneHistorial === false && linea.totalUltimos12Meses === 0,
    };
  },
});

prueba({
  id: 'COM-019', grupo: 'compras', nombre: 'Sugerencias de requisición: solo lista productos bajo mínimo, ordenados por déficit', metodo: 'EMPÍRICO',
  objetivo: 'Productos con existencia por ENCIMA de su mínimo no deben aparecer en la lista; los que sí aparecen deben venir ordenados de mayor a menor déficit (más urgente primero)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const matriz = entorno.leerHoja('MATRIZ');
    // COD-001 HARINA: por defecto existencia=100/mínimo=10 (muy por encima) -> no debe aparecer.
    // COD-002 AZUCAR: existencia=5/mínimo=10 (déficit=5) -> sí aparece.
    // COD-003 SAL: se baja a existencia=1/mínimo=5 (déficit=4) -> sí aparece, pero con menos urgencia que COD-002... (déficit menor)
    matriz.find(f => f[4] === 'COD-003')[10] = 1;
    entorno.invocar('invalidarCacheHoja_', 'MATRIZ');

    const sugerencias = entorno.invocar('obtenerSugerenciasRequisicionAutomaticaApp', token);
    const codigos = sugerencias.map(s => s.codigo);

    return {
      datos: 'COD-001 muy por encima de su mínimo; COD-002 déficit=5; COD-003 déficit=4',
      esperado: 'COD-001 NO aparece; COD-002 y COD-003 sí, con COD-002 primero (mayor déficit)',
      obtenido: `códigos en orden=[${codigos.join(', ')}]`,
      pasa: !codigos.includes('COD-001') && codigos.indexOf('COD-002') === 0 && codigos.includes('COD-003'),
    };
  },
});

prueba({
  id: 'COM-020', grupo: 'compras', nombre: 'COM-02: OC con descuento/IVA/flete calcula el total con impuestos, sin alterar el subtotal', metodo: 'EMPÍRICO',
  objetivo: 'generarOrdenCompraApp debe aceptar un 5º parámetro opcional {descuento, ivaPorcentaje, flete} y calcular totalConImpuestos = (subtotal - descuento) * (1 + iva%) + flete, dejando "total" (el subtotal de siempre) sin tocar',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const r = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token, { descuento: 20, ivaPorcentaje: 16, flete: 50 });

    const detalle = entorno.invocar('obtenerDetalleOCApp', r.folio, token);
    const lista = entorno.invocar('obtenerOrdenesCompraApp', token);
    const filaLista = lista.find(o => o.oc === r.folio);

    // subtotal=150, -20 descuento=130, +16% IVA(130)=20.8 => 150.8, +50 flete => 200.8
    const esperado = 200.8;

    return {
      datos: 'subtotal=150 (10×15), descuento=20, IVA=16%, flete=50',
      esperado: `total (subtotal) sigue en 150; totalConImpuestos=${esperado} tanto en el detalle como en la lista`,
      obtenido: `total=${detalle.total}, ivaMonto=${detalle.ivaMonto}, totalConImpuestos(detalle)=${detalle.totalConImpuestos}, totalConImpuestos(lista)=${filaLista.totalConImpuestos}`,
      pasa: detalle.total === 150 && detalle.ivaMonto === 20.8 && detalle.totalConImpuestos === esperado && filaLista.totalConImpuestos === esperado,
    };
  },
});

prueba({
  id: 'COM-021', grupo: 'compras', nombre: 'COM-02: sin descuento/IVA/flete, totalConImpuestos cae de vuelta al total de siempre', metodo: 'EMPÍRICO',
  objetivo: 'Compatibilidad hacia atrás — una OC generada sin el 5º parámetro (como todas las anteriores a esta corrección) debe comportarse exactamente igual que antes: totalConImpuestos === total, descuento/iva/flete en 0',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const r = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);

    const detalle = entorno.invocar('obtenerDetalleOCApp', r.folio, token);

    return {
      datos: 'OC generada sin el parámetro extras (llamada tal cual la hacía el frontend antes de este cambio)',
      esperado: 'descuento=0, ivaPorcentaje=0, flete=0, totalConImpuestos=total=150',
      obtenido: `total=${detalle.total}, descuento=${detalle.descuento}, ivaPorcentaje=${detalle.ivaPorcentaje}, flete=${detalle.flete}, totalConImpuestos=${detalle.totalConImpuestos}`,
      pasa: detalle.total === 150 && detalle.descuento === 0 && detalle.ivaPorcentaje === 0 && detalle.flete === 0 && detalle.totalConImpuestos === 150,
    };
  },
});

prueba({
  id: 'COM-022', grupo: 'compras', nombre: 'COM-02: editarOrdenCompraApp actualiza el desglose de impuestos de una OC PENDIENTE', metodo: 'EMPÍRICO',
  objetivo: 'editarOrdenCompraApp debe aceptar el mismo 6º parámetro opcional y sobreescribir descuento/IVA/flete de la orden, igual que ya sobreescribe proveedor/observaciones/productos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const r = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token, { ivaPorcentaje: 16 });

    entorno.invocar('editarOrdenCompraApp', r.folio, 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token, { ivaPorcentaje: 16, flete: 30 });

    const detalle = entorno.invocar('obtenerDetalleOCApp', r.folio, token);

    return {
      datos: 'OC creada con solo IVA=16%, luego editada agregando flete=30',
      esperado: 'el detalle refleja la edición: flete=30, totalConImpuestos=150*1.16+30=204',
      obtenido: `flete=${detalle.flete}, totalConImpuestos=${detalle.totalConImpuestos}`,
      pasa: detalle.flete === 30 && detalle.totalConImpuestos === 204,
    };
  },
});

prueba({
  id: 'COM-023', grupo: 'compras', nombre: 'COM-01: una OC nace PENDIENTE_APROBACION y no se puede recibir hasta aprobarse', metodo: 'EMPÍRICO',
  objetivo: 'generarOrdenCompraApp debe crear la OC en PENDIENTE_APROBACION (no PENDIENTE) — registrarRecepcionOCApp debe rechazarla hasta que aprobarOrdenCompraApp la mueva a PENDIENTE',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);

    const estadoInicial = entorno.invocar('obtenerDetalleOCApp', oc.folio, token).estado;

    let bloqueadoRecepcion = false, mensaje = '';
    try { entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 10 }], token); }
    catch (e) { bloqueadoRecepcion = true; mensaje = e.message; }

    const resultadoAprobar = entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);
    const estadoTrasAprobar = entorno.invocar('obtenerDetalleOCApp', oc.folio, token).estado;

    entorno.invocar('registrarRecepcionOCApp', oc.folio, [{ codigo: 'COD-001', cantidadRecibida: 10 }], token);
    const estadoFinal = entorno.invocar('obtenerDetalleOCApp', oc.folio, token).estado;

    return {
      datos: 'OC recién generada, se intenta recibir antes de aprobar, luego se aprueba y se recibe',
      esperado: 'estadoInicial=PENDIENTE_APROBACION, recepción bloqueada antes de aprobar, tras aprobar queda PENDIENTE, tras recibir queda RECIBIDA',
      obtenido: `estadoInicial=${estadoInicial}, bloqueadoRecepcion=${bloqueadoRecepcion} ("${mensaje}"), estadoTrasAprobar=${estadoTrasAprobar} (${resultadoAprobar.estado}), estadoFinal=${estadoFinal}`,
      pasa: estadoInicial === 'PENDIENTE_APROBACION' && bloqueadoRecepcion && estadoTrasAprobar === 'PENDIENTE' && estadoFinal === 'RECIBIDA',
    };
  },
});

prueba({
  id: 'COM-024', grupo: 'compras', nombre: 'COM-01: solo ADMIN puede aprobar una OC — ni Almacén ni Supervisor pueden', metodo: 'EMPÍRICO',
  objetivo: 'aprobarOrdenCompraApp debe exigir rol ADMIN específicamente — a propósito distinto de requerirAccesoAlmacenApp_ (que ya permite generar/recibir a Supervisor), para separar quién genera de quién aprueba',
  ejecutar() {
    const { entorno, token: tokenAdmin } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], tokenAdmin);

    const tokenSupervisor = entorno.invocar('crearSesion_', 'supervisor@tagers.com', 'Supervisor', 'SUPERVISOR');

    let bloqueado = false;
    try { entorno.invocar('aprobarOrdenCompraApp', oc.folio, tokenSupervisor); }
    catch (e) { bloqueado = true; }

    const estado = entorno.invocar('obtenerDetalleOCApp', oc.folio, tokenAdmin).estado;

    return {
      datos: 'usuario SUPERVISOR (que sí puede generar/recibir OC) intenta aprobarla',
      esperado: 'bloqueado, la OC sigue PENDIENTE_APROBACION',
      obtenido: `bloqueado=${bloqueado}, estado=${estado}`,
      pasa: bloqueado && estado === 'PENDIENTE_APROBACION',
    };
  },
});

prueba({
  id: 'COM-025', grupo: 'compras', nombre: 'COM-01: no se puede aprobar dos veces ni una OC que no está pendiente de aprobación', metodo: 'EMPÍRICO',
  objetivo: 'aprobarOrdenCompraApp debe rechazar la aprobación si el estado actual no es PENDIENTE_APROBACION (ya aprobada, o cualquier otro estado)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    const oc = entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 10, udm: 'KG', precio: 15 },
    ], token);

    entorno.invocar('aprobarOrdenCompraApp', oc.folio, token);

    let bloqueadoSegunda = false;
    try { entorno.invocar('aprobarOrdenCompraApp', oc.folio, token); }
    catch (e) { bloqueadoSegunda = true; }

    return {
      datos: 'OC ya aprobada (PENDIENTE), se intenta aprobar de nuevo',
      esperado: 'bloqueado',
      obtenido: bloqueadoSegunda ? 'bloqueado' : 'PERMITIDO',
      pasa: bloqueadoSegunda,
    };
  },
});
