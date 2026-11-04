"""Tests of tools/migrar_nube_growatt.py against a fake Home Assistant on 127.0.0.1.

The fake speaks the real websocket protocol (handshake, masked frames, auth) and
implements the commands the tool uses. All data is synthetic.
Run: python test_migrar.py [-v]
"""
import base64
import contextlib
import copy
import hashlib
import io
import json
import os
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
import migrar_nube_growatt as mig  # noqa: E402

TOKEN = 'secreto'


def ent(eid, platform, uid, entry=None, device=None, tk=None):
    return {'entity_id': eid, 'platform': platform, 'unique_id': uid, 'config_entry_id': entry,
            'device_id': device, 'translation_key': tk, 'disabled_by': None}


def st(eid, state, unit=None):
    return {'entity_id': eid, 'state': str(state), 'attributes': {'unit_of_measurement': unit} if unit else {}}


def world(local_total=140385.4):
    reg = [
        ent('sensor.planta_total_salida_vida_util', 'growatt_server', '123-total_energy_output', 'E1', 'P'),
        ent('sensor.planta_total_energia_hoy', 'growatt_server', '123-total_energy_today', 'E1', 'P'),
        ent('sensor.planta_total_potencia_de_salida', 'growatt_server', '123-total_output_power', 'E1', 'P'),
        ent('sensor.planta_total_dinero_hoy', 'growatt_server', '123-total_money_today', 'E1', 'P'),
        ent('sensor.inv_cloud_potencia_de_salida', 'growatt_server', 'SN1-inverter_current_wattage', 'E1', 'I'),
        ent('sensor.inv_cloud_vida_util', 'growatt_server', 'SN1-inverter_energy_total', 'E1', 'I'),
        ent('sensor.inv_cloud_entrada_1_voltaje', 'growatt_server', 'SN1-inverter_voltage_input_1', 'E1', 'I'),
        ent('sensor.inv_cloud_temperatura_ipm', 'growatt_server', 'SN1-inverter_ipm_temperature', 'E1', 'I'),
        ent('sensor.loc_energia_total', 'mqtt', 'loc_energia_total'),
        ent('sensor.loc_energia_hoy', 'mqtt', 'loc_energia_hoy'),
        ent('sensor.loc_potencia_ac', 'mqtt', 'loc_potencia_ac'),
        ent('sensor.loc_mppt1_tension', 'mqtt', 'loc_mppt1_tension'),
        ent('sensor.loc_temperatura_ipm', 'mqtt', 'loc_temperatura_ipm'),
        ent('sensor.loc_limite_antivertido', 'mqtt', 'loc_limite_antivertido'),
        ent('sensor.otra_cosa', 'mqtt', 'otra_cosa'),
    ]
    states = [
        st('sensor.planta_total_salida_vida_util', 140385.09, 'kWh'),
        st('sensor.planta_total_energia_hoy', 50.2, 'kWh'),
        st('sensor.planta_total_potencia_de_salida', 30000, 'W'),
        st('sensor.planta_total_dinero_hoy', 3.1, '¥'),
        st('sensor.inv_cloud_potencia_de_salida', 30000, 'W'),
        st('sensor.inv_cloud_vida_util', 140385.0, 'kWh'),
        st('sensor.inv_cloud_entrada_1_voltaje', 610, 'V'),
        st('sensor.inv_cloud_temperatura_ipm', 34, '°C'),
        st('sensor.loc_energia_total', local_total, 'kWh'),
        st('sensor.loc_energia_hoy', 51.0, 'kWh'),
        st('sensor.loc_potencia_ac', 30500, 'W'),
        st('sensor.loc_mppt1_tension', 612, 'V'),
        st('sensor.loc_temperatura_ipm', 34.2, 'K'),
        st('sensor.loc_limite_antivertido', 100, '%'),
    ]
    boards = {None: {'views': [{'cards': [
        {'type': 'entities', 'entities': ['sensor.planta_total_salida_vida_util', 'sensor.inv_cloud_potencia_de_salida',
                                          'sensor.inv_cloud_temperatura_ipm']},
        {'type': 'markdown', 'content': "{{ states('sensor.loc_potencia_ac') }} W · {{ states.sensor.loc_energia_hoy.state }}"},
        {'type': 'entity', 'entity': 'sensor.loc_potencia_ac_extra'}]}]},
              'panel-yaml': None}
    prefs = {'energy_sources': [{'type': 'grid'}, {'type': 'solar', 'stat_energy_from': 'sensor.planta_total_salida_vida_util'}]}
    related = {'sensor.inv_cloud_temperatura_ipm': {'automation': ['automation.aviso_temperatura']}}
    return {'reg': reg, 'states': states, 'boards': boards, 'prefs': prefs, 'related': related,
            'disabled': set(), 'calls': []}


class FakeHA:
    def __init__(self, data):
        self.data = data
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.url = 'http://127.0.0.1:%d' % self.server.getsockname()[1]
        threading.Thread(target=self.loop, daemon=True).start()

    def loop(self):
        while True:
            try:
                c, _ = self.server.accept()
            except OSError:
                return
            threading.Thread(target=self.client, args=(c,), daemon=True).start()

    def client(self, c):
        try:
            with c:
                buf = b''
                while b'\r\n\r\n' not in buf:
                    buf += c.recv(4096)
                head, self.rest = buf.split(b'\r\n\r\n', 1)
                key = [ln.split(':', 1)[1].strip() for ln in head.decode().split('\r\n')
                       if ln.lower().startswith('sec-websocket-key')][0]
                accept = base64.b64encode(hashlib.sha1((key + mig.GUID).encode()).digest()).decode()
                c.sendall(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           'Sec-WebSocket-Accept: %s\r\n\r\n' % accept).encode())
                self.c = c
                self.send({'type': 'auth_required'})
                if self.recv().get('access_token') != TOKEN:
                    self.send({'type': 'auth_invalid', 'message': 'Invalid access token'})
                    return
                self.send({'type': 'auth_ok', 'ha_version': '2026.10.4'})
                self.send_ping = True
                while True:
                    msg = self.recv()
                    if msg is None:
                        return
                    self.handle(msg)
        except (OSError, IndexError):
            pass

    def take(self, n):
        while len(self.rest) < n:
            chunk = self.c.recv(65536)
            if not chunk:
                raise OSError
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def recv(self):
        b1, b2 = self.take(2)
        assert b2 & 0x80, 'client frames must be masked'
        n = b2 & 0x7F
        if n == 126:
            n = int.from_bytes(self.take(2), 'big')
        elif n == 127:
            n = int.from_bytes(self.take(8), 'big')
        mask = self.take(4)
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(self.take(n)))
        if b1 & 0x0F == 8:
            return None
        if b1 & 0x0F == 10:
            return self.recv()
        return json.loads(data)

    def send(self, obj, fragments=1):
        data = json.dumps(obj).encode()
        size = max(1, len(data) // fragments + 1)
        pieces = [data[i:i + size] for i in range(0, len(data), size)] or [b'']
        for i, p in enumerate(pieces):
            op = 1 if i == 0 else 0
            fin = 0x80 if i == len(pieces) - 1 else 0
            n = len(p)
            head = bytes([fin | op]) + (bytes([n]) if n < 126 else bytes([126]) + n.to_bytes(2, 'big')
                                        if n < 65536 else bytes([127]) + n.to_bytes(8, 'big'))
            self.c.sendall(head + p)

    def result(self, msg, result=None, error=None):
        if getattr(self, 'send_ping', False):
            self.c.sendall(b'\x89\x02hi')        # a ping in the middle: the client must pong
            self.send_ping = False
        if error:
            self.send({'id': msg['id'], 'type': 'result', 'success': False, 'error': {'message': error}})
        else:
            self.send({'id': msg['id'], 'type': 'result', 'success': True, 'result': result}, fragments=3)

    def handle(self, m):
        d, kind = self.data, m['type']
        d['calls'].append(kind)
        reg = {e['entity_id']: e for e in d['reg']}
        if kind == 'config/entity_registry/list':
            return self.result(m, d['reg'])
        if kind == 'get_states':
            return self.result(m, d['states'])
        if kind == 'energy/get_prefs':
            return self.result(m, d['prefs'])
        if kind == 'lovelace/dashboards/list':
            return self.result(m, [{'url_path': 'panel-yaml', 'mode': 'yaml', 'title': 'YAML'}])
        if kind == 'lovelace/config':
            cfg = d['boards'].get(m.get('url_path'))
            return self.result(m, cfg) if cfg else self.result(m, error='config_not_found')
        if kind == 'lovelace/config/save':
            d['boards'][m.get('url_path')] = m['config']
            return self.result(m)
        if kind == 'search/related':
            return self.result(m, d['related'].get(m['item_id'], {}))
        if kind == 'config_entries/disable':
            d['disabled'].add(m['entry_id'])
            for e in d['reg']:
                if e['config_entry_id'] == m['entry_id']:
                    e['disabled_by'] = 'config_entry'
            d['states'] = [s for s in d['states'] if reg.get(s['entity_id'], {}).get('config_entry_id')
                           != m['entry_id']]
            return self.result(m)
        if kind == 'config/entity_registry/remove':
            e = reg.get(m['entity_id'])
            if e is None:
                return self.result(m, error='Entity not found')
            if e['config_entry_id'] and e['config_entry_id'] not in d['disabled']:
                return self.result(m, error='Entity is provided by a loaded integration')
            d['reg'].remove(e)
            return self.result(m)
        if kind == 'config/entity_registry/update':
            new = m['new_entity_id']
            if new in reg or any(s['entity_id'] == new for s in d['states']):
                return self.result(m, error='Entity with this ID is already registered')
            reg[m['entity_id']]['entity_id'] = new
            for s in d['states']:
                if s['entity_id'] == m['entity_id']:
                    s['entity_id'] = new
            return self.result(m, {'entity_entry': reg[m['entity_id']]})
        return self.result(m, error='Unknown command ' + kind)

    def close(self):
        self.server.close()


def run(data, *args):
    ha = FakeHA(data)
    out = io.StringIO()
    with tempfile.TemporaryDirectory() as tmp, contextlib.redirect_stdout(out):
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            code = mig.main(['--url', ha.url, '--token', TOKEN] + list(args))
            backups = [json.load(open(f, encoding='utf-8')) for f in os.listdir(tmp) if f.endswith('.json')]
        finally:
            os.chdir(cwd)
            ha.close()
    return code, out.getvalue(), backups


class MigrationTests(unittest.TestCase):
    def test_dry_run_changes_nothing(self):
        data = world()
        before = copy.deepcopy((data['reg'], data['states'], data['boards']))
        code, out, backups = run(data)
        self.assertEqual(code, 0, out)
        self.assertEqual(before, (data['reg'], data['states'], data['boards']))
        self.assertEqual(backups, [])
        self.assertIn('simulación', out)
        self.assertIn('automation.aviso_temperatura', out)           # unit mismatch -> lost -> used
        self.assertIn('sensor.inv_cloud_temperatura_ipm (paneles: Inicio)', out)
        for kind in data['calls']:
            self.assertIn(kind, ('config/entity_registry/list', 'get_states', 'energy/get_prefs',
                                 'lovelace/dashboards/list', 'lovelace/config', 'search/related'))

    def test_counters_that_differ_block(self):
        data = world(local_total=143112.1)       # FV total instead of AC total: must not migrate
        code, out, _ = run(data, '--aplicar', '--si')
        self.assertEqual(code, 2, out)
        self.assertIn('+2727.01 kWh', out)
        self.assertNotIn('config_entries/disable', data['calls'])

    def test_wrong_token(self):
        code, out, _ = run(world(), '--token', 'malo')
        self.assertEqual(code, 1)
        self.assertIn('token rechazado', out)

    def test_apply(self):
        data = world()
        code, out, backups = run(data, '--aplicar', '--si')
        self.assertEqual(code, 0, out)
        ids = {e['entity_id']: e for e in data['reg']}
        uid = {e['unique_id']: e['entity_id'] for e in data['reg']}
        # The plant wins (it is the one in the Energy panel)
        self.assertEqual(uid['loc_energia_total'], 'sensor.planta_total_salida_vida_util')
        self.assertEqual(uid['loc_energia_hoy'], 'sensor.planta_total_energia_hoy')
        self.assertEqual(uid['loc_potencia_ac'], 'sensor.planta_total_potencia_de_salida')
        self.assertEqual(uid['loc_mppt1_tension'], 'sensor.inv_cloud_entrada_1_voltaje')
        self.assertEqual(uid['loc_temperatura_ipm'], 'sensor.loc_temperatura_ipm')    # unit mismatch: untouched
        self.assertEqual(uid['loc_limite_antivertido'], 'sensor.loc_limite_antivertido')
        self.assertTrue(all(e['platform'] != 'growatt_server' for e in ids.values()))
        self.assertEqual(data['disabled'], {'E1'})
        cards = data['boards'][None]['views'][0]['cards']
        self.assertEqual(cards[0]['entities'], ['sensor.planta_total_salida_vida_util',
                                                'sensor.planta_total_potencia_de_salida',     # loser redirected
                                                'sensor.inv_cloud_temperatura_ipm'])          # lost, reported
        self.assertEqual(cards[1]['content'], "{{ states('sensor.planta_total_potencia_de_salida') }} W · "
                                              "{{ states.sensor.planta_total_energia_hoy.state }}")
        self.assertEqual(cards[2]['entity'], 'sensor.loc_potencia_ac_extra')                 # not a whole id
        self.assertEqual(len(backups), 1)
        self.assertEqual(len(backups[0]['registro']), 12)   # 8 de la nube + 4 locales renombradas
        self.assertIn('views', backups[0]['paneles'][0]['config'])

    def test_apply_needs_confirmation(self):
        data = world()
        ha_input = mig.__builtins__['input'] if isinstance(mig.__builtins__, dict) else mig.__builtins__.input
        try:
            import builtins
            builtins.input = lambda prompt='': 'no'
            code, out, _ = run(data, '--aplicar')
        finally:
            builtins.input = ha_input
        self.assertEqual(code, 1)
        self.assertNotIn('config_entries/disable', data['calls'])

    def test_prefix_detection(self):
        reg = world()['reg'] + [ent('sensor.b_limite_antivertido', 'mqtt', 'b_limite_antivertido')]
        with self.assertRaises(mig.HAError):
            mig.find_prefix(reg)
        self.assertEqual(mig.find_prefix(reg, 'b'), 'b')
        self.assertEqual(mig.find_prefix(world()['reg']), 'loc')


if __name__ == '__main__':
    unittest.main()
