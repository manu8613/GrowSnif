"""End-to-end test with the inverter channel on.

Tiny local MQTT broker + two simulated gateway channels (meter and inverter) on
127.0.0.1. Checks that the meter publishes exactly as before, that the inverter
gets its own device, and that neither gateway receives a single byte.
Needs paho-mqtt. Run: python test_runtime_inversor.py
"""
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'growsnif'))
from protocol import crc  # noqa: E402

messages, received, halt = [], {'meter': b'', 'inverter': b''}, threading.Event()
lock = threading.Lock()


def listener():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    s.listen()
    s.settimeout(0.2)
    return s


def exact(c, n):
    b = b''
    while len(b) < n:
        part = c.recv(n - len(b))
        if not part:
            raise EOFError
        b += part
    return b


def mqtt_client(c):
    try:
        with c:
            c.settimeout(10)
            while not halt.is_set():
                h = exact(c, 1)[0]
                size, mult = 0, 1
                while True:
                    z = exact(c, 1)[0]
                    size += (z & 127) * mult
                    mult *= 128
                    if z < 128:
                        break
                p, typ = exact(c, size), h >> 4
                if typ == 1:
                    c.sendall(b'\x20\x02\x00\x00')
                elif typ == 8:
                    c.sendall(b'\x90\x03' + p[:2] + b'\x00')
                elif typ == 3:
                    n = int.from_bytes(p[:2], 'big')
                    topic, pos = p[2:2 + n].decode(), 2 + n
                    if (h >> 1) & 3:
                        c.sendall(b'\x40\x02' + p[pos:pos + 2])
                        pos += 2
                    with lock:
                        messages.append((topic, p[pos:].decode()))
                elif typ == 12:
                    c.sendall(b'\xd0\x00')
                elif typ == 14:
                    break
    except (EOFError, OSError):
        pass


def broker_loop(server):
    while not halt.is_set():
        try:
            c, _ = server.accept()
        except socket.timeout:
            continue
        except OSError:
            return
        threading.Thread(target=mqtt_client, args=(c,), daemon=True).start()


def fr(b):
    return b + crc(b).to_bytes(2, 'little')


def gateway(server, name, frames):
    try:
        while not halt.is_set():
            try:
                c, _ = server.accept()
                break
            except socket.timeout:
                continue
        else:
            return
        with c:
            c.settimeout(0.01)
            while not halt.is_set():
                for f in frames:
                    c.sendall(f[:3])
                    c.sendall(f[3:])
                try:
                    b = c.recv(100)
                    if not b:
                        break
                    received[name] += b
                except socket.timeout:
                    pass
                time.sleep(0.15)
    except OSError:
        pass


def words(start, count, values):
    return b''.join(values.get(start + i, 0).to_bytes(2, 'big') for i in range(count))


METER = [fr(bytes([7, 3, 0x20, 0x12, 0, 2])), fr(bytes([7, 3, 4]) + struct.pack('>f', 1500.0))]
INV = {0: 1, 35: 0, 36: 20000, 55: 0, 56: 12345, 3: 4000, 4: 50}
INVERTER = [fr(bytes([1, 4, 0, 0, 0, 60])), fr(bytes([1, 4, 120]) + words(0, 60, INV)),
            fr(bytes([1, 6, 1, 0x34, 3, 0xE8])), fr(bytes([1, 6, 1, 0x34, 3, 0xE8]))]

broker, meter_gw, inverter_gw = listener(), listener(), listener()
threading.Thread(target=broker_loop, args=(broker,), daemon=True).start()
threading.Thread(target=gateway, args=(meter_gw, 'meter', METER), daemon=True).start()
threading.Thread(target=gateway, args=(inverter_gw, 'inverter', INVERTER), daemon=True).start()

with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / 'options.json'
    path.write_text(json.dumps(dict(
        gateway_host='127.0.0.1', gateway_port=meter_gw.getsockname()[1], meter_address=7, ct_ratio=80,
        mqtt_host='127.0.0.1', mqtt_port=broker.getsockname()[1], mqtt_username='test', mqtt_password='test',
        id_prefix='prueba', device_name='Prueba', publish_interval=1,
        inverter_enabled=True, inverter_port=inverter_gw.getsockname()[1], inverter_address=1,
        inverter_mppts=2, inverter_strings=0, inverter_id_prefix='prueba_inv', inverter_device_name='Inversor')))
    proc = subprocess.Popen([sys.executable, str(ROOT / 'growsnif/main.py')],
                            env={**os.environ, 'GROWSNIF_OPTIONS': str(path)},
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            with lock:
                topics = [t for t, _ in messages]
            if topics.count('prueba/state/potencia_total') >= 3 and 'prueba_inv/state/energia_total' in topics \
                    and 'prueba_inv/state/limite_antivertido' in topics:
                break
            if proc.poll() is not None:
                raise AssertionError(proc.communicate())
            time.sleep(0.1)
    finally:
        proc.terminate()
        out, err = proc.communicate(timeout=10)
        halt.set()
        for s in (broker, meter_gw, inverter_gw):
            s.close()
    assert proc.returncode == 0, err.decode()
    assert received == {'meter': b'', 'inverter': b''}, received

    configs = {}
    for t, p in messages:
        if t.endswith('/config'):
            configs[t] = json.loads(p)
    meter = [c for c in configs.values() if c['device']['name'] == 'Prueba']
    inv = [c for c in configs.values() if c['device']['name'] == 'Inversor']
    assert len(meter) == 30, len(meter)
    assert all(c['unique_id'].startswith('prueba_') and not c['unique_id'].startswith('prueba_inv_') for c in meter)
    assert all(c['unique_id'].startswith('prueba_inv_') for c in inv) and len(inv) > 40, len(inv)
    state = {t: p for t, p in messages}
    assert float(state['prueba/state/potencia_total']) == 12000
    assert float(state['prueba_inv/state/potencia_ac']) == 2000
    assert float(state['prueba_inv/state/energia_total']) == 1234.5
    assert float(state['prueba_inv/state/mppt1_tension']) == 400
    assert float(state['prueba_inv/state/limite_antivertido']) == 100
    assert state['prueba_inv/state/estado'] == 'Normal'
    avail = [(t, p) for t, p in messages if t.endswith('/availability')]
    assert ('prueba_inv/availability', 'online') in avail and ('prueba/availability', 'online') in avail
    last = {}
    for t, p in avail:
        last[t] = p
    assert last == {'prueba/availability': 'offline', 'prueba_inv/availability': 'offline'}, last
    print('OK: medidor igual que antes (30 entidades), inversor con %d entidades, escrituras del datalogger '
          'leídas, ambos offline al parar y CERO bytes enviados a las dos pasarelas.' % len(inv))
