'use strict';

/*
 * Catálogo de Sucursales (administración) — petición explícita del
 * usuario tras la auditoría maestra: antes, "sucursal" solo existía como
 * texto descubierto al vuelo (obtenerSucursalesConocidasApp, 📁 App.gs.gs)
 * en USUARIOS/EXISTENCIAS_SUCURSAL, sin catálogo real ni forma de dar de
 * baja una sucursal. Estas pruebas cubren Sucursales.gs (creación
 * perezosa + siembra de la hoja SUCURSALES, CRUD, y que
 * obtenerSucursalesConocidasApp respete el catálogo una vez que existe,
 * sin romper su comportamiento anterior mientras no exista).
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rol, correo, nombre) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', correo || (rol.toLowerCase() + '@tagers.com'), nombre || rol, rol);
  return { entorno, token };
}

prueba({
  id: 'SUC-101', grupo: 'sucursales', nombre: 'Administrar el catálogo de Sucursales exige ADMIN',
  metodo: 'EMPÍRICO',
  objetivo: 'SUPERVISOR y OPERADOR no deben poder administrar el catálogo (alta/edición/baja) — es información estructural sensible, mismo criterio que Usuarios',
  ejecutar() {
    const { entorno: eSup, token: tSup } = entornoConLogin('SUPERVISOR');
    const { entorno: eOp, token: tOp } = entornoConLogin('OPERADOR');

    let errorSup = '', errorOp = '';
    try { eSup.invocar('obtenerSucursalesApp', tSup); } catch (e) { errorSup = e.message; }
    try { eOp.invocar('crearSucursalApp', { codigo: 'S09', nombre: 'Test' }, tOp); } catch (e) { errorOp = e.message; }

    return {
      datos: 'token de SUPERVISOR (leer) y token de OPERADOR (crear)',
      esperado: 'ambos bloqueados con error explícito',
      obtenido: `errorSup="${errorSup}", errorOp="${errorOp}"`,
      pasa: !!errorSup && !!errorOp,
    };
  },
});

prueba({
  id: 'SUC-102', grupo: 'sucursales', nombre: 'La hoja SUCURSALES se crea y se siembra sola con los códigos reales ya en uso (primer acceso)',
  metodo: 'EMPÍRICO',
  objetivo: 'Al abrir la administración de Sucursales por primera vez (hoja SUCURSALES inexistente), debe crearse y llenarse automáticamente con S01 + los códigos reales encontrados en USUARIOS (S02, S04 en el fixture), todos ACTIVO',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');

    const noExisteAntes = entorno.hojas.SUCURSALES === undefined;
    const lista = entorno.invocar('obtenerSucursalesApp', token);
    const codigos = lista.map(function (s) { return s.codigo; }).sort();

    return {
      datos: 'USUARIOS fixture tiene sucursales S02 y S04 además del default S01; hoja SUCURSALES no existe todavía',
      esperado: 'SUCURSALES se crea con S01, S02, S04 (todas ACTIVO) — TODAS excluida',
      obtenido: `noExisteAntes=${noExisteAntes}, codigos=${JSON.stringify(codigos)}, estados=${JSON.stringify(lista.map(s => s.estado))}`,
      pasa: noExisteAntes && codigos.includes('S01') && codigos.includes('S02') && codigos.includes('S04')
        && !codigos.includes('TODAS') && lista.every(function (s) { return s.estado === 'ACTIVO'; }),
    };
  },
});

prueba({
  id: 'SUC-103', grupo: 'sucursales', nombre: 'crearSucursalApp valida código/nombre, rechaza duplicados y rechaza "TODAS"',
  metodo: 'EMPÍRICO',
  objetivo: 'No debe poder crearse una sucursal sin código/nombre, con un código ya existente, ni con el código reservado TODAS',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.invocar('obtenerSucursalesApp', token); // fuerza la siembra inicial (incluye S01)

    let errorSinCodigo = '', errorSinNombre = '', errorDuplicado = '', errorTodas = '';
    try { entorno.invocar('crearSucursalApp', { codigo: '', nombre: 'Test' }, token); } catch (e) { errorSinCodigo = e.message; }
    try { entorno.invocar('crearSucursalApp', { codigo: 'S09', nombre: '' }, token); } catch (e) { errorSinNombre = e.message; }
    try { entorno.invocar('crearSucursalApp', { codigo: 'S01', nombre: 'Duplicada' }, token); } catch (e) { errorDuplicado = e.message; }
    try { entorno.invocar('crearSucursalApp', { codigo: 'TODAS', nombre: 'Todas' }, token); } catch (e) { errorTodas = e.message; }

    return {
      datos: '4 intentos inválidos: sin código, sin nombre, código duplicado (S01), código reservado (TODAS)',
      esperado: 'los 4 son rechazados con error explícito',
      obtenido: `errorSinCodigo="${errorSinCodigo}", errorSinNombre="${errorSinNombre}", errorDuplicado="${errorDuplicado}", errorTodas="${errorTodas}"`,
      pasa: !!errorSinCodigo && !!errorSinNombre && !!errorDuplicado && !!errorTodas,
    };
  },
});

prueba({
  id: 'SUC-104', grupo: 'sucursales', nombre: 'crearSucursalApp da de alta una sucursal nueva, normaliza el código y audita',
  metodo: 'EMPÍRICO',
  objetivo: 'Una creación válida debe quedar en SUCURSALES con Estado=ACTIVO, código en mayúsculas, y dejar rastro en AUDITORIA',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN', 'admin@tagers.com', 'Admin Uno');
    entorno.invocar('obtenerSucursalesApp', token);
    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;

    const resultado = entorno.invocar('crearSucursalApp', { codigo: 's09', nombre: 'Sucursal Nueva' }, token);
    const lista = entorno.invocar('obtenerSucursalesApp', token);
    const nueva = lista.find(function (s) { return s.codigo === 'S09'; });
    const auditoria = entorno.leerHoja('AUDITORIA');

    return {
      datos: 'codigo="s09" en minúsculas',
      esperado: 'queda como "S09", Estado=ACTIVO, nombre correcto, +1 fila en AUDITORIA',
      obtenido: `resultado.ok=${resultado.ok}, nueva=${JSON.stringify(nueva)}, auditoriaNueva=${auditoria.length - auditoriaAntes}`,
      pasa: resultado.ok === true && !!nueva && nueva.nombre === 'Sucursal Nueva' && nueva.estado === 'ACTIVO'
        && auditoria.length - auditoriaAntes === 1,
    };
  },
});

prueba({
  id: 'SUC-105', grupo: 'sucursales', nombre: 'editarSucursalApp solo cambia el Nombre — el código es inmutable',
  metodo: 'EMPÍRICO',
  objetivo: 'Editar debe actualizar el nombre sin alterar el código ni el estado actual',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.invocar('obtenerSucursalesApp', token);
    entorno.invocar('cambiarEstadoSucursalApp', 'S02', 'INACTIVO', token);

    entorno.invocar('editarSucursalApp', 'S02', { nombre: 'Sucursal Renombrada' }, token);
    const lista = entorno.invocar('obtenerSucursalesApp', token);
    const editada = lista.find(function (s) { return s.codigo === 'S02'; });

    return {
      datos: 'S02 (previamente desactivada), se edita solo el nombre',
      esperado: 'nombre actualizado, código sigue siendo S02, estado sigue INACTIVO',
      obtenido: JSON.stringify(editada),
      pasa: !!editada && editada.nombre === 'Sucursal Renombrada' && editada.codigo === 'S02' && editada.estado === 'INACTIVO',
    };
  },
});

prueba({
  id: 'SUC-106', grupo: 'sucursales', nombre: 'cambiarEstadoSucursalApp nunca permite desactivar S01 (almacén principal)',
  metodo: 'EMPÍRICO',
  objetivo: 'El sistema depende de que S01 siempre esté disponible — dar de baja S01 debe rechazarse siempre',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.invocar('obtenerSucursalesApp', token);

    let error = '';
    try { entorno.invocar('cambiarEstadoSucursalApp', 'S01', 'INACTIVO', token); } catch (e) { error = e.message; }
    const lista = entorno.invocar('obtenerSucursalesApp', token);
    const s01 = lista.find(function (s) { return s.codigo === 'S01'; });

    return {
      datos: 'intento de desactivar S01',
      esperado: 'error explícito, S01 sigue ACTIVO',
      obtenido: `error="${error}", estadoS01=${s01 && s01.estado}`,
      pasa: !!error && s01.estado === 'ACTIVO',
    };
  },
});

prueba({
  id: 'SUC-107', grupo: 'sucursales', nombre: 'cambiarEstadoSucursalApp rechaza estado inválido y código inexistente',
  metodo: 'EMPÍRICO',
  objetivo: 'Solo ACTIVO/INACTIVO son válidos; un código que no existe en el catálogo debe fallar explícito, no crear nada',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.invocar('obtenerSucursalesApp', token);

    let errorEstado = '', errorInexistente = '';
    try { entorno.invocar('cambiarEstadoSucursalApp', 'S02', 'PAUSADA', token); } catch (e) { errorEstado = e.message; }
    try { entorno.invocar('cambiarEstadoSucursalApp', 'S99', 'INACTIVO', token); } catch (e) { errorInexistente = e.message; }

    return {
      datos: 'estado inválido "PAUSADA" sobre S02, y código inexistente "S99"',
      esperado: 'ambos rechazados con error explícito',
      obtenido: `errorEstado="${errorEstado}", errorInexistente="${errorInexistente}"`,
      pasa: !!errorEstado && !!errorInexistente,
    };
  },
});

prueba({
  id: 'SUC-108', grupo: 'sucursales', nombre: 'obtenerSucursalesConocidasApp SIN catálogo sigue funcionando exactamente como antes',
  metodo: 'EMPÍRICO',
  objetivo: 'Regresión: mientras nadie haya abierto la administración de Sucursales (hoja SUCURSALES no existe), el comportamiento de Transferencias/Devoluciones (que usan esta función) no debe cambiar en absoluto',
  ejecutar() {
    const { entorno, token } = entornoConLogin('OPERADOR');
    const noExisteCatalogo = entorno.hojas.SUCURSALES === undefined;

    const codigos = entorno.invocar('obtenerSucursalesConocidasApp', token);

    return {
      datos: 'hoja SUCURSALES nunca creada en este entorno',
      esperado: 'regresa S01, S02, S04 descubiertos de USUARIOS (comportamiento histórico, sin tocar la hoja SUCURSALES)',
      obtenido: `noExisteCatalogo=${noExisteCatalogo}, codigos=${JSON.stringify(codigos)}, existeDespues=${entorno.hojas.SUCURSALES !== undefined}`,
      pasa: noExisteCatalogo && codigos.includes('S01') && codigos.includes('S02') && codigos.includes('S04')
        && entorno.hojas.SUCURSALES === undefined,
    };
  },
});

prueba({
  id: 'SUC-109', grupo: 'sucursales', nombre: 'obtenerSucursalesConocidasApp CON catálogo respeta las sucursales desactivadas',
  metodo: 'EMPÍRICO',
  objetivo: 'Una vez que existe el catálogo, una sucursal INACTIVA no debe seguir ofreciéndose en Transferencias/Devoluciones — esta es la mejora real que justifica tener un catálogo',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.invocar('obtenerSucursalesApp', token); // crea y siembra el catálogo
    entorno.invocar('cambiarEstadoSucursalApp', 'S04', 'INACTIVO', token);

    const codigos = entorno.invocar('obtenerSucursalesConocidasApp', token);

    return {
      datos: 'catálogo creado con S01/S02/S04, S04 se desactiva',
      esperado: 'S04 ya NO aparece en la lista para selectores, S01 y S02 sí',
      obtenido: JSON.stringify(codigos),
      pasa: codigos.includes('S01') && codigos.includes('S02') && !codigos.includes('S04'),
    };
  },
});

prueba({
  id: 'SUC-110', grupo: 'sucursales', nombre: 'obtenerSucursalesParaSelectorApp no exige ADMIN y siempre incluye TODAS',
  metodo: 'EMPÍRICO',
  objetivo: 'Cualquier usuario con sesión activa debe poder cargar el selector de sucursal (ej. al editar su propio perfil, o el formulario de Usuarios) — no es información administrativa sensible, y TODAS sigue siendo un valor válido aunque no sea un catálogo real',
  ejecutar() {
    const { entorno, token } = entornoConLogin('OPERADOR');

    let error = '';
    let resultado = [];
    try { resultado = entorno.invocar('obtenerSucursalesParaSelectorApp', token); } catch (e) { error = e.message; }

    return {
      datos: 'token de OPERADOR (no ADMIN)',
      esperado: 'no bloqueado, la lista incluye TODAS al final',
      obtenido: `error="${error}", resultado=${JSON.stringify(resultado)}`,
      pasa: !error && resultado.some(function (s) { return s.codigo === 'TODAS'; }),
    };
  },
});

prueba({
  id: 'SUC-111', grupo: 'sucursales', nombre: 'obtenerSucursalesParaSelectorApp excluye sucursales desactivadas',
  metodo: 'EMPÍRICO',
  objetivo: 'El selector del formulario de Usuarios no debe ofrecer una sucursal dada de baja como opción nueva a asignar',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.invocar('obtenerSucursalesApp', token);
    entorno.invocar('cambiarEstadoSucursalApp', 'S02', 'INACTIVO', token);

    const resultado = entorno.invocar('obtenerSucursalesParaSelectorApp', token);
    const codigos = resultado.map(function (s) { return s.codigo; });

    return {
      datos: 'S02 desactivada',
      esperado: 'S02 no aparece en el selector, S01/S04/TODAS sí',
      obtenido: JSON.stringify(codigos),
      pasa: !codigos.includes('S02') && codigos.includes('S01') && codigos.includes('S04') && codigos.includes('TODAS'),
    };
  },
});
