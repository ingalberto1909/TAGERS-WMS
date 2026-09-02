'use strict';

/*
 * ADM-201 (auditoría de arquitectura, evolución continua): AUDITORIA ya
 * se escribía correctamente en todo el sistema desde hace varias fases
 * (login, discrepancias, cambios de ubicación, conteos programados,
 * etc.) — lo que faltaba era una forma de consultarla desde la app sin
 * abrir la hoja cruda en Sheets. Estas pruebas cubren obtenerRegistroAuditoriaApp
 * y obtenerModulosAuditoriaApp contra el código real.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

function filaAuditoria({ fecha, usuario, modulo, accion, folio = '', codigo = '', producto = '', antes = 0, despues = 0, obs = '' }) {
  return ['AUD-' + Math.random().toString(16).slice(2, 8), fecha, fecha, usuario, modulo, accion, folio, codigo, producto, antes, despues, despues - antes, obs];
}

prueba({
  id: 'AUD-101', grupo: 'auditoria', nombre: 'obtenerRegistroAuditoriaApp exige rol ADMIN', metodo: 'EMPÍRICO',
  objetivo: 'SUPERVISOR y OPERADOR no deben poder consultar el registro de auditoría — es información sensible de toda la operación, mismo criterio que la gestión de Usuarios',
  ejecutar() {
    const { entorno: e1, token: tSup } = entornoConLogin({ correo: 'supervisor@tagers.com', nombre: 'Sup', rol: 'SUPERVISOR' });
    const { entorno: e2, token: tOp } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });

    let errorSup = '', errorOp = '';
    try { e1.invocar('obtenerRegistroAuditoriaApp', {}, tSup); } catch (e) { errorSup = e.message; }
    try { e2.invocar('obtenerRegistroAuditoriaApp', {}, tOp); } catch (e) { errorOp = e.message; }

    return {
      datos: 'token de SUPERVISOR y token de OPERADOR',
      esperado: 'ambos bloqueados con error explícito',
      obtenido: `errorSup="${errorSup}", errorOp="${errorOp}"`,
      pasa: !!errorSup && !!errorOp,
    };
  },
});

prueba({
  id: 'AUD-102', grupo: 'auditoria', nombre: 'ADMIN sí puede consultar el registro, sin filtros trae lo más reciente primero', metodo: 'EMPÍRICO',
  objetivo: 'Sin filtros, obtenerRegistroAuditoriaApp debe traer todas las filas existentes, ordenadas de más reciente a más antigua',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const auditoria = entorno.leerHoja('AUDITORIA');
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-01T10:00:00'), usuario: 'Juan Perez', modulo: 'SEGURIDAD', accion: 'LOGIN EXITOSO' }));
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-02T10:00:00'), usuario: 'Ana Lopez', modulo: 'CONTEO', accion: 'GENERACION CONTEO', codigo: 'COD-001', producto: 'HARINA', antes: 0, despues: 5 }));
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-03T10:00:00'), usuario: 'Juan Perez', modulo: 'INVENTARIO', accion: 'CAMBIO DE UBICACION' }));

    const resultado = entorno.invocar('obtenerRegistroAuditoriaApp', {}, token);

    return {
      datos: '3 filas en AUDITORIA (01, 02, 03 de agosto)',
      esperado: '3 registros, el primero (más reciente) es el del 03 de agosto',
      obtenido: `total=${resultado.registros.length}, primero.accion=${resultado.registros[0].accion}, truncado=${resultado.truncado}`,
      pasa: resultado.registros.length === 3 && resultado.registros[0].accion === 'CAMBIO DE UBICACION' && resultado.truncado === false,
    };
  },
});

prueba({
  id: 'AUD-103', grupo: 'auditoria', nombre: 'Filtro por usuario (parcial, sin acentos/mayúsculas) funciona', metodo: 'EMPÍRICO',
  objetivo: 'El filtro de usuario debe ser una coincidencia parcial normalizada, para no obligar a escribir el nombre exacto',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const auditoria = entorno.leerHoja('AUDITORIA');
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-01T10:00:00'), usuario: 'Juan Pérez', modulo: 'SEGURIDAD', accion: 'LOGIN EXITOSO' }));
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-02T10:00:00'), usuario: 'Ana López', modulo: 'CONTEO', accion: 'GENERACION CONTEO' }));

    const resultado = entorno.invocar('obtenerRegistroAuditoriaApp', { usuario: 'juan perez' }, token);

    return {
      datos: 'buscar "juan perez" (sin acento, minúsculas) contra usuario guardado "Juan Pérez"',
      esperado: '1 coincidencia, la de Juan',
      obtenido: `total=${resultado.registros.length}, usuario=${resultado.registros[0] && resultado.registros[0].usuario}`,
      pasa: resultado.registros.length === 1 && resultado.registros[0].usuario === 'Juan Pérez',
    };
  },
});

prueba({
  id: 'AUD-104', grupo: 'auditoria', nombre: 'Filtro por módulo y por rango de fecha funcionan (juntos)', metodo: 'EMPÍRICO',
  objetivo: 'Filtrar por módulo=CONTEO y una fecha que excluye la fila fuera de rango debe dejar solo la fila que cumple ambos',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const auditoria = entorno.leerHoja('AUDITORIA');
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-01T10:00:00'), usuario: 'Ana', modulo: 'CONTEO', accion: 'GENERACION CONTEO' }));
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-15T10:00:00'), usuario: 'Ana', modulo: 'CONTEO', accion: 'GENERACION CONTEO' })); // fuera de rango
    auditoria.push(filaAuditoria({ fecha: new Date('2026-08-05T10:00:00'), usuario: 'Ana', modulo: 'INVENTARIO', accion: 'CAMBIO DE UBICACION' })); // módulo distinto

    const resultado = entorno.invocar('obtenerRegistroAuditoriaApp', { modulo: 'CONTEO', desde: '2026-08-01', hasta: '2026-08-10' }, token);

    return {
      datos: '3 filas: [CONTEO 01-ago, CONTEO 15-ago (fuera de rango), INVENTARIO 05-ago (módulo distinto)]',
      esperado: 'solo 1 coincidencia: CONTEO del 01 de agosto',
      obtenido: `total=${resultado.registros.length}, fecha=${resultado.registros[0] && resultado.registros[0].fecha}`,
      pasa: resultado.registros.length === 1 && resultado.registros[0].fecha.startsWith('01/08/2026'),
    };
  },
});

prueba({
  id: 'AUD-105', grupo: 'auditoria', nombre: 'Tope de 300 registros y bandera truncado', metodo: 'EMPÍRICO',
  objetivo: 'Con más de 300 coincidencias, debe regresar solo las 300 más recientes y truncado=true',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const auditoria = entorno.leerHoja('AUDITORIA');
    for (let i = 0; i < 305; i++) {
      auditoria.push(filaAuditoria({ fecha: new Date(2026, 0, 1 + i), usuario: 'Ana', modulo: 'CONTEO', accion: 'GENERACION CONTEO ' + i }));
    }

    const resultado = entorno.invocar('obtenerRegistroAuditoriaApp', {}, token);

    return {
      datos: '305 filas en AUDITORIA, sin filtros',
      esperado: '300 registros devueltos, truncado=true, el primero es el más reciente (día 305)',
      obtenido: `total=${resultado.registros.length}, truncado=${resultado.truncado}, primero.accion=${resultado.registros[0].accion}`,
      pasa: resultado.registros.length === 300 && resultado.truncado === true && resultado.registros[0].accion === 'GENERACION CONTEO 304',
    };
  },
});

prueba({
  id: 'AUD-106', grupo: 'auditoria', nombre: 'obtenerModulosAuditoriaApp regresa los módulos únicos y ordenados', metodo: 'EMPÍRICO',
  objetivo: 'Para poblar un selector de filtro (nunca texto libre), debe regresar cada módulo una sola vez, ordenado alfabéticamente',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'Admin', rol: 'ADMIN' });
    const auditoria = entorno.leerHoja('AUDITORIA');
    auditoria.push(filaAuditoria({ fecha: new Date(), usuario: 'A', modulo: 'SEGURIDAD', accion: 'X' }));
    auditoria.push(filaAuditoria({ fecha: new Date(), usuario: 'A', modulo: 'CONTEO', accion: 'X' }));
    auditoria.push(filaAuditoria({ fecha: new Date(), usuario: 'A', modulo: 'CONTEO', accion: 'Y' }));
    auditoria.push(filaAuditoria({ fecha: new Date(), usuario: 'A', modulo: 'INVENTARIO', accion: 'Z' }));

    const modulos = entorno.invocar('obtenerModulosAuditoriaApp', token);

    return {
      datos: 'módulos repetidos en AUDITORIA: SEGURIDAD, CONTEO, CONTEO, INVENTARIO',
      esperado: '["CONTEO","INVENTARIO","SEGURIDAD"] (únicos, orden alfabético)',
      obtenido: JSON.stringify(modulos),
      pasa: JSON.stringify(modulos) === JSON.stringify(['CONTEO', 'INVENTARIO', 'SEGURIDAD']),
    };
  },
});

prueba({
  id: 'AUD-107', grupo: 'auditoria', nombre: 'obtenerRegistroAuditoriaApp/obtenerModulosAuditoriaApp exigen sesión activa', metodo: 'EMPÍRICO',
  objetivo: 'Ambas funciones deben rechazar un token inválido/ausente, no solo el rol',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let error1 = '', error2 = '';
    try { entorno.invocar('obtenerRegistroAuditoriaApp', {}, 'token-invalido'); } catch (e) { error1 = e.message; }
    try { entorno.invocar('obtenerModulosAuditoriaApp', undefined); } catch (e) { error2 = e.message; }
    return {
      datos: 'token inválido, y aparte token undefined',
      esperado: 'ambas lanzan error explícito',
      obtenido: `error1="${error1}", error2="${error2}"`,
      pasa: !!error1 && !!error2,
    };
  },
});
