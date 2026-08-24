/**
 * TAGERS WMS 2.0 — Notificaciones automáticas por correo (pedido del
 * usuario, punto 3). Dos avisos, ninguno expuesto a index.html ni a
 * ningún botón — ambos corren solos desde un disparador de tiempo
 * instalado una vez (ver instalarTriggerAvisoConteosHoy /
 * instalarTriggerStockCritico al final de este archivo).
 *
 * WhatsApp Business API queda fuera de esta pasada — requiere credenciales
 * (token + phone number ID de Meta) que no se tienen todavía. El usuario
 * decidió correo por ahora.
 */

// ================================================================
// AVISO 1: conteos cíclicos programados para hoy, uno por responsable
// ================================================================

/**
 * Junta los racks que tocan hoy (misma lógica que ya usa el Dashboard vía
 * obtenerConteosProgramadosHoyApp_) y le manda UN correo a cada
 * responsable con la lista de SUS racks — no un correo por rack.
 *
 * Resuelve "Responsable" (texto libre en PROGRAMACION_CONTEOS, columna E)
 * contra el Nombre de USUARIOS para sacar el correo; si no hay match (typo,
 * responsable que ya no existe, etc.) esa persona simplemente no recibe
 * nada — no se detiene el resto del aviso por un nombre que no cuadre.
 */
function enviarAvisoConteosHoyApp_(){

  const pendientes = obtenerConteosProgramadosHoyApp_();
  if(!pendientes.length) return { enviados: 0, sinCorreo: [] };

  const correoPorNombre = obtenerMapaCorreoPorNombre_();

  const racksPorResponsable = {};
  pendientes.forEach(function(p){
    const nombre = String(p.responsable || "").trim();
    if(!nombre) return;
    if(!racksPorResponsable[nombre]) racksPorResponsable[nombre] = [];
    racksPorResponsable[nombre].push(p.rack);
  });

  let enviados = 0;
  const sinCorreo = [];

  Object.keys(racksPorResponsable).forEach(function(nombre){

    const correo = correoPorNombre[normalizarTexto_(nombre)];
    if(!correo){
      sinCorreo.push(nombre);
      return;
    }

    const racks = racksPorResponsable[nombre];
    const asunto = "📋 TAGERS WMS — " + racks.length + " conteo(s) cíclico(s) para hoy";
    const cuerpo =
      "Hola " + nombre + ",\n\n" +
      "Hoy te toca contar " + racks.length + " rack(s):\n\n" +
      racks.map(function(r){ return "  • " + r; }).join("\n") +
      "\n\nEntra a TAGERS WMS → Capturar conteo para generarlos y empezar.\n\n" +
      "— Aviso automático de TAGERS WMS";

    MailApp.sendEmail(correo, asunto, cuerpo);
    enviados++;

  });

  return { enviados: enviados, sinCorreo: sinCorreo };

}

/**
 * Mapa "nombre normalizado" -> correo, de todos los usuarios ACTIVO.
 * normalizarTexto_ (ya existe en 📁 App.gs.gs) quita acentos/mayúsculas
 * para que "José Pérez" y "jose perez" empaten igual.
 */
function obtenerMapaCorreoPorNombre_(){

  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(!hoja || hoja.getLastRow() < 2) return {};

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();
  const mapa = {};

  datos.forEach(function(f){
    const correo = String(f[0] || "").trim();
    const nombre = String(f[1] || "").trim();
    const estado = String(f[4] || "").trim().toUpperCase();
    if(!correo || !nombre || estado !== "ACTIVO") return;
    mapa[normalizarTexto_(nombre)] = correo;
  });

  return mapa;

}

/**
 * Instalar UNA SOLA VEZ a mano desde el editor de Apps Script — dispara
 * enviarAvisoConteosHoyApp_ todos los días entre 6:00 y 7:00 a.m.
 */
function instalarTriggerAvisoConteosHoy(){

  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "enviarAvisoConteosHoyApp_"){
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("enviarAvisoConteosHoyApp_")
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  return { ok: true, mensaje: "Disparador diario instalado — corre todos los días entre 6:00 y 7:00 a.m." };

}

// ================================================================
// AVISO 2: stock crítico — solo cuando un producto CRUZA el mínimo
// ================================================================

/**
 * NO se enganchó dentro de resolverAjusteExistencia_ (el núcleo único de
 * escritura de existencia, que corre en CADA entrada/salida/conteo/OC de
 * todo el sistema) a propósito — añadirle un MailApp.sendEmail ahí le
 * mete latencia de red a la función más sensible y más llamada de todo el
 * proyecto, por un aviso que no necesita ser instantáneo.
 *
 * En vez de eso, esta función corre sola cada cierto tiempo (ver
 * instalarTriggerStockCritico), calcula qué productos están en o bajo su
 * Mínimo AHORA MISMO, lo compara contra el cálculo anterior (guardado en
 * PropertiesService) y solo avisa de los que se sumaron a la lista desde
 * la última corrida — "cruzar el mínimo", no "seguir bajo mínimo" en cada
 * pasada. Mismo criterio de "sin ubicación no aplica" que ya usa el resto
 * del Dashboard (obtenerDashboardMovil, obtenerProductosPorEstadoStock).
 */
function revisarStockCriticoYNotificarApp_(){

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);
  const criticosAhora = {};

  datos.forEach(function(f){
    const codigo = String(f[4] || "").trim();
    if(!codigo) return;

    const ubicacion = String(f[9] || "").trim();
    if(ubicacionVacia_(ubicacion)) return;

    const minimo = Number(f[11]) || 0;
    if(minimo <= 0) return; // sin mínimo capturado, no hay contra qué comparar

    const existencia = Number(f[10]) || 0;
    if(existencia > minimo) return;

    criticosAhora[codigo] = { codigo: codigo, producto: f[0], existencia: existencia, minimo: minimo };
  });

  const propiedades = PropertiesService.getScriptProperties();
  const anteriorJson = propiedades.getProperty("TAGERS_STOCK_CRITICO_ANTERIOR_");
  const criticosAntes = anteriorJson ? JSON.parse(anteriorJson) : {};

  const nuevos = Object.keys(criticosAhora).filter(function(c){ return !criticosAntes[c]; });

  if(nuevos.length){
    enviarCorreoStockCriticoNuevo_(nuevos.map(function(c){ return criticosAhora[c]; }));
  }

  propiedades.setProperty("TAGERS_STOCK_CRITICO_ANTERIOR_", JSON.stringify(criticosAhora));

  return { criticos: Object.keys(criticosAhora).length, nuevosAvisados: nuevos.length };

}

/**
 * Destinatarios: mismo criterio que ya usa obtenerAccesoRequisicionesApp
 * para decidir quién es "Almacén" (Rol=ADMIN, o Área=Almacén) — son
 * quienes ya ven y actúan sobre el stock crítico desde el Dashboard.
 */
function enviarCorreoStockCriticoNuevo_(productos){

  const hoja = SpreadsheetApp.getActive().getSheetByName("USUARIOS");
  if(!hoja || hoja.getLastRow() < 2) return;

  const datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues();

  const destinatarios = datos
    .filter(function(f){
      const estado = String(f[4] || "").trim().toUpperCase();
      if(estado !== "ACTIVO") return false;
      const rol = String(f[3] || "").trim().toUpperCase();
      const area = String(f[5] || "").trim().toUpperCase();
      return rol === "ADMIN" || area === "ALMACÉN" || area === "ALMACEN";
    })
    .map(function(f){ return String(f[0] || "").trim(); })
    .filter(Boolean);

  if(!destinatarios.length) return;

  const asunto = "🔴 TAGERS WMS — " + productos.length + " producto(s) cruzaron su mínimo";
  const cuerpo =
    "Estos productos acaban de quedar en o por debajo de su existencia mínima:\n\n" +
    productos.map(function(p){
      return "  • " + p.producto + " (" + p.codigo + ") — existencia: " + p.existencia + ", mínimo: " + p.minimo;
    }).join("\n") +
    "\n\nRevisa el Centro de Reabastecimiento en TAGERS WMS para generar la orden de compra.\n\n" +
    "— Aviso automático de TAGERS WMS";

  MailApp.sendEmail(destinatarios.join(","), asunto, cuerpo);

}

/**
 * Instalar UNA SOLA VEZ a mano desde el editor de Apps Script — revisa
 * stock crítico cada hora. Cambia .everyHours(1) si prefieres otro
 * intervalo (mínimo recomendado por Apps Script: cada 1 hora para
 * disparadores de este tipo).
 */
function instalarTriggerStockCritico(){

  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === "revisarStockCriticoYNotificarApp_"){
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("revisarStockCriticoYNotificarApp_")
    .timeBased()
    .everyHours(1)
    .create();

  return { ok: true, mensaje: "Disparador instalado — revisa stock crítico cada hora." };

}
