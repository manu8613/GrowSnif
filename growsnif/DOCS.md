# GrowSnif

Escucha **pasiva** de una instalación Growatt y la publica en Home Assistant por
MQTT Discovery:

- el **medidor CHINT DTSU666** del bus datalogger ↔ medidor (30 sensores), y
- opcionalmente, el **inversor Growatt** del bus datalogger ↔ inversor (desde la 1.3.0).

El complemento **nunca escribe en los buses**: solo lee lo que el datalogger pregunta y
lo que los equipos responden. La limitación de vertido sigue funcionando sin cambios.

## Qué necesitas

- Un datalogger Growatt (ShineMaster, ShineWiLan…) que sea el maestro de los buses RS485.
- Una pasarela RS485 → Ethernet en modo **TCP Server transparente**, con **un canal por
  bus**. Probado con Waveshare RS485 TO POE ETH (B) (un canal) y 4-CH RS485 TO POE ETH (B)
  (cuatro canales).
- El complemento **Mosquitto broker** y la integración **MQTT** en Home Assistant.

## 1. Conexionado

### Cómo están los buses

Los datalogger de las instalaciones comerciales suelen tener **dos puertos RS485
independientes**: uno para el inversor y otro para el medidor. Cada uno es un bus distinto
y cada uno necesita **su propio canal** en la pasarela. En la web del datalogger (o en su
etiqueta) verás qué puerto va a cada equipo; por ejemplo, en un ShineMaster:

| Puerto del datalogger | Equipo | Dirección habitual |
|---|---|---|
| RS485-1 | Inversor | 1 |
| RS485-2 | Medidor CHINT | la de su pantalla (menú **NO.**) |

### Esquema con una pasarela de varios canales

```
                    ┌──────── RS485-1 ───────┬──────── Inversor Growatt
  Datalogger        │                        │
  Growatt ──────────┤                        └── Canal 1 ─┐
  (maestro)         │                                     │  Pasarela de varios
                    └──────── RS485-2 ───────┬── CHINT    │  canales (TCP Server
                                             │            │  transparente)
                                             └── Canal 2 ─┤
                                                          │ Ethernet / PoE
                              Canales 3 y 4: libres ──────┤
                                                          ▼
                                          Home Assistant · GrowSnif ──MQTT──▶ sensores
```

El orden de los canales da igual: lo que cuenta es el **puerto TCP** de cada uno, que
pondrás en las opciones.

### Cableado de cada canal

- Conecta **A+ y B−** del canal **en paralelo** con el par del bus, lo más cerca posible
  de las bornas del datalogger o del equipo. Así el canal queda como una derivación muy
  corta. **No cortes ni sustituyas** ningún cable.
- Si el canal tiene borna GND y el bus lleva un hilo común, únelos. Si no, déjala libre.
- **Sin resistencia de terminación** en la pasarela: el bus ya está terminado. Si el
  canal la tiene seleccionable, desactívala.
- Si un canal no da ninguna trama válida, prueba a **intercambiar A y B**: algunos
  fabricantes rotulan las bornas al revés.
- Usa par trenzado (si es apantallado, la malla a tierra en un solo extremo) y no lo
  lleves junto a los cables de potencia del inversor.

## 2. Configurar la pasarela

Igual en **cada** canal conectado a un bus del datalogger:

| Parámetro | Valor |
|---|---|
| Work Mode | TCP Server |
| Puerto | Uno distinto por canal (apúntalos) |
| Transfer Protocol / Modbus | **None** (transparente). No uses "Modbus TCP to RTU" |
| Baudios, bits, paridad, parada | Los del bus (suele ser 9600 8N1) |
| Pasarela Modbus, sondeo multi-host, heartbeat, paquete de registro | **Desactivados** |
| IP | Fija, de tu red |

Lo importante: la pasarela no debe mandar **nada** a esos buses. Cualquier trama extra
puede chocar con el datalogger y afectar a la limitación de vertido.

## 3. Opciones del complemento

### Medidor

| Opción | Por defecto | Qué es |
|---|---|---|
| `gateway_host` | (vacío) | **Obligatorio.** IP o nombre de la pasarela |
| `gateway_port` | 4196 | Puerto TCP del canal del medidor |
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

### Inversor (opcional)

| Opción | Por defecto | Qué es |
|---|---|---|
| `inverter_enabled` | false | Activa el canal del inversor. Desactivado, el complemento funciona igual que la 1.2.0 |
| `inverter_host` | (vacío) | Vacío = el mismo `gateway_host` (pasarela de varios canales) |
| `inverter_port` | 4197 | Puerto TCP del canal del bus del inversor. Distinto del del medidor |
| `inverter_address` | 1 | Dirección Modbus del inversor en su bus |
| `inverter_mppts` | 2 | Entradas MPPT a publicar (1–16). Míralo en la hoja de datos |
| `inverter_strings` | 0 | Strings a vigilar (0–32). 0 = sin sensores por string |
| `inverter_id_prefix` | growsnif_inversor | Prefijo de entidades del inversor. Distinto de `id_prefix` |
| `inverter_device_name` | GrowSnif inversor | Nombre del dispositivo en Home Assistant |

### Cómo sacar `ct_ratio`

El DTSU666 entrega intensidades, potencias y energías **del lado secundario**. GrowSnif
las multiplica por `ct_ratio`. Compruébalo con la pantalla del medidor: la corriente de
una fase en HA debe coincidir con la que ves en el display.

## 4. Sensores

### Medidor

24 magnitudes leídas del bus y 6 calculadas:

- Tensiones fase-neutro y entre fases, corrientes, potencia activa y reactiva (total y por
  fase), factor de potencia (total y por fase), frecuencia.
- Energía importada y exportada (kWh, `total_increasing`, válidas para el panel Energía).
- Calculadas: potencia importada, potencia exportada y potencia aparente (total y por fase).

Con un ShineMaster la potencia total llega varias veces por segundo y el resto
aproximadamente cada minuto.

### Inversor

Mapa de registros del protocolo Growatt *Modbus RTU Protocol II* (TL3-X / MAX).

| Grupo | Sensores |
|---|---|
| Producción | Potencia AC, potencia FV, potencia aparente y reactiva, factor de potencia, potencia sobre nominal |
| Energía | Hoy, total AC, total FV, reactiva total (`total_increasing`) |
| Salida AC | Tensión, corriente y potencia aparente por fase; tensiones entre fases; frecuencia |
| Estado | Estado (Espera, Normal, Fallo… o **Sin respuesta** de noche), motivo de limitación, **límite antivertido** que escribe el datalogger |
| Paneles | Por MPPT: tensión, corriente, potencia, energía hoy y total. Por string: tensión y corriente; strings desconectados, descompensados y con desequilibrio |
| Diagnóstico | Temperaturas, bus DC, aislamiento, corriente de fuga, inyección de continua, ventiladores, códigos de fallo y aviso, horas de funcionamiento, reactiva disponible |

Solo aparece lo que el datalogger pregunta. Con un ShineMaster, la potencia AC llega
cada ~3 s, el límite antivertido cada ~5 s y el resto cada ~1 min.

Detalles:

- **De noche** el inversor deja de contestar. Si el datalogger sigue preguntando,
  GrowSnif publica *Sin respuesta* y potencias a 0. Los contadores de energía conservan
  su último valor.
- Los **contadores totales** nunca se publican a 0 ni bajan: una lectura así se descarta
  (contador `totales_rechazados` del registro), para no falsear las estadísticas.
- Los avisos de string van por bits de *strings 1–16* y *17–32* del propio inversor:
  `inverter_strings` limita cuáles se tienen en cuenta.

## 5. Panel Energía

| Campo | Sensor |
|---|---|
| Consumo de la red | `sensor.<prefijo>_energia_importada` |
| Devolución a la red | `sensor.<prefijo>_energia_exportada` |
| Producción solar | `sensor.<prefijo_inversor>_energia_total` |

No cambies `ct_ratio` después de empezar a registrar energía: falsearía las estadísticas.
Si ya usas otro sensor de producción en el panel Energía, cambiarlo no borra nada, pero
la gráfica empezará a contar desde el nuevo sensor.

Hay paneles de ejemplo en `dashboards/`, y `tools/make_dashboard.py` crea uno con tus
prefijos y tu número de MPPT y strings.

## 6. Comprobar que funciona

En el registro del complemento verás cada minuto:

```
RX consultas=230 respuestas=230 huerfanas=0 bytes_descartados=0 excepciones=0 sensores=30
Inversor RX consultas=27 respuestas=27 escrituras=10 huerfanas=0 bytes_descartados=0 excepciones=0 sensores=51 totales_rechazados=0
```

- `consultas` y `respuestas` crecen a la par: todo bien.
- `consultas` crece y `respuestas` no: dirección incorrecta, o el inversor está apagado.
- Nada crece: revisa A/B, baudios, que el canal esté en modo transparente y que el puerto
  sea el de ese canal.
- Muchos `bytes_descartados`: ruido en el bus o parámetros serie distintos.

## 7. Actualizar sin perder nada

- Las opciones se conservan al actualizar. Las nuevas del inversor llegan **desactivadas**,
  así que el medidor sigue exactamente igual: mismas entidades, `unique_id`, temas MQTT e
  historial.
- El inversor es un **dispositivo nuevo** con su propio prefijo, su propia conexión MQTT y
  su propia disponibilidad. Si su canal falla, el medidor no se entera, y al revés.
- Si cambias de pasarela o de canal, cambia solo `gateway_host`/`gateway_port`: las
  entidades no cambian.
- Para conservar el historial de entidades antiguas con otro nombre, pon ese prefijo en
  `id_prefix` y la misma `meter_address`. Detén antes el complemento antiguo: dos copias
  a la vez se desconectan entre sí.

## 8. Seguridad

- Los sockets hacia la pasarela solo se leen. Las pruebas automáticas comprueban que no
  se envía ni un byte a ningún canal.
- Una pasarela en TCP Server transparente acepta tramas de **cualquiera** que se conecte a
  su puerto, y esas tramas llegan al bus. En el canal del inversor eso permitiría cambiar
  su configuración. Ponla en una red o VLAN restringida, bloquea sus puertos desde otras
  redes, protege su configuración con contraseña y no la expongas a Internet.
- No se guardan credenciales: MQTT las da el Supervisor en cada arranque.
- El contenedor no usa red del host, ni privilegios, ni la API de Home Assistant.
