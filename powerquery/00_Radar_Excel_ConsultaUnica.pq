// Radar_Licitaciones · consulta ÚNICA que va dentro de Radar_MP_PowerQuery.xlsx (Excel, Datos › Actualizar todo).
// Lee los parámetros de la hoja «Parámetros» (rangos con nombre MP_Ticket, MP_MaxFichas, MP_PalabrasClave, MP_Excluir),
// consulta la API de Mercado Público con pausas y reintentos, calcula un puntaje por nombre y trae la ficha completa.
let
    Param = (nombre as text, defecto) => try Excel.CurrentWorkbook(){[Name = nombre]}[Content]{0}[Column1] otherwise defecto,
    TicketTexto = Text.Trim(Text.From(Param("MP_Ticket", "") ?? "")),
    Ticket = if TicketTexto = "" or TicketTexto = "TU_TICKET_AQUI" then error "Escribe tu ticket en la hoja Parámetros (celda B3) y vuelve a actualizar." else TicketTexto,
    MaxFichas = try Number.From(Param("MP_MaxFichas", 30)) otherwise 30,
    ClavesRaw = try Excel.CurrentWorkbook(){[Name = "MP_PalabrasClave"]}[Content] otherwise #table({"Column1", "Column2"}, {{"aseo*", 3}}),
    Claves = Table.SelectRows(Table.RenameColumns(ClavesRaw, {{"Column1", "Palabra"}, {"Column2", "Peso"}}), each [Palabra] <> null and Text.Trim(Text.From([Palabra])) <> ""),
    ExcluirRaw = try Excel.CurrentWorkbook(){[Name = "MP_Excluir"]}[Content][Column1] otherwise {},
    Excluir = List.Select(List.Transform(ExcluirRaw, each if _ = null then "" else Text.Trim(Text.From(_))), each _ <> ""),

    // --- llamada a la API con pausa de 1,5 s, reintentos 10/30/60/90 s y error explícito si falla
    fnMP = (recurso as text, consulta as record) as list =>
        let
            Esperas = {0, 10, 30, 60, 90},
            Intentar = (n as number) as record =>
                let
                    Resp = Function.InvokeAfter(() => Web.Contents("https://api.mercadopublico.cl", [
                        RelativePath = "servicios/v1/publico/" & recurso, Query = consulta & [ticket = Ticket],
                        ManualStatusHandling = {400, 401, 403, 404, 429, 500, 502, 503, 504}, IsRetry = n > 0, Timeout = #duration(0, 0, 2, 0)]),
                        #duration(0, 0, 0, 1.5 + Esperas{n})),
                    Estado = try Value.Metadata(Resp)[Response.Status] otherwise 0,
                    Json = try Json.Document(Resp, 65001) otherwise null,
                    EsRec = Json <> null and Value.Is(Json, type record),
                    Ok = Estado = 200 and EsRec and Record.HasFields(Json, "Listado"),
                    CodigoApi = if EsRec and Record.HasFields(Json, "Codigo") then Json[Codigo] else null
                in
                    [Ok = Ok, Estado = Estado, CodigoApi = CodigoApi, Json = Json,
                     Mensaje = if EsRec and Record.HasFields(Json, "Mensaje") then Json[Mensaje] else "respuesta no es JSON",
                     Reintentable = not Ok and CodigoApi <> 203 and (Estado = 429 or CodigoApi = 10500 or Estado >= 500 or Estado = 0 or Json = null)],
            Intentos = List.Generate(() => [i = 0, r = Intentar(0)], each [i] < List.Count(Esperas),
                each if [r][Ok] or not [r][Reintentable] then [i = List.Count(Esperas), r = [r]] else [i = [i] + 1, r = Intentar([i] + 1)], each [r]),
            U = List.Last(Intentos)
        in
            if U[Ok] then U[Json][Listado]
            else error Error.Record("Mercado Público no respondió bien", "HTTP " & Text.From(U[Estado]) & " · " & Text.From(U[Mensaje]) & " (esto NO significa que no haya licitaciones)"),

    Normalizar = (t) => " " & Text.Combine(List.Select(Text.SplitAny(Text.Lower(Text.Replace(Text.Replace(Text.Replace(Text.Replace(Text.Replace(Text.From(t ?? ""), "á", "a"), "é", "e"), "í", "i"), "ó", "o"), "ú", "u")), " ,.;:-_/()""'°ºª#"), each _ <> ""), " ") & " ",
    Calza = (texto, palabra) => let p = Text.Lower(Text.Trim(Text.From(palabra))), pref = Text.EndsWith(p, "*"), k = Text.Trim(Normalizar(Text.TrimEnd(p, "*"))), n = Normalizar(texto)
                               in k <> "" and (if pref then Text.Contains(n, " " & k) else Text.Contains(n, " " & k & " ")),

    // --- 1. activas + puntaje por nombre (peso × 12, igual que el Radar de Google Sheets cuando calza en el nombre)
    Activas = Table.FromRecords(fnMP("licitaciones.json", [estado = "activas"]), {"CodigoExterno", "Nombre", "CodigoEstado", "FechaCierre"}, MissingField.UseNull),
    SinExcluidas = Table.SelectRows(Activas, (f) => not List.AnyTrue(List.Transform(Excluir, (x) => Calza(f[Nombre], x)))),
    ConPuntaje = Table.AddColumn(SinExcluidas, "PuntajeNombre", (f) => List.Sum(List.Transform(Table.ToRecords(Claves), (k) => if Calza(f[Nombre], k[Palabra]) then (try Number.From(k[Peso]) otherwise 1) * 12 else 0)) ?? 0, type number),
    Calzan = Table.Sort(Table.SelectRows(ConPuntaje, each [PuntajeNombre] > 0), {{"PuntajeNombre", Order.Descending}, {"FechaCierre", Order.Ascending}}),

    // --- 2. ficha completa de las primeras N (1 consulta por licitación)
    Primeras = Table.FirstN(Calzan, MaxFichas),
    ConFicha = Table.AddColumn(Primeras, "F", each try fnMP("licitaciones.json", [codigo = [CodigoExterno]]){0} otherwise null),
    Campo = (r, ruta as list) => List.Accumulate(ruta, r, (s, c) => if s <> null and Value.Is(s, type record) and Record.HasFields(s, c) then Record.Field(s, c) else null),
    Plano = Table.AddColumn(ConFicha, "D", each let f = [F], fc = [FechaCierre], it = Campo(f, {"Items", "Listado"}) ?? {} in [
        Organismo = Text.Trim(Campo(f, {"Comprador", "NombreOrganismo"}) ?? ""), Region = Text.Trim(Campo(f, {"Comprador", "RegionUnidad"}) ?? ""),
        Comuna = Text.Trim(Campo(f, {"Comprador", "ComunaUnidad"}) ?? ""), Tipo = Campo(f, {"Tipo"}), Estado = Campo(f, {"Estado"}),
        MontoEstimado = if Campo(f, {"VisibilidadMonto"}) = 1 then Campo(f, {"MontoEstimado"}) else null,
        Cierre = Campo(f, {"Fechas", "FechaCierre"}) ?? fc,
        RubroPrincipal = if List.Count(it) = 0 then null else Text.Trim(List.Last(Text.Split(Text.From(it{0}[Categoria] ?? ""), "/"))),
        UNSPSC = if List.Count(it) = 0 then null else Text.From(it{0}[CodigoCategoria]),
        FichaLeida = f <> null]),
    Exp = Table.ExpandRecordColumn(Table.RemoveColumns(Plano, {"F", "CodigoEstado", "FechaCierre"}), "D", {"Organismo", "Region", "Comuna", "Tipo", "Estado", "MontoEstimado", "Cierre", "RubroPrincipal", "UNSPSC", "FichaLeida"}),
    Tipos = Table.TransformColumnTypes(Exp, {{"CodigoExterno", type text}, {"Nombre", type text}, {"MontoEstimado", type number}, {"Cierre", type datetime}}, "en-US"),
    Dias = Table.AddColumn(Tipos, "DiasAlCierre", each if [Cierre] = null then null else Number.Round(Duration.TotalDays([Cierre] - DateTime.LocalNow()), 1), type number),
    Url = Table.AddColumn(Dias, "UrlFicha", each "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=" & [CodigoExterno], type text),
    Resultado = Table.SelectColumns(Url, {"CodigoExterno", "Nombre", "PuntajeNombre", "Organismo", "Region", "Comuna", "Tipo", "Estado", "MontoEstimado", "Cierre", "DiasAlCierre", "RubroPrincipal", "UNSPSC", "FichaLeida", "UrlFicha"})
in
    Resultado
