// ============================================
// INTELIGENCIA.GS — TAGERS WMS 2.0, Fase 1 (Dashboard accionable)
// ============================================
//
// Capa 100% de LECTURA sobre datos que ya existen en el sistema — nunca
// escribe en ninguna hoja, nunca ajusta existencia, nunca genera folios.
// Junta en un solo lugar lo que hoy vive disperso entre varios módulos
// (obtenerProductosBajoMinimo, obtenerContadoresControl, requisiciones
// pendientes, OC pendientes, transferencias en tránsito, lotes por
// caducar) para que el Dashboard pueda mostrar "¿qué necesita atención?"
// sin duplicar ninguna lógica de conteo/estado ya probada en su módulo
// original. Ver auditoría TAGERS WMS 2.0 (sección Q) para el porqué de
// este archivo separado.

/**
 * Transferencias entre sucursales (del pipeline de Requisiciones por
 * Sucursal) que ya se despacharon pero la sucursal destino todavía no
 * confirma su recepción.
 */
function obtenerTransferenciasPendientesApp(token){

  requerirSesionActivaApp_(token);

  const hoja = obtenerHojaTransferenciasRequisiciones_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,7).getValues();

  return datos
    .filter(f => String(f[6]||"").trim() === "EN_TRANSITO")
    .map(f => ({
      folioTransferencia: f[0],
      folioRequisicion: f[1],
      origen: f[2],
      destino: f[3],
      fecha: f[4] instanceof Date ? Utilities.formatDate(f[4], Session.getScriptTimeZone(), "dd/MM/yyyy") : String(f[4]||"")
    }));

}

/**
 * Lotes de PRODUCCIÓN (únicos con fecha de caducidad capturada hoy —
 * ver auditoría, sección L: la mercancía comprada todavía no tiene este
 * dato en ninguna hoja) con existencia disponible y caducidad dentro de
 * los próximos `diasUmbral` días. No incluye lotes ya agotados.
 */
function obtenerLotesProximosACaducarApp(token, diasUmbral){

  requerirSesionActivaApp_(token);

  const umbral = Number(diasUmbral) || 7;
  const hoja = obtenerHojaProduccion_();
  if(hoja.getLastRow() < 2) return [];

  const datos = hoja.getRange(2,1,hoja.getLastRow()-1,14).getValues();
  const hoy = new Date();
  hoy.setHours(0,0,0,0);

  return datos
    .filter(f => String(f[11]||"").trim() !== "AGOTADO" && f[2] instanceof Date && (Number(f[10])||0) > 0)
    .map(f => {
      const dias = Math.round((f[2] - hoy) / 86400000);
      return {
        folio: f[0],
        codigo: f[5],
        producto: f[6],
        caducidad: Utilities.formatDate(f[2], Session.getScriptTimeZone(), "dd/MM/yyyy"),
        diasRestantes: dias,
        cantidadDisponible: Number(f[10]) || 0,
        udm: f[9]
      };
    })
    .filter(l => l.diasRestantes <= umbral)
    .sort((a,b) => a.diasRestantes - b.diasRestantes);

}

/**
 * "¿Qué necesita atención?" — el agregador central del Dashboard 2.0.
 * Cada bucket (urgente/atencion/revisar) es una lista de tarjetas ya
 * clasificadas; el frontend las pinta tal cual, tanto en la sección de
 * Acciones Requeridas del Inicio como en el Centro de Tareas (misma
 * data, dos presentaciones). `accion.vista` es la pista de navegación
 * que el frontend ya sabe interpretar (abre la vista correspondiente,
 * que ya existe y ya valida sus propios permisos otra vez del lado del
 * servidor — esto no reemplaza esa validación, solo evita ofrecer una
 * tarjeta que de todos modos se rechazaría).
 *
 * Clasificación (igual que pide el pedido de TAGERS 2.0, sección 8):
 *   🔴 urgente  — agotados (existencia en 0)
 *   🟠 atencion — bajo mínimo, discrepancias pendientes, requisiciones
 *                 pendientes (área y sucursal), transferencias en
 *                 tránsito, órdenes de compra pendientes/parciales
 *   🟡 revisar  — conteos cíclicos abiertos, lotes de producción
 *                 próximos a caducar
 *
 * NOTA HONESTA (ver auditoría): "discrepancias" no tiene hoy ningún
 * campo de severidad en DISCREPANCIAS, así que TODAS se listan en
 * atención — no se inventa un criterio de "crítica" que no existe en
 * los datos. "Exceso de inventario" y "cobertura por consumo" (pedido,
 * secciones 11-13) requieren el motor de consumo promedio de Fase 2 y
 * deliberadamente NO están en este agregador todavía.
 */
function obtenerAccionesRequeridasApp(token){

  requerirSesionActivaApp_(token);
  const acceso = obtenerAccesoRequisicionesApp(token);

  const urgente = [];
  const atencion = [];
  const revisar = [];

  // Inventario: visible para cualquier usuario con sesión activa, igual
  // que ya hace obtenerNotificacionesApp con obtenerProductosBajoMinimo.
  const bajoMinimo = obtenerProductosBajoMinimo();
  const agotados = bajoMinimo.filter(p => p.estado === "Agotado");
  const bajos = bajoMinimo.filter(p => p.estado === "Bajo");

  if(agotados.length){
    urgente.push({
      tipo: "agotados", cantidad: agotados.length,
      titulo: agotados.length + " producto(s) agotados",
      detalle: "Existencia en 0 — requieren reposición inmediata",
      accion: { vista: "inventario-agotado" }
    });
  }

  if(bajos.length){
    atencion.push({
      tipo: "bajo-minimo", cantidad: bajos.length,
      titulo: bajos.length + " producto(s) bajo mínimo",
      detalle: "Existencia por debajo del mínimo capturado",
      accion: { vista: "inventario-bajo" }
    });
  }

  // El resto es operación entre módulos — mismo criterio de acceso que
  // ya usa obtenerNotificacionesApp (solo Admin/Almacén).
  if(!acceso.esAdmin) return { urgente: urgente, atencion: atencion, revisar: revisar };

  const contadores = obtenerContadoresControl();

  if(contadores.discrepancias > 0){
    atencion.push({
      tipo: "discrepancias", cantidad: contadores.discrepancias,
      titulo: contadores.discrepancias + " discrepancia(s) pendiente(s)",
      detalle: "De conteos cíclicos, esperando revisión y aprobación",
      accion: { vista: "discrepancias" }
    });
  }

  if(contadores.conteosAbiertos > 0){
    revisar.push({
      tipo: "conteos", cantidad: contadores.conteosAbiertos,
      titulo: contadores.conteosAbiertos + " conteo(s) cíclico(s) sin cerrar",
      detalle: "Pendientes de captura, discrepancias o cierre",
      accion: { vista: "conteos" }
    });
  }

  const reqArea = obtenerRequisicionesApp(token).filter(r => r.estado === "PENDIENTE");
  if(reqArea.length){
    atencion.push({
      tipo: "requisiciones-area", cantidad: reqArea.length,
      titulo: reqArea.length + " requisición(es) de área pendiente(s)",
      detalle: "Esperando preparación y entrega",
      accion: { vista: "requisiciones-pendientes" }
    });
  }

  const reqSucursal = obtenerRequisicionesSucursalApp(token).filter(r => r.estado === "PENDIENTE");
  if(reqSucursal.length){
    atencion.push({
      tipo: "requisiciones-sucursal", cantidad: reqSucursal.length,
      titulo: reqSucursal.length + " requisición(es) de sucursal pendiente(s)",
      detalle: "Esperando aprobación",
      accion: { vista: "requisiciones-sucursal" }
    });
  }

  const transferenciasPendientes = obtenerTransferenciasPendientesApp(token);
  if(transferenciasPendientes.length){
    atencion.push({
      tipo: "transferencias", cantidad: transferenciasPendientes.length,
      titulo: transferenciasPendientes.length + " transferencia(s) en tránsito",
      detalle: "Esperando recepción en la sucursal destino",
      accion: { vista: "requisiciones-sucursal" }
    });
  }

  const ocPendientes = obtenerOrdenesCompraApp().filter(o => o.estado === "PENDIENTE" || o.estado === "PARCIAL");
  if(ocPendientes.length){
    atencion.push({
      tipo: "ordenes-compra", cantidad: ocPendientes.length,
      titulo: ocPendientes.length + " orden(es) de compra pendiente(s)",
      detalle: "Esperando recepción total o parcial",
      accion: { vista: "ordenes-compra" }
    });
  }

  const lotesPorCaducar = obtenerLotesProximosACaducarApp(token, 7);
  if(lotesPorCaducar.length){
    revisar.push({
      tipo: "caducidades", cantidad: lotesPorCaducar.length,
      titulo: lotesPorCaducar.length + " lote(s) de producción próximos a caducar",
      detalle: "Dentro de los próximos 7 días — solo producción interna por ahora",
      accion: { vista: "lotes-produccion" }
    });
  }

  return { urgente: urgente, atencion: atencion, revisar: revisar };

}

// ============================================
// Fase 2 — Inteligencia de inventario (cobertura, consumo, exceso)
// ============================================
//
// ALCANCE (decisión explícita, ver auditoría sección L/Q): KARDEX no
// tiene columna Sucursal — un mismo Tipo "SALIDA" se usa tanto para
// consumo directo de S01 como para mercancía despachada a una sucursal
// (el destino solo queda en el texto libre de Observación). Por eso
// esta capa suma TODA la Salida por Código sin distinguir destino, y
// la cruza contra MATRIZ — exactamente el mismo alcance implícito que
// ya tienen las tarjetas existentes de "Bajo mínimo"/"Agotados"
// (leen MATRIZ.Existencia/Mínimo sin filtrar por sucursal, porque S01
// es hoy la única sucursal operativa). No es una inconsistencia nueva:
// es continuar el mismo criterio ya establecido.

/**
 * Suma de Salida en KARDEX por Código, dentro de los últimos `diasHistorial`
 * días (por defecto 30). Devuelve un mapa { CODIGO: totalSalida }. Usa
 * new Date(fila[0]) en vez de "instanceof Date" para comparar fechas: así
 * funciona igual si la celda llega vacía/como texto (Date inválida, se
 * descarta) y evita depender de que el valor haya sido construido con el
 * mismo constructor Date que compara (ver INT-004 en pruebas-qa).
 */
function calcularConsumoPorCodigo_(diasHistorial){

  const datos = obtenerFilasHojaCacheadas_("KARDEX");
  datos.shift();

  const hoy = new Date();
  hoy.setHours(0,0,0,0);
  const desde = new Date(hoy);
  desde.setDate(desde.getDate() - diasHistorial);

  const consumo = {};

  datos.forEach(fila => {
    if(String(fila[2]||"").trim() !== "SALIDA") return;

    const fecha = new Date(fila[0]);
    if(isNaN(fecha.getTime())) return;
    fecha.setHours(0,0,0,0);
    if(fecha < desde || fecha > hoy) return;

    const codigo = String(fila[4]||"").trim();
    if(!codigo) return;

    const salida = Number(fila[7]) || 0;
    consumo[codigo] = (consumo[codigo] || 0) + salida;
  });

  return consumo;

}

/**
 * Cobertura de inventario por producto: consumo promedio diario (de
 * KARDEX, ventana configurable), días de cobertura restantes al ritmo
 * actual, y clasificación de riesgo. Solo cubre MATRIZ/S01 (ver nota de
 * alcance arriba). Reutiliza calcularValorInventario_ — nunca reinventa
 * el cálculo monetario.
 *
 * Umbrales configurables vía `opciones` (pedido explícito: "no
 * hardcodeados si es posible") — con valores por defecto razonables
 * cuando no se pasan:
 *   diasHistorial   (30)  — ventana de consumo para el promedio
 *   umbralCritico   (3)   — días de cobertura < esto → "critico"
 *   umbralRiesgo    (7)   — días de cobertura < esto → "riesgo"
 *   umbralExceso    (45)  — días de cobertura >= esto → "exceso"
 *
 * Si un producto no tuvo NINGÚN consumo en la ventana, no se inventa un
 * número de días (ni infinito ni 0) — se marca clasificacion:"sin-consumo"
 * y diasCobertura:null, por instrucción explícita de "no simular una
 * métrica real como si fuera verdadera".
 */
function obtenerCoberturaInventarioApp(token, opciones){

  requerirSesionActivaApp_(token);
  opciones = opciones || {};

  const diasHistorial = Number(opciones.diasHistorial) || 30;
  const umbralCritico = Number(opciones.umbralCritico) || 3;
  const umbralRiesgo = Number(opciones.umbralRiesgo) || 7;
  const umbralExceso = Number(opciones.umbralExceso) || 45;

  const consumoPorCodigo = calcularConsumoPorCodigo_(diasHistorial);

  const datos = obtenerFilasHojaCacheadas_("MATRIZ");
  datos.shift();

  return datos
    .filter(f => !ubicacionVacia_(String(f[9]||"").trim()))
    .map(f => {
      const codigo = String(f[4]||"").trim();
      const existencia = Number(f[10]) || 0;
      const costo = Number(f[17]) || 0;
      const convertir = f[18];
      const presentacion = f[19];

      const consumoTotal = consumoPorCodigo[codigo] || 0;
      const consumoPromedioDiario = consumoTotal / diasHistorial;

      let diasCobertura = null;
      let clasificacion = "sin-consumo";

      if(consumoPromedioDiario > 0){
        diasCobertura = Math.round((existencia / consumoPromedioDiario) * 10) / 10;
        if(diasCobertura < umbralCritico) clasificacion = "critico";
        else if(diasCobertura < umbralRiesgo) clasificacion = "riesgo";
        else if(diasCobertura >= umbralExceso) clasificacion = "exceso";
        else clasificacion = "normal";
      }

      return {
        producto: f[0],
        codigo: codigo,
        existencia: existencia,
        consumoPromedioDiario: Math.round(consumoPromedioDiario * 100) / 100,
        diasCobertura: diasCobertura,
        clasificacion: clasificacion,
        valorInventario: (existencia > 0 && costo > 0) ? calcularValorInventario_(existencia, costo, convertir, presentacion) : 0
      };
    });

}

/**
 * Resumen agregado (conteo + valor monetario total) por clasificación de
 * cobertura, para las tarjetas KPI del Dashboard. Reutiliza
 * obtenerCoberturaInventarioApp — no duplica el cruce KARDEX/MATRIZ.
 */
function obtenerResumenCoberturaApp(token, opciones){

  const detalle = obtenerCoberturaInventarioApp(token, opciones);

  const resumen = {
    critico: { cantidad: 0, valor: 0 },
    riesgo: { cantidad: 0, valor: 0 },
    normal: { cantidad: 0, valor: 0 },
    exceso: { cantidad: 0, valor: 0 },
    "sin-consumo": { cantidad: 0, valor: 0 }
  };

  detalle.forEach(p => {
    const bucket = resumen[p.clasificacion];
    bucket.cantidad += 1;
    bucket.valor += p.valorInventario;
  });

  Object.keys(resumen).forEach(k => {
    resumen[k].valor = Math.round(resumen[k].valor * 100) / 100;
  });

  return resumen;

}
