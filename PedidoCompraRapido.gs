// ============================================
// PEDIDO DE COMPRA RÁPIDO
// ============================================
//
// Objetivo (pedido de Alberto): el pedido semanal de ~20 productos
// recurrentes tomaba ~1 hora armando una OC a la vez por proveedor. Este
// módulo centraliza esa rutina: carga automáticamente los "productos
// habituales de compra" del día, sugiere cantidad, el usuario revisa/
// ajusta, y al confirmar se agrupan por proveedor y se generan todas las
// Órdenes de Compra de un solo golpe.
//
// TODO el archivo reutiliza la lógica de Compras que ya existe en
// "📁 App.gs.gs" — folio+lock, cálculo de importes, impuestos, estados,
// auditoría y PDF de generarOrdenCompraApp NO se reimplementan aquí, se
// llaman tal cual. Este archivo solo agrega lo que genuinamente no
// existía: la configuración de recurrencia y el "documento padre" que
// agrupa varias OC en un mismo pedido.
//
// Dos conceptos separados, dos hojas nuevas (ninguna duplica MATRIZ ni
// crea un catálogo de proveedores propio — el proveedor de cada línea
// sigue viniendo de MATRIZ columna Q, vía obtenerProveedorProducto_):
//
//   PRODUCTOS_COMPRA        — plantilla/configuración (qué se compra
//                             seguido, con qué frecuencia). Se lee, no es
//                             la ejecución de una compra.
//   PEDIDOS_COMPRA          — encabezado de cada ejecución concreta
//                             ("PEDIDO SEMANAL del lunes 7 de septiembre").
//   DETALLE_PEDIDO_COMPRA   — líneas de ese pedido (snapshot de
//                             producto/proveedor/cantidad al momento de
//                             generarlo, para que el historial no cambie
//                             si MATRIZ cambia después).
//
// Acceso: mismas reglas que el resto de Compras — requerirAccesoAlmacenApp_
// (definida en 📁 App.gs.gs), sin crear un guard de permisos paralelo.

// ============================================
// Hojas — se crean solas la primera vez que se usan (mismo patrón que
// obtenerHojaPagosOC_ en 📁 App.gs.gs).
// ============================================

function obtenerHojaProductosCompra_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("PRODUCTOS_COMPRA");
  if(!hoja){
    hoja = ss.insertSheet("PRODUCTOS_COMPRA");
    hoja.appendRow([
      "Código Producto", "Frecuencia", "Día Compra", "Modo Cantidad",
      "Cantidad Habitual", "Activo", "Prioridad", "Observaciones",
      "Fecha Alta", "Usuario Alta"
    ]);
    hoja.getRange(1, 1, 1, 10).setFontWeight("bold");
  }
  return hoja;
}

function obtenerHojaPedidosCompra_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("PEDIDOS_COMPRA");
  if(!hoja){
    hoja = ss.insertSheet("PEDIDOS_COMPRA");
    hoja.appendRow([
      "Folio", "Fecha", "Usuario", "Estado",
      "Total Productos", "Total Proveedores", "Observaciones", "OCs Generadas"
    ]);
    hoja.getRange(1, 1, 1, 8).setFontWeight("bold");
  }
  return hoja;
}

function obtenerHojaDetallePedidoCompra_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("DETALLE_PEDIDO_COMPRA");
  if(!hoja){
    hoja = ss.insertSheet("DETALLE_PEDIDO_COMPRA");
    hoja.appendRow([
      "Folio Pedido", "Código", "Producto", "Proveedor", "Existencia",
      "Sugerido", "Cantidad", "UDM", "Precio", "Origen", "Incidencia", "Folio OC"
    ]);
    hoja.getRange(1, 1, 1, 12).setFontWeight("bold");
  }
  return hoja;
}

// ============================================
// Helpers internos
// ============================================

/** Código -> fila completa de MATRIZ, una sola lectura cacheada para toda la pantalla. */
function construirMapaMatrizPorCodigo_(){
  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);
  const mapa = {};
  datos.forEach(function(f){
    const codigo = String(f[4] || "").trim();
    if(codigo) mapa[codigo] = f;
  });
  return mapa;
}

/**
 * Cuánto de cada producto ya está pedido pero aún no se ha recibido
 * (órdenes en PENDIENTE_APROBACION/PENDIENTE/PARCIAL) — para no sugerir
 * comprar de más. Mismo patrón de una sola pasada por ORDENES_COMPRA +
 * DETALLE_OC que ya usa obtenerHistorialComprasPorCodigo_
 * (AnalisisCompras.gs), pero sumando pedido-recibido de lo que sigue en
 * tránsito en vez de sumar lo ya recibido en los últimos 12 meses.
 */
function calcularEnTransitoPorCodigo_(){

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");
  const detalle = ss.getSheetByName("DETALLE_OC");

  if(!ordenes || !detalle || detalle.getLastRow() < 2) return {};

  const anchoOrdenes = Math.min(Math.max(ordenes.getLastColumn(), 7), 12);
  const datosOrdenes = ordenes.getRange(2, 1, ordenes.getLastRow() - 1, anchoOrdenes).getValues();
  const estadosPendientes = { "PENDIENTE_APROBACION": true, "PENDIENTE": true, "PARCIAL": true };

  const estadoPorOC = {};
  datosOrdenes.forEach(function(f){
    estadoPorOC[String(f[0] || "").trim().toUpperCase()] = String(f[4] || "").trim().toUpperCase();
  });

  const anchoDetalle = Math.min(detalle.getLastColumn(), 10);
  const datosDetalle = detalle.getRange(2, 1, detalle.getLastRow() - 1, anchoDetalle).getValues();

  const enTransito = {};

  datosDetalle.forEach(function(f){
    const oc = String(f[0] || "").trim().toUpperCase();
    const estado = estadoPorOC[oc];
    if(!estado || !estadosPendientes[estado]) return;

    const codigo = String(f[1] || "").trim();
    if(!codigo) return;

    const pedido = Number(f[3]) || 0;
    const recibido = Number(f[7]) || 0;
    const pendiente = Math.max(pedido - recibido, 0);
    if(pendiente <= 0) return;

    enTransito[codigo] = (enTransito[codigo] || 0) + pendiente;
  });

  return enTransito;

}

/**
 * ¿Corresponde comprar este producto habitual en "fecha"? Interpretación
 * de las frecuencias del punto 5 del pedido de Alberto:
 *   DIARIA        -> todos los días, sin importar Día Compra.
 *   SEMANAL       -> solo el día de la semana capturado (ej. LUNES).
 *   QUINCENAL     -> ese día de la semana, alternando semana sí/semana no
 *                    a partir de la semana en que se dio de alta.
 *   MENSUAL       -> ese día de la semana, solo en la primera semana del
 *                    mes (ej. "el primer lunes de cada mes").
 *   PERSONALIZADA -> Día Compra es una lista separada por comas
 *                    (ej. "LUNES,JUEVES").
 */
function coincideFrecuenciaCompra_(configFila, fecha, diaTexto){

  const frecuencia = String(configFila[1] || "").trim().toUpperCase();
  const diaCompra = String(configFila[2] || "").trim().toUpperCase();

  if(frecuencia === "DIARIA") return true;

  if(frecuencia === "PERSONALIZADA"){
    const dias = diaCompra.split(",").map(function(d){ return d.trim(); });
    return dias.indexOf(diaTexto) !== -1;
  }

  if(diaCompra !== diaTexto) return false;

  if(frecuencia === "SEMANAL") return true;

  const fechaAlta = configFila[8] instanceof Date ? configFila[8] : new Date(configFila[8]);
  if(isNaN(fechaAlta.getTime())) return true; // sin fecha de alta confiable: mejor mostrarlo que perderlo silenciosamente

  const msPorDia = 24 * 60 * 60 * 1000;
  const diasDesdeAlta = Math.floor((fecha.getTime() - fechaAlta.getTime()) / msPorDia);

  if(frecuencia === "QUINCENAL"){
    const semanasDesdeAlta = Math.floor(diasDesdeAlta / 7);
    return semanasDesdeAlta >= 0 && semanasDesdeAlta % 2 === 0;
  }

  if(frecuencia === "MENSUAL"){
    return fecha.getDate() <= 7;
  }

  return true;

}

/**
 * Cantidad sugerida a comprar (punto 6 del pedido): modo FIJA usa la
 * cantidad habitual capturada; modo MIN_MAX reutiliza el criterio
 * Máximo - Existencia - En tránsito (nunca negativo) — variante de
 * calcularSugeridoCompra_ que además descuenta lo que ya viene en camino.
 */
function calcularCantidadSugeridaPedidoRapido_(configFila, filaMatriz, enTransitoPorCodigo){

  const modo = String(configFila[3] || "").trim().toUpperCase();

  if(modo === "FIJA"){
    return Math.max(Number(configFila[4]) || 0, 0);
  }

  const existencia = Number(filaMatriz[10]) || 0;
  const maximo = Number(filaMatriz[12]) || 0;
  const codigo = String(filaMatriz[4] || "").trim();
  const enTransito = Number(enTransitoPorCodigo[codigo]) || 0;

  return Math.max(Math.round(maximo - existencia - enTransito), 0);

}

// ============================================
// FASE 2 — Configuración de productos habituales
// ============================================

const FRECUENCIAS_COMPRA_VALIDAS_ = { "DIARIA": 1, "SEMANAL": 1, "QUINCENAL": 1, "MENSUAL": 1, "PERSONALIZADA": 1 };
const DIAS_COMPRA_VALIDOS_ = { "LUNES": 1, "MARTES": 1, "MIERCOLES": 1, "JUEVES": 1, "VIERNES": 1, "SABADO": 1, "DOMINGO": 1 };

/**
 * Productos habituales que corresponde revisar HOY (o en la fecha dada),
 * ya unidos con MATRIZ en vivo (nombre, proveedor, existencia, mínimo,
 * máximo, precio) — nunca se duplican esos campos en PRODUCTOS_COMPRA,
 * así que un cambio de proveedor/precio en MATRIZ se refleja de
 * inmediato sin tener que tocar la configuración de recurrencia.
 */
function obtenerProductosHabitualesCompraApp(fechaTexto, token){

  requerirAccesoAlmacenApp_(token);

  const fecha = fechaTexto ? new Date(fechaTexto + "T00:00:00") : new Date();
  if(isNaN(fecha.getTime())) throw new Error("Fecha inválida.");

  const diaTexto = obtenerDiaActual(fecha);

  const hoja = obtenerHojaProductosCompra_();
  const mapaMatriz = construirMapaMatrizPorCodigo_();
  const enTransito = calcularEnTransitoPorCodigo_();

  const productos = [];
  const codigosIncluidos = {};

  if(hoja.getLastRow() >= 2){

    const config = hoja.getRange(2, 1, hoja.getLastRow() - 1, 10).getValues();

    config.forEach(function(c){

      const activo = String(c[5] || "").trim().toUpperCase();
      if(activo !== "SI") return; // sección 5: nunca cargar productos inactivos

      const codigo = String(c[0] || "").trim();
      if(!codigo) return;

      if(!coincideFrecuenciaCompra_(c, fecha, diaTexto)) return;

      codigosIncluidos[codigo] = true;
      const filaMatriz = mapaMatriz[codigo];

      if(!filaMatriz){
        productos.push({
          codigo: codigo, producto: "(código no encontrado en MATRIZ)",
          proveedor: "", existencia: 0, minimo: 0, maximo: 0, enTransito: 0, sugerido: 0,
          convertir: false, presentacion: 0, sugeridoPiezas: 0,
          udm: "", precio: 0, prioridad: Number(c[6]) || 0, observaciones: c[7] || "",
          origen: "HABITUAL", incidencia: "Este código ya no existe en el catálogo."
        });
        return;
      }

      const ubicacion = String(filaMatriz[9] || "").trim();
      const descontinuado = ubicacionVacia_(ubicacion);
      const proveedor = obtenerProveedorProducto_(filaMatriz);
      const sinProveedor = proveedor === SIN_PROVEEDOR_ETIQUETA_;

      // Igual que obtenerProductosPorProveedorApp (Centro de Reabastecimiento):
      // si el producto se compra por presentación (caja/paquete), "sugerido"
      // sigue en unidades reales (kg/L/pza suelta) pero el usuario captura
      // PIEZAS de la presentación — sugeridoPiezas redondea hacia arriba para
      // no quedar cortos.
      const sugerido = calcularCantidadSugeridaPedidoRapido_(c, filaMatriz, enTransito);
      const convertir = String(filaMatriz[18] || "").trim().toUpperCase() === "SI";
      const presentacion = Number(filaMatriz[19]) || 0;

      productos.push({
        codigo: codigo,
        producto: filaMatriz[0],
        udm: filaMatriz[1],
        proveedor: proveedor,
        existencia: Number(filaMatriz[10]) || 0,
        minimo: Number(filaMatriz[11]) || 0,
        maximo: Number(filaMatriz[12]) || 0,
        precio: Number(filaMatriz[17]) || 0,
        enTransito: Number(enTransito[codigo]) || 0,
        sugerido: sugerido,
        convertir: convertir && presentacion > 0,
        presentacion: presentacion,
        sugeridoPiezas: (convertir && presentacion > 0) ? Math.ceil(sugerido / presentacion) : 0,
        prioridad: Number(c[6]) || 0,
        observaciones: c[7] || "",
        origen: "HABITUAL",
        incidencia: descontinuado
          ? "Producto descontinuado (sin ubicación en MATRIZ)."
          : (sinProveedor ? "Este producto no tiene proveedor configurado." : "")
      });

    });

  }

  // Marca rápida directa en MATRIZ (columna U = "SI"): alternativa a
  // configurar frecuencia/día en PRODUCTOS_COMPRA — Alberto prefiere
  // marcar ahí mismo, en el catálogo que ya usa a diario, qué productos
  // se piden seguido cada semana. Un producto marcado así aparece SIEMPRE
  // que se abra el módulo (sin restricción de día) y, al ser un insumo
  // nuevo, basta con darle "SI" en esa columna — no hace falta registrarlo
  // aparte en Productos Habituales. No sustituye esa configuración más
  // detallada (frecuencia quincenal/mensual, cantidad fija, prioridad) —
  // ambas fuentes conviven, sin duplicar un producto que ya entró por la otra.
  Object.keys(mapaMatriz).forEach(function(codigo){

    if(codigosIncluidos[codigo]) return;

    const filaMatriz = mapaMatriz[codigo];
    const marcadoSemanal = String(filaMatriz[20] || "").trim().toUpperCase() === "SI"; // columna U
    if(!marcadoSemanal) return;

    const ubicacion = String(filaMatriz[9] || "").trim();
    if(ubicacionVacia_(ubicacion)) return; // producto descontinuado, no ofrecer

    codigosIncluidos[codigo] = true;

    const proveedor = obtenerProveedorProducto_(filaMatriz);
    const sinProveedor = proveedor === SIN_PROVEEDOR_ETIQUETA_;
    const existencia = Number(filaMatriz[10]) || 0;
    const minimo = Number(filaMatriz[11]) || 0;
    const maximo = Number(filaMatriz[12]) || 0;
    const enTr = Number(enTransito[codigo]) || 0;
    const sugerido = Math.max(Math.round(maximo - existencia - enTr), 0);
    const convertir = String(filaMatriz[18] || "").trim().toUpperCase() === "SI";
    const presentacion = Number(filaMatriz[19]) || 0;
    const convertirFinal = convertir && presentacion > 0;

    productos.push({
      codigo: codigo,
      producto: filaMatriz[0],
      udm: filaMatriz[1],
      proveedor: proveedor,
      existencia: existencia,
      minimo: minimo,
      maximo: maximo,
      precio: Number(filaMatriz[17]) || 0,
      enTransito: enTr,
      sugerido: sugerido,
      convertir: convertirFinal,
      presentacion: presentacion,
      sugeridoPiezas: convertirFinal ? Math.ceil(sugerido / presentacion) : 0,
      prioridad: 0,
      observaciones: "",
      origen: "HABITUAL",
      incidencia: sinProveedor ? "Este producto no tiene proveedor configurado." : ""
    });

  });

  // Además de los habituales (configurados o marcados en MATRIZ), se
  // agregan como sugerencia los productos bajo mínimo de TODO el
  // catálogo — misma fuente y mismo cálculo que ya usa Sugerencias de
  // Requisición / Centro de Reabastecimiento
  // (obtenerSugerenciasRequisicionAutomaticaApp, AnalisisCompras.gs), para
  // no reimplementar el criterio de "bajo mínimo" ni su sugerido por
  // fórmula+histórico. Un producto que ya entró como HABITUAL no se
  // duplica aquí.
  const bajoMinimo = obtenerSugerenciasRequisicionAutomaticaApp(token);

  bajoMinimo.forEach(function(p){

    if(codigosIncluidos[p.codigo]) return;
    codigosIncluidos[p.codigo] = true;

    const filaMatriz = mapaMatriz[p.codigo];
    const precio = filaMatriz ? Number(filaMatriz[17]) || 0 : 0;
    const convertir = filaMatriz ? String(filaMatriz[18] || "").trim().toUpperCase() === "SI" : false;
    const presentacion = filaMatriz ? Number(filaMatriz[19]) || 0 : 0;
    const convertirFinal = convertir && presentacion > 0;
    const sinProveedor = p.proveedor === SIN_PROVEEDOR_ETIQUETA_;

    productos.push({
      codigo: p.codigo,
      producto: p.producto,
      udm: p.udm,
      proveedor: p.proveedor,
      existencia: p.existencia,
      minimo: p.minimo,
      maximo: p.maximo,
      precio: precio,
      enTransito: Number(enTransito[p.codigo]) || 0,
      sugerido: p.cantidadSugerida,
      convertir: convertirFinal,
      presentacion: presentacion,
      sugeridoPiezas: convertirFinal ? Math.ceil(p.cantidadSugerida / presentacion) : 0,
      prioridad: 0,
      observaciones: "",
      origen: "BAJO_MINIMO",
      incidencia: sinProveedor ? "Este producto no tiene proveedor configurado." : ""
    });

  });

  productos.sort(function(a, b){ return (b.prioridad || 0) - (a.prioridad || 0); });

  return { dia: diaTexto, fecha: Utilities.formatDate(fecha, Session.getScriptTimeZone(), "dd/MM/yyyy"), productos: productos };

}

/** Todos los productos habituales configurados (activos e inactivos) — para la pantalla de configuración. */
function listarProductosHabitualesCompraApp(token){

  requerirAccesoAlmacenApp_(token);

  const hoja = obtenerHojaProductosCompra_();
  if(hoja.getLastRow() < 2) return [];

  const config = hoja.getRange(2, 1, hoja.getLastRow() - 1, 10).getValues();
  const mapaMatriz = construirMapaMatrizPorCodigo_();

  return config.map(function(c){
    const codigo = String(c[0] || "").trim();
    const filaMatriz = mapaMatriz[codigo];
    return {
      codigo: codigo,
      producto: filaMatriz ? filaMatriz[0] : "(no encontrado en catálogo)",
      proveedor: filaMatriz ? obtenerProveedorProducto_(filaMatriz) : "",
      frecuencia: c[1],
      diaCompra: c[2],
      modoCantidad: c[3],
      cantidadHabitual: Number(c[4]) || 0,
      activo: String(c[5] || "").trim().toUpperCase() === "SI",
      prioridad: Number(c[6]) || 0,
      observaciones: c[7] || "",
      fechaAlta: c[8] instanceof Date ? Utilities.formatDate(c[8], Session.getScriptTimeZone(), "dd/MM/yyyy") : String(c[8] || ""),
      usuarioAlta: c[9] || ""
    };
  });

}

/** Alta o edición (upsert por código) de un producto habitual. */
function guardarProductoHabitualCompraApp(datos, token){

  requerirAccesoAlmacenApp_(token);

  const codigo = String((datos && datos.codigo) || "").trim();
  if(!codigo) throw new Error("Falta el código del producto.");

  const frecuencia = String((datos && datos.frecuencia) || "").trim().toUpperCase();
  if(!FRECUENCIAS_COMPRA_VALIDAS_[frecuencia]){
    throw new Error("Frecuencia inválida: " + (datos && datos.frecuencia));
  }

  const diaCompra = String((datos && datos.diaCompra) || "").trim().toUpperCase();
  if(frecuencia !== "DIARIA"){
    const dias = diaCompra.split(",").map(function(d){ return d.trim(); }).filter(Boolean);
    const todosValidos = dias.length > 0 && dias.every(function(d){ return DIAS_COMPRA_VALIDOS_[d]; });
    if(!todosValidos) throw new Error("Día de compra inválido: " + (datos && datos.diaCompra));
    if(frecuencia !== "PERSONALIZADA" && dias.length !== 1){
      throw new Error("Esta frecuencia admite un solo día de compra.");
    }
  }

  const modoCantidad = String((datos && datos.modoCantidad) || "MIN_MAX").trim().toUpperCase();
  if(modoCantidad !== "FIJA" && modoCantidad !== "MIN_MAX"){
    throw new Error("Modo de cantidad inválido: " + (datos && datos.modoCantidad));
  }
  if(modoCantidad === "FIJA" && !(Number(datos.cantidadHabitual) > 0)){
    throw new Error("Captura la cantidad habitual (mayor a cero) para modo de cantidad fija.");
  }

  const mapaMatriz = construirMapaMatrizPorCodigo_();
  if(!mapaMatriz[codigo]){
    throw new Error("El código " + codigo + " no existe en el catálogo (MATRIZ).");
  }

  const hoja = obtenerHojaProductosCompra_();
  const usuario = obtenerNombreDesdeToken(token);

  let filaExistente = -1;
  if(hoja.getLastRow() > 1){
    const codigos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
    for(let i = 0; i < codigos.length; i++){
      if(String(codigos[i][0] || "").trim() === codigo){ filaExistente = i + 2; break; }
    }
  }

  const activo = (datos.activo === false || String(datos.activo).toUpperCase() === "NO") ? "NO" : "SI";

  if(filaExistente === -1){
    hoja.appendRow([
      codigo, frecuencia, diaCompra, modoCantidad,
      Number(datos.cantidadHabitual) || 0, activo, Number(datos.prioridad) || 0,
      datos.observaciones || "", new Date(), usuario
    ]);
  }else{
    // Fecha Alta / Usuario Alta originales se conservan — solo cambia la configuración.
    hoja.getRange(filaExistente, 2, 1, 7).setValues([[
      frecuencia, diaCompra, modoCantidad, Number(datos.cantidadHabitual) || 0,
      activo, Number(datos.prioridad) || 0, datos.observaciones || ""
    ]]);
  }

  registrarAuditoria(
    usuario, "COMPRAS", filaExistente === -1 ? "PRODUCTO HABITUAL AGREGADO" : "PRODUCTO HABITUAL EDITADO",
    "", codigo, mapaMatriz[codigo][0], 0, 0, frecuencia + (diaCompra ? " / " + diaCompra : "")
  );

  return { ok: true, codigo: codigo };

}

/**
 * Activa/desactiva sin borrar la configuración — mismo criterio de
 * soft-delete que USUARIOS y PROGRAMACION_CONTEOS.
 */
function establecerActivoProductoHabitualCompraApp(codigo, activo, token){

  requerirAccesoAlmacenApp_(token);

  codigo = String(codigo || "").trim();
  if(!codigo) throw new Error("Falta el código del producto.");

  const hoja = obtenerHojaProductosCompra_();
  if(hoja.getLastRow() < 2) throw new Error("No hay productos habituales configurados.");

  const codigos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
  let fila = -1;
  for(let i = 0; i < codigos.length; i++){
    if(String(codigos[i][0] || "").trim() === codigo){ fila = i + 2; break; }
  }
  if(fila === -1) throw new Error("No se encontró el producto habitual " + codigo + ".");

  hoja.getRange(fila, 6).setValue(activo ? "SI" : "NO");

  registrarAuditoria(
    obtenerNombreDesdeToken(token), "COMPRAS",
    activo ? "PRODUCTO HABITUAL ACTIVADO" : "PRODUCTO HABITUAL DESACTIVADO",
    "", codigo, "", 0, 0, ""
  );

  return { ok: true };

}

// ============================================
// FASE 3-5 — Pedido de Compra Rápido (documento padre)
// ============================================

function filaPedidoAObjeto_(f){
  return {
    folio: f[0],
    fecha: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : String(f[1] || ""),
    usuario: f[2],
    estado: f[3],
    totalProductos: Number(f[4]) || 0,
    totalProveedores: Number(f[5]) || 0,
    observaciones: f[6] || "",
    ocsGeneradas: f[7] ? String(f[7]).split(",").map(function(s){ return s.trim(); }).filter(Boolean) : []
  };
}

/** Folio del pedido: mismo patrón fecha+consecutivo del día que ya usa la OC (generarOrdenCompraApp), con prefijo propio. */
function generarFolioPedidoCompra_(hojaPedidos, fecha){
  const fechaCodigo = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyyMMdd");
  let consecutivo = 1;
  if(hojaPedidos.getLastRow() > 1){
    const folios = hojaPedidos.getRange(2, 1, hojaPedidos.getLastRow() - 1, 1).getValues().flat();
    const deHoy = folios.filter(function(f){ return f.toString().includes("PED-" + fechaCodigo); });
    consecutivo = deHoy.length + 1;
  }
  return "PED-" + fechaCodigo + "-" + Utilities.formatString("%03d", consecutivo);
}

/** Último pedido (cualquier estado) registrado para una fecha — base de la protección contra duplicados (sección 15). */
function buscarPedidoCompraPorFecha_(fecha){

  const hoja = obtenerHojaPedidosCompra_();
  if(hoja.getLastRow() < 2) return null;

  const fechaTexto = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 8).getValues();

  for(let i = datos.length - 1; i >= 0; i--){
    const f = datos[i];
    const fechaFila = f[1] instanceof Date ? f[1] : new Date(f[1]);
    if(isNaN(fechaFila.getTime())) continue;
    if(Utilities.formatDate(fechaFila, Session.getScriptTimeZone(), "yyyy-MM-dd") === fechaTexto){
      return filaPedidoAObjeto_(f);
    }
  }
  return null;

}

/**
 * Punto de entrada al abrir el módulo. Si ya existe un pedido GENERADO
 * ese día, se reporta para que el frontend ofrezca abrir el existente /
 * crear uno extraordinario / cancelar (sección 15) — nunca se genera un
 * duplicado automáticamente. Si hay un BORRADOR sin terminar, se regresa
 * para reanudarlo tal cual quedó (no se recalculan sugerencias encima de
 * lo que el usuario ya guardó).
 */
function iniciarPedidoCompraRapidoApp(fechaTexto, token){

  requerirAccesoAlmacenApp_(token);

  const fecha = fechaTexto ? new Date(fechaTexto + "T00:00:00") : new Date();
  if(isNaN(fecha.getTime())) throw new Error("Fecha inválida.");

  const existente = buscarPedidoCompraPorFecha_(fecha);

  if(existente && existente.estado === "GENERADO"){
    return { existente: true, pedido: existente };
  }

  if(existente && (existente.estado === "BORRADOR" || existente.estado === "EN_REVISION")){
    return { existente: false, borrador: obtenerPedidoCompraApp(existente.folio, token) };
  }

  const habituales = obtenerProductosHabitualesCompraApp(
    Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM-dd"), token
  );

  return { existente: false, borrador: null, dia: habituales.dia, fecha: habituales.fecha, productos: habituales.productos };

}

/** Encabezado + líneas de un pedido, más el detalle de cada OC ya generada a partir de él (reutiliza obtenerDetalleOCApp_). */
function obtenerPedidoCompraApp(folioPedido, token){

  requerirAccesoAlmacenApp_(token);

  folioPedido = String(folioPedido || "").trim().toUpperCase();

  const hoja = obtenerHojaPedidosCompra_();
  if(hoja.getLastRow() < 2) return null;

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 8).getValues();
  let encabezado = null;
  for(let i = 0; i < datos.length; i++){
    if(String(datos[i][0] || "").trim().toUpperCase() === folioPedido){
      encabezado = filaPedidoAObjeto_(datos[i]);
      break;
    }
  }
  if(!encabezado) return null;

  const hojaDetalle = obtenerHojaDetallePedidoCompra_();
  const items = [];
  if(hojaDetalle.getLastRow() > 1){
    const datosDetalle = hojaDetalle.getRange(2, 1, hojaDetalle.getLastRow() - 1, 12).getValues();
    datosDetalle.forEach(function(f){
      if(String(f[0] || "").trim().toUpperCase() === folioPedido){
        items.push({
          codigo: f[1], producto: f[2], proveedor: f[3],
          existencia: Number(f[4]) || 0, sugerido: Number(f[5]) || 0,
          cantidad: Number(f[6]) || 0, udm: f[7], precio: Number(f[8]) || 0,
          origen: f[9], incidencia: f[10] || "", folioOC: f[11] || ""
        });
      }
    });
  }
  encabezado.items = items;

  encabezado.ordenes = encabezado.ocsGeneradas
    .map(function(folioOC){ return obtenerDetalleOCApp_(folioOC); })
    .filter(Boolean);

  return encabezado;

}

/** Reemplaza por completo el detalle guardado de un pedido — mismo criterio que editarOrdenCompraApp con DETALLE_OC. */
function reemplazarDetallePedidoCompra_(folioPedido, items){

  const hoja = obtenerHojaDetallePedidoCompra_();

  if(hoja.getLastRow() > 1){
    const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
    for(let i = datos.length - 1; i >= 0; i--){
      if(String(datos[i][0] || "").trim().toUpperCase() === folioPedido){
        hoja.deleteRows(i + 2, 1);
      }
    }
  }

  const filas = items.map(function(item){
    return [
      folioPedido, item.codigo, item.producto, item.proveedor,
      Number(item.existencia) || 0, Number(item.sugerido) || 0, Number(item.cantidad) || 0,
      item.udm || "", Number(item.precio) || 0, item.origen || "HABITUAL",
      item.incidencia || "", ""
    ];
  });

  if(filas.length){
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, 12).setValues(filas);
  }

}

/**
 * Crea (folioPedido vacío) o actualiza un borrador — NO genera ninguna
 * OC todavía, solo guarda la selección de productos/cantidades que el
 * usuario está revisando (botón "Guardar borrador" del pedido de Alberto).
 */
function guardarBorradorPedidoCompraApp(folioPedido, fechaTexto, items, observaciones, token){

  requerirAccesoAlmacenApp_(token);

  if(!items || !items.length) throw new Error("Agrega al menos un producto al pedido.");

  const fecha = fechaTexto ? new Date(fechaTexto + "T00:00:00") : new Date();
  if(isNaN(fecha.getTime())) throw new Error("Fecha inválida.");

  const hojaPedidos = obtenerHojaPedidosCompra_();
  const usuario = obtenerNombreDesdeToken(token);

  folioPedido = String(folioPedido || "").trim().toUpperCase();
  const esNuevo = !folioPedido;
  let filaPedido = -1;

  if(!esNuevo){
    const folios = hojaPedidos.getLastRow() > 1 ? hojaPedidos.getRange(2, 1, hojaPedidos.getLastRow() - 1, 1).getValues() : [];
    for(let i = 0; i < folios.length; i++){
      if(String(folios[i][0] || "").trim().toUpperCase() === folioPedido){ filaPedido = i + 2; break; }
    }
    if(filaPedido === -1) throw new Error("No se encontró el pedido " + folioPedido + ".");

    const estadoActual = String(hojaPedidos.getRange(filaPedido, 4).getValue() || "").trim().toUpperCase();
    if(estadoActual === "GENERADO" || estadoActual === "CERRADO"){
      throw new Error("El pedido " + folioPedido + " ya fue generado — no se puede modificar. Crea un pedido extraordinario aparte si necesitas agregar más productos.");
    }
    if(estadoActual === "CANCELADO"){
      throw new Error("El pedido " + folioPedido + " está cancelado.");
    }
  }

  const proveedoresUnicos = {};
  let totalProductos = 0;
  items.forEach(function(item){
    if(Number(item.cantidad) > 0){
      totalProductos++;
      proveedoresUnicos[normalizarProveedor_(item.proveedor)] = true;
    }
  });
  const totalProveedores = Object.keys(proveedoresUnicos).length;

  if(esNuevo){
    conBloqueoApp_(function(){
      folioPedido = generarFolioPedidoCompra_(hojaPedidos, fecha);
      hojaPedidos.appendRow([folioPedido, fecha, usuario, "BORRADOR", totalProductos, totalProveedores, observaciones || "", ""]);
    });
  }else{
    hojaPedidos.getRange(filaPedido, 4, 1, 3).setValues([["EN_REVISION", totalProductos, totalProveedores]]);
    if(observaciones !== undefined){
      hojaPedidos.getRange(filaPedido, 7).setValue(observaciones || "");
    }
  }

  reemplazarDetallePedidoCompra_(folioPedido, items);

  return { folio: folioPedido, totalProductos: totalProductos, totalProveedores: totalProveedores };

}

/** Marca en DETALLE_PEDIDO_COMPRA con qué OC terminó cada línea (trazabilidad, sección 13). */
function marcarFolioOcEnDetallePedido_(folioPedido, codigoAFolioOC){
  const hoja = obtenerHojaDetallePedidoCompra_();
  if(hoja.getLastRow() < 2) return;
  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 12).getValues();
  datos.forEach(function(f, i){
    if(String(f[0] || "").trim().toUpperCase() !== folioPedido) return;
    const folioOC = codigoAFolioOC[String(f[1] || "").trim()];
    if(folioOC) hoja.getRange(i + 2, 12).setValue(folioOC);
  });
}

/**
 * Núcleo de la Fase 4: valida, agrupa por proveedor (normalizado) y
 * genera una OC real POR PROVEEDOR reutilizando generarOrdenCompraApp tal
 * cual — folio, lock, impuestos, auditoría y PDF de esa función no se
 * reimplementan aquí. Un pedido ya GENERADO nunca se vuelve a generar
 * (protección contra doble clic / doble envío, secciones 15 y 19).
 */
function generarOrdenesDesdePedidoApp(folioPedido, token){

  requerirAccesoAlmacenApp_(token);

  folioPedido = String(folioPedido || "").trim().toUpperCase();

  const pedido = obtenerPedidoCompraApp(folioPedido, token);
  if(!pedido) throw new Error("No se encontró el pedido " + folioPedido + ".");

  if(pedido.estado === "GENERADO"){
    throw new Error("El pedido " + folioPedido + " ya fue generado (" + pedido.ocsGeneradas.length + " orden(es) de compra) — no se puede generar dos veces.");
  }
  if(pedido.estado === "CANCELADO" || pedido.estado === "CERRADO"){
    throw new Error("El pedido " + folioPedido + " está " + pedido.estado.toLowerCase() + " y no se puede generar.");
  }
  if(!pedido.items.length) throw new Error("El pedido no tiene productos.");

  // ---- Validación (secciones 22-24): nunca revienta todo el pedido por una línea mala ----
  const incidencias = [];
  const codigosVistos = {};
  const validos = [];

  pedido.items.forEach(function(item){

    const codigo = String(item.codigo || "").trim();
    const cantidad = Number(item.cantidad) || 0;
    const proveedor = String(item.proveedor || "").trim();

    if(cantidad === 0) return; // "sin necesidad de compra" — no es incidencia, simplemente no entra a ninguna OC

    if(cantidad < 0){
      incidencias.push({ codigo: codigo, producto: item.producto, motivo: "Cantidad negativa." });
      return;
    }
    if(!proveedor || proveedor === SIN_PROVEEDOR_ETIQUETA_){
      incidencias.push({ codigo: codigo, producto: item.producto, motivo: "Este producto no tiene proveedor configurado." });
      return;
    }
    if(codigosVistos[codigo]){
      incidencias.push({ codigo: codigo, producto: item.producto, motivo: "Producto duplicado dentro del mismo pedido." });
      return;
    }
    codigosVistos[codigo] = true;
    validos.push(item);

  });

  if(!validos.length){
    throw new Error("Ningún producto del pedido está listo para generar una orden de compra. Revisa las incidencias.");
  }

  // ---- Agrupación por proveedor normalizado (sección 10) ----
  const grupos = {};
  validos.forEach(function(item){
    const clave = normalizarProveedor_(item.proveedor);
    if(!grupos[clave]) grupos[clave] = { proveedor: item.proveedor, items: [] };
    grupos[clave].items.push({
      codigo: item.codigo, producto: item.producto, udm: item.udm,
      cantidad: item.cantidad, precio: item.precio
    });
  });

  // ---- Generación masiva (sección 11) ----
  const ordenesGeneradas = [];
  Object.keys(grupos).forEach(function(clave){
    const grupo = grupos[clave];
    const resultado = generarOrdenCompraApp(
      grupo.proveedor,
      "Generada desde Pedido de Compra Rápido " + folioPedido,
      grupo.items,
      token,
      { folioPedido: folioPedido }
    );
    grupo.folioOC = resultado.folio;
    ordenesGeneradas.push({ proveedor: grupo.proveedor, folio: resultado.folio, productos: resultado.productos, total: resultado.total });
  });

  const codigoAFolioOC = {};
  Object.keys(grupos).forEach(function(clave){
    grupos[clave].items.forEach(function(item){ codigoAFolioOC[item.codigo] = grupos[clave].folioOC; });
  });
  marcarFolioOcEnDetallePedido_(folioPedido, codigoAFolioOC);

  // ---- Cierra el pedido como GENERADO ----
  const hojaPedidos = obtenerHojaPedidosCompra_();
  const folios = hojaPedidos.getRange(2, 1, hojaPedidos.getLastRow() - 1, 1).getValues();
  let filaPedido = -1;
  for(let i = 0; i < folios.length; i++){
    if(String(folios[i][0] || "").trim().toUpperCase() === folioPedido){ filaPedido = i + 2; break; }
  }
  const listaOCs = ordenesGeneradas.map(function(o){ return o.folio; }).join(",");
  hojaPedidos.getRange(filaPedido, 4, 1, 5).setValues([[
    "GENERADO", validos.length, ordenesGeneradas.length, pedido.observaciones || "", listaOCs
  ]]);

  const usuario = obtenerNombreDesdeToken(token);
  registrarAuditoria(
    usuario, "COMPRAS", "PEDIDO COMPRA RAPIDA GENERADO", folioPedido, "", "",
    0, validos.length, "Generó " + ordenesGeneradas.length + " orden(es) de compra: " + listaOCs
  );

  return { folioPedido: folioPedido, ordenes: ordenesGeneradas, incidencias: incidencias };

}

/** Cancela un pedido que aún no generó OC reales — un pedido GENERADO se cancela orden por orden (cancelarOrdenCompraApp), no aquí. Nunca borra la fila (trazabilidad). */
function cancelarPedidoCompraApp(folioPedido, token){

  requerirAccesoAlmacenApp_(token);

  folioPedido = String(folioPedido || "").trim().toUpperCase();

  const hoja = obtenerHojaPedidosCompra_();
  if(hoja.getLastRow() < 2) throw new Error("No se encontró el pedido " + folioPedido + ".");

  const folios = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
  let fila = -1;
  for(let i = 0; i < folios.length; i++){
    if(String(folios[i][0] || "").trim().toUpperCase() === folioPedido){ fila = i + 2; break; }
  }
  if(fila === -1) throw new Error("No se encontró el pedido " + folioPedido + ".");

  const estadoActual = String(hoja.getRange(fila, 4).getValue() || "").trim().toUpperCase();
  if(estadoActual === "GENERADO"){
    throw new Error("El pedido " + folioPedido + " ya generó órdenes de compra reales — cancela cada orden individualmente desde Órdenes de Compra si corresponde.");
  }
  if(estadoActual === "CANCELADO") return { ok: true };

  hoja.getRange(fila, 4).setValue("CANCELADO");

  registrarAuditoria(obtenerNombreDesdeToken(token), "COMPRAS", "PEDIDO COMPRA RAPIDA CANCELADO", folioPedido, "", "", 0, 0, "");

  return { ok: true };

}

/** Historial de pedidos (sección 16), más recientes primero. */
function obtenerHistorialPedidosCompraApp(token){

  requerirAccesoAlmacenApp_(token);

  const hoja = obtenerHojaPedidosCompra_();
  if(hoja.getLastRow() < 2) return [];

  return hoja.getRange(2, 1, hoja.getLastRow() - 1, 8).getValues().map(filaPedidoAObjeto_).reverse();

}
