// ============================================
// FEFO.GS — TAGERS WMS 2.0, Fase 3 (Caducidades/FEFO de mercancía comprada)
// ============================================
//
// Capa 100% de LECTURA — nunca escribe en ninguna hoja. Archivo separado
// de Inteligencia.gs a propósito (ver pedido del usuario): esta lógica es
// suficientemente distinta (estimación FEFO por asignación, no un simple
// filtro/conteo) como para no seguir amontonando todo en un solo archivo.
//
// CONTEXTO — por qué esto es una ESTIMACIÓN y no un dato exacto:
// ENTRADA sí captura Lote (columna H) y Caducidad (columna I) cuando quien
// registra la entrada los llena (son opcionales — ver formulario). Pero el
// sistema NO lleva un inventario por lote: la Existencia real vive solo a
// nivel producto en MATRIZ, y SALIDA tiene su propio campo de Lote (columna
// I) pero es texto libre y opcional — nada obliga a que una salida
// referencie el lote correcto, ni el sistema decide de cuál lote descontar.
// Esto es exactamente lo contrario de PRODUCCION, que sí tiene una columna
// CantidadDisponible por lote que se decrementa de verdad (ver
// obtenerLotesProximosACaducarApp en Inteligencia.gs, Fase 1) — por eso esa
// función se queda intacta y esta es una capa nueva y separada.
//
// Sin una ficha de consumo por lote, la única forma honesta de estimar
// "qué caduca pronto" es asumir que el almacén consume en orden FEFO
// (primero lo que caduca primero) y repartir la Existencia ACTUAL del
// producto contra sus entradas ordenadas por caducidad ascendente, hasta
// agotar esa existencia. Si el almacén en la práctica no sigue FEFO
// estrictamente, el resultado es una aproximación razonable, NUNCA un dato
// exacto — por eso cada resultado se expone como "estimado" y así debe
// presentarse en el frontend (nunca como fecha de caducidad garantizada).

/**
 * Reparte la existencia actual de cada código contra sus entradas con
 * caducidad conocida, de la más próxima a la más lejana (FEFO), hasta
 * agotar esa existencia. La existencia que sobra después de recorrer
 * todas las entradas con caducidad (por ejemplo, entradas antiguas de
 * antes de capturar este dato, o recepciones sin lote) NO se le asigna a
 * ningún lote — se queda sin caducidad conocida, nunca se inventa una.
 *
 * @param {Object} entradasPorCodigo - { CODIGO: [{ lote, caducidad(Date), cantidad, producto }] }
 * @param {Object} existenciaPorCodigo - { CODIGO: existenciaActual }
 * @return {Object} { CODIGO: [{ lote, caducidad, producto, cantidadEstimada }] } — solo lotes con asignación > 0
 */
function calcularAsignacionFefoPorCodigo_(entradasPorCodigo, existenciaPorCodigo){

  const resultado = {};

  Object.keys(entradasPorCodigo).forEach(codigo => {

    let restante = Number(existenciaPorCodigo[codigo]) || 0;
    if(restante <= 0) return;

    const lotes = entradasPorCodigo[codigo].slice().sort((a, b) => a.caducidad - b.caducidad);
    const asignados = [];

    for(let i = 0; i < lotes.length && restante > 0; i++){
      const lote = lotes[i];
      const asignado = Math.min(restante, lote.cantidad);
      if(asignado > 0){
        asignados.push({
          lote: lote.lote,
          caducidad: lote.caducidad,
          producto: lote.producto,
          cantidadEstimada: asignado
        });
        restante -= asignado;
      }
    }

    if(asignados.length) resultado[codigo] = asignados;

  });

  return resultado;

}

/**
 * Lotes de mercancía COMPRADA (vía ENTRADA, incluyendo recepción de OC —
 * ambas escriben con registrarEntradaInterna_) cuya porción estimada de la
 * existencia actual caduca dentro de `diasUmbral` días (por defecto 7,
 * igual que el umbral de PRODUCCION). Incluye lotes ya vencidos (días
 * negativos), mismo criterio que ya usa obtenerLotesProximosACaducarApp.
 *
 * método: "estimado-fefo" siempre viaja en cada fila — el frontend debe
 * mostrarlo como estimación, nunca como dato exacto (ver cabecera del
 * archivo).
 */
function obtenerLotesEntradaProximosACaducarApp(token, diasUmbral){

  requerirSesionActivaApp_(token);
  const umbral = Number(diasUmbral) || 7;

  const datosEntrada = obtenerFilasHojaCacheadas_("ENTRADA");
  datosEntrada.shift();

  const entradasPorCodigo = {};

  datosEntrada.forEach(f => {
    const codigo = String(f[3] || "").trim();
    const cantidad = Number(f[5]) || 0;
    if(!codigo || cantidad <= 0) return;

    // new Date(f[8]) en vez de "instanceof Date": obtenerFilasHojaCacheadas_
    // pasa los datos por JSON.stringify/parse cuando vienen de caché tibia,
    // y ahí una fecha real se vuelve texto ISO — new Date(...) reconstruye
    // el Date igual desde un Date real o desde ese texto (ver INT-004 en
    // pruebas-qa/inteligencia para el mismo patrón).
    const caducidad = new Date(f[8]);
    if(isNaN(caducidad.getTime())) return;

    if(!entradasPorCodigo[codigo]) entradasPorCodigo[codigo] = [];
    entradasPorCodigo[codigo].push({
      lote: String(f[7] || "").trim(),
      caducidad: caducidad,
      cantidad: cantidad,
      producto: f[4]
    });
  });

  if(!Object.keys(entradasPorCodigo).length) return [];

  const datosMatriz = obtenerFilasHojaCacheadas_("MATRIZ");
  datosMatriz.shift();

  const existenciaPorCodigo = {};
  datosMatriz.forEach(f => {
    existenciaPorCodigo[String(f[4] || "").trim()] = Number(f[10]) || 0;
  });

  const asignacion = calcularAsignacionFefoPorCodigo_(entradasPorCodigo, existenciaPorCodigo);

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const resultado = [];

  Object.keys(asignacion).forEach(codigo => {
    asignacion[codigo].forEach(a => {
      const cad = new Date(a.caducidad);
      cad.setHours(0, 0, 0, 0);
      const dias = Math.round((cad - hoy) / 86400000);
      if(dias > umbral) return;

      resultado.push({
        codigo: codigo,
        producto: a.producto,
        lote: a.lote || "Sin folio de lote",
        caducidad: Utilities.formatDate(cad, Session.getScriptTimeZone(), "dd/MM/yyyy"),
        diasRestantes: dias,
        cantidadEstimada: Math.round(a.cantidadEstimada * 100) / 100,
        metodo: "estimado-fefo"
      });
    });
  });

  resultado.sort((a, b) => a.diasRestantes - b.diasRestantes);

  return resultado;

}
