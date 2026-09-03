'use strict';

/*
 * Mapa del Almacén (?page=mapa, MapaAlmacenV3.html) — el usuario reportó
 * (con captura real) que la pantalla se quedaba pegada en "Cargando
 * racks..." sin terminar nunca. Causa: obtenerResumenRacks,
 * obtenerUbicacionesRack y buscarProducto (Código.gs) leían MATRIZ
 * completa con getRange().getValues() SIN la caché de 20s que ya usa el
 * resto del sistema (obtenerFilasHojaCacheadas_) — el mismo patrón que
 * ya se había corregido antes en obtenerResumenInicioMovilApp. Estas
 * pruebas fijan el comportamiento correcto tras usar la caché, no solo
 * el rendimiento (que no es medible en este emulador en memoria).
 */

const { prueba } = require('../lib/runner');
const { crearEntorno } = require('../lib/cargar-backend');
const { hojasBase, filaProducto, encabezadoMatriz } = require('../lib/datos-prueba');

function entornoConMapa() {
  const filaConNivel = filaProducto({ producto: 'HARINA DE TRIGO', codigo: 'COD-001', rack: 'R01', ubicacion: 'R01-N01-P01', existencia: 100, minimo: 10, maximo: 200 });
  filaConNivel[7] = 'N01'; // Nivel (columna H) — filaProducto no lo expone como parámetro
  filaConNivel[8] = 'P01'; // Posición (columna I) — idem

  const matriz = [
    encabezadoMatriz(),
    filaConNivel,
    filaProducto({ producto: 'AZUCAR ESTANDAR', codigo: 'COD-002', rack: 'R02', ubicacion: 'R02-N02-P01', existencia: 3, minimo: 10, maximo: 100 }),
    filaProducto({ producto: 'SAL DE MESA', codigo: 'COD-003', rack: 'R02', ubicacion: 'R02-N03-P02', existencia: 0, minimo: 5, maximo: 80 }),
  ];
  const entorno = crearEntorno({ hojas: hojasBase({ MATRIZ: matriz }) });
  const token = entorno.invocar('crearSesion_', 'admin@tagers.com', 'Admin', 'ADMIN');
  return { entorno, token };
}

prueba({
  id: 'MAPA-001', grupo: 'inventario', nombre: 'obtenerResumenRacks agrupa por rack y cuenta bajo mínimo/agotados igual que antes de usar la caché',
  metodo: 'EMPÍRICO',
  objetivo: 'Verificar que leer MATRIZ vía obtenerFilasHojaCacheadas_ (en vez de getRange().getValues() directo) no cambia el resultado: R01 (1 producto óptimo), R02 (1 bajo mínimo, 1 agotado)',
  ejecutar() {
    const { entorno, token } = entornoConMapa();
    const racks = entorno.invocar('obtenerResumenRacks', token);
    const porRack = {};
    racks.forEach(r => { porRack[r.rack] = r; });

    return {
      datos: 'R01: COD-001 (existencia=100, óptimo); R02: COD-002 (bajo mínimo) y COD-003 (agotado)',
      esperado: 'R01: productos=1 bajoMinimo=0 agotados=0; R02: productos=2 bajoMinimo=1 agotados=1',
      obtenido: JSON.stringify(racks),
      pasa: porRack.R01 && porRack.R01.productos === 1 && porRack.R01.bajoMinimo === 0 && porRack.R01.agotados === 0
        && porRack.R02 && porRack.R02.productos === 2 && porRack.R02.bajoMinimo === 1 && porRack.R02.agotados === 1,
    };
  },
});

prueba({
  id: 'MAPA-002', grupo: 'inventario', nombre: 'obtenerUbicacionesRack agrupa productos por nivel-posición dentro de un rack',
  metodo: 'EMPÍRICO',
  objetivo: 'Pedir el rack R01 debe regresar la ubicación N01-P01 con COD-001 dentro, usando la misma lectura cacheada',
  ejecutar() {
    const { entorno, token } = entornoConMapa();
    const ubicaciones = entorno.invocar('obtenerUbicacionesRack', 'R01', token);
    const clave = ubicaciones.find(u => u.nivel === 'N01' && u.posicion === 'P01');

    return {
      datos: 'COD-001 en rack R01, nivel N01, posición P01',
      esperado: 'una ubicación N01-P01 con COD-001 entre sus productos',
      obtenido: JSON.stringify(ubicaciones),
      pasa: !!clave && clave.productos.some(p => p.codigo === 'COD-001'),
    };
  },
});

prueba({
  id: 'MAPA-003', grupo: 'inventario', nombre: 'buscarProducto encuentra por nombre y por código usando la lectura cacheada',
  metodo: 'EMPÍRICO',
  objetivo: 'Buscar "AZUCAR" y buscar "COD-003" deben encontrar cada uno exactamente su producto',
  ejecutar() {
    const { entorno, token } = entornoConMapa();
    const porNombre = entorno.invocar('buscarProducto', 'AZUCAR', token);
    const porCodigo = entorno.invocar('buscarProducto', 'COD-003', token);

    return {
      datos: 'COD-002 AZUCAR ESTANDAR, COD-003 SAL DE MESA',
      esperado: 'porNombre=[COD-002], porCodigo=[COD-003]',
      obtenido: `porNombre=${JSON.stringify(porNombre.map(p => p.codigo))}, porCodigo=${JSON.stringify(porCodigo.map(p => p.codigo))}`,
      pasa: porNombre.length === 1 && porNombre[0].codigo === 'COD-002'
        && porCodigo.length === 1 && porCodigo[0].codigo === 'COD-003',
    };
  },
});

prueba({
  id: 'MAPA-004', grupo: 'inventario', nombre: 'Las 3 funciones del Mapa exigen sesión activa',
  metodo: 'EMPÍRICO',
  objetivo: 'obtenerResumenRacks, obtenerUbicacionesRack y buscarProducto deben rechazar un token inválido antes de leer MATRIZ',
  ejecutar() {
    const { entorno } = entornoConMapa();
    let lanzo1 = false, lanzo2 = false, lanzo3 = false;
    try { entorno.invocar('obtenerResumenRacks', 'token-invalido'); } catch (e) { lanzo1 = true; }
    try { entorno.invocar('obtenerUbicacionesRack', 'R01', 'token-invalido'); } catch (e) { lanzo2 = true; }
    try { entorno.invocar('buscarProducto', 'AZUCAR', 'token-invalido'); } catch (e) { lanzo3 = true; }

    return {
      datos: 'token="token-invalido"',
      esperado: 'las 3 funciones lanzan error',
      obtenido: `lanzo1=${lanzo1}, lanzo2=${lanzo2}, lanzo3=${lanzo3}`,
      pasa: lanzo1 === true && lanzo2 === true && lanzo3 === true,
    };
  },
});
