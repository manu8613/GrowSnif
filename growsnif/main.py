"""GrowSnif - Home Assistant add-on entry point.

Listens to a transparent RS485-to-TCP gateway and publishes the meter values to
Home Assistant through MQTT Discovery. The TCP socket is only ever read from:
this program never writes a single byte to the RS485 bus.
"""
import json
import logging
import os
import re
import signal
import socket
import threading
import time
import urllib.request
from pathlib import Path

import paho.mqtt.client as mqtt

from protocol import DERIVED, REGS, Decoder, apparent_power, convert

VERSION = '1.3.0'
SUPERVISOR_MQTT = 'http://supervisor/services/mqtt'
FAST = ('potencia_total', 'potencia_importada', 'potencia_exportada')
FAST_EXPIRE, SLOW_EXPIRE = 10, 180
STOP = threading.Event()

DEFAULTS = {
    'gateway_host': '', 'gateway_port': 4196, 'meter_address': 1,
    'ct_ratio': 1.0, 'pt_ratio': 1.0, 'invert_power_sign': False, 'publish_interval': 1,
    'id_prefix': 'growsnif', 'device_name': 'GrowSnif medidor', 'discovery_prefix': 'homeassistant',
    'mqtt_host': '', 'mqtt_port': 1883, 'mqtt_username': '', 'mqtt_password': '', 'log_level': 'info',
    # Inverter channel (optional, off by default: existing installations do not change)
    'inverter_enabled': False, 'inverter_host': '', 'inverter_port': 4197, 'inverter_address': 1,
    'inverter_mppts': 2, 'inverter_strings': 0, 'inverter_id_prefix': 'growsnif_inversor',
    'inverter_device_name': 'GrowSnif inversor',
}


def load_options(path=None):
    path = Path(path or os.environ.get('GROWSNIF_OPTIONS', '/data/options.json'))
    opts = dict(DEFAULTS)
    opts.update({k: v for k, v in json.loads(path.read_text()).items() if v is not None})
    errors = []
    if not str(opts['gateway_host']).strip():
        errors.append('gateway_host vacío: pon la IP o el nombre de tu pasarela RS485-TCP')
    if not 1 <= int(opts['meter_address']) <= 247:
        errors.append('meter_address debe estar entre 1 y 247')
    if float(opts['ct_ratio']) <= 0 or float(opts['pt_ratio']) <= 0:
        errors.append('ct_ratio y pt_ratio deben ser > 0')
    if int(opts['publish_interval']) < 1:
        errors.append('publish_interval debe ser >= 1')
    for key in ('id_prefix', 'discovery_prefix'):
        if not re.fullmatch(r'[a-z0-9_]{1,40}', str(opts[key])):
            errors.append(key + ': solo minúsculas, números y _ (máx. 40)')
    if opts['inverter_enabled']:
        if not re.fullmatch(r'[a-z0-9_]{1,40}', str(opts['inverter_id_prefix'])):
            errors.append('inverter_id_prefix: solo minúsculas, números y _ (máx. 40)')
        if opts['inverter_id_prefix'] == opts['id_prefix']:
            errors.append('inverter_id_prefix debe ser distinto de id_prefix')
        if not 1 <= int(opts['inverter_address']) <= 247:
            errors.append('inverter_address debe estar entre 1 y 247')
        if not 1 <= int(opts['inverter_mppts']) <= 16:
            errors.append('inverter_mppts debe estar entre 1 y 16')
        if not 0 <= int(opts['inverter_strings']) <= 32:
            errors.append('inverter_strings debe estar entre 0 y 32')
        inv_host = str(opts['inverter_host'] or '').strip() or str(opts['gateway_host']).strip()
        if (inv_host, int(opts['inverter_port'])) == (str(opts['gateway_host']).strip(), int(opts['gateway_port'])):
            errors.append('el inversor necesita su propio canal: inverter_host/inverter_port no pueden ser '
                          'los mismos que gateway_host/gateway_port')
    if errors:
        raise ValueError('; '.join(errors))
    return opts


def resolve_mqtt(opts, fetch=None):
    """Return (host, port, username, password).

    Options win when filled in; otherwise the Mosquitto credentials are asked to
    the Supervisor (config.yaml: services mqtt:need). Nothing is stored in the repo.
    """
    host = (opts.get('mqtt_host') or '').strip()
    port = opts.get('mqtt_port')
    user = (opts.get('mqtt_username') or '').strip()
    password = opts.get('mqtt_password') or ''
    if host and user:
        return host, int(port or 1883), user, password
    if fetch is None:
        def fetch():
            token = os.environ.get('SUPERVISOR_TOKEN')
            if not token:
                raise RuntimeError('sin SUPERVISOR_TOKEN: rellena las opciones MQTT a mano')
            req = urllib.request.Request(SUPERVISOR_MQTT, headers={'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read())['data']
    data = fetch()
    logging.info('Credenciales MQTT obtenidas del Supervisor')
    return host or data['host'], int(port or data['port']), user or data['username'], password or data['password']


def discovery(opts):
    prefix = opts['id_prefix']
    device = {'identifiers': ['%s_%03d' % (prefix, int(opts['meter_address']))],
              'name': opts['device_name'], 'manufacturer': 'CHINT',
              'model': 'DTSU666 (escucha pasiva GrowSnif)', 'sw_version': VERSION}
    specs = [(r.key, r.name, r.unit, r.device_class, r.decimals) for r in REGS.values()] + DERIVED
    result = {}
    for key, name, unit, device_class, decimals in specs:
        cfg = {'name': name, 'unique_id': prefix + '_' + key, 'default_entity_id': 'sensor.' + prefix + '_' + key,
               'state_topic': prefix + '/state/' + key, 'availability_topic': prefix + '/availability',
               'expire_after': FAST_EXPIRE if key in FAST else SLOW_EXPIRE,
               'state_class': 'total_increasing' if device_class == 'energy' else 'measurement',
               'suggested_display_precision': decimals, 'device': device}
        if unit:
            cfg['unit_of_measurement'] = unit
        if device_class:
            cfg['device_class'] = device_class
        result[key] = cfg
    return result


def scale_values(values, opts, cache, now):
    """Apply ratios/sign to decoded (addr, raw) pairs and store them in cache."""
    ct, pt, invert = float(opts['ct_ratio']), float(opts['pt_ratio']), bool(opts['invert_power_sign'])
    for addr, raw in values:
        key = REGS[addr].key
        value = convert(addr, raw, ct, pt)
        if key.startswith('potencia_') and invert:
            value = -value
        if key.startswith('energia_') and value < 0:
            continue
        cache[key] = (value, now)
        if key == 'potencia_total':
            cache['potencia_importada'] = (max(value, 0.0), now)
            cache['potencia_exportada'] = (max(-value, 0.0), now)
    # Apparent power only from U and I that arrived in the same block.
    batch = {REGS[a].key for a, _ in values}
    if {'tension_l1', 'corriente_l1'} <= batch:
        for key, value in apparent_power({k: v for k, (v, _) in cache.items()}).items():
            cache[key] = (value, now)


def main():
    opts = load_options()
    logging.basicConfig(level=getattr(logging, str(opts['log_level']).upper(), logging.INFO),
                        format='%(asctime)s %(levelname)s %(message)s')
    prefix, disc = opts['id_prefix'], opts['discovery_prefix']
    interval = float(opts['publish_interval'])
    host, port, user, password = resolve_mqtt(opts)
    inverter_thread = None
    if opts['inverter_enabled']:
        import inverter  # only needed when the inverter channel is on
        inverter_thread = threading.Thread(target=inverter.run, name='inversor',
                                           args=(opts, STOP, (host, port, user, password), VERSION), daemon=True)
        inverter_thread.start()

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=prefix + '_growsnif')
    client.username_pw_set(user, password)
    client.will_set(prefix + '/availability', 'offline', qos=1, retain=True)
    client.max_queued_messages_set(100)
    client.reconnect_delay_set(1, 30)
    rediscover = threading.Event()

    def on_connect(c, userdata, flags, reason, properties):
        if reason.is_failure:
            logging.error('MQTT rechazado: %s', reason)
            return
        c.subscribe(disc + '/status')
        rediscover.set()
        logging.info('MQTT conectado')

    def on_message(c, userdata, msg):
        if msg.topic == disc + '/status' and msg.payload == b'online':
            rediscover.set()

    client.on_connect, client.on_message = on_connect, on_message
    client.connect_async(host, port, 60)
    client.loop_start()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *args: STOP.set())

    sock = None
    decoder = Decoder(int(opts['meter_address']))
    cache, last_sent = {}, {}
    available, last_frame, last_log, retry = False, 0.0, 0.0, 0.0
    try:
        while not STOP.is_set():
            now = time.monotonic()
            if rediscover.is_set() and client.is_connected():
                rediscover.clear()
                for key, cfg in discovery(opts).items():
                    client.publish('%s/sensor/%s/%s/config' % (disc, prefix, key),
                                   json.dumps(cfg, ensure_ascii=False), qos=1, retain=True)
                last_sent.clear()
                client.publish(prefix + '/availability', 'online' if available else 'offline', qos=1, retain=True)

            if sock is None and now >= retry:
                try:
                    sock = socket.create_connection((opts['gateway_host'], int(opts['gateway_port'])), timeout=5)
                    sock.settimeout(0.2)
                    decoder = Decoder(int(opts['meter_address']))
                    cache.clear(); last_sent.clear(); last_frame = 0.0
                    logging.info('Escuchando la pasarela (solo lectura). Esclavo=%s CT=%s PT=%s',
                                 opts['meter_address'], opts['ct_ratio'], opts['pt_ratio'])
                except OSError as e:
                    logging.warning('Pasarela no disponible: %s', e)
                    retry = time.monotonic() + 5

            if sock:
                try:
                    chunk = sock.recv(4096)  # ONLY receive: never send/sendall on this socket.
                    if not chunk:
                        raise ConnectionError('conexión cerrada por la pasarela')
                    now = time.monotonic()
                    values = decoder.feed(chunk, now)
                    if values:
                        last_frame = now
                        scale_values(values, opts, cache, now)
                except socket.timeout:
                    pass
                except OSError as e:
                    logging.warning('TCP: %s', e)
                    sock.close(); sock = None; cache.clear(); last_frame = 0.0
                    retry = time.monotonic() + 5
            else:
                STOP.wait(0.2)

            now = time.monotonic()
            fresh = bool(last_frame and now - last_frame < FAST_EXPIRE)
            if fresh != available:
                available = fresh
                client.publish(prefix + '/availability', 'online' if fresh else 'offline', qos=1, retain=True)
            if sock and last_frame and now - last_frame > 30:
                logging.warning('30 s sin respuestas válidas del esclavo %s; reconectando', opts['meter_address'])
                sock.close(); sock = None; retry = now + 5; cache.clear(); last_frame = 0.0

            if client.is_connected():
                for key, (value, stamp) in list(cache.items()):
                    fast = key in FAST
                    prev = last_sent.get(key, (-1.0, -1.0))
                    # Never re-publish an old measurement with a new timestamp.
                    if stamp > prev[1] and now - stamp < (FAST_EXPIRE if fast else SLOW_EXPIRE) \
                            and (not fast or now - prev[0] >= interval):
                        info = client.publish(prefix + '/state/' + key, format(value, '.10g'), qos=1, retain=False)
                        if info.rc == mqtt.MQTT_ERR_SUCCESS:
                            last_sent[key] = (now, stamp)

            if now - last_log > 60:
                logging.info('RX consultas=%d respuestas=%d huerfanas=%d bytes_descartados=%d excepciones=%d sensores=%d',
                             decoder.requests, decoder.responses, decoder.orphans, decoder.discarded,
                             decoder.exceptions, len(cache))
                last_log = now
    finally:
        STOP.set()
        if inverter_thread:
            inverter_thread.join(timeout=5)
        if sock:
            sock.close()
        if client.is_connected():
            client.publish(prefix + '/availability', 'offline', qos=1, retain=True).wait_for_publish(timeout=2)
        client.disconnect()
        client.loop_stop()


if __name__ == '__main__':
    main()
