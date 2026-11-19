// Licitaciones_PorFecha · Paginación por fecha: recorre los últimos N días con «fecha=ddmmaaaa» y une los resultados.
// En Power BI: reemplaza las líneas con Excel.CurrentWorkbook() como indica POWER_BI.md (sección 2).
// Útil para historia (publicadas, cerradas, adjudicadas). Un día que falla queda marcado en la columna «Error»
// en vez de desaparecer en silencio. Parámetros: DiasAtras (número) y EstadoFiltro (texto opcional: "adjudicada", "cerrada"…).
let
    DiasAtras = try Number.From(Excel.CurrentWorkbook(){[Name = "DiasAtras"]}[Content]{0}[Column1]) otherwise 7,
    EstadoFiltro = try Text.From(Excel.CurrentWorkbook(){[Name = "EstadoFiltro"]}[Content]{0}[Column1]) otherwise "",
    Fechas = List.Transform({1..DiasAtras}, each Date.AddDays(Date.From(DateTime.LocalNow()), -_)),
    PorDia = List.Transform(Fechas, (d) =>
        let
            p = [fecha = Date.ToText(d, "ddMMyyyy")] & (if EstadoFiltro = "" then [] else [estado = EstadoFiltro]),
            r = try fnMP("licitaciones.json", p, Ticket)
        in
            if r[HasError] then #table({"Fecha", "CodigoExterno", "Nombre", "CodigoEstado", "FechaCierre", "Error"}, {{d, null, null, null, null, r[Error][Message] & " " & (r[Error][Detail] ?? "")}})
            else Table.AddColumn(Table.AddColumn(Table.FromRecords(r[Value], {"CodigoExterno", "Nombre", "CodigoEstado", "FechaCierre"}, MissingField.UseNull), "Fecha", each d, type date), "Error", each null, type text)),
    Unido = Table.Combine(PorDia),
    Tipos = Table.TransformColumnTypes(Unido, {{"CodigoExterno", type text}, {"Nombre", type text}, {"CodigoEstado", Int64.Type}, {"FechaCierre", type datetime}}, "en-US")
in
    Tipos
