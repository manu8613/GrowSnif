"""Inverter decoder tests. Run: python test_growatt.py [-v]

All values are synthetic. The InverterChannel tests need paho-mqtt.
"""
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'growsnif'))
import growatt  # noqa: E402
from growatt import Event, Inverter, Sniffer, build_sensors, crc  # noqa: E402

try:
    import inverter
except ModuleNotFoundError:
    inverter = None


def frame(body):
    return body + crc(body).to_bytes(2, 'little')


def read_req(start, count, fc=4, slave=1):
    return frame(bytes([slave, fc]) + start.to_bytes(2, 'big') + count.to_bytes(2, 'big'))


def read_resp(words, fc=4, slave=1):
    data = b''.join(w.to_bytes(2, 'big') for w in words)
    return frame(bytes([slave, fc, len(data)]) + data)


def write6(addr, value, slave=1):
    return frame(bytes([slave, 6]) + addr.to_bytes(2, 'big') + value.to_bytes(2, 'big'))


def write16(addr, words, slave=1):
    data = b''.join(w.to_bytes(2, 'big') for w in words)
    return frame(bytes([slave, 16]) + addr.to_bytes(2, 'big') + len(words).to_bytes(2, 'big')
                 + bytes([len(data)]) + data)


def block(start, count, values):
    """Words start..start+count-1, zero except the given {addr: word}."""
    return [values.get(start + i, 0) for i in range(count)]


def u32(v):
    return {0: v >> 16, 1: v & 0xFFFF}


SAMPLE = {0: 1, 37: 5001, 38: 2310, 39: 145, 53: 0, 54: 1234, 93: 412, 113: 33,
          35: 0x0001, 36: 0x86A0,              # 100000 -> 10000.0 W
          1: 0x0001, 2: 0xADB0,                # 110000 -> 11000.0 W
          3: 5120, 4: 87, 5: 0, 6: 44544,      # MPPT1 512.0 V 8.7 A 4454.4 W
          104: 0, 176: 0x0005,                 # strings 1 and 3 disconnected
          142: 5120, 143: 0xFFFE,              # string 1: 512.0 V, -0.2 A
          232: 0xFFFF, 233: 0xFC18,            # reactive -1000 -> -100.0 var
          230: 0, 231: 50000}                  # apparent 5000.0 VA


class SnifferTests(unittest.TestCase):
    def pair(self, start=0, count=125, **kw):
        return read_req(start, count, **kw) + read_resp(block(start, count, SAMPLE), **kw)

    def test_read_pair(self):
        ev = Sniffer().feed(self.pair(), 1.0)
        self.assertEqual(len(ev), 1)
        self.assertEqual((ev[0].kind, ev[0].table, ev[0].start, len(ev[0].words)), ('read', 'input', 0, 125))
        self.assertEqual(ev[0].words[37], 5001)

    def test_byte_by_byte_and_random_chunks(self):
        stream = (self.pair() + write6(308, 1000) * 2 + read_req(35, 2) + read_resp([1, 0x86A0])) * 3
        for chunker in (lambda: 1, lambda: random.randint(1, 40)):
            s, out, i = Sniffer(), [], 0
            while i < len(stream):
                n = chunker()
                out += s.feed(stream[i:i + n], 1.0)
                i += n
            kinds = [(e.kind, e.start) for e in out]
            self.assertEqual(kinds, [('read', 0), ('write', 308), ('read', 35)] * 3)
            self.assertEqual(s.discarded, 0)

    def test_fc6_echo_is_not_a_second_write(self):
        s = Sniffer()
        ev = s.feed(write6(308, 779) + write6(308, 779), 1.0)
        self.assertEqual(ev, [Event('write', 'holding', 308, [779])])
        self.assertEqual(s.writes, 1)

    def test_fc16_write(self):
        ev = Sniffer().feed(write16(3, [100, 200]) + frame(bytes([1, 16, 0, 3, 0, 2])), 1.0)
        self.assertEqual(ev, [Event('write', 'holding', 3, [100, 200])])

    def test_other_slave_ignored_but_parsed(self):
        s = Sniffer(slave=1)
        ev = s.feed(self.pair(slave=2) + self.pair(), 1.0)
        self.assertEqual(len(ev), 1)
        self.assertEqual(s.discarded, 0)

    def test_noise_resync(self):
        s = Sniffer()
        ev = s.feed(b'\x00\xff\x55\x01\x04' + self.pair(), 1.0)
        self.assertEqual(len(ev), 1)
        self.assertGreater(s.discarded, 0)

    def test_idle_flushes_garbage(self):
        s = Sniffer()
        self.assertEqual(s.feed(b'\x01\x04\x00\x00\x00', 1.0), [])
        s.idle(2.0)
        self.assertEqual(len(s.buffer), 0)
        self.assertEqual(len(s.feed(self.pair(), 3.0)), 1)

    def test_late_response_is_orphan(self):
        s = Sniffer()
        s.feed(read_req(0, 2), 1.0)
        self.assertEqual(s.feed(read_resp([1, 2]), 10.0), [])
        self.assertEqual(s.orphans, 1)

    def test_exception(self):
        s = Sniffer()
        s.feed(read_req(0, 2) + frame(bytes([1, 0x84, 2])), 1.0)
        self.assertEqual(s.exceptions, 1)


class ModelTests(unittest.TestCase):
    def values(self, mppts=2, strings=4):
        inv = Inverter(mppts, strings)
        out = {}
        for start in (0, 125):
            out.update(inv.apply(Event('read', 'input', start, block(start, 125, SAMPLE)), 1.0))
        out.update(inv.apply(Event('write', 'holding', 308, [760]), 1.0))
        return out

    def test_scaling(self):
        v = self.values()
        self.assertEqual(v['estado'], 'Normal')
        self.assertAlmostEqual(v['potencia_ac'], 10000.0)
        self.assertAlmostEqual(v['potencia_fv'], 11000.0)
        self.assertAlmostEqual(v['frecuencia'], 50.01)
        self.assertAlmostEqual(v['tension_l1'], 231.0)
        self.assertAlmostEqual(v['corriente_l1'], 14.5)
        self.assertAlmostEqual(v['energia_hoy'], 123.4)
        self.assertAlmostEqual(v['temperatura_inversor'], 41.2)
        self.assertEqual(v['potencia_porcentaje'], 33)
        self.assertEqual(v['limitacion'], 'Ninguna')
        self.assertAlmostEqual(v['limite_antivertido'], 76.0)
        self.assertAlmostEqual(v['mppt1_tension'], 512.0)
        self.assertAlmostEqual(v['mppt1_potencia'], 4454.4)
        self.assertAlmostEqual(v['string1_corriente'], -0.2)
        self.assertAlmostEqual(v['reactiva'], -100.0)
        self.assertEqual(v['strings_desconectados'], '1, 3')

    def test_string_limit(self):
        self.assertEqual(self.values(strings=2)['strings_desconectados'], '1')
        self.assertNotIn('strings_desconectados', self.values(strings=0))

    def test_registers_map(self):
        self.assertEqual(growatt.mppt_regs(1), (3, 4, 5, 59, 61))
        self.assertEqual(growatt.mppt_regs(8), (31, 32, 33, 87, 89))
        self.assertEqual(growatt.mppt_regs(9), (875, 876, 877, 907, 909))
        self.assertEqual(growatt.string_regs(16), (172, 173))
        self.assertEqual(growatt.string_regs(17), (955, 956))
        keys = [s.key for s in build_sensors(16, 32)]
        self.assertEqual(len(keys), len(set(keys)))
        with self.assertRaises(ValueError):
            build_sensors(0, 0)

    def test_stale_registers_are_not_combined(self):
        inv = Inverter(1, 20)
        inv.apply(Event('read', 'input', 875, block(875, 125, {989: 1})), 0.0)
        v = inv.apply(Event('read', 'input', 125, block(125, 125, {176: 0})), 500.0)
        self.assertNotIn('strings_desconectados', v)      # 989 is 500 s old
        v = inv.apply(Event('read', 'input', 875, block(875, 125, {989: 1})), 510.0)
        self.assertEqual(v['strings_desconectados'], '17')


@unittest.skipIf(inverter is None, 'paho-mqtt no instalado')
class ChannelTests(unittest.TestCase):
    OPTS = dict(inverter_address=1, inverter_mppts=2, inverter_strings=0, inverter_id_prefix='inv',
                inverter_device_name='Inv')

    def test_power_factor_and_asleep(self):
        ch = inverter.InverterChannel(self.OPTS)
        ch.reset(0.0)
        data = read_req(0, 125) + read_resp(block(0, 125, SAMPLE)) \
            + read_req(125, 125) + read_resp(block(125, 125, SAMPLE))
        ch.feed(data, 1.0)
        self.assertAlmostEqual(ch.cache['factor_potencia'][0], 1.0)       # 10 kW / 5 kVA clipped
        self.assertFalse(ch.asleep(2.0))
        # The datalogger keeps asking, nobody answers for > 90 s: night.
        for t in range(10, 200, 5):
            ch.feed(read_req(35, 2), float(t))
            ch.idle(float(t) + 0.5)
        self.assertTrue(ch.asleep(200.0))
        self.assertEqual(ch.cache['estado'][0], growatt.ASLEEP)
        self.assertEqual(ch.cache['potencia_ac'][0], 0.0)
        self.assertEqual(ch.cache['mppt2_potencia'][0], 0.0)
        self.assertNotIn('energia_total', ch.cache)     # 0 is never accepted as a lifetime total
        self.assertEqual(ch.cache['energia_hoy'][1], 1.0)   # totals are never invented while asleep

    def test_lifetime_totals_never_go_down(self):
        ch = inverter.InverterChannel(self.OPTS)
        for t, total in ((1.0, 5000), (2.0, 4990), (3.0, 0), (4.0, 5003)):
            words = block(55, 2, {55: 0, 56: total})
            ch.feed(read_req(55, 2) + read_resp(words), t)
        self.assertEqual(ch.cache['energia_total'], (500.3, 4.0))
        self.assertEqual(ch.dropped, 2)

    def test_discovery(self):
        ch = inverter.InverterChannel(self.OPTS)
        d = inverter.discovery(dict(self.OPTS), ch.model, 'x')
        self.assertEqual(d['potencia_ac']['unique_id'], 'inv_potencia_ac')
        self.assertEqual(d['potencia_ac']['state_topic'], 'inv/state/potencia_ac')
        self.assertEqual(d['potencia_ac']['availability_topic'], 'inv/availability')
        self.assertNotIn('expire_after', d['energia_total'])
        self.assertEqual(d['energia_total']['state_class'], 'total_increasing')
        self.assertNotIn('state_class', d['estado'])
        self.assertEqual(d['bus_dc_positivo']['entity_category'], 'diagnostic')
        self.assertIn('factor_potencia', d)


if __name__ == '__main__':
    unittest.main()
