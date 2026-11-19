// Licitaciones_Detalle · Ficha completa (organismo, región, monto, fechas, rubro) de las que calzan.
// En Power BI: reemplaza las líneas con Excel.CurrentWorkbook() como indica POWER_BI.md (sección 2).
// Una consulta por licitación con pausa de 1,5 s: limita a las primeras N (MaxFichas) para no agotar el ticket.
let
    MaxFichas = try Number.From(Excel.CurrentWorkbook(){[Name = "MaxFichas"]}[Content]{0}[Column1]) otherwise 40,
    Base = Table.FirstN(Licitaciones_Activas, MaxFichas),
    ConFicha = Table.AddColumn(Base, "Ficha", each try fnMP("licitaciones.json", [codigo = [CodigoExterno]], Ticket){0} otherwise null),
    SoloOk = Table.SelectRows(ConFicha, each [Ficha] <> null),
    Campo = (r as record, ruta as list) => List.Accumulate(ruta, r, (s, c) => if s <> null and Value.Is(s, type record) and Record.HasFields(s, c) then Record.Field(s, c) else null),
    Plano = Table.AddColumn(SoloOk, "D", each
        let f = [Ficha], items = Campo(f, {"Items", "Listado"}) ?? {} in [
            Organismo = Text.Trim(Campo(f, {"Comprador", "NombreOrganismo"}) ?? ""),
            CodigoOrganismo = Campo(f, {"Comprador", "CodigoOrganismo"}),
            Unidad = Text.Trim(Campo(f, {"Comprador", "NombreUnidad"}) ?? ""),
            Region = Text.Trim(Campo(f, {"Comprador", "RegionUnidad"}) ?? ""),
            Comuna = Text.Trim(Campo(f, {"Comprador", "ComunaUnidad"}) ?? ""),
            Tipo = Campo(f, {"Tipo"}),
            Estado = Campo(f, {"Estado"}),
            Moneda = Campo(f, {"Moneda"}),
            MontoEstimado = if Campo(f, {"VisibilidadMonto"}) = 1 then Campo(f, {"MontoEstimado"}) else null,
            Publicacion = Campo(f, {"Fechas", "FechaPublicacion"}),
            Cierre = Campo(f, {"Fechas", "FechaCierre"}),
            FinPreguntas = Campo(f, {"Fechas", "FechaFinal"}),
            AdjudicacionEstimada = Campo(f, {"Fechas", "FechaAdjudicacion"}),
            Descripcion = Text.Start(Campo(f, {"Descripcion"}) ?? "", 500),
            NumItems = List.Count(items),
            RubroPrincipal = if List.Count(items) = 0 then null else List.Last(Text.Split(items{0}[Categoria] ?? "", "/")),
            UNSPSC = if List.Count(items) = 0 then null else Text.From(items{0}[CodigoCategoria]),
            UrlFicha = "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=" & [CodigoExterno]
        ]),
    Expandido = Table.ExpandRecordColumn(Table.RemoveColumns(Plano, {"Ficha"}), "D",
        {"Organismo", "CodigoOrganismo", "Unidad", "Region", "Comuna", "Tipo", "Estado", "Moneda", "MontoEstimado", "Publicacion", "Cierre",
         "FinPreguntas", "AdjudicacionEstimada", "Descripcion", "NumItems", "RubroPrincipal", "UNSPSC", "UrlFicha"}),
    Tipos = Table.TransformColumnTypes(Expandido, {{"MontoEstimado", type number}, {"Publicacion", type datetime}, {"Cierre", type datetime},
        {"FinPreguntas", type datetime}, {"AdjudicacionEstimada", type datetime}, {"NumItems", Int64.Type}, {"CodigoOrganismo", type text}}, "en-US"),
    DiasAlCierre = Table.AddColumn(Tipos, "DiasAlCierre", each if [Cierre] = null then null else Number.Round(Duration.TotalDays([Cierre] - DateTime.LocalNow()), 1), type number)
in
    DiasAlCierre
