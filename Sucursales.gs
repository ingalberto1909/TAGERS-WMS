// ============================================
// Catálogo de Sucursales (administración) — petición explícita del
// usuario tras la auditoría maestra: antes, "sucursal" solo existía como
// texto en USUARIOS.Sucursal/EXISTENCIAS_SUCURSAL.Sucursal, descubierto
// al vuelo por obtenerSucursalesConocidasApp (📁 App.gs.gs) — sin catálogo
// real, un typo de captura podía crear una "sucursal fantasma" sin que
// nadie lo notara. Este archivo agrega una hoja SUCURSALES real (Código,
// Nombre, Estado) con alta/edición/baja desde la web app, solo ADMIN.
//
// Diseño no invasivo a propósito:
//   - La hoja NO se crea sola en segundo plano — se crea (y se siembra
//     una sola vez con los códigos reales ya en uso) la primera vez que
//     un ADMIN abre la pantalla de Sucursales. Hasta entonces, CERO
//     cambio de comportamiento en el resto del sistema.
//   - obtenerSucursalesConocidasApp (📁 App.gs.gs) se modificó para, SI
//     la hoja SUCURSALES ya existe, regresar solo las sucursales ACTIVAS
//     del catálogo — así Transferencias y Devoluciones (los 2 selectores
//     reales que ya usan esa función) automáticamente dejan de ofrecer
//     una sucursal que un ADMIN dio de baja, sin tocar esas 2 pantallas.
//     Si la hoja no existe todavía, el comportamiento es exactamente el
//     de antes (descubrir códigos reales en uso).
//   - Nunca se borra una fila físicamente (soft-delete vía Estado, mismo
//     criterio que USUARIOS) — y nunca se permite desactivar S01 (el
//     almacén/CEDIS principal, SUCURSAL_DEFAULT_ en 📁 App.gs.gs), porque
//     buena parte del motor de existencia lo asume siempre disponible.
// ============================================

const SUCURSALES_HOJA_ = "SUCURSALES";

function requerirAccesoSucursalesApp_(token){
  requerirSesionActivaApp_(token);
  const rol = String(obtenerRolDesdeToken(token) || "").toUpperCase();
  if(rol !== "ADMIN"){
    throw new Error("Solo un administrador puede administrar el catálogo de sucursales.");
  }
}

/** Nombre amigable por default al sembrar el catálogo por primera vez — el ADMIN lo puede renombrar después. */
function nombreSucursalPorDefecto_(codigo){
  if(codigo === SUCURSAL_DEFAULT_) return "Almacén Principal (" + SUCURSAL_DEFAULT_ + ")";
  return "Sucursal " + codigo;
}

/**
 * Crea la hoja SUCURSALES si no existe todavía, sembrándola una sola vez
 * con los códigos reales ya en uso (misma fuente que obtenerSucursalesConocidasApp
 * usaba antes de tener catálogo). Si ya existe, no la vuelve a tocar —
 * después de la siembra inicial, el catálogo es la única fuente de verdad,
 * no se vuelve a escanear USUARIOS/EXISTENCIAS_SUCURSAL automáticamente.
 */
function asegurarHojaSucursales_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName(SUCURSALES_HOJA_);
  if(hoja) return hoja;

  hoja = ss.insertSheet(SUCURSALES_HOJA_);
  hoja.appendRow(["Código", "Nombre", "Estado"]);

  const codigosReales = descubrirCodigosSucursalReales_();
  codigosReales.forEach(function(codigo){
    hoja.appendRow([codigo, nombreSucursalPorDefecto_(codigo), "ACTIVO"]);
  });

  return hoja;
}

function buscarFilaSucursalPorCodigo_(hoja, codigo){
  if(hoja.getLastRow() < 2) return -1;
  const codigos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
  const buscado = String(codigo || "").trim().toUpperCase();
  for(let i = 0; i < codigos.length; i++){
    if(String(codigos[i][0]).trim().toUpperCase() === buscado) return i + 2;
  }
  return -1;
}

/** Lista completa (ACTIVO e INACTIVO) para la pantalla de administración. */
function obtenerSucursalesApp(token){
  requerirAccesoSucursalesApp_(token);

  const hoja = asegurarHojaSucursales_();
  if(hoja.getLastRow() < 2) return [];

  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 3).getValues().map(function(f){
    return { codigo: f[0], nombre: f[1], estado: f[2] || "ACTIVO" };
  });
}

function crearSucursalApp(datos, token){
  requerirAccesoSucursalesApp_(token);
  datos = datos || {};

  const codigo = String(datos.codigo || "").trim().toUpperCase();
  const nombre = String(datos.nombre || "").trim();

  if(!codigo) throw new Error("Captura el código de la sucursal (ej. S02).");
  if(codigo === SUCURSAL_TODAS_) throw new Error('"' + SUCURSAL_TODAS_ + '" es un valor reservado del sistema (vista consolidada), no puede darse de alta como sucursal.');
  if(!nombre) throw new Error("Captura el nombre de la sucursal.");

  const hoja = asegurarHojaSucursales_();
  if(buscarFilaSucursalPorCodigo_(hoja, codigo) !== -1){
    throw new Error('Ya existe una sucursal con el código "' + codigo + '".');
  }

  conBloqueoApp_(function(){
    hoja.appendRow([codigo, nombre, "ACTIVO"]);
  });

  const usuario = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuario, "SUCURSALES", "SUCURSAL CREADA", "", codigo, nombre, 0, 0, "");

  return { ok: true, codigo: codigo };
}

/** Edita solo el Nombre — el Código es la clave que referencian USUARIOS/EXISTENCIAS_SUCURSAL y no se permite renombrar para no huerfanar esas referencias. */
function editarSucursalApp(codigo, datos, token){
  requerirAccesoSucursalesApp_(token);
  const nombre = String((datos || {}).nombre || "").trim();
  if(!nombre) throw new Error("Captura el nombre de la sucursal.");

  const hoja = asegurarHojaSucursales_();
  const fila = buscarFilaSucursalPorCodigo_(hoja, codigo);
  if(fila === -1) throw new Error('No se encontró la sucursal "' + codigo + '".');

  const nombreAnterior = hoja.getRange(fila, 2).getValue();
  hoja.getRange(fila, 2).setValue(nombre);

  const usuario = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuario, "SUCURSALES", "SUCURSAL EDITADA", "", codigo, nombre, 0, 0,
    'Nombre anterior: "' + nombreAnterior + '"');

  return { ok: true };
}

/** Alta/baja (soft-delete) — nunca se borra la fila, y nunca se permite desactivar la sucursal por defecto (S01). */
function cambiarEstadoSucursalApp(codigo, nuevoEstado, token){
  requerirAccesoSucursalesApp_(token);
  const estado = String(nuevoEstado || "").trim().toUpperCase();
  if(estado !== "ACTIVO" && estado !== "INACTIVO"){
    throw new Error("Estado inválido.");
  }
  const codigoNormalizado = String(codigo || "").trim().toUpperCase();
  if(estado === "INACTIVO" && codigoNormalizado === SUCURSAL_DEFAULT_){
    throw new Error("No se puede dar de baja " + SUCURSAL_DEFAULT_ + " — es el almacén principal y el sistema lo asume siempre disponible.");
  }

  const hoja = asegurarHojaSucursales_();
  const fila = buscarFilaSucursalPorCodigo_(hoja, codigo);
  if(fila === -1) throw new Error('No se encontró la sucursal "' + codigo + '".');

  hoja.getRange(fila, 3).setValue(estado);

  const usuario = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuario, "SUCURSALES", "SUCURSAL " + (estado === "ACTIVO" ? "ACTIVADA" : "DESACTIVADA"), "", codigoNormalizado, "", 0, 0, "");

  return { ok: true };
}

/**
 * Catálogo para poblar selectores en otras pantallas (ej. alta/edición de
 * Usuario) — cualquier sesión activa puede leerlo (no requiere ser ADMIN,
 * a diferencia de administrar el catálogo). Incluye "TODAS" al final
 * porque sigue siendo un valor válido para USUARIOS.Sucursal (acceso
 * corporativo consolidado), aunque no sea una sucursal física real.
 */
function obtenerSucursalesParaSelectorApp(token){
  requerirSesionActivaApp_(token);

  const hoja = asegurarHojaSucursales_();
  const activas = hoja.getLastRow() < 2 ? [] : hoja.getRange(2, 1, hoja.getLastRow() - 1, 3)
    .getValues()
    .filter(function(f){ return String(f[2] || "ACTIVO").toUpperCase() === "ACTIVO"; })
    .map(function(f){ return { codigo: f[0], nombre: f[1] }; });

  activas.push({ codigo: SUCURSAL_TODAS_, nombre: "Todas (acceso corporativo)" });
  return activas;
}
