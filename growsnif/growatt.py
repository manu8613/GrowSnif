"""GrowSnif - passive decoder for the Growatt datalogger <-> inverter RS485 bus.

Pure functions and classes only: this module never opens sockets and never
builds frames to send. It reassembles the Modbus RTU traffic between the
datalogger (ShineMaster, ShineWiLan...) and the inverter, keeps the last value
of every register it sees and turns them into sensor values.

Register map: Growatt "Modbus RTU Protocol II" (V1.24 / V1.39), TL3-X / MAX.
"""
from collections import namedtuple

# ------------------------------------------------------------------ Modbus RTU


def crc(data):
    c = 0xFFFF
    for b in data:
        c ^= b
        for _ in range(8):
            c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
    return c


# One decoded event for the configured slave:
#   kind  'read' (answer to FC03/FC04) or 'write' (FC06/FC16 request)
#   table 'input' (FC04) or 'holding' (FC03/06/16)
Event = namedtuple('Event', 'kind table start words')
TABLE = {3: 'holding', 4: 'input', 6: 'holding', 16: 'holding'}


class Sniffer:
    """Reassembles Modbus RTU frames from a byte stream of any fragmentation.

    Every frame on the bus is parsed (to stay in sync), but only the traffic of
    `slave` produces events. Bytes that never form a frame with a valid CRC are
    dropped one by one until the stream is in sync again.
    """

    def __init__(self, slave=1, max_age=2.0, stale=0.3):
        if not 1 <= slave <= 247:
            raise ValueError('slave 1..247')
        self.slave, self.max_age, self.stale = slave, max_age, stale
        self.buffer = bytearray()
        self.pending = None          # (fc, start, count, time) of the last request
        self.last_rx = 0.0
        self.last_request = self.last_response = 0.0   # traffic of our slave
        self.requests = self.responses = self.writes = 0
        self.discarded = self.exceptions = self.orphans = 0

    # -- candidate frame lengths at the head of the buffer
    def _options(self, b):
        fc = b[1]
        if b[0] > 247:
            return []
        if fc & 0x80:
            return [(5, 'exception')] if (fc & 0x7F) in (1, 2, 3, 4, 5, 6, 15, 16) else []
        if fc in (1, 2, 3, 4):
            # A read request is 8 bytes; a register answer is 5 + 2n (odd length).
            return [(8, 'request'), (5 + b[2], 'response')]
        if fc in (5, 6):
            echo = self.pending is not None and self.pending[0] == fc and self.pending[1] == b[0]
            return [(8, 'echo' if echo else 'write')]
        if fc in (15, 16):
            opts = [(8, 'response')]
            if len(b) >= 7:
                opts.insert(0, (9 + b[6], 'write'))
            return opts
        return []

    def feed(self, data, now):
        """Feed received bytes. Returns a list of Event for the configured slave."""
        if data:
            self.buffer.extend(data)
            self.last_rx = now
        return self._parse(now, force=False)

    def idle(self, now):
        """Call when nothing arrived for a while: an incomplete head will never complete."""
        if self.buffer and now - self.last_rx >= self.stale:
            return self._parse(now, force=True)
        return []

    def _parse(self, now, force):
        out, b = [], self.buffer
        while len(b) >= 4:
            options = self._options(b)
            # Prefer the reading that matches what we are waiting for.
            expecting = self.pending is not None and self.pending[1] == b[0] and self.pending[0] == (b[1] & 0x7F)
            options.sort(key=lambda o: 0 if (o[1] in ('response', 'echo', 'exception')) == expecting else 1)
            chosen, incomplete = None, False
            for size, kind in options:
                if size > 256:
                    continue
                if len(b) < size:
                    incomplete = True
                    continue
                if crc(b[:size]) == 0:
                    chosen = (size, kind)
                    break
            if chosen:
                frame = bytes(b[:chosen[0]])
                del b[:chosen[0]]
                event = self._frame(frame, chosen[1], now)
                if event:
                    out.append(event)
                continue
            if incomplete and not force:
                break
            del b[0]
            self.discarded += 1
        if force and len(b) < 4 and b:
            self.discarded += len(b)
            b.clear()
        return out

    def _frame(self, f, kind, now):
        slave, fc = f[0], f[1]
        mine = slave == self.slave
        if kind == 'exception':
            self.pending = None
            if mine:
                self.exceptions += 1
                self.last_response = now
            return None
        if kind == 'request':
            start = int.from_bytes(f[2:4], 'big')
            count = int.from_bytes(f[4:6], 'big')
            self.pending = (fc, slave, start, count, now)
            if mine:
                self.requests += 1
                self.last_request = now
            return None
        if kind == 'response' and fc in (3, 4):
            p, self.pending = self.pending, None
            if not mine:
                return None
            self.last_response = now
            if not p or p[0] != fc or p[1] != slave or f[2] != 2 * p[3] or now - p[4] > self.max_age:
                self.orphans += 1
                return None
            self.responses += 1
            data = f[3:-2]
            words = [int.from_bytes(data[i:i + 2], 'big') for i in range(0, len(data), 2)]
            return Event('read', TABLE[fc], p[2], words)
        if kind == 'write':
            start = int.from_bytes(f[2:4], 'big')
            if fc == 6:
                words = [int.from_bytes(f[4:6], 'big')]
                count = 1
            else:
                data = f[7:-2]
                words = [int.from_bytes(data[i:i + 2], 'big') for i in range(0, len(data), 2)]
                count = len(words)
            self.pending = (fc, slave, start, count, now)
            if mine:
                self.writes += 1
                self.last_request = now
                return Event('write', 'holding', start, words)
            return None
        # echo of FC05/06, answer of FC01/02/15/16
        self.pending = None
        if mine:
            self.last_response = now
        return None


# ------------------------------------------------------------------ register map

def u16(a):
    return lambda w: w[a]


def s16(a):
    return lambda w: w[a] - 65536 if w[a] >= 32768 else w[a]


def u32(a):
    return lambda w: (w[a] << 16) | w[a + 1]


def s32(a):
    def f(w):
        v = (w[a] << 16) | w[a + 1]
        return v - (1 << 32) if v >= 1 << 31 else v
    return f


# key, name, unit, device_class, state_class, decimals, regs (table, addr...), fn,
# fast (published at publish_interval), category (None or 'diagnostic'), keep (no expire_after)
Sensor = namedtuple('Sensor', 'key name unit device_class state_class decimals table regs fn fast category keep')


def sensor(key, name, unit, dc, sc, dec, regs, fn, fast=False, category=None, keep=False, table='input'):
    return Sensor(key, name, unit, dc, sc, dec, table, tuple(regs), fn, fast, category, keep)


def scaled(getter, factor):
    return lambda w: getter(w) * factor


STATUS = {0: 'Espera', 1: 'Normal', 3: 'Fallo', 4: 'Actualizando', 5: 'Autotest'}
DERATING = {0: 'Ninguna', 1: 'FV', 3: 'Tensión de red', 4: 'Frecuencia de red', 5: 'Temperatura boost',
            6: 'Temperatura inversor', 7: 'Control externo', 9: 'Horario'}
ASLEEP = 'Sin respuesta'


def bit_list(regs_bits, limit):
    """[(word, first_string)] -> 'Ninguno' or '9, 11, 13' for set bits up to `limit`."""
    found = []
    for word, first in regs_bits:
        found += [first + i for i in range(16) if word >> i & 1 and first + i <= limit]
    return ', '.join(map(str, found)) if found else 'Ninguno'


def mppt_regs(n):
    """Registers of MPPT n (1..16): voltage, current, power (U32), energy today (U32), total (U32)."""
    if n <= 8:
        base, energy = 3 + 4 * (n - 1), 59 + 4 * (n - 1)
    else:
        base, energy = 875 + 4 * (n - 9), 907 + 4 * (n - 9)
    return base, base + 1, base + 2, energy, energy + 2


def string_regs(k):
    """Registers of string k (1..32): voltage, current."""
    base = 142 + 2 * (k - 1) if k <= 16 else 955 + 2 * (k - 17)
    return base, base + 1


def build_sensors(mppts=2, strings=0):
    if not 1 <= mppts <= 16 or not 0 <= strings <= 32:
        raise ValueError('mppts 1..16, strings 0..32')
    S = []
    add = S.append
    add(sensor('estado', 'Estado', None, None, None, None, [0],
               lambda w: STATUS.get(w[0], 'Código %d' % w[0])))
    add(sensor('potencia_ac', 'Potencia AC', 'W', 'power', 'measurement', 0, [35, 36], scaled(u32(35), 0.1), fast=True))
    add(sensor('potencia_fv', 'Potencia FV', 'W', 'power', 'measurement', 0, [1, 2], scaled(u32(1), 0.1)))
    add(sensor('frecuencia', 'Frecuencia', 'Hz', 'frequency', 'measurement', 2, [37], scaled(u16(37), 0.01)))
    for ph, base in (('1', 38), ('2', 42), ('3', 46)):
        add(sensor('tension_l' + ph, 'Tensión L' + ph, 'V', 'voltage', 'measurement', 1, [base], scaled(u16(base), 0.1)))
        add(sensor('corriente_l' + ph, 'Corriente L' + ph, 'A', 'current', 'measurement', 1,
                   [base + 1], scaled(u16(base + 1), 0.1)))
        add(sensor('aparente_l' + ph, 'Potencia aparente L' + ph, 'VA', 'apparent_power', 'measurement', 0,
                   [base + 2, base + 3], scaled(u32(base + 2), 0.1)))
    for name, a in (('l1_l2', 50), ('l2_l3', 51), ('l3_l1', 52)):
        add(sensor('tension_' + name, 'Tensión ' + name.upper().replace('_', '-'), 'V', 'voltage', 'measurement', 1,
                   [a], scaled(u16(a), 0.1)))
    add(sensor('aparente_total', 'Potencia aparente', 'VA', 'apparent_power', 'measurement', 0,
               [230, 231], scaled(u32(230), 0.1)))
    add(sensor('reactiva', 'Potencia reactiva', 'var', 'reactive_power', 'measurement', 0,
               [232, 233], scaled(s32(232), 0.1)))
    add(sensor('reactiva_maxima', 'Reactiva disponible', 'var', 'reactive_power', 'measurement', 0,
               [234, 235], scaled(u32(234), 0.1), category='diagnostic'))
    add(sensor('energia_hoy', 'Energía hoy', 'kWh', 'energy', 'total_increasing', 1,
               [53, 54], scaled(u32(53), 0.1), keep=True))
    add(sensor('energia_total', 'Energía total', 'kWh', 'energy', 'total_increasing', 1,
               [55, 56], scaled(u32(55), 0.1), keep=True))
    add(sensor('energia_fv_total', 'Energía FV total', 'kWh', 'energy', 'total_increasing', 1,
               [91, 92], scaled(u32(91), 0.1), keep=True))
    add(sensor('energia_reactiva_total', 'Energía reactiva total', 'kvarh', 'reactive_energy', 'total_increasing', 1,
               [236, 237], scaled(u32(236), 0.1), keep=True))
    add(sensor('horas_funcionamiento', 'Horas de funcionamiento', 'h', 'duration', 'total_increasing', 0,
               [57, 58], scaled(u32(57), 0.5 / 3600), category='diagnostic', keep=True))
    add(sensor('potencia_porcentaje', 'Potencia sobre nominal', '%', None, 'measurement', 0, [113], u16(113)))
    add(sensor('limitacion', 'Motivo de limitación', None, None, None, None, [104],
               lambda w: DERATING.get(w[104], 'Código %d' % w[104])))
    add(sensor('limite_antivertido', 'Límite antivertido', '%', None, 'measurement', 1,
               [308], scaled(u16(308), 0.1), table='holding'))
    for key, name, a in (('temperatura_inversor', 'Temperatura inversor', 93),
                         ('temperatura_ipm', 'Temperatura IPM', 94),
                         ('temperatura_boost', 'Temperatura boost', 95)):
        add(sensor(key, name, '°C', 'temperature', 'measurement', 1, [a], scaled(s16(a), 0.1)))
    add(sensor('bus_dc_positivo', 'Bus DC positivo', 'V', 'voltage', 'measurement', 1, [98], scaled(u16(98), 0.1),
               category='diagnostic'))
    add(sensor('bus_dc_negativo', 'Bus DC negativo', 'V', 'voltage', 'measurement', 1, [99], scaled(u16(99), 0.1),
               category='diagnostic'))
    add(sensor('fallo_codigo', 'Código de fallo', None, None, None, None, [105], u16(105), category='diagnostic'))
    add(sensor('aviso_codigo', 'Código de aviso', None, None, None, None, [112], u16(112), category='diagnostic'))
    add(sensor('aislamiento', 'Aislamiento FV', 'kΩ', None, 'measurement', 0, [200], u16(200), category='diagnostic'))
    add(sensor('fuga_tierra', 'Corriente de fuga', 'mA', 'current', 'measurement', 0, [205], u16(205),
               category='diagnostic'))
    for ph, a in (('r', 201), ('s', 202), ('t', 203)):
        add(sensor('dci_' + ph, 'Inyección de continua ' + ph.upper(), 'mA', 'current', 'measurement', 1, [a],
                   scaled(s16(a), 0.1), category='diagnostic'))
    add(sensor('ventiladores_averiados', 'Ventiladores averiados', None, None, 'measurement', 0, [229],
               lambda w: bin(w[229] & 0xF).count('1'), category='diagnostic'))
    if strings:
        for key, name, lo, hi in (('strings_desconectados', 'Strings desconectados', 176, 989),
                                  ('strings_descompensados', 'Strings descompensados', 174, 987),
                                  ('strings_desequilibrados', 'Strings con desequilibrio', 175, 988)):
            regs = [lo] + ([hi] if strings > 16 else [])
            add(sensor(key, name, None, None, None, None, regs,
                       (lambda lo, hi: lambda w: bit_list([(w[lo], 1)] + ([(w[hi], 17)] if hi in w else []),
                                                          strings))(lo, hi if strings > 16 else -1)))
    for n in range(1, mppts + 1):
        v, i, p, today, total = mppt_regs(n)
        m = 'mppt%d' % n
        add(sensor(m + '_tension', 'MPPT%d tensión' % n, 'V', 'voltage', 'measurement', 1, [v], scaled(u16(v), 0.1)))
        add(sensor(m + '_corriente', 'MPPT%d corriente' % n, 'A', 'current', 'measurement', 1, [i],
                   scaled(u16(i), 0.1)))
        add(sensor(m + '_potencia', 'MPPT%d potencia' % n, 'W', 'power', 'measurement', 0, [p, p + 1],
                   scaled(u32(p), 0.1)))
        add(sensor(m + '_energia_hoy', 'MPPT%d energía hoy' % n, 'kWh', 'energy', 'total_increasing', 1,
                   [today, today + 1], scaled(u32(today), 0.1), keep=True))
        add(sensor(m + '_energia_total', 'MPPT%d energía total' % n, 'kWh', 'energy', 'total_increasing', 1,
                   [total, total + 1], scaled(u32(total), 0.1), keep=True))
    for k in range(1, strings + 1):
        v, i = string_regs(k)
        s = 'string%d' % k
        add(sensor(s + '_tension', 'String %d tensión' % k, 'V', 'voltage', 'measurement', 1, [v],
                   scaled(u16(v), 0.1), category='diagnostic'))
        add(sensor(s + '_corriente', 'String %d corriente' % k, 'A', 'current', 'measurement', 1, [i],
                   scaled(s16(i), 0.1)))
    keys = [s.key for s in S]
    assert len(keys) == len(set(keys))
    return S


# Computed from other sensors (key, name, unit, device_class, decimals)
DERIVED = [('factor_potencia', 'Factor de potencia', None, 'power_factor', 3)]


class Inverter:
    """Keeps the last value of every register and turns updates into sensor values."""

    def __init__(self, mppts=2, strings=0, max_age=180.0):
        self.sensors = build_sensors(mppts, strings)
        self.max_age = max_age
        self.store = {'input': {}, 'holding': {}}      # table -> {addr: (word, time)}
        self.by_reg = {}
        for s in self.sensors:
            for r in s.regs:
                self.by_reg.setdefault((s.table, r), []).append(s)

    def apply(self, event, now):
        """Store the words of one event and return {key: value} of the sensors it refreshed."""
        table = self.store[event.table]
        touched = []
        for n, word in enumerate(event.words):
            addr = event.start + n
            table[addr] = (word, now)
            touched += self.by_reg.get((event.table, addr), [])
        out = {}
        for s in dict.fromkeys(touched):
            words = {}
            for r in s.regs:
                item = table.get(r) if s.table == event.table else self.store[s.table].get(r)
                if item is None or now - item[1] > self.max_age:
                    break
                words[r] = item[0]
            else:
                out[s.key] = s.fn(words)
        return out


def power_factor(p, s):
    """|P| / S clipped to 0..1, or None when S is too small to be meaningful."""
    if s is None or p is None or s < 50:
        return None
    return min(1.0, abs(p) / s)
