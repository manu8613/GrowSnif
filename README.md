# GrowSnif

**Escucha pasiva del medidor CHINT DTSU666 y del inversor en instalaciones Growatt, para Home Assistant.**

Creado por [manu8613](https://github.com/manu8613).

*Passive sniffer for Growatt RS485 buses. It reads the traffic between the Growatt
datalogger and the CHINT DTSU666 meter, and optionally the inverter, through a transparent
RS485-to-TCP gateway and publishes the values to Home Assistant via MQTT Discovery. It
never writes to the buses, so export limitation keeps working untouched.*

## Por qué

En muchas instalaciones Growatt el datalogger (ShineMaster, ShineWiLan…) es el maestro del
bus RS485 y pregunta al medidor varias veces por segundo para la limitación de vertido.
Poner un segundo maestro en ese bus provoca colisiones. GrowSnif no pregunta nada: escucha
las respuestas que ya circulan y las convierte en sensores. Con una pasarela de varios
canales escucha también el bus del inversor y tienes la producción en local, sin nube.

```
                   ┌─RS485-1─┬── Inversor Growatt
Datalogger Growatt ┤         │
                   └─RS485-2─┼──┬── CHINT DTSU666
                             │  │
              Pasarela RS485→TCP, un canal por bus (solo escucha)
                             │ TCP
                  Home Assistant · GrowSnif ──MQTT──> sensores
```

## Instalación

[![Añadir repositorio a mi Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmanu8613%2FGrowSnif)

1. **Ajustes → Complementos → Tienda de complementos → ⋮ → Repositorios** y añade
   `https://github.com/manu8613/GrowSnif`.
2. Instala **GrowSnif**, rellena al menos `gateway_host`, `meter_address` y `ct_ratio`.
   Para el inversor, activa `inverter_enabled` y pon el puerto de su canal.
3. Arranca. Las entidades aparecen en los dispositivos MQTT con los nombres que elijas.

Instrucciones completas, opciones y solución de problemas en
[growsnif/DOCS.md](growsnif/DOCS.md). Hay un panel de ejemplo en
[dashboards/](dashboards/), y `tools/make_dashboard.py` genera uno con tus prefijos.

## Sensores

**Medidor (30)**

| Del bus (24) | Calculados (6) |
|---|---|
| Tensión L1/L2/L3 y AB/BC/CA, corriente L1–L3, potencia activa y reactiva (total y por fase), factor de potencia (total y por fase), frecuencia, energía importada y exportada | Potencia importada, potencia exportada, potencia aparente (total y por fase) |

**Inversor (opcional, ~45 + 5 por MPPT + 2 por string)**

Potencia AC y FV, energía hoy y total, salida AC por fase, reactiva y factor de potencia,
estado, motivo de limitación, límite antivertido que escribe el datalogger, temperaturas,
aislamiento, corriente de fuga, y por cada MPPT y string su tensión, corriente y energía,
con aviso de strings desconectados. Probado con un Growatt MAX TL3-X.

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
python test_growatt.py
python test_main.py
python test_runtime.py
python test_runtime_inversor.py
```

Activa `panel_install` y GrowSnif crea el panel **Centro de control**: esquema unifilar,
red trifásica, generación, campo FV, alarmas, balance, ahorro hora a hora y CO₂ evitado,
interactivo y configurable desde las opciones ([DOCS.md, sección 9](growsnif/DOCS.md)).
La tarjeta también se puede instalar a mano: [cards/](cards/README.md).

¿Venías de la integración Growatt (nube)? `tools/migrar_nube_growatt.py` hace que las
entidades locales hereden sus `entity_id` y su historial
([DOCS.md, sección 8](growsnif/DOCS.md)).

Capturar tu propio bus (solo lectura):

```bash
python tools/capture.py --host <pasarela> --port 4196 --minutes 10 -o captures/bus.txt
```

## Hoja de ruta

- ~~Escucha del bus datalogger ↔ inversor Growatt para tener la producción en local.~~ (1.3.0)

## Versiones

Cada versión tiene su etiqueta, su publicación en
[Releases](https://github.com/manu8613/GrowSnif/releases) y una rama congelada
`version-X-Y-Z` para instalar o volver a una versión concreta
([DOCS.md, sección 10](growsnif/DOCS.md)). Se crean solas al subir una versión nueva y
pasar las pruebas.

## Autoría y licencia

Creado por **[manu8613](https://github.com/manu8613)**. Licencia MIT: si clonas el
repositorio, haces un fork o lo usas como base, mantén `LICENSE` y `NOTICE` y menciona
a manu8613 como autor original.

Proyecto independiente, sin relación con Growatt, CHINT ni Waveshare.
