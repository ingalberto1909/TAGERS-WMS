/**
 * Regresa true si la celda de ubicación NO cuenta como una ubicación real:
 * vacía, solo espacios, o solo guiones (--, ---, etc: así marcan en MATRIZ
 * los productos de temporada que aún no tienen rack asignado).
 */
function ubicacionVacia_(valor){
  const limpio = String(valor||"").trim();
  return limpio === "" || /^-+$/.test(limpio);
}

/**
 * FASE 5 — RENDIMIENTO: lectura completa de una hoja (todas las
 * columnas, incluye el encabezado en la fila 0 — igual que
 * getDataRange().getValues()) con una caché de solo 20 segundos
 * (CacheService, compartida por todo el proyecto). El panel de Inicio,
 * por ejemplo, hacía ~5 lecturas completas de MATRIZ y ~4 de KARDEX en
 * una sola visita — cada una en una llamada de google.script.run
 * independiente, así que una variable normal de JavaScript no ayuda
 * (cada llamada corre en su propia ejecución, sin memoria compartida).
 * CacheService sí persiste esos 20s entre ejecuciones separadas.
 *
 * SOLO se usa en funciones de SOLO LECTURA para pantallas (Inicio,
 * notificaciones, mapa de calor, valor de inventario, detalle de
 * producto) — nunca en una ruta que vaya a escribir después (esas
 * siguen leyendo directo de la hoja, sin caché, como siempre: la
 * existencia real de un producto y cualquier decisión de negocio deben
 * verse con el dato más fresco posible, no con hasta 20s de retraso).
 *
 * Los valores se guardan como JSON — Utilities.formatDate ya se sigue
 * usando en cada función lectora tal como antes, y cada consumidor de
 * fechas en este proyecto ya maneja el caso "esto no es un objeto Date"
 * con el patrón `fila[0] instanceof Date ? fila[0] : new Date(fila[0])`,
 * así que una fecha que cruzó por JSON (queda como texto ISO) se
 * reconstruye exactamente igual. JSON.parse siempre regresa un arreglo
 * nuevo, así que cada llamador puede hacerle .shift()/.sort() sin
 * afectar a los demás que lean la misma caché dentro de esos 20s.
 */
function obtenerFilasHojaCacheadas_(nombreHoja){
  const cache = CacheService.getScriptCache();
  const clave = "TAGERS_HOJA_" + nombreHoja + "_V1";

  try{
    const cacheado = cache.get(clave);
    if(cacheado) return JSON.parse(cacheado);
  }catch(e){
    // si algo sale mal leyendo/parseando la caché, se sigue como si no hubiera caché
  }

  const hoja = SpreadsheetApp.getActive().getSheetByName(nombreHoja);
  const datos = hoja ? hoja.getDataRange().getValues() : [];

  try{
    cache.put(clave, JSON.stringify(datos), 20);
  }catch(e){
    // CacheService tiene un límite de 100KB por valor — si la hoja es
    // demasiado grande para caber, simplemente no se cachea esta vez,
    // sin romper la lectura actual.
  }

  return datos;
}

/**
 * Invalida la caché de 20s de obtenerFilasHojaCacheadas_ para una hoja.
 * Se llama desde los puntos ÚNICOS y autorizados que escriben esa hoja
 * (los 3 escritores de la columna Existencia de MATRIZ, y registrarKardex
 * para KARDEX) — así una pantalla que lea justo después de una
 * entrada/salida/ajuste ve el dato real de inmediato, en vez de esperar
 * hasta 20s a que expire sola. Si la clave no estaba cacheada, remove()
 * simplemente no hace nada.
 */
function invalidarCacheHoja_(nombreHoja){
  try{
    CacheService.getScriptCache().remove("TAGERS_HOJA_" + nombreHoja + "_V1");
  }catch(e){
    // nunca debe tronar un guardado real por un problema de caché
  }
}

function doGet(e) {

  const pagina = (e && e.parameter && e.parameter.page) 
    ? e.parameter.page 
    : "login";

  const urlApp = ScriptApp.getService().getUrl();


  // LOGIN
  if (pagina === "login") {

    const plantillaLogin = HtmlService.createTemplateFromFile("Login");

    plantillaLogin.urlApp = urlApp;

    return plantillaLogin
      .evaluate()
      .setTitle("TAGERS WMS - Login")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (pagina === "mapa") {
    const plantillaMapa = HtmlService.createTemplateFromFile("MapaAlmacenV3");
    plantillaMapa.urlApp = urlApp;
    return plantillaMapa
      .evaluate()
      .setTitle("TAGERS WMS - Mapa")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const plantillaIndex = HtmlService.createTemplateFromFile("index");
  plantillaIndex.urlApp = urlApp;
  return plantillaIndex
    .evaluate()
    .setTitle("TAGERS WMS")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(nombre){
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

function obtenerInventario(token) {
  // Hallazgo de seguridad (auditoría de rendimiento, ago-2026): esta función
  // se quedó sin requerirSesionActivaApp_ cuando se cerraron ~57 endpoints
  // similares en la fase de seguridad anterior — no sigue el sufijo "...App"
  // que usó esa auditoría para encontrarlas, así que se le escapó. Expone
  // TODO el catálogo (producto/código/ubicación/existencia) a cualquier
  // visitante anónimo con access:ANYONE — la usa activamente la pantalla
  // "Existencias" del sidebar (abrirInventario() en index.html).
  requerirSesionActivaApp_(token);
  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datos = hoja.getDataRange().getValues();
  datos.shift();

  return datos.map(fila => {
    const ubic = String(fila[9]||"").trim();
    return {
      producto: fila[0],
      codigo: fila[4],
      ubicacion: ubicacionVacia_(ubic) ? "Sin ubicación" : ubic,
      existencia: fila[10]
    };
  });
}

function obtenerMesLetra(fecha){

  const meses = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ];

  return meses[fecha.getMonth()];

}

/**
 * CORREGIDO: el usuario del KARDEX ahora es el nombre real
 * (obtenerNombreUsuario, definido en tu script de la hoja),
 * no el correo (Session.getEffectiveUser().getEmail()).
 */
/**
 * Lógica REAL de registrar una entrada: escribe en ENTRADA y en KARDEX.
 * La usan tanto la entrada manual (guardarEntradaApp) como la recepción
 * de Órdenes de Compra — sin lógica duplicada entre ambos flujos.
 */
function registrarEntradaInterna_(datos, usuario, folioPersonalizado, observacionPersonalizada){

  const ss = SpreadsheetApp.getActive();
  const entrada = ss.getSheetByName("ENTRADA");
  const kardex = ss.getSheetByName("KARDEX");
  const fecha = new Date();

  entrada.appendRow([
    fecha.getFullYear(),
    obtenerMesLetra(fecha),
    fecha,
    datos.codigo,
    datos.producto,
    Number(datos.cantidad),
    datos.udm,
    datos.lote || "",
    datos.caducidad || "",
    "",
    datos.ubicacion || ""
  ]);

  // Única fuente de verdad para la existencia: se actualiza por delta
  // (+cantidad) y de aquí sale la existencia anterior para el Kardex.
  const resultadoExistencia = ajustarExistenciaMatrizPorDelta_(datos.codigo, Number(datos.cantidad));
  const existenciaAnterior = resultadoExistencia ? resultadoExistencia.anterior : 0;
  const existenciaNueva = resultadoExistencia ? resultadoExistencia.nueva : Number(datos.cantidad);

  const folio = folioPersonalizado || ("ENT-" + fecha.getTime());

  kardex.appendRow([
    fecha,
    Utilities.formatDate(fecha, Session.getScriptTimeZone(), "HH:mm:ss"),
    "ENTRADA",
    folio,
    datos.codigo,
    datos.producto,
    Number(datos.cantidad),
    0,
    existenciaAnterior,
    existenciaNueva,
    usuario,
    observacionPersonalizada || "Entrada desde app móvil"
  ]);

  // Escribe Kardex directo (no vía registrarKardex, que recalcularía su
  // propia fecha) — pero SÍ debe invalidar la misma caché de 20s que
  // usa registrarKardex, o toda entrada/salida (la operación más
  // frecuente del sistema) deja el Kardex cacheado desactualizado hasta
  // por 20s (hallazgo de auditoría, no relacionado con sucursales).
  invalidarCacheHoja_("KARDEX");

  return true;
}

function guardarEntradaApp(datos){
  requerirAccesoOperacionesApp_(datos.token);
  return registrarEntradaInterna_(datos, obtenerNombreDesdeToken(datos.token));
}

/**
 * Registra una salida. Valida existencia suficiente ANTES de mover nada.
 * Layout de la hoja SALIDA (una sola fila, A→K):
 *   A AÑO | B MES | C FECHA | D CODIGO | E PRODUCTO | F CANTIDAD | G UDM
 *   H AREA | I LOTE | J CADUCIDAD | K UBICACION
 *
 * OJO: el formulario de Salida no tiene campo de Caducidad, así que
 * datos.caducidad siempre llega vacío y la columna J se escribe en blanco
 * en cada salida. Si J tiene una fórmula (ARRAYFORMULA, etc.) que se
 * autoexpande, esto se la va a romper en esa fila. Si es tu caso, avísame
 * y lo dejamos sin tocar esa columna (como hicimos con el layout anterior).
 *
 * CORREGIDO: usuario del KARDEX ahora es el nombre real, y la nota usa
 * datos.area (tu campo actual) en vez de datos.motivo (ya no existe).
 */
/**
 * Lógica REAL de registrar una salida: valida existencia, escribe en SALIDA
 * y en KARDEX. Tanto la salida manual (registrarSalidaApp) como la
 * importación masiva de requerimientos (registrarSalidasImportadasApp) usan
 * ESTA MISMA función — no hay lógica duplicada entre ambos flujos.
 */
function registrarSalidaInterna_(datos, usuario){
  const ss = SpreadsheetApp.getActive();
  const salida = ss.getSheetByName("SALIDA");
  const kardex = ss.getSheetByName("KARDEX");

  const cantidad = Number(datos.cantidad);

  if (!cantidad || cantidad <= 0){
    throw new Error("Cantidad inválida");
  }

  const fecha = new Date();
  const folio = datos.folio || ("SAL-" + fecha.getTime());

  // La validación de existencia suficiente y el descuento ahora ocurren
  // en un solo paso, dentro del lock (ver ajustarExistenciaMatrizPorDeltaValidado_).
  // Si no alcanza, esto lanza el error ANTES de escribir nada en
  // SALIDA/KARDEX — así una salida que falla no deja movimientos huérfanos.
  const resultadoExistencia = ajustarExistenciaMatrizPorDeltaValidado_(datos.codigo, -cantidad);
  const existenciaAnterior = resultadoExistencia.anterior;
  const nuevaExistencia = resultadoExistencia.nueva;

  salida.appendRow([
    fecha.getFullYear(),          // A AÑO
    obtenerMesLetra(fecha),        // B MES (letra)
    fecha,                          // C FECHA
    datos.codigo,                    // D CODIGO
    datos.producto,                   // E PRODUCTO
    cantidad,                          // F CANTIDAD
    datos.udm,                          // G UDM
    datos.area || "",                    // H AREA
    datos.lote || "",                     // I LOTE
    datos.caducidad || "",                 // J CADUCIDAD (ver nota arriba)
    datos.ubicacion || ""                   // K UBICACION
  ]);

  kardex.appendRow([
    fecha,
    Utilities.formatDate(fecha, Session.getScriptTimeZone(), "HH:mm:ss"),
    "SALIDA",
    folio,
    datos.codigo,
    datos.producto,
    0,          // G Entrada — antes aquí se ponía la cantidad por error
    cantidad,   // H Salida — la cantidad va aquí
    existenciaAnterior, // I ExistenciaAnterior — antes aquí se ponía la cantidad por error
    nuevaExistencia,
    usuario,
    datos.observacion || (datos.area ? ("Salida a " + datos.area) : "Salida desde app móvil")
  ]);

  // Ver el mismo comentario en registrarEntradaInterna_.
  invalidarCacheHoja_("KARDEX");

  SpreadsheetApp.flush();

  return { exito: true, existenciaRestante: nuevaExistencia };
}

function registrarSalidaApp(datos){
  requerirAccesoOperacionesApp_(datos.token);
  return registrarSalidaInterna_(datos, obtenerNombreDesdeToken(datos.token));
}

function obtenerKardex(limite, token) {
  // Mismo hallazgo que obtenerInventario (ver comentario ahí) — expone el
  // historial completo de Kardex sin validar sesión. La usa activamente la
  // pantalla "Kardex" del sidebar. La versión interna (obtenerKardex_) la
  // sigue usando obtenerMovimientosRecientes sin token — su único llamador,
  // obtenerResumenInicioApp, ya valida la sesión en su propia primera línea.
  requerirSesionActivaApp_(token);
  return obtenerKardex_(limite);
}

function obtenerKardex_(limite) {
  const ss = SpreadsheetApp.getActive();
  const kardex = ss.getSheetByName("KARDEX");
  if (!kardex) return [];

  const ultimaFila = kardex.getLastRow();
  if (ultimaFila <= 1) return [];

  // Ajustamos el límite por defecto
  const maxFilas = limite || 8;

  // Obtenemos los datos de la hoja
  const datos = obtenerFilasHojaCacheadas_("KARDEX");
  datos.shift();
  let movimientos = [];

  // Recorremos de abajo hacia arriba (más reciente a más antiguo) para ahorrar tiempo
  for (let i = datos.length - 1; i >= 0; i--) {
    if (movimientos.length >= maxFilas) break; // Detener cuando tengamos los necesarios

    const fila = datos[i];
    let fechaFormateada = "";

    // Validación segura de fecha
    if (fila[0]) {
      const fechaObjeto = new Date(fila[0]);
      // Verifica si el objeto Date es válido antes de usar Utilities
      if (!isNaN(fechaObjeto.getTime())) {
        try {
          fechaFormateada = Utilities.formatDate(fechaObjeto, Session.getScriptTimeZone(), "dd/MM/yyyy");
        } catch (e) {
          fechaFormateada = "Error fecha";
        }
      }
    }

    movimientos.push({
      fecha: fechaFormateada,
      hora: fila[1] ? (fila[1] instanceof Date ? Utilities.formatDate(fila[1], Session.getScriptTimeZone(), "HH:mm:ss") : fila[1].toString()) : "",
      tipo: fila[2] || "",
      folio: fila[3] || "",
      codigo: fila[4] || "",
      producto: fila[5] || "",
      cantidad: fila[6] || fila[7] || 0, // Entrada o Salida, la que tenga valor
      saldo: fila[9] || 0,
      usuario: fila[10] || "",
      nota: fila[11] || ""
    });
  }

  return movimientos;
}

function buscarUbicacionApp(termino, token){
  requerirSesionActivaApp_(token);
  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  const t = String(termino).toUpperCase().trim();

  return datos
    .filter(f =>
      String(f[9]).toUpperCase().includes(t) ||
      String(f[0]).toUpperCase().includes(t) ||
      String(f[4]).toUpperCase().includes(t)
    )
    .map(f => {
      const ubic = String(f[9]||"").trim();
      const existencia = Number(f[10]) || 0;
      const minimo = Number(f[11]) || 0;
      return {
        producto: f[0],
        codigo: f[4],
        ubicacion: ubicacionVacia_(ubic) ? "Sin ubicación" : ubic,
        existencia: existencia,
        minimo: minimo,
        maximo: Number(f[12]) || 0,
        puntoReorden: minimo,
        proveedor: f[16] || "",
        estado: ubicacionVacia_(ubic) ? "" : (existencia <= 0 ? "Agotado" : (existencia <= minimo ? "Bajo" : "Óptimo"))
      };
    });
}

// ============================================
// IMPORTAR SALIDAS DESDE EXCEL (requerimientos)
// ============================================

/**
 * Normaliza un nombre de producto para comparar: mayúsculas, sin acentos,
 * sin caracteres especiales, sin espacios dobles.
 */
function normalizarTexto_(texto){
  return String(texto || "")
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
    .replace(/[^A-Z0-9 ]/g, " ")                        // quita caracteres especiales
    .replace(/\s+/g, " ")                                // espacios dobles -> uno
    .trim();
}

function distanciaLevenshtein_(a, b){
  const m = a.length, n = b.length;
  if(m === 0) return n;
  if(n === 0) return m;

  let fila = new Array(n + 1);
  for(let j = 0; j <= n; j++) fila[j] = j;

  for(let i = 1; i <= m; i++){
    let anterior = fila[0];
    fila[0] = i;
    for(let j = 1; j <= n; j++){
      const temp = fila[j];
      if(a[i-1] === b[j-1]){
        fila[j] = anterior;
      } else {
        fila[j] = 1 + Math.min(anterior, fila[j], fila[j-1]);
      }
      anterior = temp;
    }
  }
  return fila[n];
}

// 0 a 1: qué tan parecidos son dos textos ya normalizados.
function similitudTexto_(a, b){
  if(a === b) return 1;
  if(!a || !b) return 0;
  const distancia = distanciaLevenshtein_(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - (distancia / maxLen);
}

/**
 * Normaliza una unidad de presentación a una forma estándar (KG, G, L,
 * ML, PZ...) para que "KG"/"KGS", "PZ"/"PZA"/"PZAS"/"PIEZA", etc. se
 * traten como la misma unidad al comparar. Solo se usa para comparar
 * durante el matching — no cambia lo que hay guardado en ningún lado.
 */
function normalizarUDM_(udm){
  const u = String(udm||"").trim().toUpperCase();
  const mapa = {
    "KG":"KG", "KGS":"KG", "KILO":"KG", "KILOS":"KG",
    "G":"G", "GR":"G", "GRS":"G", "GRAMO":"G", "GRAMOS":"G",
    "L":"L", "LT":"L", "LTS":"L", "LITRO":"L", "LITROS":"L",
    "ML":"ML",
    "PZ":"PZ", "PZA":"PZ", "PZAS":"PZ", "PIEZA":"PZ", "PIEZAS":"PZ",
    "UND":"PZ", "UNIDAD":"PZ", "UNIDADES":"PZ", "PC":"PZ", "PCS":"PZ"
  };
  return mapa[u] || u;
}

/**
 * Factor para convertir una CANTIDAD de `udmOrigen` a `udmDestino`,
 * cuando las dos son la misma magnitud — masa (G/KG) o volumen (ML/L).
 * Usa normalizarUDM_ primero, así que "GRS"/"Gramos"/"g" se tratan
 * igual que "G". Si las unidades no son de la misma magnitud (p. ej.
 * PZ contra KG) no hay un factor fijo posible sin inventar un peso por
 * pieza — regresa null en vez de adivinar uno.
 */
function factorConversionUDM_(udmOrigen, udmDestino){
  const origen = normalizarUDM_(udmOrigen);
  const destino = normalizarUDM_(udmDestino);
  if(origen === destino) return 1;

  const aUnidadBase = { "G": 0.001, "KG": 1, "ML": 0.001, "L": 1 };
  const familiaMasa = ["G","KG"];
  const familiaVolumen = ["ML","L"];

  const mismaFamilia =
    (familiaMasa.includes(origen) && familiaMasa.includes(destino)) ||
    (familiaVolumen.includes(origen) && familiaVolumen.includes(destino));

  if(!mismaFamilia) return null;

  return aUnidadBase[origen] / aUnidadBase[destino];
}

/**
 * Separa "NOMBRE" y "PRESENTACIÓN" (número + unidad) de un texto libre
 * — un renglón del PDF de Marketman o el nombre de un producto de
 * MATRIZ (en tu catálogo el nombre completo ya trae el tamaño, ej.
 * "SALSA MACHA 0.5 KG"). Ejemplos:
 *   "SALSA MORITA 2 KG"                  -> SALSA MORITA | 2 KG
 *   "SALSA MACHA 0.5 KG"                 -> SALSA MACHA  | 0.5 KG
 *   "SALSA COUNTRY 0.5 KG (1 * 0.5 Kg)"  -> SALSA COUNTRY | 0.5 KG
 *     (la aclaración entre paréntesis que agrega Marketman se ignora
 *      para el matching — no es parte del nombre, solo lo confirma)
 * Si el texto no trae un patrón número+unidad reconocible (insumos que
 * en tu catálogo no manejan tamaño en el nombre), presentacionUDM
 * queda "" y presentacionNumero null — esos productos se siguen
 * comparando solo por nombre completo, igual que antes.
 */
function extraerNombreYPresentacion_(textoOriginal){

  let texto = String(textoOriginal || "").trim();
  texto = texto.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  const patronPresentacion = /(\d+(?:[.,]\d+)?)\s*(KGS?|GRS?|G|LTS?|L|ML|PZAS?|PZ|PIEZAS?|UNIDADES?|UND)\b/gi;

  let ultimo = null;
  let match;
  while((match = patronPresentacion.exec(texto)) !== null){
    ultimo = match; // nos quedamos con la ÚLTIMA (el tamaño casi siempre va al final)
  }

  if(!ultimo){
    return { nombre: normalizarTexto_(texto), presentacionNumero: null, presentacionUDM: "", presentacionTexto: "" };
  }

  const nombreCrudo = texto.substring(0, ultimo.index).trim();
  const numero = parseFloat(String(ultimo[1]).replace(",", "."));
  const udm = normalizarUDM_(ultimo[2]);

  return {
    nombre: normalizarTexto_(nombreCrudo),
    presentacionNumero: isNaN(numero) ? null : numero,
    presentacionUDM: udm,
    presentacionTexto: (isNaN(numero) ? "" : formatearCantidad_(numero)) + " " + udm
  };

}

/**
 * ¿Misma presentación EXACTA? (nivel 1). Mismas unidades y mismo
 * número (con tolerancia mínima por redondeo). Si a alguno de los dos
 * lados no se le detectó presentación, solo se consideran iguales
 * cuando NINGUNO de los dos la tiene (producto sin tamaño en el
 * nombre en ambos lados).
 */
function mismaPresentacionExacta_(a, b){
  if(a.presentacionUDM !== b.presentacionUDM) return false;
  if(a.presentacionNumero === null && b.presentacionNumero === null) return true;
  if(a.presentacionNumero === null || b.presentacionNumero === null) return false;
  return Math.abs(a.presentacionNumero - b.presentacionNumero) < 0.001;
}

/**
 * ¿Presentaciones COMPATIBLES? (nivel 3, fuzzy — más permisivo que la
 * exacta). Sirven para no comparar nombres entre tamaños distintos
 * (SALSA MORITA 0.5 KG nunca debe salir como candidato de SALSA
 * MORITA 2 KG), pero si a alguno de los dos lados no se le detectó
 * presentación, se deja pasar como candidato (por eso esto es solo
 * para SUGERIR — nunca para confirmar solo).
 */
function presentacionesCompatibles_(a, b){
  if(a.presentacionNumero === null || b.presentacionNumero === null) return true;
  if(a.presentacionUDM !== b.presentacionUDM) return false;
  return Math.abs(a.presentacionNumero - b.presentacionNumero) < 0.001;
}

/**
 * Matching de un texto libre (renglón del PDF/Excel) contra el
 * catálogo de MATRIZ ya normalizado (con nombre+presentación
 * separados, ver extraerNombreYPresentacion_).
 *
 * NIVEL 1 — EXACTA: nombre normalizado Y presentación (número+unidad)
 *           idénticos -> score 1. Es la ÚNICA forma de quedar 🟢 LISTO
 *           automáticamente.
 * NIVEL 2 — ALIAS: no existe todavía un catálogo de alias en TAGERS
 *           WMS (no se agregó ninguna hoja nueva para esto — se
 *           respetó no tocar la estructura). Este es el lugar exacto
 *           donde engancharlo el día que se implemente: antes del
 *           fuzzy, buscando el texto normalizado en una tabla de
 *           alias que apunte a un único código.
 * NIVEL 3 — FUZZY: solo entre candidatos con presentación compatible
 *           (mismo tamaño, o alguno de los dos sin tamaño detectable).
 *           Nunca se marca como lista sola — analizarImportacionSalidasApp
 *           siempre la manda a 🟡 REVISAR.
 *
 * IMPORTANTE — esto es lo que se quitó: la versión anterior tenía un
 * nivel intermedio que aceptaba como coincidencia "buscado.includes(
 * catalogo) || catalogo.includes(buscado)" y luego se quedaba con el
 * nombre de catálogo MÁS CORTO entre los que cumplían. Como CUALQUIER
 * "SALSA ..." normalizado contiene la subcadena "SAL", y "SAL" (si
 * existe como nombre corto/categoría en tu MATRIZ) es más corto que
 * "SALSA MORITA" o "SALSA MACHA", ese nivel SIEMPRE terminaba
 * eligiendo "SAL" para cualquier salsa del pedido. Ese nivel ya no
 * existe: aquí solo hay coincidencia EXACTA (nombre+presentación) o
 * FUZZY-para-revisar — nunca un fragmento/abreviatura/categoría.
 */
function buscarCoincidenciaProducto_(nombreBuscado, catalogoNormalizado){

  const buscado = extraerNombreYPresentacion_(nombreBuscado);
  if(!buscado.nombre) return null;

  // NIVEL 1 — exacto
  const exacto = catalogoNormalizado.find(p =>
    p.nombre === buscado.nombre && mismaPresentacionExacta_(p, buscado)
  );
  if(exacto) return { producto: exacto, score: 1, presentacionBuscada: buscado };

  // NIVEL 3 — fuzzy, solo candidatos con presentación compatible
  let mejorScore = 0;
  let mejorProducto = null;

  catalogoNormalizado.forEach(p=>{
    if(!presentacionesCompatibles_(p, buscado)) return; // tamaño distinto: nunca es el mismo producto
    const score = similitudTexto_(buscado.nombre, p.nombre);
    if(score > mejorScore){
      mejorScore = score;
      mejorProducto = p;
    }
  });

  if(mejorProducto && mejorScore >= 0.6){
    return { producto: mejorProducto, score: mejorScore, presentacionBuscada: buscado };
  }

  return null;

}

/**
 * items = [{ productoDocumento, cantidad }, ...] ya extraídos del PDF
 * (OCR) o del Excel en el navegador. Aquí se hace la búsqueda de
 * coincidencias contra MATRIZ, se calcula CANTIDAD A DESCONTAR =
 * cantidad pedida × factor de presentación (el factor sale del
 * producto ya identificado en MATRIZ, nunca de un número suelto del
 * nombre) y se valida contra la existencia real en UDM base. Se deja
 * un respaldo en IMPORTAR_SALIDAS para quien quiera revisarlo
 * directamente en Sheets.
 */
function analizarImportacionSalidasApp(items, token){

  requerirSesionActivaApp_(token);

  const ss = SpreadsheetApp.getActive();
  const matriz = ss.getSheetByName("MATRIZ");
  const datosMatriz = matriz.getRange(2, 1, matriz.getLastRow() - 1, 20).getValues();

  const catalogo = datosMatriz.map(f => {
    // La Presentación real de cada producto vive en la columna T de MATRIZ
    // (f[19], la misma que usan Órdenes de Compra y la valorización de
    // inventario) — NO se parsea del nombre, porque el catálogo no trae
    // el tamaño escrito en el texto (a diferencia del renglón del
    // documento importado, que sí se sigue analizando con
    // extraerNombreYPresentacion_ más abajo).
    const presentacionNumero = Number(f[19]) > 0 ? Number(f[19]) : null;
    return {
      nombre: normalizarTexto_(f[0]),
      presentacionNumero: presentacionNumero,
      presentacionUDM: presentacionNumero !== null ? normalizarUDM_(f[1]) : "",
      presentacionTexto: presentacionNumero !== null ? (formatearCantidad_(presentacionNumero) + " " + (f[1]||"")) : "",
      producto: f[0],
      codigo: f[4],
      existencia: Number(f[10]) || 0,
      udm: f[1],
      ubicacion: f[9] || ""
    };
  });

  const resultados = (items || []).map(item=>{

    const cantidadPedida = Number(item.cantidad) || 0;
    const coincidencia = buscarCoincidenciaProducto_(item.productoDocumento, catalogo);

    if(!coincidencia){
      return {
        productoDocumento: item.productoDocumento,
        cantidadPedida: cantidadPedida,
        presentacionTexto: "",
        factorPresentacion: "",
        cantidadADescontar: "",
        encontrado: "",
        codigo: "",
        existencia: "",
        existenciaResultante: "",
        udm: "",
        ubicacion: "",
        score: 0,
        estado: "SIN_COINCIDENCIA",
        observaciones: "No se encontró un producto con ese nombre y presentación en MATRIZ"
      };
    }

    const p = coincidencia.producto;

    // El factor SIEMPRE sale del producto ya identificado en MATRIZ
    // (nunca de un número suelto tomado del texto del documento). Si
    // ese producto no tiene presentación detectable en su nombre, el
    // factor es 1 (se descuenta tal cual, como antes).
    const factor = p.presentacionNumero !== null ? p.presentacionNumero : 1;
    const cantidadADescontar = Math.round(cantidadPedida * factor * 1000) / 1000;

    let estado = "OK";
    let observaciones = "";

    if(cantidadPedida <= 0){
      estado = "SIN_COINCIDENCIA";
      observaciones = "Cantidad inválida en el documento";
    } else if(cantidadADescontar > p.existencia){
      estado = "STOCK_INSUFICIENTE";
      observaciones = "Solicitado: " + cantidadPedida + (p.presentacionUDM ? " PZ" : "") +
        (p.presentacionTexto ? " — Presentación: " + p.presentacionTexto : "") +
        " — Necesario: " + cantidadADescontar + " " + p.udm +
        " — Disponible: " + p.existencia + " " + p.udm +
        " — Faltante: " + Math.round((cantidadADescontar - p.existencia) * 1000) / 1000 + " " + p.udm;
    } else if(coincidencia.score < 1){
      estado = "REVISAR";
      observaciones = "Coincidencia aproximada (" + Math.round(coincidencia.score*100) + "%), verifica que sea el producto y presentación correctos";
    }

    return {
      productoDocumento: item.productoDocumento,
      cantidadPedida: cantidadPedida,
      presentacionTexto: p.presentacionTexto || "—",
      factorPresentacion: factor,
      cantidadADescontar: cantidadADescontar,
      encontrado: p.producto,
      codigo: p.codigo,
      existencia: p.existencia,
      existenciaResultante: (estado === "OK" || estado === "REVISAR")
        ? Math.round((p.existencia - cantidadADescontar) * 1000) / 1000
        : "",
      udm: p.udm,
      ubicacion: p.ubicacion,
      score: coincidencia.score,
      estado: estado,
      observaciones: observaciones
    };

  });

  // Respaldo en IMPORTAR_SALIDAS (se sobrescribe en cada análisis)
  const hojaImport = ss.getSheetByName("IMPORTAR_SALIDAS");
  if(hojaImport){
    if(hojaImport.getLastRow() > 1){
      hojaImport.getRange(2, 1, hojaImport.getLastRow()-1, 9).clearContent();
    }
    if(resultados.length){
      const filas = resultados.map(r => [
        r.productoDocumento, r.cantidadPedida, r.presentacionTexto, r.cantidadADescontar,
        r.encontrado, r.codigo, r.existencia, r.estado, r.observaciones
      ]);
      hojaImport.getRange(2, 1, filas.length, 9).setValues(filas);
    }
  }

  return resultados;
}

/**
 * Registra en lote las filas ya revisadas/confirmadas por el usuario
 * (fase 6-7). Usa registrarSalidaInterna_ — LA MISMA función que una salida
 * manual — fila por fila, y guarda un resumen en HISTORIAL_IMPORTACIONES
 * (fase 8).
 */
function registrarSalidasImportadasApp(filas, token, nombreArchivo){

  requerirAccesoOperacionesApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const folioLote = "IMP-" + new Date().getTime();

  let exitosas = 0;
  let fallidas = [];

  (filas || []).forEach(f=>{
    try{
      registrarSalidaInterna_({
        codigo: f.codigo,
        producto: f.producto,
        cantidad: f.cantidad,
        udm: f.udm || "",
        area: "Importación de requerimiento",
        ubicacion: f.ubicacion || "",
        folio: folioLote,
        observacion: "Salida importada desde archivo: " + (nombreArchivo || "")
      }, usuario);
      exitosas++;
    }catch(e){
      fallidas.push({ producto: f.producto, error: e.message });
    }
  });

  const ss = SpreadsheetApp.getActive();
  const historial = ss.getSheetByName("HISTORIAL_IMPORTACIONES");

  if(historial){
    historial.appendRow([
      new Date(),
      usuario,
      nombreArchivo || "",
      (filas || []).length,
      exitosas,
      fallidas.length
    ]);
  }

  return { exitosas: exitosas, fallidas: fallidas, folio: folioLote };
}

// ============================================
// IMPORTAR SALIDAS DESDE PDF (texto real o escaneado, vía OCR)
// ============================================

/**
 * Recibe el PDF en base64 (lo manda el navegador), lo sube a Drive
 * convirtiéndolo a Google Doc con OCR activado, extrae el texto, borra
 * los archivos temporales, y regresa el texto plano. Funciona igual de
 * bien con un PDF de texto real que con uno escaneado/foto, porque el
 * OCR de Google lee ambos.
 *
 * IMPORTANTE: requiere el servicio avanzado "Drive API" activado en el
 * proyecto (Servicios -> + -> Drive API).
 */
function extraerTextoPDFApp(base64PDF, nombreArchivo, token){

  requerirSesionActivaApp_(token);

  const bytes = Utilities.base64Decode(base64PDF);
  const blob = Utilities.newBlob(bytes, "application/pdf", nombreArchivo || "requerimiento.pdf");

  const recursoArchivo = {
    name: "OCR_TEMP_" + new Date().getTime(),
    mimeType: MimeType.GOOGLE_DOCS
  };

  const archivoConvertido = Drive.Files.create(recursoArchivo, blob, {
    ocr: true,
    ocrLanguage: "es"
  });

  const idDoc = archivoConvertido.id;
  let texto = "";

  try {
    texto = DocumentApp.openById(idDoc).getBody().getText();
  } finally {
    // Limpieza: no queremos dejar basura acumulándose en el Drive.
    try { DriveApp.getFileById(idDoc).setTrashed(true); } catch(e) {}
  }

  return texto;
}

/**
 * De cada línea del texto extraído del PDF intenta sacar "producto" y
 * "cantidad", asumiendo el patrón típico de un pedido: el nombre del
 * producto, seguido de la cantidad, seguido de un precio con "$".
 * Ej: "SALSA COUNTRY 0.5 KG (1 * 0.5 Kg)   22   $23.23   $511.06"
 *      -> producto: "SALSA COUNTRY 0.5 KG (1 * 0.5 Kg)", cantidad: 22
 */
function extraerItemsDesdeTextoPDF_(texto){

  const lineas = String(texto || "")
    .split("\n")
    .map(l => l.trim());

  // El encabezado de la tabla termina en la primera línea que dice
  // exactamente "Total" (después de Código/Nombre/Cantidad/Precio/Total).
  // Todo lo que sigue son los datos, en bloques de 4 líneas:
  // [Nombre de producto] [Cantidad] [Precio] [Total].
  let inicioDatos = -1;

  for(let i = 0; i < lineas.length; i++){
    if(lineas[i].toUpperCase() === "TOTAL"){
      inicioDatos = i + 1;
      break;
    }
  }

  if(inicioDatos === -1) return [];

  const lineasDatos = lineas.slice(inicioDatos).filter(l => l !== "");

  const items = [];

  for(let i = 0; i + 1 < lineasDatos.length; i += 4){

    const nombre = lineasDatos[i];
    const cantidad = Number(String(lineasDatos[i+1]).replace(",", "."));

    // Filtro de seguridad: si "nombre" en realidad es un precio o número
    // suelto, el bloque se desalineó — mejor no meter basura.
    if(nombre && !/^\$/.test(nombre) && !isNaN(cantidad) && cantidad > 0){
      items.push({ productoDocumento: nombre, cantidad: cantidad });
    }

  }

  return items;
}

/**
 * Punto de entrada que llama el frontend: PDF en base64 -> texto (OCR) ->
 * extraer items -> reusar analizarImportacionSalidasApp (EL MISMO motor
 * de coincidencias que usa la importación por Excel).
 */
function analizarPDFRequerimientoApp(base64PDF, nombreArchivo, token){

  requerirSesionActivaApp_(token);

  const texto = extraerTextoPDFApp(base64PDF, nombreArchivo, token);
  const items = extraerItemsDesdeTextoPDF_(texto);

  if(!items.length){
    // No encontramos el patrón esperado. En vez de fallar a ciegas,
    // regresamos un pedazo del texto que sí sacó el OCR para poder
    // ajustar el patrón al formato real del documento.
    const muestra = texto.substring(0, 1200);
    throw new Error(
      "No se identificaron productos con el patrón esperado.\n\n--- TEXTO EXTRAÍDO (primeros 1200 caracteres) ---\n" + muestra
    );
  }

  return analizarImportacionSalidasApp(items, token);
}

function obtenerResumenDashboard(){
  const ss = SpreadsheetApp.getActive();
  const matriz = ss.getSheetByName("MATRIZ");
  const datos = matriz.getDataRange().getValues();
  datos.shift();

  let productos = datos.length;
  let ubicaciones = [];
  let bajo = 0;
  let sinStock = 0;
  let sinUbicacion = 0;

  datos.forEach(f=>{
    let ubicacion=String(f[9]||"").trim();
    let existencia=Number(f[10])||0;
    let minimo=Number(f[11])||0;

    if(ubicacionVacia_(ubicacion)){
      // Producto de temporada / sin ubicación: no maneja stock, no cuenta como agotado ni bajo
      sinUbicacion++;
      return;
    }

    if(!ubicaciones.includes(ubicacion)){
      ubicaciones.push(ubicacion);
    }

    if(existencia<=0){
      sinStock++;
    }

    if(existencia>0 && existencia<=minimo){
      bajo++;
    }
  });

  return {
    productos:productos,
    productosConUbicacion: productos - sinUbicacion,
    sinUbicacion:sinUbicacion,
    ubicaciones:ubicaciones.length,
    bajo:bajo,
    sinStock:sinStock
  };
}

// Escáner de códigos de barras (Fase 5): TODAS las coincidencias exactas
// de un código en MATRIZ — normalmente 0 o 1, pero si por un error de
// captura dos productos quedaron con el mismo Código, esta es la única
// función de todo el proyecto que se entera y lo reporta (buscarFilaMatrizPorCodigo_
// y buscarProductoApp, más abajo, solo devuelven/usan la primera coincidencia,
// ocultando el duplicado en silencio). No modifica MATRIZ ni decide nada —
// solo informa, para que el escáner (o cualquier otro llamador) decida qué
// hacer con más de una coincidencia.
function buscarProductosEnMatrizPorCodigoExacto_(codigo){

  const buscado = String(codigo||"").trim();
  if(!buscado) return [];

  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  const coincidencias = [];

  for(let i=1;i<datos.length;i++){
    if(String(datos[i][4]||"").trim() === buscado){
      coincidencias.push({
        codigo: datos[i][4],
        producto: datos[i][0],
        udm: datos[i][1],
        ubicacion: datos[i][9],
        existencia: Number(datos[i][10]) || 0,
        minimo: Number(datos[i][11]) || 0,
        maximo: Number(datos[i][12]) || 0,
        presentacion: datos[i][19]
      });
    }
  }

  return coincidencias;

}

/**
 * Escáner de códigos de barras (Fase 5): versión pública de
 * buscarProductosEnMatrizPorCodigoExacto_ — el punto de entrada ÚNICO que
 * usa el servicio de escaneo reutilizable (ver TgScanner en index.html)
 * para resolver un código recién escaneado, sin duplicar esta búsqueda en
 * cada pantalla. Regresa un arreglo: vacío si no hay coincidencias, con
 * más de un elemento si el código está duplicado — nunca elige uno al
 * azar, eso lo decide el usuario en la interfaz.
 */
function buscarProductosPorCodigoApp(codigo, token){
  requerirSesionActivaApp_(token);
  return buscarProductosEnMatrizPorCodigoExacto_(codigo);
}

function buscarProductoApp(codigo, token){
  requerirSesionActivaApp_(token);
  const coincidencias = buscarProductosEnMatrizPorCodigoExacto_(codigo);
  if(!coincidencias.length) return null;
  // Mismo comportamiento de siempre: la primera coincidencia. Los
  // llamadores existentes (Entradas/Salidas manuales, etc.) no cambian —
  // el manejo explícito de duplicados vive en buscarProductosPorCodigoApp,
  // usado por el escáner.
  const c = coincidencias[0];
  return { producto: c.producto, udm: c.udm, ubicacion: c.ubicacion, existencia: c.existencia, presentacion: c.presentacion };
}

/**
 * Recalcula una fila de importación cuando el usuario asigna el
 * código manualmente (filas SIN_COINCIDENCIA o STOCK_INSUFICIENTE).
 * Aplica la MISMA lógica de presentación que el matching automático de
 * analizarImportacionSalidasApp — el factor de conversión sale de la
 * columna Presentación de MATRIZ (columna T) del producto ya
 * identificado, nunca de un número suelto tomado del documento.
 */
function recalcularFilaImportacionManualApp(codigo, cantidadPedida, token){

  requerirSesionActivaApp_(token);

  const producto = buscarProductoApp(codigo, token);
  if(!producto) return null;

  const cantidad = Number(cantidadPedida) || 0;
  const presentacionNumero = Number(producto.presentacion) > 0 ? Number(producto.presentacion) : null;
  const presentacionTexto = presentacionNumero !== null ? (formatearCantidad_(presentacionNumero) + " " + (producto.udm||"")) : "";
  const factor = presentacionNumero !== null ? presentacionNumero : 1;
  const cantidadADescontar = Math.round(cantidad * factor * 1000) / 1000;

  let estado = "OK";
  let observaciones = "Asignado manualmente";

  if(cantidadADescontar > producto.existencia){
    estado = "STOCK_INSUFICIENTE";
    observaciones = "Asignado manualmente — Necesario: " + cantidadADescontar + " " + producto.udm +
      " — Disponible: " + producto.existencia + " " + producto.udm +
      " — Faltante: " + Math.round((cantidadADescontar - producto.existencia) * 1000) / 1000 + " " + producto.udm;
  }

  return {
    encontrado: producto.producto,
    codigo: String(codigo).trim(),
    existencia: producto.existencia,
    existenciaResultante: (estado === "OK") ? Math.round((producto.existencia - cantidadADescontar) * 1000) / 1000 : "",
    udm: producto.udm,
    ubicacion: producto.ubicacion,
    presentacionTexto: presentacionTexto || "—",
    factorPresentacion: factor,
    cantidadADescontar: cantidadADescontar,
    score: 1,
    estado: estado,
    observaciones: observaciones
  };

}

function obtenerProductosBajoMinimo(){
  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  return datos
    .filter(f=>{
      const ubicacion = String(f[9]||"").trim();
      if(ubicacionVacia_(ubicacion)) return false; // producto de temporada sin ubicación: no aplica min/max

      const existencia = Number(f[10]) || 0;
      const minimo = Number(f[11]) || 0;
      return existencia <= minimo;
    })
    .map(f=>{
      const existencia = Number(f[10]) || 0;
      return {
        producto: f[0],
        codigo: f[4],
        existencia: existencia,
        minimo: Number(f[11]) || 0,
        ubicacion: f[9],
        estado: existencia <= 0 ? "Agotado" : "Bajo"
      };
    })
    .slice(0, 50);
}

/**
 * Detalle completo de un producto por código, para el modal que se abre
 * al hacer clic en una alerta de inventario: existencia, mínimo, máximo,
 * punto de reorden y fecha del último ingreso (última ENTRADA en KARDEX).
 */
function obtenerDetalleProductoApp(codigo, token){

  requerirSesionActivaApp_(token);

  const ss = SpreadsheetApp.getActive();
  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  const codigoBuscado = String(codigo || "").trim().toUpperCase();
  let producto = null;

  for (let i = 0; i < datos.length; i++) {
    const f = datos[i];
    if (String(f[4] || "").trim().toUpperCase() === codigoBuscado) {
      const ubic = String(f[9] || "").trim();
      producto = {
        producto: f[0],
        udm: f[1],
        codigo: f[4],
        rack: f[6],
        ubicacion: ubicacionVacia_(ubic) ? "Sin ubicación" : ubic,
        existencia: Number(f[10]) || 0,
        minimo: Number(f[11]) || 0,
        maximo: Number(f[12]) || 0,
        proveedor: f[16] || "",
        ultimoIngreso: null
      };
      break;
    }
  }

  if (!producto) return null;

  // Punto de reorden: por ahora igual al mínimo (no hay una fórmula distinta definida).
  producto.puntoReorden = producto.minimo;

  // Último ingreso: fecha más reciente marcada como ENTRADA en KARDEX para este código.
  const kardex = ss.getSheetByName("KARDEX");

  if (kardex && kardex.getLastRow() > 1) {

    const movs = obtenerFilasHojaCacheadas_("KARDEX");
    movs.shift();
    let fechaMasReciente = null;

    for (let i = 0; i < movs.length; i++) {
      const fila = movs[i];
      const tipoMov = String(fila[2] || "").toUpperCase();
      const codigoMov = String(fila[4] || "").trim().toUpperCase();

      if (codigoMov === codigoBuscado && tipoMov === "ENTRADA") {
        const fecha = fila[0] instanceof Date ? fila[0] : new Date(fila[0]);
        if (!fechaMasReciente || fecha > fechaMasReciente) {
          fechaMasReciente = fecha;
        }
      }
    }

    if (fechaMasReciente) {
      producto.ultimoIngreso = Utilities.formatDate(
        fechaMasReciente, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"
      );
    }
  }

  return producto;
}

/**
 * Regresa el listado completo (sin límite de 50) de productos con ubicación,
 * separados por estado, para el modal de "Stock crítico" en Inicio.
 * tipo: "critico" (agotado + bajo mínimo) u "optimo" (arriba del mínimo).
 */
function obtenerProductosPorEstadoStock(tipo, token){
  // Mismo hallazgo que obtenerInventario (ver comentario ahí) — la usa
  // activamente el modal "Stock crítico" del Dashboard.
  requerirSesionActivaApp_(token);
  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datos = hoja.getDataRange().getValues();
  datos.shift();

  return datos
    .filter(f=>{
      const ubicacion = String(f[9]||"").trim();
      if(ubicacionVacia_(ubicacion)) return false; // sin ubicación: no aplica min/max

      const existencia = Number(f[10]) || 0;
      const minimo = Number(f[11]) || 0;
      const esCritico = existencia <= minimo;

      return tipo === "optimo" ? !esCritico : esCritico;
    })
    .map(f=>{
      const existencia = Number(f[10]) || 0;
      const minimo = Number(f[11]) || 0;
      return {
        producto: f[0],
        codigo: f[4],
        existencia: existencia,
        minimo: minimo,
        ubicacion: f[9],
        estado: existencia <= 0 ? "Agotado" : (existencia <= minimo ? "Bajo" : "Óptimo")
      };
    });
}

function obtenerMovimientosRecientes(limite){
  return obtenerKardex_(limite || 8);
}

function obtenerEntradasSalidas7dias(){
  const ss = SpreadsheetApp.getActive();
  const kardex = ss.getSheetByName("KARDEX");

  if(!kardex){
    return { labels: [], entradas: [], salidas: [] };
  }

  const datos = obtenerFilasHojaCacheadas_("KARDEX");
  datos.shift();

  const hoy = new Date();
  hoy.setHours(0,0,0,0);

  const dias = [];
  for(let i=6; i>=0; i--){
    const d = new Date(hoy);
    d.setDate(d.getDate() - i);
    dias.push(d);
  }

  const labels = dias.map(d => Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM"));

  // Un Set por día: cuenta PRODUCTOS DISTINTOS que tuvieron entrada/salida,
  // no la suma de cantidad (así un solo ingreso de 500kg ya no infla la barra).
  const productosEntrada = dias.map(()=> new Set());
  const productosSalida = dias.map(()=> new Set());

  datos.forEach(fila=>{
    const fecha = new Date(fila[0]);
    fecha.setHours(0,0,0,0);

    const codigo = String(fila[4] || "");
    if(!codigo) return;

    dias.forEach((d, i)=>{
      if(fecha.getTime() === d.getTime()){
        if(fila[2] === "ENTRADA"){ productosEntrada[i].add(codigo); }
        if(fila[2] === "SALIDA"){ productosSalida[i].add(codigo); }
      }
    });
  });

  const entradas = productosEntrada.map(s => s.size);
  const salidas = productosSalida.map(s => s.size);

  return { labels: labels, entradas: entradas, salidas: salidas };
}

function obtenerDashboardMovil(){
  const ss = SpreadsheetApp.getActive();

  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  let productos = datos.length;
  let ubicaciones = [];
  let normal = 0;
  let bajo = 0;
  let sinStock = 0;
  let sinUbicacion = 0;

  datos.forEach(f=>{
    let ubicacion = String(f[9]||"").trim();
    let existencia = Number(f[10]) || 0;
    let minimo = Number(f[11]) || 0;

    if(ubicacionVacia_(ubicacion)){
      // Producto de temporada / sin ubicación: se excluye de las métricas de stock
      sinUbicacion++;
      return;
    }

    if(!ubicaciones.includes(ubicacion)){
      ubicaciones.push(ubicacion);
    }

    if(existencia <= 0){
      sinStock++;
    }
    else if(existencia <= minimo){
      bajo++;
    }
    else{
      normal++;
    }
  });

  let entradas = 0;
  let salidas = 0;

  const kardex = ss.getSheetByName("KARDEX");

  if(kardex){
    const mov = obtenerFilasHojaCacheadas_("KARDEX");
    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    for(let i=1;i<mov.length;i++){
      let fecha = new Date(mov[i][0]);
      fecha.setHours(0,0,0,0);

      if(fecha.getTime()==hoy.getTime()){
        if(mov[i][2]=="ENTRADA"){
          entradas++;
        }
        if(mov[i][2]=="SALIDA"){
          salidas++;
        }
      }
    }
  }

  return {
    productos: productos,
    productosConUbicacion: productos - sinUbicacion,
    sinUbicacion: sinUbicacion,
    ubicaciones: ubicaciones.length,
    normal: normal,
    bajo: bajo,
    sinStock: sinStock,
    entradas: entradas,
    salidas: salidas
  };
}

/**
 * NUEVO: historial de AUDITORIA_AJUSTES para la vista "Ajustes de inventario".
 */
function obtenerAjustesInventarioApp(limite, token){
  requerirSesionActivaApp_(token);
  const hoja = SpreadsheetApp.getActive().getSheetByName("AUDITORIA_AJUSTES");
  if(!hoja) return [];

  const datos = hoja.getDataRange().getValues();
  datos.shift();
  const zona = Session.getScriptTimeZone();

  const ajustes = datos.map(f => ({
    fecha: Utilities.formatDate(new Date(f[0]), zona, "dd/MM/yyyy HH:mm"),
    codigo: f[1],
    producto: f[2],
    existenciaAnterior: f[3],
    existenciaNueva: f[4],
    diferencia: f[5],
    usuario: f[6],
    motivo: f[7],
    rack: f[8]
  }));

  ajustes.reverse();
  return ajustes.slice(0, limite || 100);
}

/**
 * NUEVO: versiones para la app web de las funciones de conteo cíclico que en
 * tu script de la hoja usan SpreadsheetApp.getUi() (eso truena en la app web).
 * Reusan la misma lógica pero regresan datos en vez de mostrar alerts.
 */
function obtenerRacksConteoApp(token){
  requerirSesionActivaApp_(token);
  return obtenerRacksConteo();
}

function generarConteoRacksApp(racks, token){
  requerirAccesoAlmacenApp_(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matriz = ss.getSheetByName("MATRIZ");
  const conteo = ss.getSheetByName("CONTEO_CICLICO");

  const datos = matriz.getRange(2,1,matriz.getLastRow()-1,17).getValues();
  const fecha = new Date();
  const usuario = obtenerNombreDesdeToken(token);

  let folioConteo, salida;

  conBloqueoApp_(function(){

    salida = [];
    const fechaCodigo = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyyMMdd");

    let consecutivo = 1;

    if(conteo.getLastRow() > 1){
      const folios = conteo.getRange(2,1,conteo.getLastRow()-1,1).getValues().flat();
      // Un folio genera UNA fila por producto contado, así que contar filas
      // (en vez de folios distintos) hacía que el consecutivo del día
      // saltara números (p. ej. el 2° conteo del día salía "-006" en vez
      // de "-002" si el 1° abarcó 5 productos). Nunca colisionaba, pero
      // no era estrictamente consecutivo.
      const foliosHoy = new Set(folios.filter(f => f.toString().includes("CC-"+fechaCodigo)).map(f => f.toString()));
      consecutivo = foliosHoy.size + 1;
    }

    folioConteo = "CC-"+fechaCodigo+"-"+Utilities.formatString("%03d", consecutivo);

    datos.forEach(fila=>{
      let rackProducto = fila[6];

      if(racks.includes(rackProducto) && fila[4] && fila[9]){
        salida.push([
          folioConteo, fecha, usuario, fila[4], fila[0], fila[9], fila[10], "", "", "PENDIENTE", rackProducto
        ]);
      }
    });

    if(salida.length > 0){
      conteo.getRange(conteo.getLastRow()+1, 1, salida.length, 11).setValues(salida);
    }

  });

  registrarControlConteo(folioConteo, fecha, usuario, racks, salida.length);

  registrarAuditoria(
    usuario, "CONTEO", "GENERACION CONTEO", folioConteo, "", "", 0, salida.length,
    "Conteo generado (app) para racks: "+racks.join(", ")
  );

  return { folio: folioConteo, productos: salida.length, racks: racks };
}

// ============================================
// PROGRAMACIÓN DE CONTEOS CÍCLICOS (PROGRAMACION_CONTEOS)
// ============================================

/**
 * Revisa PROGRAMACION_CONTEOS y regresa los racks que "tocan" hoy:
 * el día de la semana coincide con la columna Dia, Y según la Frecuencia
 * (SEMANAL/QUINCENAL/MENSUAL) ya pasó suficiente tiempo desde la última
 * generación (columna G) — o nunca se ha generado.
 */
function obtenerConteosProgramadosHoyApp(token){
  requerirSesionActivaApp_(token);
  return obtenerConteosProgramadosHoyApp_();
}

// Versión interna sin sesión — la usa también el aviso por correo de las
// 6 a.m. (Notificaciones.gs), que corre desde un disparador de tiempo sin
// ningún usuario ni token detrás.
function obtenerConteosProgramadosHoyApp_(){

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("PROGRAMACION_CONTEOS");

  if(!hoja || hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();

  const diasSemana = ["DOMINGO","LUNES","MARTES","MIERCOLES","JUEVES","VIERNES","SABADO"];
  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  const diaHoyTexto = diasSemana[hoy.getDay()];

  const umbralDias = { "SEMANAL": 6, "QUINCENAL": 13, "MENSUAL": 27 };

  const programados = [];

  datos.forEach((fila, i) => {

    const rack = String(fila[1] || "").trim();
    const dia = normalizarTexto_(fila[2]);
    const frecuenciaTexto = String(fila[3] || "").trim();
    const frecuenciaNorm = normalizarTexto_(fila[3]);
    const responsable = fila[4];
    const ultimaGeneracion = fila[6];

    if(!rack || dia !== diaHoyTexto) return;

    let toca = false;

    if(!ultimaGeneracion){
      toca = true;
    } else {
      const fechaUltima = ultimaGeneracion instanceof Date ? ultimaGeneracion : new Date(ultimaGeneracion);
      fechaUltima.setHours(0,0,0,0);
      const diasDesde = Math.round((hoy - fechaUltima) / (1000*60*60*24));
      const umbral = umbralDias[frecuenciaNorm];
      toca = umbral !== undefined ? diasDesde >= umbral : true;
    }

    if(toca){
      programados.push({
        fila: i + 2,
        id: fila[0],
        rack: rack,
        frecuencia: frecuenciaTexto,
        responsable: responsable,
        ultimaGeneracion: ultimaGeneracion
          ? Utilities.formatDate(
              ultimaGeneracion instanceof Date ? ultimaGeneracion : new Date(ultimaGeneracion),
              Session.getScriptTimeZone(), "dd/MM/yyyy"
            )
          : "Nunca"
      });
    }

  });

  return programados;
}

/**
 * Actualiza la columna "Última generación" (G) en PROGRAMACION_CONTEOS
 * para las filas indicadas, después de generar el conteo desde la tarjeta
 * de Inicio — así no se vuelve a sugerir hasta que le vuelva a tocar.
 */
function marcarConteoProgramadoGeneradoApp(filas, token){

  requerirAccesoAlmacenApp_(token);

  const ss = SpreadsheetApp.getActive();
  const hoja = ss.getSheetByName("PROGRAMACION_CONTEOS");

  if(!hoja) return { ok: false };

  const hoy = new Date();

  // getRangeList + un solo setValue() en vez de un setValue() por fila:
  // mismo resultado (todas las filas reciben la misma fecha), una sola
  // llamada a la API de Sheets en vez de N — importante porque "filas"
  // no es necesariamente contiguo (racks marcados a mano en la pantalla).
  const filasValidas = (filas || []).filter(fila => Number(fila) > 0);
  if(filasValidas.length){
    const rangos = filasValidas.map(fila => "G" + fila);
    hoja.getRangeList(rangos).setValue(hoy);
  }

  return { ok: true };
}

function revisarDiscrepanciasApp(token){
  requerirSesionActivaApp_(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const conteo = ss.getSheetByName("CONTEO_CICLICO");
  const diferencias = ss.getSheetByName("DISCREPANCIAS");

  const datos = conteo.getRange(2,1,conteo.getLastRow()-1,11).getValues();
  let salida = [];

  datos.forEach(fila=>{
    let sistema = Number(fila[6]) || 0;
    let fisico = Number(fila[7]) || 0;
    let diferencia = fisico - sistema;

    if(fila[7] !== "" && diferencia != 0 && fila[9] == "DIFERENCIA"){
      salida.push([
        new Date(), fila[0], fila[3], fila[4], fila[5], fila[6], fila[7], diferencia, fila[10],
        "PENDIENTE", "", "", "", ""
      ]);
    }
  });

  if(salida.length > 0){
    diferencias.getRange(diferencias.getLastRow()+1, 1, salida.length, 14).setValues(salida);
  }

  return { encontradas: salida.length };
}

function cerrarConteoFolioApp(folio, token){
  requerirAccesoAlmacenApp_(token);
  const ss = SpreadsheetApp.getActive();
  const conteo = ss.getSheetByName("CONTEO_CICLICO");
  const historial = ss.getSheetByName("HISTORIAL_CONTEOS");
  const auditoria = ss.getSheetByName("AUDITORIA_AJUSTES");
  const control = ss.getSheetByName("CONTROL_CONTEOS");

  if(!auditoria){
    throw new Error("No se encontró la hoja 'AUDITORIA_AJUSTES'. Revisa que el nombre sea exactamente ese.");
  }

  const ultimaFila = conteo.getLastRow();

  if(ultimaFila < 2){
    throw new Error("No hay conteos para cerrar");
  }

  // Estado ya resuelto (por folio+código) en DISCREPANCIAS, si alguien ya
  // pasó por la pantalla de "Aprobar/Rechazar Discrepancias" antes de
  // cerrar este folio. Si hay varias filas para el mismo folio+código
  // (p. ej. por una revisión repetida), se queda con la última — el
  // estado más reciente.
  const estadoDiscrepanciaPorProducto = {};
  const hojaDiscrepancias = ss.getSheetByName("DISCREPANCIAS");
  if(hojaDiscrepancias && hojaDiscrepancias.getLastRow() > 1){
    const datosDiscrepancias = hojaDiscrepancias.getRange(2, 1, hojaDiscrepancias.getLastRow()-1, 10).getValues();
    datosDiscrepancias.forEach(d => {
      if(String(d[1]) !== String(folio)) return; // columna B = Folio
      estadoDiscrepanciaPorProducto[String(d[2])] = String(d[9]||"").trim().toUpperCase(); // columna C = Código, J = Estado
    });
  }

  const datos = conteo.getRange(2,1,ultimaFila-1,11).getValues();

  let historialDatos = [];
  let auditoriaDatos = [];
  let ajustesKardex = [];
  let pendientes = 0;
  let filasIndices = [];

  const usuario = obtenerNombreDesdeToken(token);
  const fechaHoy = new Date();

  datos.forEach((fila, i) => {

    if(fila[3] == "") return;
    if(fila[0] != folio) return;

    filasIndices.push(i);

    if(fila[7] === "" || fila[7] === null || fila[7] === undefined){
      pendientes++;
      return;
    }

    const existenciaAnterior = Number(fila[6]);
    const existenciaNueva   = Number(fila[7]);
    const diferencia        = Number(fila[8]);

    let resultado = "CORRECTO";
    if(diferencia != 0){
      resultado = "AJUSTADO";
    }

    historialDatos.push([
      fila[0], fila[1], fila[2], fila[3], fila[4], fila[5],
      fila[6], fila[7], fila[8], resultado, new Date(), usuario
    ]);

    // Si esta diferencia ya se resolvió individualmente en la pantalla de
    // Aprobar/Rechazar Discrepancias, el cierre del folio ya NO decide
    // por su cuenta: si fue RECHAZADA, no se toca MATRIZ; si ya fue
    // APROBADA, el ajuste ya se aplicó en ese momento y no se repite aquí
    // (antes el cierre ignoraba esto por completo y podía aplicar un
    // ajuste ya rechazado, o duplicarlo si ya había sido aprobado).
    const estadoResuelto = estadoDiscrepanciaPorProducto[String(fila[3])];
    const yaResueltaIndividualmente = estadoResuelto === "RECHAZADO" || estadoResuelto === "APROBADO";

    if(resultado == "AJUSTADO" && !yaResueltaIndividualmente){
      auditoriaDatos.push([
        fechaHoy, fila[3], fila[4], existenciaAnterior, existenciaNueva, diferencia,
        usuario, "Ajuste por conteo cíclico " + folio, fila[10] || ""
      ]);
      ajustesKardex.push({
        codigo: fila[3], producto: fila[4], diferencia: diferencia,
        existenciaAnterior: existenciaAnterior, existenciaNueva: existenciaNueva
      });
    }

  });

  if(pendientes > 0){
    throw new Error("El conteo todavía tiene " + pendientes + " productos pendientes");
  }

  if(historialDatos.length > 0){
    historial.getRange(historial.getLastRow()+1, 1, historialDatos.length, 12).setValues(historialDatos);
  }

  if(auditoriaDatos.length > 0){
    auditoria.getRange(auditoria.getLastRow()+1, 1, auditoriaDatos.length, 9).setValues(auditoriaDatos);
  }

  // Actualizar Existencia → Guardar Kardex (misma función central que usan
  // Entradas, Salidas e Inventario Mensual — antes esto nunca se hacía
  // aquí y la existencia solo se movía si la fórmula de MATRIZ la jalaba).
  ajustesKardex.forEach(a => {
    actualizarExistenciaMatriz_(a.codigo, a.existenciaNueva);
    registrarKardex(
      "AJUSTE", folio, a.codigo, a.producto,
      a.diferencia > 0 ? a.diferencia : "",
      a.diferencia < 0 ? Math.abs(a.diferencia) : "",
      a.existenciaAnterior, a.existenciaNueva, usuario,
      "Ajuste por conteo cíclico " + folio
    );
  });

  filasIndices.forEach(i => {
    conteo.getRange(i+2, 10, 1, 1).setValue("CERRADO");
  });

  if(control){
    const datosControl = control.getRange(2,1,control.getLastRow()-1,8).getValues();
    for(let i=0;i<datosControl.length;i++){
      if(datosControl[i][0] == folio){
        control.getRange(i+2,8).setValue("CERRADO");
        break;
      }
    }
  }

  return { productosGuardados: historialDatos.length, ajustesRegistrados: auditoriaDatos.length };
}

/**
 * NUEVO: cuenta discrepancias pendientes y conteos cíclicos abiertos,
 * para las tarjetas KPI del dashboard de Inicio.
 */
/**
 * Fase 7 (rendimiento): antes esta función leía DISCREPANCIAS y
 * CONTROL_CONTEOS directo de la hoja (getRange().getValues()), sin pasar
 * por obtenerFilasHojaCacheadas_ — la única lectura del Dashboard que no
 * usaba la caché de 20s. Como esta función se llama DOS VECES en cada
 * carga del Dashboard (una vez dentro de obtenerResumenInicioApp, otra
 * dentro de obtenerNotificacionesApp — dos viajes RPC separados que el
 * frontend dispara juntos), esas dos hojas se leían completas dos veces
 * seguidas sin ninguna razón. Ahora comparte la misma caché que ya usa
 * el resto del Dashboard.
 */
function obtenerContadoresControl(){
  let discrepancias = 0;
  let conteosAbiertos = 0;

  const datosDiscrepancias = obtenerFilasHojaCacheadas_("DISCREPANCIAS");
  if(datosDiscrepancias.length > 1){
    discrepancias = datosDiscrepancias.slice(1).filter(d=>d[9]=="PENDIENTE").length;
  }

  const datosControl = obtenerFilasHojaCacheadas_("CONTROL_CONTEOS");
  if(datosControl.length > 1){
    conteosAbiertos = datosControl.slice(1).filter(e=>e[7] != "CERRADO").length;
  }

  return { discrepancias: discrepancias, conteosAbiertos: conteosAbiertos };
}

/**
 * Campana de notificaciones del header — antes solo mandaba inventario
 * bajo mínimo/agotado (obtenerProductosBajoMinimo, sin token, visible
 * para cualquiera, sin cambios aquí). Ahora también junta, en un solo
 * viaje al servidor, conteos cíclicos sin cerrar y requisiciones
 * PENDIENTE (Área + Sucursal) — pero esto sí es información operativa
 * de Almacén/CEDIS, así que usa el MISMO criterio de acceso que ya
 * protege "Requisiciones Pendientes"/"Entregas Recientes"
 * (obtenerAccesoRequisicionesApp().esAdmin: rol ADMIN o Área "Almacén").
 * Un usuario normal de área/sucursal sigue viendo solo sus alertas de
 * inventario, igual que siempre.
 *
 * Cada elemento trae "clave" (para el dedup de "ya vista" en
 * localStorage, reemplaza el viejo codigo+estado ad-hoc) y "urgente"
 * (true si la fecha requerida de una requisición ya venció o es
 * hoy/mañana — así el front puede resaltarla sin tener que rehacer la
 * cuenta de días).
 */
// COM-03 (auditoría comparativa vs. MarketMan): antes, HISTORIAL_PRECIOS ya
// calculaba el %Cambio de cada cambio de precio pero nadie lo consultaba de
// forma proactiva — había que entrar a Análisis de Costos a buscarlo. Estas
// dos constantes son los únicos números que definen "inusual": cualquier
// cambio de precio con |%| >= UMBRAL_VARIACION_PRECIO_ que haya ocurrido en
// los últimos VENTANA_VARIACION_PRECIO_DIAS_ días aparece en la campana de
// notificaciones — pasada esa ventana, deja de mostrarse solo (no hace
// falta "descartar" nada a mano, ni queda para siempre en la lista).
const UMBRAL_VARIACION_PRECIO_ = 20;
const UMBRAL_VARIACION_PRECIO_URGENTE_ = 40;
const VENTANA_VARIACION_PRECIO_DIAS_ = 7;

function obtenerVariacionesPrecioInusualesRecientes_(){

  const hoja = SpreadsheetApp.getActive().getSheetByName("HISTORIAL_PRECIOS");
  if(!hoja || hoja.getLastRow() < 2) return [];

  const desde = new Date();
  desde.setDate(desde.getDate() - VENTANA_VARIACION_PRECIO_DIAS_);

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 10).getValues();
  const resultado = [];

  datos.forEach(f=>{
    const fecha = f[0] instanceof Date ? f[0] : new Date(f[0]);
    if(isNaN(fecha.getTime()) || fecha < desde) return;

    const porcentaje = Number(f[7]) || 0;
    if(Math.abs(porcentaje) < UMBRAL_VARIACION_PRECIO_) return;

    resultado.push({
      fecha: fecha,
      codigo: f[1],
      producto: f[2],
      proveedor: f[3] || "Sin proveedor asignado",
      precioAnterior: Number(f[4]) || 0,
      precioNuevo: Number(f[5]) || 0,
      porcentaje: porcentaje
    });
  });

  return resultado;

}

function obtenerNotificacionesApp(token){

  requerirSesionActivaApp_(token);

  const resultado = [];

  (obtenerProductosBajoMinimo() || []).forEach(p => {
    resultado.push({
      tipo: "inventario",
      clave: "inventario|" + p.codigo + "|" + p.estado,
      titulo: p.producto,
      detalle: p.estado + " — existencia " + p.existencia + " (mín. " + p.minimo + ")",
      urgente: p.estado === "Agotado",
      datos: { codigo: p.codigo, estado: p.estado }
    });
  });

  const accesoArea = obtenerAccesoRequisicionesApp(token);
  if(!accesoArea.esAdmin) return resultado;

  obtenerVariacionesPrecioInusualesRecientes_().forEach(v => {
    const subioOBajo = v.porcentaje > 0 ? "subió" : "bajó";
    resultado.push({
      tipo: "variacion-precio",
      clave: "variacion-precio|" + v.codigo + "|" + v.fecha.getTime(),
      titulo: "Variación de precio inusual — " + v.producto,
      detalle: "Precio " + subioOBajo + " " + Math.abs(v.porcentaje) + "% ($" + v.precioAnterior + " → $" + v.precioNuevo + ") — " + v.proveedor,
      urgente: Math.abs(v.porcentaje) >= UMBRAL_VARIACION_PRECIO_URGENTE_,
      datos: { codigo: v.codigo }
    });
  });

  const contadores = obtenerContadoresControl();
  if(contadores.conteosAbiertos > 0){
    resultado.push({
      tipo: "conteo",
      clave: "conteo|" + contadores.conteosAbiertos,
      titulo: "Conteos cíclicos pendientes",
      detalle: contadores.conteosAbiertos + " conteo(s) sin cerrar",
      urgente: false,
      datos: {}
    });
  }

  const hoy = new Date();
  hoy.setHours(0,0,0,0);

  function esUrgente_(fechaTexto){
    if(!fechaTexto) return false;
    const partes = String(fechaTexto).split("/"); // dd/MM/yyyy, como la devuelve obtenerRequisicionesApp/obtenerRequisicionesSucursalApp
    if(partes.length !== 3) return false;
    const fecha = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
    if(isNaN(fecha.getTime())) return false;
    const dias = Math.round((fecha - hoy) / 86400000);
    return dias <= 1; // vencida, hoy o mañana
  }

  obtenerRequisicionesApp(token).filter(r => r.estado === "PENDIENTE").forEach(r => {
    resultado.push({
      tipo: "requisicion-area",
      clave: "requisicion-area|" + r.folio,
      titulo: "Requisición pendiente — " + r.area,
      detalle: "Folio " + r.folio + (r.fechaRequerida ? " · Requerida " + r.fechaRequerida : ""),
      urgente: esUrgente_(r.fechaRequerida),
      datos: { folio: r.folio }
    });
  });

  obtenerRequisicionesSucursalApp(token).filter(r => r.estado === "PENDIENTE").forEach(r => {
    resultado.push({
      tipo: "requisicion-sucursal",
      clave: "requisicion-sucursal|" + r.folio,
      titulo: "Requisición pendiente — Sucursal " + r.sucursal,
      detalle: "Folio " + r.folio + (r.fechaRequerida ? " · Requerida " + r.fechaRequerida : ""),
      urgente: esUrgente_(r.fechaRequerida),
      datos: { folio: r.folio }
    });
  });

  return resultado;

}

/**
 * NUEVO: agrupa MATRIZ por RACK x NIVEL para el "mapa de calor" de Inicio.
 */
function obtenerMapaCalorRacks(){
  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  const celdas = {};
  const racksSet = {};
  const nivelesSet = {};

  datos.forEach(f=>{
    const ubicacion = String(f[9]||"").trim();
    if(ubicacionVacia_(ubicacion)) return;

    const partes = String(ubicacion).split("-");
    const rack = partes[0] || "";
    const nivel = partes[1] || "";
    if(!rack || !nivel) return;

    racksSet[rack] = true;
    nivelesSet[nivel] = true;

    const clave = rack + "|" + nivel;
    celdas[clave] = (celdas[clave] || 0) + 1;
  });

  const racks = Object.keys(racksSet).sort();
  const niveles = Object.keys(nivelesSet).sort();

  let max = 0;
  Object.keys(celdas).forEach(k=>{ if(celdas[k] > max) max = celdas[k]; });

  const filas = niveles.map(nivel=>{
    return racks.map(rack=>{
      const cantidad = celdas[rack + "|" + nivel] || 0;
      return {
        rack: rack,
        nivel: nivel,
        cantidad: cantidad,
        intensidad: max === 0 ? 0 : cantidad / max
      };
    });
  });

  return { racks: racks, niveles: niveles, filas: filas };
}

/**
 * Top 10 productos con más ENTRADAS, más SALIDAS, y de mayor ROTACIÓN
 * (entradas+salidas) durante el mes en curso, leyendo KARDEX.
 */
function obtenerTopMovimientosMesApp(token){

  requerirSesionActivaApp_(token);

  const ss = SpreadsheetApp.getActive();
  const kardex = ss.getSheetByName("KARDEX");

  const vacio = { entradas: [], salidas: [], rotacion: [] };

  if(!kardex || kardex.getLastRow() < 2) return vacio;

  const datos = obtenerFilasHojaCacheadas_("KARDEX");
  datos.shift();

  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();

  const entradasPorCodigo = {};
  const salidasPorCodigo = {};

  datos.forEach(fila=>{

    const fecha = fila[0] instanceof Date ? fila[0] : new Date(fila[0]);
    if(fecha.getMonth() !== mesActual || fecha.getFullYear() !== anioActual) return;

    const tipo = String(fila[2]||"").toUpperCase();
    const codigo = String(fila[4]||"");
    const producto = String(fila[5]||"");
    if(!codigo) return;

    // fila[6]=entrada/cantidad, fila[7]=salida (según qué esquema la escribió)
    const cantidad = Number(fila[6]) || Number(fila[7]) || 0;
    if(cantidad <= 0) return;

    if(tipo === "ENTRADA"){
      if(!entradasPorCodigo[codigo]){ entradasPorCodigo[codigo] = { codigo:codigo, producto:producto, veces:0, cantidadTotal:0 }; }
      entradasPorCodigo[codigo].veces += 1;
      entradasPorCodigo[codigo].cantidadTotal += cantidad;
    }

    if(tipo === "SALIDA"){
      if(!salidasPorCodigo[codigo]){ salidasPorCodigo[codigo] = { codigo:codigo, producto:producto, veces:0, cantidadTotal:0 }; }
      salidasPorCodigo[codigo].veces += 1;
      salidasPorCodigo[codigo].cantidadTotal += cantidad;
    }

  });

  // "Top" = las que MÁS VECES tuvieron un movimiento en el mes, no las de
  // mayor cantidad acumulada (5 salidas de 100kg > 1 sola salida de 2000kg).
  const listaEntradas = Object.values(entradasPorCodigo).sort((a,b)=> b.veces - a.veces).slice(0,10);
  const listaSalidas = Object.values(salidasPorCodigo).sort((a,b)=> b.veces - a.veces).slice(0,10);

  const rotacionPorCodigo = {};

  Object.values(entradasPorCodigo).forEach(e=>{
    rotacionPorCodigo[e.codigo] = { codigo:e.codigo, producto:e.producto, veces:e.veces };
  });

  Object.values(salidasPorCodigo).forEach(s=>{
    if(!rotacionPorCodigo[s.codigo]){
      rotacionPorCodigo[s.codigo] = { codigo:s.codigo, producto:s.producto, veces:0 };
    }
    rotacionPorCodigo[s.codigo].veces += s.veces;
  });

  const listaRotacion = Object.values(rotacionPorCodigo).sort((a,b)=> b.veces - a.veces).slice(0,10);

  return { entradas: listaEntradas, salidas: listaSalidas, rotacion: listaRotacion };

}

/**
 * Valor monetario total del inventario: existencia x costo unitario
 * (MATRIZ columna R). Solo cuenta productos con existencia y costo > 0.
 */
function obtenerValorInventarioApp(token){

  requerirSesionActivaApp_(token);

  const ss = SpreadsheetApp.getActive();
  const matriz = ss.getSheetByName("MATRIZ");

  if(!matriz || matriz.getLastRow() < 2){
    return { total: 0, productosConCosto: 0, productosSinCosto: 0 };
  }

  const datos = obtenerFilasHojaCacheadas_("MATRIZ"); // A..T (o lo que la hoja tenga)
  datos.shift();

  let total = 0;
  let productosConCosto = 0;
  let productosSinCosto = 0;

  datos.forEach(f=>{
    const existencia = Number(f[10]) || 0;
    const costo = Number(f[17]) || 0; // columna R
    const convertir = f[18]; // columna S
    const presentacion = f[19]; // columna T

    if(existencia > 0){
      if(costo > 0){
        total += calcularValorInventario_(existencia, costo, convertir, presentacion);
        productosConCosto++;
      } else {
        productosSinCosto++;
      }
    }
  });

  return {
    total: Math.round(total * 100) / 100,
    productosConCosto: productosConCosto,
    productosSinCosto: productosSinCosto
  };

}

/**
 * Top 10 más urgentes de "bajo mínimo" (reusa obtenerProductosBajoMinimo,
 * solo ordena por qué tan lejos están del mínimo y recorta a 10).
 */
function obtenerTopBajoMinimoApp(token){
  requerirSesionActivaApp_(token);
  return obtenerProductosBajoMinimo()
    .slice()
    .sort((a,b)=> (a.existencia - a.minimo) - (b.existencia - b.minimo))
    .slice(0, 10);
}

/**
 * Un solo endpoint para las 5 tarjetas nuevas del dashboard: top entradas,
 * top salidas, top rotación, top bajo mínimo y valor de inventario.
 */
function obtenerResumenExtraDashboardApp(token){

  requerirSesionActivaApp_(token);

  const movimientos = obtenerTopMovimientosMesApp(token);

  return {
    topEntradas: movimientos.entradas,
    topSalidas: movimientos.salidas,
    topRotacion: movimientos.rotacion,
    bajoMinimo: obtenerTopBajoMinimoApp(token),
    valorInventario: obtenerValorInventarioApp(token)
  };

}

/**
 * REPORTES (dashboard ejecutivo) — a diferencia de Inicio (operativo,
 * "qué hago ahora"), esto es valor/tendencia/salud del negocio: cuánto
 * vale el inventario y en qué está concentrado, y cómo se mueve mes a
 * mes, no día a día. Agrupa MATRIZ (una sola pasada, ya cacheada) por
 * Categoría y por Proveedor, sumando valor con la MISMA
 * calcularValorInventario_ que ya usa "Valor monetario del inventario"
 * en Inicio — ningún cálculo nuevo, solo una agrupación nueva sobre el
 * mismo número.
 */
function obtenerValorInventarioAgrupadoApp_(indiceColumna){

  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  const porGrupo = {};

  datos.forEach(f=>{
    const existencia = Number(f[10]) || 0;
    const costo = Number(f[17]) || 0;
    if(existencia <= 0 || costo <= 0) return;

    const convertir = f[18];
    const presentacion = f[19];
    const valor = calcularValorInventario_(existencia, costo, convertir, presentacion);

    const grupo = String(f[indiceColumna] || "Sin clasificar").trim() || "Sin clasificar";
    if(!porGrupo[grupo]) porGrupo[grupo] = { nombre: grupo, valor: 0, productos: 0 };
    porGrupo[grupo].valor += valor;
    porGrupo[grupo].productos += 1;
  });

  const lista = Object.values(porGrupo)
    .map(g => ({ nombre: g.nombre, valor: Math.round(g.valor * 100) / 100, productos: g.productos }))
    .sort((a,b) => b.valor - a.valor);

  // Top 7 + "Otros" agrupado, para que la gráfica no se llene de rebanadas
  // ilegibles cuando el catálogo tiene muchas categorías/proveedores.
  if(lista.length <= 8) return lista;

  const top = lista.slice(0, 7);
  const resto = lista.slice(7);
  const otros = resto.reduce((acc, g) => ({
    nombre: "Otros (" + resto.length + ")", valor: Math.round((acc.valor + g.valor) * 100) / 100, productos: acc.productos + g.productos
  }), { nombre: "Otros", valor: 0, productos: 0 });

  return top.concat([otros]);

}

/**
 * Tendencia mensual (últimos 6 meses) — a diferencia de
 * obtenerEntradasSalidas7dias (productos DISTINTOS por día, para "qué
 * pasó hoy"), esto sirve para ver ritmo de negocio: CANTIDAD total
 * movida (kg/pz/etc., sumando la columna Entrada o Salida de KARDEX)
 * por mes, no un conteo de productos distintos.
 */
function obtenerTendenciaMensualApp(token){

  requerirSesionActivaApp_(token);

  const kardex = SpreadsheetApp.getActive().getSheetByName("KARDEX");
  if(!kardex || kardex.getLastRow() < 2){
    return { labels: [], entradas: [], salidas: [] };
  }

  const datos = obtenerFilasHojaCacheadas_("KARDEX");
  datos.shift();

  const hoy = new Date();
  const meses = [];
  for(let i = 5; i >= 0; i--){
    meses.push(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1));
  }

  const labels = meses.map(m => Utilities.formatDate(m, Session.getScriptTimeZone(), "MMMM").slice(0,3) + " " + m.getFullYear());
  const entradas = meses.map(() => 0);
  const salidas = meses.map(() => 0);

  datos.forEach(fila=>{
    const fecha = fila[0] instanceof Date ? fila[0] : new Date(fila[0]);
    if(isNaN(fecha.getTime())) return;

    const idx = meses.findIndex(m => m.getFullYear() === fecha.getFullYear() && m.getMonth() === fecha.getMonth());
    if(idx === -1) return;

    const tipo = String(fila[2]||"").toUpperCase();
    if(tipo === "ENTRADA") entradas[idx] += Number(fila[6]) || 0;
    if(tipo === "SALIDA") salidas[idx] += Number(fila[7]) || 0;
  });

  return {
    labels: labels,
    entradas: entradas.map(v => Math.round(v * 100) / 100),
    salidas: salidas.map(v => Math.round(v * 100) / 100)
  };

}

/**
 * Un solo viaje al servidor para toda la pantalla de Reportes.
 */
function obtenerReporteEjecutivoApp(token){
  requerirSesionActivaApp_(token);
  return {
    valorInventario: obtenerValorInventarioApp(token),
    valorPorCategoria: obtenerValorInventarioAgrupadoApp_(2),
    valorPorProveedor: obtenerValorInventarioAgrupadoApp_(16),
    tendenciaMensual: obtenerTendenciaMensualApp(token),
    contadores: obtenerContadoresControl(),
    topBajoMinimo: obtenerTopBajoMinimoApp(token)
  };
}

/**
 * NUEVO: un solo endpoint que junta todo lo que necesita el dashboard de
 * Inicio (KPIs, gráfica 7 días, mapa de calor, actividad reciente).
 */

function obtenerResumenInicioApp(token){

  requerirSesionActivaApp_(token);

  const dashboard = obtenerDashboardMovil();
  const semana = obtenerEntradasSalidas7dias();
  const contadores = obtenerContadoresControl();
  const mapaCalor = obtenerMapaCalorRacks();
  const actividad = obtenerMovimientosRecientes(10);

  return {
    productos: dashboard.productos,
    productosConUbicacion: dashboard.productosConUbicacion,
    sinUbicacion: dashboard.sinUbicacion,
    ubicaciones: dashboard.ubicaciones,
    normal: dashboard.normal,
    bajo: dashboard.bajo,
    sinStock: dashboard.sinStock,
    discrepancias: contadores.discrepancias,
    conteosAbiertos: contadores.conteosAbiertos,
    semana: semana,
    mapaCalor: mapaCalor,
    actividad: actividad
  };

}

// ============================================
// MÓDULO DE COMPRAS: Centro de Reabastecimiento, Órdenes de Compra,
// Recepción de Mercancía, Historial de Compras
// ============================================
//
// Hojas usadas (ya creadas por Alberto):
//   ORDENES_COMPRA: OC | Fecha | Proveedor | Usuario | Estado | Total | Observaciones
//   DETALLE_OC:      OC | Código | Producto | Cantidad | UDM | Precio | Importe | Recibido
//
// Estados de una OC: PENDIENTE -> PARCIAL -> RECIBIDA, o PENDIENTE/PARCIAL -> CANCELADA.
// Una orden NUNCA se borra, solo cambia de estado.
//
// El "precio" de cada línea se toma de MATRIZ columna R (costo unitario) —
// el mismo campo que ya usamos para "Valor monetario del inventario".

/**
 * FASE 1: Centro de Reabastecimiento. Regresa los productos con ubicación
 * válida cuya existencia está por debajo del mínimo, con la cantidad
 * SUGERIDA a comprar (Máximo - Existencia).
 */
const SIN_PROVEEDOR_ETIQUETA_ = "Sin proveedor asignado";

function obtenerProveedorProducto_(fila){
  const proveedor = String(fila[16]||"").trim();
  return proveedor || SIN_PROVEEDOR_ETIQUETA_;
}

function normalizarProveedor_(texto){
  return String(texto||"").trim().toUpperCase();
}

function calcularSugeridoCompra_(existencia, minimo, maximo){

  if(maximo > minimo){
    const puntoMedio = (minimo + maximo) / 2;
    if(existencia < puntoMedio){
      return Math.max(Math.round(puntoMedio - existencia), 0);
    }
    return 0;
  }

  // Sin máximo capturado: usamos el mínimo como referencia de respaldo.
  if(existencia < minimo){
    return Math.max(Math.round((minimo - existencia) * 1.5), 0);
  }

  return 0;

}

// ============================================
// Valor monetario del inventario — FUNCIÓN ÚNICA Y CENTRAL
// ============================================
//
// El "Costo Unitario" de MATRIZ (columna R) NO siempre es el costo de UNA
// unidad de inventario: cuando "Convertir" (columna S) = "SI", ese costo
// es el de UNA PRESENTACIÓN de compra completa (columna T = cuántas
// unidades trae esa presentación). Ejemplo: Manga de cartón — 1700 piezas
// en existencia, Costo Unitario $77, Presentación 100 → son 17 paquetes
// de $77 ($1,309), NO 1700×$77.
//
// TODO módulo que calcule el valor económico del inventario (Dashboard,
// Inventario Mensual, Análisis de Costos, Compras, cualquier reporte)
// DEBE usar esta función — no volver a multiplicar existencia×costo
// directo en ningún lado nuevo.

/**
 * Valor monetario de una cantidad de producto (existencia, una diferencia
 * de conteo, lo recibido en una OC, etc.), respetando la conversión por
 * presentación cuando aplica.
 *
 * @param {number} cantidad     Cantidad en unidades de inventario (kg, pza...)
 * @param {number} costoUnitario Costo Unitario tal cual está en MATRIZ col. R
 * @param {string} convertir     Valor de MATRIZ col. S ("SI"/"NO"/vacío)
 * @param {number} presentacion  Valor de MATRIZ col. T
 */
/**
 * Formatea una CANTIDAD (kg, piezas, existencia, diferencia...) para
 * mostrar en pantalla o PDF: máximo 2 decimales, sin ceros de más
 * (5 se ve "5", no "5.00"), y sin el ruido típico de la aritmética de
 * punto flotante (1.000000002 se ve "1").
 */
function formatearCantidad_(valor){
  const num = Number(valor);
  if(!isFinite(num)) return "0";
  return num.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Formatea un MONTO en pesos: siempre exactamente 2 decimales.
 */
function formatearMoneda_(valor){
  const num = Number(valor) || 0;
  return num.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calcularValorInventario_(cantidad, costoUnitario, convertir, presentacion){

  // A partir de la migración de precios (ver migrarCostoUnitarioAPorUnidadApp),
  // Costo Unitario en MATRIZ ya representa el costo de UNA unidad de
  // inventario (ej. $/kg, $/pz) — sin importar Convertir/Presentación,
  // el valor siempre es cantidad × costo directo. Se dejan los
  // parámetros convertir/presentacion en la firma para no romper a
  // quien ya llama esta función, pero ya no se usan para dividir.
  const cant = Number(cantidad) || 0;
  const costo = Number(costoUnitario) || 0;

  return Math.round(cant * costo * 100) / 100;

}

/**
 * Costo real de UNA unidad de inventario (una pieza, un kg...), despejando
 * el costo de la presentación cuando Convertir="SI". Útil para mostrar
 * "costo por unidad" en Dashboard/reportes, o para calcular el impacto
 * económico de una diferencia de conteo sin tener que repetir la
 * conversión en cada módulo.
 *
 * Ejemplos: Manga de cartón → 77/100 = $0.77 por pieza.
 *           Pimienta negra   → 148.33/0.36 = $411.97 por kg.
 */
function obtenerCostoUnitarioReal_(costoUnitario, convertir, presentacion){
  // Igual que calcularValorInventario_: desde la migración, Costo Unitario
  // ya ES el costo por unidad real — ya no se divide entre presentación.
  return Number(costoUnitario) || 0;
}

/**
 * Lista de proveedores (columna Q de MATRIZ) con cuántos productos tiene
 * cada uno y cuántos están bajo mínimo — para la pantalla de entrada del
 * Centro de Reabastecimiento.
 */
/**
 * Búsqueda libre en TODO el catálogo (sin filtrar por proveedor) — para
 * poder agregar a una orden un producto que normalmente se compra con
 * otro proveedor, si ese día se consiguió con éste.
 */
/**
 * Búsqueda global del header: además de productos por nombre/código,
 * detecta si el texto coincide con un RACK o un PROVEEDOR y agrupa los
 * productos que están ahí — así "A01" muestra qué hay en ese rack, y
 * "LYCONTT" muestra qué le compras a ese proveedor, sin entrar a otro módulo.
 */
function busquedaGlobalHeaderApp(texto, token){

  requerirSesionActivaApp_(token);

  const busqueda = normalizarTexto_(texto);
  if(!busqueda) return { productos: [], racks: [], proveedores: [] };

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1); // A..R (y más, pero el resto de la función solo usa hasta R)

  const productos = [];
  const racksEncontrados = {};
  const proveedoresEncontrados = {};

  datos.forEach(f => {

    const ubicacion = String(f[9]||"").trim();
    if(ubicacionVacia_(ubicacion)) return;

    const nombre = f[0], codigo = f[4], rack = String(f[6]||"").trim();
    const proveedor = obtenerProveedorProducto_(f);
    const existencia = Number(f[10]) || 0;

    const infoProducto = { codigo: codigo, producto: nombre, existencia: existencia, udm: f[1], rack: rack, proveedor: proveedor };

    // 1) coincidencia directa de producto (nombre o código)
    if(productos.length < 8 && (normalizarTexto_(nombre).indexOf(busqueda) !== -1 || normalizarTexto_(codigo).indexOf(busqueda) !== -1)){
      productos.push(infoProducto);
    }

    // 2) coincidencia de rack
    if(rack && normalizarTexto_(rack).indexOf(busqueda) !== -1){
      if(!racksEncontrados[rack]) racksEncontrados[rack] = [];
      racksEncontrados[rack].push(infoProducto);
    }

    // 3) coincidencia de proveedor
    if(proveedor && normalizarTexto_(proveedor).indexOf(busqueda) !== -1){
      if(!proveedoresEncontrados[proveedor]) proveedoresEncontrados[proveedor] = [];
      proveedoresEncontrados[proveedor].push(infoProducto);
    }

  });

  const racks = Object.keys(racksEncontrados).slice(0,3).map(r => ({
    rack: r, total: racksEncontrados[r].length, productos: racksEncontrados[r].slice(0,10)
  }));

  const proveedores = Object.keys(proveedoresEncontrados).slice(0,3).map(p => ({
    proveedor: p, total: proveedoresEncontrados[p].length, productos: proveedoresEncontrados[p].slice(0,10)
  }));

  return { productos: productos, racks: racks, proveedores: proveedores };

}

function buscarProductoCatalogoApp(texto, token){

  requerirSesionActivaApp_(token);

  const busqueda = normalizarTexto_(texto);
  if(!busqueda) return [];

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1); // A..R (y más)

  const resultados = [];

  for(let i=0;i<datos.length;i++){

    const f = datos[i];
    const ubicacion = String(f[9]||"").trim();
    if(ubicacionVacia_(ubicacion)) continue;

    const coincideNombre = normalizarTexto_(f[0]).indexOf(busqueda) !== -1;
    const coincideCodigo = normalizarTexto_(f[4]).indexOf(busqueda) !== -1;
    if(!coincideNombre && !coincideCodigo) continue;

    resultados.push({
      codigo: f[4],
      producto: f[0],
      udm: f[1],
      existencia: Number(f[10]) || 0,
      minimo: Number(f[11]) || 0,
      maximo: Number(f[12]) || 0,
      precio: Number(f[17]) || 0,
      proveedor: obtenerProveedorProducto_(f),
      convertir: String(f[18]||"").trim().toUpperCase() === "SI",
      presentacion: Number(f[19]) || 0
    });

    if(resultados.length >= 15) break;

  }

  return resultados;

}

function obtenerProveedoresReabastecimientoApp(token){

  requerirSesionActivaApp_(token);

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1); // A..R (y más)

  const mapa = {};

  datos.forEach(f=>{

    const ubicacion = String(f[9]||"").trim();
    if(ubicacionVacia_(ubicacion)) return;

    const proveedor = obtenerProveedorProducto_(f);
    const claveProveedor = normalizarProveedor_(proveedor);
    const existencia = Number(f[10]) || 0;
    const minimo = Number(f[11]) || 0;

    if(!mapa[claveProveedor]){
      mapa[claveProveedor] = { proveedor: proveedor, totalProductos: 0, bajoMinimo: 0 };
    }

    mapa[claveProveedor].totalProductos++;
    if(existencia < minimo) mapa[claveProveedor].bajoMinimo++;

  });

  return Object.values(mapa).sort((a,b)=> b.bajoMinimo - a.bajoMinimo);

}

/**
 * TODOS los productos (con ubicación) de un proveedor específico —
 * estén o no bajo mínimo — para poder agregarlos manualmente a la orden.
 * "sugerido" = punto medio entre Mínimo y Máximo, no el Máximo completo.
 */
function obtenerProductosPorProveedorApp(proveedor, token){

  requerirSesionActivaApp_(token);

  const proveedorBuscado = normalizarProveedor_(proveedor);

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1); // A..T (y más)

  return datos
    .filter(f=>{
      const ubicacion = String(f[9]||"").trim();
      if(ubicacionVacia_(ubicacion)) return false;
      return normalizarProveedor_(obtenerProveedorProducto_(f)) === proveedorBuscado;
    })
    .map(f=>{
      const existencia = Number(f[10]) || 0;
      const minimo = Number(f[11]) || 0;
      const maximo = Number(f[12]) || 0;
      const sugerido = calcularSugeridoCompra_(existencia, minimo, maximo);

      const convertir = String(f[18]||"").trim().toUpperCase() === "SI";
      const presentacion = Number(f[19]) || 0;

      return {
        codigo: f[4],
        producto: f[0],
        udm: f[1],
        existencia: existencia,
        minimo: minimo,
        maximo: maximo,
        sugerido: sugerido,
        precio: Number(f[17]) || 0,
        bajoMinimo: existencia < minimo,
        convertir: convertir && presentacion > 0,
        presentacion: presentacion,
        // Piezas sugeridas a comprar (redondeando hacia arriba para no quedar cortos).
        sugeridoPiezas: (convertir && presentacion > 0) ? Math.ceil(sugerido / presentacion) : 0
      };
    })
    .sort((a,b)=> (a.existencia - a.minimo) - (b.existencia - b.minimo));

}

/**
 * Si la Presentación capturada en una línea de OC (al generar o al
 * editar) es distinta a la que ya tiene ese producto en MATRIZ (columna
 * T), actualiza MATRIZ con el nuevo valor — mismo criterio que ya usa
 * procesarCambioPrecioProducto_ para el precio (columna R) al recibir:
 * sin lock propio (escritura de un solo valor, catálogo no crítico como
 * la existencia) y sin tocar nada si la línea no trae presentación
 * capturada, para nunca borrar por accidente una que ya existía.
 */
function sincronizarPresentacionMatriz_(codigo, presentacion){

  const nueva = Number(presentacion) || 0;
  if(nueva <= 0) return;

  const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
  if(filaMatriz === -1) return;

  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const actual = Number(hoja.getRange(filaMatriz, 20).getValue()) || 0; // columna T

  if(nueva === actual) return;

  hoja.getRange(filaMatriz, 20).setValue(nueva);
  invalidarCacheHoja_("MATRIZ");

}

/**
 * COM-02 (auditoría comparativa vs. MarketMan): antes, el "Total" de una
 * OC era solo cantidad×precio neto — el propio código lo reconocía
 * ("no tenemos capturados... tasa de IVA"). Descuento/IVA%/Flete son
 * OPCIONALES y se capturan a nivel de toda la orden (no por línea, para
 * no complicar el formulario) — si no se capturan, totalConImpuestos
 * queda igual al subtotal, exactamente el comportamiento de antes.
 *
 * A propósito esto NO toca procesarCambioPrecioProducto_ ni
 * calcularValorInventario_: el IVA es un impuesto acreditable, no forma
 * parte del costo del producto para efectos de valorizar inventario —
 * meterlo ahí sobrestimaría el valor de existencia. El flete si suele
 * capitalizarse al costo (landed cost), pero prorratearlo por unidad
 * recibida es un cambio de mayor alcance sobre el costeo que ya usan
 * Dashboard/Reportes/Proveedores — se deja fuera de esta corrección para
 * no arriesgar esa cadena; aquí solo se captura y se muestra en el PDF/
 * detalle, que es el hallazgo puntual de la auditoría ("no hay dónde
 * capturar esto").
 */
/**
 * Mismo patrón lazy-header ya usado en DETALLE_OC para "Presentación"/
 * "Piezas" — las columnas 8-11 de ORDENES_COMPRA (Descuento, IVA %,
 * Flete, Total Con Impuestos) son nuevas; una OC generada antes de este
 * cambio simplemente no las tiene (quedan en blanco, tratadas como 0 al
 * leerlas — ver obtenerDetalleOCApp_/obtenerOrdenesCompraApp).
 */
function asegurarEncabezadosImpuestosOrdenesCompra_(ordenes){
  if(ordenes.getRange(1, 8).getValue() === ""){
    ordenes.getRange(1, 8, 1, 4).setValues([["Descuento", "IVA %", "Flete", "Total Con Impuestos"]]);
    ordenes.getRange(1, 8, 1, 4).setFontWeight("bold");
  }
}

function calcularDesgloseOrdenCompra_(subtotal, extras){
  const descuento = Math.max(0, Number(extras && extras.descuento) || 0);
  const ivaPorcentaje = Math.max(0, Number(extras && extras.ivaPorcentaje) || 0);
  const flete = Math.max(0, Number(extras && extras.flete) || 0);
  const baseConDescuento = Math.max(0, subtotal - descuento);
  const ivaMonto = Math.round(baseConDescuento * (ivaPorcentaje / 100) * 100) / 100;
  const totalConImpuestos = Math.round((baseConDescuento + ivaMonto + flete) * 100) / 100;
  return { descuento, ivaPorcentaje, flete, ivaMonto, totalConImpuestos };
}

/**
 * FASE 2: genera la Orden de Compra. items = [{codigo, producto, udm,
 * cantidad, precio}, ...]. Crea el folio, guarda encabezado en
 * ORDENES_COMPRA, detalle en DETALLE_OC, y deja registro en AUDITORIA.
 */
function generarOrdenCompraApp(proveedor, observaciones, items, token, extras){

  requerirAccesoAlmacenApp_(token);

  proveedor = String(proveedor||"").trim();

  if(!proveedor){
    throw new Error("Captura el proveedor de la orden.");
  }

  if(!items || !items.length){
    throw new Error("Selecciona al menos un producto para comprar.");
  }

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");
  const detalle = ss.getSheetByName("DETALLE_OC");

  if(!ordenes || !detalle){
    throw new Error("No existen las hojas ORDENES_COMPRA y/o DETALLE_OC.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const fecha = new Date();

  // El folio consecutivo del día y la reserva del encabezado (appendRow
  // en ORDENES_COMPRA) quedan protegidos por un lock: así dos compras
  // generadas al mismo tiempo no pueden terminar con el mismo folio. El
  // resto (detalle, auditoría, PDF) no depende de esa sección compartida
  // y queda igual que antes, fuera del lock.
  let folioOC, total, filasDetalle, desglose;

  conBloqueoApp_(function(){

    // Folio consecutivo del día: OC-YYYYMMDD-001
    const fechaCodigo = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyyMMdd");
    let consecutivo = 1;

    if(ordenes.getLastRow() > 1){
      const folios = ordenes.getRange(2, 1, ordenes.getLastRow()-1, 1).getValues().flat();
      const deHoy = folios.filter(f => f.toString().includes("OC-"+fechaCodigo));
      consecutivo = deHoy.length + 1;
    }

    folioOC = "OC-" + fechaCodigo + "-" + Utilities.formatString("%03d", consecutivo);

    total = 0;
    filasDetalle = [];

    items.forEach(item=>{
      const cantidad = Number(item.cantidad) || 0;
      if(cantidad <= 0) return;

      const precio = Number(item.precio) || 0;
      const presentacion = Number(item.presentacion) || 0;
      const piezasOrdenadas = Number(item.piezasOrdenadas) || 0;

      // Si el producto se compra por presentación, "precio" es el costo de
      // UNA presentación (no de 1 kg/pza) — la función central ya lo maneja.
      const importe = calcularValorInventario_(cantidad, precio, presentacion > 0 ? "SI" : "NO", presentacion);
      total += importe;

      filasDetalle.push([
        folioOC,
        item.codigo,
        item.producto,
        cantidad,
        item.udm || "",
        precio,
        importe,
        0, // Recibido, arranca en 0
        presentacion || "",
        piezasOrdenadas || ""
      ]);
    });

    if(!filasDetalle.length){
      throw new Error("Ninguna cantidad capturada es mayor a cero.");
    }

    total = Math.round(total * 100) / 100;

    desglose = calcularDesgloseOrdenCompra_(total, extras);

    // COM-01 (auditoría comparativa vs. MarketMan): antes, la OC nacía
    // directo en PENDIENTE — el mismo estado que ya permitía recibirla —
    // así que quien la generaba también podía recibirla, sin ningún
    // segundo visto bueno. Ahora nace en PENDIENTE_APROBACION y
    // registrarRecepcionOCApp la rechaza hasta que aprobarOrdenCompraApp
    // (solo ADMIN) la mueva a PENDIENTE.
    ordenes.appendRow([
      folioOC,
      fecha,
      proveedor,
      usuario,
      "PENDIENTE_APROBACION",
      total,
      observaciones || "",
      desglose.descuento,
      desglose.ivaPorcentaje,
      desglose.flete,
      desglose.totalConImpuestos
    ]);

  });

  asegurarEncabezadosImpuestosOrdenesCompra_(ordenes);

  // Si DETALLE_OC todavía no tiene las columnas de presentación (de una
  // versión anterior), les ponemos encabezado la primera vez que se usan.
  if(detalle.getRange(1, 9).getValue() === ""){
    detalle.getRange(1, 9, 1, 2).setValues([["Presentación", "Piezas"]]);
    detalle.getRange(1, 9, 1, 2).setFontWeight("bold");
  }

  detalle.getRange(detalle.getLastRow()+1, 1, filasDetalle.length, 10).setValues(filasDetalle);

  items.forEach(item => sincronizarPresentacionMatriz_(item.codigo, item.presentacion));

  registrarAuditoria(
    usuario, "COMPRAS", "ORDEN GENERADA", folioOC, "", "",
    0, total, "Orden de compra a " + proveedor + " — " + filasDetalle.length + " producto(s)"
  );

  generarYGuardarPDFOrdenCompra_(folioOC);

  return { folio: folioOC, total: total, productos: filasDetalle.length, totalConImpuestos: desglose.totalConImpuestos };

}

/**
 * Edita una Orden de Compra que sigue PENDIENTE — únicamente mientras no
 * se le haya recibido nada (PARCIAL/RECIBIDA/CANCELADA quedan fuera, con
 * el mismo criterio que ya usa cancelarOrdenCompraApp). El folio, la
 * fecha de creación y el usuario que la generó no cambian; proveedor,
 * observaciones y productos se reemplazan por completo — se borran las
 * filas de DETALLE_OC de esa OC y se vuelven a escribir, igual que al
 * generarla la primera vez. Como solo se permite en PENDIENTE, "Recibido"
 * siempre es 0 en todas las líneas, así que no hay nada que preservar.
 */
function editarOrdenCompraApp(oc, proveedor, observaciones, items, token, extras){

  requerirAccesoAlmacenApp_(token);

  oc = String(oc||"").trim().toUpperCase();
  proveedor = String(proveedor||"").trim();

  if(!proveedor){
    throw new Error("Captura el proveedor de la orden.");
  }

  if(!items || !items.length){
    throw new Error("Selecciona al menos un producto para comprar.");
  }

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");
  const detalle = ss.getSheetByName("DETALLE_OC");

  if(!ordenes || !detalle){
    throw new Error("No existen las hojas ORDENES_COMPRA y/o DETALLE_OC.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  let total, filasDetalle;

  conBloqueoApp_(function(){

    const datosOrdenes = ordenes.getRange(2, 1, ordenes.getLastRow()-1, 7).getValues();
    let filaOrden = -1;

    for(let i=0;i<datosOrdenes.length;i++){
      if(String(datosOrdenes[i][0]||"").trim().toUpperCase() === oc){
        filaOrden = i + 2;
        const estadoActual = String(datosOrdenes[i][4]||"").toUpperCase();
        if(estadoActual !== "PENDIENTE" && estadoActual !== "PENDIENTE_APROBACION"){
          throw new Error("Solo se puede editar una orden antes de que se le reciba algo (esta ya está " + estadoActual + ").");
        }
        break;
      }
    }

    if(filaOrden === -1){
      throw new Error("No se encontró la orden " + oc);
    }

    total = 0;
    filasDetalle = [];

    items.forEach(item=>{
      const cantidad = Number(item.cantidad) || 0;
      if(cantidad <= 0) return;

      const precio = Number(item.precio) || 0;
      const presentacion = Number(item.presentacion) || 0;
      const piezasOrdenadas = Number(item.piezasOrdenadas) || 0;

      const importe = calcularValorInventario_(cantidad, precio, presentacion > 0 ? "SI" : "NO", presentacion);
      total += importe;

      filasDetalle.push([
        oc,
        item.codigo,
        item.producto,
        cantidad,
        item.udm || "",
        precio,
        importe,
        0, // Recibido — siempre 0, editar solo se permite en PENDIENTE
        presentacion || "",
        piezasOrdenadas || ""
      ]);
    });

    if(!filasDetalle.length){
      throw new Error("Ninguna cantidad capturada es mayor a cero.");
    }

    total = Math.round(total * 100) / 100;

    const desglose = calcularDesgloseOrdenCompra_(total, extras);

    ordenes.getRange(filaOrden, 3).setValue(proveedor);
    ordenes.getRange(filaOrden, 6).setValue(total);
    ordenes.getRange(filaOrden, 7).setValue(observaciones || "");
    asegurarEncabezadosImpuestosOrdenesCompra_(ordenes);
    ordenes.getRange(filaOrden, 8, 1, 4).setValues([[desglose.descuento, desglose.ivaPorcentaje, desglose.flete, desglose.totalConImpuestos]]);

    if(detalle.getRange(1, 9).getValue() === ""){
      detalle.getRange(1, 9, 1, 2).setValues([["Presentación", "Piezas"]]);
      detalle.getRange(1, 9, 1, 2).setFontWeight("bold");
    }

    if(detalle.getLastRow() > 1){
      const anchoDetalle = Math.min(detalle.getLastColumn(), 10);
      const datosDetalle = detalle.getRange(2, 1, detalle.getLastRow()-1, anchoDetalle).getValues();
      for(let i = datosDetalle.length - 1; i >= 0; i--){
        if(String(datosDetalle[i][0]||"").trim().toUpperCase() === oc){
          detalle.deleteRows(i + 2, 1);
        }
      }
    }

    detalle.getRange(detalle.getLastRow()+1, 1, filasDetalle.length, 10).setValues(filasDetalle);

  });

  items.forEach(item => sincronizarPresentacionMatriz_(item.codigo, item.presentacion));

  registrarAuditoria(
    usuario, "COMPRAS", "ORDEN EDITADA", oc, "", "",
    0, total, "Orden editada — proveedor: " + proveedor + " — " + filasDetalle.length + " producto(s)"
  );

  generarYGuardarPDFOrdenCompra_(oc);

  return { folio: oc, total: total, productos: filasDetalle.length };

}

/**
 * Lista todas las Órdenes de Compra (para "Órdenes de Compra" e
 * "Historial de Compras" — misma fuente, la vista decide qué mostrar).
 */
function obtenerOrdenesCompraApp(token){

  requerirSesionActivaApp_(token);

  const hoja = SpreadsheetApp.getActive().getSheetByName("ORDENES_COMPRA");

  if(!hoja || hoja.getLastRow() < 2) return [];

  const anchoHoja = Math.min(Math.max(hoja.getLastColumn(), 7), 11);
  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, anchoHoja).getValues();

  return datos.map(f=>({
    oc: f[0],
    fecha: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : String(f[1]||""),
    proveedor: f[2],
    usuario: f[3],
    estado: f[4],
    total: Number(f[5]) || 0,
    observaciones: f[6] || "",
    // COM-02: en blanco para cualquier OC generada antes de esta corrección
    // (misma convención que Presentación/Piezas en DETALLE_OC) — se leen
    // como 0, y totalConImpuestos cae de vuelta al Total de siempre.
    descuento: Number(f[7]) || 0,
    ivaPorcentaje: Number(f[8]) || 0,
    flete: Number(f[9]) || 0,
    totalConImpuestos: Number(f[10]) || Number(f[5]) || 0
  })).reverse(); // más recientes primero

}

/**
 * Detalle de una OC específica (para Recepción de Mercancía y para ver
 * el desglose desde Órdenes de Compra / Historial).
 */
// Versión interna sin guard propio — usada por generarYGuardarPDFOrdenCompra_,
// que se llama tanto desde la pública de abajo como desde funciones que
// escriben una OC (generar/editar/recibir) y ya validaron su propio token
// antes de llegar aquí.
function obtenerDetalleOCApp_(oc){

  oc = String(oc||"").trim().toUpperCase();

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");
  const detalle = ss.getSheetByName("DETALLE_OC");

  if(!ordenes || !detalle) return null;

  let encabezado = null;

  if(ordenes.getLastRow() > 1){
    const anchoOrdenes = Math.min(Math.max(ordenes.getLastColumn(), 7), 11);
    const datosOrdenes = ordenes.getRange(2, 1, ordenes.getLastRow()-1, anchoOrdenes).getValues();
    for(let i=0;i<datosOrdenes.length;i++){
      if(String(datosOrdenes[i][0]||"").trim().toUpperCase() === oc){
        const total = Number(datosOrdenes[i][5]) || 0;
        encabezado = {
          oc: datosOrdenes[i][0],
          fecha: datosOrdenes[i][1] instanceof Date ? Utilities.formatDate(datosOrdenes[i][1], Session.getScriptTimeZone(), "dd/MM/yyyy") : String(datosOrdenes[i][1]||""),
          proveedor: datosOrdenes[i][2],
          usuario: datosOrdenes[i][3],
          estado: datosOrdenes[i][4],
          total: total,
          observaciones: datosOrdenes[i][6] || "",
          descuento: Number(datosOrdenes[i][7]) || 0,
          ivaPorcentaje: Number(datosOrdenes[i][8]) || 0,
          ivaMonto: Math.round(Math.max(0, total - (Number(datosOrdenes[i][7])||0)) * ((Number(datosOrdenes[i][8])||0) / 100) * 100) / 100,
          flete: Number(datosOrdenes[i][9]) || 0,
          totalConImpuestos: Number(datosOrdenes[i][10]) || total
        };
        break;
      }
    }
  }

  if(!encabezado){
    return null;
  }

  let items = [];

  if(detalle.getLastRow() > 1){
    const anchoDetalle = Math.min(detalle.getLastColumn(), 10);
    const datosDetalle = detalle.getRange(2, 1, detalle.getLastRow()-1, anchoDetalle).getValues();
    datosDetalle.forEach(f=>{
      if(String(f[0]||"").trim().toUpperCase() === oc){
        items.push({
          codigo: f[1],
          producto: f[2],
          cantidad: Number(f[3]) || 0,
          udm: f[4],
          precio: Number(f[5]) || 0,
          importe: Number(f[6]) || 0,
          recibido: Number(f[7]) || 0,
          presentacion: Number(f[8]) || 0,
          piezasOrdenadas: Number(f[9]) || 0
        });
      }
    });
  }

  encabezado.items = items;
  return encabezado;

}

function obtenerDetalleOCApp(oc, token){
  requerirSesionActivaApp_(token);
  return obtenerDetalleOCApp_(oc);
}

/**
 * COM-01: aprueba una OC recién generada (PENDIENTE_APROBACION ->
 * PENDIENTE) — a partir de aquí ya se puede recibir. Solo ADMIN, a
 * propósito distinto del rol que ya puede generar/recibir
 * (requerirAccesoAlmacenApp_ = ADMIN o Almacén/Supervisor): la idea es
 * que quien genera la compra no sea necesariamente quien la aprueba.
 */
function aprobarOrdenCompraApp(oc, token){

  requerirSesionActivaApp_(token);
  const rol = String(obtenerRolDesdeToken(token) || "").toUpperCase();
  if(rol !== "ADMIN"){
    throw new Error("Solo un administrador puede aprobar una orden de compra.");
  }

  oc = String(oc || "").trim().toUpperCase();

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");
  if(!ordenes) throw new Error("No existe la hoja ORDENES_COMPRA.");

  const datos = ordenes.getRange(2, 1, ordenes.getLastRow() - 1, 7).getValues();

  for(let i = 0; i < datos.length; i++){
    if(String(datos[i][0] || "").trim().toUpperCase() === oc){

      const estadoActual = String(datos[i][4] || "").toUpperCase();
      if(estadoActual !== "PENDIENTE_APROBACION"){
        throw new Error("Esta orden está " + estadoActual + " — solo se puede aprobar mientras está pendiente de aprobación.");
      }

      ordenes.getRange(i + 2, 5).setValue("PENDIENTE");

      const usuario = obtenerNombreDesdeToken(token);
      registrarAuditoria(usuario, "COMPRAS", "ORDEN APROBADA", oc, "", "", 0, 0, "Aprobada, lista para recibirse");

      generarYGuardarPDFOrdenCompra_(oc);

      return { folio: oc, estado: "PENDIENTE" };

    }
  }

  throw new Error("No se encontró la orden " + oc);

}

/**
 * FASE 3: registra la recepción de mercancía de una OC.
 * recepciones = [{codigo, cantidadRecibida}, ...] — solo lo que llegó
 * EN ESTA recepción (puede ser parcial, y se puede volver a recibir
 * después el resto).
 *
 * Por cada producto con cantidadRecibida > 0:
 *   - Genera una ENTRADA real (misma función que la entrada manual).
 *   - Actualiza la columna "Recibido" en DETALLE_OC (acumulado).
 * Al final:
 *   - Si todo lo pedido ya se recibió -> Estado = RECIBIDA.
 *   - Si falta algo -> Estado = PARCIAL.
 *   - Registra AUDITORIA de quién recibió.
 */
function registrarRecepcionOCApp(oc, recepciones, token){

  requerirAccesoAlmacenApp_(token);

  oc = String(oc||"").trim().toUpperCase();

  if(!recepciones || !recepciones.length){
    throw new Error("Captura al menos una cantidad recibida.");
  }

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");
  const detalle = ss.getSheetByName("DETALLE_OC");

  if(!ordenes || !detalle){
    throw new Error("No existen las hojas ORDENES_COMPRA y/o DETALLE_OC.");
  }

  const usuario = obtenerNombreDesdeToken(token);

  // Localizamos la fila de la OC en el encabezado.
  const datosOrdenes = ordenes.getRange(2, 1, ordenes.getLastRow()-1, 7).getValues();
  let filaOrden = -1;
  let proveedorOC = "";

  for(let i=0;i<datosOrdenes.length;i++){
    if(String(datosOrdenes[i][0]||"").trim().toUpperCase() === oc){
      filaOrden = i + 2;
      proveedorOC = datosOrdenes[i][2];
      break;
    }
  }

  if(filaOrden === -1){
    throw new Error("No se encontró la orden " + oc);
  }

  const estadoActual = String(ordenes.getRange(filaOrden, 5).getValue()||"").toUpperCase();

  if(estadoActual === "RECIBIDA" || estadoActual === "CANCELADA"){
    throw new Error("Esta orden ya está " + estadoActual + ", no se puede recibir de nuevo.");
  }
  if(estadoActual === "PENDIENTE_APROBACION"){
    throw new Error("Esta orden todavía no está aprobada — apruébala antes de registrar la recepción.");
  }

  // Localizamos todas las filas de detalle de esta OC.
  const ultimaFilaDetalle = detalle.getLastRow();
  const datosDetalle = detalle.getRange(2, 1, ultimaFilaDetalle-1, 8).getValues();

  const mapaRecepcion = {};
  (recepciones||[]).forEach(r=>{
    mapaRecepcion[String(r.codigo)] = {
      cantidad: Number(r.cantidadRecibida) || 0,
      lote: r.lote || "",
      caducidad: r.caducidad || "",
      precioFactura: Number(r.precioFactura) || 0
    };
  });

  let totalRecibidoEsteMovimiento = 0;
  let productosRecibidos = 0;

  for(let i=0;i<datosDetalle.length;i++){

    if(String(datosDetalle[i][0]||"").trim().toUpperCase() !== oc) continue;

    const codigo = String(datosDetalle[i][1]||"");
    const infoRecepcion = mapaRecepcion[codigo];
    const cantidadRecibidaAhora = infoRecepcion ? infoRecepcion.cantidad : 0;

    if(cantidadRecibidaAhora <= 0) continue;

    const producto = datosDetalle[i][2];
    const udm = datosDetalle[i][4];
    const recibidoPrevio = Number(datosDetalle[i][7]) || 0;
    const pedido = Number(datosDetalle[i][3]) || 0;

    // No dejamos recibir más de lo pedido por accidente.
    const cantidadAplicar = Math.min(cantidadRecibidaAhora, pedido - recibidoPrevio);
    if(cantidadAplicar <= 0) continue;

    const nota = "Recepción de orden de compra " + oc +
      (infoRecepcion.lote ? (" — Lote: " + infoRecepcion.lote) : "") +
      (infoRecepcion.caducidad ? (" — Caduca: " + infoRecepcion.caducidad) : "");

    // ARQ-03: se lee la existencia/costo actuales ANTES de la entrada
    // (registrarEntradaInterna_ ya modifica la existencia de MATRIZ), para
    // poder mezclarlos con lo recién recibido — ver calcularCostoPromedioPonderado_.
    const filaMatrizProducto = buscarFilaMatrizPorCodigo_(codigo);
    const existenciaAntesRecepcion = filaMatrizProducto !== -1
      ? Number(ss.getSheetByName("MATRIZ").getRange(filaMatrizProducto, 11).getValue()) || 0
      : 0;
    const costoAntesRecepcion = filaMatrizProducto !== -1
      ? Number(ss.getSheetByName("MATRIZ").getRange(filaMatrizProducto, 18).getValue()) || 0
      : 0;

    // Reusa la MISMA lógica de una entrada manual: escribe en ENTRADA y KARDEX.
    registrarEntradaInterna_(
      { codigo: codigo, producto: producto, cantidad: cantidadAplicar, udm: udm, ubicacion: "", lote: infoRecepcion.lote, caducidad: infoRecepcion.caducidad },
      usuario,
      oc,
      nota
    );

    const filaDetalleReal = i + 2;
    detalle.getRange(filaDetalleReal, 8).setValue(recibidoPrevio + cantidadAplicar);

    totalRecibidoEsteMovimiento += cantidadAplicar;
    productosRecibidos++;

    // ARQ-03: el nuevo costo maestro es el PROMEDIO PONDERADO entre lo que
    // ya había en existencia (a su costo actual) y lo recién recibido (al
    // precio de esta factura) — no simplemente el último precio facturado.
    if(infoRecepcion.precioFactura > 0){
      const costoPromedio = calcularCostoPromedioPonderado_(existenciaAntesRecepcion, costoAntesRecepcion, cantidadAplicar, infoRecepcion.precioFactura);
      procesarCambioPrecioProducto_(codigo, producto, proveedorOC, costoPromedio, usuario, oc);
    }

  }

  if(productosRecibidos === 0){
    throw new Error("Ninguna cantidad capturada corresponde a productos pendientes de esta orden.");
  }

  // Releemos DETALLE_OC ya actualizado para decidir el estado final.
  const datosDetalleActualizados = detalle.getRange(2, 1, ultimaFilaDetalle-1, 8).getValues();
  let todoCompleto = true;

  datosDetalleActualizados.forEach(f=>{
    if(String(f[0]||"").trim().toUpperCase() === oc){
      const pedido = Number(f[3]) || 0;
      const recibido = Number(f[7]) || 0;
      if(recibido < pedido) todoCompleto = false;
    }
  });

  const estadoNuevo = todoCompleto ? "RECIBIDA" : "PARCIAL";
  ordenes.getRange(filaOrden, 5).setValue(estadoNuevo);

  registrarAuditoria(
    usuario, "COMPRAS", "RECEPCIÓN REGISTRADA", oc, "", "",
    0, totalRecibidoEsteMovimiento,
    "Recepción de " + productosRecibidos + " producto(s) — estado final: " + estadoNuevo
  );

  generarYGuardarPDFOrdenCompra_(oc);

  return { estado: estadoNuevo, productosRecibidos: productosRecibidos };

}

/**
 * Cancela una OC (nunca se borra, solo cambia de estado). Solo se puede
 * cancelar si sigue PENDIENTE o PARCIAL.
 */
function cancelarOrdenCompraApp(oc, token){

  requerirAccesoAlmacenApp_(token);

  oc = String(oc||"").trim().toUpperCase();

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");

  if(!ordenes) throw new Error("No existe la hoja ORDENES_COMPRA.");

  const datos = ordenes.getRange(2, 1, ordenes.getLastRow()-1, 7).getValues();

  for(let i=0;i<datos.length;i++){
    if(String(datos[i][0]||"").trim().toUpperCase() === oc){

      const estadoActual = String(datos[i][4]||"").toUpperCase();

      if(estadoActual === "RECIBIDA"){
        throw new Error("Esta orden ya fue recibida, no se puede cancelar.");
      }
      if(estadoActual === "CANCELADA"){
        throw new Error("Esta orden ya está cancelada.");
      }

      ordenes.getRange(i+2, 5).setValue("CANCELADA");

      registrarAuditoria(
        obtenerNombreDesdeToken(token), "COMPRAS", "ORDEN CANCELADA", oc, "", "",
        0, 0, "Orden cancelada (estaba " + estadoActual + ")"
      );

      generarYGuardarPDFOrdenCompra_(oc);

      return { ok: true };

    }
  }

  throw new Error("No se encontró la orden " + oc);

}


// ============================================
// PDF de la Orden de Compra (diseño TAGERS) + almacenamiento en Drive
// ============================================
//
// El PDF se genera y se guarda automáticamente:
//  - Al generar la orden.
//  - Al registrar una recepción (para reflejar PARCIAL/RECIBIDA).
//  - Al cancelarla.
// Siempre se sobrescribe el archivo anterior de esa misma OC, así el PDF
// guardado en Drive siempre coincide con el estado actual.
//
// NOTA: no tenemos capturados en las hojas datos como dirección del
// proveedor, condiciones de pago, moneda o tasa de IVA — el PDF usa
// únicamente los campos que sí existen en ORDENES_COMPRA/DETALLE_OC.
// Si quieres que el PDF incluya IVA desglosado, dime la tasa (o si el
// precio ya lo incluye) y le agrego esa fila al desglose.

const CARPETA_ORDENES_COMPRA_ = "Órdenes de Compra";

function obtenerCarpetaOrdenesCompra_(){

  const carpetas = DriveApp.getFoldersByName(CARPETA_ORDENES_COMPRA_);

  if(carpetas.hasNext()){
    return carpetas.next();
  }

  return DriveApp.createFolder(CARPETA_ORDENES_COMPRA_);

}

const LOGO_TAGERS_BASE64_ = "data:image/png;base64,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";

function construirHtmlOrdenCompra_(datos){

  const colorEstado = {
    "PENDIENTE": "#C4522A",
    "PARCIAL": "#a87a1f",
    "RECIBIDA": "#5C6B2A",
    "CANCELADA": "#8a7a72"
  }[datos.estado] || "#6B2737";

  const filasHtml = datos.items.map((it,i)=>{
    const tienePresentacion = it.presentacion > 0 && it.piezasOrdenadas > 0;
    const cantidadMostrar = tienePresentacion ? (formatearCantidad_(it.piezasOrdenadas) + " pz") : formatearCantidad_(it.cantidad);
    const presentacionMostrar = tienePresentacion ? (formatearCantidad_(it.presentacion) + " " + (it.udm||"")) : "—";
    return `
    <tr style="background:${i%2===0?'#ffffff':'#F9F5EF'}">
      <td>${it.codigo}</td>
      <td>${it.producto}</td>
      <td style="text-align:center">${it.udm||""}</td>
      <td style="text-align:right">${cantidadMostrar}</td>
      <td style="text-align:center">${presentacionMostrar}</td>
      <td style="text-align:right">$${formatearMoneda_(it.precio)}</td>
      <td style="text-align:right">$${formatearMoneda_(it.importe)}</td>
    </tr>
  `;
  }).join("");

  const generado = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  // COM-02: solo se arma un desglose (Subtotal/Descuento/IVA/Flete/Total)
  // cuando la orden de verdad tiene algo que desglosar — si nadie capturó
  // descuento/IVA/flete, se ve exactamente como antes (una sola caja con
  // el total).
  const tieneExtras = datos.descuento > 0 || datos.ivaPorcentaje > 0 || datos.flete > 0;
  const desglose = tieneExtras ? [
    { etiqueta: "Subtotal", valor: datos.total },
    ...(datos.descuento > 0 ? [{ etiqueta: "Descuento", valor: -datos.descuento }] : []),
    ...(datos.ivaPorcentaje > 0 ? [{ etiqueta: "IVA (" + datos.ivaPorcentaje + "%)", valor: datos.ivaMonto }] : []),
    ...(datos.flete > 0 ? [{ etiqueta: "Flete", valor: datos.flete }] : []),
    { etiqueta: "Total de la orden", valor: datos.totalConImpuestos, destacado: true }
  ] : null;

  return construirHtmlDocumentoTagers_({
    titulo: "ORDEN DE COMPRA",
    folio: datos.oc,
    colorEstado: colorEstado,
    estado: datos.estado,
    infoGrid: [
      { etiqueta: "Proveedor", valor: datos.proveedor },
      { etiqueta: "Fecha", valor: datos.fecha },
      { etiqueta: "Generado por", valor: datos.usuario },
      { etiqueta: "Total de productos", valor: datos.items.length }
    ],
    tablaEncabezados: `<th>Código</th><th>Producto</th><th style="text-align:center">UDM</th><th style="text-align:right">Cantidad</th><th style="text-align:center">Presentación</th><th style="text-align:right">Precio</th><th style="text-align:right">Importe</th>`,
    tablaFilas: filasHtml,
    etiquetaTotal: "Total de la orden",
    monto: datos.total,
    desglose: desglose,
    observaciones: datos.observaciones,
    firmas: ["Compras", "Almacén", "Proveedor"],
    generado: generado
  });

}

/**
 * Plantilla base blanca y limpia para todos los documentos PDF de TAGERS
 * (Órdenes de Compra, Inventario Mensual, etc.) — mismo layout, mismos
 * colores de marca y el logo real en el encabezado.
 */
function construirHtmlDocumentoTagers_(d){

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>

*{ box-sizing:border-box; margin:0; padding:0; font-family:Arial,sans-serif; }
body{ background:#ffffff; color:#3a2e2a; }

@page{ size:letter; margin:0; }

.hoja{ width:100%; min-height:11in; position:relative; padding-bottom:150px; }

.encabezado{
padding:26px 36px 18px;
display:flex;
justify-content:space-between;
align-items:flex-start;
border-bottom:3px solid #6B2737;
}

.marca img{ height:34px; display:block; }

.tituloDoc{ text-align:right; }
.tituloDoc .titulo{ font-size:22px; font-weight:800; letter-spacing:.5px; color:#3a2e2a; }
.tituloDoc .folio{ font-size:12.5px; color:#8a7a72; margin-top:2px; }

.franjaEstado{ text-align:center; padding:16px 0 0; }
.franjaEstado span{
display:inline-block;
padding:6px 22px;
border-radius:999px;
font-size:11.5px;
font-weight:700;
letter-spacing:1px;
background:${d.colorEstado}18;
color:${d.colorEstado};
border:1.5px solid ${d.colorEstado};
}

.infoGrid{
display:grid;
grid-template-columns:repeat(${d.infoGrid.length > 3 ? 4 : d.infoGrid.length},1fr);
gap:16px;
padding:24px 36px 6px;
}

.infoBloque .etiqueta{ font-size:10px; text-transform:uppercase; color:#a8907f; font-weight:700; letter-spacing:.3px; }
.infoBloque .valor{ font-size:14px; margin-top:3px; font-weight:700; color:#3a2e2a; }

.tablaItems{ width:calc(100% - 72px); border-collapse:collapse; margin:18px 36px; font-size:12px; }
.tablaItems thead th{
text-align:left;
vertical-align:middle;
padding:10px 9px;
font-size:10px;
text-transform:uppercase;
letter-spacing:.3px;
color:#8a7a72;
border-bottom:2px solid #e8ddd0;
}
.tablaItems td{ padding:9px; vertical-align:middle; border-bottom:1px solid #f0e8dc; }

.totales{ display:flex; justify-content:flex-end; padding:6px 36px 20px; }
.totales .caja{ background:#F7F2EA; border-radius:10px; padding:14px 24px; text-align:right; min-width:210px; }
.totales .etiquetaTotal{ font-size:10.5px; color:#8a7a72; text-transform:uppercase; letter-spacing:.3px; }
.totales .montoTotal{ font-size:23px; font-weight:800; color:#6B2737; margin-top:3px; }
.totales .filaDesglose{ display:flex; justify-content:space-between; gap:28px; font-size:12.5px; color:#6b5d52; padding:3px 0; }
.totales .filaDesglose.destacado{ margin-top:6px; padding-top:8px; border-top:1px solid #e2d8ca; font-size:17px; font-weight:800; color:#6B2737; }

.kpisDoc{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:6px 36px 18px; }
.kpiDoc{ background:#F7F2EA; border-radius:10px; padding:12px; text-align:center; }
.kpiDoc .num{ font-size:18px; font-weight:800; color:#6B2737; }
.kpiDoc .lbl{ font-size:9px; color:#8a7a72; text-transform:uppercase; margin-top:2px; letter-spacing:.3px; }

.observaciones{
margin:0 36px 20px;
background:#F7F2EA;
border-left:4px solid #5C6B2A;
padding:11px 15px;
font-size:11.5px;
border-radius:0 8px 8px 0;
}

.firmas{
display:grid;
grid-template-columns:repeat(${d.firmas.length},1fr);
gap:20px;
position:absolute;
bottom:46px;
left:36px;
right:36px;
text-align:center;
}

.firmas .linea{ border-top:1px solid #c9b8ad; padding-top:7px; font-size:11px; color:#5c4c42; }

.pie{ text-align:center; padding:14px; font-size:9.5px; color:#a8907f; border-top:1px solid #f0e8dc; position:absolute; bottom:0; left:0; right:0; }

</style>
</head>
<body>

<div class="hoja">

  <div class="encabezado">
    <div class="marca"><img src="${LOGO_TAGERS_BASE64_}"></div>
    <div class="tituloDoc">
      <div class="titulo">${d.titulo}</div>
      <div class="folio">${d.folio}</div>
    </div>
  </div>

  <div class="franjaEstado"><span>${d.estado}</span></div>

  <div class="infoGrid">
    ${d.infoGrid.map(b=>`<div class="infoBloque"><div class="etiqueta">${b.etiqueta}</div><div class="valor">${b.valor}</div></div>`).join("")}
  </div>

  ${d.kpis ? `<div class="kpisDoc">${d.kpis.map(k=>`<div class="kpiDoc"><div class="num">${k.num}</div><div class="lbl">${k.lbl}</div></div>`).join("")}</div>` : ""}

  ${d.observaciones ? `<div class="observaciones"><b>${d.etiquetaObservaciones || "Observaciones"}:</b> ${d.observaciones}</div>` : ""}

  <table class="tablaItems">
    <thead><tr>${d.tablaEncabezados}</tr></thead>
    <tbody>${d.tablaFilas || `<tr><td colspan="10" style="text-align:center;padding:14px;color:#a8907f">Sin registros</td></tr>`}</tbody>
  </table>

  ${d.desglose ? `
  <div class="totales">
    <div class="caja">
      ${d.desglose.map(l=>`<div class="filaDesglose${l.destacado ? ' destacado' : ''}"><span>${l.etiqueta}</span><span>${l.valor < 0 ? '-$' + formatearMoneda_(Math.abs(l.valor)) : '$' + formatearMoneda_(l.valor)}</span></div>`).join("")}
    </div>
  </div>
  ` : d.monto !== undefined ? `
  <div class="totales">
    <div class="caja">
      <div class="etiquetaTotal">${d.etiquetaTotal}</div>
      <div class="montoTotal">$${formatearMoneda_(d.monto)}</div>
    </div>
  </div>
  ` : ""}

  <div class="firmas">
    ${d.firmas.map(f=>`<div class="linea">${f}</div>`).join("")}
  </div>

  <div class="pie">TAGERS WMS · Documento generado el ${d.generado}</div>

</div>

</body>
</html>
  `;

}

/**
 * Genera el PDF de una OC y lo guarda (o sobrescribe) en la carpeta de
 * Drive "Órdenes de Compra". Regresa {id, verUrl, descargarUrl}.
 */
function generarYGuardarPDFOrdenCompra_(oc){

  const datos = obtenerDetalleOCApp_(oc);

  if(!datos){
    throw new Error("No se encontró la orden " + oc + " para generar el PDF.");
  }

  const html = construirHtmlOrdenCompra_(datos);
  const pdfBlob = HtmlService.createHtmlOutput(html).getAs("application/pdf").setName(oc + ".pdf");

  const carpeta = obtenerCarpetaOrdenesCompra_();

  // Si ya existe un PDF de esta orden, lo mandamos a la papelera para
  // dejar únicamente la versión más reciente (que refleje el estado actual).
  const existentes = carpeta.getFilesByName(oc + ".pdf");
  while(existentes.hasNext()){
    existentes.next().setTrashed(true);
  }

  const archivo = carpeta.createFile(pdfBlob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: archivo.getId(),
    verUrl: "https://drive.google.com/file/d/" + archivo.getId() + "/view",
    descargarUrl: "https://drive.google.com/uc?export=download&id=" + archivo.getId()
  };

}

/**
 * Para los 3 botones del historial (Ver / Descargar / Imprimir): regresa
 * las URL del PDF ya guardado en Drive. Si por algún motivo no existe
 * (orden creada antes de este cambio), lo genera al vuelo.
 */
function obtenerPDFOrdenCompraApp(oc, token){

  requerirSesionActivaApp_(token);

  // Siempre se regenera al vuelo (no se reutiliza el archivo guardado):
  // así Ver/Descargar/Imprimir jamás muestran una versión vieja del diseño
  // o de los datos, aunque la orden no haya cambiado de estado.
  return generarYGuardarPDFOrdenCompra_(oc);

}


// ============================================
// Historial de precios (se alimenta al recibir una OC con "Precio factura"
// distinto al que ya tenía el producto en MATRIZ) + Análisis de Costos
// ============================================

function buscarFilaMatrizPorCodigo_(codigo){

  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  if(hoja.getLastRow() < 2) return -1;

  const codigos = hoja.getRange(2, 5, hoja.getLastRow() - 1, 1).getValues(); // columna E
  const buscado = String(codigo||"").trim();

  for(let i=0;i<codigos.length;i++){
    if(String(codigos[i][0]||"").trim() === buscado){
      return i + 2;
    }
  }

  return -1;

}

// ============================================
// Existencia — FUENTE ÚNICA DE VERDAD, capa central multi-sucursal
// ============================================
//
// MATRIZ sigue siendo el catálogo maestro (una sola fila por Código,
// misma estructura de siempre) y la fuente de verdad de S01, la única
// sucursal operativa hoy — por compatibilidad, su columna K (Existencia)
// se sigue usando tal cual para S01. Cualquier OTRA sucursal (S02-S06...)
// vive en la hoja aparte EXISTENCIAS_SUCURSAL (Código | Sucursal |
// Existencia) y NUNCA toca MATRIZ. Esa decisión — "¿S01/MATRIZ o
// EXISTENCIAS_SUCURSAL?" — se resuelve en UN SOLO lugar:
// resolverAjusteExistencia_ (escritura) y obtenerExistenciaSucursal_
// (lectura). Ninguna otra función del proyecto debe volver a preguntar
// "¿es S01?" por su cuenta — todas las pantallas (Entradas, Salidas,
// Requisiciones, Conteos, Transferencias, Ajustes, Recepciones) pasan
// por aquí.
//
// El Kardex sigue siendo el historial completo de movimientos (no se
// toca su lógica); los reportes mensuales deben LEER filtrando por fecha
// (de KARDEX/ENTRADA/SALIDA/HISTORIAL_*), nunca escribir aquí.
//
// Migración futura documentada (Fase 19 del pedido): el día que se
// decida migrar S01 también a EXISTENCIAS_SUCURSAL, el único cambio es
// dentro de resolverAjusteExistencia_/obtenerExistenciaSucursal_ (dejar
// de tratar SUCURSAL_DEFAULT_ como caso especial de MATRIZ) — ninguna
// pantalla ni función que ya llama a los escritores/lectores de abajo
// tendría que tocarse, porque ninguna de ellas sabe ni le importa en
// qué hoja vive el número.

/**
 * FASE DE CONCURRENCIA: helper único para proteger con LockService las
 * secciones que antes hacían "leer valor actual -> calcular -> escribir"
 * sin ningún bloqueo (existencia de MATRIZ, folios consecutivos de OC/
 * requisiciones/conteos). Con dos usuarios operando al mismo tiempo esto
 * podía producir folios duplicados o existencias mal calculadas.
 *
 * `funcion` se ejecuta solo cuando se consigue el lock de script (uno a
 * la vez, para TODO el proyecto). Si no se consigue en `esperaMs`, se
 * lanza un error claro en vez de dejar avanzar una operación insegura.
 * No cambia ningún resultado ni mensaje de las funciones que ya
 * funcionaban — solo agrega esta protección alrededor.
 */
function conBloqueoApp_(funcion, esperaMs){
  const lock = LockService.getScriptLock();
  try{
    lock.waitLock(esperaMs || 10000);
  }catch(e){
    throw new Error("El sistema está ocupado procesando otro movimiento, intenta de nuevo en unos segundos.");
  }
  try{
    return funcion();
  }finally{
    lock.releaseLock();
  }
}

const SUCURSAL_DEFAULT_ = "S01";
const SUCURSAL_TODAS_ = "TODAS";

function normalizarSucursal_(sucursal){
  return String(sucursal || SUCURSAL_DEFAULT_).trim().toUpperCase();
}

// Se conserva por compatibilidad — nada la usaba ya fuera de este
// archivo, pero varias funciones más abajo la llamaban antes de que
// existiera resolverAjusteExistencia_.
function esSucursalNoDefault_(sucursal){
  if(sucursal === undefined || sucursal === null || sucursal === "") return false;
  return normalizarSucursal_(sucursal) !== SUCURSAL_DEFAULT_;
}

function obtenerHojaExistenciasSucursal_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("EXISTENCIAS_SUCURSAL");
  if(!hoja){
    hoja = ss.insertSheet("EXISTENCIAS_SUCURSAL");
    // Columna D "Reservado" — libro de reservas de TODAS las sucursales,
    // incluida S01 (cuya Existencia física sigue viviendo en MATRIZ; para
    // S01 esta hoja solo guarda la reserva, nunca la existencia). Ver
    // resolverAjusteExistencia_ más abajo.
    hoja.appendRow(["Código", "Sucursal", "Existencia", "Reservado"]);
  }
  return hoja;
}

function buscarFilaExistenciaSucursal_(hoja, codigo, sucursal){
  const ultimaFila = hoja.getLastRow();
  if(ultimaFila < 2) return -1;
  const datos = hoja.getRange(2, 1, ultimaFila - 1, 2).getValues();
  const codigoBuscado = String(codigo || "").trim();
  const sucursalBuscada = normalizarSucursal_(sucursal);
  for(let i = 0; i < datos.length; i++){
    if(String(datos[i][0]||"").trim() === codigoBuscado && normalizarSucursal_(datos[i][1]) === sucursalBuscada){
      return i + 2;
    }
  }
  return -1;
}

/**
 * LECTURA CENTRAL — la única forma correcta de conocer la existencia de
 * un producto en una sucursal específica. Para S01 sin fila propia en
 * EXISTENCIAS_SUCURSAL todavía, cae a MATRIZ.Existencia (así se comporta
 * igual que hoy, sin necesitar ninguna migración). "TODAS" NUNCA es una
 * sucursal física — no tiene existencia propia, así que aquí se rechaza
 * explícitamente; para una vista agregada usa
 * obtenerExistenciaConsolidadaApp.
 */
function obtenerExistenciaSucursal_(codigo, sucursal){
  sucursal = normalizarSucursal_(sucursal);

  if(sucursal === SUCURSAL_TODAS_){
    throw new Error('"TODAS" no es una sucursal física — usa obtenerExistenciaConsolidadaApp para una vista agregada.');
  }

  // S01 SIEMPRE se lee de MATRIZ, incluso si ya tiene una fila en
  // EXISTENCIAS_SUCURSAL — desde el mecanismo de reservas (Plano de
  // Abastecimiento), esa fila puede existir solo para guardar Reservado,
  // con Existencia en blanco a propósito (ver ajustarReservaEnHojaSucursal_).
  // Leer esa columna ahí para S01 daría 0 en vez del valor real.
  if(sucursal === SUCURSAL_DEFAULT_){
    const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
    if(filaMatriz === -1) return 0;
    return Number(SpreadsheetApp.getActive().getSheetByName("MATRIZ").getRange(filaMatriz, 11).getValue()) || 0;
  }

  const hoja = obtenerHojaExistenciasSucursal_();
  const fila = buscarFilaExistenciaSucursal_(hoja, codigo, sucursal);
  if(fila !== -1){
    return Number(hoja.getRange(fila, 3).getValue()) || 0;
  }
  return 0;
}

/**
 * Vista CONSOLIDADA ("TODAS") de existencia: suma la de cada sucursal
 * que ya tenga fila propia en EXISTENCIAS_SUCURSAL, más S01 (MATRIZ, si
 * todavía no migró). Nunca se guarda una fila física "TODAS" — esto es
 * puramente un cálculo de lectura, cada vez que se pide.
 */
function obtenerExistenciaConsolidadaApp(codigo, token){
  requerirSesionActivaApp_(token);
  codigo = String(codigo||"").trim();

  const hoja = obtenerHojaExistenciasSucursal_();
  const datos = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow()-1, 3).getValues() : [];

  const porSucursal = {};
  datos.forEach(f => {
    if(String(f[0]||"").trim() !== codigo) return;
    porSucursal[normalizarSucursal_(f[1])] = Number(f[2]) || 0;
  });

  if(porSucursal[SUCURSAL_DEFAULT_] === undefined){
    porSucursal[SUCURSAL_DEFAULT_] = obtenerExistenciaSucursal_(codigo, SUCURSAL_DEFAULT_);
  }

  const total = Object.keys(porSucursal).reduce((suma, suc) => suma + porSucursal[suc], 0);

  return { codigo: codigo, total: total, porSucursal: porSucursal };
}

/**
 * LECTURA de la reserva (columna D de EXISTENCIAS_SUCURSAL) — vive ahí
 * para TODAS las sucursales, incluida S01 (cuya Existencia física sigue
 * en MATRIZ; para S01 esta hoja solo guarda la reserva). 0 si no hay
 * fila todavía. "TODAS" no tiene reserva propia.
 */
function obtenerReservaSucursal_(codigo, sucursal){
  sucursal = normalizarSucursal_(sucursal);
  if(sucursal === SUCURSAL_TODAS_){
    throw new Error('"TODAS" no es una sucursal física — no tiene reserva propia.');
  }
  const hoja = obtenerHojaExistenciasSucursal_();
  const fila = buscarFilaExistenciaSucursal_(hoja, codigo, sucursal);
  if(fila === -1) return 0;
  return Number(hoja.getRange(fila, 4).getValue()) || 0;
}

/**
 * Existencia, reserva y disponible (calculado, nunca guardado) de un
 * producto en una sucursal — para las pantallas de aprobación/surtido
 * del nuevo flujo de Requisiciones por Sucursal.
 */
function obtenerDisponibleSucursalApp(codigo, sucursal, token){
  requerirSesionActivaApp_(token);
  sucursal = normalizarSucursal_(sucursal);
  const existencia = obtenerExistenciaSucursal_(codigo, sucursal);
  const reservado = obtenerReservaSucursal_(codigo, sucursal);
  return {
    codigo: String(codigo||"").trim(), sucursal: sucursal,
    existencia: existencia, reservado: reservado,
    disponible: Math.round((existencia - reservado) * 1000) / 1000
  };
}

/**
 * Ajusta SOLO la columna Reservado de EXISTENCIAS_SUCURSAL — usada por
 * resolverAjusteExistencia_ para las dos ramas (S01 y no-S01), ya que la
 * reserva vive ahí sin importar de qué sucursal se trate. No toca
 * Existencia; si la fila no existe todavía la crea (Existencia="" para
 * S01 — ese número no se usa ahí, vive en MATRIZ — o 0 para las demás).
 */
function ajustarReservaEnHojaSucursal_(codigo, sucursal, deltaReserva, validarReserva){
  const hoja = obtenerHojaExistenciasSucursal_();
  const fila = buscarFilaExistenciaSucursal_(hoja, codigo, sucursal);
  const anterior = fila !== -1 ? (Number(hoja.getRange(fila, 4).getValue()) || 0) : 0;
  const nueva = Math.round((anterior + deltaReserva) * 1000) / 1000;

  if(validarReserva && nueva < 0){
    throw new Error("No hay esa cantidad reservada para liberar en " + sucursal + ". Reservado actual: " + anterior);
  }

  if(fila === -1){
    hoja.appendRow([codigo, sucursal, sucursal === SUCURSAL_DEFAULT_ ? "" : 0, nueva]);
  } else {
    hoja.getRange(fila, 4).setValue(nueva);
  }

  return { anterior: anterior, nueva: nueva };
}

/**
 * NÚCLEO ÚNICO DE ESCRITURA — la única función de todo el proyecto que
 * decide "MATRIZ o EXISTENCIAS_SUCURSAL" y hace el
 * leer-validar-calcular-escribir real. Todos los escritores públicos de
 * abajo (actualizarExistenciaMatriz_, ajustarExistenciaMatrizPorDelta_,
 * ajustarExistenciaMatrizPorDeltaValidado_, ajustarExistenciaSucursal_,
 * ajustarUnaCeldaExistenciaSinLock_) son envoltorios delgados sobre
 * esta — cada uno preserva su propio contrato de retorno/errores para
 * no romper a sus llamadores actuales (ver auditoría), pero la lógica
 * real vive en un solo lugar.
 *
 * NO adquiere ningún lock por sí misma — quien la llama decide (algunos
 * necesitan mover DOS sucursales dentro de un solo lock atómico, como
 * transferirEntreSucursalesApp).
 *
 * @param {string} codigo
 * @param {string} sucursal Ya normalizada.
 * @param {Object} opciones
 * @param {number}  [opciones.delta]            Cuánto sumar/restar (se ignora si viene nuevaExistencia).
 * @param {number}  [opciones.nuevaExistencia]   Valor absoluto a fijar — tiene prioridad sobre delta.
 * @param {boolean} [opciones.validar]           Si true, lanza error si el resultado quedaría negativo.
 * @param {boolean} [opciones.lanzarSiNoExiste]  Default true. Si false, regresa null en vez de lanzar
 *        cuando el código no existe en MATRIZ (solo aplica a S01 — en EXISTENCIAS_SUCURSAL
 *        la fila se crea sola, "no existe" no es un caso de error ahí).
 * @param {number}  [opciones.deltaReserva]      NUEVO (Fase 4, pipeline de Requisiciones por
 *        Sucursal) — cuánto sumar/restar a Reservado (EXISTENCIAS_SUCURSAL), en la MISMA
 *        lectura-escritura atómica. 0/omitido = comportamiento idéntico a antes de esto existir.
 * @param {boolean} [opciones.validarReserva]    Si true, lanza error si Reservado quedaría negativo.
 * @param {boolean} [opciones.validarDisponible] Si true, lanza error si Reservado quedaría por
 *        encima de la Existencia (nunca se puede reservar más de lo que físicamente hay).
 * @return {{anterior:number, nueva:number, reservaAnterior:number, reservaNueva:number}|null}
 *        reservaAnterior/reservaNueva solo vienen cuando se pidió deltaReserva !== 0.
 */
function resolverAjusteExistencia_(codigo, sucursal, opciones){

  opciones = opciones || {};
  const deltaReserva = Math.round((Number(opciones.deltaReserva) || 0) * 1000) / 1000;

  if(sucursal === SUCURSAL_TODAS_){
    throw new Error('"TODAS" no es una sucursal física — no se puede ajustar existencia ahí. Úsala solo para consultar/agrupar.');
  }

  const calcularNueva = function(anterior){
    return (opciones.nuevaExistencia !== null && opciones.nuevaExistencia !== undefined)
      ? Math.round((Number(opciones.nuevaExistencia) || 0) * 1000) / 1000
      : Math.round((anterior + (Number(opciones.delta) || 0)) * 1000) / 1000;
  };

  let resultado;

  if(sucursal === SUCURSAL_DEFAULT_){

    const fila = buscarFilaMatrizPorCodigo_(codigo);
    if(fila === -1){
      if(opciones.lanzarSiNoExiste === false) return null;
      throw new Error("Producto no encontrado en MATRIZ");
    }

    const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
    const celda = matriz.getRange(fila, 11); // K = Existencia
    const anterior = Number(celda.getValue()) || 0;
    const nueva = calcularNueva(anterior);

    if(opciones.validar && nueva < 0){
      throw new Error("Existencia insuficiente. Disponible: " + anterior);
    }

    celda.setValue(nueva);
    invalidarCacheHoja_("MATRIZ");
    resultado = { anterior: anterior, nueva: nueva };

  } else {

  // Cualquier sucursal que no sea S01 -> EXISTENCIAS_SUCURSAL. Una fila
  // que todavía no existe arranca en 0 (nunca hereda de MATRIZ: MATRIZ
  // es la existencia de S01, no un valor por default de las demás).
  const hoja = obtenerHojaExistenciasSucursal_();
  let fila = buscarFilaExistenciaSucursal_(hoja, codigo, sucursal);
  const anterior = fila !== -1 ? (Number(hoja.getRange(fila, 3).getValue()) || 0) : 0;
  const nueva = calcularNueva(anterior);

  if(opciones.validar && nueva < 0){
    throw new Error("Existencia insuficiente en " + sucursal + ". Disponible: " + anterior);
  }

  if(fila === -1){
    hoja.appendRow([codigo, sucursal, nueva, 0]);
  } else {
    hoja.getRange(fila, 3).setValue(nueva);
  }

  invalidarCacheHoja_("EXISTENCIAS_SUCURSAL");
  resultado = { anterior: anterior, nueva: nueva };

  }

  if(deltaReserva !== 0){

    // validarDisponible: la reserva NUNCA puede superar la existencia real
    // — se comprueba ANTES de escribir (lectura+validación+escritura es un
    // solo paso, dentro del mismo lock que ya sostiene a quien llama), así
    // dos aprobaciones simultáneas del mismo producto no pueden sobre-reservar.
    if(opciones.validarDisponible){
      const reservaActual = obtenerReservaSucursal_(codigo, sucursal);
      const reservaProspectiva = Math.round((reservaActual + deltaReserva) * 1000) / 1000;
      if((resultado.nueva - reservaProspectiva) < 0){
        throw new Error("Existencia insuficiente para reservar en " + sucursal + ". Disponible: " + Math.round((resultado.nueva - reservaActual) * 1000) / 1000);
      }
    }

    const resReserva = ajustarReservaEnHojaSucursal_(codigo, sucursal, deltaReserva, opciones.validarReserva);
    resultado.reservaAnterior = resReserva.anterior;
    resultado.reservaNueva = resReserva.nueva;
    invalidarCacheHoja_("EXISTENCIAS_SUCURSAL");
  }

  return resultado;

}

/**
 * ÚNICA función pública autorizada para FIJAR (valor absoluto) la
 * Existencia de un producto. Quien llama ya hizo la suma/resta o ya
 * tiene el conteo físico. Sin `sucursal` (o con "S01"), escribe en
 * MATRIZ exactamente como siempre; con otra sucursal, en
 * EXISTENCIAS_SUCURSAL — la decisión real vive en resolverAjusteExistencia_.
 *
 * @return {number|null} La existencia que había ANTES del cambio (null si el código no existe en MATRIZ)
 */
function actualizarExistenciaMatriz_(codigo, nuevaExistencia, sucursal){
  sucursal = normalizarSucursal_(sucursal);
  return conBloqueoApp_(function(){
    const resultado = resolverAjusteExistencia_(codigo, sucursal, { nuevaExistencia: nuevaExistencia, lanzarSiNoExiste: false });
    return resultado ? resultado.anterior : null;
  });
}

/**
 * Variante por DELTA: suma (o resta, con delta negativo) a la existencia
 * actual del producto y la deja fija. Útil para Entradas/Salidas, donde
 * lo que se conoce es "cuánto entró/salió", no el total final.
 * Regresa {anterior, nueva} o null si el código no existe en MATRIZ.
 */
function ajustarExistenciaMatrizPorDelta_(codigo, delta, sucursal){
  sucursal = normalizarSucursal_(sucursal);
  return conBloqueoApp_(function(){
    return resolverAjusteExistencia_(codigo, sucursal, { delta: delta, lanzarSiNoExiste: false });
  });
}

/**
 * Variante de ajustarExistenciaMatrizPorDelta_ para SALIDAS: valida que
 * quede suficiente existencia DENTRO del mismo lock que aplica el
 * descuento, en vez de validar antes y descontar después por separado.
 * Antes, dos salidas casi simultáneas del mismo producto podían leer la
 * misma existencia "anterior" cada una fuera del lock, pasar su propia
 * validación por separado, y solo entonces disputarse el lock para
 * restar — la segunda en aplicar su resta ya no volvía a comprobar nada
 * y podía dejar la existencia en negativo. Aquí la lectura, la
 * validación y la escritura son un solo paso atómico: si no alcanza,
 * lanza el error y no escribe nada.
 */
function ajustarExistenciaMatrizPorDeltaValidado_(codigo, delta, sucursal){
  sucursal = normalizarSucursal_(sucursal);
  return conBloqueoApp_(function(){
    return resolverAjusteExistencia_(codigo, sucursal, { delta: delta, validar: true });
  });
}

/**
 * INV-06 (auditoría comparativa vs. MarketMan, Fase 4): extiende a las
 * Requisiciones de Área el MISMO libro de reservas que ya usa el pipeline
 * de Requisiciones por Sucursal (columna Reservado de EXISTENCIAS_SUCURSAL
 * — ver resolverAjusteExistencia_, que ya documentaba "incluida S01" desde
 * que se creó). No se inventa ningún esquema nuevo: Área siempre reserva
 * contra S01/CEDIS, la misma sucursal donde ya vive su existencia física
 * (MATRIZ), así que se reutiliza tal cual el núcleo existente.
 *
 * delta positivo = reservar (al crear una requisición nueva, valida que no
 * se reserve más de lo disponible). delta negativo = liberar (al cancelar
 * o al cerrar por entrega, sin volver a validar disponible — liberar nunca
 * puede dejar la reserva por encima de la existencia).
 */
function ajustarReservaRequisicionAreaPorDelta_(codigo, delta, validarDisponible){
  return conBloqueoApp_(function(){
    return resolverAjusteExistencia_(codigo, SUCURSAL_DEFAULT_, {
      deltaReserva: delta,
      validarDisponible: !!validarDisponible,
      validarReserva: true
    });
  });
}

/**
 * Escritor de EXISTENCIAS_SUCURSAL con su propio lock — envoltorio sobre
 * resolverAjusteExistencia_. `nuevaExistencia` (valor absoluto) tiene
 * prioridad sobre `delta` si ambos llegan; `validar` exige que el
 * resultado no quede negativo. Se conserva por compatibilidad (nombre
 * usado desde hace una sesión), aunque hoy nada la llama fuera de este
 * archivo — los 3 escritores públicos ya van directo al núcleo.
 */
function ajustarExistenciaSucursal_(codigo, sucursal, delta, nuevaExistencia, validar){
  sucursal = normalizarSucursal_(sucursal);
  return conBloqueoApp_(function(){
    return resolverAjusteExistencia_(codigo, sucursal, { delta: delta, nuevaExistencia: nuevaExistencia, validar: validar });
  });
}

// ============================================
// FASE 12 — TRANSFERENCIAS ENTRE SUCURSALES. Mueve existencia de una
// sucursal a otra dentro de UN SOLO conBloqueoApp_: origen y destino se
// ajustan en el mismo lock para que la operación sea atómica de verdad
// — por eso transferirEntreSucursalesApp llama a
// ajustarUnaCeldaExistenciaSinLock_ (que NO abre su propio lock) en vez
// de a los escritores públicos de arriba (cada uno abre y CIERRA el
// suyo; encadenar dos dejaría una ventana entre el descuento de origen
// y el alta en destino donde otra escritura podría colarse).
// ============================================

function ajustarUnaCeldaExistenciaSinLock_(codigo, sucursal, delta, validar){
  sucursal = normalizarSucursal_(sucursal);
  return resolverAjusteExistencia_(codigo, sucursal, { delta: delta, validar: validar });
}

/**
 * Transfiere `cantidad` de un producto de sucursalOrigen a
 * sucursalDestino. Genera Kardex en AMBAS sucursales (una salida, una
 * entrada), enlazadas por el mismo folio TR-. Solo Almacén/Admin puede
 * transferir (mismo criterio que Compras/Recepción/Inventario mensual).
 */
function transferirEntreSucursalesApp(codigo, sucursalOrigen, sucursalDestino, cantidad, token){

  requerirAccesoAlmacenApp_(token);

  codigo = String(codigo||"").trim();
  sucursalOrigen = normalizarSucursal_(sucursalOrigen);
  sucursalDestino = normalizarSucursal_(sucursalDestino);
  cantidad = Number(cantidad) || 0;

  if(!codigo){
    throw new Error("Indica el producto a transferir.");
  }
  if(sucursalOrigen === SUCURSAL_TODAS_ || sucursalDestino === SUCURSAL_TODAS_){
    throw new Error('"TODAS" no es una sucursal física — indica la sucursal real de origen y destino.');
  }
  if(sucursalOrigen === sucursalDestino){
    throw new Error("La sucursal de origen y destino no pueden ser la misma.");
  }
  if(cantidad <= 0){
    throw new Error("Captura una cantidad mayor a cero.");
  }

  const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
  if(filaMatriz === -1){
    throw new Error("Producto no encontrado en MATRIZ");
  }
  const producto = SpreadsheetApp.getActive().getSheetByName("MATRIZ").getRange(filaMatriz, 1).getValue();
  const usuario = obtenerNombreDesdeToken(token);

  let folioTransferencia, anteriorOrigen, nuevaOrigen, anteriorDestino, nuevaDestino;

  conBloqueoApp_(function(){

    folioTransferencia = "TR-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");

    const resOrigen = ajustarUnaCeldaExistenciaSinLock_(codigo, sucursalOrigen, -cantidad, true);
    anteriorOrigen = resOrigen.anterior;
    nuevaOrigen = resOrigen.nueva;

    // Apps Script/Sheets no tiene una transacción real que cubra dos
    // celdas de dos hojas distintas — una vez que el descuento de origen
    // se escribió, ya quedó. Si el alta en destino truena (rarísimo: ya
    // se validó código/sucursal antes de llegar aquí, así que solo un
    // error transitorio de la API podría causarlo), se revierte el
    // descuento de origen DENTRO del mismo lock antes de propagar el
    // error — mejor esfuerzo para que la transferencia completa quede
    // sin efecto neto en vez de a medias.
    try{
      const resDestino = ajustarUnaCeldaExistenciaSinLock_(codigo, sucursalDestino, cantidad, false);
      anteriorDestino = resDestino.anterior;
      nuevaDestino = resDestino.nueva;
    }catch(errorDestino){
      ajustarUnaCeldaExistenciaSinLock_(codigo, sucursalOrigen, cantidad, false);
      throw new Error("No se pudo completar la transferencia — se revirtió el descuento de origen. " + errorDestino.message);
    }

  });

  registrarKardex(
    "TRANSFERENCIA-SALIDA", folioTransferencia, codigo, producto, "", cantidad,
    anteriorOrigen, nuevaOrigen, usuario,
    "Transferencia a " + sucursalDestino + " — folio " + folioTransferencia
  );
  registrarKardex(
    "TRANSFERENCIA-ENTRADA", folioTransferencia, codigo, producto, cantidad, "",
    anteriorDestino, nuevaDestino, usuario,
    "Transferencia desde " + sucursalOrigen + " — folio " + folioTransferencia
  );

  registrarAuditoria(usuario, "TRANSFERENCIAS", "TRANSFERENCIA ENTRE SUCURSALES", folioTransferencia, codigo, producto, cantidad, cantidad,
    sucursalOrigen + " -> " + sucursalDestino);

  return {
    folio: folioTransferencia, sucursalOrigen: sucursalOrigen, sucursalDestino: sucursalDestino,
    cantidad: cantidad, existenciaOrigen: nuevaOrigen, existenciaDestino: nuevaDestino
  };

}

/**
 * MIGRACIÓN — ejecutar UNA sola vez. Convierte la columna Existencia de
 * MATRIZ de fórmula a valor fijo: lee lo que la fórmula tiene calculado
 * en este momento y lo vuelve a escribir como número plano (sin fórmula),
 * sin cambiar ningún valor. Después de correr esto, actualizarExistenciaMatriz_
 * es la única forma de que ese número cambie.
 */
/**
 * MIGRACIÓN — ejecutar UNA sola vez. Convierte Costo Unitario de MATRIZ
 * de "precio de la presentación completa" a "precio de una unidad de
 * inventario real" para los productos con Convertir="SI" y Presentación
 * capturada. Ejemplo: si Costo Unitario decía $300 (precio de la caja
 * de 1000 pz), después de correr esto queda en $0.30 (precio por pz).
 * Los productos con Convertir="NO" no se tocan (ya estaban correctos).
 */
function migrarCostoUnitarioAPorUnidadApp(token){

  requerirNoConsultaApp_(token);

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  if(matriz.getLastRow() < 2) return { filas: 0, migrados: 0 };

  const rango = matriz.getRange(2, 18, matriz.getLastRow() - 1, 3); // R,S,T
  const datos = rango.getValues();

  let migrados = 0;

  const nuevos = datos.map(f => {

    const costoActual = Number(f[0]) || 0;
    const convertir = String(f[1]||"").trim().toUpperCase() === "SI";
    const presentacion = Number(f[2]) || 0;

    if(convertir && presentacion > 0 && costoActual > 0){
      migrados++;
      return [Math.round((costoActual / presentacion) * 10000) / 10000, f[1], f[2]];
    }

    return f; // sin cambios (Convertir="NO", sin presentación, o sin costo)

  });

  rango.setValues(nuevos);
  invalidarCacheHoja_("MATRIZ");

  return { filas: datos.length, migrados: migrados };

}

/**
 * EXCEPCIÓN DOCUMENTADA a la capa central de existencia (auditoría de
 * arquitectura multi-sucursal): esta es una herramienta de migración de
 * un solo uso (congela la fórmula de la columna K a valor fijo), no un
 * movimiento de negocio — por eso escribe directo a MATRIZ en vez de
 * pasar por resolverAjusteExistencia_. No cambia ningún número (solo el
 * tipo de celda, de fórmula a valor), así que no rompe la garantía de
 * "K = fuente única de verdad". Se deja fuera de la capa central a
 * propósito, para no confundir una herramienta de mantenimiento con un
 * movimiento de inventario real.
 */
function congelarFormulasExistenciaMatrizApp(token){

  requerirNoConsultaApp_(token);

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  if(matriz.getLastRow() < 2) return { filas: 0 };

  const rango = matriz.getRange(2, 11, matriz.getLastRow() - 1, 1); // columna K completa
  const valores = rango.getValues(); // valores YA calculados por la fórmula actual

  rango.setValues(valores); // se reescriben como número plano — la fórmula desaparece
  invalidarCacheHoja_("MATRIZ");

  return { filas: valores.length };

}

/**
 * FASE 4 — diagnóstico de consistencia entre Existencia y Kardex. NO
 * modifica nada, solo revisa: si alguna celda de Existencia (columna K
 * de MATRIZ) todavía tuviera una fórmula en vez de un valor congelado,
 * la próxima vez que ese producto tenga un movimiento
 * (ajustarExistenciaMatrizPorDelta_ / actualizarExistenciaMatriz_) esa
 * fórmula se sobrescribiría con un número plano sin avisar — dejando
 * ese producto potencialmente desincronizado hasta ese momento. Se
 * pensó para correrlo manualmente de vez en cuando, o justo antes de
 * ejecutar congelarFormulasExistenciaMatrizApp() por primera vez, para
 * saber exactamente cuántas filas van a cambiar.
 */
function verificarConsistenciaExistenciaApp(token){

  requerirSesionActivaApp_(token);

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  if(matriz.getLastRow() < 2) return { productosConFormula: [], total: 0 };

  const filas = matriz.getLastRow() - 1;
  const formulas = matriz.getRange(2, 11, filas, 1).getFormulas().flat(); // K = Existencia
  const codigos = matriz.getRange(2, 5, filas, 1).getValues().flat();
  const nombres = matriz.getRange(2, 1, filas, 1).getValues().flat();

  const productosConFormula = [];
  formulas.forEach(function(f, i){
    if(f){ // getFormulas() regresa "" en las celdas que ya son valor plano
      productosConFormula.push({ codigo: codigos[i], producto: nombres[i], fila: i + 2 });
    }
  });

  return { productosConFormula: productosConFormula, total: productosConFormula.length };

}

function obtenerHojaHistorialPrecios_(){

  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("HISTORIAL_PRECIOS");

  if(!hoja){
    hoja = ss.insertSheet("HISTORIAL_PRECIOS");
    hoja.appendRow(["Fecha","Código","Producto","Proveedor","Precio Anterior","Precio Nuevo","Diferencia","% Cambio","Usuario","OC"]);
    hoja.getRange(1,1,1,10).setFontWeight("bold");
  }

  return hoja;

}

/**
 * ARQ-03 (auditoría comparativa vs. MarketMan): costo promedio ponderado.
 * Pura y sin efectos secundarios a propósito, para poder probarla sola —
 * mezcla la existencia YA en MATRIZ (a su costo actual) con la cantidad
 * que se está agregando (a su costo de esta entrada) y regresa el nuevo
 * costo por unidad. Con existencia previa en 0 (primera entrada de un
 * producto nuevo, o que llegó a agotarse) regresa directo el costo nuevo
 * — no hay nada que promediar. Con cantidadNueva en 0 regresa el costo
 * anterior sin cambios — nunca divide entre cero.
 *
 * A propósito esta función NO reemplaza a procesarCambioPrecioProducto_
 * ni cambia lo que esa función hace (seguir escribiendo el costo que se
 * le pase y dejar rastro en HISTORIAL_PRECIOS) — solo cambia QUÉ costo le
 * pasan las dos entradas reales de inventario (recepción de OC y
 * producción, ver registrarRecepcionOCApp/registrarProduccionApp). El
 * ajuste manual de Proveedores.gs (ajustarProductoProveedorApp) sigue
 * llamando a procesarCambioPrecioProducto_ directo con el precio
 * capturado, sin pasar por aquí — ese ajuste es una CORRECCIÓN del costo
 * maestro (p. ej. se había capturado el precio de una caja completa en
 * vez de una unidad), no una nueva entrada de inventario, así que
 * promediarlo con el costo viejo (posiblemente incorrecto) perpetuaría el
 * error en vez de corregirlo.
 */
function calcularCostoPromedioPonderado_(existenciaAnterior, costoAnterior, cantidadNueva, costoNuevo){

  const existencia = Math.max(0, Number(existenciaAnterior) || 0);
  const cantidad = Math.max(0, Number(cantidadNueva) || 0);
  const costoViejo = Number(costoAnterior) || 0;
  const costoRecibido = Number(costoNuevo) || 0;

  if(cantidad <= 0) return Math.round(costoViejo * 100) / 100;
  if(existencia <= 0) return Math.round(costoRecibido * 100) / 100;

  const valorTotal = (existencia * costoViejo) + (cantidad * costoRecibido);
  return Math.round((valorTotal / (existencia + cantidad)) * 100) / 100;

}

/**
 * Si precioFactura es distinto al precio que YA tiene el producto en
 * MATRIZ (columna R), actualiza MATRIZ con el nuevo precio y deja un
 * renglón en HISTORIAL_PRECIOS. No hace nada si el precio no cambió,
 * ni si el producto no se encuentra en MATRIZ.
 */
function procesarCambioPrecioProducto_(codigo, producto, proveedor, precioFactura, usuario, oc){

  const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
  if(filaMatriz === -1) return;

  const hoja = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const precioAnterior = Number(hoja.getRange(filaMatriz, 18).getValue()) || 0; // columna R
  const precioNuevo = Number(precioFactura) || 0;

  if(precioNuevo <= 0 || precioNuevo === precioAnterior) return;

  hoja.getRange(filaMatriz, 18).setValue(precioNuevo);
  invalidarCacheHoja_("MATRIZ");

  const diferencia = precioNuevo - precioAnterior;
  const porcentaje = precioAnterior !== 0 ? (diferencia / precioAnterior) * 100 : 0;

  obtenerHojaHistorialPrecios_().appendRow([
    new Date(),
    codigo,
    producto,
    proveedor,
    precioAnterior,
    precioNuevo,
    diferencia,
    Math.round(porcentaje * 100) / 100,
    usuario,
    oc
  ]);

}

/**
 * KPIs para el módulo "Análisis de Costos". periodoDias: cuántos días
 * hacia atrás considerar (por defecto 30).
 */
function obtenerAnalisisCostosApp(periodoDias, token){

  requerirSesionActivaApp_(token);

  const dias = Number(periodoDias) || 30;
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);

  const hoja = SpreadsheetApp.getActive().getSheetByName("HISTORIAL_PRECIOS");

  const vacio = {
    totalCambios: 0,
    incrementoPromedioPct: 0,
    productosQueSubieron: 0,
    productosQueBajaron: 0,
    impactoEconomico: 0,
    proveedorMejoresPrecios: null,
    movimientos: []
  };

  if(!hoja || hoja.getLastRow() < 2) return vacio;

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 10).getValues();

  // Para calcular el "impacto económico" cruzamos cada cambio de precio
  // con la cantidad recibida de ESE producto en ESA orden (columna J = OC).
  const detalle = SpreadsheetApp.getActive().getSheetByName("DETALLE_OC");
  const mapaCantidadPorOcCodigo = {};
  if(detalle && detalle.getLastRow() > 1){
    detalle.getRange(2, 1, detalle.getLastRow()-1, 8).getValues().forEach(f=>{
      const clave = String(f[0]||"").trim().toUpperCase() + "|" + String(f[1]||"").trim();
      mapaCantidadPorOcCodigo[clave] = Number(f[7]) || 0; // recibido
    });
  }

  // Convertir/Presentación actuales por código — el precio guardado en
  // HISTORIAL_PRECIOS es el de una PRESENTACIÓN cuando Convertir="SI",
  // no el de una unidad de inventario.
  const mapaConversionPorCodigo = {};
  const matrizCostos = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  if(matrizCostos && matrizCostos.getLastRow() > 1){
    matrizCostos.getRange(2, 5, matrizCostos.getLastRow()-1, 16).getValues().forEach(f=>{ // E..T
      if(f[0]) mapaConversionPorCodigo[String(f[0]).trim()] = { convertir: f[14], presentacion: f[15] };
    });
  }

  let sumaPorcentajes = 0;
  let cambiosEnPeriodo = 0;
  let productosQueSubieron = 0;
  let productosQueBajaron = 0;
  let impactoEconomico = 0;

  const acumProveedor = {}; // proveedor -> {sumaPct, cuenta}

  const movimientos = [];

  datos.forEach(f=>{

    const fecha = f[0] instanceof Date ? f[0] : new Date(f[0]);
    if(fecha < desde) return;

    const codigo = f[1], producto = f[2], proveedor = f[3] || "Sin proveedor asignado";
    const precioAnterior = Number(f[4]) || 0;
    const precioNuevo = Number(f[5]) || 0;
    const diferencia = Number(f[6]) || 0;
    const pct = Number(f[7]) || 0;
    const oc = f[9];

    cambiosEnPeriodo++;
    sumaPorcentajes += pct;

    if(diferencia > 0) productosQueSubieron++;
    if(diferencia < 0) productosQueBajaron++;

    const cantidad = mapaCantidadPorOcCodigo[String(oc||"").trim().toUpperCase() + "|" + String(codigo||"").trim()] || 0;

    // La diferencia guardada es por presentación cuando aplica — se pasa
    // por la misma función central (usando la diferencia de precio como
    // si fuera el "costo" a convertir) para obtener el impacto real por
    // unidad de inventario antes de multiplicar por la cantidad.
    const conversion = mapaConversionPorCodigo[String(codigo).trim()] || { convertir: "", presentacion: 0 };
    const diferenciaReal = obtenerCostoUnitarioReal_(diferencia, conversion.convertir, conversion.presentacion);
    impactoEconomico += diferenciaReal * cantidad;

    if(!acumProveedor[proveedor]) acumProveedor[proveedor] = { sumaPct: 0, cuenta: 0 };
    acumProveedor[proveedor].sumaPct += pct;
    acumProveedor[proveedor].cuenta++;

    movimientos.push({
      fecha: Utilities.formatDate(fecha, Session.getScriptTimeZone(), "dd/MM/yyyy"),
      codigo: codigo, producto: producto, proveedor: proveedor,
      precioAnterior: precioAnterior, precioNuevo: precioNuevo,
      diferencia: diferencia, porcentaje: pct, oc: oc
    });

  });

  if(cambiosEnPeriodo === 0) return vacio;

  // "Mejor" proveedor = el que en promedio sube menos (o baja más) los precios.
  let proveedorMejor = null;
  let mejorPromedio = Infinity;
  Object.keys(acumProveedor).forEach(p=>{
    const promedio = acumProveedor[p].sumaPct / acumProveedor[p].cuenta;
    if(promedio < mejorPromedio){
      mejorPromedio = promedio;
      proveedorMejor = p;
    }
  });

  movimientos.sort((a,b)=> new Date(b.fecha.split("/").reverse().join("-")) - new Date(a.fecha.split("/").reverse().join("-")));

  return {
    totalCambios: cambiosEnPeriodo,
    incrementoPromedioPct: Math.round((sumaPorcentajes / cambiosEnPeriodo) * 100) / 100,
    productosQueSubieron: productosQueSubieron,
    productosQueBajaron: productosQueBajaron,
    impactoEconomico: Math.round(impactoEconomico * 100) / 100,
    proveedorMejoresPrecios: proveedorMejor ? { proveedor: proveedorMejor, promedioPct: Math.round(mejorPromedio * 100) / 100 } : null,
    movimientos: movimientos.slice(0, 50)
  };

}

/**
 * COM-05 (auditoría comparativa vs. MarketMan): gasto por proveedor a lo
 * largo del tiempo — agrega ORDENES_COMPRA.Total (con impuestos/flete si
 * COM-02 ya los capturó, ver obtenerOrdenesCompraApp) por proveedor,
 * excluyendo únicamente las OC CANCELADA (una orden cancelada nunca
 * representó gasto real, sin importar si ya tenía Total capturado).
 * rangoMeses: cuántos meses hacia atrás considerar (por defecto 6).
 */
function obtenerGastoPorProveedorApp(rangoMeses, token){

  requerirSesionActivaApp_(token);

  const meses = Number(rangoMeses) || 6;
  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);

  const hoja = SpreadsheetApp.getActive().getSheetByName("ORDENES_COMPRA");
  if(!hoja || hoja.getLastRow() < 2){
    return { desde: Utilities.formatDate(desde, Session.getScriptTimeZone(), "dd/MM/yyyy"), proveedores: [] };
  }

  const anchoHoja = Math.min(Math.max(hoja.getLastColumn(), 7), 11);
  const datos = hoja.getRange(2, 1, hoja.getLastRow()-1, anchoHoja).getValues();

  const acumProveedor = {}; // proveedor -> { totalGastado, totalOrdenes, mesesMap: { "yyyy-MM": total } }

  datos.forEach(f=>{

    const estado = String(f[4]||"").trim().toUpperCase();
    if(estado === "CANCELADA") return;

    const fecha = f[1] instanceof Date ? f[1] : new Date(f[1]);
    if(isNaN(fecha.getTime()) || fecha < desde) return;

    const proveedor = String(f[2]||"").trim() || "Sin proveedor";
    const totalConImpuestos = Number(f[10]) || Number(f[5]) || 0;
    const mesClave = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM");

    if(!acumProveedor[proveedor]){
      acumProveedor[proveedor] = { totalGastado: 0, totalOrdenes: 0, mesesMap: {} };
    }

    acumProveedor[proveedor].totalGastado += totalConImpuestos;
    acumProveedor[proveedor].totalOrdenes++;
    acumProveedor[proveedor].mesesMap[mesClave] = (acumProveedor[proveedor].mesesMap[mesClave] || 0) + totalConImpuestos;

  });

  const proveedores = Object.keys(acumProveedor).map(proveedor=>{
    const datosProveedor = acumProveedor[proveedor];
    const totalGastado = Math.round(datosProveedor.totalGastado * 100) / 100;
    return {
      proveedor: proveedor,
      totalGastado: totalGastado,
      totalOrdenes: datosProveedor.totalOrdenes,
      promedioPorOrden: Math.round((totalGastado / datosProveedor.totalOrdenes) * 100) / 100,
      series: Object.keys(datosProveedor.mesesMap).sort().map(mes=>({
        mes: mes, total: Math.round(datosProveedor.mesesMap[mes] * 100) / 100
      }))
    };
  }).sort((a,b)=> b.totalGastado - a.totalGastado);

  return {
    desde: Utilities.formatDate(desde, Session.getScriptTimeZone(), "dd/MM/yyyy"),
    proveedores: proveedores
  };

}


/**
 * Historial de compras de UN producto — de dónde sale: se arma cruzando
 * DETALLE_OC (qué se compró y a qué precio) con ORDENES_COMPRA (fecha y
 * PROVEEDOR DE ESA ORDEN, no el proveedor "habitual" de MATRIZ). Así,
 * si un producto se compró una vez con otro proveedor distinto al de
 * MATRIZ, ese historial lo refleja correctamente.
 */
function obtenerHistorialComprasProductoApp(codigo, token){

  requerirSesionActivaApp_(token);

  const detalle = SpreadsheetApp.getActive().getSheetByName("DETALLE_OC");
  const ordenes = SpreadsheetApp.getActive().getSheetByName("ORDENES_COMPRA");

  if(!detalle || detalle.getLastRow() < 2 || !ordenes || ordenes.getLastRow() < 2) return [];

  const datosOrdenes = ordenes.getRange(2, 1, ordenes.getLastRow() - 1, 7).getValues();
  const mapaOrdenes = {};
  datosOrdenes.forEach(f=>{
    mapaOrdenes[String(f[0]||"").trim().toUpperCase()] = { fecha: f[1], proveedor: f[2] };
  });

  const buscado = String(codigo||"").trim();
  const anchoDetalle = Math.min(detalle.getLastColumn(), 10);
  const datosDetalle = detalle.getRange(2, 1, detalle.getLastRow() - 1, anchoDetalle).getValues();

  const resultados = [];

  datosDetalle.forEach(f=>{

    if(String(f[1]||"").trim() !== buscado) return;

    const oc = String(f[0]||"").trim().toUpperCase();
    const infoOrden = mapaOrdenes[oc];
    if(!infoOrden) return;

    const fecha = infoOrden.fecha instanceof Date
      ? Utilities.formatDate(infoOrden.fecha, Session.getScriptTimeZone(), "dd/MM/yyyy")
      : String(infoOrden.fecha||"");

    resultados.push({
      fecha: fecha,
      proveedor: infoOrden.proveedor,
      precio: Number(f[5]) || 0,
      cantidad: Number(f[3]) || 0,
      oc: oc
    });

  });

  resultados.sort((a,b)=>{
    const da = a.fecha.split("/").reverse().join("-");
    const db = b.fecha.split("/").reverse().join("-");
    return new Date(db) - new Date(da);
  });

  return resultados;

}


// ================================================================
// MÓDULO: INVENTARIO MENSUAL
// Hojas: INVENTARIO_MENSUAL (detalle por producto), CONTROL_INVENTARIO
// (un renglón por folio), HISTORIAL_INVENTARIO (resumen de cierres).
// Reutiliza registrarAuditoria(), registrarKardex() y el patrón de PDF
// en Drive ya usado para Órdenes de Compra.
// ================================================================

function obtenerHojaInventarioMensual_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("INVENTARIO_MENSUAL");
  if(!hoja){
    hoja = ss.insertSheet("INVENTARIO_MENSUAL");
    hoja.appendRow(["Folio","Fecha","Usuario","Código","Producto","Ubicación","UDM","Categoría","Existencia Teórica","Existencia Física","Diferencia","Estado"]);
    hoja.getRange(1,1,1,12).setFontWeight("bold");
  }
  return hoja;
}

function obtenerHojaControlInventario_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("CONTROL_INVENTARIO");
  if(!hoja){
    hoja = ss.insertSheet("CONTROL_INVENTARIO");
    hoja.appendRow(["Folio","Fecha Inicio","Responsable","Productos","Contados","Avance %","Estado","Fecha Cierre","Supervisor","Productos con Diferencia","Exactitud %","Valor Ajustado"]);
    hoja.getRange(1,1,1,12).setFontWeight("bold");
  }
  return hoja;
}

function obtenerHojaHistorialInventario_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("HISTORIAL_INVENTARIO");
  if(!hoja){
    hoja = ss.insertSheet("HISTORIAL_INVENTARIO");
    hoja.appendRow(["Folio","Mes","Fecha Inicio","Fecha Cierre","Responsable","Estado","Productos Contados","Productos con Diferencia","Exactitud","Valor Ajustado"]);
    hoja.getRange(1,1,1,10).setFontWeight("bold");
  }
  return hoja;
}

// ---------------- FASE 3: Generar Inventario ----------------

function generarInventarioMensualApp(token){

  requerirAccesoAlmacenApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const ss = SpreadsheetApp.getActive();
  const matriz = ss.getSheetByName("MATRIZ");
  const inventario = obtenerHojaInventarioMensual_();
  const control = obtenerHojaControlInventario_();

  const fecha = new Date();
  const datosMatriz = matriz.getRange(2, 1, matriz.getLastRow()-1, 18).getValues(); // A..R

  let folio, filas;

  conBloqueoApp_(function(){

    const fechaCodigo = Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyyMMdd");

    let consecutivo = 1;
    if(control.getLastRow() > 1){
      const folios = control.getRange(2,1,control.getLastRow()-1,1).getValues().flat();
      consecutivo = folios.filter(f => f.toString().includes("IM-"+fechaCodigo)).length + 1;
    }
    folio = "IM-" + fechaCodigo + "-" + Utilities.formatString("%03d", consecutivo);

    filas = [];
    datosMatriz.forEach(f=>{
      const ubicacion = String(f[9]||"").trim();
      if(ubicacionVacia_(ubicacion)) return;
      if(!f[4]) return; // sin código

      filas.push([
        folio, fecha, usuario,
        f[4], f[0], ubicacion, f[1] || "", f[2] || "",
        Number(f[10]) || 0, // existencia teórica
        "", // existencia física, pendiente
        "", // diferencia, pendiente
        "PENDIENTE"
      ]);
    });

    if(!filas.length){
      throw new Error("No hay productos con ubicación en MATRIZ para generar el inventario.");
    }

    inventario.getRange(inventario.getLastRow()+1, 1, filas.length, 12).setValues(filas);

    control.appendRow([
      folio, fecha, usuario, filas.length, 0, 0, "ABIERTO", "", "", 0, 0, 0
    ]);

  });

  registrarAuditoria(usuario, "INVENTARIO_MENSUAL", "INICIO INVENTARIO", folio, "", "", 0, 0, "Inventario mensual iniciado con " + filas.length + " producto(s)");

  return { folio: folio, productos: filas.length };

}

function obtenerFoliosInventarioAbiertosApp(token){
  requerirSesionActivaApp_(token);
  const control = obtenerHojaControlInventario_();
  if(control.getLastRow() < 2) return [];
  const datos = control.getRange(2,1,control.getLastRow()-1,7).getValues();
  const folios = [];
  datos.forEach(f=>{
    if(f[0] && f[6] !== "CERRADO" && !folios.includes(f[0])) folios.push(f[0]);
  });
  return folios;
}

// ---------------- FASE 4: Captura ----------------

function buscarCodigoInventarioMensualApp(codigo, folio, token){

  requerirSesionActivaApp_(token);

  const hoja = obtenerHojaInventarioMensual_();
  if(hoja.getLastRow() < 2) return null;

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,12).getValues();

  for(let i=0;i<datos.length;i++){
    const mismoFolio = !folio || String(datos[i][0]) === String(folio);
    if(mismoFolio && String(datos[i][3]) === String(codigo)){
      return {
        fila: i+2, folio: datos[i][0], codigo: datos[i][3], producto: datos[i][4],
        ubicacion: datos[i][5], udm: datos[i][6], categoria: datos[i][7],
        existencia: datos[i][8], fisico: datos[i][9], diferencia: datos[i][10], estado: datos[i][11]
      };
    }
  }
  return null;

}

function buscarProductoPorNombreInventarioMensualApp(texto, folio, token){

  requerirSesionActivaApp_(token);

  const busqueda = normalizarTexto_(texto);
  if(!busqueda) return [];

  const hoja = obtenerHojaInventarioMensual_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,12).getValues();
  const resultados = [];

  for(let i=0;i<datos.length;i++){
    const mismoFolio = !folio || String(datos[i][0]) === String(folio);
    if(!mismoFolio) continue;
    if(normalizarTexto_(datos[i][4]).indexOf(busqueda) === -1) continue;

    // Ya contado: no lo mostramos en la búsqueda, para evitar recapturas
    // accidentales por error.
    if(datos[i][9] !== "" && datos[i][9] !== null) continue;

    resultados.push({
      fila: i+2, folio: datos[i][0], codigo: datos[i][3], producto: datos[i][4],
      ubicacion: datos[i][5], udm: datos[i][6], categoria: datos[i][7],
      existencia: datos[i][8], fisico: datos[i][9], diferencia: datos[i][10], estado: datos[i][11]
    });

    if(resultados.length >= 15) break;
  }

  return resultados;

}

function obtenerSiguientePendienteInventarioMensualApp(folio, token){

  requerirSesionActivaApp_(token);

  const hoja = obtenerHojaInventarioMensual_();
  if(hoja.getLastRow() < 2) return null;

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,12).getValues();

  for(let i=0;i<datos.length;i++){
    const mismoFolio = !folio || String(datos[i][0]) === String(folio);
    if(mismoFolio && datos[i][3] !== "" && datos[i][9] === ""){
      return {
        fila: i+2, folio: datos[i][0], codigo: datos[i][3], producto: datos[i][4],
        ubicacion: datos[i][5], udm: datos[i][6], categoria: datos[i][7],
        existencia: datos[i][8], fisico: datos[i][9], diferencia: datos[i][10], estado: datos[i][11]
      };
    }
  }
  return null;

}

function guardarConteoFisicoInventarioMensualApp(fila, cantidad, token){

  requerirAccesoAlmacenApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const hoja = obtenerHojaInventarioMensual_();

  const folio = hoja.getRange(fila,1).getValue();
  const codigo = hoja.getRange(fila,4).getValue();
  const producto = hoja.getRange(fila,5).getValue();
  const teorica = Number(hoja.getRange(fila,9).getValue()) || 0;
  const fisico = Number(cantidad);

  const diferencia = Math.round((fisico - teorica) * 1000) / 1000;
  const estado = diferencia !== 0 ? "DIFERENCIA" : "CONTADO";

  hoja.getRange(fila,10).setValue(fisico);
  hoja.getRange(fila,11).setValue(diferencia);
  hoja.getRange(fila,12).setValue(estado);

  actualizarAvanceControlInventario_(folio);

  registrarAuditoria(usuario, "INVENTARIO_MENSUAL", "CAPTURA", folio, codigo, producto, teorica, fisico, "Captura de inventario mensual");

  return true;

}

function actualizarAvanceControlInventario_(folio){

  const inventario = obtenerHojaInventarioMensual_();
  const control = obtenerHojaControlInventario_();

  if(inventario.getLastRow() < 2 || control.getLastRow() < 2) return;

  const datos = inventario.getRange(2,1,inventario.getLastRow()-1,12).getValues();

  let total = 0, contados = 0, conDiferencia = 0;
  datos.forEach(f=>{
    if(String(f[0]) !== String(folio)) return;
    total++;
    if(f[9] !== "" && f[9] !== null){
      contados++;
      if(Number(f[10]) !== 0) conDiferencia++;
    }
  });

  const avance = total === 0 ? 0 : Math.round((contados/total)*100);

  const datosControl = control.getRange(2,1,control.getLastRow()-1,12).getValues();
  for(let i=0;i<datosControl.length;i++){
    if(String(datosControl[i][0]) === String(folio)){
      const filaControl = i+2;
      control.getRange(filaControl,5).setValue(contados);
      control.getRange(filaControl,6).setValue(avance);
      control.getRange(filaControl,10).setValue(conDiferencia);
      break;
    }
  }

}

function obtenerAvanceInventarioMensualApp(folio, token){

  requerirSesionActivaApp_(token);

  const hoja = obtenerHojaInventarioMensual_();
  if(hoja.getLastRow() < 2) return { total:0, contados:0, pendientes:0, porcentaje:0 };

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,12).getValues();

  let total = 0, contados = 0;
  datos.forEach(f=>{
    if(String(f[0]) !== String(folio)) return;
    total++;
    if(f[9] !== "" && f[9] !== null) contados++;
  });

  return {
    total: total, contados: contados, pendientes: total-contados,
    porcentaje: total === 0 ? 0 : Math.round((contados/total)*100)
  };

}

// ---------------- FASE 5: Discrepancias ----------------

function obtenerDiscrepanciasInventarioMensualApp(folio, token){

  requerirSesionActivaApp_(token);

  const hoja = obtenerHojaInventarioMensual_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,12).getValues();
  const resultados = [];

  datos.forEach((f,i)=>{
    if(String(f[0]) !== String(folio)) return;
    if(f[9] === "" || f[9] === null) return; // no contado todavía
    if(Number(f[10]) === 0) return; // sin diferencia

    resultados.push({
      fila: i+2, folio: f[0], codigo: f[3], producto: f[4], ubicacion: f[5],
      udm: f[6], categoria: f[7], existencia: f[8], fisico: f[9], diferencia: f[10], estado: f[11]
    });
  });

  return resultados;

}

function aprobarDiscrepanciaInventarioMensualApp(fila, comentario, token){

  requerirAccesoAlmacenApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const hoja = obtenerHojaInventarioMensual_();

  const codigo = hoja.getRange(fila,4).getValue();
  const producto = hoja.getRange(fila,5).getValue();
  const teorica = Number(hoja.getRange(fila,9).getValue()) || 0;
  const fisico = Number(hoja.getRange(fila,10).getValue()) || 0;
  const folio = hoja.getRange(fila,1).getValue();

  hoja.getRange(fila,12).setValue("APROBADO");

  registrarAuditoria(usuario, "INVENTARIO_MENSUAL", "APROBACIÓN DIFERENCIA", folio, codigo, producto, teorica, fisico, comentario || "Diferencia aprobada");

  return true;

}

/**
 * Hermana de aprobarDiscrepanciaInventarioMensualApp — antes no existía
 * ninguna forma de rechazar una diferencia de inventario mensual (a
 * diferencia del conteo cíclico, que sí tiene rechazarDiscrepancia en
 * Código.gs). Sin esto, cerrarInventarioMensualApp no tenía forma de
 * distinguir "todavía sin revisar" de "revisado y descartado" — ver el
 * comentario en cerrarInventarioMensualApp sobre por qué ahora exige que
 * cada diferencia quede en APROBADO o RECHAZADO antes de poder cerrar.
 */
function rechazarDiscrepanciaInventarioMensualApp(fila, comentario, token){

  requerirAccesoAlmacenApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const hoja = obtenerHojaInventarioMensual_();

  const codigo = hoja.getRange(fila,4).getValue();
  const producto = hoja.getRange(fila,5).getValue();
  const teorica = Number(hoja.getRange(fila,9).getValue()) || 0;
  const fisico = Number(hoja.getRange(fila,10).getValue()) || 0;
  const folio = hoja.getRange(fila,1).getValue();

  hoja.getRange(fila,12).setValue("RECHAZADO");

  registrarAuditoria(usuario, "INVENTARIO_MENSUAL", "RECHAZO DIFERENCIA", folio, codigo, producto, teorica, fisico, comentario || "Diferencia rechazada — no se ajusta la existencia");

  return true;

}

/**
 * Aprueba de un jalón todas las filas (diferencias) que se le pasen —
 * usada por el botón "Aprobar todas" en Revisar Diferencias.
 */
function aprobarDiscrepanciasLoteInventarioMensualApp(filas, token){

  requerirAccesoAlmacenApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const hoja = obtenerHojaInventarioMensual_();

  const filasValidas = (filas||[]).filter(fila => Number(fila) > 0);

  let aprobadas = 0;

  if(filasValidas.length){

    // Antes: hasta 6 llamadas a la API de Sheets POR fila (5 getRange().getValue()
    // + 1 setValue()) dentro del forEach — con 50 filas eso son ~300 llamadas.
    // Ahora: una sola lectura en bloque que cubre desde la primera hasta la
    // última fila a aprobar (aunque "filas" no sea contiguo, sigue siendo 1
    // sola llamada), se calcula todo en memoria, y una sola escritura en
    // bloque al final con getRangeList — mismo resultado, mismos datos de
    // auditoría, sin tocar la hoja fila por fila.
    const filaMin = Math.min.apply(null, filasValidas);
    const filaMax = Math.max.apply(null, filasValidas);
    const bloque = hoja.getRange(filaMin, 1, filaMax - filaMin + 1, 12).getValues();

    const rangosAprobar = [];

    filasValidas.forEach(fila => {
      const f = bloque[fila - filaMin];
      const estadoActual = f[11]; // col 12
      if(estadoActual === "APROBADO") return;

      const folio = f[0];      // col 1
      const codigo = f[3];     // col 4
      const producto = f[4];   // col 5
      const teorica = Number(f[8]) || 0;  // col 9
      const fisico = Number(f[9]) || 0;   // col 10

      rangosAprobar.push("L" + fila); // col 12 = L
      aprobadas++;

      registrarAuditoria(usuario, "INVENTARIO_MENSUAL", "APROBACIÓN DIFERENCIA", folio, codigo, producto, teorica, fisico, "Aprobada en lote");
    });

    if(rangosAprobar.length){
      hoja.getRangeList(rangosAprobar).setValue("APROBADO");
    }

  }

  return { aprobadas: aprobadas };

}

// ---------------- FASE 6: Cierre ----------------

function cerrarInventarioMensualApp(folio, supervisor, token){

  requerirAccesoAlmacenApp_(token);

  const usuario = obtenerNombreDesdeToken(token);
  const ss = SpreadsheetApp.getActive();
  const inventario = obtenerHojaInventarioMensual_();
  const control = obtenerHojaControlInventario_();
  const historial = obtenerHojaHistorialInventario_();
  const matriz = ss.getSheetByName("MATRIZ");
  const auditoriaAjustes = ss.getSheetByName("AUDITORIA_AJUSTES");
  const entradaHoja = ss.getSheetByName("ENTRADA");
  const salidaHoja = ss.getSheetByName("SALIDA");

  if(inventario.getLastRow() < 2){
    throw new Error("No hay inventario para cerrar.");
  }

  const datos = inventario.getRange(2,1,inventario.getLastRow()-1,12).getValues();

  // Mapa código -> fila en MATRIZ, para poder actualizar existencia.
  const datosMatriz = matriz.getRange(2, 1, matriz.getLastRow()-1, 11).getValues();
  const mapaMatriz = {};
  datosMatriz.forEach((f,i)=>{ if(f[4]) mapaMatriz[String(f[4]).trim()] = i+2; });

  // Antes de esta corrección, el cierre aplicaba TODA diferencia a MATRIZ
  // sin importar si alguien la había "aprobado" o no en la pantalla de
  // Revisar Diferencias — aprobarDiscrepanciaInventarioMensualApp solo
  // ponía una etiqueta cosmética que nadie más leía. Ahora una diferencia
  // sin resolver (ni APROBADO ni RECHAZADO) bloquea el cierre igual que un
  // producto sin contar, y una RECHAZADA se cuenta pero no se le aplica
  // ningún ajuste a existencia — solo una APROBADA mueve MATRIZ.
  //
  // Esta validación corre en una pasada PREVIA y separada (sin tocar
  // ninguna hoja) a propósito: si se mezclara con la pasada que aplica los
  // ajustes (como pasaba antes con "pendientes"), un folio con una fila sin
  // resolver dejaría ya aplicadas a MATRIZ las filas aprobadas que se
  // procesaron antes de encontrarla, y el error solo se lanzaría después —
  // un cierre "fallido" a medias. Validando todo primero, o se cierra
  // completo o no se toca nada.
  let pendientes = 0;
  let sinResolver = 0;

  datos.forEach(f=>{
    if(String(f[0]) !== String(folio)) return;
    if(f[9] === "" || f[9] === null){ pendientes++; return; }
    const diferencia = Number(f[10]) || 0;
    if(diferencia === 0) return;
    const estado = String(f[11] || "").trim().toUpperCase();
    if(estado !== "APROBADO" && estado !== "RECHAZADO") sinResolver++;
  });

  if(pendientes > 0){
    throw new Error("El inventario todavía tiene " + pendientes + " producto(s) sin contar.");
  }

  if(sinResolver > 0){
    throw new Error("Hay " + sinResolver + " diferencia(s) sin aprobar ni rechazar todavía. Resuélvelas en \"Revisar Diferencias\" antes de cerrar.");
  }

  let contados = 0;
  let conDiferencia = 0;
  let valorAjustado = 0;
  const ajustesKardex = [];
  const ajustesAuditoria = [];
  const fechaCierre = new Date();

  datos.forEach(f=>{

    if(String(f[0]) !== String(folio)) return;

    if(f[9] === "" || f[9] === null) return;

    contados++;

    const teorica = Number(f[8]) || 0;
    const fisico = Number(f[9]) || 0;
    const diferencia = Number(f[10]) || 0;
    const codigo = String(f[3]).trim();
    const producto = f[4];
    const ubicacion = f[5];
    const estado = String(f[11] || "").trim().toUpperCase();

    if(diferencia === 0) return;

    // RECHAZADA: ya se validó arriba que todo lo demás quedó APROBADO.
    if(estado === "RECHAZADO") return;

    conDiferencia++;

    const filaMatriz = mapaMatriz[codigo];
    let costoUnitario = 0;
    let convertir = "";
    let presentacionProducto = 0;

    if(filaMatriz){
      const infoCosto = matriz.getRange(filaMatriz, 18, 1, 3).getValues()[0]; // R, S, T
      costoUnitario = Number(infoCosto[0]) || 0;
      convertir = infoCosto[1];
      presentacionProducto = infoCosto[2];
    }

    // Única fuente de verdad para la existencia — se fija al valor
    // contado físicamente (no es un delta, es el total final).
    actualizarExistenciaMatriz_(codigo, fisico);

    valorAjustado += calcularValorInventario_(diferencia, costoUnitario, convertir, presentacionProducto);

    ajustesKardex.push({ codigo, producto, diferencia, existenciaAnterior: teorica, existenciaNueva: fisico });

    ajustesAuditoria.push([
      fechaCierre, codigo, producto, teorica, fisico, diferencia, usuario,
      "Ajuste por inventario mensual " + folio, ubicacion
    ]);

    // Mismo patrón que la aprobación de discrepancias del conteo cíclico:
    // diferencia positiva (sobrante) → ENTRADA; negativa (faltante) → SALIDA.
    const filaMovimiento = [
      fechaCierre.getFullYear(),
      obtenerMesLetra(fechaCierre),
      fechaCierre,
      codigo,
      producto,
      Math.abs(diferencia),
      "",
      "AJUSTE-INVENTARIO MENSUAL " + folio,
      "",
      "",
      ubicacion
    ];

    if(diferencia > 0 && entradaHoja){
      entradaHoja.appendRow(filaMovimiento);
    } else if(diferencia < 0 && salidaHoja){
      salidaHoja.appendRow(filaMovimiento);
    }

  });

  ajustesKardex.forEach(a=>{
    registrarKardex(
      "AJUSTE", folio, a.codigo, a.producto,
      a.diferencia > 0 ? a.diferencia : "",
      a.diferencia < 0 ? Math.abs(a.diferencia) : "",
      a.existenciaAnterior, a.existenciaNueva, usuario,
      "Ajuste por inventario mensual " + folio
    );
  });

  if(ajustesAuditoria.length && auditoriaAjustes){
    auditoriaAjustes.getRange(auditoriaAjustes.getLastRow()+1, 1, ajustesAuditoria.length, 9).setValues(ajustesAuditoria);
  }

  // Marcar todo el folio como CERRADO en INVENTARIO_MENSUAL.
  const rangoEstado = inventario.getRange(2, 1, inventario.getLastRow()-1, 12).getValues();
  rangoEstado.forEach((f,i)=>{
    if(String(f[0]) === String(folio)){
      inventario.getRange(i+2, 12).setValue("CERRADO");
    }
  });

  const exactitud = contados === 0 ? 100 : Math.round(((contados - conDiferencia) / contados) * 10000) / 100;
  valorAjustado = Math.round(valorAjustado * 100) / 100;

  // Actualizar CONTROL_INVENTARIO
  let fechaInicio = fechaCierre;
  let responsable = usuario;
  const datosControl = control.getRange(2,1,control.getLastRow()-1,12).getValues();
  for(let i=0;i<datosControl.length;i++){
    if(String(datosControl[i][0]) === String(folio)){
      const filaControl = i+2;
      fechaInicio = datosControl[i][1];
      responsable = datosControl[i][2];
      control.getRange(filaControl, 7).setValue("CERRADO");
      control.getRange(filaControl, 8).setValue(fechaCierre);
      control.getRange(filaControl, 9).setValue(supervisor || "");
      control.getRange(filaControl, 10).setValue(conDiferencia);
      control.getRange(filaControl, 11).setValue(exactitud);
      control.getRange(filaControl, 12).setValue(valorAjustado);
      break;
    }
  }

  historial.appendRow([
    folio,
    Utilities.formatDate(fechaCierre, Session.getScriptTimeZone(), "MMMM yyyy"),
    fechaInicio, fechaCierre, responsable, "CERRADO",
    contados, conDiferencia, exactitud, valorAjustado
  ]);

  registrarAuditoria(usuario, "INVENTARIO_MENSUAL", "CIERRE", folio, "", "", 0, 0,
    "Inventario cerrado — " + contados + " contados, " + conDiferencia + " con diferencia, exactitud " + exactitud + "%");

  const pdf = generarYGuardarPDFInventarioMensual_(folio);

  return {
    productosContados: contados,
    productosConDiferencia: conDiferencia,
    exactitud: exactitud,
    valorAjustado: valorAjustado,
    pdf: pdf
  };

}

// ---------------- FASE 7: Historial ----------------

function obtenerHistorialInventariosApp(token){

  requerirSesionActivaApp_(token);

  const historial = obtenerHojaHistorialInventario_();
  const control = obtenerHojaControlInventario_();

  const cerrados = historial.getLastRow() > 1
    ? historial.getRange(2,1,historial.getLastRow()-1,10).getValues().map(f=>({
        folio: f[0], mes: f[1],
        fechaInicio: f[2] instanceof Date ? Utilities.formatDate(f[2], Session.getScriptTimeZone(), "dd/MM/yyyy") : f[2],
        fechaCierre: f[3] instanceof Date ? Utilities.formatDate(f[3], Session.getScriptTimeZone(), "dd/MM/yyyy") : f[3],
        responsable: f[4], estado: f[5], productosContados: f[6],
        productosConDiferencia: f[7], exactitud: f[8], valorAjustado: f[9]
      }))
    : [];

  const abiertos = control.getLastRow() > 1
    ? control.getRange(2,1,control.getLastRow()-1,12).getValues()
        .filter(f=>f[6] !== "CERRADO")
        .map(f=>({
          folio: f[0],
          mes: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "MMMM yyyy") : "",
          fechaInicio: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : f[1],
          fechaCierre: "", responsable: f[2], estado: f[6],
          productosContados: f[4], productosConDiferencia: f[9] || 0, exactitud: f[10] || 0, valorAjustado: f[11] || 0
        }))
    : [];

  return abiertos.concat(cerrados).sort((a,b)=> (a.folio < b.folio ? 1 : -1));

}

// Versión interna sin guard propio — usada por los generadores de PDF
// (construirHtmlInventarioMensual_/Completo_), que ya son de por sí
// funciones internas sin token. La pública (abajo) es la única que debe
// llamarse desde el cliente.
function obtenerDetalleInventarioApp_(folio){

  const hoja = obtenerHojaInventarioMensual_();
  if(hoja.getLastRow() < 2) return [];

  return hoja.getRange(2,1,hoja.getLastRow()-1,12).getValues()
    .filter(f=>String(f[0]) === String(folio))
    .map(f=>({
      codigo: f[3], producto: f[4], ubicacion: f[5], udm: f[6], categoria: f[7],
      teorica: f[8], fisico: f[9], diferencia: f[10], estado: f[11]
    }));

}

function obtenerDetalleInventarioApp(folio, token){
  requerirSesionActivaApp_(token);
  return obtenerDetalleInventarioApp_(folio);
}

// ---------------- FASE 8: Dashboard ----------------

function obtenerDashboardInventarioMensualApp(token){

  requerirSesionActivaApp_(token);

  const historial = obtenerHojaHistorialInventario_();

  if(historial.getLastRow() < 2){
    return { hayDatos: false };
  }

  const datos = historial.getRange(2,1,historial.getLastRow()-1,10).getValues();

  const ultimo = datos[datos.length-1];
  const fechaInicio = ultimo[2] instanceof Date ? ultimo[2] : new Date(ultimo[2]);
  const fechaCierre = ultimo[3] instanceof Date ? ultimo[3] : new Date(ultimo[3]);
  const tiempoCapturaHoras = Math.round(((fechaCierre - fechaInicio) / (1000*60*60)) * 10) / 10;

  const porMes = datos.slice(-12).map(f=>({
    mes: f[1],
    exactitud: f[8],
    productosConDiferencia: f[7],
    valorAjustado: f[9]
  }));

  // Top 10 productos con más diferencias (contando ocurrencias en TODOS los inventarios cerrados).
  const inventario = obtenerHojaInventarioMensual_();
  const conteoPorProducto = {};

  if(inventario.getLastRow() > 1){
    inventario.getRange(2,1,inventario.getLastRow()-1,12).getValues().forEach(f=>{
      if(f[11] !== "CERRADO") return;
      if(Number(f[10]) === 0 || f[10] === "") return;
      const clave = f[3] + "|" + f[4];
      if(!conteoPorProducto[clave]) conteoPorProducto[clave] = { codigo: f[3], producto: f[4], veces: 0, sumaAbsDiferencia: 0 };
      conteoPorProducto[clave].veces++;
      conteoPorProducto[clave].sumaAbsDiferencia += Math.abs(Number(f[10]));
    });
  }

  const topDiferencias = Object.values(conteoPorProducto)
    .sort((a,b)=> b.veces - a.veces)
    .slice(0,10);

  return {
    hayDatos: true,
    ultimoFolio: ultimo[0],
    ultimaExactitud: ultimo[8],
    ultimosProductosContados: ultimo[6],
    ultimosProductosConDiferencia: ultimo[7],
    ultimoValorAjustado: ultimo[9],
    ultimoResponsable: ultimo[4],
    tiempoCapturaHoras: tiempoCapturaHoras,
    porMes: porMes,
    topDiferencias: topDiferencias
  };

}

// ---------------- FASE 9: PDF corporativo ----------------

const CARPETA_INVENTARIOS_ = "Inventarios Mensuales";

function obtenerCarpetaInventarios_(){
  const carpetas = DriveApp.getFoldersByName(CARPETA_INVENTARIOS_);
  if(carpetas.hasNext()) return carpetas.next();
  return DriveApp.createFolder(CARPETA_INVENTARIOS_);
}

function construirHtmlInventarioMensual_(folio){

  const control = obtenerHojaControlInventario_();
  const datosControl = control.getRange(2,1,control.getLastRow()-1,12).getValues();
  let info = null;
  datosControl.forEach(f=>{ if(String(f[0]) === String(folio)) info = f; });

  if(!info) throw new Error("No se encontró el inventario " + folio);

  const items = obtenerDetalleInventarioApp_(folio);
  const conDiferencia = items.filter(it=>Number(it.diferencia) !== 0);

  const fechaInicio = info[1] instanceof Date ? Utilities.formatDate(info[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : info[1];
  const fechaCierre = info[7] instanceof Date ? Utilities.formatDate(info[7], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : "";
  const responsable = info[2];
  const supervisor = info[8] || "";
  const estado = info[6];
  const productos = info[3];
  const contados = info[4];
  const conDif = info[9];
  const exactitud = info[10];
  const valorAjustado = info[11];

  // Costo unitario, convertir y presentación por código, para poder
  // mostrar el valor ($$) real de cada diferencia — así los jefes ven
  // de inmediato qué ajustes pesan más.
  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datosMatriz = matriz.getRange(2, 1, matriz.getLastRow()-1, 20).getValues();
  const costoPorCodigo = {};
  datosMatriz.forEach(f=>{
    if(!f[4]) return;
    costoPorCodigo[String(f[4]).trim()] = { costo: Number(f[17]) || 0, convertir: f[18], presentacion: f[19] };
  });

  const conValor = conDiferencia.map(it=>{
    const info = costoPorCodigo[String(it.codigo).trim()] || { costo: 0, convertir: "", presentacion: 0 };
    const valorAjuste = calcularValorInventario_(it.diferencia, info.costo, info.convertir, info.presentacion);
    return Object.assign({}, it, { costo: info.costo, valorAjuste: valorAjuste });
  });

  // Los ajustes de mayor impacto económico primero — es lo que más le
  // importa a un jefe al abrir el reporte.
  conValor.sort((a,b) => Math.abs(b.valorAjuste) - Math.abs(a.valorAjuste));

  const sobrantes = conValor.filter(it => it.diferencia > 0).length;
  const faltantes = conValor.filter(it => it.diferencia < 0).length;
  const sinDiferencia = contados - conDif;

  const resumenTexto = "Se contaron " + contados + " de " + productos + " producto(s) programados. " +
    conDif + " producto(s) presentaron diferencia (" + sobrantes + " con sobrante, " + faltantes + " con faltante) " +
    "y " + sinDiferencia + " coincidieron exactamente con el sistema. La exactitud general del inventario fue de " + exactitud + "%." +
    (conValor.length > 80 ? " La tabla muestra los 80 productos de mayor impacto económico, de " + conValor.length + " con diferencia en total." : "");

  const filasHtml = conValor.slice(0,80).map((it,i)=>`
    <tr style="background:${i%2===0?'#ffffff':'#F9F5EF'}">
      <td>${it.codigo}</td>
      <td>${it.producto}</td>
      <td style="text-align:center">${it.ubicacion}</td>
      <td style="text-align:center">${it.udm||""}</td>
      <td style="text-align:right">${formatearCantidad_(it.teorica)}</td>
      <td style="text-align:right">${formatearCantidad_(it.fisico)}</td>
      <td style="text-align:right;color:${it.diferencia>0?'#5C6B2A':'#C4522A'};font-weight:700">${it.diferencia>0?"+":""}${formatearCantidad_(it.diferencia)}</td>
      <td style="text-align:right;color:${it.valorAjuste>=0?'#5C6B2A':'#C4522A'};font-weight:700">${it.valorAjuste>=0?"+":""}$${formatearMoneda_(it.valorAjuste)}</td>
    </tr>
  `).join("");

  const generado = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  return construirHtmlDocumentoTagers_({
    titulo: "INVENTARIO MENSUAL",
    folio: folio,
    colorEstado: estado === "CERRADO" ? "#5C6B2A" : "#C4522A",
    estado: estado,
    infoGrid: [
      { etiqueta: "Responsable", valor: responsable },
      { etiqueta: "Fecha inicio", valor: fechaInicio },
      { etiqueta: "Fecha cierre", valor: fechaCierre || "—" },
      { etiqueta: "Supervisor", valor: supervisor || "—" }
    ],
    kpis: [
      { num: productos, lbl: "Productos programados" },
      { num: contados, lbl: "Contados" },
      { num: conDif, lbl: "Con diferencia" },
      { num: exactitud + "%", lbl: "Exactitud" }
    ],
    observaciones: resumenTexto,
    etiquetaObservaciones: "Resumen ejecutivo",
    tablaEncabezados: `<th>Código</th><th>Producto</th><th style="text-align:center">Ubicación</th><th style="text-align:center">UDM</th><th style="text-align:right">Teórica</th><th style="text-align:right">Física</th><th style="text-align:right">Diferencia</th><th style="text-align:right">Valor ajuste</th>`,
    tablaFilas: filasHtml,
    etiquetaTotal: "Valor económico ajustado",
    monto: valorAjustado,
    firmas: ["Responsable", "Supervisor"],
    generado: generado
  });

}

function generarYGuardarPDFInventarioMensual_(folio){

  const html = construirHtmlInventarioMensual_(folio);
  const pdfBlob = HtmlService.createHtmlOutput(html).getAs("application/pdf").setName(folio + ".pdf");

  const carpeta = obtenerCarpetaInventarios_();
  const existentes = carpeta.getFilesByName(folio + ".pdf");
  while(existentes.hasNext()){ existentes.next().setTrashed(true); }

  const archivo = carpeta.createFile(pdfBlob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: archivo.getId(),
    verUrl: "https://drive.google.com/file/d/" + archivo.getId() + "/view",
    descargarUrl: "https://drive.google.com/uc?export=download&id=" + archivo.getId()
  };

}

function obtenerPDFInventarioMensualApp(folio, token){
  requerirSesionActivaApp_(token);
  return generarYGuardarPDFInventarioMensual_(folio);
}

/**
 * Igual que construirHtmlInventarioMensual_ pero con TODOS los productos
 * contados (con y sin diferencia) — para descargar el inventario completo,
 * no solo el resumen de diferencias. Mismo diseño y colores.
 */
function construirHtmlInventarioMensualCompleto_(folio){

  const control = obtenerHojaControlInventario_();
  const datosControl = control.getRange(2,1,control.getLastRow()-1,12).getValues();
  let info = null;
  datosControl.forEach(f=>{ if(String(f[0]) === String(folio)) info = f; });

  if(!info) throw new Error("No se encontró el inventario " + folio);

  const items = obtenerDetalleInventarioApp_(folio);

  const fechaInicio = info[1] instanceof Date ? Utilities.formatDate(info[1], Session.getScriptTimeZone(), "dd/MM/yyyy") : info[1];
  const fechaCierre = info[7] instanceof Date ? Utilities.formatDate(info[7], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : "";
  const responsable = info[2];
  const supervisor = info[8] || "";
  const estado = info[6];
  const productos = info[3];
  const contados = info[4];
  const conDif = info[9];
  const exactitud = info[10];
  const valorAjustado = info[11];

  // Alfabético por nombre de producto (no por código).
  const ordenado = items.slice().sort((a,b) => String(a.producto).localeCompare(String(b.producto), "es"));

  const filasHtml = ordenado.map((it,i)=>{
    const tieneDif = Number(it.diferencia) !== 0;
    return `
    <tr style="background:${i%2===0?'#ffffff':'#F9F5EF'}">
      <td>${it.codigo}</td>
      <td>${it.producto}</td>
      <td style="text-align:center">${it.ubicacion}</td>
      <td style="text-align:center">${it.udm||""}</td>
      <td>${it.categoria||""}</td>
      <td style="text-align:right">${formatearCantidad_(it.teorica)}</td>
      <td style="text-align:right">${it.fisico === "" ? "—" : formatearCantidad_(it.fisico)}</td>
      <td style="text-align:right;${tieneDif?`color:${it.diferencia>0?'#5C6B2A':'#C4522A'};font-weight:700`:''}">${it.fisico === "" ? "—" : (tieneDif ? (it.diferencia>0?"+":"")+formatearCantidad_(it.diferencia) : "0")}</td>
      <td>${it.estado}</td>
    </tr>
  `;
  }).join("");

  const resumenTexto = "Listado completo del inventario: " + items.length + " producto(s) programados, " +
    contados + " contados y " + conDif + " con diferencia. Exactitud general: " + exactitud + "%.";

  const generado = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  return construirHtmlDocumentoTagers_({
    titulo: "INVENTARIO MENSUAL — LISTADO COMPLETO",
    folio: folio,
    colorEstado: estado === "CERRADO" ? "#5C6B2A" : "#C4522A",
    estado: estado,
    infoGrid: [
      { etiqueta: "Responsable", valor: responsable },
      { etiqueta: "Fecha inicio", valor: fechaInicio },
      { etiqueta: "Fecha cierre", valor: fechaCierre || "—" },
      { etiqueta: "Supervisor", valor: supervisor || "—" }
    ],
    kpis: [
      { num: productos, lbl: "Productos programados" },
      { num: contados, lbl: "Contados" },
      { num: conDif, lbl: "Con diferencia" },
      { num: exactitud + "%", lbl: "Exactitud" }
    ],
    observaciones: resumenTexto,
    etiquetaObservaciones: "Resumen ejecutivo",
    tablaEncabezados: `<th>Código</th><th>Producto</th><th style="text-align:center">Ubicación</th><th style="text-align:center">UDM</th><th>Categoría</th><th style="text-align:right">Teórica</th><th style="text-align:right">Física</th><th style="text-align:right">Diferencia</th><th>Estado</th>`,
    tablaFilas: filasHtml,
    etiquetaTotal: "Valor económico ajustado",
    monto: valorAjustado,
    firmas: ["Responsable", "Supervisor"],
    generado: generado
  });

}

function generarYGuardarPDFInventarioMensualCompleto_(folio){

  const html = construirHtmlInventarioMensualCompleto_(folio);
  const pdfBlob = HtmlService.createHtmlOutput(html).getAs("application/pdf").setName(folio + "-completo.pdf");

  const carpeta = obtenerCarpetaInventarios_();
  const existentes = carpeta.getFilesByName(folio + "-completo.pdf");
  while(existentes.hasNext()){ existentes.next().setTrashed(true); }

  const archivo = carpeta.createFile(pdfBlob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: archivo.getId(),
    verUrl: "https://drive.google.com/file/d/" + archivo.getId() + "/view",
    descargarUrl: "https://drive.google.com/uc?export=download&id=" + archivo.getId()
  };

}

function obtenerPDFInventarioMensualCompletoApp(folio, token){
  requerirSesionActivaApp_(token);
  return generarYGuardarPDFInventarioMensualCompleto_(folio);
}


// ================================================================
// MÓDULO: REQUISICIONES INTERNAS
// Hojas: REQUISICIONES (encabezado), DETALLE_REQUISICIONES (detalle).
// El área de cada usuario sale de la columna F ("Área") de tu hoja
// USUARIOS — agrégala si no existe: Correo | Nombre | Password | Rol |
// Estado | Área. Reutiliza tal cual tu sistema de sesión (Sesiones.gs)
// y de existencia (ajustarExistenciaMatrizPorDelta_) — no se tocó nada
// de eso.
// ================================================================

/**
 * Convierte la fecha requerida capturada en el front-end (string
 * "yyyy-MM-dd" de un <input type="date">) a un Date real para guardar en
 * la hoja. Vacía/inválida → "" (no se guarda), nunca truena la
 * requisición completa por un dato opcional mal formado. Compartida por
 * Requisiciones (Área) y Requisiciones por Sucursal.
 */
function parsearFechaRequerida_(texto){
  if(!texto) return "";
  const partes = String(texto).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!partes) return "";
  const fecha = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return isNaN(fecha.getTime()) ? "" : fecha;
}

function obtenerHojaRequisiciones_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("REQUISICIONES");
  if(!hoja){
    hoja = ss.insertSheet("REQUISICIONES");
    hoja.appendRow(["Folio","Fecha","Área","Solicitante","Estado","Observaciones","Fecha Entrega","Entregó","Fecha Requerida"]);
    hoja.getRange(1,1,1,9).setFontWeight("bold");
  }
  return hoja;
}

function obtenerHojaDetalleRequisiciones_(){
  const ss = SpreadsheetApp.getActive();
  let hoja = ss.getSheetByName("DETALLE_REQUISICIONES");
  if(!hoja){
    hoja = ss.insertSheet("DETALLE_REQUISICIONES");
    hoja.appendRow(["Folio","Código","Producto","Unidad","Solicitado","Entregado"]);
    hoja.getRange(1,1,1,6).setFontWeight("bold");
  }
  return hoja;
}

/**
 * Área de un usuario según la columna F ("Área") de USUARIOS. Si esa
 * columna no existe todavía en tu hoja, agrégala — no se necesita
 * ninguna columna más.
 */
function obtenerAreaUsuarioPorCorreo_(correo){
  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(!hoja) return "";
  const datos = hoja.getDataRange().getValues();
  const buscado = String(correo||"").toLowerCase().trim();
  for(let i=1;i<datos.length;i++){
    if(String(datos[i][0]||"").toLowerCase().trim() === buscado){
      return String(datos[i][5]||"").trim(); // columna F
    }
  }
  return "";
}

/**
 * FASE 11 — modelo de permisos multi-sucursal (diseño previo ya
 * autorizado a implementar). Columna G ("Sucursal") de USUARIOS, misma
 * idea que Área (columna F) pero para la ubicación física, no el
 * departamento. Si la columna no existe todavía o el usuario no tiene
 * valor capturado, normalizarSucursal_("") la resuelve a
 * SUCURSAL_DEFAULT_ ("S01") — así ningún usuario existente pierde
 * acceso el día que se agregue la columna: sigue viendo exactamente lo
 * mismo que hoy, la única sucursal operativa.
 */
function obtenerSucursalUsuarioPorCorreo_(correo){
  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(!hoja) return "";
  const datos = hoja.getDataRange().getValues();
  const buscado = String(correo||"").toLowerCase().trim();
  for(let i=1;i<datos.length;i++){
    if(String(datos[i][0]||"").toLowerCase().trim() === buscado){
      return String(datos[i][6]||"").trim(); // columna G
    }
  }
  return "";
}

/**
 * Acceso del usuario actual a datos por sucursal: su propia sucursal, y
 * si puede ver/operar TODAS (ADMIN, o Sucursal="TODAS" capturada a
 * mano para un usuario corporativo). Mismo shape y mismo criterio que
 * obtenerAccesoRequisicionesApp — a propósito, para que cualquier
 * pantalla que ya sepa usar uno sepa usar el otro.
 */
function obtenerAccesoSucursalApp(token){
  requerirSesionActivaApp_(token);
  const correo = obtenerCorreoDesdeToken_(token);
  const rol = obtenerRolDesdeToken(token);
  const sucursal = normalizarSucursal_(obtenerSucursalUsuarioPorCorreo_(correo));
  const esTodasLasSucursales = String(rol||"").toUpperCase() === "ADMIN" || sucursal === SUCURSAL_TODAS_;
  return { sucursal: sucursal, esTodasLasSucursales: esTodasLasSucursales };
}

/**
 * Lista las sucursales que el sistema ya conoce — para poblar un
 * selector con buscador (Transferencias, etc.) sin tener que teclear el
 * código a mano y arriesgar un typo. No hay una hoja "catálogo de
 * sucursales" (a propósito, ver diseño de Opción B): se arma juntando
 * los valores distintos de USUARIOS.Sucursal y de
 * EXISTENCIAS_SUCURSAL.Sucursal, sin duplicados, sin "TODAS" (no es una
 * sucursal física), y siempre incluye SUCURSAL_DEFAULT_ ("S01") aunque
 * todavía no tenga fila propia en ningún lado — es la única que opera
 * hoy. La lista crece sola en cuanto una sucursal nueva (S07, S08...)
 * tenga al menos un usuario o un movimiento — no requiere tocar código.
 */
function obtenerSucursalesConocidasApp(token){
  requerirSesionActivaApp_(token);

  const encontradas = {};
  encontradas[SUCURSAL_DEFAULT_] = true;

  const usuarios = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(usuarios && usuarios.getLastRow() > 1){
    usuarios.getRange(2, 7, usuarios.getLastRow() - 1, 1).getValues().forEach(f => {
      const suc = normalizarSucursal_(f[0]);
      if(suc && suc !== SUCURSAL_TODAS_) encontradas[suc] = true;
    });
  }

  const existenciasSucursal = obtenerHojaExistenciasSucursal_();
  if(existenciasSucursal.getLastRow() > 1){
    existenciasSucursal.getRange(2, 2, existenciasSucursal.getLastRow() - 1, 1).getValues().forEach(f => {
      const suc = normalizarSucursal_(f[0]);
      if(suc && suc !== SUCURSAL_TODAS_) encontradas[suc] = true;
    });
  }

  return Object.keys(encontradas).sort();
}

// Mismo patrón que obtenerNombreDesdeToken/obtenerRolDesdeToken de
// Sesiones.gs — no se modifica ese archivo, solo se reutiliza.
function obtenerCorreoDesdeToken_(token){
  const sesion = obtenerSesion_(token);
  return sesion ? sesion.correo : "";
}

/**
 * Estado actual (columna E de USUARIOS) del usuario dueño del correo.
 * Mismo patrón que obtenerAreaUsuarioPorCorreo_, para el mismo problema:
 * el rol de la sesión se guarda una sola vez al hacer login y no se
 * vuelve a leer hasta que el token expira (hasta 8h) — si un admin
 * desactiva a alguien mientras esa persona ya tiene sesión abierta, con
 * solo obtenerSesion_() esa sesión seguiría pasando cualquier guard.
 */
function obtenerEstadoUsuarioPorCorreo_(correo){
  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(!hoja) return "";
  const datos = hoja.getDataRange().getValues();
  const buscado = String(correo||"").toLowerCase().trim();
  for(let i=1;i<datos.length;i++){
    if(String(datos[i][0]||"").toLowerCase().trim() === buscado){
      return String(datos[i][4]||"").trim(); // columna E = Estado
    }
  }
  return "";
}

/**
 * Reemplaza el simple "obtenerSesion_(token) ? sigue : rechaza" que
 * usaban los 3 guards de abajo. Además de que el token exista y no haya
 * expirado, revalida en USUARIOS que el usuario siga ACTIVO — así una
 * cuenta desactivada después del login pierde acceso de inmediato, en
 * vez de conservarlo hasta que su token expire.
 */
function requerirSesionActivaApp_(token){
  const sesion = obtenerSesion_(token);
  if(!sesion){
    throw new Error("Tu sesión expiró o no es válida. Vuelve a iniciar sesión.");
  }
  const estado = obtenerEstadoUsuarioPorCorreo_(sesion.correo);
  if(estado && estado.toUpperCase() !== "ACTIVO"){
    throw new Error("Tu cuenta ya no está activa. Contacta a un administrador.");
  }
  return sesion;
}

/**
 * Acceso del usuario actual a Requisiciones: su área, y si puede ver
 * TODAS las áreas (Admin, o Área = "Almacén").
 */
function obtenerAccesoRequisicionesApp(token){
  requerirSesionActivaApp_(token);
  const correo = obtenerCorreoDesdeToken_(token);
  const rol = obtenerRolDesdeToken(token);
  const area = obtenerAreaUsuarioPorCorreo_(correo);
  const areaNorm = String(area||"").trim().toUpperCase();
  const esAdmin = String(rol||"").toUpperCase() === "ADMIN" || areaNorm === "ALMACÉN" || areaNorm === "ALMACEN";
  return { area: area, esAdmin: esAdmin };
}

/**
 * Verificación de servidor para operaciones sensibles de Compras e
 * Inventario mensual (generar/cancelar OC, recibir mercancía, cerrar
 * un inventario mensual). Antes estas funciones solo usaban el token
 * para poner el nombre en la bitácora — nunca revisaban si la sesión
 * seguía siendo válida ni si el usuario tenía permiso. Ahora, si la
 * sesión no es válida o el usuario no es Admin / del área Almacén, la
 * función que llama a esto se detiene con un error ANTES de escribir
 * nada — mismo criterio que ya usa Requisiciones
 * (obtenerAccesoRequisicionesApp), no se inventa un permiso nuevo.
 */
function requerirAccesoAlmacenApp_(token){
  requerirSesionActivaApp_(token);
  const rol = String(obtenerRolDesdeToken(token)||"").toUpperCase();
  if(rol === "SUPERVISOR") return;
  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("No tienes permiso para realizar esta acción.");
  }
}

/**
 * Bloquea únicamente al rol CONSULTA. Se usa en funciones administrativas
 * (migraciones/ajustes de Configuración) que antes no validaban nada —
 * cualquier rol no listado explícitamente conserva su acceso actual.
 */
function requerirNoConsultaApp_(token){
  requerirSesionActivaApp_(token);
  const rol = String(obtenerRolDesdeToken(token)||"").toUpperCase();
  if(rol === "CONSULTA"){
    throw new Error("No tienes permiso para realizar esta acción.");
  }
}

/**
 * Bloquea a SUPERVISOR y CONSULTA de las funciones de Operaciones
 * (Entradas, Salidas, Importar Salidas). El resto de roles conserva su
 * acceso actual.
 */
function requerirAccesoOperacionesApp_(token){
  requerirSesionActivaApp_(token);
  const rol = String(obtenerRolDesdeToken(token)||"").toUpperCase();
  if(rol === "SUPERVISOR" || rol === "CONSULTA"){
    throw new Error("No tienes permiso para realizar esta acción.");
  }
}

/**
 * Rol (columna D de USUARIOS) de un correo. Mismo patrón que
 * obtenerAreaUsuarioPorCorreo_/obtenerEstadoUsuarioPorCorreo_.
 */
function obtenerRolUsuarioPorCorreo_(correo){
  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(!hoja) return "";
  const datos = hoja.getDataRange().getValues();
  const buscado = String(correo||"").toLowerCase().trim();
  for(let i=1;i<datos.length;i++){
    if(String(datos[i][0]||"").toLowerCase().trim() === buscado){
      return String(datos[i][3]||"").trim(); // columna D = Rol
    }
  }
  return "";
}

/**
 * Variantes de requerirAccesoAlmacenApp_/requerirNoConsultaApp_ para
 * funciones que en Código.gs siguen siendo compartidas por dos
 * llamadores muy distintos: la SPA (que manda `token` de sesión) y los
 * diálogos legados de Sheets — CapturaConteo.html, AprobacionDiscrepancias.html,
 * SeleccionarCierreConteo.html, abiertos desde el menú "📦 Inventario" de
 * la hoja — que no conocen ese token y siempre han identificado al
 * usuario con Session.getActiveUser() (obtenerUsuario(), la misma cuenta
 * de Google que ya usan para el Kardex/Auditoría de esas pantallas).
 *
 * Si llega `token`, se valida exactamente igual que en el resto de la
 * app. Si no llega token, se intenta la MISMA validación de rol pero
 * usando esa cuenta de Google activa en vez del token; si no se puede
 * determinar quién es (o esa cuenta no tiene fila en USUARIOS), NO se
 * bloquea — la persona ya tiene acceso de edición directo a la hoja de
 * cálculo para abrir ese diálogo en primer lugar, un permiso mayor al
 * que cualquiera de estas funciones podría dar, así que negarle el paso
 * aquí no añade seguridad real y sí rompería el diálogo legado.
 */
function requerirAccesoAlmacenLegadoApp_(token){
  if(token){
    requerirAccesoAlmacenApp_(token);
    return;
  }
  const correo = obtenerUsuario();
  if(!correo) return;
  const rol = String(obtenerRolUsuarioPorCorreo_(correo)||"").toUpperCase();
  if(!rol) return;
  if(rol === "SUPERVISOR" || rol === "ADMIN") return;
  const areaNorm = String(obtenerAreaUsuarioPorCorreo_(correo)||"").trim().toUpperCase();
  if(areaNorm === "ALMACÉN" || areaNorm === "ALMACEN") return;
  throw new Error("No tienes permiso para realizar esta acción.");
}

function requerirNoConsultaLegadoApp_(token){
  if(token){
    requerirNoConsultaApp_(token);
    return;
  }
  const correo = obtenerUsuario();
  if(!correo) return;
  const rol = String(obtenerRolUsuarioPorCorreo_(correo)||"").toUpperCase();
  if(rol === "CONSULTA"){
    throw new Error("No tienes permiso para realizar esta acción.");
  }
}

/**
 * ARQ-01 (auditoría comparativa vs. MarketMan, Fase 4): folio consecutivo
 * genérico por CONTEO DE FILAS — mismo cálculo que antes tenían
 * duplicado, palabra por palabra, generarFolioRequisicion_ (Área) y
 * generarFolioRequisicionSucursal_ (RequisicionesSucursal.gs). Solo sirve
 * para hojas donde cada folio ocupa EXACTAMENTE una fila de encabezado —
 * por eso no se usa para folios con detalle en hoja aparte que necesitan
 * otro criterio (Recetas escanea el máximo ya emitido porque comparte
 * hoja con Área; OC/Lotes de Producción numeran por fecha, no por total).
 */
function generarFolioConsecutivoPorFilas_(hoja, prefijo){
  const total = hoja.getLastRow() > 1 ? hoja.getLastRow() - 1 : 0;
  return prefijo + "-" + Utilities.formatString("%04d", total + 1);
}

function generarFolioRequisicion_(){
  return generarFolioConsecutivoPorFilas_(obtenerHojaRequisiciones_(), "RI");
}

/**
 * Catálogo para armar una requisición: solo productos con ubicación,
 * con su existencia actual (para que el usuario vea disponible).
 */
function buscarProductoParaRequisicionApp(texto, token){

  requerirSesionActivaApp_(token);

  const busqueda = normalizarTexto_(texto);
  if(!busqueda) return [];

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1); // A..K (y más)

  const resultados = [];

  for(let i=0;i<datos.length;i++){
    const f = datos[i];
    const ubicacion = String(f[9]||"").trim();
    if(ubicacionVacia_(ubicacion)) continue;

    const coincide = normalizarTexto_(f[0]).indexOf(busqueda) !== -1 || normalizarTexto_(f[4]).indexOf(busqueda) !== -1;
    if(!coincide) continue;

    // INV-06: se expone "disponible" (existencia menos lo ya reservado
    // por otras requisiciones de Área/Sucursal pendientes) además de la
    // existencia física — así quien está armando la requisición ve de
    // una vez cuánto puede pedir sin que se le rechace al enviar.
    const existencia = Number(f[10]) || 0;
    const reservado = obtenerReservaSucursal_(f[4], SUCURSAL_DEFAULT_);
    resultados.push({
      codigo: f[4], producto: f[0], udm: f[1],
      existencia: existencia, reservado: reservado,
      disponible: Math.round((existencia - reservado) * 1000) / 1000
    });

    if(resultados.length >= 15) break;
  }

  return resultados;

}

/**
 * FASE 1: Nueva requisición. items = [{codigo, producto, unidad, solicitado}]
 * fechaRequerida (opcional, string "yyyy-MM-dd" desde un <input type="date">):
 * cuándo necesita la sucursal/área que esto esté listo — se guarda tal
 * cual para que Almacén sepa cuándo prepararla. Parámetro nuevo AL FINAL
 * y opcional a propósito: las llamadas existentes (front-end viejo,
 * pruebas) que solo mandan 3 argumentos siguen funcionando igual, sin
 * fecha requerida.
 */
function crearRequisicionApp(observaciones, items, token, fechaRequerida){

  requerirSesionActivaApp_(token);

  const correo = obtenerCorreoDesdeToken_(token);
  const usuario = obtenerNombreDesdeToken(token);
  const area = obtenerAreaUsuarioPorCorreo_(correo);

  if(!area){
    throw new Error("Tu usuario no tiene un Área asignada en USUARIOS — pide al administrador que la capture.");
  }

  const validos = (items||[]).filter(it => Number(it.solicitado) > 0);
  if(!validos.length){
    throw new Error("Captura al menos una cantidad solicitada.");
  }

  // INV-06: se reserva ANTES de crear el folio — si algún producto no
  // tiene suficiente disponible (existencia menos lo ya reservado por
  // otras requisiciones de Área/Sucursal pendientes), se rechaza toda la
  // requisición completa y se revierte lo ya reservado en esta misma
  // llamada, en vez de dejar un folio a medio reservar.
  const reservasAplicadas = [];
  try{
    validos.forEach(function(it){
      ajustarReservaRequisicionAreaPorDelta_(it.codigo, Number(it.solicitado), true);
      reservasAplicadas.push({ codigo: it.codigo, cantidad: Number(it.solicitado) });
    });
  }catch(e){
    reservasAplicadas.forEach(function(r){
      ajustarReservaRequisicionAreaPorDelta_(r.codigo, -r.cantidad, false);
    });
    throw e;
  }

  const fecha = new Date();
  const fechaReq = parsearFechaRequerida_(fechaRequerida);
  let folio;

  conBloqueoApp_(function(){
    folio = generarFolioRequisicion_();
    obtenerHojaRequisiciones_().appendRow([
      folio, fecha, area, usuario, "PENDIENTE", observaciones || "", "", "", fechaReq
    ]);
  });

  const filasDetalle = validos.map(it => [
    folio, it.codigo, it.producto, it.unidad || "", Number(it.solicitado), ""
  ]);

  const detalle = obtenerHojaDetalleRequisiciones_();
  detalle.getRange(detalle.getLastRow()+1, 1, filasDetalle.length, 6).setValues(filasDetalle);

  registrarAuditoria(usuario, "REQUISICIONES", "NUEVA REQUISICIÓN", folio, "", "", 0, 0,
    "Área " + area + " — " + filasDetalle.length + " producto(s)");

  return { folio: folio, productos: filasDetalle.length };

}

/**
 * FASE 2/5: lista de requisiciones — un área solo ve las suyas,
 * Almacén/Admin ven todas.
 */
function obtenerRequisicionesApp(token){

  const acceso = obtenerAccesoRequisicionesApp(token);
  const hoja = obtenerHojaRequisiciones_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,9).getValues();

  return datos
    .filter(f => acceso.esAdmin || String(f[2]).trim() === String(acceso.area).trim())
    .map(f => ({
      folio: f[0],
      fecha: f[1] instanceof Date ? Utilities.formatDate(f[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : f[1],
      area: f[2], solicitante: f[3], estado: f[4], observaciones: f[5],
      fechaEntrega: f[6] instanceof Date ? Utilities.formatDate(f[6], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : "",
      entrego: f[7],
      fechaRequerida: f[8] instanceof Date ? Utilities.formatDate(f[8], Session.getScriptTimeZone(), "dd/MM/yyyy") : ""
    }))
    .sort((a,b) => a.folio < b.folio ? 1 : -1);

}

function obtenerRequisicionesPendientesApp(token){
  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("Solo Almacén puede ver las requisiciones pendientes de todas las áreas.");
  }
  return obtenerRequisicionesApp(token).filter(r => r.estado === "PENDIENTE");
}

function obtenerEntregasRecientesApp(token){
  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("Solo Almacén puede ver el registro de entregas.");
  }
  return obtenerRequisicionesApp(token).filter(r => r.estado === "ENTREGADA").slice(0, 50);
}

/**
 * FASE 3: Preparación — compara lo solicitado contra la existencia
 * actual de MATRIZ.
 */
function obtenerDetalleRequisicionApp(folio, token){

  const req = obtenerHojaRequisiciones_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();
  let encabezado = null;
  datosReq.forEach(f => { if(String(f[0]) === String(folio)) encabezado = f; });

  if(!encabezado) throw new Error("No se encontró la requisición " + folio);

  // Mismo criterio que obtenerRequisicionesApp: un área solo ve las
  // suyas, salvo Admin/Almacén. Antes esta función no comprobaba nada,
  // así que cualquier folio (consecutivos y predecibles) era legible
  // desde cualquier área con solo cambiar el número.
  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin && String(encabezado[2]).trim() !== String(acceso.area).trim()){
    throw new Error("No se encontró la requisición " + folio);
  }

  const detalle = obtenerHojaDetalleRequisiciones_();
  const datosDetalle = detalle.getLastRow() > 1 ? detalle.getRange(2,1,detalle.getLastRow()-1,6).getValues() : [];

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datosMatriz = matriz.getRange(2, 1, matriz.getLastRow()-1, 11).getValues();
  const existenciaPorCodigo = {};
  datosMatriz.forEach(f => { if(f[4]) existenciaPorCodigo[String(f[4]).trim()] = Number(f[10]) || 0; });

  const items = datosDetalle
    .filter(f => String(f[0]) === String(folio))
    .map(f => {
      const codigo = String(f[1]).trim();
      const existencia = existenciaPorCodigo[codigo] || 0;
      const solicitado = Number(f[4]) || 0;
      return {
        codigo: f[1], producto: f[2], unidad: f[3], solicitado: solicitado,
        existencia: existencia,
        entregarSugerido: Math.min(solicitado, existencia),
        entregado: f[5]
      };
    });

  return {
    folio: encabezado[0],
    fecha: encabezado[1] instanceof Date ? Utilities.formatDate(encabezado[1], Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm") : encabezado[1],
    area: encabezado[2], solicitante: encabezado[3], estado: encabezado[4], observaciones: encabezado[5],
    fechaRequerida: encabezado[8] instanceof Date ? Utilities.formatDate(encabezado[8], Session.getScriptTimeZone(), "dd/MM/yyyy") : "",
    items: items
  };

}

/**
 * Cancela una requisición interna (Área o Receta — comparten la misma
 * hoja REQUISICIONES) que se creó por error. Nunca se borra la fila,
 * solo cambia de estado, igual que ya hace cancelarOrdenCompraApp con
 * las órdenes de compra. Solo se puede cancelar mientras sigue
 * PENDIENTE: una vez ENTREGADA ya movió existencia real (salida +
 * Kardex), cancelarla después dejaría el inventario desincronizado sin
 * revertir esa salida — fuera de alcance de este cambio.
 */
function cancelarRequisicionApp(folio, motivo, token){

  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("Solo Almacén puede cancelar requisiciones.");
  }

  const usuario = obtenerNombreDesdeToken(token);
  const req = obtenerHojaRequisiciones_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,9).getValues();

  let filaReq = -1, estadoActual = "", observacionesActuales = "";

  datosReq.forEach((f,i) => {
    if(String(f[0]) === String(folio)){
      filaReq = i+2;
      estadoActual = String(f[4]||"").toUpperCase();
      observacionesActuales = String(f[5]||"");
    }
  });

  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  if(estadoActual === "ENTREGADA"){
    throw new Error("Esta requisición ya fue entregada, no se puede cancelar.");
  }
  if(estadoActual === "CANCELADA"){
    throw new Error("Esta requisición ya está cancelada.");
  }

  // INV-06: al cancelar una requisición de Área que seguía PENDIENTE, se
  // libera exactamente lo que se reservó al crearla. Nunca aplica a
  // folios de Receta (su "código" es de receta, no de MATRIZ — nunca
  // pasaron por ajustarReservaRequisicionAreaPorDelta_ al crearse).
  if(obtenerTipoRequisicion_(folio) !== "RECETA"){
    const detalleCancelacion = obtenerHojaDetalleRequisiciones_();
    if(detalleCancelacion.getLastRow() > 1){
      const datosDetalleCancelacion = detalleCancelacion.getRange(2, 1, detalleCancelacion.getLastRow()-1, 6).getValues();
      datosDetalleCancelacion.forEach(function(f){
        if(String(f[0]) !== String(folio)) return;
        const solicitado = Number(f[4]) || 0;
        if(solicitado > 0){
          ajustarReservaRequisicionAreaPorDelta_(String(f[1]).trim(), -solicitado, false);
        }
      });
    }
  }

  const nota = "[CANCELADA por " + usuario + (motivo ? " — " + motivo : "") + "]";
  const observacionesNuevas = (observacionesActuales ? observacionesActuales + " " : "") + nota;

  req.getRange(filaReq, 5).setValue("CANCELADA");
  req.getRange(filaReq, 6).setValue(observacionesNuevas);

  registrarAuditoria(usuario, "REQUISICIONES", "REQUISICIÓN CANCELADA", folio, "", "", 0, 0,
    "Estaba " + estadoActual + (motivo ? " — Motivo: " + motivo : ""));

  return { ok: true };

}

/**
 * FASE 4: Confirmar entrega — descuenta existencia con la misma
 * función central que usan Entradas/Salidas/Conteos/Inventario Mensual,
 * registra Kardex, guarda quién surtió y cuándo, cierra la requisición.
 *
 * entregas = [{codigo, cantidadEntregada}]. Normalmente cada código ya
 * es uno de los solicitados originales (fila existente en
 * DETALLE_REQUISICIONES) — pero también se acepta un código que NO
 * estaba en la solicitud original: pasa que a veces Almacén ya le dio
 * a la sucursal/área un insumo adicional durante el día (algo que no
 * pidieron pero sí se les entregó) y quiere que quede registrado en
 * esta misma requisición en vez de perderse. Ese código se resuelve
 * SIEMPRE contra MATRIZ en el servidor (nunca se confía en un nombre o
 * unidad mandado por el cliente) y se agrega como una fila nueva de
 * detalle con Solicitado=0, para que quede visible que fue un extra,
 * no algo que la sucursal/área pidió.
 */
function confirmarEntregaRequisicionApp(folio, entregas, token){

  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("Solo Almacén puede confirmar entregas.");
  }

  const usuario = obtenerNombreDesdeToken(token);

  const req = obtenerHojaRequisiciones_();
  const datosReq = req.getRange(2,1,req.getLastRow()-1,8).getValues();
  let filaReq = -1, areaReq = "";
  datosReq.forEach((f,i) => { if(String(f[0]) === String(folio)){ filaReq = i+2; areaReq = f[2]; } });

  if(filaReq === -1) throw new Error("No se encontró la requisición " + folio);

  const detalle = obtenerHojaDetalleRequisiciones_();
  const datosDetalle = detalle.getRange(2,1,detalle.getLastRow()-1,6).getValues();

  // Para poder pasarle la ubicación a registrarSalidaInterna_ (columna K de
  // SALIDA), y para resolver producto/UDM de un código extra (ver abajo)
  // siempre contra MATRIZ, nunca contra lo que mande el cliente.
  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datosMatriz = matriz.getRange(2, 1, matriz.getLastRow()-1, 11).getValues();
  const ubicacionPorCodigo = {};
  const productoPorCodigo = {};
  const udmPorCodigo = {};
  datosMatriz.forEach(f => {
    const codigo = String(f[4]||"").trim();
    if(!codigo) return;
    ubicacionPorCodigo[codigo] = f[9] || "";
    productoPorCodigo[codigo] = f[0];
    udmPorCodigo[codigo] = f[1];
  });

  // PROD-04: lote es opcional — si Almacén sabe de qué lote de producción
  // está entregando (mismo campo/UX ya usado en la pantalla de Salidas
  // manual), se etiqueta en SALIDA para poder rastrearlo después con
  // obtenerTrazabilidadLoteApp. Sin lote, el comportamiento es idéntico a
  // como funcionaba antes de esto existir.
  const mapaEntregas = {};
  (entregas||[]).forEach(e => {
    mapaEntregas[String(e.codigo).trim()] = { cantidad: Number(e.cantidadEntregada) || 0, lote: String(e.lote||"").trim() };
  });

  let productosEntregados = 0;
  const codigosOriginales = {};
  // Antes: un .setValue() por cada línea entregada dentro de este mismo
  // forEach (hasta una llamada a Sheets por producto de la requisición).
  // Ahora: se muta en memoria el mismo arreglo datosDetalle que ya se leyó
  // arriba, y se escribe UNA sola vez al final (ver más abajo) — mismas
  // filas, mismos valores, una sola llamada a la API en vez de N.
  let huboCambiosDetalle = false;

  datosDetalle.forEach((f, i) => {

    if(String(f[0]) !== String(folio)) return;

    const codigo = String(f[1]).trim();
    codigosOriginales[codigo] = true;

    const producto = f[2];
    const unidad = f[3];
    const cantidadEntregar = mapaEntregas[codigo] ? mapaEntregas[codigo].cantidad : 0;

    if(cantidadEntregar <= 0) return;

    // Misma función que usa la pantalla de Salidas manual — así queda
    // igual registrado en SALIDA (con el Área en columna H), KARDEX y
    // la existencia se actualiza con la función central.
    registrarSalidaInterna_({
      codigo: codigo,
      producto: producto,
      cantidad: cantidadEntregar,
      udm: unidad,
      area: areaReq,
      ubicacion: ubicacionPorCodigo[codigo] || "",
      lote: mapaEntregas[codigo] ? mapaEntregas[codigo].lote : "",
      folio: folio,
      observacion: "Requisición interna " + folio + " — Área " + areaReq
    }, usuario);

    datosDetalle[i][5] = cantidadEntregar;
    huboCambiosDetalle = true;
    productosEntregados++;

  });

  if(huboCambiosDetalle){
    detalle.getRange(2, 1, datosDetalle.length, 6).setValues(datosDetalle);
  }

  // Códigos que Almacén agregó al momento de entregar — no estaban en la
  // solicitud original (ver doc de la función). Se resuelven contra
  // MATRIZ y se agregan como fila nueva de detalle, con Solicitado=0.
  const filasExtra = [];

  Object.keys(mapaEntregas).forEach(codigo => {

    if(codigosOriginales[codigo]) return; // ya se procesó en el loop de arriba

    const cantidadEntregar = mapaEntregas[codigo].cantidad;
    if(cantidadEntregar <= 0) return;

    const producto = productoPorCodigo[codigo];
    if(!producto){
      throw new Error("El código " + codigo + " no existe en MATRIZ — no se puede agregar como extra.");
    }

    const unidad = udmPorCodigo[codigo] || "";

    registrarSalidaInterna_({
      codigo: codigo,
      producto: producto,
      cantidad: cantidadEntregar,
      udm: unidad,
      area: areaReq,
      ubicacion: ubicacionPorCodigo[codigo] || "",
      lote: mapaEntregas[codigo].lote,
      folio: folio,
      observacion: "Requisición interna " + folio + " — Área " + areaReq + " (extra agregado al entregar)"
    }, usuario);

    filasExtra.push([folio, codigo, producto, unidad, 0, cantidadEntregar]);
    productosEntregados++;

  });

  if(filasExtra.length){
    detalle.getRange(detalle.getLastRow()+1, 1, filasExtra.length, 6).setValues(filasExtra);
  }

  if(productosEntregados === 0){
    throw new Error("Captura al menos una cantidad a entregar.");
  }

  // INV-06: al cerrar la requisición (entregada, aunque sea parcial) se
  // libera TODA la reserva hecha al crearla — el modelo de Área no tiene
  // un estado "parcialmente pendiente"; una vez confirmada la entrega el
  // compromiso original ya terminó. Nunca aplica a folios de Receta (su
  // "código" es de receta, no de MATRIZ) ni a los códigos extra agregados
  // aquí mismo (esos nunca se reservaron, ver comentario de la función).
  if(obtenerTipoRequisicion_(folio) !== "RECETA"){
    datosDetalle.forEach(function(f){
      if(String(f[0]) !== String(folio)) return;
      const solicitado = Number(f[4]) || 0;
      if(solicitado > 0){
        ajustarReservaRequisicionAreaPorDelta_(String(f[1]).trim(), -solicitado, false);
      }
    });
  }

  const fechaEntrega = new Date();
  req.getRange(filaReq, 5).setValue("ENTREGADA");
  req.getRange(filaReq, 7).setValue(fechaEntrega);
  req.getRange(filaReq, 8).setValue(usuario);

  registrarAuditoria(usuario, "REQUISICIONES", "ENTREGA CONFIRMADA", folio, "", "", 0, 0,
    productosEntregados + " producto(s) entregados a " + areaReq);

  const pdf = generarYGuardarPDFRequisicion_(folio, token);

  return { productosEntregados: productosEntregados, pdf: pdf };

}

// ---------------- PDF de la requisición ----------------

const CARPETA_REQUISICIONES_ = "Requisiciones Internas";

function obtenerCarpetaRequisiciones_(){
  const carpetas = DriveApp.getFoldersByName(CARPETA_REQUISICIONES_);
  if(carpetas.hasNext()) return carpetas.next();
  return DriveApp.createFolder(CARPETA_REQUISICIONES_);
}

function construirHtmlRequisicion_(folio, token){

  const datos = obtenerDetalleRequisicionApp(folio, token);

  const filasHtml = datos.items.map((it,i) => `
    <tr style="background:${i%2===0?'#ffffff':'#F9F5EF'}">
      <td>${it.codigo}</td>
      <td>${it.producto}</td>
      <td style="text-align:center">${it.unidad||""}</td>
      <td style="text-align:right">${formatearCantidad_(it.solicitado)}</td>
      <td style="text-align:right">${it.entregado === "" ? "—" : formatearCantidad_(it.entregado)}</td>
    </tr>
  `).join("");

  const generado = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

  return construirHtmlDocumentoTagers_({
    titulo: "REQUISICIÓN INTERNA",
    folio: datos.folio,
    colorEstado: datos.estado === "ENTREGADA" ? "#5C6B2A" : "#C4522A",
    estado: datos.estado,
    infoGrid: [
      { etiqueta: "Área", valor: datos.area },
      { etiqueta: "Solicitante", valor: datos.solicitante },
      { etiqueta: "Fecha", valor: datos.fecha },
      { etiqueta: "Total de productos", valor: datos.items.length }
    ],
    tablaEncabezados: `<th>Código</th><th>Producto</th><th style="text-align:center">Unidad</th><th style="text-align:right">Solicitado</th><th style="text-align:right">Entregado</th>`,
    tablaFilas: filasHtml,
    observaciones: datos.observaciones,
    firmas: ["Solicitó", "Surtió"],
    generado: generado
  });

}

function generarYGuardarPDFRequisicion_(folio, token){

  const html = construirHtmlRequisicion_(folio, token);
  const pdfBlob = HtmlService.createHtmlOutput(html).getAs("application/pdf").setName(folio + ".pdf");

  const carpeta = obtenerCarpetaRequisiciones_();
  const existentes = carpeta.getFilesByName(folio + ".pdf");
  while(existentes.hasNext()){ existentes.next().setTrashed(true); }

  const archivo = carpeta.createFile(pdfBlob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    id: archivo.getId(),
    verUrl: "https://drive.google.com/file/d/" + archivo.getId() + "/view",
    descargarUrl: "https://drive.google.com/uc?export=download&id=" + archivo.getId()
  };

}

function obtenerPDFRequisicionApp(folio, token){
  requerirSesionActivaApp_(token);
  return generarYGuardarPDFRequisicion_(folio, token);
}


/**
 * Productos que un Área pide más seguido, según su propio historial en
 * SALIDA (columna H = Área). Se usa como sugerencia rápida al abrir una
 * Nueva Requisición — no es una lista fija, sale de lo que de verdad ha
 * consumido esa área antes.
 */
function obtenerProductosSugeridosAreaApp(area, token){

  requerirSesionActivaApp_(token);

  if(!area) return [];

  const salida = SpreadsheetApp.getActive().getSheetByName("SALIDA");
  if(!salida || salida.getLastRow() < 2) return [];

  const datos = salida.getRange(2, 1, salida.getLastRow()-1, 11).getValues(); // A..K
  const areaBuscada = String(area).trim().toUpperCase();

  const acumulado = {}; // codigo -> {producto, udm, veces, sumaCantidad}

  datos.forEach(f => {
    if(String(f[7]||"").trim().toUpperCase() !== areaBuscada) return; // H = Área

    const codigo = String(f[3]||"").trim();
    if(!codigo) return;

    if(!acumulado[codigo]){
      acumulado[codigo] = { codigo: codigo, producto: f[4], udm: f[6], veces: 0, sumaCantidad: 0 };
    }

    acumulado[codigo].veces++;
    acumulado[codigo].sumaCantidad += Number(f[5]) || 0;

  });

  // Existencia actual, para que se vea disponible al sugerir.
  const datosMatriz = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);
  const existenciaPorCodigo = {};
  datosMatriz.forEach(f => { if(f[4]) existenciaPorCodigo[String(f[4]).trim()] = Number(f[10]) || 0; });

  return Object.values(acumulado)
    .sort((a,b) => b.veces - a.veces)
    .slice(0, 10)
    .map(p => ({
      codigo: p.codigo, producto: p.producto, udm: p.udm,
      existencia: existenciaPorCodigo[p.codigo] || 0,
      // Promedio de lo que suele pedir, redondeado — como sugerencia de cantidad.
      cantidadSugerida: Math.max(Math.round(p.sumaCantidad / p.veces), 1)
    }));

}