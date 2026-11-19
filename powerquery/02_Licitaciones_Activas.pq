// Licitaciones_Activas · Lista de licitaciones publicadas hoy (4 campos) + calce por palabras clave en el nombre.
// En Power BI: reemplaza las líneas con Excel.CurrentWorkbook() como indica POWER_BI.md (sección 2).
// Requiere: fnMP, Ticket (parámetro texto) y la tabla «PalabrasClave» (columnas Palabra, Peso) en el libro.
let
    Lista = fnMP("licitaciones.json", [estado = "activas"], Ticket),
    Tabla = Table.FromRecords(Lista, {"CodigoExterno", "Nombre", "CodigoEstado", "FechaCierre"}, MissingField.UseNull),
    Tipos = Table.TransformColumnTypes(Tabla, {{"CodigoExterno", type text}, {"Nombre", type text}, {"CodigoEstado", Int64.Type}, {"FechaCierre", type datetime}}, "en-US"),
    Claves = try Table.TransformColumnTypes(Excel.CurrentWorkbook(){[Name = "PalabrasClave"]}[Content], {{"Palabra", type text}, {"Peso", type number}}) otherwise #table({"Palabra", "Peso"}, {{"aseo", 3}, {"limpieza", 3}}),
    Normalizar = (t as nullable text) as text =>
        " " & Text.Combine(List.Select(Text.SplitAny(Text.Lower(Text.Remove(Text.Replace(Text.Replace(Text.Replace(Text.Replace(Text.Replace(t ?? "", "á", "a"), "é", "e"), "í", "i"), "ó", "o"), "ú", "u"), {"*"})), " ,.;:-_/()""'"), each _ <> ""), " ") & " ",
    ConPuntaje = Table.AddColumn(Tipos, "PuntajeNombre", (fila) =>
        List.Sum(List.Transform(Table.ToRecords(Claves), (k) =>
            let p = Text.Lower(Text.Trim(k[Palabra])), pref = Text.EndsWith(p, "*"), kk = Text.Trim(Normalizar(Text.TrimEnd(p, "*"))), n = Normalizar(Text.Lower(fila[Nombre]))
            in if kk <> "" and (if pref then Text.Contains(n, " " & kk) else Text.Contains(n, " " & kk & " ")) then k[Peso] * 12 else 0)) ?? 0, type number),
    Calzan = Table.SelectRows(ConPuntaje, each [PuntajeNombre] > 0),
    Orden = Table.Sort(Calzan, {{"PuntajeNombre", Order.Descending}, {"FechaCierre", Order.Ascending}})
in
    Orden
