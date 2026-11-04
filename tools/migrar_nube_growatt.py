#!/usr/bin/env python3
"""Migrar de la integración Growatt (nube) a GrowSnif sin perder el historial.

Las entidades locales del inversor heredan los entity_id de las de la nube. Home
Assistant guarda historial y estadísticas por entity_id, así que la misma serie
continúa (panel Energía incluido) y los paneles y automatizaciones que usaban las
entidades de la nube siguen funcionando, ahora con datos locales.

Sin --aplicar solo muestra el plan y comprueba los contadores: no cambia nada.

    python migrar_nube_growatt.py --url http://homeassistant.local:8123
    python migrar_nube_growatt.py --url http://homeassistant.local:8123 --aplicar

Necesita un token de larga duración de un usuario administrador
(Perfil -> Seguridad -> Tokens de acceso de larga duración). Solo usa la
biblioteca estándar de Python 3.8+ (funciona en Windows, Linux y macOS).

Qué hace con --aplicar, en este orden (se detiene en el primer error):
  1. Guarda en un .json el plan, las entidades y los paneles tal como estaban.
  2. Desactiva la integración Growatt (no la borra: se puede volver a activar).
  3. Quita del registro sus entidades, para liberar sus entity_id.
  4. Renombra cada entidad local de GrowSnif al entity_id de la nube que hereda.
  5. En los paneles, cambia las referencias a las entidades locales renombradas y a
     las de la nube que no tienen continuación directa por la que sí la tiene.
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
from datetime import datetime

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
CLOUD_DOMAIN = 'growatt_server'

# Clave del sensor en la integración Growatt -> clave del sensor en GrowSnif
CLOUD_MAP = {
    # Planta ("Total")
    'total_energy_output': 'energia_total',
    'total_energy_today': 'energia_hoy',
    'total_output_power': 'potencia_ac',
    # Inversor
    'inverter_energy_total': 'energia_total',
    'inverter_energy_today': 'energia_hoy',
    'inverter_current_wattage': 'potencia_ac',
    'inverter_internal_wattage': 'potencia_fv',
    'inverter_frequency': 'frecuencia',
    'inverter_temperature': 'temperatura_inversor',
    'inverter_ipm_temperature': 'temperatura_ipm',
    'inverter_current_reactive_wattage': 'reactiva',
}
for _n in (1, 2, 3):
    CLOUD_MAP['inverter_voltage_input_%d' % _n] = 'mppt%d_tension' % _n
    CLOUD_MAP['inverter_amperage_input_%d' % _n] = 'mppt%d_corriente' % _n
    CLOUD_MAP['inverter_wattage_input_%d' % _n] = 'mppt%d_potencia' % _n

STATUS_TEXT = {
    'hereda': 'hereda',
    'conflicto': 'sin continuación (ya la hereda otra)',
    'sin_local': 'sin continuación (GrowSnif no la tiene)',
    'sin_equivalente': 'sin continuación (no existe en local)',
    'unidad': 'sin continuación (unidad distinta)',
}


class HAError(Exception):
    pass


# ---------------------------------------------------------------- websocket


class WebSocket:
    """Minimal RFC 6455 client: text messages, ping/pong, fragmentation."""

    def __init__(self, url, timeout=60):
        u = urllib.parse.urlparse(url)
        if u.scheme not in ('http', 'https') or not u.hostname:
            raise HAError('la URL debe ser del tipo http://IP:8123')
        port = u.port or (443 if u.scheme == 'https' else 80)
        try:
            sock = socket.create_connection((u.hostname, port), timeout=timeout)
        except OSError as e:
            raise HAError('no puedo conectar con %s:%s (%s)' % (u.hostname, port, e))
        if u.scheme == 'https':
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=u.hostname)
        self.sock, self.buf = sock, b''
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path.rstrip('/') + '/api/websocket'
        sock.sendall(('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                      'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n'
                      % (path, u.hostname, port, key)).encode())
        while b'\r\n\r\n' not in self.buf:
            self._fill()
        head, self.buf = self.buf.split(b'\r\n\r\n', 1)
        lines = head.decode('latin-1').split('\r\n')
        if ' 101 ' not in lines[0] + ' ':
            raise HAError('Home Assistant no aceptó el websocket: ' + lines[0])
        headers = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(':') for ln in lines[1:])}
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        if headers.get('sec-websocket-accept') != accept:
            raise HAError('respuesta websocket inválida')

    def _fill(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise HAError('Home Assistant cerró la conexión')
        self.buf += chunk

    def _take(self, n):
        while len(self.buf) < n:
            self._fill()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    @staticmethod
    def _xor(data, mask):
        if not data:
            return b''
        m = (mask * (len(data) // 4 + 1))[:len(data)]
        return (int.from_bytes(data, 'big') ^ int.from_bytes(m, 'big')).to_bytes(len(data), 'big')

    def _send_frame(self, opcode, payload):
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += n.to_bytes(2, 'big')
        else:
            head.append(0x80 | 127)
            head += n.to_bytes(8, 'big')
        mask = os.urandom(4)
        self.sock.sendall(bytes(head) + mask + self._xor(payload, mask))

    def send(self, obj):
        self._send_frame(1, json.dumps(obj).encode())

    def recv(self):
        parts = []
        while True:
            b1, b2 = self._take(2)
            n = b2 & 0x7F
            if n == 126:
                n = int.from_bytes(self._take(2), 'big')
            elif n == 127:
                n = int.from_bytes(self._take(8), 'big')
            mask = self._take(4) if b2 & 0x80 else None
            data = self._take(n)
            if mask:
                data = self._xor(data, mask)
            op = b1 & 0x0F
            if op == 9:
                self._send_frame(10, data)
            elif op == 8:
                raise HAError('Home Assistant cerró la conexión')
            elif op in (0, 1, 2):
                parts.append(data)
                if b1 & 0x80:
                    return json.loads(b''.join(parts))

    def close(self):
        try:
            self._send_frame(8, b'')
            self.sock.close()
        except OSError:
            pass


class HA:
    def __init__(self, url, token):
        self.ws = WebSocket(url)
        self.n = 0
        try:
            self._auth(token)
        except BaseException:
            self.ws.close()
            raise

    def _auth(self, token):
        if self.ws.recv().get('type') != 'auth_required':
            raise HAError('respuesta inesperada de Home Assistant')
        self.ws.send({'type': 'auth', 'access_token': token})
        msg = self.ws.recv()
        if msg.get('type') != 'auth_ok':
            raise HAError('token rechazado: %s' % msg.get('message', msg))
        self.version = msg.get('ha_version', '?')

    def call(self, kind, **kw):
        self.n += 1
        self.ws.send(dict(kw, id=self.n, type=kind))
        while True:
            msg = self.ws.recv()
            if msg.get('id') == self.n and msg.get('type') == 'result':
                if not msg.get('success'):
                    err = msg.get('error') or {}
                    raise HAError('%s: %s' % (kind, err.get('message', err)))
                return msg.get('result')

    def try_call(self, kind, default=None, **kw):
        try:
            return self.call(kind, **kw)
        except HAError:
            return default


# ---------------------------------------------------------------- plan


def number(state):
    try:
        v = float(state['state'])
        return v if v == v else None
    except (TypeError, ValueError, KeyError):
        return None


def cloud_key(entry):
    tk = entry.get('translation_key')
    if tk in CLOUD_MAP:
        return tk
    uid = str(entry.get('unique_id') or '')
    for key in sorted(CLOUD_MAP, key=len, reverse=True):
        if uid.endswith(key):
            return key
    return None


def find_prefix(registry, wanted=None):
    mqtt = [e for e in registry if e.get('platform') == 'mqtt']
    found = sorted({str(e.get('unique_id'))[:-len('_limite_antivertido')] for e in mqtt
                    if str(e.get('unique_id') or '').endswith('_limite_antivertido')})
    if wanted:
        if wanted not in found:
            raise HAError('no encuentro entidades de GrowSnif con el prefijo %r (hay: %s)'
                          % (wanted, ', '.join(found) or 'ninguno'))
        return wanted
    if len(found) != 1:
        raise HAError('no encuentro un único inversor de GrowSnif (%s): usa --prefijo'
                      % (', '.join(found) or 'ninguno; ¿está activado inverter_enabled?'))
    return found[0]


def build_plan(registry, states, prefs, prefix, tolerance):
    st = {s['entity_id']: s for s in states}
    unit = lambda eid: (st.get(eid) or {}).get('attributes', {}).get('unit_of_measurement')  # noqa: E731
    local = {}
    for e in registry:
        uid = str(e.get('unique_id') or '')
        if e.get('platform') == 'mqtt' and uid.startswith(prefix + '_'):
            local[uid[len(prefix) + 1:]] = e['entity_id']
    cloud = [e for e in registry if e.get('platform') == CLOUD_DOMAIN]
    solar = {s.get('stat_energy_from') for s in (prefs or {}).get('energy_sources', []) if s.get('type') == 'solar'}

    groups = {}
    for e in cloud:
        groups.setdefault(e.get('device_id') or e.get('config_entry_id'), []).append(e)

    def priority(dev):
        ents = groups[dev]
        return (0 if any(e['entity_id'] in solar for e in ents) else 1,
                0 if any((cloud_key(e) or '').startswith('total_') for e in ents) else 1, str(dev))

    rows, taken = [], {}
    for dev in sorted(groups, key=priority):
        for e in sorted(groups[dev], key=lambda x: x['entity_id']):
            key = cloud_key(e)
            lk = CLOUD_MAP.get(key)
            row = {'cloud': e['entity_id'], 'cloud_key': key, 'local_key': lk, 'local': local.get(lk),
                   'cloud_value': number(st.get(e['entity_id'])), 'local_value': number(st.get(local.get(lk))),
                   'unit': unit(e['entity_id']), 'config_entry': e.get('config_entry_id'), 'problem': None}
            if lk is None:
                row['status'] = 'sin_equivalente'
            elif row['local'] is None:
                row['status'] = 'sin_local'
            elif lk in taken:
                row['status'], row['winner'] = 'conflicto', taken[lk]
            else:
                lu = unit(row['local'])
                if row['unit'] and lu and row['unit'] != lu:
                    row['status'] = 'unidad'
                    row['problem'] = '%s en la nube, %s en local' % (row['unit'], lu)
                else:
                    row['status'] = 'hereda'
                    taken[lk] = e['entity_id']
                    if 'energia' in lk:
                        c, v = row['cloud_value'], row['local_value']
                        if c is None or v is None:
                            row['problem'] = 'no puedo comparar los contadores (%s / %s)' % (
                                (st.get(e['entity_id']) or {}).get('state', 'sin estado'),
                                (st.get(row['local']) or {}).get('state', 'sin estado'))
                        elif abs(v - c) > tolerance:
                            row['problem'] = 'diferencia de %+.2f kWh (máximo %.2f)' % (v - c, tolerance)
            rows.append(row)
    final = {r['local_key']: r['cloud'] for r in rows if r['status'] == 'hereda'}
    replace = {r['local']: r['cloud'] for r in rows if r['status'] == 'hereda'}
    replace.update({r['cloud']: final[r['local_key']] for r in rows if r['status'] == 'conflicto'})
    entries = sorted({r['config_entry'] for r in rows if r['config_entry']})
    return {'prefix': prefix, 'rows': rows, 'replace': replace, 'config_entries': entries,
            'solar': sorted(x for x in solar if x)}


def id_pattern(ids):
    return re.compile(r'(?<![a-z0-9_])(%s)(?![a-z0-9_])' % '|'.join(map(re.escape, sorted(ids, key=len, reverse=True))))


def walk(obj, fn):
    if isinstance(obj, dict):
        return {k: walk(v, fn) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk(v, fn) for v in obj]
    if isinstance(obj, str):
        return fn(obj)
    return obj


def dashboards(ha):
    """[(url_path or None, title, config)] of the dashboards stored in the UI."""
    out = []
    listed = ha.try_call('lovelace/dashboards/list', default=[]) or []
    candidates = [(None, 'Inicio')] + [(d.get('url_path'), d.get('title') or d.get('url_path'))
                                       for d in listed if d.get('mode', 'storage') == 'storage']
    for url_path, title in candidates:
        kw = {} if url_path is None else {'url_path': url_path}
        cfg = ha.try_call('lovelace/config', **kw)
        if isinstance(cfg, dict) and cfg.get('views') is not None:
            out.append((url_path, title, cfg))
    return out


def count_refs(boards, ids):
    if not ids:
        return {}
    pat, found = id_pattern(ids), {}
    for url_path, title, cfg in boards:
        for m in pat.findall(json.dumps(cfg, ensure_ascii=False)):
            found.setdefault(m, set()).add(title)
    return found


# ---------------------------------------------------------------- output


def fmt(v):
    return '—' if v is None else ('%.2f' % v if abs(v) < 1e6 else '%.0f' % v)


def show(plan, refs_lost, related):
    rows = plan['rows']
    print('\nInversor de GrowSnif: prefijo %s' % plan['prefix'])
    if plan['solar']:
        print('Panel Energía, producción solar: %s' % ', '.join(plan['solar']))
    print('\n%-58s %-38s %14s %14s  %s' % ('Entidad de la nube (se conserva)', 'Entidad local que la hereda',
                                           'Nube', 'Local', 'Estado'))
    for r in rows:
        print('%-58s %-38s %14s %14s  %s%s' % (r['cloud'], r['local'] or '—', fmt(r['cloud_value']),
                                               fmt(r['local_value']), STATUS_TEXT[r['status']],
                                               ' · ' + r['problem'] if r['problem'] else ''))
    lost = [r for r in rows if r['status'] != 'hereda']
    if lost:
        print('\nLas que no tienen continuación conservan su historial y sus estadísticas en la base de datos,')
        print('pero dejan de actualizarse.')
        conflicts = [r for r in lost if r['status'] == 'conflicto']
        if conflicts:
            print('En los paneles, sus referencias pasan a la entidad que sí continúa:')
            for r in conflicts:
                print('  %s -> %s' % (r['cloud'], plan['replace'][r['cloud']]))
    broken = sorted(set(refs_lost))
    if broken:
        print('\nATENCIÓN: estas entidades sin continuación se usan en paneles y quedarán sin datos:')
        for eid in broken:
            print('  %s (paneles: %s)' % (eid, ', '.join(sorted(refs_lost[eid]))))
    users = {eid: v for eid, v in related.items() if v}
    if users:
        print('\nATENCIÓN: entidades sin continuación usadas en automatizaciones, scripts o escenas (revísalas):')
        for eid, items in sorted(users.items()):
            print('  %s: %s' % (eid, ', '.join(items)))


# ---------------------------------------------------------------- apply


def wait_gone(ha, ids, seconds=30):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        reg = {e['entity_id'] for e in ha.call('config/entity_registry/list')}
        live = {s['entity_id'] for s in ha.call('get_states')}
        if not (set(ids) & (reg | live)):
            return
        time.sleep(1)
    raise HAError('las entidades de la nube siguen registradas tras %d s' % seconds)


def apply(ha, plan, registry, boards, backup_path, patch_boards):
    cloud_ids = [r['cloud'] for r in plan['rows']]
    with open(backup_path, 'w', encoding='utf-8') as f:
        json.dump({'fecha': datetime.now().isoformat(timespec='seconds'), 'plan': plan,
                   'registro': [e for e in registry if e['entity_id'] in cloud_ids
                                or e['entity_id'] in plan['replace']],
                   'paneles': [{'url_path': u, 'titulo': t, 'config': c} for u, t, c in boards]},
                  f, ensure_ascii=False, indent=1)
    print('\n1. Copia del plan, entidades y paneles: %s' % backup_path)

    for entry in plan['config_entries']:
        ha.call('config_entries/disable', entry_id=entry, disabled_by='user')
    print('2. Integración Growatt desactivada (%d entrada/s). Se puede volver a activar.' % len(plan['config_entries']))
    time.sleep(2)

    for eid in cloud_ids:
        ha.call('config/entity_registry/remove', entity_id=eid)
    wait_gone(ha, cloud_ids)
    print('3. %d entidades de la nube quitadas del registro.' % len(cloud_ids))

    done = []
    for r in plan['rows']:
        if r['status'] != 'hereda':
            continue
        for attempt in range(3):
            try:
                ha.call('config/entity_registry/update', entity_id=r['local'], new_entity_id=r['cloud'])
                break
            except HAError:
                if attempt == 2:
                    raise
                time.sleep(2)
        done.append(r)
        print('   %s -> %s' % (r['local'], r['cloud']))
    print('4. %d entidades locales renombradas.' % len(done))

    if not patch_boards:
        print('5. Paneles sin tocar (--sin-paneles).')
        return
    pat = id_pattern(plan['replace']) if plan['replace'] else None
    changed = 0
    for url_path, title, cfg in boards:
        if not pat:
            break
        new = walk(cfg, lambda s: pat.sub(lambda m: plan['replace'][m.group(1)], s))
        if new != cfg:
            kw = {} if url_path is None else {'url_path': url_path}
            ha.call('lovelace/config/save', config=new, **kw)
            changed += 1
            print('   panel actualizado: %s' % title)
    print('5. %d paneles actualizados.' % changed)


# ---------------------------------------------------------------- main


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument('--url', required=True, help='URL de Home Assistant, p. ej. http://192.168.1.10:8123')
    ap.add_argument('--token', help='token de larga duración (si no, se pide o se lee de HA_TOKEN)')
    ap.add_argument('--prefijo', help='prefijo de entidades del inversor en GrowSnif (se detecta solo)')
    ap.add_argument('--tolerancia', type=float, default=10.0,
                    help='diferencia máxima entre contadores de energía nube/local, en kWh (10)')
    ap.add_argument('--aplicar', action='store_true', help='hacer la migración (sin esto solo muestra el plan)')
    ap.add_argument('--sin-paneles', action='store_true', help='no tocar los paneles')
    ap.add_argument('--si', action='store_true', help='no pedir confirmación')
    a = ap.parse_args(argv)
    token = a.token or os.environ.get('HA_TOKEN') or getpass.getpass('Token de Home Assistant: ')
    ha = None
    try:
        ha = HA(a.url, token.strip())
        print('Conectado a Home Assistant %s' % ha.version)
        registry = ha.call('config/entity_registry/list')
        states = ha.call('get_states')
        prefs = ha.try_call('energy/get_prefs', default={})
        prefix = find_prefix(registry, a.prefijo)
        plan = build_plan(registry, states, prefs, prefix, a.tolerancia)
        if not plan['rows']:
            print('No hay entidades de la integración Growatt (%s). Nada que migrar.' % CLOUD_DOMAIN)
            return 0
        boards = dashboards(ha)
        lost = [r['cloud'] for r in plan['rows'] if r['status'] not in ('hereda', 'conflicto')]
        refs_lost = count_refs(boards, lost)
        related = {}
        for eid in lost + [r['cloud'] for r in plan['rows'] if r['status'] == 'conflicto']:
            res = ha.try_call('search/related', default={}, item_type='entity', item_id=eid) or {}
            related[eid] = ['%s %s' % (k, x) for k in ('automation', 'script', 'scene') for x in res.get(k, [])]
        show(plan, refs_lost, related)

        problems = [r for r in plan['rows'] if r['status'] == 'hereda' and r['problem']]
        if problems:
            print('\nNO SE PUEDE MIGRAR: los contadores de energía no coinciden o no se pueden leer.')
            print('Una diferencia así contaría como producción de golpe en el panel Energía.')
            print('Espera a que el inversor y la nube estén actualizados (mejor de noche o a primera hora) o')
            print('ajusta --tolerancia si sabes por qué difieren.')
            return 2
        if not any(r['status'] == 'hereda' for r in plan['rows']):
            print('\nNinguna entidad local puede heredar a las de la nube. Nada que hacer.')
            return 2
        if not a.aplicar:
            print('\nTodo cuadra. Esto era una simulación: no se ha cambiado nada.')
            print('Haz una copia de seguridad de Home Assistant y repite con --aplicar.')
            return 0
        if not a.si:
            print('\nVas a desactivar la integración Growatt y renombrar las entidades locales.')
            print('¿Tienes una copia de seguridad de Home Assistant de hoy?')
            if input('Escribe MIGRAR para continuar: ').strip() != 'MIGRAR':
                print('Cancelado. No se ha cambiado nada.')
                return 1
        backup = 'migracion_growsnif_%s.json' % datetime.now().strftime('%Y%m%d_%H%M%S')
        apply(ha, plan, registry, boards, backup, not a.sin_paneles)
        print('\nHecho. Revisa mañana el panel Energía: si en la hora del cambio ves un escalón,')
        print('corrígelo en Herramientas para desarrolladores -> Estadísticas -> Ajustar una suma.')
        print('No borres las estadísticas "ya no proporcionadas": son el historial de las que no continúan.')
        return 0
    except (HAError, OSError, urllib.error.URLError) as e:
        print('\nERROR: %s' % e)
        print('Si ya había empezado a aplicar, el .json de copia tiene el estado anterior.')
        return 1
    finally:
        if ha:
            ha.ws.close()


if __name__ == '__main__':
    sys.exit(main())
