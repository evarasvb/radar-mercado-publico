# Prompt para construir tu Radar MP desde cero con IA (Claude, ChatGPT u otro asistente)

**Cómo usarlo.** Copia el bloque de abajo en una conversación nueva. Completa lo que va entre `<< >>`. Después pídele a la IA que avance **una etapa a la vez** y no pases a la siguiente sin probar la anterior en tu planilla. **Nunca pegues tu ticket en el chat:** el script lo pide desde un menú y lo guarda en las propiedades del script. Si quieres comparar con una implementación que ya funciona, este repositorio trae la versión básica (`basico/Code.gs`) y la Pro (`pro/apps_script/Code.gs`).

---

```text
Actúa como desarrollador senior de Google Apps Script (V8) y analista de compras públicas en Chile.
Vamos a construir, paso a paso, un "radar de oportunidades" de Mercado Público dentro de una planilla
de Google Sheets. Yo no programo: explícame cada paso en español de Chile, simple, y dame siempre el
archivo COMPLETO para copiar y pegar (no fragmentos sueltos).

## Mi negocio
- Qué vendo: <<describe tus productos o servicios>>
- Palabras clave como las escribe el comprador, con peso de 1 a 5: <<ej.: aseo* 3, limpieza 3, mantencion* 2>>
- Palabras que descartan una licitación: <<ej.: vehiculo*, ascensor*>>
- Regiones de interés: <<ej.: Biobío, Ñuble>> · Rango de montos: <<mín>> a <<máx>> CLP
- Organismos que me interesan (código numérico, si lo sé): <<ej.: 7248>>
- Correo para el resumen diario: <<tu correo>> · Tipo de cuenta: <<gmail.com o Google Workspace>>

## Fuente de datos: API pública de Mercado Público (https://www.chilecompra.cl/api/)
- Base: https://api.mercadopublico.cl/servicios/v1/publico/
- licitaciones.json?estado=activas&ticket=… → lista de activas (CodigoExterno, Nombre, CodigoEstado, FechaCierre).
- licitaciones.json?codigo=XXXX&ticket=… → ficha completa: Comprador (organismo, unidad, región, comuna),
  Tipo, MontoEstimado (úsalo solo si VisibilidadMonto = 1), Moneda, Fechas.FechaCierre/FechaPublicacion,
  Items.Listado (CodigoProducto UNSPSC, Categoria, NombreProducto, Descripcion, Cantidad, Adjudicacion).
- licitaciones.json?fecha=ddmmaaaa&estado=adjudicada → adjudicadas de un día.
- ordenesdecompra.json?fecha=ddmmaaaa&CodigoOrganismo=N → órdenes de compra; ?codigo=… da el detalle
  (Proveedor, Items.Listado con Producto, Cantidad, PrecioNeto; ojo: a veces Total viene en 0).
- Límites: 10.000 consultas diarias por ticket. Están PROHIBIDAS las peticiones simultáneas (HTTP 429,
  código 10500): una consulta a la vez, con pausa y reintentos con espera creciente. Código 203 = ticket
  inválido (no reintentar). ChileCompra recomienda descargas masivas entre 22:00 y 07:00.
- Los nombres de región traen espacios al final: normaliza (trim, sin tildes, minúsculas) antes de comparar.

## Límites de Google Apps Script (verifica la página oficial de cuotas)
- 6 minutos por ejecución. Activadores: 90 min/día en gmail.com (6 h en Workspace). Correos: 100
  destinatarios/día en gmail.com. Propiedades: máximo 9 KB por valor.
- Por eso: trabajar en lotes de ~4,5 minutos, guardar el avance en PropertiesService o en una hoja
  oculta, y programar un activador de continuación. Usar LockService para que no corran dos ejecuciones.

## Reglas que no se negocian
1. El ticket se guarda con un menú en PropertiesService. Nunca en la planilla, el código ni los logs:
   enmascáralo en todo mensaje de error.
2. Una consulta fallida se registra como FALLA y avisa por correo. Nunca se informa como "sin novedades".
3. No duplicar: CodigoExterno es la clave. El script nunca sobrescribe las columnas que llena el equipo.
4. No guardar datos personales que no necesito (contactos de las fichas: nombres, correos, teléfonos).
5. Toda afirmación sobre la API o los límites se verifica en la documentación oficial; si algo no está
   confirmado, dímelo en vez de suponerlo.

## Etapas (entrega una, espera mi "funcionó" y sigue)
1. Planilla base: hojas Configuración, Licitaciones, Registro; menú; guardar y probar ticket.
2. Descarga de activas + filtro por palabras clave (con comodín *) y exclusiones + registro de cada corrida.
3. Lectura de fichas en lotes reanudables, con caché y tope diario; columnas de ficha completa.
4. Puntaje de 0 a 100 con columna "Motivos" (nombre ×12, descripción ×8, ítems ×6 por peso; región,
   organismo, monto y días al cierre suman o restan).
5. Pipeline (Nueva/Revisar/Postular/Postulada/Ganada/Perdida/Descartada) con validación de datos,
   formato condicional e Historial de cambios (onEdit + cambios detectados por el script).
6. Competencia: órdenes de compra de mis organismos y adjudicaciones de mi rubro (proveedor, producto,
   cantidad, precio unitario, n.º de oferentes). Seguimiento de mis postulaciones cerradas.
7. Dashboard: KPIs, QUERY/FILTER/SPARKLINE, gráficos (región, organismo, rubro, tramo de monto,
   cierres próximos 7 días), controles con validación de datos y segmentadores.
8. Correo diario en HTML y activador diario; instalador de un clic que crea hojas y activadores.
9. Exportación para Power BI (hojas planas con fechas ISO) y consulta Power Query (M) equivalente con
   manejo de errores y paginación por fecha.
10. Pruebas: un simulador mínimo de Apps Script en Node.js para probar sin internet, más una prueba
    real con pocas fichas. Muéstrame cómo correrlas.

Al final de cada etapa dime: qué cambió, cómo lo pruebo en 3 pasos, qué puede fallar y qué no verificaste.
```

---

## Siguientes pasos para quienes se entusiasman

- **Más datos de los que aguanta una planilla.** Google Sheets tiene un tope de 10 millones de celdas por archivo. Para guardar el histórico diario de la API, usa una base de datos (por ejemplo, Postgres en Supabase), una función programada que descargue de noche y un tablero web (por ejemplo, en Vercel), con el código versionado en GitHub. Pídele a la IA esa arquitectura «etapa por etapa», igual que arriba.
- **Seguridad y datos personales.** Usa claves en variables de entorno, nunca en el código. Activa la seguridad a nivel de fila (RLS) en la base, da acceso mínimo y guarda solo los datos personales que necesitas, conforme a la Ley 19.628 y a la Ley 21.719.
- **Revisión humana.** La IA escribe código rápido, pero tú decides. Prueba con pocos datos, revisa el registro y lee las bases antes de postular.

¿Prefieres que te lo armemos? WhatsApp +56 9 9099 6055 · evaras@firmavb.cl
