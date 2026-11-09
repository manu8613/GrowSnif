# CLAUDE.md — GrowSnif

## Qué es
Complemento de Home Assistant OS (`growsnif/`, Python + Docker) que escucha de forma pasiva los buses RS485 de Growatt (CHINT DTSU666 e inversor) a través de una pasarela RS485→TCP transparente y publica por MQTT Discovery. **Nunca escribe en el bus.**

## Por dónde empezar
1. `growsnif/CHANGELOG.md` (versión arriba) y `docs/STATUS.md` si existe.
2. Solo el módulo afectado: `protocol.py` (tramas Modbus), `growatt.py`/`inverter.py` (registros), `main.py` (bucle y MQTT), `panel.py` + `www/growsnif-panel.js` (panel, ~1.600 líneas: busca, no leas entero).
3. Herramientas en `tools/` (captura, migración desde la nube de Growatt).

## Reglas
- Público y **anónimo**: nada de IPs, entidades ni datos de la instalación real. Las capturas reales no se suben (`captures/` está en .gitignore); para pruebas, `tools/make_synthetic_capture.py`.
- Versión en `growsnif/config.yaml` + CHANGELOG; el workflow publica etiqueta y release.
- Pruebas: `pytest -q`.
- Cambios en rama `tipo/descripcion` (no `version-x-y-z`) y por PR. Borrar la rama al fusionar.
- Al terminar: bloque CIERRE.
