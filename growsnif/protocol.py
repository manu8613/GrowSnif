"""GrowSnif - passive decoder for CHINT DTSU666 Modbus RTU traffic.

Pure functions only: this module never opens sockets and never builds frames
to send. It reads the bytes another master (e.g. a Growatt ShineMaster) and
the meter exchange on the RS485 bus and turns the meter answers into values.
"""
import math
import struct
import time
from collections import namedtuple

# kind: how the value is scaled from meter (secondary) to primary side
#   'u' -> x PT ratio, 'i' -> x CT ratio, 'p' -> x CT x PT, '' -> unchanged
Register = namedtuple('Register', 'key name unit device_class scale decimals kind')
REGS = {}


def _reg(addr, key, name, unit, device_class, scale, decimals, kind):
    REGS[addr] = Register(key, name, unit, device_class, scale, decimals, kind)


SUFFIXES = (('total', 'total'), ('l1', 'L1'), ('l2', 'L2'), ('l3', 'L3'))

for n, pair in enumerate(('AB', 'BC', 'CA')):
    _reg(0x2000 + 2 * n, 'tension_' + pair.lower(), 'Tensión ' + pair, 'V', 'voltage', 0.1, 1, 'u')
for n in range(3):
    ph = str(n + 1)
    _reg(0x2006 + 2 * n, 'tension_l' + ph, 'Tensión L' + ph, 'V', 'voltage', 0.1, 1, 'u')
    _reg(0x200C + 2 * n, 'corriente_l' + ph, 'Corriente L' + ph, 'A', 'current', 0.001, 2, 'i')
for base, prefix, label, unit, dc in ((0x2012, 'potencia', 'Potencia activa', 'W', 'power'),
                                      (0x201A, 'reactiva', 'Potencia reactiva', 'var', 'reactive_power')):
    for n, (suffix, shown) in enumerate(SUFFIXES):
        _reg(base + 2 * n, prefix + '_' + suffix, label + ' ' + shown, unit, dc, 0.1, 1, 'p')
for n, (suffix, shown) in enumerate(SUFFIXES):
    _reg(0x202A + 2 * n, 'fp_' + suffix, 'Factor de potencia ' + shown, '', 'power_factor', 0.001, 3, '')
_reg(0x2044, 'frecuencia', 'Frecuencia', 'Hz', 'frequency', 0.01, 2, '')
_reg(0x101E, 'energia_importada', 'Energía importada', 'kWh', 'energy', 1, 3, 'p')
_reg(0x1028, 'energia_exportada', 'Energía exportada', 'kWh', 'energy', 1, 3, 'p')

# Sensors computed here, not read from the bus: (key, name, unit, device_class, decimals)
DERIVED = [('aparente_' + s, 'Potencia aparente ' + shown, 'VA', 'apparent_power', 0) for s, shown in SUFFIXES]
DERIVED += [('potencia_importada', 'Potencia importada', 'W', 'power', 1),
            ('potencia_exportada', 'Potencia exportada', 'W', 'power', 1)]


def convert(addr, raw, ct=1.0, pt=1.0):
    """Raw float from the meter -> value in primary units."""
    r = REGS[addr]
    factor = {'u': pt, 'i': ct, 'p': ct * pt}.get(r.kind, 1)
    return raw * r.scale * factor


def apparent_power(values):
    """values: scaled tension_l1..3 and corriente_l1..3. Returns {} unless all six are present."""
    out = {}
    for ph in ('1', '2', '3'):
        u = values.get('tension_l' + ph)
        i = values.get('corriente_l' + ph)
        if u is None or i is None:
            return {}
        out['aparente_l' + ph] = u * i
    out['aparente_total'] = out['aparente_l1'] + out['aparente_l2'] + out['aparente_l3']
    return out


def crc(data):
    c = 0xFFFF
    for b in data:
        c ^= b
        for _ in range(8):
            c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
    return c


Pending = namedtuple('Pending', 'start count time')


class Decoder:
    """Reassembles FC03 request/response pairs addressed to one slave.

    Bytes can arrive in any fragmentation. Anything that does not pass the CRC
    is skipped one byte at a time until the stream is in sync again.
    """

    def __init__(self, slave=1, max_age=2.0):
        if not 1 <= slave <= 247:
            raise ValueError('slave 1..247')
        self.slave = slave
        self.max_age = max_age
        self.buffer = bytearray()
        self.pending = None
        self.requests = self.responses = self.discarded = self.exceptions = self.orphans = 0

    def _request_at_head(self):
        b = self.buffer
        if len(b) < 8 or crc(b[:8]) != 0:
            return None
        count = int.from_bytes(b[4:6], 'big')
        if not 1 <= count <= 125:
            return None
        return int.from_bytes(b[2:4], 'big'), count

    def _drop(self):
        del self.buffer[0]
        self.discarded += 1

    def feed(self, data, now=None):
        """Feed received bytes. Returns a list of (register_address, raw_float)."""
        now = time.monotonic() if now is None else now
        self.buffer.extend(data)
        if self.pending and now - self.pending.time > self.max_age:
            self.pending = None
        out = []
        b = self.buffer
        while len(b) >= 5:
            if b[0] != self.slave or b[1] not in (0x03, 0x83):
                self._drop()
                continue
            if b[1] == 0x83:  # exception response
                if crc(b[:5]) == 0:
                    del b[:5]
                    self.pending = None
                    self.exceptions += 1
                else:
                    self._drop()
                continue
            size = b[2] + 5
            # 1) the response we are waiting for
            if self.pending and b[2] == self.pending.count * 2:
                if len(b) >= size and crc(b[:size]) == 0:
                    out += self._accept(bytes(b[3:size - 2]), now)
                    del b[:size]
                    continue
                if len(b) < size and self._request_at_head() is None:
                    break  # wait for the rest of the response
            # 2) a request from the master
            if len(b) < 8:
                break
            req = self._request_at_head()
            if req:
                self.pending = Pending(req[0], req[1], now)
                self.requests += 1
                del b[:8]
                continue
            # 3) a valid response without a matching request (e.g. capture started mid-pair)
            if b[2] % 2 == 0 and 2 <= b[2] <= 250:
                if len(b) < size:
                    break
                if crc(b[:size]) == 0:
                    del b[:size]
                    self.orphans += 1
                    self.pending = None
                    continue
            self._drop()
        return out

    def _accept(self, payload, now):
        pending, self.pending = self.pending, None
        self.responses += 1
        if now - pending.time > self.max_age:
            return []
        values = []
        for off in range(0, len(payload) - 3, 4):
            addr = pending.start + off // 2
            if addr in REGS:
                raw = struct.unpack('>f', payload[off:off + 4])[0]
                if math.isfinite(raw):
                    values.append((addr, raw))
        return values
