"""Convierte respuestas reales de la API de Mercado Público en fixtures SIN datos personales.

- Borra contactos y usuarios (nombre, correo, teléfono, cargo, RUT de usuario) del comprador y del proveedor,
  y los responsables de contrato y de pago.
- Los proveedores que parecen personas naturales (misma heurística que muestra/anonimizar.py)
  pasan a «Proveedor persona natural N», con un RUT ficticio consistente entre archivos.
- En todo texto libre se eliminan correos, teléfonos y nombres de funcionarios (heurística de muestra/anonimizar.py).
Uso: python3 sanear_fixtures.py <carpeta_origen> <carpeta_destino>
"""
import json, os, re, sys, glob
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pro', 'muestra'))
from anonimizar import es_persona, limpiar_texto

BORRAR = {'NombreContacto', 'MailContacto', 'FonoContacto', 'CargoContacto', 'NombreUsuario', 'RutUsuario', 'CodigoUsuario',
          'CargoUsuario', 'NombreResponsableContrato', 'EmailResponsableContrato', 'FonoResponsableContrato',
          'NombreResponsablePago', 'EmailResponsablePago', 'DireccionEntrega', 'DireccionVisita', 'Direccion'}
MAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
FONO = re.compile(r'(\+?56[\s-]?)?\(?\b(9|2|[3-7]\d)\)?[\s-]?\d{3,4}[\s-]?\d{4}\b')
alias, ruts = {}, {}

def alias_de(nombre, rut):
    if nombre not in alias:
        n = len(alias) + 1
        alias[nombre] = f'Proveedor persona natural {n}'
        ruts[rut] = f'{10_000_000 + n:,}'.replace(',', '.') + '-0'
    if rut and rut not in ruts: ruts[rut] = ruts.get(rut) or f'{10_000_000 + len(ruts) + 1:,}'.replace(',', '.') + '-0'
    return alias[nombre], ruts.get(rut, '')

def proveedor(o, kn, kr):
    if kn in o and es_persona(o.get(kn), o.get(kr)):
        o[kn], r = alias_de(o[kn], o.get(kr))
        if kr in o: o[kr] = r
        if 'NombreSucursal' in o: o['NombreSucursal'] = o[kn]

def texto(s):
    return s if s.startswith('http') else limpiar_texto(s)

def limpiar(o):
    if isinstance(o, dict):
        for k in list(o):
            if k in BORRAR: o[k] = ''
        proveedor(o, 'NombreProveedor', 'RutProveedor')      # ítems adjudicados
        if 'RutSucursal' in o: proveedor(o, 'Nombre', 'RutSucursal')  # Proveedor de una OC
        for k, v in o.items(): o[k] = limpiar(v)
        return o
    if isinstance(o, list): return [limpiar(v) for v in o]
    if isinstance(o, str):
        s = texto(o)
        for n, a in alias.items():
            if n in s: s = s.replace(n, a)
        return s
    return o

def main(org, dst):
    os.makedirs(dst, exist_ok=True)
    archivos = sorted(f for f in glob.glob(os.path.join(org, '*.json')) if not os.path.basename(f).startswith('_'))
    datos = {f: json.load(open(f)) for f in archivos}
    for _ in range(2):  # 2 pasadas: la 2.ª reemplaza nombres de personas que aparecen en texto libre de otros archivos
        for f in archivos: datos[f] = limpiar(datos[f])
    for f in archivos:
        txt = json.dumps(datos[f], ensure_ascii=False)
        for r_real, r_fict in ruts.items():
            if r_real: txt = txt.replace(r_real, r_fict)
        open(os.path.join(dst, os.path.basename(f)), 'w').write(txt)
    print(f'{len(archivos)} archivos saneados · {len(alias)} proveedores persona natural anonimizados')

if __name__ == '__main__': main(sys.argv[1], sys.argv[2])
