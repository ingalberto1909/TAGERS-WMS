/**
 * TAGERS WMS — Histórico de Consumo (pedido del usuario).
 *
 * Módulo de SOLO LECTURA/ANÁLISIS: no escribe absolutamente nada en
 * MATRIZ, SALIDA, ENTRADA, KARDEX ni ninguna otra hoja. No crea
 * movimientos, no ajusta existencia, no toca ningún dato.
 *
 * FUENTE DE VERDAD: SALIDA (ver registrarSalidaInterna_ en
 * 📁 App.gs.gs) — se confirmó leyendo los 5 flujos que escriben ahí
 * (Salida manual, Requisiciones de receta, Devoluciones, Producción,
 * importación) que TODOS pasan por esa única función y que la
 * cantidad SIEMPRE se captura y descuenta directo en la UDM base del
 * producto — nunca en "piezas de una presentación". Por eso aquí
 * NUNCA se multiplica por Presentación/Convertir (columnas S/T de
 * MATRIZ): esas columnas son exclusivas del lado de compras (cuántas
 * cajas pedir/recibir) y no tienen ningún efecto sobre cuánto se
 * consumió. Multiplicar aquí sería el mismo error de doble conversión
 * que ya se corrigió del lado de costeo (K×R×T), aplicado a cantidades.
 *
 * Consumo real = SALIDA.Cantidad, tal cual. Punto.
 *
 * Reutiliza sin modificar: obtenerFilasHojaCacheadas_ (caché de 20s ya
 * existente), buscarFilaMatrizPorCodigo_, normalizarTexto_,
 * obtenerMesLetra, obtenerCostoUnitarioReal_, requerirSesionActivaApp_.
 * No se toca ninguna de esas funciones ni se duplican con otro nombre.
 */

// Columnas de SALIDA (0-based, confirmadas en registrarSalidaInterna_):
// 0 Año | 1 Mes | 2 Fecha | 3 Código | 4 Producto | 5 Cantidad | 6 UDM | 7 Área | 8 Lote | 9 Caducidad | 10 Ubicación

/** Mismo criterio que normalizarProveedor_ (trim+upper) — evita que "Cocina"/"COCINA " cuenten como grupos distintos. */
function normalizarAreaSalida_(texto){
  return String(texto || "").trim().toUpperCase();
}

/**
 * Traduce un filtro de periodo a un rango de fechas concreto. Acepta
 * un preset (calculado contra la fecha del servidor, nunca la del
 * cliente) o fechas explícitas para "personalizado". Nunca inventa un
 * rango: si las fechas no son válidas o vienen invertidas, lanza un
 * error claro en vez de devolver datos silenciosamente incorrectos.
 */
function resolverRangoFechas_(filtros){

  const hoy = new Date();
  const preset = filtros && filtros.periodoPreset;

  let desde, hasta = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

  if(preset === "ULTIMOS_30"){
    desde = new Date(hoy); desde.setDate(desde.getDate() - 30);
  } else if(preset === "ULTIMOS_3M"){
    desde = new Date(hoy); desde.setMonth(desde.getMonth() - 3);
  } else if(preset === "ULTIMOS_6M"){
    desde = new Date(hoy); desde.setMonth(desde.getMonth() - 6);
  } else if(preset === "ULTIMOS_12M"){
    desde = new Date(hoy); desde.setMonth(desde.getMonth() - 12);
  } else if(preset === "ANIO_ACTUAL"){
    desde = new Date(hoy.getFullYear(), 0, 1);
    hasta = new Date(hoy.getFullYear(), 11, 31, 23, 59, 59);
  } else if(preset === "ANIO_ANTERIOR"){
    desde = new Date(hoy.getFullYear() - 1, 0, 1);
    hasta = new Date(hoy.getFullYear() - 1, 11, 31, 23, 59, 59);
  } else {
    // PERSONALIZADO (o sin preset): requiere fechaDesde/fechaHasta explícitas.
    desde = filtros && filtros.fechaDesde ? new Date(filtros.fechaDesde + "T00:00:00") : null;
    hasta = filtros && filtros.fechaHasta ? new Date(filtros.fechaHasta + "T23:59:59") : hasta;
  }

  if(!desde || isNaN(desde.getTime())) throw new Error("Fecha 'desde' inválida o faltante.");
  if(!hasta || isNaN(hasta.getTime())) throw new Error("Fecha 'hasta' inválida.");
  if(desde.getTime() > hasta.getTime()) throw new Error("La fecha 'desde' no puede ser posterior a 'hasta'.");

  return { desde: desde, hasta: hasta };

}

/**
 * Búsqueda de producto por código o nombre PARA ESTE MÓDULO — a
 * propósito NO reutiliza buscarProductoCatalogoApp porque esa función
 * excluye productos sin ubicación (dados de baja/descontinuados), y
 * aquí sí queremos poder consultar el histórico de un producto
 * descontinuado. Mismo criterio de normalización de texto
 * (normalizarTexto_) que ya usa el resto del proyecto.
 */
function buscarProductoHistoricoConsumoApp(texto, token){

  requerirSesionActivaApp_(token);

  const busqueda = normalizarTexto_(texto);
  if(!busqueda) return [];

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);
  const resultados = [];

  for(let i = 0; i < datos.length; i++){
    const f = datos[i];
    const codigo = String(f[4] || "").trim();
    if(!codigo) continue;

    const coincideNombre = normalizarTexto_(f[0]).indexOf(busqueda) !== -1;
    const coincideCodigo = normalizarTexto_(codigo).indexOf(busqueda) !== -1;
    if(!coincideNombre && !coincideCodigo) continue;

    const ubicacion = String(f[9] || "").trim();

    resultados.push({
      codigo: codigo,
      producto: f[0],
      udm: f[1],
      descontinuado: ubicacionVacia_(ubicacion)
    });

    if(resultados.length >= 15) break;
  }

  return resultados;

}

/** Lista de áreas realmente usadas en SALIDA — nunca hardcodeada (se confirmó que distintos flujos escriben valores libres, no solo Cocina/Panadería/Repostería). */
function obtenerAreasSalidaApp(token){

  requerirSesionActivaApp_(token);

  const datos = obtenerFilasHojaCacheadas_("SALIDA").slice(1);
  const vistas = {};

  datos.forEach(function(f){
    const area = String(f[7] || "").trim();
    if(area) vistas[normalizarAreaSalida_(area)] = area;
  });

  return Object.values(vistas).sort(function(a, b){ return a.localeCompare(b, "es"); });

}

/**
 * Núcleo puro (sin leer hojas) — recibe las filas de SALIDA ya
 * filtradas por código/periodo/área/UDM válida, y arma el resumen
 * completo. Separado de obtenerHistoricoConsumoApp para poder probarlo
 * directo con datos de prueba, sin depender de una hoja real.
 */
function calcularResumenConsumo_(movimientos, rango, consumoPeriodoAnterior){

  let consumoTotal = 0;
  let numeroMovimientos = 0;
  let movimientosConCantidadInvalida = 0;
  const porMes = {};

  (movimientos || []).forEach(function(f){

    const cantidad = Number(f[5]);
    if(!cantidad || isNaN(cantidad) || cantidad <= 0){
      movimientosConCantidadInvalida++;
      return; // vacío/cero/negativo: no es consumo real, no se suma ni se cuenta como movimiento
    }

    numeroMovimientos++;
    consumoTotal += cantidad;

    const fecha = f[2] instanceof Date ? f[2] : new Date(f[2]);
    const clave = fecha.getFullYear() + "-" + String(fecha.getMonth() + 1).padStart(2, "0");
    if(!porMes[clave]){
      porMes[clave] = { anio: fecha.getFullYear(), mes: fecha.getMonth() + 1, etiqueta: obtenerMesLetra(fecha) + " " + fecha.getFullYear(), consumo: 0, movimientos: 0 };
    }
    porMes[clave].consumo += cantidad;
    porMes[clave].movimientos++;

  });

  const consumoMensual = Object.keys(porMes).sort().map(function(clave){
    const m = porMes[clave];
    return { anio: m.anio, mes: m.mes, etiqueta: m.etiqueta, consumo: Math.round(m.consumo * 1000) / 1000, movimientos: m.movimientos };
  });

  let mesMayorConsumo = null, mesMenorConsumo = null;
  consumoMensual.forEach(function(m){
    if(!mesMayorConsumo || m.consumo > mesMayorConsumo.consumo) mesMayorConsumo = m;
    if(!mesMenorConsumo || m.consumo < mesMenorConsumo.consumo) mesMenorConsumo = m;
  });

  const numMeses = consumoMensual.length || 1;
  const diasPeriodo = Math.max(1, Math.round((rango.hasta.getTime() - rango.desde.getTime()) / 86400000));

  const anterior = Number(consumoPeriodoAnterior) || 0;
  // Sin consumo en el periodo anterior no hay base real de comparación —
  // se devuelve null (no se inventa un "infinito%" ni un 0% engañoso).
  const tendenciaPct = anterior > 0 ? Math.round(((consumoTotal - anterior) / anterior) * 1000) / 10 : null;

  return {
    consumoTotal: Math.round(consumoTotal * 1000) / 1000,
    promedioMensual: Math.round((consumoTotal / numMeses) * 1000) / 1000,
    promedioDiario: Math.round((consumoTotal / diasPeriodo) * 1000) / 1000,
    numeroMovimientos: numeroMovimientos,
    movimientosConCantidadInvalida: movimientosConCantidadInvalida,
    mesMayorConsumo: mesMayorConsumo,
    mesMenorConsumo: mesMenorConsumo,
    tendenciaPct: tendenciaPct,
    consumoPeriodoAnterior: Math.round(anterior * 1000) / 1000,
    consumoMensual: consumoMensual
  };

}

/**
 * Función principal del módulo: histórico completo de UN producto
 * (identificado por código, nunca por nombre) en un periodo/área.
 *
 * filtros = { codigo, periodoPreset | (fechaDesde + fechaHasta), area }
 */
function obtenerHistoricoConsumoApp(filtros, token){

  requerirSesionActivaApp_(token);
  filtros = filtros || {};

  const codigo = String(filtros.codigo || "").trim();
  if(!codigo) throw new Error("Captura un código de producto.");

  const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
  if(filaMatriz === -1) throw new Error("No se encontró el producto " + codigo + " en MATRIZ.");

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const datosProducto = matriz.getRange(filaMatriz, 1, 1, 20).getValues()[0];
  const nombreProducto = datosProducto[0];
  const udmProducto = String(datosProducto[1] || "").trim();
  const existenciaActual = Number(datosProducto[10]) || 0;
  const costoUnitario = Number(datosProducto[17]) || 0;
  const convertir = datosProducto[18];
  const presentacion = datosProducto[19];
  const descontinuado = ubicacionVacia_(String(datosProducto[9] || "").trim());

  const rango = resolverRangoFechas_(filtros);
  const areaFiltro = filtros.area ? normalizarAreaSalida_(filtros.area) : "";

  const datosSalida = obtenerFilasHojaCacheadas_("SALIDA").slice(1);
  const movimientosCodigo = datosSalida.filter(function(f){
    return String(f[3] || "").trim() === codigo;
  });

  // Detecta UDM mezcladas en TODO el histórico del código (no solo en el
  // periodo filtrado) — si un producto cambió de UDM alguna vez, no se
  // inventa el factor de conversión: se usan solo los movimientos en la
  // UDM actual de MATRIZ y se avisa cuáles quedaron fuera.
  const udmsVistas = {};
  movimientosCodigo.forEach(function(f){
    const u = String(f[6] || "").trim();
    if(u) udmsVistas[u.toUpperCase()] = u;
  });
  const listaUdms = Object.keys(udmsVistas);
  const conversionDisponible = listaUdms.length <= 1;
  const advertencias = [];
  if(!conversionDisponible){
    advertencias.push(
      "Conversión no disponible: este código tiene movimientos históricos registrados con distintas UDM (" +
      Object.values(udmsVistas).join(", ") + "). Para no mezclar unidades incompatibles, este reporte solo " +
      "considera los movimientos capturados en " + udmProducto + " (la UDM actual del producto en MATRIZ). " +
      "Falta confirmar si las otras UDM son equivalentes o si fue un error de captura."
    );
  }

  function fechaValida(f){
    const fecha = f[2] instanceof Date ? f[2] : new Date(f[2]);
    return !isNaN(fecha.getTime());
  }
  function enRango(f, desde, hasta){
    const fecha = f[2] instanceof Date ? f[2] : new Date(f[2]);
    return fecha.getTime() >= desde.getTime() && fecha.getTime() <= hasta.getTime();
  }
  function coincideUdm(f){
    return conversionDisponible || String(f[6] || "").trim() === udmProducto;
  }
  function coincideArea(f){
    return !areaFiltro || normalizarAreaSalida_(f[7]) === areaFiltro;
  }

  const movimientosFechaInvalida = movimientosCodigo.filter(function(f){ return !fechaValida(f); }).length;

  const movimientosEnPeriodo = movimientosCodigo.filter(function(f){
    return fechaValida(f) && enRango(f, rango.desde, rango.hasta) && coincideArea(f);
  });
  const movimientosValidos = movimientosEnPeriodo.filter(coincideUdm);
  const movimientosExcluidosPorUdm = movimientosEnPeriodo.length - movimientosValidos.length;

  // Periodo anterior (misma duración, inmediatamente antes) — solo para la tendencia.
  const duracionMs = rango.hasta.getTime() - rango.desde.getTime();
  const anteriorHasta = new Date(rango.desde.getTime() - 1000);
  const anteriorDesde = new Date(anteriorHasta.getTime() - duracionMs);
  const movimientosPeriodoAnterior = movimientosCodigo.filter(function(f){
    return fechaValida(f) && enRango(f, anteriorDesde, anteriorHasta) && coincideArea(f) && coincideUdm(f);
  });
  const consumoPeriodoAnterior = movimientosPeriodoAnterior.reduce(function(s, f){
    const c = Number(f[5]);
    return s + ((c && c > 0) ? c : 0);
  }, 0);

  const resumen = calcularResumenConsumo_(movimientosValidos, rango, consumoPeriodoAnterior);

  // Consumo por área — a partir de los mismos movimientos ya válidos.
  const porArea = {};
  movimientosValidos.forEach(function(f){
    const cantidad = Number(f[5]);
    if(!cantidad || cantidad <= 0) return;
    const areaOriginal = String(f[7] || "").trim() || "(Sin área registrada)";
    const clave = normalizarAreaSalida_(areaOriginal);
    if(!porArea[clave]) porArea[clave] = { area: areaOriginal, consumo: 0 };
    porArea[clave].consumo += cantidad;
  });
  const consumoParaPorcentaje = resumen.consumoTotal;
  const consumoPorArea = Object.values(porArea)
    .map(function(a){
      return {
        area: a.area,
        consumo: Math.round(a.consumo * 1000) / 1000,
        porcentaje: consumoParaPorcentaje > 0 ? Math.round((a.consumo / consumoParaPorcentaje) * 1000) / 10 : 0
      };
    })
    .sort(function(a, b){ return b.consumo - a.consumo; });

  if(movimientosFechaInvalida > 0){
    advertencias.push(movimientosFechaInvalida + " movimiento(s) de este código tienen una fecha inválida en SALIDA y se excluyeron del cálculo.");
  }

  // Costo de consumo — reutiliza el motor central de costeo TAL CUAL,
  // sin modificarlo (obtenerCostoUnitarioReal_, 📁 App.gs.gs). Si el
  // producto no tiene costo capturado, se informa en vez de mostrar $0
  // como si fuera un dato real.
  const costoUnitarioReal = obtenerCostoUnitarioReal_(costoUnitario, convertir, presentacion);
  const costoDisponible = costoUnitarioReal > 0;
  const costoConsumoTotal = costoDisponible ? Math.round(resumen.consumoTotal * costoUnitarioReal * 100) / 100 : null;

  return {
    producto: {
      codigo: codigo,
      nombre: nombreProducto,
      udm: udmProducto,
      existenciaActual: existenciaActual,
      descontinuado: descontinuado
    },
    filtros: {
      periodoPreset: filtros.periodoPreset || "PERSONALIZADO",
      fechaDesde: Utilities.formatDate(rango.desde, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      fechaHasta: Utilities.formatDate(rango.hasta, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      area: filtros.area || ""
    },
    conversionDisponible: conversionDisponible,
    resumen: resumen,
    consumoPorArea: consumoPorArea,
    costo: {
      disponible: costoDisponible,
      costoUnitarioReal: costoDisponible ? costoUnitarioReal : null,
      costoConsumoTotal: costoConsumoTotal
    },
    advertencias: advertencias,
    movimientosExcluidosPorUdm: movimientosExcluidosPorUdm
  };

}

/**
 * Top de productos más consumidos en un periodo/área — pensado para un
 * futuro dashboard (sección "TOP DE PRODUCTOS" del pedido). Agrupa por
 * CÓDIGO (nunca por nombre, para no mezclar productos distintos con el
 * mismo nombre) y lee MATRIZ una sola vez para resolver nombre/UDM de
 * cada código encontrado, en vez de una consulta por producto.
 */
function obtenerTopProductosConsumidosApp(filtros, token){

  requerirSesionActivaApp_(token);
  filtros = filtros || {};

  const rango = resolverRangoFechas_(filtros);
  const areaFiltro = filtros.area ? normalizarAreaSalida_(filtros.area) : "";
  const limite = Math.max(1, Number(filtros.limite) || 10);

  const datosMatriz = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);
  const mapaProducto = {};
  datosMatriz.forEach(function(f){
    const codigo = String(f[4] || "").trim();
    if(codigo) mapaProducto[codigo] = { producto: f[0], udm: f[1] };
  });

  const datosSalida = obtenerFilasHojaCacheadas_("SALIDA").slice(1);
  const acumulado = {};

  datosSalida.forEach(function(f){

    const cantidad = Number(f[5]);
    if(!cantidad || cantidad <= 0) return;

    const fecha = f[2] instanceof Date ? f[2] : new Date(f[2]);
    if(isNaN(fecha.getTime())) return;
    if(fecha.getTime() < rango.desde.getTime() || fecha.getTime() > rango.hasta.getTime()) return;
    if(areaFiltro && normalizarAreaSalida_(f[7]) !== areaFiltro) return;

    const codigo = String(f[3] || "").trim();
    if(!codigo) return;
    const udm = String(f[6] || "").trim();

    if(!acumulado[codigo]) acumulado[codigo] = { consumo: 0, movimientos: 0, udms: {} };
    acumulado[codigo].consumo += cantidad;
    acumulado[codigo].movimientos++;
    if(udm) acumulado[codigo].udms[udm] = true;

  });

  const lista = Object.keys(acumulado).map(function(codigo){
    const info = mapaProducto[codigo];
    const udmsDistintas = Object.keys(acumulado[codigo].udms);
    return {
      codigo: codigo,
      producto: info ? info.producto : ("(código no encontrado en MATRIZ: " + codigo + ")"),
      udm: udmsDistintas.length === 1 ? udmsDistintas[0] : (info ? info.udm : ""),
      conversionDisponible: udmsDistintas.length <= 1,
      consumoTotal: Math.round(acumulado[codigo].consumo * 1000) / 1000,
      movimientos: acumulado[codigo].movimientos
    };
  });

  lista.sort(function(a, b){ return b.consumoTotal - a.consumoTotal; });

  return lista.slice(0, limite);

}

/**
 * Dashboard agregado de consumo (mejora futura del pedido original, ya
 * autorizada explícitamente por el usuario): Top de productos, tendencia
 * mensual y consumo por área, en una sola pantalla. UNA sola pasada de
 * SALIDA (más una segunda pasada ligera solo para el total del periodo
 * anterior) — a propósito NO llama a obtenerTopProductosConsumidosApp
 * para no releer la hoja dos veces.
 *
 * Por qué en $ y no en cantidad: no se puede sumar "5 kg de harina + 3 L
 * de aceite + 40 pz de servilletas" en un solo número con unidad — son
 * magnitudes físicamente incompatibles. El valor monetario (cantidad ×
 * obtenerCostoUnitarioReal_, motor de costeo reutilizado sin modificar)
 * sí es una unidad común entre productos, así que la tendencia mensual y
 * el desglose por área se agregan en $. El ranking de "Top Productos" no
 * tiene ese problema (es un solo producto a la vez) y se muestra en la
 * UDM propia de cada producto, igual que obtenerTopProductosConsumidosApp.
 * Un producto sin costo capturado en MATRIZ no aporta $ a ningún total
 * (no se inventa un valor) pero sí cuenta para su propio ranking de
 * cantidad — se informa cuántos movimientos/productos quedaron así.
 */
function obtenerDashboardConsumoApp(filtros, token){

  requerirSesionActivaApp_(token);
  filtros = filtros || {};

  const rango = resolverRangoFechas_(filtros);
  const areaFiltro = filtros.area ? normalizarAreaSalida_(filtros.area) : "";
  const limite = Math.max(1, Number(filtros.limite) || 10);

  // Mapa código -> {producto, udm, costoUnitarioReal} — una sola pasada de MATRIZ.
  const datosMatriz = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);
  const mapaProducto = {};
  datosMatriz.forEach(function(f){
    const codigo = String(f[4] || "").trim();
    if(!codigo) return;
    const costoUnitarioReal = obtenerCostoUnitarioReal_(Number(f[17]) || 0, f[18], f[19]);
    mapaProducto[codigo] = { producto: f[0], udm: f[1], costoUnitarioReal: costoUnitarioReal, costoDisponible: costoUnitarioReal > 0 };
  });

  const datosSalida = obtenerFilasHojaCacheadas_("SALIDA").slice(1);

  function sumarValorEnRango_(desde, hasta){
    let valor = 0;
    datosSalida.forEach(function(f){
      const cantidad = Number(f[5]);
      if(!cantidad || cantidad <= 0) return;
      const fecha = f[2] instanceof Date ? f[2] : new Date(f[2]);
      if(isNaN(fecha.getTime())) return;
      if(fecha.getTime() < desde.getTime() || fecha.getTime() > hasta.getTime()) return;
      if(areaFiltro && normalizarAreaSalida_(f[7]) !== areaFiltro) return;
      const codigo = String(f[3] || "").trim();
      const info = mapaProducto[codigo];
      if(!info || !info.costoDisponible) return;
      valor += cantidad * info.costoUnitarioReal;
    });
    return valor;
  }

  const porMes = {};
  const porArea = {};
  const acumuladoProducto = {};
  let valorConsumoTotal = 0;
  let movimientosTotales = 0;
  let movimientosSinCosto = 0;
  const codigosSinCosto = {};

  datosSalida.forEach(function(f){
    const cantidad = Number(f[5]);
    if(!cantidad || cantidad <= 0) return;
    const fecha = f[2] instanceof Date ? f[2] : new Date(f[2]);
    if(isNaN(fecha.getTime())) return;
    if(fecha.getTime() < rango.desde.getTime() || fecha.getTime() > rango.hasta.getTime()) return;
    if(areaFiltro && normalizarAreaSalida_(f[7]) !== areaFiltro) return;

    const codigo = String(f[3] || "").trim();
    if(!codigo) return;

    movimientosTotales++;

    if(!acumuladoProducto[codigo]) acumuladoProducto[codigo] = { consumo: 0, movimientos: 0, udms: {} };
    acumuladoProducto[codigo].consumo += cantidad;
    acumuladoProducto[codigo].movimientos++;
    const udmMov = String(f[6] || "").trim();
    if(udmMov) acumuladoProducto[codigo].udms[udmMov] = true;

    const info = mapaProducto[codigo];
    if(!info || !info.costoDisponible){
      movimientosSinCosto++;
      codigosSinCosto[codigo] = true;
      return; // sin costo capturado: no aporta $ a mes/área/total (no se inventa un valor)
    }

    const valor = cantidad * info.costoUnitarioReal;
    valorConsumoTotal += valor;

    const claveMes = fecha.getFullYear() + "-" + String(fecha.getMonth() + 1).padStart(2, "0");
    if(!porMes[claveMes]) porMes[claveMes] = { anio: fecha.getFullYear(), mes: fecha.getMonth() + 1, etiqueta: obtenerMesLetra(fecha) + " " + fecha.getFullYear(), valor: 0 };
    porMes[claveMes].valor += valor;

    const areaOriginal = String(f[7] || "").trim() || "(Sin área registrada)";
    const claveArea = normalizarAreaSalida_(areaOriginal);
    if(!porArea[claveArea]) porArea[claveArea] = { area: areaOriginal, valor: 0 };
    porArea[claveArea].valor += valor;
  });

  const consumoMensualValor = Object.keys(porMes).sort().map(function(clave){
    const m = porMes[clave];
    return { anio: m.anio, mes: m.mes, etiqueta: m.etiqueta, valor: Math.round(m.valor * 100) / 100 };
  });

  let mesMayorGasto = null;
  consumoMensualValor.forEach(function(m){
    if(!mesMayorGasto || m.valor > mesMayorGasto.valor) mesMayorGasto = m;
  });

  const consumoPorArea = Object.values(porArea)
    .map(function(a){
      return { area: a.area, valor: Math.round(a.valor * 100) / 100, porcentaje: valorConsumoTotal > 0 ? Math.round((a.valor / valorConsumoTotal) * 1000) / 10 : 0 };
    })
    .sort(function(a, b){ return b.valor - a.valor; });

  const topProductos = Object.keys(acumuladoProducto).map(function(codigo){
    const info = mapaProducto[codigo];
    const acc = acumuladoProducto[codigo];
    const udmsDistintas = Object.keys(acc.udms);
    return {
      codigo: codigo,
      producto: info ? info.producto : ("(código no encontrado en MATRIZ: " + codigo + ")"),
      udm: udmsDistintas.length === 1 ? udmsDistintas[0] : (info ? info.udm : ""),
      conversionDisponible: udmsDistintas.length <= 1,
      consumoTotal: Math.round(acc.consumo * 1000) / 1000,
      movimientos: acc.movimientos
    };
  }).sort(function(a, b){ return b.consumoTotal - a.consumoTotal; }).slice(0, limite);

  const productoTop = topProductos.length ? topProductos[0] : null;

  // Periodo anterior (misma duración, inmediatamente antes) — solo para tendencia en $.
  const duracionMs = rango.hasta.getTime() - rango.desde.getTime();
  const anteriorHasta = new Date(rango.desde.getTime() - 1000);
  const anteriorDesde = new Date(anteriorHasta.getTime() - duracionMs);
  const valorPeriodoAnterior = sumarValorEnRango_(anteriorDesde, anteriorHasta);
  const tendenciaPct = valorPeriodoAnterior > 0 ? Math.round(((valorConsumoTotal - valorPeriodoAnterior) / valorPeriodoAnterior) * 1000) / 10 : null;

  return {
    filtros: {
      periodoPreset: filtros.periodoPreset || "PERSONALIZADO",
      fechaDesde: Utilities.formatDate(rango.desde, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      fechaHasta: Utilities.formatDate(rango.hasta, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      area: filtros.area || ""
    },
    resumen: {
      valorConsumoTotal: Math.round(valorConsumoTotal * 100) / 100,
      valorPeriodoAnterior: Math.round(valorPeriodoAnterior * 100) / 100,
      tendenciaPct: tendenciaPct,
      movimientosTotales: movimientosTotales,
      movimientosSinCosto: movimientosSinCosto,
      productosSinCosto: Object.keys(codigosSinCosto).length,
      productoTop: productoTop,
      mesMayorGasto: mesMayorGasto
    },
    consumoMensualValor: consumoMensualValor,
    topProductos: topProductos,
    consumoPorArea: consumoPorArea
  };

}
