"""Anonimiza proveedores que parecen personas naturales antes de mostrar una muestra.

Heurística (conservadora: ante la duda, anonimiza):
  - Es EMPRESA si el nombre tiene forma societaria (SpA, S.A., Ltda., Limitada, EIRL, S.A.C., Cía., etc.)
    y no empieza con nombre de pila (p. ej. «FRANCISCO JAVIER ... E.I.R.L.» se anonimiza: lleva el nombre de una persona).
  - Es PERSONA si no tiene forma societaria, o si su RUT es menor a 50.000.000 (rango de personas naturales).
A las personas se les reemplaza el nombre por «Proveedor persona natural N» y el RUT por «(oculto)»,
en todas las hojas y en cualquier texto donde aparezca el nombre.
"""
import re, unicodedata

FORMA = re.compile(r'(\bS\.?\s?P\.?\s?A\.?$|\bSPA\b|\bS\.?\s?A\.?(\s|$)|\bSA$|\bLTDA\b|\bLIMITADA\b|\bE\.?\s?I\.?\s?R\.?\s?L\.?|\bS\.?A\.?C\.?\b|\bC[IÍ]A\.?\b|'
                   r'\bSOCIEDAD\b|\bCOOPERATIVA\b|\bCORPORACI[OÓ]N\b|\bFUNDACI[OÓ]N\b|\bASOCIACI[OÓ]N\b|\bINC\.?\b|\bS\.?\s?R\.?\s?L\.?\b|\bGMBH\b|\bLLC\b)', re.I)
NOMBRES_PILA = set('''ALEJANDRO ALEJANDRA ALBERTO ALFONSO ANA ANDRES ANDREA ANTONIO BEATRIZ CAMILA CARLOS CAROLINA CLAUDIA CLAUDIO CRISTIAN
CRISTINA DANIEL DANIELA DIEGO EDUARDO ELIZABETH ENRIQUE FELIPE FERNANDO FRANCISCA FRANCISCO GABRIEL GABRIELA GONZALO GUILLERMO HECTOR HUGO
HUMBERTO IGNACIO ISABEL JAIME JAVIER JORGE JOSE JUAN JULIO LUIS MANUEL MARCELA MARCELO MARCO MARIA MARIO MARTA MAURICIO MIGUEL MONICA
NELSON OSCAR PABLO PATRICIA PATRICIO PAULA PEDRO RAUL RICARDO ROBERTO RODRIGO SANDRA SEBASTIAN SERGIO SOLEDAD VERONICA VICTOR WASHINGTON'''.split())

def _sin_tildes(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').upper()

def rut_numero(rut):
    m = re.match(r'\s*([\d.]+)\s*-', str(rut or ''))
    return int(m.group(1).replace('.', '')) if m else None

def es_persona(nombre, rut=None):
    n = str(nombre or '').strip()
    if not n or n.startswith('Proveedor persona natural'): return False
    num = rut_numero(rut)
    if num is not None and num < 50_000_000: return True
    if not FORMA.search(n): return True
    primera = _sin_tildes(n).split()[0].strip(',.')
    return primera in NOMBRES_PILA   # empresa individual con nombre de persona

# (hoja, columna nombre, columna RUT) con encabezado en la fila 0
CAMPOS = [('Competencia', 7, 8), ('PBI_Competencia', 7, 8), ('Ítems', 9, 10), ('PBI_Items', 9, 10)]

def anonimizar(D):
    alias, ruts = {}, set()
    for hoja, cn, cr in CAMPOS:
        for fila in D.get(hoja, [])[1:]:
            nombre, rut = fila[cn], fila[cr]
            if es_persona(nombre, rut):
                if nombre not in alias: alias[nombre] = f'Proveedor persona natural {len(alias) + 1}'
                if rut: ruts.add(str(rut))
    def limpiar(v):
        if not isinstance(v, str) or not v: return v
        if not v.startswith('http'): v = limpiar_texto(v)
        if v in ruts: return '(oculto)'
        if v in alias: return alias[v]
        for nombre, a in alias.items():
            if nombre in v: v = v.replace(nombre, a)
        for r in ruts:
            if r in v: v = v.replace(r, '(oculto)')
        return v
    for hoja, filas in D.items():
        if isinstance(filas, list):
            D[hoja] = [[limpiar(c) for c in f] if isinstance(f, list) else f for f in filas]
    return alias, ruts

# ---------- Texto libre (descripciones de fichas): nombres de funcionarios, correos y teléfonos
_MAY = r"[A-ZÁÉÍÓÚÑ](?:[a-záéíóúñü'’-]+|\.)"          # palabra en Título o inicial («Andrés», «G.»)
_NOMBRE = rf"{_MAY}(?:\s+(?:de\s+la\s+|de\s+|del\s+)?{_MAY}){{0,4}}"
_HONOR = re.compile(rf"\b(?:Sr|Sra|Srta|Sres|Señor|Señora|Señorita|Don|Doña)\.?\s*\r?\n?\s*{_NOMBRE}")
_HONOR_MAY = re.compile(r"\b(?:SR|SRA|SRTA)\.\s*[A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+\.?){0,4}")
_ROL = re.compile(rf"\b((?:[Cc]ontactar\s+a|[Cc]omunicarse\s+con|[Cc]ontacto\s+con|[Aa]\s+cargo\s+de|[Ee]ncargad[oa]|[Cc]oordinador[a]?|[Cc]ontraparte(?:\s+t[eé]cnica)?|[Ii]nspector[a]?(?:\s+[Ff]iscal)?(?:\s+[Ss]uplente)?|[Ss]ubrogante|[Rr]eferente\s+t[eé]cnico|[Rr]esponsable)[:,]?\s+)(?!Sr|Sra|Don|Doña){_NOMBRE}")
_MAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
_NUM = r'(?:\+?\s?56[\s-]?)?(?:\(?\d{1,2}\)?[\s-]?)?\d{3,4}[\s.-]?\d{4}'
_FONO_CLAVE = re.compile(rf"(?i)(\b(?:tel[eé]fonos?|tel\.|fonos?|cel(?:ular)?\.?|whats?app|m[oó]vil|anexo|llamar\s+al|en\s+su\s+defecto\s+al|al\s+n[uú]mero|n[uú]mero\s+de\s+contacto)\b[^\d\n]{{0,30}}?)({_NUM}(?:\s*(?:/|y|o|-|,)\s*{_NUM})*)")
_FONO_56 = re.compile(r'\+\s?56[\s-]?\d[\d\s-]{7,11}\d')

def limpiar_texto(s):
    if not isinstance(s, str) or not s: return s
    if not re.search(r'[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}', s): return s   # códigos y números puros: no son texto libre
    s = _MAIL.sub('[correo omitido]', s)
    s = _HONOR.sub('[nombre omitido]', s)
    s = _HONOR_MAY.sub('[nombre omitido]', s)
    s = _ROL.sub(lambda m: m.group(1) + '[nombre omitido]' if sum(c.isupper() for c in m.group(0)[len(m.group(1)):]) >= 2 else m.group(0), s)
    s = _FONO_CLAVE.sub(lambda m: m.group(1) + '[teléfono omitido]', s)
    s = _FONO_56.sub('[teléfono omitido]', s)
    return s
