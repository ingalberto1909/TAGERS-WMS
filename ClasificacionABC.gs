// ============================================
// CLASIFICACIONABC.GS — TAGERS WMS 2.0 (Clasificación ABC de inventario)
// ============================================
//
// Capa 100% de LECTURA — igual que KpisOperativos.gs/Inteligencia.gs,
// nunca escribe en MATRIZ ni en ninguna otra hoja. La clasificación se
// calcula al vuelo a partir del consumo real (mismo cruce KARDEX/ventana
// que ya usa Inteligencia.gs para "Cobertura de inventario" —
// calcularConsumoPorCodigo_, NO se reimplementa ese cruce aquí) y del
// Costo Unitario vigente en MATRIZ. Deliberadamente NO se agrega ninguna
// columna nueva a MATRIZ: así una hoja real con columnas más allá de las
// que este repo modela en sus pruebas nunca corre riesgo de que le
// pisemos un dato.
//
// A diferencia de "Cobertura de inventario" (que excluye productos sin
// ubicación asignada, por ser una alerta operativa), ABC clasifica TODO
// el catálogo — el pedido fue "clasificar cada producto de mi matriz".
//
// Metodología (Pareto 80/15/5, la convención estándar de ABC de
// inventarios):
//   - Valor de consumo de un producto = (Σ Cantidad de SALIDA dentro de
//     la ventana, vía calcularConsumoPorCodigo_) × Costo Unitario vigente
//     en MATRIZ (ya es costo promedio ponderado real — ver
//     calcularCostoPromedioPonderado_).
//   - Se ordenan los productos de mayor a menor valor de consumo y se
//     acumula su % del valor total: A = hasta 80% acumulado,
//     B = hasta 95% acumulado, C = el resto.
//   - Un producto sin ninguna salida en la ventana no aporta valor y cae
//     naturalmente en C, pero además se marca `sinMovimiento: true` para
//     poder distinguir en el frontend "C por bajo valor" de "C por
//     inactividad" (candidato a revisar si sigue siendo necesario).
//
// Ventana por defecto: 180 días (~6 meses), configurable vía
// opciones.diasHistorial — mismo criterio que KpisOperativos.gs.
//
// Acceso: mismo criterio que KPIs operativos y análisis de compras —
// Admin o usuarios del área Almacén (obtenerAccesoRequisicionesApp).

function requerirAccesoClasificacionABC_(token){
  const acceso = obtenerAccesoRequisicionesApp(token);
  if(!acceso.esAdmin){
    throw new Error("Solo Almacén puede ver la clasificación ABC.");
  }
}

function calcularClasificacionABC_(opciones){

  opciones = opciones || {};
  const diasHistorial = Number(opciones.diasHistorial) || 180;

  const hasta = new Date();
  hasta.setHours(23, 59, 59, 999);
  const desde = new Date(hasta);
  desde.setDate(desde.getDate() - diasHistorial);
  desde.setHours(0, 0, 0, 0);

  // Consumo real por código: mismo cruce KARDEX/ventana que ya usa y
  // prueba Inteligencia.gs (obtenerCoberturaInventarioApp) — no se
  // reimplementa el cruce SALIDA/fecha en paralelo.
  const consumoPorCodigo = calcularConsumoPorCodigo_(diasHistorial);

  const matriz = obtenerFilasHojaCacheadas_("MATRIZ");
  matriz.shift();

  const productos = matriz
    .map(f => {
      const codigo = String(f[4]||"").trim();
      if(!codigo) return null;
      const costoUnitario = Number(f[17]) || 0;
      const cantidadSalida = consumoPorCodigo[codigo] || 0;
      return {
        codigo: codigo,
        producto: String(f[0]||"").trim(),
        existencia: Number(f[10]) || 0,
        costoUnitario: costoUnitario,
        cantidadSalida: cantidadSalida,
        valorConsumo: Math.round(cantidadSalida * costoUnitario * 100) / 100,
        sinMovimiento: cantidadSalida <= 0
      };
    })
    .filter(p => p !== null);

  productos.sort((a, b) => b.valorConsumo - a.valorConsumo);

  const totalValorConsumo = productos.reduce((s, p) => s + p.valorConsumo, 0);

  let acumulado = 0;
  let conteoA = 0, conteoB = 0, conteoC = 0;
  let valorA = 0, valorB = 0, valorC = 0;

  productos.forEach(p => {
    acumulado += p.valorConsumo;
    const porcentaje = totalValorConsumo > 0 ? (p.valorConsumo / totalValorConsumo) * 100 : 0;
    const porcentajeAcumulado = totalValorConsumo > 0 ? (acumulado / totalValorConsumo) * 100 : 0;

    let categoria;
    if(totalValorConsumo <= 0){
      categoria = "C"; // nadie tuvo salida en la ventana: no hay base para priorizar
    } else if(porcentajeAcumulado <= 80){
      categoria = "A";
    } else if(porcentajeAcumulado <= 95){
      categoria = "B";
    } else {
      categoria = "C";
    }

    p.porcentaje = Math.round(porcentaje * 100) / 100;
    p.porcentajeAcumulado = Math.round(porcentajeAcumulado * 100) / 100;
    p.categoria = categoria;

    if(categoria === "A"){ conteoA++; valorA += p.valorConsumo; }
    else if(categoria === "B"){ conteoB++; valorB += p.valorConsumo; }
    else { conteoC++; valorC += p.valorConsumo; }
  });

  return {
    diasHistorial: diasHistorial,
    desde: Utilities.formatDate(desde, Session.getScriptTimeZone(), "dd/MM/yyyy"),
    hasta: Utilities.formatDate(hasta, Session.getScriptTimeZone(), "dd/MM/yyyy"),
    totalProductos: productos.length,
    totalValorConsumo: Math.round(totalValorConsumo * 100) / 100,
    resumen: {
      A: { conteo: conteoA, valor: Math.round(valorA * 100) / 100 },
      B: { conteo: conteoB, valor: Math.round(valorB * 100) / 100 },
      C: { conteo: conteoC, valor: Math.round(valorC * 100) / 100 }
    },
    productos: productos
  };

}

function obtenerClasificacionABCApp(token, opciones){
  requerirSesionActivaApp_(token);
  requerirAccesoClasificacionABC_(token);
  return calcularClasificacionABC_(opciones);
}
