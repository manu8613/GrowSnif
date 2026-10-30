# GrowSnif

Escucha **pasiva** del medidor **CHINT DTSU666** en el bus RS485 que comparte con un
datalogger Growatt (ShineMaster, ShineWiLan…) y publica sus valores en Home Assistant
por MQTT Discovery.

El complemento **nunca escribe en el bus**: solo lee lo que el datalogger pregunta y lo
que el medidor responde. Así no interfiere con la limitación de vertido de Growatt.

## Qué necesitas

- Un medidor CHINT DTSU666 conectado por RS485 a un datalogger Growatt.
- Una pasarela RS485 → Ethernet en modo **TCP Server transparente** (probado con
  Waveshare RS485 TO POE ETH (B)).
- El complemento **Mosquitto broker** y la integración **MQTT** en Home Assistant.

## 1. Conectar la pasarela

- Conecta A+ y B− de la pasarela **en paralelo** con el par RS485 que va del datalogger
  al medidor. No cortes ni sustituyas ningún cable. Si la pasarela tiene GND, únelo al
  común del bus si existe.
- No añadas resistencia de terminación en la pasarela si el bus ya está terminado.

## 2. Configurar la pasarela

| Parámetro | Valor |
|---|---|
| Work Mode | TCP Server |
| Transfer Protocol / Modbus | **None** (transparente). No uses "Modbus TCP to RTU" |
| Baudios, bits, paridad, parada | Los mismos que el bus (suele ser 9600 8N1) |
| IP | Fija, de tu red |

Puedes ver los parámetros del bus en la pantalla del CHINT (menú de comunicación) o en
la web del datalogger.

## 3. Opciones del complemento

| Opción | Por defecto | Qué es |
|---|---|---|
| `gateway_host` | (vacío) | **Obligatorio.** IP o nombre de la pasarela |
| `gateway_port` | 4196 | Puerto TCP de la pasarela |
| `meter_address` | 1 | Dirección Modbus del CHINT (pantalla del medidor, menú **NO.**) |
| `ct_ratio` | 1 | Relación de los trafos de intensidad (ej. 400/5 A → 80). 1 si es de conexión directa |
| `pt_ratio` | 1 | Relación de los trafos de tensión (normalmente 1) |
| `invert_power_sign` | false | Actívalo si al importar de la red la potencia sale negativa |
| `publish_interval` | 1 | Segundos mínimos entre publicaciones de la potencia rápida |
| `id_prefix` | growsnif | Prefijo de entidades y temas MQTT (`sensor.growsnif_...`) |
| `device_name` | GrowSnif medidor | Nombre del dispositivo en Home Assistant |
| `discovery_prefix` | homeassistant | Prefijo de MQTT Discovery |
| `mqtt_host/port/username/password` | (vacío) | Vacío = credenciales automáticas del Supervisor |
| `log_level` | info | debug, info, warning o error |

### Cómo sacar `ct_ratio`

El DTSU666 entrega intensidades, potencias y energías **del lado secundario**. GrowSnif
las multiplica por `ct_ratio`. Compruébalo con la pantalla del medidor: la corriente de
una fase en HA debe coincidir con la que ves en el display.

### Conservar el historial de una instalación anterior

Si ya tenías estas entidades con otro nombre (por ejemplo `sensor.mi_medidor_potencia_total`),
pon ese prefijo en `id_prefix` (`mi_medidor`) y la misma `meter_address`. Los `unique_id`
coincidirán y Home Assistant conservará el historial. Detén antes el complemento antiguo:
dos copias a la vez se desconectan entre sí.

## 4. Sensores

24 magnitudes leídas del bus y 6 calculadas:

- Tensiones fase-neutro y entre fases, corrientes, potencia activa y reactiva (total y por
  fase), factor de potencia (total y por fase), frecuencia.
- Energía importada y exportada (kWh, `total_increasing`, válidas para el panel Energía).
- Calculadas: potencia importada, potencia exportada y potencia aparente (total y por fase).

Solo aparecen las magnitudes que el datalogger pregunta. Con un ShineMaster la potencia
total llega varias veces por segundo y el resto aproximadamente cada minuto.

## 5. Panel Energía

| Campo | Sensor |
|---|---|
| Consumo de la red | `sensor.<prefijo>_energia_importada` |
| Devolución a la red | `sensor.<prefijo>_energia_exportada` |

No cambies `ct_ratio` después de empezar a registrar energía: falsearía las estadísticas.

## 6. Comprobar que funciona

En el registro del complemento verás cada minuto una línea como:

```
RX consultas=230 respuestas=230 huerfanas=0 bytes_descartados=0 excepciones=0 sensores=30
```

- `consultas` y `respuestas` crecen a la par: todo bien.
- `consultas` crece y `respuestas` no: `meter_address` incorrecta o el medidor no contesta.
- Nada crece: revisa la conexión A/B, los baudios o que la pasarela esté en modo transparente.
- Muchos `bytes_descartados`: ruido en el bus o parámetros serie distintos.

## 7. Seguridad

- El socket hacia la pasarela solo se lee. Las pruebas automáticas comprueban que no se
  envía ni un byte.
- Una pasarela en TCP Server transparente acepta tramas de **cualquiera** que se conecte
  a su puerto, y esas tramas llegan al bus. Ponla en una red o VLAN restringida,
  bloquea su puerto desde otras redes, cambia la contraseña de su configuración y no la
  expongas a Internet.
- No se guardan credenciales: MQTT las da el Supervisor en cada arranque.
- El contenedor no usa red del host, ni privilegios, ni la API de Home Assistant.
