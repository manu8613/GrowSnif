# Changelog

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
