
function obtenerAnalisisProductoComprasApp(busqueda){

  const texto = normalizarTexto_(busqueda);
  if(!texto) throw new Error("Escribe un producto o código para buscar.");

  const ss = SpreadsheetApp.getActive();
  const ordenes = ss.getSheetByName("ORDENES_COMPRA");
  const detalle = ss.getSheetByName("DETALLE_OC");

  if(!ordenes || !detalle || detalle.getLastRow() < 2) return null;

  const datosOrdenes = ordenes.getRange(2, 1, ordenes.getLastRow()-1, 7).getValues();
  const mapaOrdenes = {};
  datosOrdenes.forEach(f => {
    mapaOrdenes[String(f[0]||"").trim().toUpperCase()] = { fecha: f[1], proveedor: f[2], estado: f[4] };
  });

  const anchoDetalle = Math.min(detalle.getLastColumn(), 10);
  const datosDetalle = detalle.getRange(2, 1, detalle.getLastRow()-1, anchoDetalle).getValues();

  let nombreProducto = null;
  let codigoProducto = null;
  const compras = [];

  datosDetalle.forEach(f => {

    const codigo = String(f[1]||"").trim();
    const producto = String(f[2]||"");
    const coincide = normalizarTexto_(producto).indexOf(texto) !== -1 || normalizarTexto_(codigo).indexOf(texto) !== -1;
    if(!coincide) return;

    const oc = String(f[0]||"").trim().toUpperCase();
    const infoOrden = mapaOrdenes[oc];
    if(!infoOrden) return;
    if(String(infoOrden.estado||"").toUpperCase() === "CANCELADA") return;

    const recibido = Number(f[7]) || 0;
    if(recibido <= 0) return; // solo cuenta lo que de verdad entró a almacén

    if(!nombreProducto){ nombreProducto = producto; codigoProducto = codigo; }

    compras.push({
      fecha: infoOrden.fecha instanceof Date ? infoOrden.fecha : new Date(infoOrden.fecha),
      cantidad: recibido,
      precio: Number(f[5]) || 0,
      importe: Math.round(recibido * (Number(f[5])||0) * 100) / 100,
      proveedor: infoOrden.proveedor,
      oc: oc
    });

  });

  if(!compras.length) return null;

  compras.sort((a,b) => b.fecha - a.fecha);

  const ahora = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  let compradoEsteMes = 0;
  const foliosUnicos = {};
  const proveedoresUnicos = {};
  let sumaCantidadTotal = 0;
  let sumaImporteTotal = 0;
  let sumaPrecioPonderado = 0;

  const historialMap = {};
  const claveMes = (fecha) => Utilities.formatDate(fecha, Session.getScriptTimeZone(), "yyyy-MM");

  compras.forEach(c => {
    foliosUnicos[c.oc] = true;
    proveedoresUnicos[c.proveedor] = true;
    sumaCantidadTotal += c.cantidad;
    sumaImporteTotal += c.importe;
    sumaPrecioPonderado += c.precio * c.cantidad;
    if(c.fecha >= inicioMes) compradoEsteMes += c.cantidad;
    const clave = claveMes(c.fecha);
    historialMap[clave] = (historialMap[clave]||0) + c.cantidad;
  });

  // Últimos 12 meses en orden cronológico, con 0 en los meses sin compras
  // (así se ve la estacionalidad real, no solo los meses con datos).
  const historialMensual = [];
  for(let i = 11; i >= 0; i--){
    const fechaMes = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    const clave = claveMes(fechaMes);
    historialMensual.push({
      mes: Utilities.formatDate(fechaMes, Session.getScriptTimeZone(), "MMM yyyy"),
      cantidad: Math.round((historialMap[clave]||0) * 1000) / 1000
    });
  }

  const totalUltimos12Meses = historialMensual.reduce((s,m) => s + m.cantidad, 0);
  const ultima = compras[0];

  // Existencia/mínimo/máximo actuales, si el producto sigue en MATRIZ.
  let existenciaActual = null, minimoActual = null, maximoActual = null;
  if(codigoProducto){
    const matriz = ss.getSheetByName("MATRIZ");
    const filaMatriz = buscarFilaMatrizPorCodigo_(codigoProducto);
    if(filaMatriz !== -1){
      const infoMatriz = matriz.getRange(filaMatriz, 11, 1, 3).getValues()[0]; // K,L,M
      existenciaActual = Number(infoMatriz[0]) || 0;
      minimoActual = Number(infoMatriz[1]) || 0;
      maximoActual = Number(infoMatriz[2]) || 0;
    }
  }

  return {
    nombre: nombreProducto,
    codigo: codigoProducto,
    compradoEsteMes: Math.round(compradoEsteMes * 1000) / 1000,
    numeroOrdenes: Object.keys(foliosUnicos).length,
    proveedoresUtilizados: Object.keys(proveedoresUnicos).length,
    promedioMensual: Math.round((totalUltimos12Meses / 12) * 1000) / 1000,
    promedioSemanal: Math.round((totalUltimos12Meses / 12 / 4.345) * 1000) / 1000,
    ultimaCompra: {
      cantidad: ultima.cantidad,
      fecha: Utilities.formatDate(ultima.fecha, Session.getScriptTimeZone(), "dd/MM/yyyy"),
      precio: ultima.precio,
      proveedor: ultima.proveedor
    },
    precioPromedio: sumaCantidadTotal > 0 ? Math.round((sumaPrecioPonderado / sumaCantidadTotal) * 100) / 100 : 0,
    importeTotalComprado: Math.round(sumaImporteTotal * 100) / 100,
    historialMensual: historialMensual,
    totalUltimos12Meses: Math.round(totalUltimos12Meses * 1000) / 1000,
    existenciaActual: existenciaActual,
    minimoActual: minimoActual,
    maximoActual: maximoActual
  };

}

function generarProyeccionConsumoApp(busqueda, incrementoPct){

  const analisis = obtenerAnalisisProductoComprasApp(busqueda);
  if(!analisis) throw new Error("No hay historial de compras para ese producto todavía.");

  const incremento = Number(incrementoPct) || 0;
  const factor = 1 + (incremento / 100);

  const proyeccionMensual = analisis.historialMensual.map(m => ({
    mes: m.mes,
    historico: m.cantidad,
    proyectado: Math.round(m.cantidad * factor * 1000) / 1000
  }));

  const consumoAnualHistorico = analisis.totalUltimos12Meses;
  const consumoAnualProyectado = Math.round(consumoAnualHistorico * factor * 1000) / 1000;

  return {
    nombre: analisis.nombre,
    codigo: analisis.codigo,
    incrementoPct: incremento,
    consumoAnualHistorico: consumoAnualHistorico,
    consumoAnualProyectado: consumoAnualProyectado,
    promedioMensualProyectado: Math.round((consumoAnualProyectado/12) * 1000) / 1000,
    promedioSemanalProyectado: Math.round((consumoAnualProyectado/12/4.345) * 1000) / 1000,
    proyeccionMensual: proyeccionMensual
  };

}