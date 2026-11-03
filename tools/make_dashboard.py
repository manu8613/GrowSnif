"""Build a GrowSnif dashboard for your own prefixes and inverter size.

    python tools/make_dashboard.py --meter-prefix mi_red --inverter-prefix mi_inversor \
        --mppts 4 --strings 8 -o mi_panel.yaml

Paste the result in a dashboard: Edit -> three dots -> Raw configuration editor.
Without --inverter-prefix you get only the meter views; with --no-meter only the inverter ones.
"""
import argparse
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def meter_views(prefix):
    text = (ROOT / 'dashboards/dashboard_growsnif.yaml').read_text()
    return yaml.safe_load(text.replace('sensor.growsnif_', 'sensor.%s_' % prefix))['views']


def inverter_views(p, mppts, strings, meter=None):
    e = lambda key: 'sensor.%s_%s' % (p, key)  # noqa: E731
    summary = [
        {'type': 'markdown', 'content': '# Inversor · producción\n\nEscucha pasiva del bus datalogger ↔ inversor. '
         'Potencia AC cada ~3 s; el resto, ~1 min. **Sin respuesta** = inversor apagado (noche).'},
        {'type': 'grid', 'columns': 3, 'square': False, 'cards': [
            {'type': 'gauge', 'entity': e('potencia_ac'), 'name': 'Potencia AC · W', 'min': 0, 'max': 110000,
             'needle': True},
            {'type': 'gauge', 'entity': e('potencia_fv'), 'name': 'Potencia FV · W', 'min': 0, 'max': 110000,
             'needle': True},
            {'type': 'gauge', 'entity': e('limite_antivertido'), 'name': 'Límite antivertido · %', 'min': 0,
             'max': 100, 'needle': True}]},
        {'type': 'entities', 'title': 'Estado', 'show_header_toggle': False, 'entities': [
            e('estado'), e('limitacion'), e('potencia_porcentaje'), e('limite_antivertido')]
            + ([e('strings_desconectados')] if strings else [])},
        {'type': 'history-graph', 'title': 'Producción · últimas 6 horas', 'hours_to_show': 6,
         'entities': [e('potencia_ac')] + ([{'entity': 'sensor.%s_potencia_total' % meter, 'name': 'Red'}]
                                          if meter else [])},
        {'type': 'entities', 'title': 'Energía', 'show_header_toggle': False, 'entities': [
            e('energia_hoy'), e('energia_total'), e('energia_fv_total')]},
        {'type': 'statistics-graph', 'title': 'Producción por hora', 'entities': [e('energia_total')],
         'period': 'hour', 'days_to_show': 2, 'stat_types': ['change'], 'chart_type': 'bar'},
    ]
    grid = [
        {'type': 'entities', 'title': 'Salida AC', 'show_header_toggle': False, 'entities': [
            e('tension_l1'), e('tension_l2'), e('tension_l3'), e('corriente_l1'), e('corriente_l2'),
            e('corriente_l3'), e('aparente_total'), e('reactiva'), e('factor_potencia'), e('frecuencia')]},
        {'type': 'history-graph', 'title': 'Reactiva · 24 h', 'hours_to_show': 24,
         'entities': [e('reactiva'), e('reactiva_maxima')]},
        {'type': 'entities', 'title': 'Temperaturas y bus DC', 'show_header_toggle': False, 'entities': [
            e('temperatura_inversor'), e('temperatura_ipm'), e('temperatura_boost'),
            e('bus_dc_positivo'), e('bus_dc_negativo')]},
        {'type': 'entities', 'title': 'Aislamiento y protecciones', 'show_header_toggle': False, 'entities': [
            e('aislamiento'), e('fuga_tierra'), e('dci_r'), e('dci_s'), e('dci_t'),
            e('ventiladores_averiados'), e('fallo_codigo'), e('aviso_codigo'), e('horas_funcionamiento')]},
    ]
    dc = [{'type': 'history-graph', 'title': 'Potencia por MPPT · hoy', 'hours_to_show': 12,
           'entities': [e('mppt%d_potencia' % n) for n in range(1, mppts + 1)]}]
    for n in range(1, mppts + 1):
        dc.append({'type': 'entities', 'title': 'MPPT%d' % n, 'show_header_toggle': False, 'entities': [
            e('mppt%d_tension' % n), e('mppt%d_corriente' % n), e('mppt%d_potencia' % n),
            e('mppt%d_energia_hoy' % n), e('mppt%d_energia_total' % n)]})
    if strings:
        dc.append({'type': 'entities', 'title': 'Strings', 'show_header_toggle': False, 'entities':
                   [e('strings_desconectados'), e('strings_descompensados'), e('strings_desequilibrados')]
                   + [e('string%d_corriente' % k) for k in range(1, strings + 1)]})
    return [
        {'title': 'Inversor', 'path': 'inversor', 'icon': 'mdi:solar-power-variant', 'type': 'masonry',
         'cards': summary},
        {'title': 'Inversor AC', 'path': 'inversor-ac', 'icon': 'mdi:sine-wave', 'type': 'masonry', 'cards': grid},
        {'title': 'Paneles', 'path': 'paneles', 'icon': 'mdi:solar-panel', 'type': 'masonry', 'cards': dc},
    ]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--meter-prefix', default='growsnif')
    ap.add_argument('--inverter-prefix')
    ap.add_argument('--mppts', type=int, default=2)
    ap.add_argument('--strings', type=int, default=0)
    ap.add_argument('--no-meter', action='store_true')
    ap.add_argument('--title', default='GrowSnif')
    ap.add_argument('-o', '--output', required=True)
    a = ap.parse_args()
    views = [] if a.no_meter else meter_views(a.meter_prefix)
    if a.inverter_prefix:
        views += inverter_views(a.inverter_prefix, a.mppts, a.strings, None if a.no_meter else a.meter_prefix)
    text = yaml.safe_dump({'title': a.title, 'views': views}, allow_unicode=True, sort_keys=False, width=120)
    Path(a.output).write_text(text)
    print('%d vistas en %s' % (len(views), a.output))


if __name__ == '__main__':
    main()
