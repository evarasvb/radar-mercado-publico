// Desde_CSV_Publicado · Lee las hojas PBI_* de la planilla Google publicadas como CSV (Archivo › Compartir › Publicar en la Web).
// Sin ticket en Power BI: Google Sheets hace las consultas a la API y Power BI solo lee el resultado.
// Pega tu enlace en UrlPBI_Licitaciones (parámetro). Repite esta consulta para PBI_Items y PBI_Competencia.
let
    Url = UrlPBI_Licitaciones,   // ej.: https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=123&single=true&output=csv
    Origen = Csv.Document(Web.Contents(Url, [Timeout = #duration(0, 0, 2, 0)]), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Encabezados = Table.PromoteHeaders(Origen, [PromoteAllScalars = true]),
    Verifica = if Table.HasColumns(Encabezados, {"codigo", "puntaje", "fecha_cierre"}) then Encabezados
               else error "El CSV no tiene las columnas esperadas: ¿publicaste la hoja PBI_Licitaciones?",
    Tipos = Table.TransformColumnTypes(Verifica, {
        {"puntaje", Int64.Type}, {"monto_estimado", type number}, {"n_items", Int64.Type},
        {"fecha_publicacion", type datetime}, {"fecha_cierre", type datetime}, {"fecha_adjudicacion", type datetime}, {"detectada", type datetime}}, "en-US"),
    DiasAlCierre = Table.AddColumn(Tipos, "dias_al_cierre", each if [fecha_cierre] = null then null else Number.Round(Duration.TotalDays([fecha_cierre] - DateTime.LocalNow()), 1), type number)
in
    DiasAlCierre
