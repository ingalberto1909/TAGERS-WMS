
function obtenerHojaProduccion_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("PRODUCCION");
  if(!hoja){
    hoja = ss.insertSheet("PRODUCCION");
    hoja.getRange(1, 1, 1, 14).setValues([[
      "Folio Lote", "Fecha elaboración", "Fecha caducidad",
      "Código receta", "Receta", "Código producto", "Producto",
      "Requisición origen", "Cantidad producida", "UDM",
      "Cantidad disponible", "Estado", "Usuario", "Observaciones"
    ]]);
    hoja.getRange(1, 1, 1, 14).setFontWeight("bold");
  }
  return hoja;
}

// PROD-01: columnas O/P agregadas después — mismo patrón de encabezado
// perezoso que DETALLE_OC (Presentación/Piezas) y ORDENES_COMPRA
// (Descuento/IVA/Flete): no se reescribe obtenerHojaProduccion_ para no
// afectar hojas PRODUCCION ya creadas por instalaciones existentes.
function asegurarEncabezadosCosteoProduccion_(hoja){
  if(hoja.getRange(1, 15).getValue() === ""){
    hoja.getRange(1, 15, 1, 2).setValues([["Valor insumos consumidos", "Costo unitario producido"]]);
    hoja.getRange(1, 15, 1, 2).setFontWeight("bold");
  }
}

// PROD-02: columnas Q/R/S agregadas después, mismo patrón perezoso.
function asegurarEncabezadosMermaProduccion_(hoja){
  if(hoja.getRange(1, 17).getValue() === ""){
    hoja.getRange(1, 17, 1, 3).setValues([["Rendimiento esperado", "Merma de producción", "Merma %"]]);
    hoja.getRange(1, 17, 1, 3).setFontWeight("bold");
  }
}

function generarFolioLote_(hoja, fecha){
  const fechaCodigo = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyyMMdd");
  let consecutivo = 1;
  if(hoja.getLastRow() > 1){
    const folios = hoja.getRange(2, 1, hoja.getLastRow()-1, 1).getValues().flat();
    consecutivo = folios.filter(function(f){ return f.toString().includes("PROD-"+fechaCodigo); }).length + 1;
  }
  return "PROD-" + fechaCodigo + "-" + Utilities.formatString("%03d", consecutivo);
}

function obtenerRequisicionListaParaProduccionApp(folio, token){
  // Producción es de las pocas pantallas a las que CONSULTA sí tiene
  // acceso (y no está atado a una sola área como Cocina/Panadería), así
  // que aquí NO se restringe por área — pero SÍ se exige siempre una
  // sesión activa y válida (antes esto solo se exigía cuando llegaba
  // token, dejando pasar sin ninguna validación a quien lo omitiera).
  requerirSesionActivaApp_(token);
  // Se llama con obtenerDetalleRequisicionRecetaApp_ (la versión interna)
  // sin pasar token: así nunca filtra por área, manteniendo el acceso de
  // Producción a cualquier área (ver comentario arriba) — la sesión ya
  // quedó validada en la línea de arriba.
  const detalle = obtenerDetalleRequisicionRecetaApp_(folio);
  if(detalle.estado !== "ENTREGADA"){
    throw new Error("La requisición " + folio + " todavía no tiene los insumos entregados — confírmala primero.");
  }
  return detalle;
}

function registrarProduccionApp(datos, token){

  requerirAccesoAlmacenApp_(token);

  const folioRequisicion = String((datos && datos.folioRequisicion) || "").trim();
  if(!folioRequisicion){
    throw new Error("Indica la requisición de receta de origen.");
  }

  const requisicion = obtenerRequisicionListaParaProduccionApp(folioRequisicion, token);

  const nombreReceta = String((datos && datos.nombreReceta) || "").trim();
  const receta = requisicion.recetas.find(function(r){ return r.nombreReceta === nombreReceta; });
  if(!receta){
    throw new Error("Esa receta no forma parte de la requisición " + folioRequisicion + ".");
  }

  const cantidadProducida = Number(datos && datos.cantidadProducida) || 0;
  if(cantidadProducida <= 0){
    throw new Error("Captura una cantidad producida mayor a cero.");
  }

  const codigoProducto = String((datos && datos.codigoProducto) || "").trim();
  const filaMatriz = buscarFilaMatrizPorCodigo_(codigoProducto);
  if(filaMatriz === -1){
    throw new Error("El código " + codigoProducto + " no existe en MATRIZ — créalo primero como producto terminado.");
  }

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  // ARQ-03: se lee hasta la columna R (18) para tener también el costo
  // actual del producto terminado ANTES de esta producción — el resto de
  // la función solo usaba hasta la K (11), aquí se amplía sin afectar
  // nada de lo que ya leía (mismo criterio que buscarProductoEnMatrizPorNombre_).
  const filaDatos = matriz.getRange(filaMatriz, 1, 1, 18).getValues()[0];
  const nombreProducto = filaDatos[0];
  const udm = String((datos && datos.udm) || "").trim() || filaDatos[1] || "";
  const ubicacionMatriz = filaDatos[9] || "";
  const existenciaAntesProduccion = Number(filaDatos[10]) || 0;
  const costoAntesProduccion = Number(filaDatos[17]) || 0;

  const usuario = obtenerNombreDesdeToken(token);
  const fecha = new Date();
  const hoja = obtenerHojaProduccion_();
  const fechaCaducidad = (datos && datos.fechaCaducidad) || "";

  // PROD-01: costeo del lote — reutiliza calcularCostoRecetaApp_ (Recetas.gs),
  // que ya reusa buscarProductoEnMatrizPorNombre_/factorConversionUDM_ de
  // RequisicionesRecetas.gs, sin duplicar esa búsqueda. costoTotal es el
  // costo de UNA tanda de la receta; se multiplica por las tandas
  // solicitadas en la requisición (receta.cantidadSolicitada) para obtener
  // el valor total de insumos consumidos en este lote, y se divide entre
  // la cantidad realmente producida para el costo unitario del producto.
  const costeo = calcularCostoRecetaApp_(receta.nombreReceta);
  const valorInsumosConsumidos = Math.round(costeo.costoTotal * receta.cantidadSolicitada * 100) / 100;
  const costoUnitarioProducido = Math.round((valorInsumosConsumidos / cantidadProducida) * 100) / 100;

  // PROD-02: rendimiento teórico vs. real — reutiliza parsearRendimiento_
  // (RequisicionesRecetas.gs), que ya interpreta el texto libre de
  // RECETAS.Rendimiento (p. ej. "20 piezas") sin migrar esa columna a un
  // esquema numérico. rendimientoEsperadoTotal = rendimiento de UNA tanda
  // × las tandas solicitadas en la requisición; si el texto no trae un
  // número reconocible, no se calcula merma (0/valores nulos) en vez de
  // inventar un dato.
  const rendimiento = parsearRendimiento_(receta.rendimiento);
  const rendimientoEsperadoTotal = Math.round(rendimiento.valor * receta.cantidadSolicitada * 1000) / 1000;
  const mermaProduccion = rendimientoEsperadoTotal > 0 ? Math.max(0, Math.round((rendimientoEsperadoTotal - cantidadProducida) * 1000) / 1000) : 0;
  const mermaPorcentaje = rendimientoEsperadoTotal > 0 ? Math.round((mermaProduccion / rendimientoEsperadoTotal) * 10000) / 100 : 0;

  let folioLote;

  conBloqueoApp_(function(){

    folioLote = generarFolioLote_(hoja, fecha);
    asegurarEncabezadosCosteoProduccion_(hoja);
    asegurarEncabezadosMermaProduccion_(hoja);

    hoja.appendRow([
      folioLote, fecha, fechaCaducidad,
      receta.codigoReceta, receta.nombreReceta, codigoProducto, nombreProducto,
      folioRequisicion, cantidadProducida, udm,
      cantidadProducida, "ACTIVO", usuario, (datos && datos.observaciones) || "",
      valorInsumosConsumidos, costoUnitarioProducido,
      rendimientoEsperadoTotal, mermaProduccion, mermaPorcentaje
    ]);

  });

  // Fase 7: obtenerLotesProximosACaducarApp ahora lee PRODUCCION vía la
  // caché de 20s (ver Inteligencia.gs) — sin esto, un lote recién
  // registrado no aparecería en el Dashboard hasta que la caché expirara
  // sola. Mismo criterio que ya usa registrarEntradaInterna_ con KARDEX.
  invalidarCacheHoja_("PRODUCCION");

  registrarEntradaInterna_(
    {
      codigo: codigoProducto, producto: nombreProducto, cantidad: cantidadProducida,
      udm: udm, ubicacion: (datos && datos.ubicacion) || ubicacionMatriz,
      lote: folioLote, caducidad: fechaCaducidad
    },
    usuario, folioLote,
    "Producción — Lote " + folioLote + " (Requisición " + folioRequisicion + ")"
  );

  registrarAuditoria(usuario, "PRODUCCION", "LOTE REGISTRADO", folioLote, "", "", 0, cantidadProducida,
    receta.nombreReceta + " — " + cantidadProducida + " " + udm + " (Requisición " + folioRequisicion + ")");

  // PROD-01/ARQ-03: solo se actualiza el costo del producto terminado en
  // MATRIZ (mismo mecanismo que usa la recepción de OC, ver
  // procesarCambioPrecioProducto_) cuando TODOS los ingredientes de la
  // receta tuvieron costo/conversión conocidos — con datos incompletos se
  // guarda el costeo del lote para referencia, pero no se sobreescribe el
  // costo maestro del producto. El costo que se escribe en MATRIZ es el
  // PROMEDIO PONDERADO entre lo que ya había en existencia (a su costo
  // actual) y este lote (a su costoUnitarioProducido) — no el costo del
  // lote solo, que sigue guardado tal cual en PRODUCCION para referencia.
  if(costeo.ingredientesSinCosto === 0 && costoUnitarioProducido > 0){
    const costoPromedio = calcularCostoPromedioPonderado_(existenciaAntesProduccion, costoAntesProduccion, cantidadProducida, costoUnitarioProducido);
    procesarCambioPrecioProducto_(codigoProducto, nombreProducto, "PRODUCCIÓN INTERNA", costoPromedio, usuario, folioLote);
  }

  return { folio: folioLote, producto: nombreProducto, cantidadProducida: cantidadProducida };

}

/**
 * Autocompletar "Código de producto terminado" al elegir una receta en
 * el formulario de Registrar Producción: RECETAS no guarda ningún
 * vínculo hacia el producto terminado en MATRIZ (columnas A-G, ver
 * Recetas.gs), pero el producto terminado de cada receta ya existe en
 * MATRIZ con el MISMO nombre (confirmado por el usuario) — así que se
 * busca directo por nombre, sin depender de si esa receta ya se produjo
 * antes. Usa normalizarTexto_ (mayúsculas, sin acentos, sin espacios de
 * más) para que un match exacto no falle por diferencias de formato. Si
 * ningún producto de MATRIZ tiene ese nombre, regresa null y el usuario
 * sigue pudiendo escanear/escribir el código a mano, como ya funcionaba.
 */
function obtenerProductoTerminadoPorNombreRecetaApp(nombreReceta, token){

  requerirSesionActivaApp_(token);

  const nombreNormalizado = normalizarTexto_(nombreReceta);
  if(!nombreNormalizado) return null;

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datos = matriz.getDataRange().getValues();

  for(let i = 1; i < datos.length; i++){
    if(normalizarTexto_(datos[i][0]) === nombreNormalizado){
      return {
        codigoProducto: String(datos[i][4] || "").trim(),
        producto: datos[i][0],
        udm: datos[i][1],
        ubicacion: datos[i][9]
      };
    }
  }

  return null;

}

function obtenerLotesProduccionApp(filtros, token){
  requerirSesionActivaApp_(token);
  const hoja = obtenerHojaProduccion_();
  if(hoja.getLastRow() < 2) return [];

  // PROD-01/PROD-02: las columnas O..S (costeo/merma) pueden no existir
  // todavía en hojas PRODUCCION con lotes registrados antes de estas fases
  // — se lee solo hasta donde exista la hoja (mismo patrón que
  // obtenerTipoRequisicionApp).
  const ancho = Math.min(hoja.getLastColumn(), 19);
  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, ancho).getValues();
  const codigoFiltro = (filtros && filtros.codigoProducto) ? String(filtros.codigoProducto).trim() : "";
  const estadoFiltro = (filtros && filtros.estado) ? String(filtros.estado).trim().toUpperCase() : "";

  return datos
    .filter(function(f){
      return (!codigoFiltro || String(f[5]).trim() === codigoFiltro) &&
             (!estadoFiltro || String(f[11]).trim().toUpperCase() === estadoFiltro);
    })
    .map(function(f){
      return {
        folio: f[0],
        fechaElaboracion: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : f[1],
        fechaCaducidad: f[2] instanceof Date ? Utilities.formatDate(f[2], Session.getScriptTimeZone(), "dd/MM/yyyy") : f[2],
        codigoReceta: f[3], receta: f[4], codigoProducto: f[5], producto: f[6],
        requisicionOrigen: f[7], cantidadProducida: Number(f[8])||0, udm: f[9],
        cantidadDisponible: Number(f[10])||0, estado: f[11], usuario: f[12], observaciones: f[13],
        valorInsumosConsumidos: Number(f[14])||0, costoUnitarioProducido: Number(f[15])||0,
        rendimientoEsperadoTotal: Number(f[16])||0, mermaProduccion: Number(f[17])||0, mermaPorcentaje: Number(f[18])||0
      };
    })
    .reverse();
}

/**
 * PROD-04 (auditoría comparativa vs. MarketMan, Fase 4): trazabilidad de
 * lote HACIA ADELANTE — dado un folio de lote de producción, muestra a
 * dónde salieron sus unidades. Se apoya en la columna Lote de SALIDA, que
 * registrarSalidaInterna_ ya sabía escribir desde siempre (la usa la
 * pantalla de Salidas manual) pero que confirmarEntregaRequisicionApp
 * nunca llenaba — ahora acepta un lote opcional por línea (mismo
 * campo/UX que Salidas manual), así que esas entregas también quedan
 * enlazadas al lote real cuando Almacén lo anota.
 *
 * No es trazabilidad completa/obligatoria (MATRIZ sigue siendo existencia
 * agregada por código, no un libro por lote) — es la mejor información
 * disponible con lo que el sistema ya captura: toda salida donde SÍ se
 * anotó el lote aparece aquí; lo que salió sin anotarlo se reporta aparte
 * como "sin rastrear" en vez de inventarse a qué lote perteneció.
 */
function obtenerTrazabilidadLoteApp(folioLote, token){

  requerirSesionActivaApp_(token);

  folioLote = String(folioLote||"").trim();
  if(!folioLote){
    throw new Error("Indica el folio del lote.");
  }

  const hojaProduccion = obtenerHojaProduccion_();
  if(hojaProduccion.getLastRow() < 2){
    throw new Error("No se encontró el lote " + folioLote);
  }

  const datosProduccion = hojaProduccion.getRange(2, 1, hojaProduccion.getLastRow()-1, 12).getValues();
  let lote = null;

  for(let i=0;i<datosProduccion.length;i++){
    if(String(datosProduccion[i][0]) === folioLote){
      lote = {
        folio: datosProduccion[i][0],
        codigoProducto: String(datosProduccion[i][5]||"").trim(),
        producto: datosProduccion[i][6],
        cantidadProducida: Number(datosProduccion[i][8]) || 0,
        udm: datosProduccion[i][9],
        estado: datosProduccion[i][11]
      };
      break;
    }
  }

  if(!lote){
    throw new Error("No se encontró el lote " + folioLote);
  }

  const salida = SpreadsheetApp.getActive().getSheetByName("SALIDA");
  const movimientos = [];
  let unidadesRastreadas = 0;

  if(salida && salida.getLastRow() > 1){
    const datosSalida = salida.getRange(2, 1, salida.getLastRow()-1, 11).getValues();
    datosSalida.forEach(function(f){
      const codigoFila = String(f[3]||"").trim();
      const loteFila = String(f[8]||"").trim();
      if(codigoFila !== lote.codigoProducto || loteFila !== folioLote) return;
      const cantidad = Number(f[5]) || 0;
      unidadesRastreadas += cantidad;
      movimientos.push({
        fecha: f[2] instanceof Date ? Utilities.formatDate(f[2], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : String(f[2]||""),
        cantidad: cantidad,
        udm: f[6],
        area: f[7] || "",
        ubicacion: f[10] || ""
      });
    });
  }

  unidadesRastreadas = Math.round(unidadesRastreadas * 1000) / 1000;

  return {
    lote: lote,
    movimientos: movimientos.sort(function(a,b){ return a.fecha < b.fecha ? 1 : -1; }),
    unidadesRastreadas: unidadesRastreadas,
    unidadesSinRastrear: Math.max(0, Math.round((lote.cantidadProducida - unidadesRastreadas) * 1000) / 1000)
  };

}

/**
 * Fase 3e (auditoría comparativa vs. MarketMan): costo real por receta —
 * agrega los lotes de PRODUCCION en el periodo, ponderando el costo por
 * unidad (valorInsumosConsumidos/cantidadProducida) por cuánto se produjo
 * en cada lote. No se calcula "margen" porque TAGERS WMS no captura un
 * precio de venta en ningún lado todavía — inventar ese dato aquí sería
 * scope creep de este módulo (analítica), no de costeo.
 */
function obtenerCostoPorRecetaApp(dias, token){

  requerirSesionActivaApp_(token);

  const rangoDias = Number(dias) || 30;
  const desde = new Date();
  desde.setDate(desde.getDate() - rangoDias);

  const hoja = obtenerHojaProduccion_();
  if(hoja.getLastRow() < 2) return [];

  const ancho = Math.min(hoja.getLastColumn(), 19);
  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, ancho).getValues();

  const acumReceta = {}; // receta -> { lotes, cantidadTotal, valorTotal }

  datos.forEach(function(f){

    const fecha = f[1] instanceof Date ? f[1] : new Date(f[1]);
    if(isNaN(fecha.getTime()) || fecha < desde) return;

    const receta = String(f[4]||"").trim();
    const cantidadProducida = Number(f[8]) || 0;
    if(!receta || cantidadProducida <= 0) return;

    const valorInsumosConsumidos = Number(f[14]) || 0;

    if(!acumReceta[receta]) acumReceta[receta] = { lotes: 0, cantidadTotal: 0, valorTotal: 0 };
    acumReceta[receta].lotes++;
    acumReceta[receta].cantidadTotal += cantidadProducida;
    acumReceta[receta].valorTotal += valorInsumosConsumidos;

  });

  return Object.keys(acumReceta).map(function(receta){
    const d = acumReceta[receta];
    return {
      receta: receta,
      lotes: d.lotes,
      cantidadTotalProducida: Math.round(d.cantidadTotal * 1000) / 1000,
      valorTotalInsumos: Math.round(d.valorTotal * 100) / 100,
      costoPromedioPorUnidad: d.cantidadTotal > 0 ? Math.round((d.valorTotal / d.cantidadTotal) * 100) / 100 : 0
    };
  }).sort(function(a,b){ return b.valorTotalInsumos - a.valorTotalInsumos; });

}

/**
 * Fase 3e: valor perdido por merma — junta las dos fuentes de merma que
 * ya existen por separado (Mermas.gs para producto dañado/caducado/etc.,
 * y PRODUCCION.MermaProduccion de PROD-02 para rendimiento no alcanzado)
 * en un solo total, sin recalcular ninguna de las dos por su cuenta. La
 * merma de producción se valoriza al costoUnitarioProducido DE CADA LOTE
 * (no al costo promedio actual de MATRIZ) porque es el costo real de ESE
 * lote específico.
 */
function obtenerValorPerdidoPorMermaApp(dias, token){

  requerirSesionActivaApp_(token);

  const rangoDias = Number(dias) || 30;
  const desde = new Date();
  desde.setDate(desde.getDate() - rangoDias);

  const desdeStr = Utilities.formatDate(desde, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const mermaRegular = obtenerResumenMermasApp(desdeStr, "", token);

  const hoja = obtenerHojaProduccion_();
  let valorMermaProduccion = 0;
  let lotesConMerma = 0;

  if(hoja.getLastRow() >= 2){
    const ancho = Math.min(hoja.getLastColumn(), 19);
    const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, ancho).getValues();
    datos.forEach(function(f){
      const fecha = f[1] instanceof Date ? f[1] : new Date(f[1]);
      if(isNaN(fecha.getTime()) || fecha < desde) return;
      const mermaProduccion = Number(f[17]) || 0;
      if(mermaProduccion <= 0) return;
      const costoUnitarioProducido = Number(f[15]) || 0;
      valorMermaProduccion += mermaProduccion * costoUnitarioProducido;
      lotesConMerma++;
    });
  }

  valorMermaProduccion = Math.round(valorMermaProduccion * 100) / 100;

  return {
    mermaRegular: mermaRegular,
    mermaProduccion: { lotesConMerma: lotesConMerma, valorTotal: valorMermaProduccion },
    valorTotalPerdido: Math.round((mermaRegular.valorTotal + valorMermaProduccion) * 100) / 100
  };

}

function cerrarLoteProduccionApp(folioLote, token){

  requerirAccesoAlmacenApp_(token);

  const hoja = obtenerHojaProduccion_();
  if(hoja.getLastRow() < 2) throw new Error("No hay lotes registrados.");

  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, 1).getValues();
  let fila = -1;
  datos.forEach(function(f, i){ if(String(f[0]) === String(folioLote)) fila = i + 2; });

  if(fila === -1) throw new Error("No se encontró el lote " + folioLote);

  hoja.getRange(fila, 12).setValue("AGOTADO"); // L = Estado
  hoja.getRange(fila, 11).setValue(0);         // K = Cantidad disponible
  invalidarCacheHoja_("PRODUCCION");

  const usuario = obtenerNombreDesdeToken(token);
  registrarAuditoria(usuario, "PRODUCCION", "LOTE CERRADO", folioLote, "", "", 0, 0, "Marcado como AGOTADO");

  return { ok: true };

}