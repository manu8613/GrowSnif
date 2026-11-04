"""Panel installer tests: config generation, resource, dashboard modes, backups.

Uses a fake Home Assistant (lovelace commands) and, for the websocket client, the
fake server of test_migrar.py. Needs paho-mqtt (main.py is imported for the defaults).
Run: python test_panel.py [-v]
"""
import copy
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'growsnif'))
sys.path.insert(0, str(ROOT / 'tests'))
import panel  # noqa: E402
from haws import HAError, HAWebSocket  # noqa: E402

try:
    import main
except ModuleNotFoundError:
    main = None


class FakeLovelace:
    def __init__(self, resources=None, boards=None, configs=None):
        self.resources = resources or []
        self.boards = boards or []
        self.configs = configs or {}
        self.calls = []
        self.closed = False

    def call(self, kind, **kw):
        self.calls.append((kind, kw))
        if kind == 'lovelace/resources':
            return copy.deepcopy(self.resources)
        if kind == 'lovelace/resources/create':
            self.resources.append({'id': 'r%d' % (len(self.resources) + 1), 'type': kw['res_type'], 'url': kw['url']})
            return self.resources[-1]
        if kind == 'lovelace/resources/update':
            r = next(r for r in self.resources if r['id'] == kw['resource_id'])
            r.update(type=kw['res_type'], url=kw['url'])
            return r
        if kind == 'lovelace/resources/delete':
            self.resources = [r for r in self.resources if r['id'] != kw['resource_id']]
            return None
        if kind == 'lovelace/dashboards/list':
            return copy.deepcopy(self.boards)
        if kind == 'lovelace/dashboards/create':
            b = dict(kw, id=kw['url_path'])
            self.boards.append(b)
            return b
        if kind == 'lovelace/dashboards/update':
            b = next(b for b in self.boards if b['id'] == kw['dashboard_id'])
            b.update({k: v for k, v in kw.items() if k != 'dashboard_id'})
            return b
        if kind == 'lovelace/config':
            if kw['url_path'] not in self.configs:
                raise HAError('No config found.', 'config_not_found')
            return copy.deepcopy(self.configs[kw['url_path']])
        if kind == 'lovelace/config/save':
            self.configs[kw['url_path']] = copy.deepcopy(kw['config'])
            return None
        raise HAError('unknown ' + kind, 'unknown_command')

    def close(self):
        self.closed = True


def opts(**kw):
    o = dict(main.DEFAULTS, gateway_host='gw', id_prefix='red', inverter_enabled=True, inverter_id_prefix='inv',
             inverter_mppts=4, inverter_strings=8, panel_install=True)
    o.update(kw)
    return o


@unittest.skipIf(main is None, 'paho-mqtt no instalado')
class PanelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_install(self, ha, **kw):
        return panel.install(opts(**kw), '9.9.9', lambda: ha, self.dir)

    def test_config_from_options(self):
        lines = [{'name': 'Oficinas', 'power': 'sensor.of_p', 'energy': 'sensor.of_e'}, {'name': 'Nave', 'power': 'sensor.nave_p', 'max': 30000}]
        prices = ['sensor.p%d' % n for n in range(1, 7)]
        cfg = panel.build_config(opts(panel_lines=lines, panel_price_entities=prices, panel_cost_entity='sensor.coste',
                                      panel_co2_entity='sensor.co2', panel_pf_min=0.9, panel_nominal_power=50000))
        self.assertEqual([v['path'] for v in cfg['views']], ['control', 'ahorro', 'impacto'])
        ctl = cfg['views'][0]['cards'][0]
        self.assertEqual((ctl['type'], ctl['meter_prefix'], ctl['inverter_prefix'], ctl['mppts'], ctl['strings']),
                         ('custom:growsnif-panel', 'red', 'inv', 4, 8))
        self.assertEqual(ctl['nominal_power'], 50000)
        self.assertEqual(ctl['lines'], [{'name': 'Oficinas', 'code': 'L01', 'power': 'sensor.of_p', 'energy': 'sensor.of_e'},
                                        {'name': 'Nave', 'code': 'L02', 'power': 'sensor.nave_p', 'max': 30000}])
        self.assertEqual(ctl['thresholds']['pf_min'], 0.9)
        self.assertNotIn('price_kwh', ctl)                                  # 0 -> not set
        sav = cfg['views'][1]['cards'][0]
        self.assertEqual((sav['price_entities'], sav['cost_entity']), (prices, 'sensor.coste'))
        self.assertEqual(cfg['views'][2]['cards'][0]['co2_entity'], 'sensor.co2')
        only_meter = panel.build_config(opts(inverter_enabled=False))
        self.assertEqual([v['path'] for v in only_meter['views']], ['control'])
        self.assertNotIn('inverter_prefix', only_meter['views'][0]['cards'][0])
        off = panel.build_config(opts(panel_savings=False, panel_impact=False))
        self.assertEqual(len(off['views']), 1)

    def test_first_install(self):
        ha = FakeLovelace()
        changed, res, board = self.run_install(ha)
        self.assertTrue(changed)
        self.assertEqual((self.dir / 'www/growsnif/growsnif-panel.js').read_bytes(), panel.CARD_SRC.read_bytes())
        self.assertEqual(ha.resources, [{'id': 'r1', 'type': 'module', 'url': '/local/growsnif/growsnif-panel.js?v=9.9.9'}])
        self.assertEqual(ha.boards[0]['url_path'], 'growsnif-control')
        self.assertEqual(ha.boards[0]['title'], 'Energía')
        self.assertEqual(ha.configs['growsnif-control'], panel.build_config(opts()))
        self.assertEqual(board, 'creado')
        self.assertTrue(ha.closed)
        self.assertTrue((self.dir / 'growsnif/panel-growsnif-control.json').exists())
        # Second start: nothing changes
        changed, res, board = self.run_install(ha)
        self.assertEqual((changed, res, board), (False, 'sin cambios', 'sin cambios'))

    def test_update_bumps_version_and_merges_hand_installed_card(self):
        ha = FakeLovelace(resources=[{'id': 'a', 'type': 'module', 'url': '/local/growsnif-panel.js?v=1.1.0'},
                                     {'id': 'b', 'type': 'module', 'url': '/local/otra-tarjeta.js'},
                                     {'id': 'c', 'type': 'js', 'url': '/local/growsnif/growsnif-panel.js?v=1.0'}])
        self.run_install(ha)
        self.assertEqual(ha.resources, [{'id': 'a', 'type': 'module', 'url': '/local/growsnif/growsnif-panel.js?v=9.9.9'},
                                        {'id': 'b', 'type': 'module', 'url': '/local/otra-tarjeta.js'}])

    def test_once_mode_keeps_user_changes(self):
        ha = FakeLovelace()
        self.run_install(ha)
        ha.configs['growsnif-control']['views'][0]['cards'][0]['title'] = 'Mi título'
        mine = copy.deepcopy(ha.configs['growsnif-control'])
        self.run_install(ha, panel_title='Otro título', inverter_strings=20)
        self.assertEqual(ha.configs['growsnif-control'], mine)
        self.assertFalse((self.dir / 'growsnif/backups').exists())

    def test_managed_mode_rewrites_with_backup(self):
        ha = FakeLovelace()
        self.run_install(ha, panel_mode='gestionado')
        before = copy.deepcopy(ha.configs['growsnif-control'])
        _, _, board = self.run_install(ha, panel_mode='gestionado', inverter_strings=20, panel_sidebar_title='Planta')
        self.assertTrue(board.startswith('actualizado'))
        self.assertEqual(ha.configs['growsnif-control']['views'][0]['cards'][0]['strings'], 20)
        self.assertEqual(ha.boards[0]['title'], 'Planta')
        backups = list((self.dir / 'growsnif/backups').glob('growsnif-control-*.json'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text(encoding='utf-8')), before)
        # Same options again: no new backup
        self.run_install(ha, panel_mode='gestionado', inverter_strings=20, panel_sidebar_title='Planta')
        self.assertEqual(len(list((self.dir / 'growsnif/backups').glob('*.json'))), 1)

    def test_existing_dashboard_without_config(self):
        ha = FakeLovelace(boards=[{'id': 'x', 'url_path': 'growsnif-control', 'title': 'Viejo', 'icon': 'mdi:home', 'show_in_sidebar': True}])
        _, _, board = self.run_install(ha)
        self.assertEqual(board, 'configurado')
        self.assertEqual(ha.boards[0]['title'], 'Viejo')                    # una_vez does not touch its name

    def test_options_validation(self):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump({'gateway_host': 'gw', 'panel_install': True, 'panel_url': 'sinGuion'}, f)
        with self.assertRaises(ValueError):
            main.load_options(f.name)
        for bad in ({'panel_lines': [{'name': 'x'}]}, {'panel_price_entities': ['a', 'b']},
                    {'panel_voltage_min': 260, 'panel_voltage_max': 250}):
            with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
                json.dump(dict({'gateway_host': 'gw', 'panel_install': True}, **bad), f)
            with self.assertRaises(ValueError):
                main.load_options(f.name)
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump({'gateway_host': 'gw'}, f)                             # 1.3.0 options: panel off
        self.assertFalse(main.load_options(f.name)['panel_install'])

    def test_start_retries_and_never_raises(self):
        attempts = []

        def connect():
            attempts.append(1)
            if len(attempts) < 3:
                raise OSError('core starting')
            return FakeLovelace()
        stop = threading.Event()
        t = panel.start(opts(), '9.9.9', stop, config_dir=self.dir, connect=connect, attempts=5, wait=0.01)
        t.join(5)
        self.assertEqual(len(attempts), 3)
        t = panel.start(opts(), '9.9.9', stop, config_dir=self.dir / 'no-existe', connect=connect, attempts=2, wait=0.01)
        t.join(5)


class WebSocketTests(unittest.TestCase):
    def test_client_against_fake_ha(self):
        import test_migrar as tm
        ha = tm.FakeHA(tm.world())
        try:
            port = int(ha.url.rsplit(':', 1)[1])
            ws = HAWebSocket('127.0.0.1', port, '/api/websocket', tm.TOKEN)
            self.assertEqual(ws.version, '2026.10.4')
            self.assertTrue(len(ws.call('config/entity_registry/list')) > 5)
            with self.assertRaises(HAError):
                ws.call('no/existe')
            ws.close()
            with self.assertRaises(HAError):
                HAWebSocket('127.0.0.1', port, '/api/websocket', 'malo')
        finally:
            ha.close()


if __name__ == '__main__':
    unittest.main()
