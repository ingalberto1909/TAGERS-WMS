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

// Hallazgo de la auditoría de rendimiento (ago-2026): estas 10 funciones se
// escaparon del barrido de Fase 6 porque ese barrido buscó específicamente
// el sufijo "...App" — estas nunca lo tuvieron (7 viven en 📁 App.gs.gs y
// Código.gs pero las llama activamente index.html; las otras 3 son de
// Código.gs y las llama MapaAlmacenV3.html, página que además nunca tuvo
// NINGÚN control de sesión propio — se detectaron auditando manualmente
// cada llamada de google.script.run que NO terminaba en "App(" en ambos
// archivos HTML activos.
const FUNCIONES_CORREGIDAS_AUDITORIA_RENDIMIENTO_ = [
  // 📁 App.gs.gs — index.html
  { nombre: 'obtenerInventario', args: [] },
  { nombre: 'obtenerKardex', args: [200] },
  { nombre: 'obtenerProductosPorEstadoStock', args: ['critico'] },
  // Código.gs — index.html (pantalla "Capturar/Cerrar conteo", "Aprobar discrepancias")
  { nombre: 'buscarCodigoConteo', args: ['COD-001', 'CC-1'] },
  { nombre: 'obtenerSiguientePendiente', args: ['CC-1'] },
  { nombre: 'obtenerFoliosAbiertos', args: [] },
  { nombre: 'obtenerDiscrepanciasPendientes', args: [] },
  // Código.gs — MapaAlmacenV3.html (?page=mapa, sin login propio hasta esta corrección)
  { nombre: 'obtenerResumenRacks', args: [] },
  { nombre: 'buscarProducto', args: ['harina'] },
  { nombre: 'obtenerUbicacionesRack', args: ['A'] },
];

prueba({
  id: 'SEG-020', grupo: 'seguridad', nombre: 'Auditoría de rendimiento — 10 funciones sin sufijo "App" que se escaparon de Fase 6 ahora exigen sesión', metodo: 'EMPÍRICO',
  objetivo: 'Cada función listada debe rechazar una llamada sin token válido — incluye las 3 que sirven al Mapa del Almacén (?page=mapa), página que antes de esta corrección no validaba sesión en NINGUNA de sus funciones',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const sinBloquear = [];

    FUNCIONES_CORREGIDAS_AUDITORIA_RENDIMIENTO_.forEach(({ nombre, args }) => {
      let bloqueado = false;
      try {
        entorno.invocar(nombre, ...args, undefined);
      } catch (e) {
        bloqueado = /sesión/i.test(e.message);
      }
      if (!bloqueado) sinBloquear.push(nombre);
    });

    return {
      datos: FUNCIONES_CORREGIDAS_AUDITORIA_RENDIMIENTO_.length + ' funciones probadas sin token (7 de index.html + 3 de MapaAlmacenV3.html)',
      esperado: 'las ' + FUNCIONES_CORREGIDAS_AUDITORIA_RENDIMIENTO_.length + ' rechazan la llamada con el mensaje de sesión inválida',
      obtenido: sinBloquear.length ? 'NO bloquearon: ' + sinBloquear.join(', ') : 'todas bloquearon correctamente',
      pasa: sinBloquear.length === 0,
    };
  },
});

/*
 * AUD-01 (auditoría comparativa vs. MarketMan): login/logout no dejaban
 * NINGÚN rastro en AUDITORIA, y no había límite de intentos fallidos —
 * relevante porque el despliegue es access:ANYONE. Estas pruebas cubren
 * el registro de éxito/fallo/logout y el bloqueo temporal tras repetidos
 * intentos fallidos.
 */

function entornoConPassword_(correo, password) {
  const entorno = crearEntorno({ hojas: hojasBase() });
  const fila = entorno.leerHoja('USUARIOS').find(f => f[0] === correo);
  fila[2] = password; // texto plano — validarUsuario lo migra a hash en el primer login exitoso
  return entorno;
}

prueba({
  id: 'SEG-021', grupo: 'seguridad', nombre: 'AUD-01: login exitoso queda en AUDITORIA', metodo: 'EMPÍRICO',
  objetivo: 'validarUsuario debe registrar una fila en AUDITORIA (módulo SEGURIDAD, acción LOGIN EXITOSO) cuando las credenciales son correctas',
  ejecutar() {
    const entorno = entornoConPassword_('operador@tagers.com', 'clave123');
    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    const res = entorno.invocar('validarUsuario', 'operador@tagers.com', 'clave123');
    const auditoria = entorno.leerHoja('AUDITORIA');
    const filaNueva = auditoria[auditoria.length - 1];
    return {
      datos: 'login correcto de operador@tagers.com',
      esperado: 'ok=true con token, +1 fila en AUDITORIA con acción LOGIN EXITOSO',
      obtenido: `ok=${res.ok}, tieneToken=${!!res.token}, filasNuevas=${auditoria.length - auditoriaAntes}, accion=${filaNueva[5]}, modulo=${filaNueva[4]}`,
      pasa: res.ok === true && !!res.token && (auditoria.length - auditoriaAntes) === 1 && filaNueva[5] === 'LOGIN EXITOSO' && filaNueva[4] === 'SEGURIDAD',
    };
  },
});

prueba({
  id: 'SEG-022', grupo: 'seguridad', nombre: 'AUD-01: login fallido queda en AUDITORIA y no crea sesión', metodo: 'EMPÍRICO',
  objetivo: 'validarUsuario debe registrar una fila en AUDITORIA (acción LOGIN FALLIDO) cuando la contraseña no coincide, sin regresar token',
  ejecutar() {
    const entorno = entornoConPassword_('operador@tagers.com', 'clave123');
    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    const res = entorno.invocar('validarUsuario', 'operador@tagers.com', 'clave-equivocada');
    const auditoria = entorno.leerHoja('AUDITORIA');
    const filaNueva = auditoria[auditoria.length - 1];
    return {
      datos: 'contraseña incorrecta para operador@tagers.com',
      esperado: 'ok=false sin token, +1 fila en AUDITORIA con acción LOGIN FALLIDO',
      obtenido: `ok=${res.ok}, tieneToken=${!!res.token}, filasNuevas=${auditoria.length - auditoriaAntes}, accion=${filaNueva[5]}`,
      pasa: res.ok === false && !res.token && (auditoria.length - auditoriaAntes) === 1 && filaNueva[5] === 'LOGIN FALLIDO',
    };
  },
});

prueba({
  id: 'SEG-023', grupo: 'seguridad', nombre: 'AUD-01: 5 intentos fallidos bloquean el 6º intento aunque la contraseña sea correcta', metodo: 'EMPÍRICO',
  objetivo: 'Tras UMBRAL_INTENTOS_LOGIN_ (5) intentos fallidos seguidos, validarUsuario debe rechazar cualquier intento siguiente (incluso con la contraseña correcta) hasta que pase la ventana de bloqueo',
  ejecutar() {
    const entorno = entornoConPassword_('operador@tagers.com', 'clave123');

    for (let i = 0; i < 5; i++) {
      entorno.invocar('validarUsuario', 'operador@tagers.com', 'clave-equivocada');
    }

    const intentoConClaveCorrecta = entorno.invocar('validarUsuario', 'operador@tagers.com', 'clave123');

    return {
      datos: '5 intentos fallidos seguidos, luego un 6º intento con la contraseña CORRECTA',
      esperado: 'el 6º intento también se rechaza (bloqueado=true), aunque la contraseña sea correcta',
      obtenido: `ok=${intentoConClaveCorrecta.ok}, bloqueado=${intentoConClaveCorrecta.bloqueado}, mensaje="${intentoConClaveCorrecta.mensaje || ''}"`,
      pasa: intentoConClaveCorrecta.ok === false && intentoConClaveCorrecta.bloqueado === true,
    };
  },
});

prueba({
  id: 'SEG-029', grupo: 'seguridad', nombre: 'Auditoría de arquitectura: un contador de intentos corrupto se autocorrige en vez de desbloquear en silencio', metodo: 'EMPÍRICO',
  objetivo: 'Si el valor guardado en PropertiesService para el contador de intentos de login no es JSON válido (corrupción), obtenerEstadoIntentosLogin_ debe: (1) no tronar, (2) tratarlo como 0 intentos (única opción segura sin poder reconstruir el valor real), (3) borrar la clave corrupta para no repetir el fallo, y (4) dejar constancia en AUDITORIA — antes fallaba exactamente igual pero en silencio, sin el paso 3 ni el 4',
  ejecutar() {
    const entorno = entornoConPassword_('operador@tagers.com', 'clave123');
    const clave = entorno.invocar('obtenerClaveIntentosLogin_', 'operador@tagers.com');
    entorno.propiedades.getScriptProperties().setProperty(clave, '{esto no es json valido');

    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    const res = entorno.invocar('validarUsuario', 'operador@tagers.com', 'clave123');
    const auditoria = entorno.leerHoja('AUDITORIA');
    const filasNuevas = auditoria.slice(auditoriaAntes);
    const registroCorrupcion = filasNuevas.find(f => f[5] === 'ESTADO DE INTENTOS CORRUPTO');
    const claveSigueGuardada = entorno.propiedades.getScriptProperties().getProperty(clave);

    return {
      datos: 'PropertiesService["' + clave + '"] = "{esto no es json valido" (corrupto), luego un login con la contraseña correcta',
      esperado: 'el login funciona con normalidad (ok=true, no bloqueado), la clave corrupta se borra, y alguna fila nueva en AUDITORIA queda con acción "ESTADO DE INTENTOS CORRUPTO"',
      obtenido: `ok=${res.ok}, claveSigueGuardada=${!!claveSigueGuardada}, filasNuevasAuditoria=${filasNuevas.length}, huboRegistroCorrupcion=${!!registroCorrupcion}`,
      pasa: res.ok === true && !claveSigueGuardada && !!registroCorrupcion,
    };
  },
});

prueba({
  id: 'SEG-024', grupo: 'seguridad', nombre: 'AUD-01: un login exitoso limpia el contador de intentos fallidos previos', metodo: 'EMPÍRICO',
  objetivo: 'Si el usuario acierta la contraseña ANTES de llegar al umbral de bloqueo, el contador de fallos se reinicia — fallos viejos no se acumulan contra un futuro error',
  ejecutar() {
    const entorno = entornoConPassword_('operador@tagers.com', 'clave123');

    entorno.invocar('validarUsuario', 'operador@tagers.com', 'mal-1');
    entorno.invocar('validarUsuario', 'operador@tagers.com', 'mal-2');
    entorno.invocar('validarUsuario', 'operador@tagers.com', 'mal-3'); // 3 de 5 — todavía no bloquea
    const exitoso = entorno.invocar('validarUsuario', 'operador@tagers.com', 'clave123'); // acierta, limpia el contador

    // 3 fallos más — si el contador NO se hubiera limpiado, este sería el 6º fallo acumulado y bloquearía.
    entorno.invocar('validarUsuario', 'operador@tagers.com', 'mal-4');
    entorno.invocar('validarUsuario', 'operador@tagers.com', 'mal-5');
    entorno.invocar('validarUsuario', 'operador@tagers.com', 'mal-6');
    const siguienteCorrecto = entorno.invocar('validarUsuario', 'operador@tagers.com', 'clave123');

    return {
      datos: '3 fallos, 1 acierto, 3 fallos más, 1 acierto — nunca llega a 5 fallos SEGUIDOS',
      esperado: 'ambos aciertos tienen éxito (el contador se reinicia en cada login exitoso, no se acumula entre rachas)',
      obtenido: `primerAcierto.ok=${exitoso.ok}, segundoAcierto.ok=${siguienteCorrecto.ok}, segundoAcierto.bloqueado=${siguienteCorrecto.bloqueado}`,
      pasa: exitoso.ok === true && siguienteCorrecto.ok === true && !siguienteCorrecto.bloqueado,
    };
  },
});

prueba({
  id: 'SEG-025', grupo: 'seguridad', nombre: 'AUD-01: logout queda en AUDITORIA y el token deja de ser válido', metodo: 'EMPÍRICO',
  objetivo: 'cerrarSesionApp debe registrar una fila en AUDITORIA (acción LOGOUT) con el usuario correcto ANTES de borrar el token, y la sesión debe quedar inválida después',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin Prueba', 'ADMIN');

    const auditoriaAntes = entorno.leerHoja('AUDITORIA').length;
    entorno.invocar('cerrarSesionApp', token);
    const auditoria = entorno.leerHoja('AUDITORIA');
    const filaNueva = auditoria[auditoria.length - 1];

    const sesionValidaDespues = entorno.invocar('validarSesionApp', token);

    return {
      datos: 'sesión de Admin Prueba, se cierra con cerrarSesionApp',
      esperado: '+1 fila en AUDITORIA con acción LOGOUT y usuario=Admin Prueba; el token ya no valida sesión',
      obtenido: `filasNuevas=${auditoria.length - auditoriaAntes}, accion=${filaNueva[5]}, usuario=${filaNueva[3]}, sesionValidaDespues=${sesionValidaDespues.ok}`,
      pasa: (auditoria.length - auditoriaAntes) === 1 && filaNueva[5] === 'LOGOUT' && filaNueva[3] === 'Admin Prueba' && sesionValidaDespues.ok === false,
    };
  },
});

prueba({
  id: 'SEG-026', grupo: 'seguridad', nombre: 'SEG-02: iniciar sesión de nuevo invalida la sesión anterior del mismo usuario', metodo: 'EMPÍRICO',
  objetivo: 'crearSesion_ debe implementar sesión única por usuario — un segundo login del mismo correo (otro dispositivo/pestaña) debe dejar el primer token inválido de inmediato',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenViejo = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin Prueba', 'ADMIN');
    const validaAntes = entorno.invocar('validarSesionApp', tokenViejo);

    const tokenNuevo = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin Prueba', 'ADMIN');

    const validaViejoDespues = entorno.invocar('validarSesionApp', tokenViejo);
    const validaNuevo = entorno.invocar('validarSesionApp', tokenNuevo);

    return {
      datos: 'admin@tagers.com inicia sesión, y luego vuelve a iniciar sesión (otro dispositivo)',
      esperado: 'el token viejo era válido antes, deja de serlo después del segundo login; el token nuevo sí es válido',
      obtenido: `validaAntes=${validaAntes.ok}, validaViejoDespues=${validaViejoDespues.ok}, validaNuevo=${validaNuevo.ok}, mismoToken=${tokenViejo === tokenNuevo}`,
      pasa: validaAntes.ok === true && validaViejoDespues.ok === false && validaNuevo.ok === true && tokenViejo !== tokenNuevo,
    };
  },
});

prueba({
  id: 'SEG-027', grupo: 'seguridad', nombre: 'SEG-02: la sesión única es por usuario, no global', metodo: 'EMPÍRICO',
  objetivo: 'Iniciar sesión con un correo NO debe afectar la sesión activa de otro correo distinto',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenAdmin = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin Prueba', 'ADMIN');
    entorno.invocar('crearSesion_', 'supervisor@tagers.com', 'Supervisor Prueba', 'SUPERVISOR');

    const validaAdmin = entorno.invocar('validarSesionApp', tokenAdmin);

    return {
      datos: 'admin@tagers.com inicia sesión, luego supervisor@tagers.com inicia sesión (correo distinto)',
      esperado: 'la sesión de admin@tagers.com sigue siendo válida — la restricción es por usuario, no global',
      obtenido: `validaAdmin=${validaAdmin.ok}`,
      pasa: validaAdmin.ok === true,
    };
  },
});

prueba({
  id: 'SEG-028', grupo: 'seguridad', nombre: 'SEG-02: cerrar sesión no borra el índice de una sesión más nueva del mismo usuario', metodo: 'EMPÍRICO',
  objetivo: 'Si el token viejo ya fue invalidado por un segundo login (SEG-02) y luego alguien llama cerrarSesionApp con ese token viejo, no debe borrar por accidente el índice que ya apunta a la sesión nueva',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase() });
    const tokenViejo = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin Prueba', 'ADMIN');
    const tokenNuevo = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin Prueba', 'ADMIN');

    entorno.invocar('cerrarSesionApp', tokenViejo); // token viejo, ya inválido por SEG-02

    const validaNuevoDespues = entorno.invocar('validarSesionApp', tokenNuevo);

    return {
      datos: 'token viejo (ya invalidado por el segundo login) se manda a cerrarSesionApp',
      esperado: 'la sesión nueva sigue siendo válida — cerrarSesionApp con un token ya inválido no debe afectarla',
      obtenido: `validaNuevoDespues=${validaNuevoDespues.ok}`,
      pasa: validaNuevoDespues.ok === true,
    };
  },
});
