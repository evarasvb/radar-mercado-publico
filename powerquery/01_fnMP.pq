// fnMP · Consulta la API de Mercado Público con pausas y reintentos.
// Uso: fnMP("licitaciones.json", [estado = "activas"], Ticket)
//      fnMP("licitaciones.json", [codigo = "1001-22-LE26"], Ticket)
//      fnMP("ordenesdecompra.json", [fecha = "17112026", CodigoOrganismo = "7248"], Ticket)
// Devuelve una lista con los registros de «Listado». Si tras 5 intentos no hay respuesta válida, lanza un error
// claro (NUNCA devuelve una lista vacía disfrazada de «sin resultados»).
// URL base fija + RelativePath/Query: así Power BI Service puede programar la actualización.
(recurso as text, consulta as record, ticket as text) as list =>
let
    Base = "https://api.mercadopublico.cl",
    Esperas = {0, 10, 30, 60, 90},                       // segundos antes de cada intento
    Pausa = #duration(0, 0, 0, 1.5),                     // la API rechaza peticiones simultáneas (429 · 10500)
    Intentar = (n as number) as record =>
        let
            Resp = Function.InvokeAfter(
                () => Web.Contents(Base, [
                    RelativePath = "servicios/v1/publico/" & recurso,
                    Query = consulta & [ticket = ticket],
                    ManualStatusHandling = {400, 401, 403, 404, 429, 500, 502, 503, 504},
                    IsRetry = n > 0,
                    Timeout = #duration(0, 0, 2, 0)
                ]),
                Pausa + #duration(0, 0, 0, Esperas{n})),
            Estado = try Value.Metadata(Resp)[Response.Status] otherwise 0,
            Json = try Json.Document(Resp, 65001) otherwise null,
            Ok = Estado = 200 and Json <> null and Value.Is(Json, type record) and Record.HasFields(Json, "Listado"),
            CodigoApi = if Json <> null and Value.Is(Json, type record) and Record.HasFields(Json, "Codigo") then Json[Codigo] else null,
            Mensaje = if Json <> null and Value.Is(Json, type record) and Record.HasFields(Json, "Mensaje") then Json[Mensaje] else "respuesta no es JSON"
        in
            [Ok = Ok, Estado = Estado, CodigoApi = CodigoApi, Mensaje = Mensaje, Json = Json,
             // 203 = ticket no válido: reintentar no sirve
             Reintentable = not Ok and CodigoApi <> 203 and (Estado = 429 or CodigoApi = 10500 or Estado >= 500 or Estado = 0 or Json = null)],
    Intentos = List.Generate(
        () => [i = 0, r = Intentar(0)],
        each [i] < List.Count(Esperas),
        each if [r][Ok] or not [r][Reintentable] then [i = List.Count(Esperas), r = [r]] else [i = [i] + 1, r = Intentar([i] + 1)],
        each [r]),
    Ultimo = List.Last(Intentos),
    Salida = if Ultimo[Ok] then Ultimo[Json][Listado]
             else error Error.Record("Mercado Público no respondió bien",
                 "HTTP " & Text.From(Ultimo[Estado]) & " · " & (if Ultimo[CodigoApi] = null then "" else "código " & Text.From(Ultimo[CodigoApi]) & " · ") & Text.From(Ultimo[Mensaje]),
                 [recurso = recurso])
in
    Salida
