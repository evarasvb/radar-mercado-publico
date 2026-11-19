// Competencia_OC · Órdenes de compra de tus organismos favoritos (últimos N días): quién vende, qué y a qué precio.
// En Power BI: reemplaza las líneas con Excel.CurrentWorkbook() como indica POWER_BI.md (sección 2).
// Requiere la tabla «Organismos» (columna Codigo) y el parámetro DiasCompetencia. Cada OC = 1 consulta de detalle.
let
    Dias = try Number.From(Excel.CurrentWorkbook(){[Name = "DiasCompetencia"]}[Content]{0}[Column1]) otherwise 3,
    MaxOC = try Number.From(Excel.CurrentWorkbook(){[Name = "MaxOC"]}[Content]{0}[Column1]) otherwise 60,
    Orgs = try List.Transform(Excel.CurrentWorkbook(){[Name = "Organismos"]}[Content][Codigo], Text.From) otherwise {"7248"},
    Pares = List.Combine(List.Transform(Orgs, (o) => List.Transform({1..Dias}, (k) => [Org = o, Fecha = Date.ToText(Date.AddDays(Date.From(DateTime.LocalNow()), -k), "ddMMyyyy")]))),
    Listas = List.Combine(List.Transform(Pares, (p) => try List.Transform(fnMP("ordenesdecompra.json", [fecha = p[Fecha], CodigoOrganismo = p[Org]], Ticket), each [Codigo]) otherwise {})),
    Codigos = List.FirstN(List.Distinct(Listas), MaxOC),
    Detalles = List.RemoveNulls(List.Transform(Codigos, (c) => try fnMP("ordenesdecompra.json", [codigo = c], Ticket){0} otherwise null)),
    Lineas = List.Combine(List.Transform(Detalles, (oc) =>
        List.Transform(oc[Items][Listado], (it) => [
            Codigo = oc[Codigo], Nombre = oc[Nombre], Estado = oc[Estado],
            Fecha = try oc[Fechas][FechaEnvio] otherwise null,
            Organismo = Text.Trim(oc[Comprador][NombreOrganismo] ?? ""), CodigoOrganismo = Text.From(oc[Comprador][CodigoOrganismo]),
            Region = Text.Trim(oc[Comprador][RegionUnidad] ?? ""),
            Proveedor = Text.Trim(oc[Proveedor][Nombre] ?? ""), RutProveedor = oc[Proveedor][RutSucursal],
            Producto = it[Producto]?, Especificacion = it[EspecificacionComprador]?, UNSPSC = Text.From(it[CodigoProducto]?),
            Cantidad = it[Cantidad]?, PrecioNeto = it[PrecioNeto]?,
            // en algunas OC reales la API trae Total = 0 en la línea: se usa cantidad × precio neto
            TotalLinea = if (it[Total]? ?? 0) = 0 then (it[Cantidad]? ?? 0) * (it[PrecioNeto]? ?? 0) else it[Total], Moneda = it[Moneda]?,
            LicitacionRelacionada = oc[CodigoLicitacion]?]))),
    Tabla = Table.FromRecords(Lineas),
    Tipos = Table.TransformColumnTypes(Tabla, {{"Fecha", type datetime}, {"Cantidad", type number}, {"PrecioNeto", type number}, {"TotalLinea", type number}}, "en-US")
in
    Tipos
