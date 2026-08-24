'use strict';

/*
 * Re-validación EMPÍRICA de los hallazgos de seguridad ya corregidos:
 * acceso sin sesión, token inválido/expirado, usuario deshabilitado con
 * sesión viva, acceso cruzado por rol, IDOR de requisiciones, y los
 * guards "legado" (Código.gs / funciones compartidas con diálogos de
 * Sheets) que caen a Session.getActiveUser() cuando no llega token.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase } = require('../lib/datos-prueba');

function entornoConLogin(rolCorreo, opciones) {
  const entorno = crearEntorno(Object.assign({ hojas: hojasBase() }, opciones));
  const token = entorno.invocar('crearSesion_', rolCorreo.correo, rolCorreo.nombre, rolCorreo.rol);
  return { entorno, token };
}

prueba({
  id: 'SEG-001', grupo: 'seguridad', nombre: 'Acceso sin token (anónimo)', metodo: 'EMPÍRICO',
  objetivo: 'requerirSesionActivaApp_ (vía guardarEntradaApp) debe bloquear una llamada sin token',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueado = false, mensaje = '';
    try { entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'X', cantidad: 1, udm: 'KG', token: undefined }); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'token=undefined', esperado: 'bloqueado ("sesión expiró o no es válida")',
      obtenido: bloqueado ? mensaje : 'PERMITIDO SIN SESIÓN',
      pasa: bloqueado && /sesión/i.test(mensaje),
    };
  },
});

prueba({
  id: 'SEG-002', grupo: 'seguridad', nombre: 'Token inventado/arbitrario', metodo: 'EMPÍRICO',
  objetivo: 'obtenerSesion_ no debe aceptar un token que nunca fue emitido por crearSesion_',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueado = false;
    try { entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'X', cantidad: 1, udm: 'KG', token: 'token-inventado-12345' }); }
    catch (e) { bloqueado = true; }
    return { datos: 'token="token-inventado-12345"', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'SEG-003', grupo: 'seguridad', nombre: 'Token expirado (>8h)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerSesion_ debe rechazar (y borrar) un token cuya sesión tiene más de SESION_DURACION_HORAS',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    const props = entorno.propiedades.getScriptProperties();
    const cruda = JSON.parse(props.getProperty('SESION_' + token));
    cruda.creada = new Date().getTime() - (9 * 60 * 60 * 1000); // hace 9 horas
    props.setProperty('SESION_' + token, JSON.stringify(cruda));

    let bloqueado = false;
    try { entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'X', cantidad: 1, udm: 'KG', token }); }
    catch (e) { bloqueado = true; }
    const sigueGuardado = props.getProperty('SESION_' + token) !== null;
    return {
      datos: 'sesión creada hace 9h (límite=8h)',
      esperado: 'bloqueado y la propiedad SESION_<token> se elimina',
      obtenido: `bloqueado=${bloqueado}, propiedadEliminada=${!sigueGuardado}`,
      pasa: bloqueado && !sigueGuardado,
    };
  },
});

prueba({
  id: 'SEG-004', grupo: 'seguridad', nombre: 'Usuario deshabilitado con sesión viva', metodo: 'EMPÍRICO',
  objetivo: 'requerirSesionActivaApp_ debe revalidar el Estado ACTUAL en USUARIOS, no solo el token',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'operador@tagers.com', nombre: 'Op', rol: 'OPERADOR' });
    // El admin desactiva al usuario DESPUÉS de que ya inició sesión (token sigue siendo válido por sí solo)
    const usuarios = entorno.leerHoja('USUARIOS');
    const fila = usuarios.find(f => f[0] === 'operador@tagers.com');
    fila[4] = 'INACTIVO';

    let bloqueado = false, mensaje = '';
    try { entorno.invocar('guardarEntradaApp', { codigo: 'COD-001', producto: 'X', cantidad: 1, udm: 'KG', token }); }
    catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'token válido, pero USUARIOS.Estado pasó a INACTIVO tras el login',
      esperado: 'bloqueado ("cuenta ya no está activa")',
      obtenido: bloqueado ? mensaje : 'PERMITIDO A USUARIO DESHABILITADO',
      pasa: bloqueado && /activa/i.test(mensaje),
    };
  },
});

prueba({
  id: 'SEG-005', grupo: 'seguridad', nombre: 'CONSULTA bloqueado de escritura (Operaciones)', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoOperacionesApp_ (vía registrarSalidaApp) debe bloquear a CONSULTA',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'consulta@tagers.com', nombre: 'C', rol: 'CONSULTA' });
    let bloqueado = false;
    try { entorno.invocar('registrarSalidaApp', { codigo: 'COD-001', producto: 'HARINA', cantidad: 1, udm: 'KG', token }); }
    catch (e) { bloqueado = true; }
    return { datos: 'rol=CONSULTA', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: 'SEG-006', grupo: 'seguridad', nombre: 'ADMIN sí puede Operaciones', metodo: 'EMPÍRICO',
  objetivo: 'Control negativo del SEG-005: un rol con acceso real no debe quedar bloqueado por error',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'admin@tagers.com', nombre: 'A', rol: 'ADMIN' });
    let error = null;
    try { entorno.invocar('registrarSalidaApp', { codigo: 'COD-001', producto: 'HARINA DE TRIGO', cantidad: 1, udm: 'KG', token }); }
    catch (e) { error = e.message; }
    return { datos: 'rol=ADMIN', esperado: 'sin error', obtenido: error || 'sin error', pasa: error === null };
  },
});

prueba({
  id: 'SEG-007', grupo: 'seguridad', nombre: 'IDOR requisición de producto (otra área)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDetalleRequisicionApp bloquea leer el folio de otra área (Fase 1)',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], tokenCocina);
    const tokenPanaderia = entorno.invocar('crearSesion_', 'panaderia@tagers.com', 'Panadería', 'OPERADOR');
    let bloqueado = false;
    try { entorno.invocar('obtenerDetalleRequisicionApp', req.folio, tokenPanaderia); } catch (e) { bloqueado = true; }
    return { datos: 'folio de Cocina leído por Panadería', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'FUGA', pasa: bloqueado };
  },
});

prueba({
  id: 'SEG-008', grupo: 'seguridad', nombre: 'IDOR requisición de receta (otra área)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDetalleRequisicionRecetaApp bloquea leer el folio de otra área cuando llega token',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase({ RECETAS: [
      ['Receta', 'Ingrediente', 'CantidadNeta', 'UDM', 'Rendimiento', 'Categoría', 'Estado'],
      ['SALSA X', 'HARINA DE TRIGO', 500, 'G', '1 tanda', 'GENERAL', 'ACTIVA'],
    ] }) });
    const tokenCocina = entorno.invocar('crearSesion_', 'cocina@tagers.com', 'Cocina', 'OPERADOR');
    const req = entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], tokenCocina);
    const tokenPanaderia = entorno.invocar('crearSesion_', 'panaderia@tagers.com', 'Panadería', 'OPERADOR');
    let bloqueado = false;
    try { entorno.invocar('obtenerDetalleRequisicionRecetaApp', req.folio, tokenPanaderia); } catch (e) { bloqueado = true; }
    return { datos: 'folio de receta de Cocina leído por Panadería', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'FUGA', pasa: bloqueado };
  },
});

prueba({
  id: 'SEG-009', grupo: 'seguridad', nombre: 'Entrega/PDF de requisición no se rompe con el guard de IDOR', metodo: 'EMPÍRICO',
  objetivo: 'Regresión detectada en esta misma corrida: construirHtmlRequisicion_ no pasaba token a obtenerDetalleRequisicionApp y tronaba "No se encontró la requisición" en toda entrega. Verifica que ya no ocurre.',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 3 }], tokenCocina);
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
    let error = null, resultado = null;
    try { resultado = entorno.invocar('confirmarEntregaRequisicionApp', req.folio, [{ codigo: 'COD-001', cantidadEntregada: 3 }], tokenAdmin); }
    catch (e) { error = e.message; }
    return {
      datos: 'Admin confirma entrega de folio de Cocina (área distinta a la del token del Admin es N/A porque Admin ve todo)',
      esperado: 'sin error, pdf.verUrl presente',
      obtenido: error ? ('ERROR: ' + error) : `productosEntregados=${resultado.productosEntregados}, pdf=${!!resultado.pdf.verUrl}`,
      pasa: error === null && !!(resultado && resultado.pdf && resultado.pdf.verUrl),
    };
  },
});

prueba({
  id: 'SEG-010', grupo: 'seguridad', nombre: 'Legado sin token: SUPERVISOR sí puede aprobar discrepancia', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoAlmacenLegadoApp_ debe permitir a SUPERVISOR vía Session.getActiveUser() cuando la llamada viene de un diálogo legado sin token',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase(), correoActivo: 'supervisor@tagers.com' });
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);
    let error = null;
    try { entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'legado', undefined); } catch (e) { error = e.message; }
    return { datos: 'Session.getActiveUser()=supervisor@tagers.com, sin token', esperado: 'sin error (permitido)', obtenido: error || 'sin error', pasa: error === null };
  },
});

prueba({
  id: 'SEG-011', grupo: 'seguridad', nombre: 'Legado sin token: OPERADOR de otra área NO puede aprobar discrepancia', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoAlmacenLegadoApp_ debe bloquear a un rol/área sin acceso a Almacén, aun sin token, vía Session.getActiveUser()',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase(), correoActivo: 'cocina@tagers.com' });
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);
    let bloqueado = false;
    try { entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'legado', undefined); } catch (e) { bloqueado = true; }
    return { datos: 'Session.getActiveUser()=cocina@tagers.com (OPERADOR, área Cocina), sin token', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'PERMITIDO', pasa: bloqueado };
  },
});

prueba({
  id: 'SEG-012', grupo: 'seguridad', nombre: 'Legado sin token: usuario ajeno a USUARIOS no bloquea (fail-open documentado)', metodo: 'EMPÍRICO',
  objetivo: 'requerirAccesoAlmacenLegadoApp_ deja pasar cuando Session.getActiveUser() no tiene fila en USUARIOS (ya tiene acceso directo de edición a la hoja) — comportamiento intencional, no un bug',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase(), correoActivo: 'nadie-registrado@tagers.com' });
    entorno.hojas.DISCREPANCIAS._filas().push([new Date(), 'CC-1', 'COD-001', 'HARINA', 'A-01', 100, 90, -10, 'A', 'PENDIENTE', '', '', '', '']);
    let error = null;
    try { entorno.invocar('aprobarDiscrepancia', 2, 'CONTEO_FISICO', 'legado', undefined); } catch (e) { error = e.message; }
    return { datos: 'correo sin fila en USUARIOS, sin token', esperado: 'sin error (fail-open documentado)', obtenido: error || 'sin error', pasa: error === null };
  },
});

prueba({
  id: 'SEG-013', grupo: 'seguridad', nombre: 'CONSULTA bloqueada de Recetas (crear)', metodo: 'EMPÍRICO',
  objetivo: 'requerirNoConsultaApp_ en crearRecetaApp debe bloquear a CONSULTA',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'consulta@tagers.com', nombre: 'C', rol: 'CONSULTA' });
    let bloqueado = false;
    try { entorno.invocar('crearRecetaApp', 'SALSA X', [{ nombre: 'HARINA DE TRIGO', cantidad: 1, udm: 'KG' }], '1 tanda', 'GENERAL', token); }
    catch (e) { bloqueado = true; }
    return { datos: 'rol=CONSULTA', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: 'SEG-014', grupo: 'seguridad', nombre: 'Producción exige sesión válida cuando llega token', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRequisicionListaParaProduccionApp debe bloquear un token inválido (antes no revisaba nada)',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueado = false;
    try { entorno.invocar('obtenerRequisicionListaParaProduccionApp', 'RI-0001', 'token-invalido'); }
    catch (e) { bloqueado = true; }
    return { datos: 'token inválido', esperado: 'bloqueado', obtenido: bloqueado ? 'bloqueado' : 'permitido', pasa: bloqueado };
  },
});

prueba({
  id: 'SEG-015', grupo: 'seguridad', nombre: 'Producción conserva acceso de CONSULTA a otra área (no es un bug)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerRequisicionListaParaProduccionApp NO debe filtrar por área para CONSULTA — es la única pantalla donde eso es intencional, documentado para no perder esta función ya entregada',
  ejecutar() {
    const { entorno, token: tokenCocina } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], tokenCocina);
    // Simula que ya fue entregada (estado que exige la función)
    const filaReq = entorno.leerHoja('REQUISICIONES').find(f => f[0] === req.folio);
    filaReq[4] = 'ENTREGADA';
    const tokenConsulta = entorno.invocar('crearSesion_', 'consulta@tagers.com', 'C', 'CONSULTA');
    let error = null;
    try { entorno.invocar('obtenerRequisicionListaParaProduccionApp', req.folio, tokenConsulta); } catch (e) { error = e.message; }
    return {
      datos: 'CONSULTA (sin área) lee folio de Cocina ya ENTREGADA',
      esperado: 'sin error (acceso intencional, ya entregado en una fase anterior)',
      obtenido: error || 'sin error',
      pasa: error === null,
    };
  },
});

/*
 * TAGERS WMS 2.0 — Fase 6 (Seguridad y auditoría).
 *
 * Con access:ANYONE en appsscript.json, CUALQUIERA que abra la URL puede
 * llamar cualquier función de nivel superior vía google.script.run desde
 * la consola del navegador, sin pasar nunca por el login propio de
 * TAGERS — no importa qué botón del frontend "normalmente" la dispare.
 * Una auditoría encontró ~55 funciones de lectura (y un par de
 * escritura) que no llamaban requerirSesionActivaApp_ ni recibían
 * siquiera un token — exponían órdenes de compra, costos, proveedores,
 * reportes ejecutivos, inventario mensual, etc. a cualquier visitante
 * anónimo. Esta prueba cubre una muestra representativa de cada archivo
 * tocado en esa corrección — no las ~55 una por una, pero sí al menos
 * una de cada módulo — para dejar constancia empírica del cierre.
 */
const FUNCIONES_CORREGIDAS_FASE6_ = [
  // AnalisisCompras.gs
  { nombre: 'obtenerAnalisisProductoComprasApp', args: ['harina'] },
  { nombre: 'generarProyeccionConsumoApp', args: ['harina', 10] },
  // Recetas.gs
  { nombre: 'obtenerRecetasApp', args: [] },
  { nombre: 'obtenerDetalleRecetaApp', args: ['X'] },
  // RequisicionesRecetas.gs
  { nombre: 'obtenerTipoRequisicionApp', args: ['F-1'] },
  { nombre: 'obtenerPDFRequisicionRecetaApp', args: ['F-1'] },
  // Produccion.gs
  { nombre: 'obtenerLotesProduccionApp', args: [{}] },
  { nombre: 'obtenerProductoTerminadoPorNombreRecetaApp', args: ['X'] },
  // 📁 App.gs.gs — catálogo/búsqueda
  { nombre: 'buscarProductoApp', args: ['COD-001'] },
  { nombre: 'obtenerDetalleProductoApp', args: ['COD-001'] },
  { nombre: 'busquedaGlobalHeaderApp', args: ['harina'] },
  { nombre: 'buscarProductoCatalogoApp', args: ['harina'] },
  // 📁 App.gs.gs — dashboard/reportes
  { nombre: 'obtenerResumenInicioApp', args: [] },
  { nombre: 'obtenerResumenExtraDashboardApp', args: [] },
  { nombre: 'obtenerReporteEjecutivoApp', args: [] },
  { nombre: 'obtenerValorInventarioApp', args: [] },
  // 📁 App.gs.gs — compras
  { nombre: 'obtenerOrdenesCompraApp', args: [] },
  { nombre: 'obtenerDetalleOCApp', args: ['OC-1'] },
  { nombre: 'obtenerAnalisisCostosApp', args: [30] },
  { nombre: 'obtenerHistorialComprasProductoApp', args: ['COD-001'] },
  { nombre: 'obtenerProveedoresReabastecimientoApp', args: [] },
  // 📁 App.gs.gs — inventario mensual
  { nombre: 'obtenerFoliosInventarioAbiertosApp', args: [] },
  { nombre: 'obtenerHistorialInventariosApp', args: [] },
  { nombre: 'obtenerDetalleInventarioApp', args: ['FIM-1'] },
  { nombre: 'obtenerDashboardInventarioMensualApp', args: [] },
  // 📁 App.gs.gs — requisiciones de área
  { nombre: 'buscarProductoParaRequisicionApp', args: ['harina'] },
  { nombre: 'obtenerProductosSugeridosAreaApp', args: ['Cocina'] },
];

prueba({
  id: 'SEG-016', grupo: 'seguridad', nombre: 'Fase 6 — muestra representativa de las funciones antes desprotegidas ahora exige sesión', metodo: 'EMPÍRICO',
  objetivo: 'Cada función listada (una por archivo tocado en la corrección) debe rechazar una llamada sin token válido — antes de esta fase ninguna lo hacía',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const sinBloquear = [];

    FUNCIONES_CORREGIDAS_FASE6_.forEach(({ nombre, args }) => {
      let bloqueado = false;
      try {
        entorno.invocar(nombre, ...args, undefined);
      } catch (e) {
        bloqueado = /sesión/i.test(e.message);
      }
      if (!bloqueado) sinBloquear.push(nombre);
    });

    return {
      datos: FUNCIONES_CORREGIDAS_FASE6_.length + ' funciones probadas sin token, una por cada archivo tocado',
      esperado: 'las ' + FUNCIONES_CORREGIDAS_FASE6_.length + ' rechazan la llamada con el mensaje de sesión inválida',
      obtenido: sinBloquear.length ? 'NO bloquearon: ' + sinBloquear.join(', ') : 'todas bloquearon correctamente',
      pasa: sinBloquear.length === 0,
    };
  },
});

prueba({
  id: 'SEG-017', grupo: 'seguridad', nombre: 'crearRequisicionRecetaApp y crearRequisicionApp (escritura) también exigen sesión', metodo: 'EMPÍRICO',
  objetivo: 'Las dos funciones de creación de requisición recibían token pero nunca lo validaban — deben rechazar ahora un token inválido antes de escribir nada',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueada1 = false, bloqueada2 = false;
    try { entorno.invocar('crearRequisicionRecetaApp', '', [{ codigoReceta: 'REC-0001', cantidadSolicitada: 1 }], 'token-invalido'); }
    catch (e) { bloqueada1 = /sesión/i.test(e.message); }
    try { entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA', unidad: 'KG', solicitado: 5 }], 'token-invalido'); }
    catch (e) { bloqueada2 = /sesión/i.test(e.message); }
    return {
      datos: 'token inventado en ambas',
      esperado: 'ambas rechazadas, ninguna fila nueva en REQUISICIONES',
      obtenido: `crearRequisicionRecetaApp=${bloqueada1}, crearRequisicionApp=${bloqueada2}, filasReq=${entorno.leerHoja('REQUISICIONES').length - 1}`,
      pasa: bloqueada1 && bloqueada2 && entorno.leerHoja('REQUISICIONES').length === 1,
    };
  },
});

prueba({
  id: 'SEG-018', grupo: 'seguridad', nombre: 'obtenerDetalleRequisicionRecetaApp (pública) exige sesión aunque el token se omita', metodo: 'EMPÍRICO',
  objetivo: 'Antes, esta función solo filtraba por área SI llegaba token, pero nunca exigía que llegara uno — omitirlo bypaseaba el filtro de área por completo. La versión pública ahora exige sesión siempre; la interna (_) sigue sin token para Producción',
  ejecutar() {
    const { entorno, token } = entornoConLogin({ correo: 'cocina@tagers.com', nombre: 'Cocina', rol: 'OPERADOR' });
    const req = entorno.invocar('crearRequisicionApp', '', [{ codigo: 'COD-001', producto: 'HARINA DE TRIGO', unidad: 'KG', solicitado: 5 }], token);
    let bloqueado = false;
    try { entorno.invocar('obtenerDetalleRequisicionRecetaApp', req.folio, undefined); }
    catch (e) { bloqueado = /sesión/i.test(e.message); }
    return {
      datos: 'llamada pública sin ningún token',
      esperado: 'bloqueada — ya no basta con omitir el token para saltarse el filtro de área',
      obtenido: bloqueado ? 'bloqueada' : 'PERMITIDO SIN SESIÓN',
      pasa: bloqueado,
    };
  },
});

prueba({
  id: 'SEG-019', grupo: 'seguridad', nombre: 'obtenerAccesoRequisicionesApp y obtenerAccesoSucursalApp exigen sesión aunque se llamen directo', metodo: 'EMPÍRICO',
  objetivo: 'Ambos resolutores de acceso se llaman siempre desde el cliente con un token ya validado por quien los envuelve, pero nunca revisaban nada por su cuenta — un token inválido pasado directo a ellos regresaba un descriptor vacío en vez de rechazar la llamada',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    let bloqueada1 = false, bloqueada2 = false;
    try { entorno.invocar('obtenerAccesoRequisicionesApp', 'token-invalido'); } catch (e) { bloqueada1 = /sesión/i.test(e.message); }
    try { entorno.invocar('obtenerAccesoSucursalApp', 'token-invalido'); } catch (e) { bloqueada2 = /sesión/i.test(e.message); }
    return {
      datos: 'token inventado en ambos resolutores',
      esperado: 'ambos rechazan la llamada, ninguno regresa un descriptor vacío en silencio',
      obtenido: `obtenerAccesoRequisicionesApp=${bloqueada1}, obtenerAccesoSucursalApp=${bloqueada2}`,
      pasa: bloqueada1 && bloqueada2,
    };
  },
});
