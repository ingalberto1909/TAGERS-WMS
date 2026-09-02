'use strict';

/*
 * Administración de Programación de Conteos Cíclicos desde la web app
 * (petición explícita del usuario tras la auditoría maestra: el motor de
 * ejecución automática ya corría, pero no había pantalla para dar de
 * alta/editar/activar/desactivar filas de PROGRAMACION_CONTEOS sin abrir
 * el Sheet). Estas pruebas cubren las funciones nuevas en
 * ProgramacionConteos.gs: requerirAccesoProgramacionConteosApp_,
 * obtenerProgramacionConteosApp, obtenerCatalogosProgramacionConteoApp,
 * crearProgramacionConteoApp, editarProgramacionConteoApp,
 * cambiarEstadoProgramacionConteoApp.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rol, correo, nombre) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const token = entorno.invocar('crearSesion_', correo || (rol.toLowerCase() + '@tagers.com'), nombre || rol, rol);
  return { entorno, token };
}

// entorno.leerHoja() regresa la fila de encabezado como elemento [0] (igual
// que hoja.getDataRange().getValues() real) — el código de producción
// siempre hace .shift() antes de usarla; estas pruebas hacen lo mismo para
// quedarse solo con las filas de datos.
function filasDatos(entorno) {
  return entorno.leerHoja('PROGRAMACION_CONTEOS').slice(1);
}

prueba({
  id: 'PCA-001', grupo: 'legado', nombre: 'obtenerProgramacionConteosApp exige ADMIN o SUPERVISOR',
  metodo: 'EMPÍRICO',
  objetivo: 'OPERADOR y CONSULTA no deben poder administrar la programación de conteos',
  ejecutar() {
    const { entorno: eOp, token: tOp } = entornoConLogin('OPERADOR');
    const { entorno: eCons, token: tCons } = entornoConLogin('CONSULTA');

    let errorOp = '', errorCons = '';
    try { eOp.invocar('obtenerProgramacionConteosApp', tOp); } catch (e) { errorOp = e.message; }
    try { eCons.invocar('obtenerProgramacionConteosApp', tCons); } catch (e) { errorCons = e.message; }

    return {
      datos: 'token de OPERADOR y token de CONSULTA',
      esperado: 'ambos bloqueados con error explícito',
      obtenido: `errorOp="${errorOp}", errorCons="${errorCons}"`,
      pasa: !!errorOp && !!errorCons,
    };
  },
});

prueba({
  id: 'PCA-002', grupo: 'legado', nombre: 'SUPERVISOR y ADMIN sí pueden consultar la lista completa (ACTIVO e INACTIVO)',
  metodo: 'EMPÍRICO',
  objetivo: 'obtenerProgramacionConteosApp debe regresar todas las filas, sin filtrar por estado (el filtro es responsabilidad del frontend)',
  ejecutar() {
    const { entorno, token } = entornoConLogin('SUPERVISOR');
    entorno.hojas.PROGRAMACION_CONTEOS._filas().push(
      ['PC-0001', 'A', 'LUNES', 'SEMANAL', 'Juan', 'ACTIVO', ''],
      ['PC-0002', 'B', 'MARTES', 'QUINCENAL', 'Ana', 'INACTIVO', '']
    );

    const lista = entorno.invocar('obtenerProgramacionConteosApp', token);

    return {
      datos: '2 filas en PROGRAMACION_CONTEOS (1 ACTIVO, 1 INACTIVO)',
      esperado: '2 registros regresados, con sus campos mapeados (id, rack, dia, frecuencia, responsable, estado)',
      obtenido: JSON.stringify(lista),
      pasa: lista.length === 2 && lista[0].rack === 'A' && lista[0].estado === 'ACTIVO' && lista[1].estado === 'INACTIVO',
    };
  },
});

prueba({
  id: 'PCA-003', grupo: 'legado', nombre: 'obtenerCatalogosProgramacionConteoApp trae los racks reales de MATRIZ',
  metodo: 'EMPÍRICO',
  objetivo: 'El selector de rack del formulario debe poblarse con los racks reales del catálogo, no con texto libre',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    const catalogos = entorno.invocar('obtenerCatalogosProgramacionConteoApp', token);

    return {
      datos: 'MATRIZ con productos de fixture (rack "A" en datos-prueba.js)',
      esperado: 'catalogos.racks incluye al menos un rack real, catalogos.dias tiene 7 días, catalogos.frecuencias no está vacío',
      obtenido: JSON.stringify(catalogos),
      pasa: Array.isArray(catalogos.racks) && catalogos.racks.length > 0
        && Array.isArray(catalogos.dias) && catalogos.dias.length === 7
        && Array.isArray(catalogos.frecuencias) && catalogos.frecuencias.length > 0,
    };
  },
});

prueba({
  id: 'PCA-004', grupo: 'legado', nombre: 'crearProgramacionConteoApp valida rack, día y responsable',
  metodo: 'EMPÍRICO',
  objetivo: 'No debe poder crearse una programación sin rack, con un día inválido, o sin responsable',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');

    let errorSinRack = '', errorDiaInvalido = '', errorSinResponsable = '';
    try { entorno.invocar('crearProgramacionConteoApp', { rack: '', dia: 'LUNES', responsable: 'Juan' }, token); } catch (e) { errorSinRack = e.message; }
    try { entorno.invocar('crearProgramacionConteoApp', { rack: 'A', dia: 'FUNDAY', responsable: 'Juan' }, token); } catch (e) { errorDiaInvalido = e.message; }
    try { entorno.invocar('crearProgramacionConteoApp', { rack: 'A', dia: 'LUNES', responsable: '' }, token); } catch (e) { errorSinResponsable = e.message; }

    return {
      datos: '3 intentos de creación, cada uno con un campo obligatorio faltante/inválido',
      esperado: 'los 3 intentos son rechazados con error explícito, ninguno agrega fila',
      obtenido: `errorSinRack="${errorSinRack}", errorDiaInvalido="${errorDiaInvalido}", errorSinResponsable="${errorSinResponsable}"`,
      pasa: !!errorSinRack && !!errorDiaInvalido && !!errorSinResponsable
        && filasDatos(entorno).length === 0,
    };
  },
});

prueba({
  id: 'PCA-005', grupo: 'legado', nombre: 'crearProgramacionConteoApp crea la fila, normaliza día/frecuencia y audita',
  metodo: 'EMPÍRICO',
  objetivo: 'Una creación válida debe quedar en PROGRAMACION_CONTEOS con Estado=ACTIVO y dejar rastro en AUDITORIA. El rack se conserva tal cual llega (viene de un selector con los valores reales de MATRIZ, nunca de texto libre) — solo día/frecuencia se normalizan a mayúsculas porque sí son constantes fijas del propio código.',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN', 'admin@tagers.com', 'Admin Uno');
    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;

    const resultado = entorno.invocar('crearProgramacionConteoApp', { rack: 'A', dia: 'lunes', frecuencia: 'semanal', responsable: 'Juan Pérez' }, token);
    const filas = filasDatos(entorno);
    const auditoria = entorno.leerHoja('AUDITORIA');

    return {
      datos: 'rack="A" (valor real del selector), dia="lunes", frecuencia="semanal" en minúsculas',
      esperado: 'fila creada con día/frecuencia normalizados a mayúsculas (LUNES, SEMANAL), rack sin alterar (A), Estado=ACTIVO, +1 fila en AUDITORIA',
      obtenido: `resultado.ok=${resultado.ok}, id=${resultado.id}, fila=${JSON.stringify(filas[0])}, auditoriaNueva=${auditoria.length - auditoriaAntes}`,
      pasa: resultado.ok === true && !!resultado.id
        && filas.length === 1 && filas[0][1] === 'A' && filas[0][2] === 'LUNES' && filas[0][3] === 'SEMANAL' && filas[0][5] === 'ACTIVO'
        && auditoria.length - auditoriaAntes === 1,
    };
  },
});

prueba({
  id: 'PCA-006', grupo: 'legado', nombre: 'editarProgramacionConteoApp actualiza rack/día/frecuencia/responsable sin tocar Estado ni Última generación',
  metodo: 'EMPÍRICO',
  objetivo: 'Editar una programación existente no debe alterar su Estado actual ni su columna de Última generación',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.hojas.PROGRAMACION_CONTEOS._filas().push(['PC-0001', 'A', 'LUNES', 'SEMANAL', 'Juan', 'INACTIVO', '2026-01-01']);

    entorno.invocar('editarProgramacionConteoApp', 'PC-0001', { rack: 'B', dia: 'MARTES', frecuencia: 'MENSUAL', responsable: 'Ana' }, token);
    const fila = filasDatos(entorno)[0];

    return {
      datos: 'fila existente PC-0001 INACTIVO con Última generación=2026-01-01, se edita rack/día/frecuencia/responsable',
      esperado: 'B, MARTES, MENSUAL, Ana — pero Estado sigue INACTIVO y Última generación sigue 2026-01-01',
      obtenido: JSON.stringify(fila),
      pasa: fila[1] === 'B' && fila[2] === 'MARTES' && fila[3] === 'MENSUAL' && fila[4] === 'Ana'
        && fila[5] === 'INACTIVO' && fila[6] === '2026-01-01',
    };
  },
});

prueba({
  id: 'PCA-007', grupo: 'legado', nombre: 'editarProgramacionConteoApp con un ID inexistente falla con error explícito',
  metodo: 'EMPÍRICO',
  objetivo: 'No debe fallar en silencio ni crear una fila nueva si el ID no existe',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    let error = '';
    try {
      entorno.invocar('editarProgramacionConteoApp', 'PC-9999', { rack: 'A', dia: 'LUNES', responsable: 'Juan' }, token);
    } catch (e) { error = e.message; }

    return {
      datos: 'ID "PC-9999" que no existe en PROGRAMACION_CONTEOS (vacía)',
      esperado: 'error explícito, sin filas creadas',
      obtenido: `error="${error}", filas=${filasDatos(entorno).length}`,
      pasa: !!error && filasDatos(entorno).length === 0,
    };
  },
});

prueba({
  id: 'PCA-008', grupo: 'legado', nombre: 'cambiarEstadoProgramacionConteoApp desactiva y una programación INACTIVA no se genera',
  metodo: 'EMPÍRICO',
  objetivo: 'Desactivar una programación debe excluirla de generarConteosDelDia, aunque sea su día y esté "pendiente" de generarse',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
    const diaHoy = DIAS[new Date().getDay()];
    entorno.hojas.PROGRAMACION_CONTEOS._filas().push(['PC-0001', 'A', diaHoy, 'SEMANAL', 'Juan', 'ACTIVO', '']);

    entorno.invocar('cambiarEstadoProgramacionConteoApp', 'PC-0001', 'INACTIVO', token);
    const filaTrasDesactivar = filasDatos(entorno)[0];

    const resultadoGeneracion = entorno.invocar('generarConteosDelDia');

    return {
      datos: `programación ACTIVA para hoy (${diaHoy}), se desactiva antes de que corra la generación diaria`,
      esperado: 'Estado queda INACTIVO, y generarConteosDelDia NO genera nada (generado=false)',
      obtenido: `estado=${filaTrasDesactivar[5]}, generado=${resultadoGeneracion.generado}`,
      pasa: filaTrasDesactivar[5] === 'INACTIVO' && resultadoGeneracion.generado === false,
    };
  },
});

prueba({
  id: 'PCA-009', grupo: 'legado', nombre: 'cambiarEstadoProgramacionConteoApp rechaza un estado inválido',
  metodo: 'EMPÍRICO',
  objetivo: 'Solo ACTIVO/INACTIVO son estados válidos',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');
    entorno.hojas.PROGRAMACION_CONTEOS._filas().push(['PC-0001', 'A', 'LUNES', 'SEMANAL', 'Juan', 'ACTIVO', '']);

    let error = '';
    try { entorno.invocar('cambiarEstadoProgramacionConteoApp', 'PC-0001', 'PAUSADO', token); } catch (e) { error = e.message; }
    const fila = filasDatos(entorno)[0];

    return {
      datos: 'estado inválido "PAUSADO"',
      esperado: 'error explícito, Estado no cambia',
      obtenido: `error="${error}", estado=${fila[5]}`,
      pasa: !!error && fila[5] === 'ACTIVO',
    };
  },
});

prueba({
  id: 'PCA-010', grupo: 'legado', nombre: 'crear dos programaciones seguidas no genera IDs duplicados (protegido por conBloqueoApp_)',
  metodo: 'EMPÍRICO',
  objetivo: 'Dos altas consecutivas deben quedar con IDs distintos, ambas presentes en la hoja',
  ejecutar() {
    const { entorno, token } = entornoConLogin('ADMIN');

    const r1 = entorno.invocar('crearProgramacionConteoApp', { rack: 'A', dia: 'LUNES', responsable: 'Juan' }, token);
    const r2 = entorno.invocar('crearProgramacionConteoApp', { rack: 'B', dia: 'MARTES', responsable: 'Ana' }, token);
    const filas = filasDatos(entorno);

    return {
      datos: '2 altas consecutivas',
      esperado: '2 filas, IDs distintos entre sí',
      obtenido: `id1=${r1.id}, id2=${r2.id}, totalFilas=${filas.length}`,
      pasa: filas.length === 2 && r1.id !== r2.id,
    };
  },
});
