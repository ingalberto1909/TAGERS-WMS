'use strict';

/*
 * HISTÓRICO DE CONSUMO (HistoricoConsumo.gs) — módulo de solo lectura
 * pedido por el usuario. Cubre los 10 casos mínimos acordados en el
 * plan: producto con muchos movimientos, sin movimientos, código
 * inexistente, distintas áreas, distintos periodos, presentación con
 * conversión (confirmando que NO se multiplica), UDM distinta,
 * cantidades inválidas, fechas inválidas y distintos roles de usuario.
 *
 * Regla central verificada en varios de estos casos: consumo real =
 * SALIDA.Cantidad tal cual, SIN multiplicar por Presentación/Convertir
 * — esas columnas son solo para compras, nunca para consumo.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, filaProducto, encabezadoMatriz } = require('../lib/datos-prueba');

function encabezadoSalida(){
  return ['Año', 'Mes', 'Fecha', 'Código', 'Producto', 'Cantidad', 'UDM', 'Área', 'Lote', 'Caducidad', 'Ubicación'];
}

function filaSalida(fecha, codigo, producto, cantidad, udm, area){
  return [fecha.getFullYear(), '', fecha, codigo, producto, cantidad, udm || 'KG', area || '', '', '', ''];
}

function entornoConSalida(matrizExtra, salidaExtra){
  const matriz = [encabezadoMatriz()].concat(matrizExtra || []);
  const salida = [encabezadoSalida()].concat(salidaExtra || []);
  const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matriz, SALIDA: salida }) });
  const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
  return { entorno, token };
}

function d(anio, mes, dia){
  return new Date(anio, mes - 1, dia);
}

// ============================================
// Caso 1 — producto con muchos movimientos + Caso 5 — distintos periodos
// ============================================
prueba({
  id: 'HCO-001', grupo: 'consumo', nombre: 'Producto con varios movimientos: consumo total, mensual, resumen y filtro por periodo personalizado', metodo: 'EMPÍRICO',
  objetivo: 'obtenerHistoricoConsumoApp debe sumar correctamente todos los movimientos de un código dentro de un periodo personalizado, agrupar por mes y calcular promedios/movimientos/mes mayor-menor sin tocar ninguna hoja',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'HARINA DE TRIGO', codigo: 'COD-001', udm: 'KG', existencia: 500 })];
    const salida = [
      filaSalida(d(2026, 1, 5), 'COD-001', 'HARINA DE TRIGO', 20, 'KG', 'Cocina'),
      filaSalida(d(2026, 1, 20), 'COD-001', 'HARINA DE TRIGO', 15, 'KG', 'Cocina'),
      filaSalida(d(2026, 2, 10), 'COD-001', 'HARINA DE TRIGO', 30, 'KG', 'Panaderia'),
      filaSalida(d(2026, 3, 1), 'COD-001', 'HARINA DE TRIGO', 10, 'KG', 'Panaderia'),
      // Fuera del rango de la prueba (abril) — no debe contarse.
      filaSalida(d(2026, 4, 1), 'COD-001', 'HARINA DE TRIGO', 999, 'KG', 'Cocina'),
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerHistoricoConsumoApp', {
      codigo: 'COD-001', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-01-01', fechaHasta: '2026-03-31'
    }, token);

    return {
      datos: '4 salidas de enero a marzo (Enero:20+15=35, Febrero:30, Marzo:10 => total 75kg) + 1 salida en abril (999kg) fuera del rango',
      esperado: 'consumoTotal=75, numeroMovimientos=4, 3 meses en consumoMensual, mesMayorConsumo=Enero (35), mesMenorConsumo=Marzo (10), promedioMensual=25',
      obtenido: `total=${resultado.resumen.consumoTotal}, movimientos=${resultado.resumen.numeroMovimientos}, meses=${resultado.resumen.consumoMensual.length}, mayor=${resultado.resumen.mesMayorConsumo.etiqueta}(${resultado.resumen.mesMayorConsumo.consumo}), menor=${resultado.resumen.mesMenorConsumo.etiqueta}(${resultado.resumen.mesMenorConsumo.consumo}), promedioMensual=${resultado.resumen.promedioMensual}`,
      pasa: resultado.resumen.consumoTotal === 75 && resultado.resumen.numeroMovimientos === 4 &&
        resultado.resumen.consumoMensual.length === 3 &&
        resultado.resumen.mesMayorConsumo.consumo === 35 && resultado.resumen.mesMenorConsumo.consumo === 10 &&
        resultado.resumen.promedioMensual === 25,
    };
  },
});

// ============================================
// Caso 2 — producto sin movimientos
// ============================================
prueba({
  id: 'HCO-002', grupo: 'consumo', nombre: 'Producto sin movimientos en el periodo devuelve resumen en ceros, no un error', metodo: 'EMPÍRICO',
  objetivo: 'Un código válido en MATRIZ pero sin ninguna fila en SALIDA (o sin ninguna dentro del periodo pedido) debe devolver un resumen completo en 0, sin lanzar excepción ni dividir entre cero',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'PRODUCTO SIN MOVIMIENTOS', codigo: 'COD-002', udm: 'PZ', existencia: 10 })];
    const { entorno, token } = entornoConSalida(matriz, []);

    let error = null, resultado = null;
    try {
      resultado = entorno.invocar('obtenerHistoricoConsumoApp', {
        codigo: 'COD-002', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-01-01', fechaHasta: '2026-12-31'
      }, token);
    } catch (e) { error = e.message; }

    return {
      datos: 'COD-002 existe en MATRIZ, SALIDA está vacía',
      esperado: 'No lanza error; consumoTotal=0, numeroMovimientos=0, mesMayorConsumo=null, promedioDiario=0 (no NaN/Infinity)',
      obtenido: error ? `ERROR: ${error}` : `total=${resultado.resumen.consumoTotal}, movimientos=${resultado.resumen.numeroMovimientos}, mesMayor=${resultado.resumen.mesMayorConsumo}, promedioDiario=${resultado.resumen.promedioDiario}`,
      pasa: !error && resultado.resumen.consumoTotal === 0 && resultado.resumen.numeroMovimientos === 0 &&
        resultado.resumen.mesMayorConsumo === null && Number.isFinite(resultado.resumen.promedioDiario),
    };
  },
});

// ============================================
// Caso 3 — código inexistente
// ============================================
prueba({
  id: 'HCO-003', grupo: 'consumo', nombre: 'Código inexistente en MATRIZ se rechaza con un mensaje claro', metodo: 'EMPÍRICO',
  objetivo: 'obtenerHistoricoConsumoApp no debe intentar construir un reporte para un código que no existe en el catálogo — debe lanzar un error explícito',
  ejecutar() {
    const { entorno, token } = entornoConSalida([], []);
    let bloqueado = false, mensaje = '';
    try {
      entorno.invocar('obtenerHistoricoConsumoApp', { codigo: 'NO-EXISTE-999', periodoPreset: 'ULTIMOS_30' }, token);
    } catch (e) { bloqueado = true; mensaje = e.message; }
    return {
      datos: 'código "NO-EXISTE-999" no está en MATRIZ',
      esperado: 'bloqueado con mensaje que menciona que no se encontró el producto',
      obtenido: `bloqueado=${bloqueado}, mensaje="${mensaje}"`,
      pasa: bloqueado && /no se encontr/i.test(mensaje),
    };
  },
});

// ============================================
// Caso 4 — distintas áreas
// ============================================
prueba({
  id: 'HCO-004', grupo: 'consumo', nombre: 'Filtrar por área y desglose de consumo por área con porcentajes', metodo: 'EMPÍRICO',
  objetivo: 'El filtro de área debe limitarse a esa área exacta (normalizada), y consumoPorArea debe repartir el 100% correctamente entre las áreas reales que aparecen en SALIDA (sin hardcodear Cocina/Panadería/Repostería)',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'AZUCAR', codigo: 'COD-004', udm: 'KG', existencia: 200 })];
    const salida = [
      filaSalida(d(2026, 5, 1), 'COD-004', 'AZUCAR', 60, 'KG', 'Cocina'),
      filaSalida(d(2026, 5, 2), 'COD-004', 'AZUCAR', 30, 'KG', 'Almacen Central'), // área NO hardcodeada en ningún <select>
      filaSalida(d(2026, 5, 3), 'COD-004', 'AZUCAR', 10, 'KG', 'cocina'), // minúsculas: debe agruparse con "Cocina"
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const areas = entorno.invocar('obtenerAreasSalidaApp', token);
    const soloCocina = entorno.invocar('obtenerHistoricoConsumoApp', {
      codigo: 'COD-004', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-05-01', fechaHasta: '2026-05-31', area: 'Cocina'
    }, token);
    const todas = entorno.invocar('obtenerHistoricoConsumoApp', {
      codigo: 'COD-004', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-05-01', fechaHasta: '2026-05-31'
    }, token);

    const areaAlmacen = todas.consumoPorArea.find(a => a.area === 'Almacen Central');

    return {
      datos: 'Cocina=60, Almacen Central=30, cocina(minúscula)=10',
      esperado: 'obtenerAreasSalidaApp devuelve 2 áreas (Cocina + Almacen Central, unificando mayúsculas/minúsculas). Filtrando por "Cocina" suma 70 (60+10, normalizado). Sin filtro, Almacen Central pesa 30% del total (30/100)',
      obtenido: `areas=${JSON.stringify(areas)}, soloCocina.consumoTotal=${soloCocina.resumen.consumoTotal}, almacenCentral%=${areaAlmacen ? areaAlmacen.porcentaje : 'ausente'}`,
      pasa: areas.length === 2 && soloCocina.resumen.consumoTotal === 70 &&
        !!areaAlmacen && areaAlmacen.consumo === 30 && areaAlmacen.porcentaje === 30,
    };
  },
});

// ============================================
// Caso 6 — presentación con conversión: NO se debe multiplicar
// ============================================
prueba({
  id: 'HCO-005', grupo: 'consumo', nombre: 'Un producto con Convertir=SI/Presentación en MATRIZ NO multiplica el consumo — SALIDA.Cantidad ya está en UDM base', metodo: 'EMPÍRICO',
  objetivo: 'Esta es la regla central del módulo: aunque el producto se compre por presentación (ej. Salsa Morita, caja de 2kg), la cantidad registrada en SALIDA ya es la cantidad real consumida en su UDM — multiplicarla por Presentación duplicaría el consumo, el mismo error que ya se corrigió del lado de costeo (K×R×T) pero aplicado a cantidades',
  ejecutar() {
    const matriz = [filaProducto({
      producto: 'SALSA MORITA', codigo: 'COD-006', udm: 'KG', existencia: 100,
      convertir: 'SI', presentacion: 2, // se compra en cajas de 2 kg — NO debe afectar el consumo
    })];
    const salida = [
      filaSalida(d(2026, 6, 1), 'COD-006', 'SALSA MORITA', 4, 'KG', 'Cocina'), // 4 kg reales, NO "4 piezas de 2kg"
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerHistoricoConsumoApp', {
      codigo: 'COD-006', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-06-01', fechaHasta: '2026-06-30'
    }, token);

    return {
      datos: 'SALSA MORITA: Convertir=SI, Presentación=2kg, 1 salida de 4 (kg)',
      esperado: 'consumoTotal=4 (NUNCA 8 — no se multiplica por la Presentación de 2)',
      obtenido: `consumoTotal=${resultado.resumen.consumoTotal}`,
      pasa: resultado.resumen.consumoTotal === 4,
    };
  },
});

// ============================================
// Caso 7 — producto con UDM diferente entre movimientos
// ============================================
prueba({
  id: 'HCO-006', grupo: 'consumo', nombre: 'Movimientos con UDM distinta a la actual de MATRIZ se excluyen y se avisa "conversión no disponible"', metodo: 'EMPÍRICO',
  objetivo: 'No se debe inventar un factor de conversión entre UDM distintas (ej. si históricamente hubo capturas en "PZA" y el producto hoy es "KG") — se debe advertir y excluir esos movimientos del cálculo, usando solo los que coinciden con la UDM actual',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'QUESO', codigo: 'COD-007', udm: 'KG', existencia: 50 })];
    const salida = [
      filaSalida(d(2026, 7, 1), 'COD-007', 'QUESO', 5, 'KG', 'Cocina'),
      filaSalida(d(2026, 7, 2), 'COD-007', 'QUESO', 3, 'PZA', 'Cocina'), // UDM distinta a la actual del producto
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerHistoricoConsumoApp', {
      codigo: 'COD-007', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-07-01', fechaHasta: '2026-07-31'
    }, token);

    return {
      datos: '1 salida en KG (5) + 1 salida en PZA (3) para el mismo código, UDM actual del producto = KG',
      esperado: 'conversionDisponible=false, consumoTotal=5 (solo la fila en KG), movimientosExcluidosPorUdm=1, hay una advertencia mencionando "Conversión no disponible"',
      obtenido: `conversionDisponible=${resultado.conversionDisponible}, consumoTotal=${resultado.resumen.consumoTotal}, excluidos=${resultado.movimientosExcluidosPorUdm}, advertencias=${JSON.stringify(resultado.advertencias)}`,
      pasa: resultado.conversionDisponible === false && resultado.resumen.consumoTotal === 5 &&
        resultado.movimientosExcluidosPorUdm === 1 &&
        resultado.advertencias.some(a => /conversi[oó]n no disponible/i.test(a)),
    };
  },
});

// ============================================
// Caso 8 — datos incompletos (cantidades vacías/0/negativas)
// ============================================
prueba({
  id: 'HCO-007', grupo: 'consumo', nombre: 'Cantidades vacías, en 0 o negativas no se suman como consumo ni cuentan como movimiento válido', metodo: 'EMPÍRICO',
  objetivo: 'Un dato corrupto o un ajuste con cantidad negativa en SALIDA no debe inflar ni distorsionar el consumo real — se excluye del total y se reporta aparte cuántos se excluyeron',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'ACEITE', codigo: 'COD-008', udm: 'L', existencia: 80 })];
    const salida = [
      filaSalida(d(2026, 8, 1), 'COD-008', 'ACEITE', 10, 'L', 'Cocina'),
      filaSalida(d(2026, 8, 2), 'COD-008', 'ACEITE', '', 'L', 'Cocina'),   // vacío
      filaSalida(d(2026, 8, 3), 'COD-008', 'ACEITE', 0, 'L', 'Cocina'),    // cero
      filaSalida(d(2026, 8, 4), 'COD-008', 'ACEITE', -5, 'L', 'Cocina'),   // negativo
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerHistoricoConsumoApp', {
      codigo: 'COD-008', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-08-01', fechaHasta: '2026-08-31'
    }, token);

    return {
      datos: '1 salida válida (10L) + vacío + 0 + -5',
      esperado: 'consumoTotal=10, numeroMovimientos=1, movimientosConCantidadInvalida=3',
      obtenido: `total=${resultado.resumen.consumoTotal}, movimientos=${resultado.resumen.numeroMovimientos}, invalidos=${resultado.resumen.movimientosConCantidadInvalida}`,
      pasa: resultado.resumen.consumoTotal === 10 && resultado.resumen.numeroMovimientos === 1 &&
        resultado.resumen.movimientosConCantidadInvalida === 3,
    };
  },
});

// ============================================
// Caso 9 — fechas inválidas
// ============================================
prueba({
  id: 'HCO-008', grupo: 'consumo', nombre: 'Movimientos con fecha inválida se excluyen sin romper el reporte, y se avisa', metodo: 'EMPÍRICO',
  objetivo: 'Una fila de SALIDA con una fecha corrupta (texto no parseable) no debe tronar el cálculo — se excluye y se informa cuántas se excluyeron',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'SAL', codigo: 'COD-009', udm: 'KG', existencia: 40 })];
    const salida = [
      filaSalida(d(2026, 9, 1), 'COD-009', 'SAL', 8, 'KG', 'Cocina'),
      ['2026', '', 'FECHA-CORRUPTA', 'COD-009', 'SAL', 6, 'KG', 'Cocina', '', '', ''], // fecha no parseable
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    let error = null, resultado = null;
    try {
      resultado = entorno.invocar('obtenerHistoricoConsumoApp', {
        codigo: 'COD-009', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-09-01', fechaHasta: '2026-09-30'
      }, token);
    } catch (e) { error = e.message; }

    return {
      datos: '1 salida válida (8kg, fecha real) + 1 fila con fecha corrupta (6kg)',
      esperado: 'No truena; consumoTotal=8 (la fila corrupta se excluye), hay una advertencia mencionando la fecha inválida',
      obtenido: error ? `ERROR: ${error}` : `total=${resultado.resumen.consumoTotal}, advertencias=${JSON.stringify(resultado.advertencias)}`,
      pasa: !error && resultado.resumen.consumoTotal === 8 &&
        resultado.advertencias.some(a => /fecha inv[aá]lida/i.test(a)),
    };
  },
});

// ============================================
// Caso 9b — el propio filtro de fechas rechaza fechas inválidas
// ============================================
prueba({
  id: 'HCO-009', grupo: 'consumo', nombre: 'Un periodo personalizado con fechas mal formadas o invertidas se rechaza con error claro', metodo: 'EMPÍRICO',
  objetivo: 'resolverRangoFechas_ (vía obtenerHistoricoConsumoApp) no debe inventar un rango cuando el usuario captura basura o invierte desde/hasta',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'PIMIENTA', codigo: 'COD-010', udm: 'KG', existencia: 5 })];
    const { entorno, token } = entornoConSalida(matriz, []);

    let bloqueadoTextoInvalido = false, bloqueadoInvertido = false;
    try {
      entorno.invocar('obtenerHistoricoConsumoApp', { codigo: 'COD-010', periodoPreset: 'PERSONALIZADO', fechaDesde: 'no-es-fecha', fechaHasta: '2026-01-31' }, token);
    } catch (e) { bloqueadoTextoInvalido = true; }
    try {
      entorno.invocar('obtenerHistoricoConsumoApp', { codigo: 'COD-010', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-06-01', fechaHasta: '2026-01-01' }, token);
    } catch (e) { bloqueadoInvertido = true; }

    return {
      datos: 'fechaDesde="no-es-fecha" / fechaDesde posterior a fechaHasta',
      esperado: 'ambos casos lanzan error, ninguno regresa un reporte con datos inventados',
      obtenido: `bloqueadoTextoInvalido=${bloqueadoTextoInvalido}, bloqueadoInvertido=${bloqueadoInvertido}`,
      pasa: bloqueadoTextoInvalido && bloqueadoInvertido,
    };
  },
});

// ============================================
// Caso 10 — distintos roles de usuario
// ============================================
prueba({
  id: 'HCO-010', grupo: 'consumo', nombre: 'Cualquier rol con sesión activa puede consultar el histórico; sin sesión válida se bloquea', metodo: 'EMPÍRICO',
  objetivo: 'obtenerHistoricoConsumoApp usa requerirSesionActivaApp_, el mismo guard que ya usan Análisis de Costos/Análisis de Compras (solo exige sesión válida — la restricción por rol vive en qué botones ve cada quien en el sidebar, no en el backend). Se confirma que ADMIN, SUPERVISOR, OPERADOR y CONSULTA pueden consultar, y que un token inválido se bloquea',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'CANELA', codigo: 'COD-011', udm: 'KG', existencia: 3 })];
    const salida = [filaSalida(d(2026, 10, 1), 'COD-011', 'CANELA', 1, 'KG', 'Cocina')];
    const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: [encabezadoMatriz()].concat(matriz), SALIDA: [encabezadoSalida()].concat(salida) }) });

    const roles = ['ADMIN', 'SUPERVISOR', 'OPERADOR', 'CONSULTA'];
    const resultadosPorRol = {};
    roles.forEach(function(rol){
      const token = entorno.invocar('crearSesion_', rol.toLowerCase() + '@tagers.com', 'Usuario ' + rol, rol);
      try {
        const r = entorno.invocar('obtenerHistoricoConsumoApp', { codigo: 'COD-011', periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-10-01', fechaHasta: '2026-10-31' }, token);
        resultadosPorRol[rol] = r.resumen.consumoTotal;
      } catch (e) { resultadosPorRol[rol] = 'ERROR: ' + e.message; }
    });

    let bloqueadoSinToken = false;
    try { entorno.invocar('obtenerHistoricoConsumoApp', { codigo: 'COD-011' }, 'token-invalido-xyz'); } catch (e) { bloqueadoSinToken = true; }

    return {
      datos: 'Mismo código consultado con sesión ADMIN/SUPERVISOR/OPERADOR/CONSULTA, y con un token inválido',
      esperado: 'Los 4 roles obtienen consumoTotal=1 (todos con sesión válida pueden consultar); el token inválido se bloquea',
      obtenido: `porRol=${JSON.stringify(resultadosPorRol)}, bloqueadoSinToken=${bloqueadoSinToken}`,
      pasa: roles.every(rol => resultadosPorRol[rol] === 1) && bloqueadoSinToken,
    };
  },
});

// ============================================
// Extra — Top de productos más consumidos (agrupado por código, no por nombre)
// ============================================
prueba({
  id: 'HCO-011', grupo: 'consumo', nombre: 'obtenerTopProductosConsumidosApp agrupa por código (nunca por nombre) y ordena de mayor a menor consumo', metodo: 'EMPÍRICO',
  objetivo: 'Dos productos con el mismo nombre pero código distinto NO deben mezclarse en el top — la agrupación es siempre por código',
  ejecutar() {
    const matriz = [
      filaProducto({ producto: 'HARINA', codigo: 'COD-A', udm: 'KG', existencia: 100 }),
      filaProducto({ producto: 'HARINA', codigo: 'COD-B', udm: 'KG', existencia: 100 }), // mismo nombre, código distinto
    ];
    const salida = [
      filaSalida(d(2026, 11, 1), 'COD-A', 'HARINA', 50, 'KG', 'Cocina'),
      filaSalida(d(2026, 11, 2), 'COD-B', 'HARINA', 20, 'KG', 'Cocina'),
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const top = entorno.invocar('obtenerTopProductosConsumidosApp', { periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-11-01', fechaHasta: '2026-11-30' }, token);
    const a = top.find(p => p.codigo === 'COD-A');
    const b = top.find(p => p.codigo === 'COD-B');

    return {
      datos: 'COD-A "HARINA" consumo=50, COD-B "HARINA" (mismo nombre) consumo=20',
      esperado: '2 filas separadas por código (no 1 fila fusionada de 70), COD-A primero por mayor consumo',
      obtenido: `total=${top.length}, a=${a ? a.consumoTotal : 'ausente'}, b=${b ? b.consumoTotal : 'ausente'}, orden=${top.map(p => p.codigo).join(',')}`,
      pasa: top.length === 2 && !!a && !!b && a.consumoTotal === 50 && b.consumoTotal === 20 && top[0].codigo === 'COD-A',
    };
  },
});

// ============================================
// Dashboard de consumo — "AUTORIZO IMPLEMENTAR" (mejora futura del pedido original)
// ============================================

prueba({
  id: 'HCO-012', grupo: 'consumo', nombre: 'obtenerDashboardConsumoApp agrega el consumo de TODO el almacén en $ (mes y área) y arma el top de productos en su propia UDM', metodo: 'EMPÍRICO',
  objetivo: 'El dashboard debe sumar en $ (cantidad × costoUnitarioReal de cada producto) el gasto mensual y por área, porque no se pueden sumar kg+L+pz de productos distintos en una sola cifra, mientras que el top de productos se muestra en cantidad (UDM propia de cada uno, nunca mezclada)',
  ejecutar() {
    const matriz = [
      filaProducto({ producto: 'HARINA', codigo: 'COD-D1', udm: 'KG', existencia: 100, costo: 10 }),
      filaProducto({ producto: 'ACEITE', codigo: 'COD-D2', udm: 'L', existencia: 100, costo: 30 }),
    ];
    const salida = [
      filaSalida(d(2026, 3, 5), 'COD-D1', 'HARINA', 20, 'KG', 'Cocina'),   // $200
      filaSalida(d(2026, 3, 10), 'COD-D2', 'ACEITE', 5, 'L', 'Panaderia'), // $150
      filaSalida(d(2026, 4, 1), 'COD-D1', 'HARINA', 10, 'KG', 'Cocina'),   // $100
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerDashboardConsumoApp', {
      periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-03-01', fechaHasta: '2026-04-30'
    }, token);

    const marzo = resultado.consumoMensualValor.find(m => m.mes === 3);
    const abril = resultado.consumoMensualValor.find(m => m.mes === 4);
    const cocina = resultado.consumoPorArea.find(a => a.area === 'Cocina');
    const panaderia = resultado.consumoPorArea.find(a => a.area === 'Panaderia');
    const topD1 = resultado.topProductos.find(p => p.codigo === 'COD-D1');

    return {
      datos: 'HARINA ($10/kg): 20kg en marzo + 10kg en abril; ACEITE ($30/L): 5L en marzo',
      esperado: 'valorConsumoTotal=450, marzo=$350, abril=$100, Cocina=$300 (200+100), Panaderia=$150, top: COD-D1 con 30kg (20+10, en su propia UDM, nunca sumado con litros)',
      obtenido: `total=${resultado.resumen.valorConsumoTotal}, marzo=${marzo ? marzo.valor : 'ausente'}, abril=${abril ? abril.valor : 'ausente'}, cocina=${cocina ? cocina.valor : 'ausente'}, panaderia=${panaderia ? panaderia.valor : 'ausente'}, topD1=${topD1 ? topD1.consumoTotal + topD1.udm : 'ausente'}`,
      pasa: resultado.resumen.valorConsumoTotal === 450 &&
        !!marzo && marzo.valor === 350 && !!abril && abril.valor === 100 &&
        !!cocina && cocina.valor === 300 && !!panaderia && panaderia.valor === 150 &&
        !!topD1 && topD1.consumoTotal === 30 && topD1.udm === 'KG',
    };
  },
});

prueba({
  id: 'HCO-013', grupo: 'consumo', nombre: 'Un producto con Convertir=SI/Presentación no duplica su aporte en $ al dashboard (misma regla que el costeo real)', metodo: 'EMPÍRICO',
  objetivo: 'obtenerDashboardConsumoApp reutiliza obtenerCostoUnitarioReal_ tal cual — el valor en $ debe ser cantidad × costo unitario ya normalizado, sin volver a multiplicar por Presentación',
  ejecutar() {
    const matriz = [filaProducto({
      producto: 'SALSA MORITA', codigo: 'COD-D3', udm: 'KG', existencia: 100, costo: 90,
      convertir: 'SI', presentacion: 2, // caja de 2kg — no debe afectar el $ del consumo
    })];
    const salida = [filaSalida(d(2026, 5, 1), 'COD-D3', 'SALSA MORITA', 4, 'KG', 'Cocina')]; // 4kg reales
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerDashboardConsumoApp', {
      periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-05-01', fechaHasta: '2026-05-31'
    }, token);

    return {
      datos: 'SALSA MORITA: costo=$90/kg, Convertir=SI, Presentación=2kg, 1 salida de 4kg',
      esperado: 'valorConsumoTotal=360 (4×90 — NUNCA 4×90×2=720)',
      obtenido: `valorConsumoTotal=${resultado.resumen.valorConsumoTotal}`,
      pasa: resultado.resumen.valorConsumoTotal === 360,
    };
  },
});

prueba({
  id: 'HCO-014', grupo: 'consumo', nombre: 'Productos sin costo capturado no aportan $ a los totales del dashboard, pero sí cuentan en su propio ranking de cantidad', metodo: 'EMPÍRICO',
  objetivo: 'No se debe inventar un valor monetario para un producto sin costo en MATRIZ (costo=0) — se excluye de mes/área/total en $ y se informa cuántos productos/movimientos quedaron así, sin bloquear el resto del dashboard',
  ejecutar() {
    const matriz = [
      filaProducto({ producto: 'HARINA', codigo: 'COD-D4', udm: 'KG', existencia: 100, costo: 10 }),
      filaProducto({ producto: 'SERVILLETAS', codigo: 'COD-D5', udm: 'PZ', existencia: 500, costo: 0 }), // sin costo capturado
    ];
    const salida = [
      filaSalida(d(2026, 6, 1), 'COD-D4', 'HARINA', 5, 'KG', 'Cocina'),       // $50
      filaSalida(d(2026, 6, 2), 'COD-D5', 'SERVILLETAS', 40, 'PZ', 'Cocina'), // sin costo
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerDashboardConsumoApp', {
      periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-06-01', fechaHasta: '2026-06-30'
    }, token);

    const topD5 = resultado.topProductos.find(p => p.codigo === 'COD-D5');

    return {
      datos: 'HARINA con costo (5kg×$10=$50) + SERVILLETAS sin costo capturado (40pz)',
      esperado: 'valorConsumoTotal=50 (solo HARINA), resumen.productosSinCosto=1, resumen.movimientosSinCosto=1, pero SERVILLETAS sigue apareciendo en topProductos con 40pz',
      obtenido: `total=${resultado.resumen.valorConsumoTotal}, productosSinCosto=${resultado.resumen.productosSinCosto}, movimientosSinCosto=${resultado.resumen.movimientosSinCosto}, topD5=${topD5 ? topD5.consumoTotal : 'ausente'}`,
      pasa: resultado.resumen.valorConsumoTotal === 50 && resultado.resumen.productosSinCosto === 1 &&
        resultado.resumen.movimientosSinCosto === 1 && !!topD5 && topD5.consumoTotal === 40,
    };
  },
});

prueba({
  id: 'HCO-015', grupo: 'consumo', nombre: 'El filtro de área del dashboard limita mes/área/top a esa área exacta (normalizada)', metodo: 'EMPÍRICO',
  objetivo: 'Igual que en obtenerHistoricoConsumoApp, el filtro de área del dashboard debe normalizar mayúsculas/minúsculas y excluir del todo los movimientos de otras áreas de cualquier sección del dashboard',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'AZUCAR', codigo: 'COD-D6', udm: 'KG', existencia: 200, costo: 5 })];
    const salida = [
      filaSalida(d(2026, 7, 1), 'COD-D6', 'AZUCAR', 20, 'KG', 'Cocina'),
      filaSalida(d(2026, 7, 2), 'COD-D6', 'AZUCAR', 30, 'KG', 'Panaderia'),
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const soloCocina = entorno.invocar('obtenerDashboardConsumoApp', {
      periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-07-01', fechaHasta: '2026-07-31', area: 'cocina'
    }, token);

    return {
      datos: 'AZUCAR ($5/kg): 20kg en Cocina + 30kg en Panaderia, filtrando por area="cocina" (minúsculas)',
      esperado: 'valorConsumoTotal=100 (solo Cocina: 20×5), consumoPorArea con una sola fila (Cocina), top con 20kg',
      obtenido: `total=${soloCocina.resumen.valorConsumoTotal}, areas=${soloCocina.consumoPorArea.length}, topCantidad=${soloCocina.topProductos[0] ? soloCocina.topProductos[0].consumoTotal : 'ausente'}`,
      pasa: soloCocina.resumen.valorConsumoTotal === 100 && soloCocina.consumoPorArea.length === 1 &&
        soloCocina.topProductos.length === 1 && soloCocina.topProductos[0].consumoTotal === 20,
    };
  },
});

prueba({
  id: 'HCO-016', grupo: 'consumo', nombre: 'La tendencia del dashboard compara el $ del periodo actual contra el mismo número de días inmediatamente anterior', metodo: 'EMPÍRICO',
  objetivo: 'tendenciaPct debe calcularse en $ contra un periodo previo de la misma duración, igual criterio que ya usa obtenerHistoricoConsumoApp por producto — aquí agregado a nivel de todo el almacén',
  ejecutar() {
    const matriz = [filaProducto({ producto: 'HARINA', codigo: 'COD-D7', udm: 'KG', existencia: 100, costo: 10 })];
    const salida = [
      filaSalida(d(2026, 7, 25), 'COD-D7', 'HARINA', 10, 'KG', 'Cocina'), // periodo anterior (16-31 jul): $100
      filaSalida(d(2026, 8, 10), 'COD-D7', 'HARINA', 20, 'KG', 'Cocina'), // periodo actual (1-16 ago): $200
    ];
    const { entorno, token } = entornoConSalida(matriz, salida);

    const resultado = entorno.invocar('obtenerDashboardConsumoApp', {
      periodoPreset: 'PERSONALIZADO', fechaDesde: '2026-08-01', fechaHasta: '2026-08-16'
    }, token);

    return {
      datos: 'Periodo actual (1-16 ago, 16 días): $200. Periodo anterior de igual duración (16-31 jul): $100',
      esperado: 'valorPeriodoAnterior=100, tendenciaPct=100 (subió 100%)',
      obtenido: `valorConsumoTotal=${resultado.resumen.valorConsumoTotal}, valorPeriodoAnterior=${resultado.resumen.valorPeriodoAnterior}, tendenciaPct=${resultado.resumen.tendenciaPct}`,
      pasa: resultado.resumen.valorConsumoTotal === 200 && resultado.resumen.valorPeriodoAnterior === 100 && resultado.resumen.tendenciaPct === 100,
    };
  },
});
