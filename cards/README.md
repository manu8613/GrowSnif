# GrowSnif · Centro de control

Tarjeta de Home Assistant para ver toda la instalación en una sola pantalla:

- **Esquema unifilar** en directo: red, medidor, inversor, embarrado general y una salida
  por cada línea medida, con el sentido y la magnitud de la energía animados.
- **Red trifásica**: tensión, corriente, activa, reactiva y cos φ por fase, diagrama
  fasorial, frecuencia, desequilibrio y factor de potencia frente al umbral de 0,95.
- **Generación solar**: potencia frente a la nominal, rendimiento, estado, limitación,
  límite antivertido, reactiva, aislamiento y temperaturas.
- **Campo fotovoltaico**: potencia por MPPT y corriente de cada string, con los strings
  desconectados o con poca corriente marcados.
- **Alarmas y verificaciones** evaluadas en directo (tensión, frecuencia, cos φ, fases,
  vertido cero, inversor, strings, temperaturas, aislamiento, comunicación).
- **Balance** de hoy, la semana, el mes o el año, y **gráfica de 24 horas**.
- **Periodo tarifario 6.1TD** (península) calculado con la hora, el día y la temporada.

Sin dependencias: un único archivo JavaScript.

## Instalación

1. Copia `growsnif-panel.js` a la carpeta `www` de tu configuración (por Samba:
   `config/www/`). Créala si no existe.
2. **Ajustes → Paneles → ⋮ → Recursos → Añadir recurso**:
   URL `/local/growsnif-panel.js?v=1.0.0`, tipo **Módulo JavaScript**.
3. **Ajustes → Paneles → Añadir panel → Nuevo panel desde cero**. Ábrelo,
   **⋮ → Editar → ⋮ → Editor de configuración en bruto** y pega:

```yaml
views:
  - title: Control
    path: control
    type: panel
    cards:
      - type: custom:growsnif-panel
        meter_prefix: growsnif
        inverter_prefix: growsnif_inversor
        nominal_power: 100000
        mppts: 2
        strings: 4
```

Al actualizar el archivo, sube el número de `?v=` del recurso para que el navegador no use
la versión en caché.

## Opciones

| Opción | Por defecto | Qué es |
|---|---|---|
| `meter_prefix` | — | `id_prefix` del medidor en GrowSnif |
| `inverter_prefix` | — | `inverter_id_prefix` del inversor en GrowSnif |
| `title`, `subtitle` | Centro de control energético | Textos de la cabecera |
| `nominal_power` | 100000 | Potencia nominal del inversor, en W |
| `mppts`, `strings` | 2, 0 | MPPT y strings que se dibujan en el campo |
| `zero_export` | true | Avisa si se vierte a la red con vertido cero |
| `grid_max` | `nominal_power` | Potencia de red de referencia para la animación, en W |
| `price_kwh` | — | Precio medio del kWh para estimar el ahorro (sin él, no se muestra) |
| `co2_factor` | 150 | g de CO₂ por kWh de la red, para el CO₂ evitado |
| `co2_entity` | — | Sensor de intensidad de CO₂ (g/kWh); sustituye a `co2_factor` |
| `lines` | [] | Líneas medidas: `name`, `code`, `power` (W o kW) y `max` opcional |
| `entities` | {} | Sustituir una entidad: `meter.potencia_total: sensor.otra` o `inverter.potencia_ac: sensor.otra` |

Las entidades se buscan por el `unique_id` de GrowSnif, así que la tarjeta las encuentra
aunque las hayas renombrado (por ejemplo, tras migrar desde la nube de Growatt). Si tu
usuario no es administrador, se usan `sensor.<prefijo>_<clave>` o lo que indiques en
`entities`.

Las líneas sin señal se dibujan en gris y la salida **Resto** muestra el consumo que no
mide ninguna línea.

La fuente Barlow se carga de Google Fonts. Sin Internet se usa la fuente del sistema.
