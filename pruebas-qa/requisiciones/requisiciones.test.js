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
