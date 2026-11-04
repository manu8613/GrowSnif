"""Print the CHANGELOG section of a version, for its GitHub release.

    python tools/release_notes.py 1.4.0
"""
import re
import sys
from pathlib import Path

version = sys.argv[1]
text = Path(__file__).resolve().parent.parent.joinpath('growsnif/CHANGELOG.md').read_text(encoding='utf-8')
m = re.search(r'^## %s\n(.*?)(?=^## |\Z)' % re.escape(version), text, re.S | re.M)
body = m.group(1).strip() if m else 'Sin notas para esta versión.'
branch = 'version-' + version.replace('.', '-')
print(body)
print()
print('---')
print()
print('Para instalar exactamente esta versión en Home Assistant, añade el repositorio '
      '`https://github.com/manu8613/GrowSnif#%s` (ver DOCS.md, sección 10).' % branch)
print()
print('GrowSnif, creado por manu8613.')
