"""Options, MQTT credentials, discovery and scaling. Needs paho-mqtt."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'growsnif'))
try:
    import main
except ModuleNotFoundError:
    main = None

SUP = {'host': 'core-mosquitto', 'port': 1883, 'username': 'addons', 'password': 'x', 'ssl': False}


def opts(**kw):
    o = dict(main.DEFAULTS, gateway_host='gateway.local')
    o.update(kw)
    return o


@unittest.skipIf(main is None, 'paho-mqtt no instalado')
class MainTests(unittest.TestCase):
    def boom(self):
        raise AssertionError('no debe llamar al Supervisor')

    def load(self, **kw):
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump(kw, f)
        return main.load_options(f.name)

    def test_manual_mqtt_wins(self):
        o = opts(mqtt_host='broker', mqtt_username='u', mqtt_password='p')
        self.assertEqual(main.resolve_mqtt(o, fetch=self.boom), ('broker', 1883, 'u', 'p'))

    def test_empty_mqtt_uses_supervisor(self):
        self.assertEqual(main.resolve_mqtt(opts(), fetch=lambda: SUP), ('core-mosquitto', 1883, 'addons', 'x'))

    def test_load_defaults_and_validation(self):
        o = self.load(gateway_host='gw')
        self.assertEqual((o['meter_address'], o['ct_ratio'], o['id_prefix']), (1, 1.0, 'growsnif'))
        with self.assertRaises(ValueError):
            self.load(gateway_host='')
        with self.assertRaises(ValueError):
            self.load(gateway_host='gw', id_prefix='Mal Prefijo')
        with self.assertRaises(ValueError):
            self.load(gateway_host='gw', meter_address=300)

    def test_inverter_options(self):
        o = self.load(gateway_host='gw')
        self.assertFalse(o['inverter_enabled'])           # 1.2.0 options: nothing changes
        o = self.load(gateway_host='gw', inverter_enabled=True, inverter_port=4197)
        self.assertEqual(o['inverter_id_prefix'], 'growsnif_inversor')
        with self.assertRaises(ValueError):                # same channel as the meter
            self.load(gateway_host='gw', inverter_enabled=True, inverter_port=4196)
        with self.assertRaises(ValueError):                # same prefix as the meter
            self.load(gateway_host='gw', inverter_enabled=True, inverter_id_prefix='growsnif')
        with self.assertRaises(ValueError):
            self.load(gateway_host='gw', inverter_enabled=True, inverter_mppts=0)
        self.load(gateway_host='gw', inverter_enabled=False, inverter_port=4196)  # ignored when off

    def test_discovery(self):
        d = main.discovery(opts(id_prefix='mi_medidor', meter_address=7, device_name='Red'))
        self.assertEqual(len(d), 30)
        c = d['potencia_total']
        self.assertEqual(c['unique_id'], 'mi_medidor_potencia_total')
        self.assertEqual(c['state_topic'], 'mi_medidor/state/potencia_total')
        self.assertEqual(c['device']['identifiers'], ['mi_medidor_007'])
        self.assertEqual(c['device']['name'], 'Red')
        self.assertEqual(d['energia_importada']['state_class'], 'total_increasing')
        self.assertNotIn('unit_of_measurement', d['fp_total'])

    def test_scale_values(self):
        cache = {}
        main.scale_values([(0x2012, -500.0)], opts(ct_ratio=80), cache, 1.0)
        self.assertEqual(cache['potencia_total'][0], -4000.0)
        self.assertEqual(cache['potencia_exportada'][0], 4000.0)
        self.assertEqual(cache['potencia_importada'][0], 0.0)
        cache = {}
        main.scale_values([(0x2012, -500.0), (0x2014, -100.0)], opts(invert_power_sign=True), cache, 1.0)
        self.assertEqual((cache['potencia_total'][0], cache['potencia_l1'][0]), (50.0, 10.0))
        cache = {}
        block = [(0x2006, 2300.0), (0x2008, 2300.0), (0x200A, 2300.0), (0x200C, 100.0), (0x200E, 100.0), (0x2010, 100.0)]
        main.scale_values(block, opts(ct_ratio=10), cache, 1.0)
        self.assertAlmostEqual(cache['aparente_total'][0], 3 * 230.0 * 1.0)


if __name__ == '__main__':
    unittest.main()
