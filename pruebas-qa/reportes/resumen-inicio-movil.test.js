'use strict';

/*
 * TAGERS WMS MOBILE — obtenerResumenInicioMovilApp (📁 App.gs.gs) es el
 * único endpoint que alimenta las 6 tarjetas del Inicio móvil (Agotados/
 * Bajo mínimo/Conteos pendientes/Requisiciones/Órdenes de compra/Entradas
 * hoy). No reimplementa ningún cálculo: reusa obtenerResumenInicioApp
 * (los mismos números que ya ve Desktop) y solo agrega 2 contadores
 * (requisiciones y OC pendientes) con el mismo criterio de acceso que ya
 * usa obtenerAccionesRequeridasApp (Inteligencia.gs) — solo Admin/Almacén.
 * También cubre que obtenerResumenInicioApp exponga entradasHoy/salidasHoy
 * (el cálculo ya existía en obtenerDashboardMovil(), solo faltaba
 * exponerlo — Desktop no usa estos 2 campos nuevos, así que no hay riesgo
 * de romper su Inicio actual).
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, filaProducto, encabezadoMatriz } = require('../lib/datos-prueba');

function entornoConLogin(rol, area, correo, nombre) {
  const matriz = [
    encabezadoMatriz(),
    filaProducto({ producto: 'HARINA DE TRIGO', codigo: 'COD-001', existencia: 0, minimo: 10 }),   // agotado
    filaProducto({ producto: 'AZUCAR ESTANDAR', codigo: 'COD-002', existencia: 3, minimo: 10 }),    // bajo mínimo
    filaProducto({ producto: 'SAL DE MESA', codigo: 'COD-003', existencia: 50, minimo: 5 }),        // normal
  ];
  const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matriz }) });
  const token = entorno.invocar('crearSesion_', correo || (rol.toLowerCase() + '@tagers.com'), nombre || rol, rol);
  if (area) {
    const usuarios = entorno.leerHoja('USUARIOS');
    const fila = usuarios.find(f => f[0] === (correo || (rol.toLowerCase() + '@tagers.com')));
    if (fila) fila[5] = area; // columna F = Área
  }
  return { entorno, token };
}

prueba({
  id: 'RIM-001', grupo: 'reportes', nombre: 'obtenerResumenInicioMovilApp cuenta agotados/bajo mínimo igual que el Inicio de Desktop',
  metodo: 'EMPÍRICO',
  objetivo: 'Las tarjetas de Agotados y Bajo mínimo del Inicio móvil deben coincidir exactamente con sinStock/bajo de obtenerResumenInicioApp — mismo cálculo, sin duplicar lógica',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN', 'Almacén');
    const escritorio = entorno.invocar('obtenerResumenInicioApp', token);
    const movil = entorno.invocar('obtenerResumenInicioMovilApp', token);

    return {
      datos: 'MATRIZ con 1 producto agotado (existencia=0) y 1 bajo mínimo (existencia<mínimo)',
      esperado: 'movil.agotados === escritorio.sinStock (1), movil.bajoMinimo === escritorio.bajo (1)',
      obtenido: `escritorio.sinStock=${escritorio.sinStock}, escritorio.bajo=${escritorio.bajo}, movil.agotados=${movil.agotados}, movil.bajoMinimo=${movil.bajoMinimo}`,
      pasa: movil.agotados === escritorio.sinStock && movil.agotados === 1
        && movil.bajoMinimo === escritorio.bajo && movil.bajoMinimo === 1,
    };
  },
});

prueba({
  id: 'RIM-002', grupo: 'reportes', nombre: 'obtenerResumenInicioMovilApp cuenta requisiciones y OC pendientes para un usuario de Almacén/Admin',
  metodo: 'EMPÍRICO',
  objetivo: 'Una requisición de área PENDIENTE, una de sucursal PENDIENTE y una OC recién generada (nace PENDIENTE_APROBACION) deben sumar en los contadores correspondientes',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN', 'Almacén', 'admin@tagers.com', 'Admin');

    // crearRequisicionSucursalApp es "pedir a NOMBRE de una sucursal
    // propia" — un Admin/Corporativo no tiene una, así que esa línea la
    // crea un usuario real de sucursal (S02, ya en el fixture estándar);
    // lo que importa para esta prueba es que el ADMIN, al CONSULTAR el
    // resumen, vea sumadas ambas requisiciones (área + sucursal).
    const tokenS02 = entorno.invocar('crearSesion_', 'sucursal2@tagers.com', 'Operador S02', 'OPERADOR');

    entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-003', producto: 'SAL DE MESA', unidad: 'KG', solicitado: 5 }], token);
    entorno.invocar('crearRequisicionSucursalApp', '', [{ codigo: 'COD-003', producto: 'SAL DE MESA', unidad: 'KG', solicitado: 5 }], tokenS02);
    entorno.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 10, udm: 'KG', precio: 8 },
    ], token);

    const movil = entorno.invocar('obtenerResumenInicioMovilApp', token);

    return {
      datos: '1 requisición de área PENDIENTE + 1 de sucursal PENDIENTE + 1 OC recién generada (PENDIENTE_APROBACION)',
      esperado: 'requisicionesPendientes=2 (1+1), ordenesCompraPendientes=1',
      obtenido: `requisicionesPendientes=${movil.requisicionesPendientes}, ordenesCompraPendientes=${movil.ordenesCompraPendientes}`,
      pasa: movil.requisicionesPendientes === 2 && movil.ordenesCompraPendientes === 1,
    };
  },
});

prueba({
  id: 'RIM-003', grupo: 'reportes', nombre: 'obtenerResumenInicioMovilApp NO expone requisiciones/OC a un usuario sin acceso de Almacén',
  metodo: 'EMPÍRICO',
  objetivo: 'Un OPERADOR de un área normal (no Almacén) no debe ver el conteo de requisiciones/OC de otras áreas — mismo criterio que obtenerAccionesRequeridasApp',
  ejecutar() {
    const { entorno: e1, token: tAdmin } = entornoConLogin('ADMIN', 'Almacén', 'admin@tagers.com', 'Admin');
    e1.invocar('crearRequisicionApp', '', [{ codigo: 'COD-003', producto: 'SAL DE MESA', unidad: 'KG', solicitado: 5 }], tAdmin);
    e1.invocar('generarOrdenCompraApp', 'PROVEEDOR GENERICO', '', [
      { codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 10, udm: 'KG', precio: 8 },
    ], tAdmin);

    // Mismo entorno (misma hoja de requisiciones/OC ya creadas), pero
    // consultado con el token de un OPERADOR de Cocina (no Almacén).
    const tokenCocina = e1.invocar('crearSesion_', 'cocina2@tagers.com', 'Cocinero', 'OPERADOR');
    const usuarios = e1.leerHoja('USUARIOS');
    usuarios.push(['cocina2@tagers.com', 'Cocinero', '', 'OPERADOR', 'ACTIVO', 'Cocina', '']);

    const movil = e1.invocar('obtenerResumenInicioMovilApp', tokenCocina);

    return {
      datos: 'ya existen 1 requisición y 1 OC pendientes en el sistema; se consulta con un token de Cocina (no Almacén, no Admin)',
      esperado: 'requisicionesPendientes=0, ordenesCompraPendientes=0 (oculto, no es su información)',
      obtenido: `requisicionesPendientes=${movil.requisicionesPendientes}, ordenesCompraPendientes=${movil.ordenesCompraPendientes}`,
      pasa: movil.requisicionesPendientes === 0 && movil.ordenesCompraPendientes === 0,
    };
  },
});

prueba({
  id: 'RIM-004', grupo: 'reportes', nombre: 'obtenerResumenInicioApp expone entradasHoy/salidasHoy (ya calculados en obtenerDashboardMovil, antes no se regresaban)',
  metodo: 'EMPÍRICO',
  objetivo: 'Registrar una entrada hoy debe reflejarse en el campo entradasHoy del Inicio — el cálculo ya existía, solo faltaba exponerlo',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN', 'Almacén');

    entorno.invocar('guardarEntradaApp', { token, codigo: 'COD-003', producto: 'SAL DE MESA', cantidad: 20, udm: 'KG' });

    const resumen = entorno.invocar('obtenerResumenInicioApp', token);
    const movil = entorno.invocar('obtenerResumenInicioMovilApp', token);

    return {
      datos: '1 entrada registrada hoy sobre COD-003',
      esperado: 'obtenerResumenInicioApp.entradasHoy >= 1, obtenerResumenInicioMovilApp.entradasHoy coincide',
      obtenido: `resumen.entradasHoy=${resumen.entradasHoy}, movil.entradasHoy=${movil.entradasHoy}`,
      pasa: resumen.entradasHoy >= 1 && movil.entradasHoy === resumen.entradasHoy,
    };
  },
});
