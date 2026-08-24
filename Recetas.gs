// ================================================================
// MÓDULO: RECETAS BOM (Bill of Materials)
// Archivo independiente — no modifica Codigo.gs, Principal.gs,
// Usuarios.gs ni Sesiones.gs. Todas las funciones de este archivo son
// globales dentro del mismo proyecto de Apps Script, así que pueden
// llamarse desde cualquier lado (y este archivo reutiliza funciones que
// ya existen, como obtenerNombreDesdeToken, registrarAuditoria y
// normalizarTexto_, sin necesidad de copiarlas).
//
// Fuente maestra: hoja RECETAS, columnas A-F ya existentes:
//   A=Receta (solo en la primera fila del bloque) | B=Ingrediente |
//   C=Cantidad Neta | D=UDM | E=Rendimiento (solo 1a fila) |
//   F=Categoría (solo 1a fila)
//
// Única columna nueva agregada: G=Estado (ACTIVA/INACTIVA, solo en la
// 1a fila del bloque) — necesaria para que activar/inactivar persista
// entre recargas, tal como pide el punto 10 y el caso de éxito 11 del
// documento. Se crea sola la primera vez que se use.
//
// El "código" (REC-0001, REC-0002...) NO se guarda en la hoja — se
// calcula por posición cada vez que se lee, tal como pide el punto 5
// ("no modificar columnas A-F solo para introducir el código").
// ================================================================

function obtenerHojaRecetas_(){
  const hoja = SpreadsheetApp.getActive().getSheetByName("RECETAS");
  if(!hoja) throw new Error("No existe la hoja RECETAS.");
  return hoja;
}

/**
 * FASE 1/2 — Lee toda la hoja RECETAS y arma los bloques (una receta =
 * varias filas). Devuelve la fila exacta donde empieza y termina cada
 * bloque, para poder editarlo completo después (punto 20).
 */
function obtenerBloquesRecetas_(){

  const hoja = obtenerHojaRecetas_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues(); // A..G

  const bloques = [];
  let actual = null;
  let contador = 0;

  datos.forEach((f, i) => {

    const fila = i + 2;
    const nombre = String(f[0]||"").trim();
    const ingrediente = String(f[1]||"").trim();

    if(nombre){

      if(actual) bloques.push(actual);
      contador++;

      actual = {
        filaInicio: fila,
        filaFin: fila,
        nombre: nombre,
        codigo: "REC-" + Utilities.formatString("%04d", contador),
        rendimiento: String(f[4]||"").trim(),
        categoria: String(f[5]||"").trim(),
        estado: String(f[6]||"").trim().toUpperCase() === "INACTIVA" ? "INACTIVA" : "ACTIVA",
        ingredientes: []
      };

      if(ingrediente){
        actual.ingredientes.push({ fila: fila, nombre: ingrediente, cantidad: Number(f[2])||0, udm: String(f[3]||"").trim() });
      }

    } else if(ingrediente && actual){
      actual.filaFin = fila;
      actual.ingredientes.push({ fila: fila, nombre: ingrediente, cantidad: Number(f[2])||0, udm: String(f[3]||"").trim() });
    }

  });

  if(actual) bloques.push(actual);

  return bloques;

}

function bloqueAResumen_(b){
  return {
    nombre: b.nombre, codigo: b.codigo, rendimiento: b.rendimiento,
    categoria: b.categoria, estado: b.estado, totalIngredientes: b.ingredientes.length
  };
}

// ---------------- FASE 1/3: catálogo, búsqueda y filtros ----------------

function obtenerRecetasApp(token){
  requerirSesionActivaApp_(token);
  return obtenerBloquesRecetas_().map(bloqueAResumen_);
}

function buscarRecetasApp(texto, token){
  requerirSesionActivaApp_(token);
  const busqueda = normalizarTexto_(texto);
  if(!busqueda) return obtenerRecetasApp(token);
  return obtenerRecetasApp(token).filter(r =>
    normalizarTexto_(r.nombre).indexOf(busqueda) !== -1 ||
    normalizarTexto_(r.codigo).indexOf(busqueda) !== -1
  );
}

function obtenerCategoriasRecetasApp(token){
  requerirSesionActivaApp_(token);
  const categorias = {};
  obtenerBloquesRecetas_().forEach(b => { if(b.categoria) categorias[b.categoria] = true; });
  return Object.keys(categorias).sort();
}

// ---------------- FASE 2: detalle de una receta ----------------

// Versión interna sin guard propio — para composición desde otros
// módulos que ya validaron su propia sesión (ver RequisicionesRecetas.gs).
// La pública (abajo) es la única que debe llamarse desde el cliente.
function obtenerDetalleRecetaApp_(nombreReceta){

  const bloque = obtenerBloquesRecetas_().find(b => b.nombre === nombreReceta);
  if(!bloque) throw new Error("No se encontró la receta " + nombreReceta);

  return {
    nombre: bloque.nombre,
    codigo: bloque.codigo,
    rendimiento: bloque.rendimiento,
    categoria: bloque.categoria,
    estado: bloque.estado,
    ingredientes: bloque.ingredientes.map(ing => ({ nombre: ing.nombre, cantidad: ing.cantidad, udm: ing.udm }))
  };

}

function obtenerDetalleRecetaApp(nombreReceta, token){
  requerirSesionActivaApp_(token);
  return obtenerDetalleRecetaApp_(nombreReceta);
}

// ---------------- FASE 21: buscar producto para agregar como ingrediente ----------------
// Reutiliza el catálogo de MATRIZ igual que Compras/Requisiciones — no
// se duplica lógica, solo se envuelve para dar nombre claro al módulo.

function buscarProductoParaRecetaApp(texto, token){
  requerirSesionActivaApp_(token);
  return buscarProductoCatalogoApp(texto, token);
}

// ---------------- Validación compartida (punto 23) ----------------

function validarDatosReceta_(datos){

  const nombre = String(datos.nombre||"").trim();
  if(!nombre) throw new Error("El nombre de la receta es obligatorio.");

  const rendimiento = String(datos.rendimiento||"").trim();
  if(!rendimiento) throw new Error("Captura el rendimiento de la receta.");

  const categoria = String(datos.categoria||"").trim();
  if(!categoria) throw new Error("Captura la categoría de la receta.");

  const ingredientes = (datos.ingredientes||[])
    .map(i => ({ nombre: String(i.nombre||"").trim(), cantidad: Number(i.cantidad)||0, udm: String(i.udm||"").trim() }))
    .filter(i => i.nombre && i.cantidad > 0 && i.udm);

  if(!ingredientes.length){
    throw new Error("Agrega al menos un ingrediente con nombre, cantidad mayor a 0 y UDM.");
  }

  return { nombre: nombre, rendimiento: rendimiento, categoria: categoria, ingredientes: ingredientes };

}

// ---------------- FASE 4: crear receta ----------------

function crearRecetaApp(datos, token){

  requerirNoConsultaApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const validos = validarDatosReceta_(datos);

  const bloques = obtenerBloquesRecetas_();
  if(bloques.some(b => b.nombre.toUpperCase() === validos.nombre.toUpperCase())){
    throw new Error("Ya existe una receta con ese nombre.");
  }

  const hoja = obtenerHojaRecetas_();

  // Si la hoja todavía no tiene el encabezado de la columna G (Estado),
  // se lo ponemos la primera vez, sin tocar A-F.
  if(hoja.getRange(1, 7).getValue() === ""){
    hoja.getRange(1, 7).setValue("Estado");
    hoja.getRange(1, 7).setFontWeight("bold");
  }

  const filas = validos.ingredientes.map((ing, i) => {
    if(i === 0){
      return [validos.nombre, ing.nombre, ing.cantidad, ing.udm, validos.rendimiento, validos.categoria, "ACTIVA"];
    }
    return ["", ing.nombre, ing.cantidad, ing.udm, "", "", ""];
  });

  hoja.getRange(hoja.getLastRow()+1, 1, filas.length, 7).setValues(filas);

  registrarAuditoria(usuario, "RECETAS", "NUEVA RECETA", validos.nombre, "", "", 0, 0,
    validos.categoria + " — " + validos.ingredientes.length + " ingrediente(s)");

  return { ok: true, nombre: validos.nombre };

}

// ---------------- FASE 5/6/19/20: editar receta (bloque completo) ----------------

function editarRecetaApp(nombreOriginal, datos, token){

  requerirNoConsultaApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const bloques = obtenerBloquesRecetas_();
  const bloque = bloques.find(b => b.nombre === nombreOriginal);
  if(!bloque) throw new Error("No se encontró la receta " + nombreOriginal);

  const validos = validarDatosReceta_(datos);

  if(validos.nombre.toUpperCase() !== nombreOriginal.toUpperCase() &&
     bloques.some(b => b.nombre.toUpperCase() === validos.nombre.toUpperCase())){
    throw new Error("Ya existe otra receta con ese nombre.");
  }

  const hoja = obtenerHojaRecetas_();
  const filasActuales = bloque.filaFin - bloque.filaInicio + 1;
  const filasNuevas = validos.ingredientes.length;

  const nuevoBloque = validos.ingredientes.map((ing, i) => {
    if(i === 0){
      return [validos.nombre, ing.nombre, ing.cantidad, ing.udm, validos.rendimiento, validos.categoria, bloque.estado];
    }
    return ["", ing.nombre, ing.cantidad, ing.udm, "", "", ""];
  });

  // Se reescribe el bloque COMPLETO siempre — nunca solo la primera fila —
  // para evitar ingredientes viejos mezclados (punto 20).
  if(filasNuevas === filasActuales){
    hoja.getRange(bloque.filaInicio, 1, filasNuevas, 7).setValues(nuevoBloque);
  } else if(filasNuevas < filasActuales){
    hoja.getRange(bloque.filaInicio, 1, filasNuevas, 7).setValues(nuevoBloque);
    hoja.deleteRows(bloque.filaInicio + filasNuevas, filasActuales - filasNuevas);
  } else {
    hoja.insertRowsAfter(bloque.filaFin, filasNuevas - filasActuales);
    hoja.getRange(bloque.filaInicio, 1, filasNuevas, 7).setValues(nuevoBloque);
  }

  registrarAuditoria(usuario, "RECETAS", "RECETA EDITADA", validos.nombre, "", "", 0, 0,
    (nombreOriginal !== validos.nombre ? "Renombrada de " + nombreOriginal + " — " : "") +
    filasActuales + " ing. → " + filasNuevas + " ing.");

  return { ok: true, nombre: validos.nombre };

}

// ---------------- FASE 7: activar / inactivar ----------------

function cambiarEstadoRecetaApp(nombreReceta, nuevoEstado, token){

  requerirNoConsultaApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const bloque = obtenerBloquesRecetas_().find(b => b.nombre === nombreReceta);
  if(!bloque) throw new Error("No se encontró la receta " + nombreReceta);

  const estado = String(nuevoEstado||"").trim().toUpperCase() === "INACTIVA" ? "INACTIVA" : "ACTIVA";

  const hoja = obtenerHojaRecetas_();
  if(hoja.getRange(1, 7).getValue() === ""){
    hoja.getRange(1, 7).setValue("Estado");
    hoja.getRange(1, 7).setFontWeight("bold");
  }
  hoja.getRange(bloque.filaInicio, 7).setValue(estado);

  registrarAuditoria(usuario, "RECETAS", "CAMBIO DE ESTADO", nombreReceta, "", "", 0, 0, "Ahora: " + estado);

  return { ok: true, estado: estado };

}