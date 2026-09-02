'use strict';

/*
 * Re-validación de Requisiciones: creación, permisos por área, consulta
 * filtrada, entrega y requisiciones de receta (con conversión UDM).
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, hojaMatrizEstandar, filaProducto } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'REQ-001', grupo: 'requisiciones', nombre: 'Crear requisición sin cantidades no crea folio', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionApp debe rechazar una requisición sin ninguna cantidad solicitada > 0',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    let bloqueado = false;
    try { entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 0 }], token); }
    catch (e) { bloqueado = true; }
    return { datos: 'solicitado=0', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: 'REQ-002', grupo: 'requisiciones', nombre: 'Usuario sin área asignada no puede requisitar', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionApp debe rechazar cuando USUARIOS no tiene Área capturada para ese correo',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    // El fixture estándar de admin@tagers.com sí tiene área "Almacén"; forzamos vacío para probar el guard.
    entorno.leerHoja('USUARIOS').find(f => f[0] === 'admin@tagers.com')[5] = '';
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    return { datos: 'USUARIOS.Área=""', esperado: 'bloqueado ("no tiene un Área asignada")', obtenido: bloqueado ? mensaje : 'permitido', pasa: bloqueado && /Área/i.test(mensaje) };
  },
});

prueba({
  id: 'REQ-003', grupo: 'requisiciones', nombre: 'Consulta filtrada por área para un OPERADOR', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRequisicionesApp solo debe devolver las requisiciones del área del token, no las de otras áreas',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenPanaderia = entorno.invocar('crearSesion_', 'panaderia@tagers.com', 'Panadería', 'OPERADOR');
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-002', producto: 'AZUCAR', unidad: 'KG', solicitado: 2 }], tokenPanaderia);

    const listaCocina = entorno.invocar('obtenerRequisicionesApp', tokenCocina);
    return {
      datos: '1 requisición de Cocina + 1 de Panadería existen',
      esperado: 'Cocina solo ve la suya (1 folio, área=Cocina)',
      obtenido: `total=${listaCocina.length}, áreas=${listaCocina.map(r => r.area).join(',')}`,
      pasa: listaCocina.length === 1 && listaCocina[0].area === 'Cocina',
    };
  },
});

prueba({
  id: 'REQ-004', grupo: 'requisiciones', nombre: 'ADMIN/Almacén ve todas las áreas', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRequisicionesApp debe devolver todas las requisiciones cuando el token es de Admin/Almacén',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenPanaderia = entorno.invocar('crearSesion_', 'panaderia@tagers.com', 'Panadería', 'OPERADOR');
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-002', producto: 'AZUCAR', unidad: 'KG', solicitado: 2 }], tokenPanaderia);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const listaAdmin = entorno.invocar('obtenerRequisicionesApp', tokenAdmin);
    return {
      datos: '1 requisición de Cocina + 1 de Panadería',
      esperado: 'Admin ve las 2',
      obtenido: `total=${listaAdmin.length}`,
      pasa: listaAdmin.length === 2,
    };
  },
});

prueba({
  id: 'REQ-005', grupo: 'requisiciones', nombre: 'Solo Almacén ve requisiciones pendientes globales', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRequisicionesPendientesApp debe bloquear a un OPERADOR de área que no sea Admin/Almacén',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    let bloqueado = false;
    try { entorno.invocar('obtenerRequisicionesPendientesApp', token); } catch (e) { bloqueado = true; }
    return { datos: 'rol=OPERADOR, área=Cocina', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: 'REQ-006', grupo: 'requisiciones', nombre: 'Entrega parcial no marca ENTREGADA de más', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionApp solo descuenta lo capturado; los productos con cantidadEntregada=0 no generan salida',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 10 },
      { codigo: 'COD-003', producto: 'SAL DE MESA', unidad: 'KG', solicitado: 4 },
    ], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const r = entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [
      { codigo: 'COD-001', cantidadEntregada: 10 },
      { codigo: 'COD-003', cantidadEntregada: 0 },
    ], tokenAdmin);
    const existenciaHarina = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];
    const existenciaSal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-003')[10];
    return {
      datos: 'solicitado HARINA=10 (entregado=10) y SAL=4 (entregado=0)',
      esperado: 'solo 1 producto entregado, HARINA existencia=90, SAL sin cambio (=50)',
      obtenido: `productosEntregados=${r.productosEntregados}, harina=${existenciaHarina}, sal=${existenciaSal}`,
      pasa: r.productosEntregados === 1 && existenciaHarina === 90 && existenciaSal === 50,
    };
  },
});

prueba({
  id: 'REQ-007', grupo: 'requisiciones', nombre: 'Solo Almacén puede confirmar entregas', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionApp debe bloquear a un OPERADOR de área que intente confirmar su propia entrega',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], tokenCocina);
    let bloqueado = false;
    try { entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 5 }], tokenCocina); }
    catch (e) { bloqueado = true; }
    return { datos: 'Cocina intenta autoentregarse su requisición', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'REQ-008', grupo: 'requisiciones', nombre: 'Requisición de receta: PZ vs G sin conversión posible', metodo: 'EMPÍRICO',
  objetivo: 'obtenerCalculoIngredientesRequisicionApp debe marcar sinConversionPosible=true cuando la magnitud de la receta (peso) y la de MATRIZ (pieza) no son compatibles, y dejar el número sin convertir en vez de inventar un factor',
  ejecutar() {
    const matriz = hojaMatrizEstandar();
    // Producto controlado por pieza (UDM=PZ) CON ubicación real, para que
    // buscarProductoEnMatrizPorNombre_ sí lo encuentre (los productos sin
    // ubicación se excluyen a propósito — no es el caso que se quiere probar aquí).
    matriz.push(filaProducto({ producto: 'VELA DECORATIVA', udm: 'PZ', codigo: 'COD-006', existencia: 40, ubicacion: 'B-02' }));
    const entorno = crearEntorno({ hojas: hojasBase({
      MATRIZ: matriz,
      RECETAS: [
        ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
        ['CANASTA X', 'VELA DECORATIVA', 300, 'G', '1 canasta', 'GENERAL', 'ACTIVA'],
      ],
    }) });
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Cocina', 'OPERADOR');
    const req = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], tokenCocina);
    const calculo = entorno.invocar('obtenerCalculoIngredientesRequisicionApp', req.folio, tokenCocina);
    const ing = calculo.ingredientes[0];
    return {
      datos: 'receta pide 300 G, MATRIZ controla ese producto en PZ (magnitudes distintas)',
      esperado: 'sinConversionPosible=true, necesario se deja tal cual (300, sin inventar un factor)',
      obtenido: `sinConversionPosible=${ing.sinConversionPosible}, necesario=${ing.necesario} ${ing.udm}`,
      pasa: ing.sinConversionPosible === true && ing.necesario === 300,
    };
  },
});

prueba({
  id: 'REQ-010', grupo: 'requisiciones', nombre: 'Fecha requerida se guarda y se devuelve (lista y detalle)', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionApp(observaciones, items, token, fechaRequerida) debe guardar la fecha requerida en la 9na columna nueva; obtenerRequisicionesApp/obtenerDetalleRequisicionApp deben devolverla formateada dd/MM/yyyy',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], token, '2026-08-19');
    const lista = entorno.invocar('obtenerRequisicionesApp', token);
    const detalle = entorno.invocar('obtenerDetalleRequisicionApp', req.folio, token);
    return {
      datos: 'fechaRequerida="2026-08-19"',
      esperado: 'lista y detalle devuelven fechaRequerida="19/08/2026"',
      obtenido: `lista=${lista[0].fechaRequerida}, detalle=${detalle.fechaRequerida}`,
      pasa: lista[0].fechaRequerida === '19/08/2026' && detalle.fechaRequerida === '19/08/2026',
    };
  },
});

prueba({
  id: 'REQ-011', grupo: 'requisiciones', nombre: 'Fecha requerida omitida o inválida no truena la requisición', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionApp sin 4to argumento (compatibilidad con llamadas viejas de 3 args) y con texto inválido deben seguir creando el folio, solo sin fechaRequerida',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const reqSinFecha = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 1 }], token);
    const reqInvalida = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 1 }], token, 'no-es-fecha');
    const detalleSinFecha = entorno.invocar('obtenerDetalleRequisicionApp', reqSinFecha.folio, token);
    const detalleInvalida = entorno.invocar('obtenerDetalleRequisicionApp', reqInvalida.folio, token);
    return {
      datos: '3 args (sin fechaRequerida) y 4to arg="no-es-fecha"',
      esperado: 'ambos folios se crean, fechaRequerida="" en los dos',
      obtenido: `sinFecha.folio=${reqSinFecha.folio} fechaRequerida="${detalleSinFecha.fechaRequerida}", invalida.folio=${reqInvalida.folio} fechaRequerida="${detalleInvalida.fechaRequerida}"`,
      pasa: !!reqSinFecha.folio && !!reqInvalida.folio && detalleSinFecha.fechaRequerida === '' && detalleInvalida.fechaRequerida === '',
    };
  },
});

prueba({
  id: 'REQ-009', grupo: 'requisiciones', nombre: 'Requisición de receta con varias recetas suma ingredientes repetidos', metodo: 'EMPÍRICO',
  objetivo: 'obtenerCalculoIngredientesRequisicionApp debe acumular el mismo ingrediente cuando aparece en más de una receta solicitada',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase({ RECETAS: [
      ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
      ['PAN A', 'HARINA DE TRIGO', 1, 'KG', '1 tanda', 'GENERAL', 'ACTIVA'],
      ['PAN B', 'HARINA DE TRIGO', 2, 'KG', '1 tanda', 'GENERAL', 'ACTIVA'],
    ] }) });
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Cocina', 'OPERADOR');
    const req = entorno.invocar('crearRequisicionRecetaApp', '', [
      { codigoReceta: 'REC-0001', cantidadSolicitada: 1 },
      { codigoReceta: 'REC-0002', cantidadSolicitada: 1 },
    ], tokenCocina);
    const calculo = entorno.invocar('obtenerCalculoIngredientesRequisicionApp', req.folio, tokenCocina);
    const harina = calculo.ingredientes.find(i => i.nombre === 'HARINA DE TRIGO');
    return {
      datos: 'PAN A pide 1 KG harina, PAN B pide 2 KG harina, ambas x1 tanda solicitada',
      esperado: 'necesario acumulado = 3 KG',
      obtenido: `necesario=${harina.necesario} ${harina.udm}`,
      pasa: harina.necesario === 3,
    };
  },
});

prueba({
  id: 'REQ-012', grupo: 'requisiciones', nombre: 'Cancelar una requisición PENDIENTE cambia su estado y registra el motivo', metodo: 'EMPÍRICO',
  objetivo: 'cancelarRequisicionApp debe poner Estado=CANCELADA y anexar el motivo a Observaciones, solo para Almacén/Admin',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('cancelarRequisicionApp', req.folio, 'Duplicada por error', tokenAdmin);
    const fila = entorno.leerHoja('REQUISICIONES').find(f => f[0] === req.folio);
    return {
      datos: `requisición ${req.folio} PENDIENTE, cancelada por Admin con motivo`,
      esperado: 'Estado=CANCELADA, Observaciones incluye el motivo',
      obtenido: `estado=${fila[4]}, observaciones="${fila[5]}"`,
      pasa: fila[4] === 'CANCELADA' && /Duplicada por error/.test(fila[5]),
    };
  },
});

prueba({
  id: 'REQ-013', grupo: 'requisiciones', nombre: 'No se puede cancelar una requisición ya ENTREGADA', metodo: 'EMPÍRICO',
  objetivo: 'cancelarRequisicionApp debe rechazar una requisición ENTREGADA — ya movió existencia real, cancelarla dejaría el inventario desincronizado',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 5 }], tokenAdmin);
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('cancelarRequisicionApp', req.folio, '', tokenAdmin); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: `${req.folio} ya fue entregada`,
      esperado: 'bloqueado ("ya fue entregada")',
      obtenido: bloqueado ? mensaje : 'PERMITIDO',
      pasa: bloqueado && /entregada/i.test(mensaje),
    };
  },
});

prueba({
  id: 'REQ-014', grupo: 'requisiciones', nombre: 'No se puede cancelar dos veces la misma requisición', metodo: 'EMPÍRICO',
  objetivo: 'cancelarRequisicionApp debe rechazar una requisición que ya está CANCELADA',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('cancelarRequisicionApp', req.folio, '', tokenAdmin);
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('cancelarRequisicionApp', req.folio, '', tokenAdmin); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: `${req.folio} ya está CANCELADA`,
      esperado: 'bloqueado ("ya está cancelada")',
      obtenido: bloqueado ? mensaje : 'PERMITIDO',
      pasa: bloqueado && /cancelada/i.test(mensaje),
    };
  },
});

prueba({
  id: 'REQ-015', grupo: 'requisiciones', nombre: 'Solo Almacén puede cancelar requisiciones', metodo: 'EMPÍRICO',
  objetivo: 'cancelarRequisicionApp debe bloquear a un OPERADOR de área que no sea Admin/Almacén, incluso sobre su propia requisición',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    let bloqueado = false;
    try { entorno.invocar('cancelarRequisicionApp', req.folio, '', tokenCocina); }
    catch (e) { bloqueado = true; }
    return { datos: 'Cocina intenta cancelar su propia requisición', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'REQ-016', grupo: 'requisiciones', nombre: 'Entregar un producto EXTRA (no solicitado) descuenta existencia y queda registrado con Solicitado=0', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionApp debe aceptar un código en "entregas" que NO estaba en la solicitud original, resolverlo contra MATRIZ, descontar su existencia real, y agregarlo como fila nueva de detalle con Solicitado=0 (para que se note que fue un extra)',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    // COD-003 (SAL DE MESA, existencia=50) NO estaba en la requisición original.
    const r = entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [
      { codigo: 'COD-001', cantidadEntregada: 5 },
      { codigo: 'COD-003', cantidadEntregada: 8 },
    ], tokenAdmin);
    const existenciaSal = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-003')[10];
    const filaExtra = entorno.leerHoja('DETALLE_REQUISICIONES').find(f => f[0] === req.folio && f[1] === 'COD-003');
    return {
      datos: 'HARINA (solicitada, 5) + SAL (extra, 8, existencia inicial=50)',
      esperado: 'productosEntregados=2, SAL existencia=42, fila extra con Solicitado=0/Entregado=8',
      obtenido: `productosEntregados=${r.productosEntregados}, salExistencia=${existenciaSal}, filaExtra=${filaExtra ? JSON.stringify([filaExtra[4], filaExtra[5]]) : '(no encontrada)'}`,
      pasa: r.productosEntregados === 2 && existenciaSal === 42 && !!filaExtra && filaExtra[4] === 0 && filaExtra[5] === 8,
    };
  },
});

prueba({
  id: 'REQ-017', grupo: 'requisiciones', nombre: 'Un código extra que no existe en MATRIZ se rechaza (no se inventa un producto)', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionApp debe lanzar un error claro si el código extra no existe en MATRIZ, en vez de aceptar cualquier código que mande el cliente',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    let bloqueado = false, mensaje = '';
    try {
      entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [
        { codigo: 'COD-001', cantidadEntregada: 5 },
        { codigo: 'COD-NO-EXISTE', cantidadEntregada: 3 },
      ], tokenAdmin);
    } catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'código extra "COD-NO-EXISTE" no está en MATRIZ',
      esperado: 'bloqueado ("no existe en MATRIZ")',
      obtenido: bloqueado ? mensaje : 'PERMITIDO',
      pasa: bloqueado && /no existe en MATRIZ/i.test(mensaje),
    };
  },
});

prueba({
  id: 'REQ-018', grupo: 'requisiciones', nombre: 'INV-06: crear una requisición de Área reserva la cantidad contra S01', metodo: 'EMPÍRICO',
  objetivo: 'crearRequisicionApp debe reservar (EXISTENCIAS_SUCURSAL, mismo libro que usa el pipeline de Sucursal) la cantidad solicitada contra S01 — la existencia física de MATRIZ no cambia, solo el disponible',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 30 }], token);

    const disponible = entorno.invocar('obtenerDisponibleSucursalApp', 'COD-001', 'S01', tokenAdmin);
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];

    return {
      datos: 'COD-001 con existencia=100 (fixture estándar), se solicitan 30 en una requisición de Área',
      esperado: 'reservado=30, disponible=70, existencia física de MATRIZ sigue en 100 (nada se descontó todavía)',
      obtenido: `reservado=${disponible.reservado}, disponible=${disponible.disponible}, existenciaMatriz=${existenciaMatriz}`,
      pasa: disponible.reservado === 30 && disponible.disponible === 70 && existenciaMatriz === 100,
    };
  },
});

prueba({
  id: 'REQ-019', grupo: 'requisiciones', nombre: 'INV-06: no se puede reservar más de lo disponible, y se revierte todo si un producto de la requisición falla', metodo: 'EMPÍRICO',
  objetivo: 'Una segunda requisición que pediría más de lo que queda disponible (existencia menos lo ya reservado por la primera) debe rechazarse completa, sin dejar ninguna reserva parcial de los demás productos de esa misma requisición',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');

    // Primera requisición: reserva 90 de los 100 de COD-001. Quedan 10 disponibles.
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 90 }], token);

    // Segunda requisición: pide SAL (existencia=50, sin problema) + HARINA (pide 20, solo hay 10 disponibles) — debe rechazarse COMPLETA.
    let bloqueado = false, mensaje = '';
    try {
      entorno.invocar('crearRequisicionApp', '', [
        { codigo: 'COD-003', producto: 'SAL DE MESA', unidad: 'KG', solicitado: 5 },
        { codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 20 },
      ], token);
    } catch (e) { bloqueado = true; mensaje = e.message; }

    const disponibleSal = entorno.invocar('obtenerDisponibleSucursalApp', 'COD-003', 'S01', tokenAdmin);
    const disponibleHarina = entorno.invocar('obtenerDisponibleSucursalApp', 'COD-001', 'S01', tokenAdmin);

    return {
      datos: 'COD-001: 100 existencia, 90 ya reservados (10 disponibles). Segunda requisición pide SAL=5 + HARINA=20',
      esperado: 'bloqueado, y la reserva de SAL (5) se revierte — SAL disponible sigue en 50 (no se queda "a medias" reservada)',
      obtenido: `bloqueado=${bloqueado} (${mensaje}), disponibleSal=${disponibleSal.disponible}, disponibleHarina=${disponibleHarina.disponible}`,
      pasa: bloqueado && /disponible/i.test(mensaje) && disponibleSal.disponible === 50 && disponibleHarina.disponible === 10,
    };
  },
});

prueba({
  id: 'REQ-020', grupo: 'requisiciones', nombre: 'INV-06: cancelar una requisición de Área libera su reserva', metodo: 'EMPÍRICO',
  objetivo: 'cancelarRequisicionApp debe liberar exactamente lo que se reservó al crear la requisición',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 30 }], token);

    entorno.invocar('cancelarRequisicionApp', req.folio, 'Ya no se necesita', tokenAdmin);

    const disponible = entorno.invocar('obtenerDisponibleSucursalApp', 'COD-001', 'S01', tokenAdmin);

    return {
      datos: 'se reservaron 30 de COD-001 y se cancela la requisición',
      esperado: 'reservado vuelve a 0, disponible vuelve a 100',
      obtenido: `reservado=${disponible.reservado}, disponible=${disponible.disponible}`,
      pasa: disponible.reservado === 0 && disponible.disponible === 100,
    };
  },
});

prueba({
  id: 'REQ-021', grupo: 'requisiciones', nombre: 'INV-06: confirmar la entrega (aunque sea parcial) libera toda la reserva original', metodo: 'EMPÍRICO',
  objetivo: 'confirmarEntregaRequisicionApp debe liberar la reserva completa al cerrar la requisición, incluso si se entregó menos de lo solicitado — el modelo de Área no tiene un estado "parcialmente pendiente"',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 30 }], token);

    // Solo se entregan 20 de los 30 solicitados (entrega parcial).
    entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 20 }], tokenAdmin);

    const disponible = entorno.invocar('obtenerDisponibleSucursalApp', 'COD-001', 'S01', tokenAdmin);
    const existenciaMatriz = entorno.leerHoja('MATRIZ').find(f => f[4] === 'COD-001')[10];

    return {
      datos: 'se reservaron 30, pero solo se entregaron 20 (real salida de existencia)',
      esperado: 'reservado=0 (la reserva de los 30 se libera completa al cerrar), existencia física=80 (100-20 entregados), disponible=80',
      obtenido: `reservado=${disponible.reservado}, existenciaMatriz=${existenciaMatriz}, disponible=${disponible.disponible}`,
      pasa: disponible.reservado === 0 && existenciaMatriz === 80 && disponible.disponible === 80,
    };
  },
});

prueba({
  id: 'REQ-022', grupo: 'requisiciones', nombre: 'INV-06: una requisición de Receta no toca la reserva de MATRIZ', metodo: 'EMPÍRICO',
  objetivo: 'Los folios de tipo RECETA (crearRequisicionRecetaApp) guardan un código de receta en el detalle, no un código de MATRIZ — cancelarRequisicionApp/confirmarEntregaRequisicionApp deben detectar el tipo y NUNCA intentar reservar/liberar contra ese "código" (rompería con "producto no encontrado" si no se protegiera)',
  ejecutar() {
    const { entorno, token: tokenAdmin } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    entorno.invocar('crearRecetaApp', {
      nombre: 'SALSA X', rendimiento: '1 tanda', categoria: 'GENERAL',
      ingredientes: [{ nombre: 'HARINA DE TRIGO', cantidad: 500, udm: 'G' }],
    }, tokenAdmin);
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Cocina', 'OPERADOR');
    const req = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], tokenCocina);

    let error = null;
    try { entorno.invocar('cancelarRequisicionApp', req.folio, 'prueba', tokenAdmin); }
    catch (e) { error = e.message; }

    return {
      datos: `folio de receta ${req.folio} (código de detalle = REC-0001, no un código de MATRIZ)`,
      esperado: 'cancelarRequisicionApp NO truena (detecta tipo=RECETA y salta la lógica de reserva de Área)',
      obtenido: error ? `ERROR: ${error}` : 'sin error',
      pasa: error === null,
    };
  },
});

prueba({
  id: 'REQ-023', grupo: 'requisiciones', nombre: 'INV-06: buscarProductoParaRequisicionApp expone disponible (existencia menos reservado)', metodo: 'EMPÍRICO',
  objetivo: 'El buscador de productos para armar una requisición de Área debe mostrar disponible real, no solo la existencia física, para que el usuario no capture una cantidad que se va a rechazar',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 40 }], token);

    const resultados = entorno.invocar('buscarProductoParaRequisicionApp', 'HARINA', token);
    const harina = resultados.find(r => r.codigo === 'COD-001');

    return {
      datos: 'COD-001 existencia=100, ya con 40 reservados por una requisición pendiente',
      esperado: 'existencia=100, reservado=40, disponible=60',
      obtenido: harina ? `existencia=${harina.existencia}, reservado=${harina.reservado}, disponible=${harina.disponible}` : 'HARINA no encontrada',
      pasa: !!harina && harina.existencia === 100 && harina.reservado === 40 && harina.disponible === 60,
    };
  },
});

prueba({
  id: 'REQ-024', grupo: 'requisiciones', nombre: 'ALM-201: obtenerDetalleRequisicionApp ordena el picking por ubicación, no por orden de captura', metodo: 'EMPÍRICO',
  objetivo: 'Quien surte una requisición debe recorrer el almacén en orden, no saltar de un extremo a otro siguiendo el orden en que se solicitaron los productos — el detalle debe traer cada item con su ubicación y venir ordenado alfabéticamente por ella (sin ubicación al final)',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const matriz = entorno.leerHoja('MATRIZ');
    matriz.find(f => f[4] === 'COD-001')[9] = 'C-03-N01-P01'; // HARINA
    matriz.find(f => f[4] === 'COD-002')[9] = 'A-01-N02-P01'; // AZUCAR
    matriz.find(f => f[4] === 'COD-003')[9] = 'B-02-N01-P03'; // SAL
    matriz.find(f => f[4] === 'COD-005')[9] = '--'; // sin ubicación real (marcador del fixture)
    matriz.find(f => f[4] === 'COD-005')[10] = 5; // el fixture estándar lo trae en 0 — se sube para poder reservarlo

    // Se solicitan en un orden que NO coincide con el orden físico del almacén.
    const req = entorno.invocar('crearRequisicionApp', '', [
      { codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 },
      { codigo: 'COD-002', producto: 'AZUCAR ESTANDAR', unidad: 'KG', solicitado: 2 },
      { codigo: 'COD-003', producto: 'SAL DE MESA', unidad: 'KG', solicitado: 1 },
      { codigo: 'COD-005', producto: 'PRODUCTO SIN UBICACION', unidad: 'PZ', solicitado: 1 },
    ], token);

    const detalle = entorno.invocar('obtenerDetalleRequisicionApp', req.folio, token);
    const ordenCodigos = detalle.items.map(it => it.codigo);
    const ordenUbicaciones = detalle.items.map(it => it.ubicacion);

    return {
      datos: 'solicitado en orden COD-001(C-03), COD-002(A-01), COD-003(B-02), COD-005(sin ubicación)',
      esperado: 'devuelto en orden de ubicación: COD-002(A-01) → COD-003(B-02) → COD-001(C-03) → COD-005(al final, sin ubicación)',
      obtenido: `orden=${ordenCodigos.join(',')}, ubicaciones=${ordenUbicaciones.join('|')}`,
      pasa: ordenCodigos.join(',') === 'COD-002,COD-003,COD-001,COD-005' && ordenUbicaciones[3] === '',
    };
  },
});
