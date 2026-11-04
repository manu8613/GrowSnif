"""GrowSnif - installs the control panel in Home Assistant (optional).

With `panel_install` on, at start-up and in its own thread:
  1. copies the card to <config>/www/growsnif/ (only if it changed);
  2. registers it as a dashboard resource, with the add-on version in the URL so
     browsers load the new card after every update;
  3. creates the "GrowSnif" dashboard from the add-on options.

`panel_mode`:
  una_vez     the dashboard config is written only when it does not exist yet;
              whatever you change in it afterwards is never touched.
  gestionado  the add-on options own the dashboard: when they change, the config
              is rewritten, after saving the previous one in <config>/growsnif/backups/.

It never touches the RS485 gateways and any failure here only gets logged.
"""
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path

from haws import HAError, HAWebSocket

CARD = 'growsnif-panel.js'
CARD_SRC = Path(__file__).resolve().parent / 'www' / CARD
CARD_DIR = 'www/growsnif'
BACKUPS_KEEP = 20
log = logging.getLogger('panel')

def resource_url(version):
    return '/local/growsnif/%s?v=%s' % (CARD, version)


def _clean(d):
    return {k: v for k, v in d.items() if v not in (None, '', [], {})}


def build_config(opts):
    """Dashboard config (dict) generated from the add-on options."""
    base = {'meter_prefix': opts['id_prefix']}
    inverter = bool(opts.get('inverter_enabled'))
    if inverter:
        base['inverter_prefix'] = opts['inverter_id_prefix']
    lines = []
    for n, line in enumerate(opts.get('panel_lines') or [], 1):
        if not isinstance(line, dict) or not str(line.get('power') or '').strip():
            continue
        lines.append(_clean({'name': str(line.get('name') or 'Línea %d' % n).strip(),
                             'code': str(line.get('code') or 'L%02d' % n).strip(),
                             'power': str(line['power']).strip(), 'energy': str(line.get('energy') or '').strip(),
                             'current': str(line.get('current') or '').strip(),
                             'max': int(line['max']) if line.get('max') else None}))
    co2 = {'co2_entity': str(opts.get('panel_co2_entity') or '').strip(), 'co2_factor': int(opts['panel_co2_factor'])}
    control = dict(type='custom:growsnif-panel', title=opts['panel_title'], subtitle=opts.get('panel_subtitle') or '', **base,
                   nominal_power=int(opts['panel_nominal_power']),
                   mppts=int(opts['inverter_mppts']) if inverter else 0,
                   strings=int(opts['inverter_strings']) if inverter else 0,
                   strings_per_mppt=int(opts['panel_strings_per_mppt']),
                   zero_export=bool(opts['panel_zero_export']), lines=lines,
                   price_kwh=float(opts['panel_price_kwh']) or None, **co2,
                   thresholds={'pf_min': float(opts['panel_pf_min']), 'v_min': float(opts['panel_voltage_min']),
                               'v_max': float(opts['panel_voltage_max']), 'unbalance_max': float(opts['panel_unbalance_max']),
                               'temp_warn': float(opts['panel_temp_warn']), 'export_max': float(opts['panel_export_alarm'])})
    views = [{'title': 'Control', 'path': 'control', 'icon': 'mdi:transmission-tower', 'type': 'panel', 'cards': [_clean(control)]}]
    if inverter and opts.get('panel_savings'):
        prices = [str(x).strip() for x in (opts.get('panel_price_entities') or []) if str(x).strip()]
        views.append({'title': 'Ahorro', 'path': 'ahorro', 'icon': 'mdi:piggy-bank-outline', 'type': 'panel', 'cards': [_clean(dict(
            type='custom:growsnif-ahorro', **base, price_entities=prices, price_kwh=float(opts['panel_price_kwh']) or None,
            price_now_entity=str(opts.get('panel_price_now_entity') or '').strip(),
            cost_entity=str(opts.get('panel_cost_entity') or '').strip(), tax_factor=float(opts['panel_tax_factor'])))]})
    if inverter and opts.get('panel_impact'):
        views.append({'title': 'Impacto', 'path': 'impacto', 'icon': 'mdi:forest', 'type': 'panel',
                      'cards': [_clean(dict(type='custom:growsnif-impacto', **base, **co2))]})
    return {'title': opts['panel_title'], 'views': views}


def install_card(config_dir):
    """Copy the card next to the HA config. Returns True if the file changed."""
    dest_dir = Path(config_dir) / CARD_DIR
    dest = dest_dir / CARD
    new = CARD_SRC.read_bytes()
    if dest.exists() and dest.read_bytes() == new:
        return False
    dest_dir.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.tmp')
    tmp.write_bytes(new)
    os.replace(tmp, dest)
    return True


def ensure_resource(ha, version):
    """One resource for the card, pointing at the current version. Returns what was done."""
    url = resource_url(version)
    resources = ha.call('lovelace/resources') or []
    ours = [r for r in resources if CARD in str(r.get('url', ''))]
    if not ours:
        ha.call('lovelace/resources/create', res_type='module', url=url)
        return 'creado'
    first, rest = ours[0], ours[1:]
    done = 'sin cambios'
    if first.get('url') != url or first.get('type') != 'module':
        ha.call('lovelace/resources/update', resource_id=first['id'], res_type='module', url=url)
        done = 'actualizado'
    for r in rest:       # older copies of this same card (e.g. installed by hand)
        ha.call('lovelace/resources/delete', resource_id=r['id'])
        done = 'actualizado'
    return done


def _backup(config_dir, url_path, cfg):
    d = Path(config_dir) / 'growsnif' / 'backups'
    d.mkdir(parents=True, exist_ok=True)
    f = d / ('%s-%s.json' % (url_path, datetime.now().strftime('%Y%m%d-%H%M%S')))
    f.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding='utf-8')
    old = sorted(d.glob(url_path + '-*.json'))
    for x in old[:-BACKUPS_KEEP]:
        x.unlink()
    return f


def ensure_dashboard(ha, opts, config_dir):
    url_path = opts['panel_url']
    meta = dict(title=opts['panel_sidebar_title'], icon=opts['panel_icon'], show_in_sidebar=True, require_admin=False)
    boards = ha.call('lovelace/dashboards/list') or []
    board = next((b for b in boards if b.get('url_path') == url_path), None)
    created = False
    if board is None:
        ha.call('lovelace/dashboards/create', url_path=url_path, mode='storage', **meta)
        created = True
    elif opts['panel_mode'] == 'gestionado' and any(board.get(k) != v for k, v in meta.items() if k != 'require_admin'):
        ha.call('lovelace/dashboards/update', dashboard_id=board['id'], **meta)
    try:
        current = ha.call('lovelace/config', url_path=url_path)
    except HAError as e:
        if e.code != 'config_not_found':
            raise
        current = None
    wanted = build_config(opts)
    state = Path(config_dir) / 'growsnif' / ('panel-%s.json' % url_path)
    state.parent.mkdir(parents=True, exist_ok=True)
    state.write_text(json.dumps(wanted, ensure_ascii=False, indent=1), encoding='utf-8')
    if current is None:
        ha.call('lovelace/config/save', url_path=url_path, config=wanted)
        return 'creado' if created else 'configurado'
    if opts['panel_mode'] != 'gestionado' or current == wanted:
        return 'sin cambios'
    backup = _backup(config_dir, url_path, current)
    ha.call('lovelace/config/save', url_path=url_path, config=wanted)
    return 'actualizado (copia del anterior en %s)' % backup


def install(opts, version, connect, config_dir):
    """One full pass. `connect()` returns an open HAWebSocket."""
    changed = install_card(config_dir)
    ha = connect()
    try:
        res = ensure_resource(ha, version)
        board = ensure_dashboard(ha, opts, config_dir)
    finally:
        ha.close()
    log.info('Panel: tarjeta %s, recurso %s, panel /%s %s', 'copiada' if changed else 'al día', res, opts['panel_url'], board)
    return changed, res, board


def supervisor_connect():
    token = os.environ.get('SUPERVISOR_TOKEN')
    if not token:
        raise HAError('sin SUPERVISOR_TOKEN')
    return HAWebSocket('supervisor', 80, '/core/websocket', token)


def start(opts, version, stop, config_dir='/homeassistant', connect=supervisor_connect, attempts=10, wait=30):
    """Run the installer in the background, retrying while Home Assistant starts."""
    def run():
        if not CARD_SRC.exists():
            log.error('Panel: falta %s en la imagen', CARD_SRC)
            return
        if not Path(config_dir).is_dir():
            log.error('Panel: no veo la configuración de Home Assistant en %s', config_dir)
            return
        for n in range(1, attempts + 1):
            try:
                install(opts, version, connect, config_dir)
                return
            except (HAError, OSError, ValueError) as e:
                log.warning('Panel: intento %d de %d fallido: %s', n, attempts, e)
                if stop.wait(wait):
                    return
        log.error('Panel: no se pudo instalar. La escucha sigue funcionando con normalidad.')
    t = threading.Thread(target=run, name='panel', daemon=True)
    t.start()
    return t


__all__ = ['build_config', 'install', 'install_card', 'ensure_resource', 'ensure_dashboard', 'start', 'resource_url']
