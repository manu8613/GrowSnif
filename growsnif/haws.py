"""Minimal Home Assistant websocket client (standard library only).

Used only by the panel installer to talk to Home Assistant Core through the
Supervisor. It never touches the RS485 gateways.
"""
import base64
import hashlib
import json
import os
import socket

GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


class HAError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class HAWebSocket:
    def __init__(self, host, port, path, token, timeout=30):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.buf = b''
        self.n = 0
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n' % (path, host, port, key)).encode())
        while b'\r\n\r\n' not in self.buf:
            self._fill()
        head, self.buf = self.buf.split(b'\r\n\r\n', 1)
        lines = head.decode('latin-1').split('\r\n')
        if ' 101 ' not in lines[0] + ' ':
            raise HAError('websocket rechazado: ' + lines[0])
        headers = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(':') for ln in lines[1:])}
        if headers.get('sec-websocket-accept') != base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode():
            raise HAError('respuesta websocket inválida')
        try:
            if self.recv().get('type') != 'auth_required':
                raise HAError('respuesta inesperada de Home Assistant')
            self.send({'type': 'auth', 'access_token': token})
            msg = self.recv()
            if msg.get('type') != 'auth_ok':
                raise HAError('autenticación rechazada: %s' % msg.get('message', msg))
            self.version = msg.get('ha_version', '?')
        except BaseException:
            self.close()
            raise

    def _fill(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise HAError('Home Assistant cerró la conexión')
        self.buf += chunk

    def _take(self, n):
        while len(self.buf) < n:
            self._fill()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    @staticmethod
    def _xor(data, mask):
        if not data:
            return b''
        m = (mask * (len(data) // 4 + 1))[:len(data)]
        return (int.from_bytes(data, 'big') ^ int.from_bytes(m, 'big')).to_bytes(len(data), 'big')

    def _frame(self, opcode, payload):
        n = len(payload)
        head = bytearray([0x80 | opcode])
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += n.to_bytes(2, 'big')
        else:
            head.append(0x80 | 127)
            head += n.to_bytes(8, 'big')
        mask = os.urandom(4)
        self.sock.sendall(bytes(head) + mask + self._xor(payload, mask))

    def send(self, obj):
        self._frame(1, json.dumps(obj).encode())

    def recv(self):
        parts = []
        while True:
            b1, b2 = self._take(2)
            n = b2 & 0x7F
            if n == 126:
                n = int.from_bytes(self._take(2), 'big')
            elif n == 127:
                n = int.from_bytes(self._take(8), 'big')
            mask = self._take(4) if b2 & 0x80 else None
            data = self._take(n)
            if mask:
                data = self._xor(data, mask)
            op = b1 & 0x0F
            if op == 9:
                self._frame(10, data)
            elif op == 8:
                raise HAError('Home Assistant cerró la conexión')
            elif op in (0, 1, 2):
                parts.append(data)
                if b1 & 0x80:
                    return json.loads(b''.join(parts))

    def call(self, kind, **kw):
        self.n += 1
        self.send(dict(kw, id=self.n, type=kind))
        while True:
            msg = self.recv()
            if msg.get('id') == self.n and msg.get('type') == 'result':
                if not msg.get('success'):
                    err = msg.get('error') or {}
                    raise HAError('%s: %s' % (kind, err.get('message', err)), err.get('code'))
                return msg.get('result')

    def close(self):
        try:
            self._frame(8, b'')
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass
