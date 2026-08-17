# pruebas-qa — Suite de QA independiente de TAGERS WMS

Carpeta **100% separada del código de producción**. Nunca abre, lee ni
escribe una hoja de cálculo real (MATRIZ, KARDEX, REQUISICIONES,
ORDENES_COMPRA, CONTEO_CICLICO, USUARIOS, etc.). Todo corre en Node.js,
en memoria, y se descarta al terminar el proceso.

## Cómo funciona (sin reimplementar la lógica de negocio)

`lib/cargar-backend.js` carga con el módulo `vm` de Node los archivos
`.gs` **reales** de la raíz del proyecto (`📁 App.gs.gs`, `Código.gs`,
`Recetas.gs`, `RequisicionesRecetas.gs`, `Produccion.gs`, etc. — ver la
lista completa en `ARCHIVOS_BACKEND` dentro de ese archivo) dentro de un
contexto con las APIs de Google Apps Script emuladas en memoria
(`lib/emulador-gas.js`: `SpreadsheetApp`, `LockService`, `CacheService`,
`PropertiesService`, `Utilities`, `Session`). Las pruebas invocan las
funciones reales (`entorno.invocar('nombreFuncionApp', ...)`) y verifican
su resultado y el estado final de las hojas emuladas
(`entorno.leerHoja('MATRIZ')`).

Esto significa: **si el código de producción cambia, la próxima corrida
de esta suite prueba el código nuevo automáticamente** — no hay que
mantener una copia paralela de la lógica que se desincroniza con el
tiempo.

Servicios que TAGERS WMS solo usa para generar/guardar PDFs (`DriveApp`,
`DocumentApp`, `HtmlService`, `MailApp`, `GmailApp`, `ScriptApp`,
`UrlFetchApp`) se reemplazan por un proxy inerte (`crearProxyInerte`) que
absorbe cualquier cadena de llamadas sin tronar — ninguna prueba aquí
verifica el CONTENIDO de un PDF, solo que el flujo de negocio alrededor
no se rompa.

## Estructura

```
pruebas-qa/
├── lib/
│   ├── emulador-gas.js      Emulador de SpreadsheetApp/LockService/CacheService/etc.
│   ├── cargar-backend.js    Carga el código REAL de producción con vm.createContext
│   ├── datos-prueba.js      Fixtures (USUARIOS/MATRIZ/hojas vacías con encabezados reales)
│   ├── runner.js            Registro y ejecución de pruebas (PASS/FAIL/SKIP/ERROR)
│   └── comparador.js        Compara una corrida contra baseline/baseline.json
├── smoke/            20 pruebas de humo (flujo básico de cada módulo)
├── seguridad/        Sesión, tokens, roles, IDOR, guards "legado"
├── inventario/       Los 5 casos de concurrencia/discrepancias del pedido + control positivo
├── compras/          OCs, proveedores, recepción parcial/total, cancelación, precios
├── requisiciones/    Creación, permisos por área, entrega, requisiciones de receta
├── recetas/          CRUD de recetas y su guard de CONSULTA
├── produccion/       Registrar/cerrar lotes, autocompletar producto terminado
├── concurrencia/     Folios sin colisión, salidas simultáneas, aprobar/rechazar a la vez
├── rendimiento/      Caché de lecturas, prueba Dashboard ANTES/DESPUÉS
├── sucursales/       Fundación multi-sucursal (Opción B): aislamiento por EXISTENCIAS_SUCURSAL
├── baseline/          baseline.json generado por --baseline (no se edita a mano)
└── run.js             Punto de entrada de la CLI
```

## Uso

```bash
cd pruebas-qa
node run.js                    # corre todo, imprime el reporte en consola
node run.js --grupo=smoke      # corre solo un grupo
node run.js --baseline         # corre todo y GUARDA baseline/baseline.json
node run.js --comparar         # corre todo y compara contra la baseline guardada;
                                # sale con código 1 si detecta una REGRESIÓN
                                # (una prueba que antes PASABA y ahora no)
node run.js --json=salida.json # además del reporte en consola, guarda el detalle en JSON
```

## Fundación multi-sucursal (Opción B)

Los 3 escritores centralizados de existencia (`actualizarExistenciaMatriz_`,
`ajustarExistenciaMatrizPorDelta_`, `ajustarExistenciaMatrizPorDeltaValidado_`,
todos en `📁 App.gs.gs`) aceptan ahora un parámetro opcional `sucursal`.
Sin pasarlo (el 100% de las llamadas reales hoy), su comportamiento es
exactamente el de antes — byte por byte, confirmado por el resto de la
suite sin haber cambiado una sola línea de esas pruebas. Al pasar una
sucursal distinta a `"S01"`, la escritura se desvía a una hoja nueva e
independiente, `EXISTENCIAS_SUCURSAL` (Código | Sucursal | Existencia),
sin tocar MATRIZ. Es infraestructura aditiva y dormida: no hay todavía
ninguna pantalla, columna en USUARIOS, ni flujo de negocio que la
invoque con una sucursal real. Pruebas en `sucursales/`.

## Flujo recomendado antes de tocar código de producción

```
node run.js --baseline     # 1. Fija el estado ANTES del cambio
# ... se modifica el código de producción ...
node run.js --comparar     # 2. Corre todo otra vez y compara
```

Si `--comparar` reporta una regresión, el proceso termina con código de
salida 1 — no se debe seguir agregando cambios encima hasta resolverla.

## Qué significa cada estado

- **PASS** — la aserción corrió y se cumplió.
- **FAIL** — la aserción corrió pero el resultado no fue el esperado.
- **SKIP** — la prueba se saltó a propósito (ver el campo `objetivo` para
  la razón — normalmente porque es una prueba de frontend fuera del
  alcance de esta suite de backend).
- **ERROR** — una excepción no controlada interrumpió la prueba antes de
  poder comparar nada (bug en la prueba misma, o una función que ya no
  existe/cambió de firma).

## Qué NO prueba esta carpeta

- **Frontend puro** (`index.html`): estado de UI, persistencia de
  selección en pantalla, etc. — eso está cubierto por las pruebas
  Playwright existentes fuera de esta carpeta (ver prueba `SMK-012`,
  marcada SKIP a propósito con la referencia).
- **Concurrencia real de red**: dos peticiones HTTP genuinamente
  simultáneas contra el despliegue real de Apps Script. Esta suite
  reproduce con fidelidad el efecto del `LockService` (que serializa
  toda escritura relevante en producción, ya que Apps Script no tiene
  hilos) invocando la función real dos veces en secuencia sobre el mismo
  estado — pero no puede confirmar el comportamiento de la infraestructura
  de Google bajo carga real. Se documenta como **NO TESTEABLE SIN ENTORNO
  CONTROLADO** en el reporte de auditoría.
- **Tiempos de producción reales**: los `duracionMs` que imprime el
  reporte son válidos para comparar ANTES/DESPUÉS dentro de esta misma
  corrida (p. ej. "de 5 lecturas a 1"), nunca como tiempo absoluto
  esperado en el Apps Script real (Node/V8 es mucho más rápido que
  `SpreadsheetApp`/`HtmlService` reales).
