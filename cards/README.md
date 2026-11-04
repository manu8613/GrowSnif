# GrowSnif · Centro de control

Creado por [manu8613](https://github.com/manu8613/GrowSnif).

> Con el complemento GrowSnif no hace falta nada de esto: activa `panel_install` y lo
> instala y actualiza solo. Esta guía es para usar la tarjeta sin el complemento.

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

Sin dependencias: un único archivo JavaScript, que trae también dos tarjetas más para
pestañas aparte:

- **`custom:growsnif-ahorro`**: lo que la solar te ahorra, **hora a hora** al precio del
  periodo de cada hora. Mes actual frente a lo pagado, ahorro por mes, desglose P1–P6,
  hoy, semana y ahorro en este momento en €/h.
- **`custom:growsnif-impacto`**: CO₂ evitado (total, este año, este mes), un bosque con
  los árboles equivalentes, kilómetros en coche, gasóleo, consumo de hogares y CO₂ por mes.

## Instalación

1. Copia [`growsnif/www/growsnif-panel.js`](../growsnif/www/growsnif-panel.js) a la carpeta `www` de tu configuración (por Samba:
   `config/www/`). Créala si no existe.
2. **Ajustes → Paneles → ⋮ → Recursos → Añadir recurso**:
   URL `/local/growsnif-panel.js?v=1.2.0`, tipo **Módulo JavaScript**.
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
| `strings_per_mppt` | 0 | Strings por MPPT; 0 los reparte solo |
| `thresholds` | — | Umbrales: `pf_min`, `v_min`, `v_max`, `f_min`, `f_max`, `unbalance_max`, `export_max`, `temp_warn`, `temp_crit`, `ipm_warn`, `ipm_crit`, `iso_min`, `leak_max`, `eff_min`, `string_low` |
| `entities` | {} | Sustituir una entidad: `meter.potencia_total: sensor.otra` o `inverter.potencia_ac: sensor.otra` |

Las entidades se buscan por el `unique_id` de GrowSnif, así que la tarjeta las encuentra
aunque las hayas renombrado (por ejemplo, tras migrar desde la nube de Growatt). Si tu
usuario no es administrador, se usan `sensor.<prefijo>_<clave>` o lo que indiques en
`entities`.

Las líneas sin señal se dibujan en gris y la salida **Resto** muestra el consumo que no
mide ninguna línea.

La fuente Barlow se carga de Google Fonts. Sin Internet se usa la fuente del sistema.

### Ahorro

```yaml
- type: custom:growsnif-ahorro
  meter_prefix: growsnif
  inverter_prefix: growsnif_inversor
  price_entities: [sensor.precio_p1, sensor.precio_p2, sensor.precio_p3,
                   sensor.precio_p4, sensor.precio_p5, sensor.precio_p6]
  cost_entity: sensor.coste_energia_acumulado
```

| Opción | Qué es |
|---|---|
| `price_entities` | Seis sensores con el precio de la energía de P1 a P6 (€/kWh o €/MWh) |
| `price_kwh` | Precio único si no tienes los seis |
| `price_now_entity` | Sensor del precio actual, para el ahorro en €/h |
| `cost_entity` | Coste acumulado de la energía (`total_increasing`), para comparar con lo pagado |
| `tax_factor` | Multiplicador de impuestos sobre el ahorro (1 = sin impuestos) |
| `months` | Meses de la gráfica (12) |

Ahorro de cada hora = (producción solar − vertido) × precio del periodo 6.1TD de esa
hora. No incluye término de potencia ni reactiva.

### Impacto

| Opción | Por defecto | Qué es |
|---|---|---|
| `co2_entity` | — | Intensidad de CO₂ de la red (g/kWh), p. ej. Electricity Maps. Se usa su media de cada hora |
| `co2_factor` | 150 | g/kWh cuando no hay `co2_entity` o le faltan horas |
| `tree_kg` | 22 | kg de CO₂ que absorbe un árbol en un año |
| `car_g_km` | 120 | g de CO₂ por km de un coche |
| `home_kwh` | 3500 | kWh de un hogar en un año |
| `diesel_kg_l` | 2,68 | kg de CO₂ por litro de gasóleo |
