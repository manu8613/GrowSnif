"""Decoder tests. Run: python test_protocol.py [data/captura_sintetica.txt] [-v]"""
import random
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'growsnif'))
from protocol import REGS, Decoder, apparent_power, convert, crc  # noqa: E402


def frame(body):
    return body + crc(body).to_bytes(2, 'little')


def req(start=0x2012, count=2, slave=1):
    return frame(bytes([slave, 3]) + start.to_bytes(2, 'big') + count.to_bytes(2, 'big'))


def resp(*floats, slave=1):
    p = b''.join(struct.pack('>f', v) for v in floats)
    return frame(bytes([slave, 3, len(p)]) + p)


Q, R = req(), resp(1500.0)


class DecoderTests(unittest.TestCase):
    def test_pair(self):
        self.assertEqual(Decoder().feed(Q + R), [(0x2012, 1500.0)])

    def test_byte_by_byte(self):
        d, out = Decoder(), []
        for b in Q + R:
            out += d.feed(bytes([b]))
        self.assertEqual(out, [(0x2012, 1500.0)])

    def test_other_slave_ignored(self):
        d = Decoder(slave=1)
        self.assertEqual(d.feed(req(slave=2) + resp(1.0, slave=2)), [])
        self.assertEqual(Decoder(slave=7).feed(req(slave=7) + resp(9.0, slave=7)), [(0x2012, 9.0)])

    def test_corruption_and_resync(self):
        bad = bytearray(R); bad[-1] ^= 1
        d = Decoder()
        self.assertEqual(d.feed(Q + bad + Q + R), [(0x2012, 1500.0)])
        self.assertGreater(d.discarded, 0)

    def test_orphan_and_expired(self):
        d = Decoder()
        self.assertEqual(d.feed(R), [])
        self.assertEqual(d.orphans, 1)
        d.feed(Q, 0)
        self.assertEqual(d.feed(R, 3), [])

    def test_wrong_length(self):
        d = Decoder(); d.feed(Q)
        self.assertEqual(d.feed(resp(1.0, 2.0, 3.0, 4.0)), [])

    def test_exception(self):
        d = Decoder()
        self.assertEqual(d.feed(Q + frame(bytes([1, 0x83, 2]))), [])
        self.assertEqual(d.exceptions, 1)

    def test_nonfinite(self):
        self.assertEqual(Decoder().feed(Q + resp(float('nan'))), [])

    def test_any_fc03_range(self):
        out = Decoder().feed(req(0x2006, 6) + resp(2300.0, 2310.0, 2320.0))
        self.assertEqual(out, [(0x2006, 2300.0), (0x2008, 2310.0), (0x200A, 2320.0)])

    def test_unknown_registers_skipped(self):
        self.assertEqual(Decoder().feed(req(0x3000, 2) + resp(1.0)), [])

    def test_scaling(self):
        self.assertAlmostEqual(convert(0x200C, 500, ct=80), 40.0)
        self.assertAlmostEqual(convert(0x2006, 2300, pt=1), 230.0)
        self.assertAlmostEqual(convert(0x2006, 2300, pt=2), 460.0)
        self.assertAlmostEqual(convert(0x2012, 1000, ct=80, pt=2), 16000.0)
        self.assertAlmostEqual(convert(0x101E, 100, ct=80), 8000.0)
        self.assertAlmostEqual(convert(0x2044, 4999, ct=80, pt=2), 49.99)
        self.assertAlmostEqual(convert(0x202A, 950, ct=80), 0.95)

    def test_apparent_power(self):
        v = {'tension_l1': 230.0, 'tension_l2': 231.0, 'tension_l3': 232.0,
             'corriente_l1': 10.0, 'corriente_l2': 20.0, 'corriente_l3': 30.0}
        s = apparent_power(v)
        self.assertAlmostEqual(s['aparente_l1'], 2300.0)
        self.assertAlmostEqual(s['aparente_total'], 2300.0 + 4620.0 + 6960.0)
        self.assertEqual(apparent_power({'tension_l1': 230.0}), {})

    def test_register_metadata(self):
        self.assertEqual(len(REGS), 24)
        self.assertEqual({REGS[a].device_class for a in (0x202A, 0x202C, 0x202E, 0x2030)}, {'power_factor'})
        self.assertEqual(REGS[0x2012].name, 'Potencia activa total')


def check_capture(path, slave=1):
    lines = Path(path).read_text().splitlines()
    blob = b''.join(bytes.fromhex(line[24:].replace('-', '')) for line in lines)
    baseline = None
    for seed in range(10):
        rng, d, result, i = random.Random(seed), Decoder(slave), [], 0
        while i < len(blob):
            n = rng.randint(1, 400)
            result += d.feed(blob[i:i + n], 0)
            i += n
        assert d.requests == d.responses > 0 and d.discarded == 0 and d.orphans == 0 and not d.buffer, vars(d)
        assert len({a for a, _ in result}) == 24
        if baseline is None:
            baseline = result
        assert result == baseline
    print('Captura: 10 fragmentaciones aleatorias, %d pares CRC válidos, 24 magnitudes. OK' % d.requests)


if __name__ == '__main__':
    if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
        check_capture(sys.argv.pop(1))
    unittest.main()
