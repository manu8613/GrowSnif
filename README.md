# GrowSnif

**Escucha pasiva del medidor CHINT DTSU666 en instalaciones Growatt, para Home Assistant.**

*Passive sniffer for the CHINT DTSU666 smart meter on Growatt RS485 buses. It reads the
traffic between the Growatt datalogger and the meter through a transparent RS485-to-TCP
gateway and publishes 30 sensors to Home Assistant via MQTT Discovery. It never writes
to the bus, so export limitation keeps working untouched.*

## Por qué

En muchas instalaciones Growatt el datalogger (ShineMaster, ShineWiLan…) es el maestro del
bus RS485 y pregunta al medidor varias veces por segundo para la limitación de vertido.
Poner un segundo maestro en ese bus provoca colisiones. GrowSnif no pregunta nada: escucha
las respuestas que ya circulan y las convierte en sensores.

```
Datalogger Growatt ──RS485──┬── CHINT DTSU666
                            │
                  Pasarela RS485→TCP (solo escucha)
                            │ TCP
                   Home Assistant · GrowSnif ──MQTT──> sensores
```

## Instalación

[![Añadir repositorio a mi Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmanu8613%2FGrowSnif)

1. **Ajustes → Complementos → Tienda de complementos → ⋮ → Repositorios** y añade
   `https://github.com/manu8613/GrowSnif`.
2. Instala **GrowSnif**, rellena al menos `gateway_host`, `meter_address` y `ct_ratio`.
3. Arranca. Las entidades aparecen en el dispositivo MQTT con el nombre que elijas.

Instrucciones completas, opciones y solución de problemas en
[growsnif/DOCS.md](growsnif/DOCS.md). Hay un panel de ejemplo en
[dashboards/dashboard_growsnif.yaml](dashboards/dashboard_growsnif.yaml).

## Sensores

| Del bus (24) | Calculados (6) |
|---|---|
| Tensión L1/L2/L3 y AB/BC/CA, corriente L1–L3, potencia activa y reactiva (total y por fase), factor de potencia (total y por fase), frecuencia, energía importada y exportada | Potencia importada, potencia exportada, potencia aparente (total y por fase) |

## Seguridad

- El código solo **lee** del socket TCP. La CI falla si aparece cualquier llamada de envío
  y la prueba de extremo a extremo comprueba que la pasarela no recibe ni un byte.
- Una pasarela en modo transparente reenvía al bus lo que le llegue por TCP. Ponla en una
  red o VLAN restringida y no la expongas a Internet.
- Sin credenciales en el repositorio ni en la configuración: MQTT las da el Supervisor.
- Las capturas reales contienen datos de tu instalación. `tools/capture.py` las guarda
  donde le digas; la carpeta `captures/` está ignorada por git. Las pruebas usan una
  captura **sintética** (`tools/make_synthetic_capture.py`).

## Desarrollo

```bash
pip install paho-mqtt==2.1.0 pyyaml
cd tests
python test_protocol.py data/captura_sintetica.txt
python test_main.py
python test_runtime.py
```

Capturar tu propio bus (solo lectura):

```bash
python tools/capture.py --host <pasarela> --port 4196 --minutes 10 -o captures/bus.txt
```

## Hoja de ruta

- Escucha del bus datalogger ↔ inversor Growatt para tener la producción en local.

## Licencia

MIT. Proyecto independiente, sin relación con Growatt, CHINT ni Waveshare.
