# Changelog

## 1.3.0

- **Inversor Growatt** (opcional, desactivado por defecto): escucha pasiva del bus
  datalogger ↔ inversor por un segundo canal de la pasarela. Dispositivo propio con
  producción, energía, salida AC, reactiva, estado, motivo de limitación, límite
  antivertido que escribe el datalogger, temperaturas, aislamiento, fugas y, por cada
  MPPT y string, tensión, corriente y energía, con aviso de strings desconectados.
- Decodificador Modbus genérico (FC03/04 y escrituras FC06/16) para ese bus.
- De noche, si el inversor no contesta: estado *Sin respuesta* y potencias a 0.
- Los contadores totales del inversor nunca se publican a 0 ni bajan.
- Conexión MQTT y disponibilidad propias del inversor: un fallo en un canal no afecta
  al otro.
- **El medidor no cambia**: mismas opciones, entidades, `unique_id`, temas MQTT y
  `client_id`. Comprobado contra la 1.2.0.
- Documentación del conexionado con pasarelas de varios canales.
- `tools/make_dashboard.py` y panel de ejemplo del inversor.

## 1.2.0

- Primera versión pública como **GrowSnif**.
- Todo configurable desde las opciones: pasarela, dirección Modbus del medidor,
  relaciones CT y PT, prefijo de entidades, nombre del dispositivo, prefijo de
  Discovery y nivel de log. Sin valores de ninguna instalación concreta.
- Decodificador genérico: acepta cualquier lectura FC03 al esclavo configurado y
  extrae los registros conocidos del DTSU666 que contenga.
- Contador de respuestas huérfanas en el registro.
- Herramienta de captura de solo lectura (`tools/capture.py`) y captura sintética
  para las pruebas.

## 1.1.0

- Credenciales MQTT automáticas del Supervisor (`services: mqtt:need`).
- Potencia aparente total y por fase.
- Factor de potencia con `device_class: power_factor`.

## 1.0.0

- Escucha pasiva del DTSU666, 24 magnitudes, potencia importada/exportada y
  MQTT Discovery.
