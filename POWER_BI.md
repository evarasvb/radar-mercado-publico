# Radar MP Pro en Power BI Desktop y Excel

> **Importante:** en este paquete **no hay archivo .pbix ni .pbit**. Se prepararon en Linux, donde Power BI Desktop no existe, y no se pueden generar ni probar ahí. Lo que sí va: las consultas M (con la sintaxis validada por el parser oficial de Microsoft), un libro de Excel con la consulta ya incrustada, las medidas DAX y esta guía para armar el informe en unos 30 minutos.

## 1. Elige la fuente

| Fuente | Ventaja | Cuidado |
|---|---|---|
| **A. CSV publicado desde Google Sheets** (`06_Desde_CSV_Publicado.pq`) | Power BI no necesita ticket ni hace consultas a la API. Incluye puntaje, etapa, competencia e historial del radar de Google | Lo publicado queda visible para quien tenga el enlace (las hojas PBI no traen Notas ni Responsable) |
| **B. API directa** (`01_fnMP.pq` a `05_Competencia_OC.pq`) | No depende de Google | Cada ficha es 1 consulta. Respeta los 10.000 diarios y **desactiva la carga en paralelo** (ver abajo) |

## 2. Consultas (Inicio › Transformar datos › Nuevo origen › Consulta en blanco › Editor avanzado)

Crea primero los **parámetros** (Inicio › Administrar parámetros): `Ticket` (texto), y si usas la fuente A, `UrlPBI_Licitaciones`, `UrlPBI_Items`, `UrlPBI_Competencia` (texto).

| Nombre de la consulta | Archivo | Qué devuelve |
|---|---|---|
| `fnMP` | `01_fnMP.pq` | Función: llama a la API con pausa de 1,5 s, reintentos a los 10/30/60/90 s y error explícito (nunca una lista vacía disfrazada de «sin resultados») |
| `Licitaciones_Activas` | `02_Licitaciones_Activas.pq` | Activas que calzan con la tabla `PalabrasClave` (Palabra, Peso) y su puntaje por nombre |
| `Licitaciones_Detalle` | `03_Licitaciones_Detalle.pq` | Ficha completa de las primeras N (parámetro `MaxFichas`) |
| `Licitaciones_PorFecha` | `04_Licitaciones_PorFecha.pq` | Paginación por fecha (`fecha=ddmmaaaa`) para los últimos `DiasAtras` días. Un día que falla aparece con su error en la columna `Error`, no desaparece |
| `Competencia_OC` | `05_Competencia_OC.pq` | Líneas de órdenes de compra de la tabla `Organismos`: proveedor, producto, cantidad y precio neto |
| `Licitaciones` (fuente A) | `06_Desde_CSV_Publicado.pq` | La hoja PBI_Licitaciones del radar de Google |

`Excel.CurrentWorkbook()` solo existe en Excel. **En Power BI**, crea `PalabrasClave` (columnas Palabra, Peso) y `Organismos` (columna Codigo) con **Inicio › Especificar datos** y cambia estas líneas:

| Consulta | Línea de Excel | Reemplázala en Power BI por |
|---|---|---|
| 02 | `Claves = try Table.TransformColumnTypes(Excel.CurrentWorkbook(){[Name = "PalabrasClave"]}…` | `Claves = Table.TransformColumnTypes(PalabrasClave, {{"Palabra", type text}, {"Peso", type number}}),` |
| 03 | `MaxFichas = try … otherwise 40,` | `MaxFichas = 40,` (o un parámetro) |
| 04 | `DiasAtras = …`, `EstadoFiltro = …` | `DiasAtras = 7,` y `EstadoFiltro = "",` (o parámetros) |
| 05 | `Orgs = try List.Transform(Excel.CurrentWorkbook()…` | `Orgs = List.Transform(Organismos[Codigo], Text.From),` |

Si no las cambias, Power BI usa los valores por defecto escritos en cada consulta (por ejemplo, las palabras «aseo» y «limpieza»).

**Antes de actualizar:**
- Archivo › Opciones › Archivo actual › Carga de datos › desmarca **«Habilitar carga paralela de tablas»**. La API rechaza consultas simultáneas (error 429, código 10500).
- Credenciales de `https://api.mercadopublico.cl`: **Anónimo**. El ticket va como parámetro.
- Privacidad: si Power BI avisa que combina orígenes, marca ambos como **Organizacional**.
- Actualización programada en el servicio de Power BI: la URL base es fija (se usan `RelativePath` y `Query`), así que el servicio la acepta sin puerta de enlace. **Esto no se probó**: compruébalo en tu inquilino.

## 3. Modelo

```
Calendario[Fecha] 1 ──── * Licitaciones[FechaCierreDia]
Licitaciones[codigo] 1 ── * Items[codigo_licitacion]
Organismo[codigo_organismo] 1 ── * Licitaciones[codigo_organismo]
Organismo[codigo_organismo] 1 ── * Competencia[codigo_organismo]
```

Columnas y tablas de apoyo (DAX):

```DAX
Calendario = ADDCOLUMNS(CALENDAR(TODAY() - 365, TODAY() + 120),
    "Año", YEAR([Date]), "Mes", FORMAT([Date], "mmm yyyy"), "Día semana", FORMAT([Date], "ddd"))

Organismo = DISTINCT(UNION(
    SELECTCOLUMNS(Licitaciones, "codigo_organismo", Licitaciones[codigo_organismo], "organismo", Licitaciones[organismo]),
    SELECTCOLUMNS(Competencia, "codigo_organismo", Competencia[codigo_organismo], "organismo", Competencia[organismo])))
-- Si un mismo código aparece con dos nombres, deja solo el código en la tabla y toma el nombre con LOOKUPVALUE.

FechaCierreDia = DATEVALUE(Licitaciones[fecha_cierre])            -- columna en Licitaciones

Tramo monto = SWITCH(TRUE(),                                       -- columna en Licitaciones
    ISBLANK(Licitaciones[monto_estimado]), "No informado",
    Licitaciones[monto_estimado] < 1000000, "1. Hasta $1 MM",
    Licitaciones[monto_estimado] < 10000000, "2. $1 a 10 MM",
    Licitaciones[monto_estimado] < 50000000, "3. $10 a 50 MM",
    Licitaciones[monto_estimado] < 200000000, "4. $50 a 200 MM",
    "5. Más de $200 MM")

Dias al cierre = IF(ISBLANK(Licitaciones[fecha_cierre]), BLANK(),  -- columna (se recalcula en cada actualización)
    ROUND(DATEDIFF(NOW(), Licitaciones[fecha_cierre], MINUTE) / 1440, 1))
```

## 4. Medidas DAX sugeridas

```DAX
Oportunidades = COUNTROWS(Licitaciones)
Puntaje promedio = AVERAGE(Licitaciones[puntaje])
Monto estimado total = SUM(Licitaciones[monto_estimado])
Con monto informado % = DIVIDE(COUNTROWS(FILTER(Licitaciones, NOT ISBLANK(Licitaciones[monto_estimado]))), [Oportunidades])
Cierran en 7 días = CALCULATE([Oportunidades], Licitaciones[Dias al cierre] >= 0, Licitaciones[Dias al cierre] <= 7)
Alta prioridad = CALCULATE([Oportunidades], Licitaciones[puntaje] >= 60)
En pipeline activo = CALCULATE([Oportunidades], Licitaciones[etapa] IN {"Revisar", "Postular", "Postulada"})
Postuladas = CALCULATE([Oportunidades], Licitaciones[etapa] = "Postulada")
Ganadas = CALCULATE([Oportunidades], Licitaciones[etapa] = "Ganada")
Perdidas = CALCULATE([Oportunidades], Licitaciones[etapa] = "Perdida")
Tasa de adjudicación = DIVIDE([Ganadas], [Ganadas] + [Perdidas])
Monto en juego (Postulada) = CALCULATE([Monto estimado total], Licitaciones[etapa] = "Postulada")
Detectadas últimos 7 días = CALCULATE([Oportunidades], Licitaciones[detectada] >= NOW() - 7)

-- Competencia
Ventas competencia = SUMX(Competencia, Competencia[cantidad] * Competencia[precio_unitario])
Proveedores distintos = DISTINCTCOUNT(Competencia[rut_proveedor])
Precio unitario mediano = MEDIAN(Competencia[precio_unitario])
Precio unitario P25 = PERCENTILE.INC(Competencia[precio_unitario], 0.25)
Precio unitario P75 = PERCENTILE.INC(Competencia[precio_unitario], 0.75)
Ranking proveedor = RANKX(ALL(Competencia[proveedor]), [Ventas competencia], , DESC, Dense)
Participación del líder =
    VAR lider = MAXX(VALUES(Competencia[proveedor]), [Ventas competencia])
    RETURN DIVIDE(lider, CALCULATE([Ventas competencia], ALL(Competencia[proveedor])))

-- Formato condicional (color de fuente o fondo en tablas)
Color cierre = SWITCH(TRUE(), MIN(Licitaciones[Dias al cierre]) <= 3, "#C62828", MIN(Licitaciones[Dias al cierre]) <= 7, "#EF6C00", "#2E7D32")
```

Para que `Ventas competencia` use cantidad × precio: en algunas órdenes de compra reales la API entrega el total de la línea en 0 (verificado el 18-11-2026).

## 5. Página del informe (réplica del dashboard de Google)

| Zona | Visual | Campos |
|---|---|---|
| Arriba | 6 tarjetas | Oportunidades, Puntaje promedio, Monto estimado total, Cierran en 7 días, En pipeline activo, Tasa de adjudicación |
| Izquierda | Segmentadores | Región, Etapa, Tramo monto, Tipo, rango de Puntaje (control deslizante), Rubro |
| Centro | Barras horizontales | Región × Oportunidades |
| Centro | Barras horizontales (top 10) | Organismo × Oportunidades (filtro N superior = 10) |
| Centro | Anillo | Rubro × Oportunidades |
| Centro | Columnas | Tramo monto × Oportunidades |
| Abajo | Columnas | Calendario[Fecha] (próximos 7 días, filtro relativo) × Oportunidades |
| Abajo | Tabla | Puntaje (barras de datos), código, nombre, organismo, región, monto, cierre (color con «Color cierre»), etapa, url_ficha (categoría de datos = URL web) |
| Página 2 «Competencia» | Barras + dispersión | Proveedor × Ventas competencia; dispersión cantidad vs precio_unitario por proveedor; tarjetas de Precio P25 / mediano / P75 |
| Página 3 «Pipeline» | Embudo + matriz | Etapa × Oportunidades; matriz Responsable × Etapa (si usas la fuente A) |

## 6. Excel con Power Query (sin Power BI)

`powerquery/Radar_MP_PowerQuery.xlsx` trae la consulta `Radar_Licitaciones` incrustada (generada con la librería oficial de Microsoft `@microsoft/connected-workbooks`), la hoja **Parámetros** (ticket, máximo de fichas, palabras clave con peso y exclusiones, como rangos con nombre) y 56 filas reales de muestra.

1. Abre el archivo en Excel de Microsoft 365 (Windows o Mac).
2. Hoja **Parámetros**: pega tu ticket en B3, ajusta las palabras clave (A8:B27) y las exclusiones (D8 en adelante).
3. **Datos › Actualizar todo**. Si pregunta por privacidad, elige **Organizacional**.
4. Para ver o editar la consulta: **Datos › Consultas y conexiones** › clic derecho en «Radar_Licitaciones» › Editar.

**Qué está probado y qué no:** la sintaxis de todas las consultas M se validó con `@microsoft/powerquery-parser`. El libro se abrió y leyó bien con LibreOffice y con openpyxl, y la consulta incrustada se extrajo y verificó dentro del paquete. **No se ejecutó la actualización en Excel ni en Power BI**, porque esos programas no corren en Linux. Pruébalo primero con 5 fichas (B4 = 5).
