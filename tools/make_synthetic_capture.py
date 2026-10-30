"""Generate tests/data/captura_sintetica.txt: invented values, realistic framing.

Same polling pattern a Growatt ShineMaster uses with a DTSU666 (fast total power
every ~0.23 s, full blocks every ~58 s), random TCP chunking and occasional
request+response merged in one chunk. No real installation data inside.
"""
import datetime
import random
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'growsnif'))
from protocol import crc  # noqa: E402

SLAVE = 1
SLOW = [(0x2000, 34), (0x202A, 8), (0x2044, 2), (0x101E, 2), (0x1028, 2)]


def frame(body):
    return body + crc(body).to_bytes(2, 'little')


def request(start, count):
    return frame(bytes([SLAVE, 3]) + start.to_bytes(2, 'big') + count.to_bytes(2, 'big'))


def response(floats):
    payload = b''.join(struct.pack('>f', v) for v in floats)
    return frame(bytes([SLAVE, 3, len(payload)]) + payload)


def main(out):
    rng = random.Random(2026)
    t = datetime.datetime(2026, 1, 1, 12, 0, 0)
    imp, exp = 1234.5, 67.8          # secondary kWh, invented
    lines, next_slow = [], t

    def emit(chunks):
        nonlocal t
        for c in chunks:
            lines.append(t.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3] + ' ' + '-'.join('%02X' % b for b in c))
            t += datetime.timedelta(milliseconds=rng.randint(2, 45))

    for _ in range(2600):
        p = rng.uniform(-40, 220)    # secondary W, positive = import
        if t >= next_slow:
            next_slow = t + datetime.timedelta(seconds=58)
            u = [rng.uniform(228, 242) for _ in range(3)]
            i = [rng.uniform(0.05, 0.6) for _ in range(3)]
            pp = [p / 3 + rng.uniform(-10, 10) for _ in range(3)]
            q = [rng.uniform(-40, 10) for _ in range(3)]
            imp += max(p, 0) / 3600 * 58 / 1000
            exp += max(-p, 0) / 3600 * 58 / 1000
            block = [x * 1.732 * 10 for x in u] + [x * 10 for x in u] + [x * 1000 for x in i]
            block += [sum(pp) * 10] + [x * 10 for x in pp] + [sum(q) * 10] + [x * 10 for x in q]
            values = {0x2000: block,
                      0x202A: [rng.uniform(-1000, 1000) for _ in range(4)],
                      0x2044: [rng.uniform(4990, 5010)],
                      0x101E: [imp], 0x1028: [exp]}
            for start, count in SLOW:
                emit([request(start, count) + response(values[start])])
        req, resp = request(0x2012, 2), response([p * 10])
        if rng.random() < 0.5:
            emit([req + resp])
        else:
            cut = rng.randint(1, len(resp) - 1) if rng.random() < 0.2 else 0
            emit([req] + ([resp[:cut], resp[cut:]] if cut else [resp]))
        t += datetime.timedelta(milliseconds=rng.randint(150, 230))
    Path(out).write_text('\n'.join(lines) + '\n')
    print('%d líneas en %s' % (len(lines), out))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tests/data/captura_sintetica.txt')
