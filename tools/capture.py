"""Read-only capture of an RS485 bus through a transparent RS485-to-TCP gateway.

Writes one line per TCP chunk: 'YYYY-MM-DD HH:MM:SS.mmm AA-BB-CC-...'
This script never sends anything to the gateway.

    python tools/capture.py --host <gateway> --port 4196 --minutes 10 -o captura.txt

Real captures contain data about your installation: keep them out of git
(the 'captures/' folder is in .gitignore).
"""
import argparse
import datetime
import socket
import time


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--host', required=True)
    ap.add_argument('--port', type=int, default=4196)
    ap.add_argument('--minutes', type=float, default=10)
    ap.add_argument('-o', '--output', required=True)
    a = ap.parse_args()
    end = time.monotonic() + a.minutes * 60
    total = 0
    with socket.create_connection((a.host, a.port), timeout=5) as s, open(a.output, 'w') as f:
        s.settimeout(1)
        while time.monotonic() < end:
            try:
                chunk = s.recv(4096)  # receive only
            except socket.timeout:
                continue
            if not chunk:
                break
            stamp = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
            f.write(stamp + ' ' + '-'.join('%02X' % b for b in chunk) + '\n')
            total += len(chunk)
    print('%d bytes guardados en %s' % (total, a.output))


if __name__ == '__main__':
    main()
