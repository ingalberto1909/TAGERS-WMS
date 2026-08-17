'use strict';

/*
 * REPORTES (dashboard ejecutivo) — a diferencia de Inicio (operativo),
 * este junta valor de inventario agrupado por Categoría/Proveedor y
 * tendencia mensual (cantidad total movida, no productos distintos).
 * Ningún cálculo de valor nuevo: reusa calcularValorInventario_ y
 * obtenerValorInventarioApp tal cual — solo se agrega la agrupación.
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, filaProducto, encabezadoMatriz, ENCABEZADOS } = require('../lib/datos-prueba');

function matrizConCategorias() {
  const filas = [encabezadoMatriz()];
  const spec = [
    { producto: 'HARINA', codigo: 'COD-001', categoria: 'ABARROTES', proveedor: 'PROVEEDOR A', existencia: 10, costo: 20 },
    { producto: 'AZUCAR', codigo: 'COD-002', categoria: 'ABARROTES', proveedor: 'PROVEEDOR A', existencia: 5, costo: 10 },
    { producto: 'REFRESCO', codigo: 'COD-003', categoria: 'BEBIDAS', proveedor: 'PROVEEDOR B', existencia: 20, costo: 15 },
    { producto: 'SIN COSTO', codigo: 'COD-004', categoria: 'ABARROTES', proveedor: 'PROVEEDOR A', existencia: 8, costo: 0 },
    { producto: 'SIN EXISTENCIA', codigo: 'COD-005', categoria: 'BEBIDAS', proveedor: 'PROVEEDOR B', existencia: 0, costo: 50 },
  ];
  spec.forEach(s => {
    const fila = filaProducto({ producto: s.producto, codigo: s.codigo, existencia: s.existencia, costo: s.costo, ubicacion: 'A-01' });
    fila[2] = s.categoria;
    fila[16] = s.proveedor;
    filas.push(fila);
  });
  return filas;
}

prueba({
  id: 'REP-001', grupo: 'reportes', nombre: 'Valor por categoría agrupa y suma correctamente', metodo: 'EMPÍRICO',
  objetivo: 'obtenerReporteEjecutivoApp().valorPorCategoria debe agrupar MATRIZ por Categoría, sumando existencia×costo con la misma fórmula que el total general',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matrizConCategorias() }) });
    const rep = entorno.invocar('obtenerReporteEjecutivoApp');
    const abarrotes = rep.valorPorCategoria.find(g => g.nombre === 'ABARROTES');
    const bebidas = rep.valorPorCategoria.find(g => g.nombre === 'BEBIDAS');
    // ABARROTES: HARINA 10x20=200 + AZUCAR 5x10=50 = 250 (SIN COSTO se excluye, costo=0)
    // BEBIDAS: REFRESCO 20x15=300 (SIN EXISTENCIA se excluye, existencia=0)
    return {
      datos: 'ABARROTES: HARINA(10x20)+AZUCAR(5x10)+SIN COSTO(costo=0, excluido); BEBIDAS: REFRESCO(20x15)+SIN EXISTENCIA(existencia=0, excluido)',
      esperado: 'ABARROTES.valor=250 (2 productos), BEBIDAS.valor=300 (1 producto)',
      obtenido: `ABARROTES=${abarrotes && abarrotes.valor} (${abarrotes && abarrotes.productos} prod), BEBIDAS=${bebidas && bebidas.valor} (${bebidas && bebidas.productos} prod)`,
      pasa: !!abarrotes && abarrotes.valor === 250 && abarrotes.productos === 2 && !!bebidas && bebidas.valor === 300 && bebidas.productos === 1,
    };
  },
});

prueba({
  id: 'REP-002', grupo: 'reportes', nombre: 'Valor por proveedor usa la misma agrupación con otra columna', metodo: 'EMPÍRICO',
  objetivo: 'obtenerReporteEjecutivoApp().valorPorProveedor debe agrupar por Proveedor (columna distinta a Categoría), mismos números fuente',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matrizConCategorias() }) });
    const rep = entorno.invocar('obtenerReporteEjecutivoApp');
    const provA = rep.valorPorProveedor.find(g => g.nombre === 'PROVEEDOR A');
    const provB = rep.valorPorProveedor.find(g => g.nombre === 'PROVEEDOR B');
    return {
      datos: 'PROVEEDOR A = HARINA+AZUCAR (250), PROVEEDOR B = REFRESCO (300)',
      esperado: 'PROVEEDOR A.valor=250, PROVEEDOR B.valor=300',
      obtenido: `A=${provA && provA.valor}, B=${provB && provB.valor}`,
      pasa: !!provA && provA.valor === 250 && !!provB && provB.valor === 300,
    };
  },
});

prueba({
  id: 'REP-003', grupo: 'reportes', nombre: 'Más de 8 grupos se recortan a Top 7 + "Otros"', metodo: 'EMPÍRICO',
  objetivo: 'obtenerValorInventarioAgrupadoApp_ no debe devolver una gráfica ilegible con muchas categorías — top 7 por valor + 1 bucket "Otros" agregado',
  ejecutar() {
    const filas = [encabezadoMatriz()];
    for (let i = 1; i <= 10; i++) {
      const fila = filaProducto({ producto: 'PRODUCTO ' + i, codigo: 'COD-' + i, existencia: 1, costo: i, ubicacion: 'A-01' });
      fila[2] = 'CATEGORIA-' + i; // 10 categorías distintas, valor = i (1..10)
      filas.push(fila);
    }
    const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: filas }) });
    const rep = entorno.invocar('obtenerReporteEjecutivoApp');
    const otros = rep.valorPorCategoria.find(g => g.nombre.startsWith('Otros'));
    return {
      datos: '10 categorías con valores 1..10',
      esperado: '8 grupos en total (7 top + 1 "Otros" con las 3 más chicas: valores 1+2+3=6)',
      obtenido: `total=${rep.valorPorCategoria.length}, otros=${otros ? otros.valor : '(no encontrado)'}`,
      pasa: rep.valorPorCategoria.length === 8 && !!otros && otros.valor === 6,
    };
  },
});

prueba({
  id: 'REP-004', grupo: 'reportes', nombre: 'Tendencia mensual suma CANTIDAD total, no productos distintos', metodo: 'EMPÍRICO',
  objetivo: 'obtenerTendenciaMensualApp debe sumar la columna Entrada/Salida de KARDEX por mes (2 entradas del mismo código en el mismo mes se suman, no se cuentan como 1)',
  ejecutar() {
    const hoy = new Date();
    const kardex = [
      ENCABEZADOS.KARDEX,
      [hoy, '', 'ENTRADA', 'F1', 'COD-001', 'HARINA', 30, '', 0, 30, 'Admin', ''],
      [hoy, '', 'ENTRADA', 'F2', 'COD-001', 'HARINA', 20, '', 30, 50, 'Admin', ''],
      [hoy, '', 'SALIDA', 'F3', 'COD-002', 'AZUCAR', '', 15, 50, 35, 'Admin', ''],
    ];
    const entorno = crearEntorno({ hojas: hojasBase({ KARDEX: kardex }) });
    const rep = entorno.invocar('obtenerReporteEjecutivoApp');
    const ultimoMes = rep.tendenciaMensual.entradas.length - 1;
    return {
      datos: '2 entradas del mismo código (30+20) y 1 salida (15) en el mes actual',
      esperado: 'mes actual: entradas=50 (suma, no cuenta), salidas=15',
      obtenido: `entradas=${rep.tendenciaMensual.entradas[ultimoMes]}, salidas=${rep.tendenciaMensual.salidas[ultimoMes]}, labels=${rep.tendenciaMensual.labels.length}`,
      pasa: rep.tendenciaMensual.entradas[ultimoMes] === 50 && rep.tendenciaMensual.salidas[ultimoMes] === 15 && rep.tendenciaMensual.labels.length === 6,
    };
  },
});

prueba({
  id: 'REP-005', grupo: 'reportes', nombre: 'Tendencia mensual ubica un movimiento viejo en su propio mes, no en el actual', metodo: 'EMPÍRICO',
  objetivo: 'obtenerTendenciaMensualApp debe ubicar cada movimiento por su fecha real dentro de la ventana de 6 meses, no sumarlo todo al mes en curso',
  ejecutar() {
    const hoy = new Date();
    const hace2Meses = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 10);
    const fueraDeVentana = new Date(hoy.getFullYear(), hoy.getMonth() - 9, 10); // 9 meses atrás, fuera de la ventana de 6
    const kardex = [
      ENCABEZADOS.KARDEX,
      [hace2Meses, '', 'ENTRADA', 'F1', 'COD-001', 'HARINA', 40, '', 0, 40, 'Admin', ''],
      [fueraDeVentana, '', 'ENTRADA', 'F2', 'COD-001', 'HARINA', 999, '', 0, 999, 'Admin', ''],
    ];
    const entorno = crearEntorno({ hojas: hojasBase({ KARDEX: kardex }) });
    const rep = entorno.invocar('obtenerTendenciaMensualApp');
    const idxHace2Meses = rep.entradas.length - 1 - 2;
    const sumaTotal = rep.entradas.reduce((a,b) => a+b, 0);
    return {
      datos: 'un movimiento hace 2 meses (40) dentro de la ventana, otro hace 9 meses (999) fuera de la ventana de 6 meses',
      esperado: `la posición de "hace 2 meses" = 40, y el de 999 NO aparece en ningún mes (suma total = 40)`,
      obtenido: `entradas[hace2Meses]=${rep.entradas[idxHace2Meses]}, sumaTotal=${sumaTotal}`,
      pasa: rep.entradas[idxHace2Meses] === 40 && sumaTotal === 40,
    };
  },
});

prueba({
  id: 'REP-006', grupo: 'reportes', nombre: 'El total general y la suma de grupos coinciden', metodo: 'EMPÍRICO',
  objetivo: 'La suma de valorPorCategoria (sin recorte Top7, catálogo chico) debe coincidir con obtenerValorInventarioApp().total — misma fórmula, sin duplicar ni perder valor al agrupar',
  ejecutar() {
    const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matrizConCategorias() }) });
    const rep = entorno.invocar('obtenerReporteEjecutivoApp');
    const sumaCategorias = rep.valorPorCategoria.reduce((a,g) => a + g.valor, 0);
    return {
      datos: 'mismo MATRIZ de prueba (250 ABARROTES + 300 BEBIDAS = 550)',
      esperado: `valorInventario.total (${rep.valorInventario.total}) === suma de valorPorCategoria (${sumaCategorias})`,
      obtenido: `total=${rep.valorInventario.total}, sumaGrupos=${sumaCategorias}`,
      pasa: rep.valorInventario.total === sumaCategorias && rep.valorInventario.total === 550,
    };
  },
});
