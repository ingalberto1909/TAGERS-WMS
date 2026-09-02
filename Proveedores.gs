/**
 * TAGERS WMS 2.0 — Módulo de Proveedores (pedido del usuario).
 *
 * Reemplaza el stub "Próximamente" de abrirProveedores(). A propósito NO
 * es una vista de compras: no calcula "sugerido", no genera nada, no abre
 * el flujo de Centro de Reabastecimiento — es informativa (qué le compro
 * a quién, en qué presentación, a qué precio, cuánta existencia tengo) y
 * permite corregir precio y presentación/UDM directo desde ahí, que es el
 * problema real que motivó este módulo (ej. un producto capturado con
 * Presentación equivocada infla su precio unitario real).
 *
 * No existe una hoja PROVEEDORES dedicada — "proveedor" es una columna
 * más de MATRIZ (columna Q, ver obtenerProveedorProducto_), así que la
 * "lista de proveedores" se agrupa a partir de ahí, igual que ya hacía
 * obtenerProveedoresReabastecimientoApp para Centro de Reabastecimiento.
 */

/**
 * Lista de proveedores CON el valor de inventario que tienen en existencia
 * ahora mismo (pedido del usuario: "qué proveedor es el que tengo más
 * valor económico de inventario") — ordenada de mayor a menor valor por
 * default, para que ese análisis se vea de un vistazo sin tener que
 * ordenar nada. Usa calcularValorInventario_, la misma función central que
 * ya usa el resto del proyecto para valorizar inventario (Dashboard,
 * Reportes) — no se reinventa el cálculo aquí.
 */
function obtenerListaProveedoresApp(token){

  requerirSesionActivaApp_(token);

  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);
  const mapa = {};

  datos.forEach(function(f){
    const proveedor = obtenerProveedorProducto_(f);
    const clave = normalizarProveedor_(proveedor);
    if(!mapa[clave]) mapa[clave] = { proveedor: proveedor, totalProductos: 0, valorInventario: 0 };

    const existencia = Number(f[10]) || 0;
    const costo = Number(f[17]) || 0;
    const convertir = String(f[18] || "").trim().toUpperCase() === "SI";
    const presentacion = Number(f[19]) || 0;

    mapa[clave].totalProductos++;
    mapa[clave].valorInventario += calcularValorInventario_(existencia, costo, convertir, presentacion);
  });

  const lista = Object.values(mapa).map(function(p){
    p.valorInventario = Math.round(p.valorInventario * 100) / 100;
    return p;
  });

  return lista.sort(function(a, b){ return b.valorInventario - a.valorInventario; });

}

/**
 * A diferencia de obtenerProductosPorProveedorApp (Centro de
 * Reabastecimiento), esta NO filtra por "con ubicación asignada" ni
 * calcula cantidad sugerida — es un catálogo informativo completo de lo
 * que se le compra a este proveedor, se use o no ahora mismo.
 */
function obtenerProductosProveedorInfoApp(proveedor, token){

  requerirSesionActivaApp_(token);

  const proveedorBuscado = normalizarProveedor_(proveedor);
  const datos = obtenerFilasHojaCacheadas_("MATRIZ").slice(1);

  return datos
    .filter(function(f){ return normalizarProveedor_(obtenerProveedorProducto_(f)) === proveedorBuscado; })
    .map(function(f){
      const existencia = Number(f[10]) || 0;
      const precio = Number(f[17]) || 0;
      const convertir = String(f[18] || "").trim().toUpperCase() === "SI";
      const presentacion = Number(f[19]) || 0;
      return {
        codigo: String(f[4] || "").trim(),
        producto: f[0],
        udm: f[1],
        ubicacion: String(f[9] || "").trim(),
        existencia: existencia,
        precio: precio,
        convertir: convertir,
        presentacion: presentacion,
        valor: calcularValorInventario_(existencia, precio, convertir, presentacion)
      };
    })
    .sort(function(a, b){ return b.valor - a.valor; });

}

/**
 * Ajusta precio y/o presentación/convertir de UN producto, cada uno de
 * forma independiente (manda solo lo que cambió). El precio usa el mismo
 * mecanismo ya existente en el proyecto (procesarCambioPrecioProducto_ ->
 * HISTORIAL_PRECIOS, NO Kardex — el Kardex es de cantidades, esto es
 * precio).
 *
 * OJO — desde migrarCostoUnitarioAPorUnidadApp, el Costo Unitario de
 * MATRIZ YA es el precio por una sola unidad de inventario (ver
 * calcularValorInventario_/obtenerCostoUnitarioReal_, que ya NO dividen
 * entre Presentación). Es decir: Convertir/Presentación NO afectan la
 * valorización — solo alimentan el "precio por presentación" que se
 * muestra al recibir una OC (ver buscarOCParaRecepcion en index.html). La
 * corrección real de un precio inflado (ej. capturado como precio de caja
 * completa en vez de precio por unidad) es ajustar el precio directamente,
 * no tocar Convertir/Presentación — el frontend ya lo explica así.
 * Presentación/Convertir no tenían NINGÚN punto de edición en todo el
 * proyecto — se agregan aquí con su propio registro en AUDITORIA de
 * cualquier forma, porque siguen siendo información real de compra.
 *
 * No se toca la UDM base con la que un producto lleva su existencia
 * (columna B) — cambiar eso invalidaría en automático toda su existencia
 * histórica ya contada en esa unidad. Si un producto de verdad necesita
 * cambiar de PZ a KG (no solo su presentación de compra), es una
 * migración de datos aparte, no un ajuste de este formulario.
 */
function ajustarProductoProveedorApp(codigo, datos, token){

  requerirAccesoAlmacenApp_(token);

  const filaMatriz = buscarFilaMatrizPorCodigo_(codigo);
  if(filaMatriz === -1) throw new Error("No se encontró el producto " + codigo);

  const matriz = SpreadsheetApp.getActive().getSheetByName("MATRIZ");
  const filaDatos = matriz.getRange(filaMatriz, 1, 1, 20).getValues()[0];
  const nombreProducto = filaDatos[0];
  const proveedor = obtenerProveedorProducto_(filaDatos);
  const usuario = obtenerNombreDesdeToken(token);

  let precioActualizado = false;
  let presentacionActualizada = false;

  if(datos && datos.precioNuevo !== undefined && datos.precioNuevo !== null && String(datos.precioNuevo).trim() !== ""){

    const precioNuevo = Number(datos.precioNuevo);
    if(!precioNuevo || precioNuevo <= 0){
      throw new Error("Captura un precio válido mayor a 0.");
    }

    const precioAnterior = Number(filaDatos[17]) || 0;
    if(precioNuevo !== precioAnterior){
      procesarCambioPrecioProducto_(codigo, nombreProducto, proveedor, precioNuevo, usuario, "AJUSTE MANUAL — Proveedores");
      precioActualizado = true;
    }

  }

  if(datos && (datos.presentacionNueva !== undefined || datos.convertirNuevo !== undefined)){

    const presentacionAnterior = Number(filaDatos[19]) || 0;
    const convertirAnterior = String(filaDatos[18] || "").trim().toUpperCase() === "SI";

    const presentacionNueva = datos.presentacionNueva !== undefined && String(datos.presentacionNueva).trim() !== ""
      ? Number(datos.presentacionNueva) || 0
      : presentacionAnterior;
    const convertirNuevo = datos.convertirNuevo !== undefined ? !!datos.convertirNuevo : convertirAnterior;

    if(presentacionNueva < 0){
      throw new Error("La presentación no puede ser negativa.");
    }
    if(convertirNuevo && presentacionNueva <= 0){
      throw new Error("Si activas \"Convertir\", captura cuántas unidades trae cada presentación.");
    }

    if(presentacionNueva !== presentacionAnterior || convertirNuevo !== convertirAnterior){
      matriz.getRange(filaMatriz, 19).setValue(convertirNuevo ? "SI" : "NO");
      matriz.getRange(filaMatriz, 20).setValue(presentacionNueva);
      invalidarCacheHoja_("MATRIZ");

      registrarAuditoria(usuario, "PROVEEDORES", "PRESENTACIÓN AJUSTADA", codigo, "", "", 0, 0,
        "Convertir " + (convertirAnterior ? "SI" : "NO") + " → " + (convertirNuevo ? "SI" : "NO") +
        ", Presentación " + presentacionAnterior + " → " + presentacionNueva);

      presentacionActualizada = true;
    }

  }

  if(!precioActualizado && !presentacionActualizada){
    throw new Error("No hay ningún cambio que guardar.");
  }

  return { ok: true, precioActualizado: precioActualizado, presentacionActualizada: presentacionActualizada };

}
