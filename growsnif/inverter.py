"""GrowSnif - inverter channel.

Listens to the datalogger <-> inverter bus through its own gateway channel and
publishes the inverter through its own MQTT connection, device and availability.
It runs in a thread next to the meter and shares nothing with it but the
options and the stop event, so the meter entities behave exactly as before.

The TCP socket is only ever read from: this never writes to the RS485 bus.
"""
import json
import logging
import socket
import time

import paho.mqtt.client as mqtt

from growatt import ASLEEP, DERIVED, Inverter, Sniffer, power_factor

FAST_EXPIRE, SLOW_EXPIRE = 30, 180
BUS_ALIVE = 60        # s with traffic of our slave on the bus -> device online
ASLEEP_AFTER = 90     # s with requests but no answers -> inverter asleep (night)
ZERO_WHEN_ASLEEP = ('potencia_ac', 'potencia_fv')
ZERO_SUFFIXES = ('_potencia', '_corriente')


def discovery(opts, model, version):
    prefix = opts['inverter_id_prefix']
    device = {'identifiers': ['%s_%03d' % (prefix, int(opts['inverter_address']))],
              'name': opts['inverter_device_name'], 'manufacturer': 'Growatt',
              'model': 'Inversor (escucha pasiva GrowSnif)', 'sw_version': version}
    specs = [(s.key, s.name, s.unit, s.device_class, s.state_class, s.decimals, s.fast, s.category, s.keep)
             for s in model.sensors]
    specs += [(k, n, u, dc, 'measurement', d, False, None, False) for k, n, u, dc, d in DERIVED]
    result = {}
    for key, name, unit, dc, sc, decimals, fast, category, keep in specs:
        cfg = {'name': name, 'unique_id': prefix + '_' + key, 'default_entity_id': 'sensor.' + prefix + '_' + key,
               'state_topic': prefix + '/state/' + key, 'availability_topic': prefix + '/availability',
               'device': device}
        if not keep:
            cfg['expire_after'] = FAST_EXPIRE if fast else SLOW_EXPIRE
        for field, value in (('unit_of_measurement', unit), ('device_class', dc), ('state_class', sc),
                             ('suggested_display_precision', decimals), ('entity_category', category)):
            if value is not None:
                cfg[field] = value
        result[key] = cfg
    return result


def asleep_zero_keys(model):
    return [s.key for s in model.sensors
            if s.key in ZERO_WHEN_ASLEEP or (s.key.startswith(('mppt', 'string')) and s.key.endswith(ZERO_SUFFIXES))]


class InverterChannel:
    """Decoding and state, without sockets or MQTT (tested on its own)."""

    def __init__(self, opts):
        self.address = int(opts['inverter_address'])
        self.model = Inverter(int(opts['inverter_mppts']), int(opts['inverter_strings']))
        self.fast = {s.key for s in self.model.sensors if s.fast}
        self.zero_keys = asleep_zero_keys(self.model)
        # Lifetime counters: a lower value would be read by HA as a meter reset.
        self.monotonic = {s.key for s in self.model.sensors
                          if s.state_class == 'total_increasing' and not s.key.endswith('_hoy')}
        self.reset(0.0)

    def reset(self, now):
        self.sniffer = Sniffer(self.address)
        self.cache = {}              # key -> (value, time)
        self.last_asleep = 0.0
        self.started = now
        self.dropped = 0

    def feed(self, data, now):
        return self._apply(self.sniffer.feed(data, now), now)

    def idle(self, now):
        n = self._apply(self.sniffer.idle(now), now)
        self._check_asleep(now)
        return n

    def _apply(self, events, now):
        n = 0
        for event in events:
            values = self.model.apply(event, now)
            for key, value in values.items():
                if key in self.monotonic:
                    prev = self.cache.get(key)
                    if value <= 0 or (prev and value < prev[0]):
                        self.dropped += 1
                        continue
                self.cache[key] = (value, now)
            if 'aparente_total' in values or 'potencia_ac' in values:
                p, s = self.cache.get('potencia_ac'), self.cache.get('aparente_total')
                if p and s and abs(p[1] - s[1]) < 120:
                    fp = power_factor(p[0], s[0])
                    if fp is not None:
                        self.cache['factor_potencia'] = (fp, now)
            n += len(values)
        return n

    def bus_alive(self, now):
        last = max(self.sniffer.last_request, self.sniffer.last_response)
        return bool(last) and now - last < BUS_ALIVE

    def asleep(self, now):
        sn = self.sniffer
        return self.bus_alive(now) and now - sn.last_request < BUS_ALIVE and now - max(sn.last_response, self.started) > ASLEEP_AFTER

    def _check_asleep(self, now):
        # Requests keep coming but the inverter does not answer: night or shutdown.
        if self.asleep(now) and now - self.last_asleep >= FAST_EXPIRE / 2:
            self.last_asleep = now
            self.cache['estado'] = (ASLEEP, now)
            for key in self.zero_keys:
                self.cache[key] = (0.0, now)


def run(opts, stop, mqtt_conf, version):
    """Thread body. Returns when `stop` is set."""
    prefix, disc = opts['inverter_id_prefix'], opts['discovery_prefix']
    interval = float(opts['publish_interval'])
    host = (opts.get('inverter_host') or '').strip() or opts['gateway_host']
    port = int(opts['inverter_port'])
    channel = InverterChannel(opts)
    configs = discovery(opts, channel.model, version)
    keep = {k for k, c in configs.items() if 'expire_after' not in c}
    log = logging.getLogger('inversor')

    mhost, mport, user, password = mqtt_conf
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=prefix + '_growsnif')
    client.username_pw_set(user, password)
    client.will_set(prefix + '/availability', 'offline', qos=1, retain=True)
    client.max_queued_messages_set(300)
    client.reconnect_delay_set(1, 30)
    rediscover = {'flag': False}

    def on_connect(c, userdata, flags, reason, properties):
        if reason.is_failure:
            log.error('MQTT rechazado: %s', reason)
            return
        c.subscribe(disc + '/status')
        rediscover['flag'] = True

    def on_message(c, userdata, msg):
        if msg.topic == disc + '/status' and msg.payload == b'online':
            rediscover['flag'] = True

    client.on_connect, client.on_message = on_connect, on_message
    client.connect_async(mhost, mport, 60)
    client.loop_start()

    sock, last_sent = None, {}
    available, retry, last_log, last_data = False, 0.0, 0.0, 0.0
    try:
        while not stop.is_set():
            now = time.monotonic()
            if rediscover['flag'] and client.is_connected():
                rediscover['flag'] = False
                for key, cfg in configs.items():
                    client.publish('%s/sensor/%s/%s/config' % (disc, prefix, key),
                                   json.dumps(cfg, ensure_ascii=False), qos=1, retain=True)
                last_sent.clear()
                client.publish(prefix + '/availability', 'online' if available else 'offline', qos=1, retain=True)

            if sock is None and now >= retry:
                try:
                    sock = socket.create_connection((host, port), timeout=5)
                    sock.settimeout(0.2)
                    last_data = time.monotonic()
                    channel.reset(last_data)
                    log.info('Inversor: escuchando %s:%s (solo lectura). Esclavo=%s', host, port, channel.address)
                except OSError as e:
                    log.warning('Inversor: pasarela no disponible: %s', e)
                    retry = time.monotonic() + 5

            if sock:
                try:
                    chunk = sock.recv(4096)  # ONLY receive: never send/sendall on this socket.
                    if not chunk:
                        raise ConnectionError('conexión cerrada por la pasarela')
                    last_data = time.monotonic()
                    channel.feed(chunk, last_data)
                except socket.timeout:
                    channel.idle(time.monotonic())
                except OSError as e:
                    log.warning('Inversor TCP: %s', e)
                    sock.close(); sock = None; retry = time.monotonic() + 5
                if sock and time.monotonic() - last_data > 120:
                    log.warning('Inversor: 120 s sin bytes en el bus; reconectando')
                    sock.close(); sock = None; retry = time.monotonic() + 5
            else:
                stop.wait(0.2)

            now = time.monotonic()
            alive = sock is not None and channel.bus_alive(now)
            if alive != available:
                available = alive
                client.publish(prefix + '/availability', 'online' if alive else 'offline', qos=1, retain=True)

            if client.is_connected():
                for key, (value, stamp) in list(channel.cache.items()):
                    fast = key in channel.fast
                    prev = last_sent.get(key, (-1.0, -1.0))
                    limit = None if key in keep else (FAST_EXPIRE if fast else SLOW_EXPIRE)
                    if stamp > prev[1] and (limit is None or now - stamp < limit) \
                            and (not fast or now - prev[0] >= interval):
                        payload = value if isinstance(value, str) else format(value, '.10g')
                        info = client.publish(prefix + '/state/' + key, payload, qos=1, retain=False)
                        if info.rc == mqtt.MQTT_ERR_SUCCESS:
                            last_sent[key] = (now, stamp)

            if now - last_log > 60:
                sn = channel.sniffer
                log.info('Inversor RX consultas=%d respuestas=%d escrituras=%d huerfanas=%d bytes_descartados=%d '
                         'excepciones=%d sensores=%d totales_rechazados=%d', sn.requests, sn.responses, sn.writes,
                         sn.orphans, sn.discarded, sn.exceptions, len(channel.cache), channel.dropped)
                last_log = now
    finally:
        if sock:
            sock.close()
        if client.is_connected():
            client.publish(prefix + '/availability', 'offline', qos=1, retain=True).wait_for_publish(timeout=2)
        client.disconnect()
        client.loop_stop()
