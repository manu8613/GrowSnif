# GrowSnif

Creado por [manu8613](https://github.com/manu8613/GrowSnif).

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

## 8. Dejar la nube de Growatt sin perder el historial

Si ya tenías la integración **Growatt** (nube), `tools/migrar_nube_growatt.py` hace que
las entidades locales del inversor **hereden los `entity_id`** de las de la nube. Home
Assistant guarda historial y estadísticas por `entity_id`, así que la misma serie sigue
sin cortes (panel Energía incluido) y tus paneles y automatizaciones siguen funcionando,
ahora con datos locales.

1. Activa el inversor en GrowSnif y espera a que tenga datos.
2. Crea un token de larga duración de un usuario administrador
   (**Perfil → Seguridad → Tokens de acceso de larga duración**).
3. Desde cualquier PC con Python 3 (Windows incluido), sin instalar nada más:

   ```
   python migrar_nube_growatt.py --url http://IP_DE_HA:8123
   ```

   Es una **simulación**: muestra qué entidad hereda cada una y compara los contadores
   de energía. No cambia nada.
4. Si todo cuadra, haz una copia de seguridad de Home Assistant y repite con `--aplicar`.

Al aplicar, el script:

1. guarda en un `.json` el plan, las entidades y los paneles tal como estaban;
2. **desactiva** la integración Growatt (no la borra: puedes volver a activarla);
3. quita sus entidades del registro para liberar sus `entity_id`;
4. renombra cada entidad local al `entity_id` de la nube que hereda;
5. en los paneles, cambia las referencias a las entidades locales renombradas, y las de
   la nube que no continúan por la que sí continúa (p. ej. la potencia del inversor por
   la de la planta).

Comprobaciones:

- **No migra si los contadores de energía no coinciden** (por defecto, más de 10 kWh de
  diferencia, `--tolerancia`). Una diferencia contaría como producción de golpe en el
  panel Energía. Compara la *Energía total* (salida AC) del inversor, no la *Energía FV
  total* (entrada de continua), que es mayor por las pérdidas del inversor.
- Si hay entidades de la planta y del inversor con la misma magnitud, hereda la que está
  en el panel Energía (o la de la planta).
- Las entidades de la nube sin equivalente local (dinero, potencia máxima…) **conservan su
  historial** en la base de datos, pero dejan de actualizarse. El script avisa si las usa
  algún panel o automatización. No borres sus estadísticas "ya no proporcionadas".
- Si alguna unidad no coincide, esa pareja no se toca.

Después, revisa el panel Energía al día siguiente. Si en la hora del cambio ves un
escalón, corrígelo en **Herramientas para desarrolladores → Estadísticas → Ajustar una suma**.

## 9. Panel Centro de control

Activa `panel_install` y GrowSnif crea en la barra lateral el panel **Centro de control**,
con tres pestañas:

- **Control**: esquema unifilar con las líneas, red trifásica con diagrama fasorial,
  generación, campo FV por MPPT y string, alarmas, balance y gráfica de 24 h, 7 o 30 días.
- **Ahorro**: lo que la solar te evita pagar, hora a hora al precio de cada periodo.
- **Impacto**: CO₂ evitado, árboles equivalentes y otras comparaciones.

Es interactivo. Pulsa una línea, una fase, un MPPT, un string, la red o el inversor y se
abre su ficha con el historial (24 h, 7 o 30 días), máximo, media y mínimo, y los datos
relacionados. Pulsa cualquier valor y se abre el diálogo de Home Assistant de esa entidad.
En las alarmas, *Entendido* las oculta 24 horas en ese navegador.

Al arrancar, GrowSnif copia la tarjeta a `/config/www/growsnif/`, la registra como recurso
con la versión del complemento en la dirección (así el navegador carga la tarjeta nueva
tras cada actualización) y crea el panel con tus opciones. Si la tarjeta ya estaba
instalada a mano, cambia ese recurso por el gestionado.

| Opción | Por defecto | Qué es |
|---|---|---|
| `panel_install` | false | Instala el panel |
| `panel_mode` | una_vez | `una_vez`: lo crea una vez y respeta lo que cambies después. `gestionado`: estas opciones mandan y el panel se reescribe cuando cambian, con copia del anterior |
| `panel_url`, `panel_sidebar_title`, `panel_icon` | growsnif-control, Energía, mdi:transmission-tower | Dirección, nombre e icono en la barra lateral |
| `panel_title`, `panel_subtitle` | Centro de control energético | Cabecera |
| `panel_nominal_power` | 10000 | Potencia nominal del inversor, en W |
| `panel_strings_per_mppt` | 0 | Strings por MPPT; 0 los reparte solo. MPPT y strings salen de `inverter_mppts` e `inverter_strings` |
| `panel_lines` | [] | Líneas medidas: `name`, `power` y, si quieres, `code`, `energy`, `current` y `max` |
| `panel_savings`, `panel_impact` | true | Pestañas Ahorro e Impacto (necesitan el inversor) |
| `panel_price_entities` | [] | Seis entidades con el precio de la energía de P1 a P6 |
| `panel_price_kwh` | 0 | Precio único si no tienes los seis |
| `panel_price_now_entity`, `panel_cost_entity` | (vacío) | Precio actual y coste acumulado de la energía |
| `panel_tax_factor` | 1 | Multiplicador de impuestos sobre el ahorro |
| `panel_co2_entity`, `panel_co2_factor` | (vacío), 150 | Intensidad de CO₂ de la red en g/kWh |
| `panel_pf_min`, `panel_voltage_min/max`, `panel_unbalance_max`, `panel_temp_warn`, `panel_export_alarm` | 0,95, 207/253, 25, 65, 1000 | Umbrales de las alarmas |

Ejemplo de líneas:

```yaml
panel_lines:
  - name: Oficinas planta 1
    code: L01
    power: sensor.oficinas_p1_potencia
    energy: sensor.oficinas_p1_energia
  - name: Compresores
    power: sensor.compresores_potencia
    max: 30000
```

El instalador no toca los buses RS485 y, si falla (por ejemplo, mientras Home Assistant
arranca), lo reintenta y solo lo anota en el registro: la escucha sigue igual.

La tarjeta también se puede usar sin el complemento: `growsnif/www/growsnif-panel.js` y
[cards/README.md](https://github.com/manu8613/GrowSnif/blob/main/cards/README.md).

## 10. Versiones y volver atrás

Cada versión queda guardada en GitHub con su etiqueta (`v1.4.0`), su publicación con los
cambios en **Releases** y una rama congelada (`version-1-4-0`).

- **Volver a la versión anterior**: al actualizar, deja marcada *Crear copia de seguridad*.
  Si la nueva no te vale, restaura esa copia en **Ajustes → Sistema → Copias de seguridad**:
  vuelve el complemento con su versión y sus opciones.
- **Instalar una versión concreta**: añade como repositorio
  `https://github.com/manu8613/GrowSnif#version-1-3-0` (cambia el número). Aparece como otro
  GrowSnif: instálalo, copia tus opciones y detén el que tenías. No tengas los dos en marcha.
  Esa copia no recibe actualizaciones.
- **El panel**: en modo `gestionado`, antes de reescribirlo se guarda el anterior en
  `/config/growsnif/backups/`. Para recuperarlo, abre el panel, **⋮ → Editar → ⋮ →
  Editor de configuración en bruto** y pega el contenido del archivo.
- Las entidades no cambian entre versiones, así que volver atrás no pierde historial.

## 11. Seguridad

- Los sockets hacia la pasarela solo se leen. Las pruebas automáticas comprueban que no
  se envía ni un byte a ningún canal.
- Una pasarela en TCP Server transparente acepta tramas de **cualquiera** que se conecte a
  su puerto, y esas tramas llegan al bus. En el canal del inversor eso permitiría cambiar
  su configuración. Ponla en una red o VLAN restringida, bloquea sus puertos desde otras
  redes, protege su configuración con contraseña y no la expongas a Internet.
- No se guardan credenciales: MQTT las da el Supervisor en cada arranque.
- El contenedor no usa red del host ni privilegios.
- Los permisos de configuración (`/config`) y de la API de Home Assistant son solo para el
  panel. Con `panel_install` desactivado no se usan. Activado, GrowSnif solo escribe en
  `/config/www/growsnif/` y `/config/growsnif/`, y solo usa la API para el recurso y el panel.

## 12. Autoría y licencia

GrowSnif está creado por **manu8613** y publicado con licencia MIT. Si lo clonas, haces un
fork o lo usas como base, mantén los archivos `LICENSE` y `NOTICE` y menciona a manu8613
como autor original.
