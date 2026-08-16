'use strict';

/*
 * Fixtures reutilizables: construyen las hojas mínimas que cada grupo de
 * pruebas necesita, con la MISMA disposición de columnas que usa el
 * backend real (confirmada leyendo 📁 App.gs.gs/Usuarios.gs/Código.gs).
 * Nunca toca una hoja real — todo vive en memoria durante la prueba.
 */

// USUARIOS: A Correo | B Nombre | C Password(hash) | D Rol | E Estado | F Área
function filaUsuario({ correo, nombre, passHash, rol, estado, area }) {
  return [correo, nombre, passHash || '', rol || '', estado || 'ACTIVO', area || ''];
}

function hojaUsuariosEstandar() {
  return [
    ['Correo', 'Nombre', 'Password', 'Rol', 'Estado', 'Área'],
    filaUsuario({ correo: 'admin@tagers.com', nombre: 'Admin Prueba', rol: 'ADMIN', area: 'Almacén' }),
    filaUsuario({ correo: 'supervisor@tagers.com', nombre: 'Supervisor Prueba', rol: 'SUPERVISOR' }),
    filaUsuario({ correo: 'operador@tagers.com', nombre: 'Operador Prueba', rol: 'OPERADOR' }),
    filaUsuario({ correo: 'consulta@tagers.com', nombre: 'Consulta Prueba', rol: 'CONSULTA' }),
    filaUsuario({ correo: 'cocina@tagers.com', nombre: 'Usuario Cocina', rol: 'OPERADOR', area: 'Cocina' }),
    filaUsuario({ correo: 'panaderia@tagers.com', nombre: 'Usuario Panadería', rol: 'OPERADOR', area: 'Panadería' }),
    filaUsuario({ correo: 'exempleado@tagers.com', nombre: 'Ex Empleado', rol: 'ADMIN', estado: 'INACTIVO' }),
  ];
}

// MATRIZ: A Producto|B UDM|C Categoría|D -|E Código|F -|G Rack|H -|I -|J Ubicación|K Existencia|L Mínimo|M Máximo|N-P -|Q Proveedor|R Costo|S Convertir|T Presentación
function filaProducto({ producto, udm, codigo, rack, ubicacion, existencia, minimo, maximo, proveedor, costo, convertir, presentacion }) {
  const fila = new Array(20).fill('');
  fila[0] = producto;
  fila[1] = udm || 'KG';
  fila[2] = 'GENERAL';
  fila[4] = codigo;
  fila[6] = rack || 'A';
  fila[9] = ubicacion !== undefined ? ubicacion : 'A-01';
  fila[10] = existencia !== undefined ? existencia : 0;
  fila[11] = minimo !== undefined ? minimo : 5;
  fila[12] = maximo !== undefined ? maximo : 50;
  fila[16] = proveedor || 'PROVEEDOR GENERICO';
  fila[17] = costo !== undefined ? costo : 10;
  fila[18] = convertir || 'NO';
  fila[19] = presentacion !== undefined ? presentacion : '';
  return fila;
}

function encabezadoMatriz() {
  const h = new Array(20).fill('');
  h[0]='Producto';h[1]='UDM';h[2]='Categoría';h[4]='Código';h[6]='Rack';h[9]='Ubicación';
  h[10]='Existencia';h[11]='Mínimo';h[12]='Máximo';h[16]='Proveedor';h[17]='Costo Unitario';h[18]='Convertir';h[19]='Presentación';
  return h;
}

function hojaMatrizEstandar() {
  return [
    encabezadoMatriz(),
    filaProducto({ producto: 'HARINA DE TRIGO', udm: 'KG', codigo: 'COD-001', existencia: 100, minimo: 10, maximo: 200 }),
    filaProducto({ producto: 'AZUCAR ESTANDAR', udm: 'KG', codigo: 'COD-002', existencia: 5, minimo: 10, maximo: 100 }),
    filaProducto({ producto: 'SAL DE MESA', udm: 'KG', codigo: 'COD-003', existencia: 50, minimo: 5, maximo: 80 }),
    filaProducto({
      producto: 'RAJAS POBLANAS 0.5 KG', udm: 'KG', codigo: 'COD-004', existencia: 12, minimo: 2, maximo: 30,
      convertir: 'SI', presentacion: 0.5,
    }),
    filaProducto({ producto: 'PRODUCTO SIN UBICACION', udm: 'PZ', codigo: 'COD-005', existencia: 0, ubicacion: '--' }),
  ];
}

function hojaVacia(encabezado) { return [encabezado]; }

const ENCABEZADOS = {
  KARDEX: ['Fecha', 'Hora', 'Tipo', 'Folio', 'Código', 'Producto', 'Entrada', 'Salida', 'ExistenciaAnterior', 'ExistenciaNueva', 'Usuario', 'Observación'],
  ENTRADA: ['Año', 'Mes', 'Fecha', 'Código', 'Producto', 'Cantidad', 'UDM', 'Lote', 'Caducidad', '', 'Ubicación'],
  SALIDA: ['Año', 'Mes', 'Fecha', 'Código', 'Producto', 'Cantidad', 'UDM', 'Área', 'Lote', 'Caducidad', 'Ubicación'],
  CONTEO_CICLICO: ['Folio', 'Fecha', 'Usuario', 'Código', 'Producto', 'Ubicación', 'Sistema', 'Físico', 'Diferencia', 'Estado', 'Rack'],
  CONTROL_CONTEOS: ['Folio', 'Fecha', 'Usuario', 'Racks', 'Productos', 'Contados', 'Avance', 'Estado'],
  HISTORIAL_CONTEOS: ['Folio', 'Fecha', 'Usuario', 'Código', 'Producto', 'Ubicación', 'Sistema', 'Físico', 'Diferencia', 'Resultado', 'FechaCierre', 'UsuarioCierre'],
  DISCREPANCIAS: ['Fecha', 'Folio', 'Código', 'Producto', 'Ubicación', 'Sistema', 'Físico', 'Diferencia', 'Rack', 'Estado', 'Usuario', 'FechaResolución', 'Comentario', 'Motivo'],
  AUDITORIA_AJUSTES: ['Fecha', 'Código', 'Producto', 'Sistema', 'Físico', 'Diferencia', 'Usuario', 'Observación', 'Rack'],
  AUDITORIA: ['ID', 'FechaCreación', 'FechaMod', 'Usuario', 'Módulo', 'Acción', 'Folio', 'Código', 'Producto', 'CantidadAnterior', 'CantidadNueva', 'Diferencia', 'Observación'],
  ORDENES_COMPRA: ['Folio', 'Fecha', 'Proveedor', 'Usuario', 'Estado', 'Total', 'Observaciones'],
  DETALLE_OC: ['Folio', 'Código', 'Producto', 'Cantidad', 'UDM', 'Precio', 'Importe', 'Recibido', 'Presentación', 'Piezas'],
  REQUISICIONES: ['Folio', 'Fecha', 'Área', 'Usuario', 'Estado', 'Observaciones', 'FechaEntrega', 'Entregó'],
  DETALLE_REQUISICIONES: ['Folio', 'Código', 'Producto', 'Unidad', 'Solicitado', 'Entregado', 'Tipo'],
  HISTORIAL_PRECIOS: ['Fecha', 'Código', 'Producto', 'Proveedor', 'PrecioAnterior', 'PrecioNuevo', 'Diferencia', '%Cambio', 'Usuario', 'OC'],
  RECETAS: ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
  PRODUCCION: ['FolioLote', 'Fecha', 'FechaCaducidad', 'CódigoReceta', 'NombreReceta', 'CódigoProducto', 'NombreProducto', 'FolioRequisición', 'CantidadProducida', 'UDM', 'CantidadDisponible', 'Estado', 'Usuario', 'Observaciones'],
  PROGRAMACION_CONTEOS: ['ID', 'Rack', 'Día', 'Frecuencia', 'Responsable', 'Estado', 'ÚltimaGeneración'],
};

/** Conjunto de hojas mínimas para casi cualquier prueba (usuarios + matriz + hojas vacías con encabezado correcto). */
function hojasBase(overrides) {
  const base = {
    USUARIOS: hojaUsuariosEstandar(),
    MATRIZ: hojaMatrizEstandar(),
    KARDEX: hojaVacia(ENCABEZADOS.KARDEX),
    ENTRADA: hojaVacia(ENCABEZADOS.ENTRADA),
    SALIDA: hojaVacia(ENCABEZADOS.SALIDA),
    CONTEO_CICLICO: hojaVacia(ENCABEZADOS.CONTEO_CICLICO),
    CONTROL_CONTEOS: hojaVacia(ENCABEZADOS.CONTROL_CONTEOS),
    HISTORIAL_CONTEOS: hojaVacia(ENCABEZADOS.HISTORIAL_CONTEOS),
    DISCREPANCIAS: hojaVacia(ENCABEZADOS.DISCREPANCIAS),
    AUDITORIA_AJUSTES: hojaVacia(ENCABEZADOS.AUDITORIA_AJUSTES),
    AUDITORIA: hojaVacia(ENCABEZADOS.AUDITORIA),
    ORDENES_COMPRA: hojaVacia(ENCABEZADOS.ORDENES_COMPRA),
    DETALLE_OC: hojaVacia(ENCABEZADOS.DETALLE_OC),
    REQUISICIONES: hojaVacia(ENCABEZADOS.REQUISICIONES),
    DETALLE_REQUISICIONES: hojaVacia(ENCABEZADOS.DETALLE_REQUISICIONES),
    HISTORIAL_PRECIOS: hojaVacia(ENCABEZADOS.HISTORIAL_PRECIOS),
    RECETAS: hojaVacia(ENCABEZADOS.RECETAS),
    PRODUCCION: hojaVacia(ENCABEZADOS.PRODUCCION),
    PROGRAMACION_CONTEOS: hojaVacia(ENCABEZADOS.PROGRAMACION_CONTEOS),
  };
  return Object.assign(base, overrides || {});
}

module.exports = {
  filaUsuario, hojaUsuariosEstandar,
  filaProducto, hojaMatrizEstandar, encabezadoMatriz,
  hojaVacia, ENCABEZADOS, hojasBase,
};
