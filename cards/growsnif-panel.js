/*
 * GrowSnif · Centro de control energético
 * Tarjeta para Home Assistant (vista de panel). Sin dependencias.
 *
 *   type: custom:growsnif-panel
 *   meter_prefix: growsnif              # prefijo del medidor en GrowSnif
 *   inverter_prefix: growsnif_inversor  # prefijo del inversor en GrowSnif
 *
 * Las entidades se encuentran por su unique_id de GrowSnif, así que siguen
 * funcionando aunque las hayas renombrado. Opciones completas en cards/README.md.
 */
const GSP_VERSION = '1.0.0';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600&family=Barlow:wght@400;500;600&display=swap';

const NS = 'http://www.w3.org/2000/svg';
const PERIOD_COLORS = { 1: '#ff5d6c', 2: '#ff8a5b', 3: '#ffb547', 4: '#d9d36a', 5: '#8fdc8a', 6: '#4ef0b0' };
const PHASE_COLORS = ['#5fd4ff', '#b79cff', '#ff9f6e'];
const HOLIDAYS = ['1-1', '1-6', '5-1', '8-15', '10-12', '11-1', '12-6', '12-8', '12-25'];

const nf = (v, d = 1) => (v == null || !isFinite(v)) ? '—'
  : v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const kw = (w, d = 1) => w == null ? '—' : nf(w / 1000, d);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function period61(d) {
  const m = d.getMonth() + 1, h = d.getHours(), wd = d.getDay();
  if (wd === 0 || wd === 6 || HOLIDAYS.includes(m + '-' + d.getDate()) || h < 8) return 6;
  const base = [1, 2, 7, 12].includes(m) ? 1 : [3, 11].includes(m) ? 2 : [6, 8, 9].includes(m) ? 3 : 4;
  return (h >= 9 && h < 14) || (h >= 18 && h < 22) ? base : base + 1;
}
function seasonName(d) {
  const m = d.getMonth() + 1;
  return [1, 2, 7, 12].includes(m) ? 'Temporada alta' : [3, 11].includes(m) ? 'Temporada media-alta'
    : [6, 8, 9].includes(m) ? 'Temporada media' : 'Temporada baja';
}
function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arc(cx, cy, r, a0, a1) {
  if (a1 - a0 < 0.01) a1 = a0 + 0.01;
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const CSS = `
:host{display:block;
 --ink:#0c1b2b;--panel:#12263b;--panel2:#0f2134;--rule:#1f3a57;--rule2:#2c4f74;
 --txt:#e3edf7;--dim:#8aa1b9;--mute:#4d6682;
 --sol:#ffb547;--imp:#ff5d6c;--exp:#4ef0b0;--bus:#5fd4ff;--q:#b79cff;
 --ok:#4ef0b0;--warn:#ffb547;--crit:#ff5d6c;
 font-family:Barlow,"Segoe UI",system-ui,sans-serif;color:var(--txt)}
*{box-sizing:border-box}
.root{background:var(--ink);min-height:calc(100vh - var(--header-height,56px));padding:20px 24px 28px;
 background-image:linear-gradient(rgba(95,212,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(95,212,255,.035) 1px,transparent 1px);
 background-size:32px 32px}
.cond,.num{font-family:"Barlow Condensed",Barlow,sans-serif;font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
header{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.4fr) auto;gap:24px;align-items:end;
 padding-bottom:16px;margin-bottom:18px;border-bottom:1px solid var(--rule)}
h1{font-family:"Barlow Condensed",sans-serif;font-weight:600;font-size:34px;line-height:1;margin:0;letter-spacing:.01em}
.sub{color:var(--dim);font-size:15px;margin-top:6px}
.tariff{display:flex;gap:16px;align-items:center}
.pbig{font-family:"Barlow Condensed",sans-serif;font-weight:600;font-size:40px;line-height:.9;padding:4px 12px 6px;border-radius:6px;color:#0c1b2b}
.tinfo{min-width:0;flex:1}
.tinfo b{font-weight:600;font-size:15px}.tinfo span{color:var(--dim);font-size:13px;display:block}
.ribbon{display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-top:6px;position:relative}
.ribbon i{height:8px;border-radius:1px;opacity:.55}.ribbon i.now{opacity:1;outline:2px solid var(--txt);outline-offset:1px}
.sys{text-align:right}
.status{display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:15px;padding:6px 12px;border-radius:20px;border:1px solid var(--rule2)}
.status i{width:9px;height:9px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(78,240,176,.18)}
.status.warn i{background:var(--warn);box-shadow:0 0 0 3px rgba(255,181,71,.18)}
.status.crit i{background:var(--crit);box-shadow:0 0 0 3px rgba(255,93,108,.2)}
.clock{font-size:30px;font-weight:500;margin-top:6px;line-height:1}
.date{color:var(--dim);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px}
.panel{background:var(--panel);border:1px solid var(--rule);border-radius:6px;padding:16px 18px;min-width:0}
.panel h2{font-size:17px;font-weight:600;margin:0 0 2px}
.panel .hint{color:var(--dim);font-size:13px;margin:0 0 12px}
.s12{grid-column:span 12}.s7{grid-column:span 7}.s6{grid-column:span 6}.s5{grid-column:span 5}
.hero{padding:14px 10px 6px;background:var(--panel2)}
.uni{overflow-x:auto}.uni svg{min-width:860px}
.hero-head{display:flex;justify-content:space-between;align-items:baseline;padding:0 10px;gap:16px;flex-wrap:wrap}
.legend{display:flex;gap:16px;color:var(--dim);font-size:13px;flex-wrap:wrap}
.legend i{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
svg{display:block;width:100%;height:auto;overflow:visible}
svg text{font-family:"Barlow Condensed",Barlow,sans-serif;font-variant-numeric:tabular-nums}
.wire{fill:none;stroke:var(--rule2);stroke-width:3;stroke-linecap:round}
.flow{fill:none;stroke-width:3;stroke-linecap:round;stroke-dasharray:3 15;animation:run var(--d,2s) linear infinite}
.flow.rev{animation-direction:reverse}.flow.off{opacity:0}
@keyframes run{to{stroke-dashoffset:-36}}
.sym{fill:var(--panel2);stroke:var(--dim);stroke-width:2}
.lbl{fill:var(--dim);font-size:14px}.val{fill:var(--txt);font-size:24px;font-weight:600}
.big{fill:var(--txt);font-size:56px;font-weight:600}
.unit{fill:var(--dim);font-size:16px}
.fbar{transition:height .8s ease,y .8s ease}
.fcode{fill:var(--dim);font-size:12px}.fval{fill:var(--txt);font-size:13px}
.ghost{fill:none;stroke:var(--mute);stroke-dasharray:3 3}
.phase{display:grid;grid-template-columns:44px repeat(5,minmax(0,1fr));gap:4px 10px;align-items:center;font-size:14px}
.phase .h{color:var(--dim);font-size:12.5px}
.phase .n{font-size:20px;font-weight:500}
.ph{font-weight:600;font-size:16px}
.bar{height:4px;background:var(--rule);border-radius:2px;overflow:hidden;margin-top:3px}
.bar i{display:block;height:100%;border-radius:2px;transition:width .8s ease}
.row2{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:18px;align-items:center}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid var(--rule)}
.fact span{display:block;color:var(--dim);font-size:12.5px}.fact b{font-size:22px;font-weight:500}
.fact small{color:var(--dim);font-size:13px;margin-left:3px}
.cosbar{position:relative;height:6px;background:linear-gradient(90deg,var(--crit) 0 50%,var(--warn) 50% 75%,var(--ok) 75%);border-radius:3px;margin-top:8px;opacity:.85}
.cosbar em{position:absolute;top:-4px;width:3px;height:14px;background:var(--txt);border-radius:2px;transform:translateX(-50%);transition:left .8s ease}
.gen{display:grid;grid-template-columns:240px minmax(0,1fr);gap:18px;align-items:center}
.kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px}
.kv div span{display:block;color:var(--dim);font-size:12.5px}.kv div b{font-size:19px;font-weight:500}
.temps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px;padding-top:14px;border-top:1px solid var(--rule)}
.temps span{color:var(--dim);font-size:12.5px}.temps b{font-size:19px;font-weight:500;display:block}
.field{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:10px}
.mppt{background:var(--panel2);border:1px solid var(--rule);border-radius:5px;padding:8px 8px 10px;text-align:center}
.mppt .t{color:var(--dim);font-size:12.5px}
.mppt .tube{height:84px;width:22px;margin:6px auto;border:1px solid var(--rule2);border-radius:3px;position:relative;overflow:hidden}
.mppt .tube i{position:absolute;bottom:0;left:0;right:0;background:var(--sol);transition:height .8s ease}
.mppt .p{font-size:18px;font-weight:500}.mppt .va{color:var(--dim);font-size:12.5px}
.str{display:flex;gap:4px;justify-content:center;margin-top:8px}
.str b{flex:1;min-width:0;font-weight:500;font-size:12px;border-radius:3px;padding:3px 0;background:rgba(255,181,71,.12);color:var(--sol);border:1px solid rgba(255,181,71,.35)}
.str b.dead{background:transparent;color:var(--crit);border:1px dashed var(--crit)}
.str b.low{color:var(--warn);background:rgba(255,181,71,.06);border-style:dashed}
.str b.idle{color:var(--mute);background:transparent;border-color:var(--rule2)}
.checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-bottom:14px}
.chk{display:flex;align-items:center;gap:8px;font-size:14px;padding:6px 8px;border-radius:4px;background:var(--panel2)}
.chk i{width:8px;height:8px;border-radius:50%;flex:none;background:var(--ok)}
.chk.warn i{background:var(--warn)}.chk.crit i{background:var(--crit)}.chk.na i{background:var(--mute)}
.chk.na{color:var(--dim)}
.alarms{display:flex;flex-direction:column;gap:8px}
.al{border-left:3px solid var(--ok);padding:6px 10px;background:var(--panel2);border-radius:0 4px 4px 0}
.al.warn{border-color:var(--warn)}.al.crit{border-color:var(--crit)}.al.info{border-color:var(--bus)}
.al b{font-weight:600;font-size:15px;display:block}.al span{color:var(--dim);font-size:13.5px}
.empty{color:var(--dim);font-size:14px}
.tabs{display:inline-flex;border:1px solid var(--rule2);border-radius:6px;overflow:hidden;margin-bottom:14px}
.tabs button{font:inherit;font-size:14px;color:var(--dim);background:none;border:0;padding:6px 14px;cursor:pointer}
.tabs button[aria-pressed=true]{background:var(--rule2);color:var(--txt)}
.tabs button:focus-visible{outline:2px solid var(--bus);outline-offset:-2px}
.bal{display:grid;grid-template-columns:150px minmax(0,1fr);gap:18px;align-items:center}
.ledger{display:grid;gap:9px}
.ledger div{display:flex;justify-content:space-between;align-items:baseline;gap:10px;border-bottom:1px solid var(--rule);padding-bottom:6px;font-size:14px}
.ledger div span{color:var(--dim)}.ledger div b{font-size:20px;font-weight:500}
.ledger div b small{font-size:13px;color:var(--dim);margin-left:3px;font-weight:400}
.chart{position:relative}
.tip{position:absolute;pointer-events:none;background:#0a1726;border:1px solid var(--rule2);border-radius:5px;padding:6px 9px;font-size:13px;white-space:nowrap;opacity:0;transition:opacity .15s}
.tip b{font-weight:600}
footer{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;color:var(--mute);font-size:12.5px;margin-top:16px}
@media (max-width:1180px){.s7,.s6,.s5{grid-column:span 12}}
@media (max-width:720px){
 .root{padding:14px 12px}
 header{grid-template-columns:1fr;gap:14px}.sys{text-align:left}
 .row2,.gen,.bal{grid-template-columns:1fr}
 .row2 svg,.gen svg{max-width:240px;margin:0 auto}.bal svg{max-width:150px;margin:0 auto}
 .phase{grid-template-columns:34px repeat(5,minmax(0,1fr));gap:4px 6px}.phase .n{font-size:16px}
 h1{font-size:28px}}
@media (prefers-reduced-motion:reduce){.flow{animation:none;stroke-dasharray:none;opacity:.7}.fbar,.bar i,.mppt .tube i,.cosbar em{transition:none}}
`;

class GrowSnifPanel extends HTMLElement {
  static getStubConfig() {
    return { meter_prefix: 'growsnif', inverter_prefix: 'growsnif_inversor', nominal_power: 100000, mppts: 2, strings: 0 };
  }

  setConfig(config) {
    if (!config || (!config.meter_prefix && !config.inverter_prefix)) {
      throw new Error('Pon al menos meter_prefix o inverter_prefix');
    }
    this._config = Object.assign({
      title: 'Centro de control energético', subtitle: '', nominal_power: 100000, mppts: 2, strings: 0,
      zero_export: true, price_kwh: null, co2_factor: 150, co2_entity: null, lines: [], entities: {},
      grid_max: null,
    }, config);
    this._built = false;
    if (this._hass) this._build();
  }

  set hass(h) {
    this._hass = h;
    if (!this._config) return;
    if (!this._built) this._build();
    if (!this._regTried) { this._regTried = true; this._loadRegistry(); }
    const now = performance.now();
    if (!this._last || now - this._last > 900) { this._last = now; this._update(); }
    else if (!this._pending) {
      this._pending = setTimeout(() => { this._pending = null; this._last = performance.now(); this._update(); }, 950);
    }
  }

  getCardSize() { return 40; }
  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  connectedCallback() {
    if (!document.querySelector('link[data-gsp-font]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = FONT_HREF; l.dataset.gspFont = '1';
      document.head.appendChild(l);
    }
    this._clock = setInterval(() => this._tick(), 1000);
    this._stats = setInterval(() => this._refreshStats(), 5 * 60 * 1000);
    if (this._built) { this._tick(); this._refreshStats(); }
  }

  disconnectedCallback() {
    clearInterval(this._clock); clearInterval(this._stats); clearTimeout(this._pending);
    this._pending = null;
  }

  // ------------------------------------------------------------------ entities

  async _loadRegistry() {
    try {
      const list = await this._hass.callWS({ type: 'config/entity_registry/list' });
      const map = {};
      for (const e of list) if (e.platform === 'mqtt' && e.unique_id) map[e.unique_id] = e.entity_id;
      this._uid = map;
    } catch (e) { this._uid = {}; }
    this._update();
    this._refreshStats();
  }

  _id(dev, key) {
    const c = this._config;
    const ov = c.entities[(dev === 'm' ? 'meter.' : 'inverter.') + key];
    if (ov) return ov;
    const p = dev === 'm' ? c.meter_prefix : c.inverter_prefix;
    if (!p) return null;
    return (this._uid && this._uid[p + '_' + key]) || `sensor.${p}_${key}`;
  }

  _st(eid) { return eid && this._hass ? this._hass.states[eid] : undefined; }

  _num(dev, key) {
    const s = this._st(this._id(dev, key));
    if (!s) return null;
    const v = parseFloat(s.state);
    return isFinite(v) ? v : null;
  }

  _str(dev, key) {
    const s = this._st(this._id(dev, key));
    return s && !['unavailable', 'unknown'].includes(s.state) ? s.state : null;
  }

  _age(dev, key) {
    const s = this._st(this._id(dev, key));
    return s ? (Date.now() - new Date(s.last_updated).getTime()) / 1000 : null;
  }

  _lineNum(eid) {
    const s = this._st(eid);
    if (!s) return null;
    const v = parseFloat(s.state);
    if (!isFinite(v)) return null;
    const u = (s.attributes || {}).unit_of_measurement;
    return u === 'kW' ? v * 1000 : v;
  }

  // ------------------------------------------------------------------ build

  _build() {
    this._built = true;
    const c = this._config;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const mppts = clamp(+c.mppts || 0, 0, 16), strings = clamp(+c.strings || 0, 0, 32);
    const per = mppts ? Math.max(1, Math.ceil(strings / mppts)) : 0;
    let field = '';
    for (let n = 1; n <= mppts; n++) {
      let s = '';
      for (let k = (n - 1) * per + 1; k <= Math.min(strings, n * per); k++) {
        s += `<b data-id="s${k}" title="String ${k}">${k}</b>`;
      }
      field += `<div class="mppt"><div class="t">MPPT ${n}</div><div class="tube"><i data-id="m${n}t" style="height:0"></i></div>
        <div class="p num" data-id="m${n}p">—</div><div class="va num" data-id="m${n}v">—</div><div class="va num" data-id="m${n}a">—</div>${s ? `<div class="str">${s}</div>` : ''}</div>`;
    }
    const tabs = [['day', 'Hoy'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']];
    this._period = this._period || 'day';
    this.shadowRoot.innerHTML = `<style>${CSS}</style>
<div class="root">
 <header>
  <div><h1>${esc(c.title)}</h1><div class="sub">${esc(c.subtitle || 'Red, generación solar y líneas en tiempo real')}</div></div>
  <div class="tariff"><div class="pbig" data-id="pbig">P–</div>
   <div class="tinfo"><b data-id="pname">Periodo tarifario 6.1TD</b><span data-id="pseason"></span><div class="ribbon" data-id="ribbon"></div></div></div>
  <div class="sys"><div class="status" data-id="status"><i></i><span data-id="statustxt">Comprobando…</span></div>
   <div class="clock num" data-id="clock">--:--:--</div><div class="date" data-id="date"></div></div>
 </header>
 <div class="grid">
  <section class="panel hero s12" aria-label="Esquema unifilar">
   <div class="hero-head"><div><h2>Esquema unifilar</h2><p class="hint">El trazo animado indica el sentido de la energía; su velocidad, la potencia.</p></div>
    <div class="legend"><span><i style="background:var(--imp)"></i>Importación</span><span><i style="background:var(--exp)"></i>Vertido</span>
     <span><i style="background:var(--sol)"></i>Solar</span><span><i style="background:var(--bus)"></i>Consumo</span></div></div>
   ${this._unifilar()}
  </section>
  <section class="panel s6"><h2>Red trifásica</h2><p class="hint" data-id="redhint">Medidor de acometida</p>
   <div class="row2"><div class="phase">
     <span></span><span class="h">Tensión</span><span class="h">Corriente</span><span class="h">Activa</span><span class="h">Reactiva</span><span class="h">cos φ</span>
     ${[1, 2, 3].map((p) => `<span class="ph" style="color:${PHASE_COLORS[p - 1]}">L${p}</span>
      <span><span class="n num" data-id="u${p}">—</span> <small>V</small></span>
      <span><span class="n num" data-id="i${p}">—</span> <small>A</small><div class="bar"><i data-id="ib${p}" style="background:${PHASE_COLORS[p - 1]};width:0"></i></div></span>
      <span><span class="n num" data-id="p${p}">—</span> <small>kW</small></span>
      <span><span class="n num" data-id="q${p}">—</span> <small>kvar</small></span>
      <span class="n num" data-id="f${p}">—</span>`).join('')}
    </div>${this._phasorSvg()}</div>
   <div class="facts">
    <div class="fact"><span>Frecuencia</span><b class="num" data-id="freq">—</b><small>Hz</small></div>
    <div class="fact"><span>Desequilibrio de corriente</span><b class="num" data-id="unb">—</b><small>%</small></div>
    <div class="fact"><span>Tensiones compuestas</span><b class="num" data-id="ull">—</b><small>V</small></div>
    <div class="fact"><span>Reactiva total</span><b class="num" data-id="qt">—</b><small>kvar</small></div>
    <div class="fact" style="grid-column:span 2"><span>Factor de potencia total, penaliza por debajo de 0,95</span>
     <b class="num" data-id="fpt">—</b><div class="cosbar"><em data-id="fpm" style="left:0"></em></div></div>
   </div>
  </section>
  <section class="panel s6"><h2>Generación solar</h2><p class="hint" data-id="genhint">Inversor</p>
   <div class="gen">${this._gaugeSvg()}
    <div class="kv">
     <div><span>Potencia de los paneles</span><b class="num" data-id="pfv">—</b> <small>kW</small></div>
     <div><span>Rendimiento del inversor</span><b class="num" data-id="eff">—</b> <small>%</small></div>
     <div><span>Estado</span><b data-id="state">—</b></div>
     <div><span>Limitación</span><b data-id="derate">—</b></div>
     <div><span>Límite antivertido</span><b class="num" data-id="lim">—</b> <small>%</small></div>
     <div><span>Energía hoy</span><b class="num" data-id="eday">—</b> <small>kWh</small></div>
     <div><span>Reactiva entregada</span><b class="num" data-id="iq">—</b> <small data-id="iqmax">kvar</small></div>
     <div><span>Aislamiento de los paneles</span><b class="num" data-id="iso">—</b> <small>kΩ</small></div>
    </div></div>
   <div class="temps">
    ${[['ti', 'Inversor', 80], ['tipm', 'Módulo de potencia', 90], ['tb', 'Boost', 90]].map(([id, n]) =>
      `<div><span>${n}</span><b class="num" data-id="${id}">—</b><div class="bar"><i data-id="${id}b" style="width:0"></i></div></div>`).join('')}
   </div>
  </section>
  <section class="panel s7"><h2>Campo fotovoltaico</h2><p class="hint" data-id="fieldhint">Potencia por MPPT y corriente de cada string</p>
   ${mppts ? `<div class="field">${field}</div>` : '<p class="empty">Configura <code>mppts</code> y <code>strings</code> para ver el campo.</p>'}
  </section>
  <section class="panel s5"><h2>Alarmas y verificaciones</h2><p class="hint">Reglas evaluadas sobre los datos en directo</p>
   <div class="checks" data-id="checks"></div><div class="alarms" data-id="alarms"></div>
  </section>
  <section class="panel s5"><h2>Balance energético</h2>
   <div class="tabs" role="group" aria-label="Periodo">${tabs.map(([k, n]) =>
     `<button data-tab="${k}" aria-pressed="${k === this._period}">${n}</button>`).join('')}</div>
   <div class="bal">${this._ringSvg()}<div class="ledger">
    <div><span>Producción solar</span><b class="num" data-id="b_sol">—<small>kWh</small></b></div>
    <div><span>Consumo del edificio</span><b class="num" data-id="b_load">—<small>kWh</small></b></div>
    <div><span>Importado de la red</span><b class="num" data-id="b_imp">—<small>kWh</small></b></div>
    <div><span>Vertido a la red</span><b class="num" data-id="b_exp">—<small>kWh</small></b></div>
    <div><span>CO₂ evitado</span><b class="num" data-id="b_co2">—<small>kg</small></b></div>
    <div data-id="b_savrow"><span>Ahorro estimado</span><b class="num" data-id="b_sav">—<small>€</small></b></div>
   </div></div>
  </section>
  <section class="panel s7"><h2>Últimas 24 horas</h2><p class="hint">Medias de 5 minutos. Pasa el cursor por la gráfica para ver cada momento.</p>
   <div class="chart" data-id="chart"><svg viewBox="0 0 1000 260" preserveAspectRatio="none" data-id="chartsvg" style="height:260px"></svg><div class="tip" data-id="tip"></div></div>
  </section>
 </div>
 <footer><span data-id="fresh">Esperando datos…</span><span>GrowSnif · tarjeta ${GSP_VERSION}</span></footer>
</div>`;
    this._els = {};
    this.shadowRoot.querySelectorAll('[data-id]').forEach((e) => { this._els[e.dataset.id] = e; });
    this.shadowRoot.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this._period = b.dataset.tab;
      this.shadowRoot.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      this._refreshBalance();
    }));
    const chart = this._els.chartsvg;
    chart.addEventListener('mousemove', (ev) => this._hover(ev));
    chart.addEventListener('mouseleave', () => { this._els.tip.style.opacity = 0; this._setCursor(null); });
    this._tick();
    if (this.isConnected) this._refreshStats();
  }

  _unifilar() {
    const lines = this._config.lines || [];
    const n = lines.length + 1;      // + "resto sin medir"
    const x0 = 520, x1 = 1170, step = n > 1 ? (x1 - x0) / (n - 1) : 0;
    let feeders = '';
    for (let i = 0; i < n; i++) {
      const x = (x0 + i * step).toFixed(1), rest = i === lines.length;
      const l = rest ? { name: 'Consumo sin medir por línea', code: 'Resto' } : lines[i];
      const code = l.code || ('L' + String(i + 1).padStart(2, '0'));
      feeders += `<g data-feeder="${i}"><title data-id="ft${i}">${esc(l.name || code)}</title>
       <line class="wire" x1="${x}" y1="200" x2="${x}" y2="262" style="stroke-width:2"></line>
       <line class="flow off" data-id="ff${i}" x1="${x}" y1="200" x2="${x}" y2="262" style="stroke:var(--bus);stroke-width:2"></line>
       <rect class="sym" x="${x - 5}" y="222" width="10" height="10" rx="1" style="stroke-width:1.5"></rect>
       <rect class="ghost" x="${x - 9}" y="272" width="18" height="96" rx="2"></rect>
       <rect class="fbar" data-id="fb${i}" x="${x - 9}" y="368" width="18" height="0" rx="2" fill="${rest ? 'var(--mute)' : 'var(--bus)'}"></rect>
       <text class="fval" data-id="fv${i}" x="${x}" y="388" text-anchor="middle">—</text>
       <text class="fcode" x="${x}" y="404" text-anchor="middle">${esc(code)}</text></g>`;
    }
    return `<div class="uni"><svg viewBox="0 40 1200 380" role="img" aria-label="Esquema unifilar de la instalación">
  <!-- red -->
  <circle class="sym" cx="70" cy="200" r="30"></circle>
  <path d="M52,200 q9,-12 18,0 t18,0" fill="none" stroke="var(--dim)" stroke-width="2"></path>
  <text class="lbl" x="70" y="252" text-anchor="middle">Red eléctrica</text>
  <line class="wire" x1="100" y1="200" x2="200" y2="200"></line>
  <line class="wire" x1="240" y1="200" x2="420" y2="200"></line>
  <path class="flow off" data-id="fwgrid" d="M100,200 L420,200"></path>
  <circle class="sym" cx="220" cy="200" r="20"></circle><text x="220" y="205" text-anchor="middle" style="fill:var(--dim);font-size:13px">kWh</text>
  <text class="lbl" x="220" y="244" text-anchor="middle">Medidor</text>
  <rect class="sym" x="300" y="190" width="20" height="20" rx="2"></rect>
  <path d="M304,194 l12,12 M316,194 l-12,12" stroke="var(--dim)" stroke-width="1.5"></path>
  <text class="val num" data-id="ugrid" x="250" y="150" text-anchor="middle">—</text>
  <text class="lbl" data-id="ugridl" x="250" y="124" text-anchor="middle">Red</text>
  <!-- solar -->
  <g transform="translate(40,300)"><rect class="sym" x="0" y="0" width="60" height="44" rx="2"></rect>
   <path d="M0,15 h60 M0,29 h60 M20,0 v44 M40,0 v44" stroke="var(--dim)" stroke-width="1"></path></g>
  <text class="lbl" x="70" y="364" text-anchor="middle">Paneles</text>
  <line class="wire" x1="100" y1="322" x2="200" y2="322"></line>
  <line class="wire" x1="240" y1="322" x2="460" y2="322"></line>
  <line class="wire" x1="460" y1="322" x2="460" y2="200"></line>
  <path class="flow off" data-id="fwsol" d="M100,322 L460,322 L460,200" style="stroke:var(--sol)"></path>
  <rect class="sym" x="200" y="302" width="40" height="40" rx="3"></rect>
  <path d="M206,336 l28,-28" stroke="var(--dim)" stroke-width="1.2"></path>
  <text x="211" y="316" style="fill:var(--dim);font-size:12px">=</text><text x="224" y="335" style="fill:var(--dim);font-size:12px">~</text>
  <text class="lbl" x="220" y="364" text-anchor="middle">Inversor</text>
  <rect class="sym" x="330" y="312" width="20" height="20" rx="2"></rect>
  <path d="M334,316 l12,12 M346,316 l-12,12" stroke="var(--dim)" stroke-width="1.5"></path>
  <text class="val num" data-id="usol" x="290" y="290" text-anchor="middle" style="fill:var(--sol)">—</text>
  <text class="lbl" x="290" y="266" text-anchor="middle">Solar</text>
  <!-- embarrado -->
  <line x1="420" y1="200" x2="1180" y2="200" stroke="var(--bus)" stroke-width="7" stroke-linecap="round"></line>
  <text class="lbl" x="1180" y="186" text-anchor="end">Embarrado general</text>
  <text class="lbl" x="800" y="64" text-anchor="middle">Consumo del edificio</text>
  <text class="big num" data-id="uload" x="800" y="126" text-anchor="middle">—</text>
  <text class="unit" data-id="uloadsub" x="800" y="156" text-anchor="middle"></text>
  ${feeders}
</svg></div>`;
  }

  _phasorSvg() {
    let g = '';
    for (let i = 0; i < 3; i++) {
      g += `<line data-id="pv${i}" x1="110" y1="110" x2="110" y2="20" stroke="${PHASE_COLORS[i]}" stroke-width="2" opacity=".45" stroke-dasharray="4 3"></line>
       <line data-id="pi${i}" x1="110" y1="110" x2="110" y2="110" stroke="${PHASE_COLORS[i]}" stroke-width="3.5" stroke-linecap="round"></line>
       <circle data-id="pc${i}" cx="110" cy="110" r="4" fill="${PHASE_COLORS[i]}"></circle>`;
    }
    return `<svg viewBox="0 0 220 236" role="img" aria-label="Diagrama fasorial de tensiones y corrientes">
  <circle cx="110" cy="110" r="90" fill="none" stroke="var(--rule2)"></circle>
  <circle cx="110" cy="110" r="45" fill="none" stroke="var(--rule)"></circle>
  <line x1="20" y1="110" x2="200" y2="110" stroke="var(--rule)"></line><line x1="110" y1="20" x2="110" y2="200" stroke="var(--rule)"></line>
  ${g}<circle cx="110" cy="110" r="3" fill="var(--txt)"></circle>
  <text x="110" y="228" text-anchor="middle" class="lbl" style="font-size:12.5px">Discontinuo, tensión. Continuo, corriente.</text></svg>`;
  }

  _gaugeSvg() {
    let ticks = '';
    for (let t = 0; t <= 10; t++) {
      const a = -135 + 27 * t, [xa, ya] = polar(120, 120, 98, a), [xb, yb] = polar(120, 120, t % 5 ? 92 : 86, a);
      ticks += `<line x1="${xa.toFixed(1)}" y1="${ya.toFixed(1)}" x2="${xb.toFixed(1)}" y2="${yb.toFixed(1)}" stroke="var(--rule2)" stroke-width="${t % 5 ? 1 : 2}"></line>`;
    }
    return `<svg viewBox="0 0 240 220" role="img" aria-label="Potencia del inversor sobre la nominal">
  <path d="${arc(120, 120, 80, -135, 135)}" fill="none" stroke="var(--rule)" stroke-width="14" stroke-linecap="round"></path>
  <path data-id="garc" d="${arc(120, 120, 80, -135, -134.9)}" fill="none" stroke="var(--sol)" stroke-width="14" stroke-linecap="round"></path>
  <path data-id="glim" d="" fill="none" stroke="var(--imp)" stroke-width="3"></path>
  ${ticks}
  <text class="num" data-id="gval" x="120" y="124" text-anchor="middle" style="fill:var(--txt);font-size:44px;font-weight:600">—</text>
  <text x="120" y="150" text-anchor="middle" class="unit">kW en alterna</text>
  <text class="num" data-id="gpct" x="120" y="204" text-anchor="middle" style="fill:var(--dim);font-size:15px">— % de la nominal</text></svg>`;
  }

  _ringSvg() {
    return `<svg viewBox="0 0 150 150" role="img" aria-label="Cobertura solar del consumo">
  <circle cx="75" cy="75" r="60" fill="none" stroke="var(--rule)" stroke-width="12"></circle>
  <path data-id="ring" d="${arc(75, 75, 60, 0, 0.01)}" fill="none" stroke="var(--sol)" stroke-width="12" stroke-linecap="round"></path>
  <text class="num" data-id="ringv" x="75" y="80" text-anchor="middle" style="fill:var(--txt);font-size:34px;font-weight:600">—</text>
  <text x="75" y="102" text-anchor="middle" style="fill:var(--dim);font-size:13px">cobertura solar</text></svg>`;
  }

  // ------------------------------------------------------------------ live

  _set(id, text) { const e = this._els[id]; if (e && e.textContent !== text) e.textContent = text; }
  _w(id, pct) { const e = this._els[id]; if (e) e.style.width = clamp(pct, 0, 100).toFixed(1) + '%'; }
  _flow(id, watts, ref, color, reverse) {
    const e = this._els[id];
    if (!e) return;
    const on = watts != null && Math.abs(watts) > 50;
    e.classList.toggle('off', !on);
    if (!on) return;
    const r = clamp(Math.abs(watts) / (ref || 1), 0, 1);
    const d = (Math.round((3.2 - 2.6 * r) * 4) / 4).toFixed(2) + 's';
    if (e.style.getPropertyValue('--d') !== d) e.style.setProperty('--d', d);
    if (color) e.style.stroke = color;
    e.classList.toggle('rev', !!reverse);
  }

  _tick() {
    if (!this._els) return;
    const d = new Date();
    this._set('clock', d.toLocaleTimeString('es-ES'));
    this._set('date', d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
    const p = period61(d);
    if (this._lastP !== p + '-' + d.getHours()) {
      this._lastP = p + '-' + d.getHours();
      const pb = this._els.pbig;
      pb.textContent = 'P' + p; pb.style.background = PERIOD_COLORS[p];
      this._set('pname', p === 6 ? 'Periodo valle de la tarifa 6.1TD' : `Periodo ${p} de la tarifa 6.1TD`);
      this._set('pseason', [0, 6].includes(d.getDay()) || HOLIDAYS.includes((d.getMonth() + 1) + '-' + d.getDate())
        ? 'Festivo o fin de semana, todo el día en P6' : seasonName(d));
      let cells = '';
      for (let h = 0; h < 24; h++) {
        const t = new Date(d); t.setHours(h, 0, 0, 0);
        const ph = period61(t);
        cells += `<i class="${h === d.getHours() ? 'now' : ''}" style="background:${PERIOD_COLORS[ph]}" title="${h}:00, P${ph}"></i>`;
      }
      this._els.ribbon.innerHTML = cells;
    }
  }

  _update() {
    if (!this._els || !this._hass) return;
    const c = this._config, M = (k) => this._num('m', k), I = (k) => this._num('i', k);
    const asleep = this._str('i', 'estado') === 'Sin respuesta';
    const pGrid = M('potencia_total');
    let pSol = I('potencia_ac');
    if (pSol == null && asleep) pSol = 0;
    const pLoad = pGrid != null ? pGrid + (pSol || 0) : null;
    const nominal = +c.nominal_power || 100000;
    const gridRef = +c.grid_max || nominal;

    // ---- unifilar
    this._set('ugrid', pGrid == null ? '—' : kw(Math.abs(pGrid)) + ' kW');
    this._set('ugridl', pGrid == null ? 'Red' : pGrid >= 0 ? 'Importando de la red' : 'Vertiendo a la red');
    this._els.ugrid.style.fill = pGrid == null ? 'var(--txt)' : pGrid >= 0 ? 'var(--imp)' : 'var(--exp)';
    this._flow('fwgrid', pGrid, gridRef, pGrid >= 0 ? 'var(--imp)' : 'var(--exp)', pGrid < 0);
    this._set('usol', pSol == null ? '—' : kw(pSol) + ' kW');
    this._flow('fwsol', pSol, nominal, null, false);
    this._set('uload', pLoad == null ? '—' : kw(pLoad) + ' kW');
    const solShare = pLoad > 0 && pSol != null ? clamp(Math.min(pSol, pLoad) / pLoad * 100, 0, 100) : null;
    this._set('uloadsub', solShare == null ? '' : `${nf(solShare, 0)} % cubierto con energía solar ahora mismo`);

    const lines = c.lines || [];
    const lp = lines.map((l) => this._lineNum(l.power));
    const measured = lp.reduce((a, v) => a + (v || 0), 0);
    const rest = pLoad != null ? Math.max(0, pLoad - measured) : null;
    const all = [...lp, rest];
    const maxFeeder = Math.max(1, ...all.filter((v) => v != null), ...lines.map((l) => +l.max || 0));
    all.forEach((v, i) => {
      const bar = this._els['fb' + i];
      const h = v == null ? 0 : clamp(v / maxFeeder, 0, 1) * 96;
      bar.setAttribute('height', h.toFixed(1)); bar.setAttribute('y', (368 - h).toFixed(1));
      this._set('fv' + i, v == null ? '—' : nf(v / 1000, v >= 10000 ? 0 : 1));
      this._flow('ff' + i, v, maxFeeder, null, false);
      const l = lines[i];
      if (l) this._set('ft' + i, `${l.name || l.code}: ${v == null ? 'sin señal' : kw(v) + ' kW'}`);
    });

    // ---- red
    const U = [1, 2, 3].map((p) => M('tension_l' + p)), A = [1, 2, 3].map((p) => M('corriente_l' + p));
    const P = [1, 2, 3].map((p) => M('potencia_l' + p)), Q = [1, 2, 3].map((p) => M('reactiva_l' + p));
    const F = [1, 2, 3].map((p) => M('fp_l' + p));
    const imax = Math.max(1, ...A.filter((v) => v != null));
    for (let i = 0; i < 3; i++) {
      const p = i + 1;
      this._set('u' + p, nf(U[i], 1)); this._set('i' + p, nf(A[i], 0)); this._set('p' + p, kw(P[i]));
      this._set('q' + p, kw(Q[i])); this._set('f' + p, nf(F[i], 2));
      this._w('ib' + p, (A[i] || 0) / imax * 100);
      const vang = i * 120;
      const [vx, vy] = polar(110, 110, 90, vang);
      this._els['pv' + i].setAttribute('x2', vx.toFixed(1)); this._els['pv' + i].setAttribute('y2', vy.toFixed(1));
      const phi = P[i] != null && Q[i] != null ? Math.atan2(Q[i], P[i]) * 180 / Math.PI : 0;
      const [ix, iy] = polar(110, 110, 78 * (A[i] || 0) / imax, vang + phi);
      this._els['pi' + i].setAttribute('x2', ix.toFixed(1)); this._els['pi' + i].setAttribute('y2', iy.toFixed(1));
      this._els['pc' + i].setAttribute('cx', ix.toFixed(1)); this._els['pc' + i].setAttribute('cy', iy.toFixed(1));
    }
    const aval = A.filter((v) => v != null), avg = aval.length ? aval.reduce((a, b) => a + b, 0) / aval.length : 0;
    const unb = aval.length === 3 && avg > 1 ? (Math.max(...aval) - Math.min(...aval)) / avg * 100 : null;
    this._set('freq', nf(M('frecuencia'), 2)); this._set('unb', nf(unb, 0));
    const ull = ['ab', 'bc', 'ca'].map((k) => M('tension_' + k)).filter((v) => v != null);
    this._set('ull', ull.length ? ull.map((v) => nf(v, 0)).join(' / ') : '—');
    this._set('qt', kw(M('reactiva_total')));
    const fpt = M('fp_total');
    this._set('fpt', nf(fpt, 3));
    this._els.fpm.style.left = fpt == null ? '0' : clamp((Math.abs(fpt) - 0.8) / 0.2 * 100, 0, 100) + '%';
    this._set('redhint', pGrid == null ? 'Medidor de acometida sin datos'
      : `Medidor de acometida, ${pGrid >= 0 ? 'importando' : 'vertiendo'} ${kw(Math.abs(pGrid))} kW`);

    // ---- generación
    const pfv = I('potencia_fv');
    const eff = !asleep && pfv > 1000 && pSol != null ? pSol / pfv * 100 : null;
    const pct = pSol != null ? pSol / nominal * 100 : null;
    this._els.garc.setAttribute('d', arc(120, 120, 80, -135, -135 + 270 * clamp((pct || 0) / 100, 0, 1)));
    const lim = I('limite_antivertido');
    if (lim != null && lim < 99.5) {
      const a = -135 + 270 * clamp(lim / 100, 0, 1);
      const [xa, ya] = polar(120, 120, 64, a), [xb, yb] = polar(120, 120, 96, a);
      this._els.glim.setAttribute('d', `M${xa.toFixed(1)},${ya.toFixed(1)} L${xb.toFixed(1)},${yb.toFixed(1)}`);
    } else this._els.glim.setAttribute('d', '');
    this._set('gval', pSol == null ? '—' : nf(pSol / 1000, pSol >= 100000 ? 0 : 1));
    this._set('gpct', pct == null ? 'Sin datos' : `${nf(pct, 0)} % de ${nf(nominal / 1000, 0)} kW nominales`);
    this._set('pfv', kw(pfv)); this._set('eff', nf(eff, 1));
    this._set('state', this._str('i', 'estado') || '—'); this._set('derate', this._str('i', 'limitacion') || '—');
    this._set('lim', nf(lim, 0)); this._set('eday', nf(I('energia_hoy'), 1));
    this._set('iq', kw(I('reactiva'))); this._set('iqmax', I('reactiva_maxima') != null ? `de ${kw(I('reactiva_maxima'), 0)} kvar` : 'kvar');
    const iso = I('aislamiento');
    this._set('iso', iso == null ? '—' : iso >= 65000 ? 'Máximo' : nf(iso, 0));
    [['ti', 'temperatura_inversor', 80], ['tipm', 'temperatura_ipm', 90], ['tb', 'temperatura_boost', 90]].forEach(([id, k, max]) => {
      const t = I(k);
      this._set(id, t == null ? '—' : nf(t, 1) + ' °C');
      this._w(id + 'b', (t || 0) / max * 100);
      this._els[id + 'b'].style.background = t > max * 0.8 ? 'var(--crit)' : t > max * 0.65 ? 'var(--warn)' : 'var(--ok)';
    });
    this._set('genhint', asleep ? 'Inversor en reposo, sin respuesta al datalogger'
      : pSol == null ? 'Inversor sin datos' : `Inversor ${this._str('i', 'estado') || ''}`.trim());

    // ---- campo
    const mppts = clamp(+c.mppts || 0, 0, 16), strings = clamp(+c.strings || 0, 0, 32);
    const mp = [];
    for (let n = 1; n <= mppts; n++) mp.push(I(`mppt${n}_potencia`));
    const mpMax = Math.max(1, nominal / Math.max(1, mppts) * 1.1, ...mp.filter((v) => v != null));
    for (let n = 1; n <= mppts; n++) {
      const p = mp[n - 1];
      this._els[`m${n}t`].style.height = clamp((p || 0) / mpMax * 100, 0, 100) + '%';
      this._set(`m${n}p`, kw(p));
      this._set(`m${n}v`, `${nf(I(`mppt${n}_tension`), 0)} V`);
      this._set(`m${n}a`, `${nf(I(`mppt${n}_corriente`), 1)} A`);
    }
    const dead = new Set(String(this._str('i', 'strings_desconectados') || '').split(/[,\s]+/).filter(Boolean).map(Number));
    const cur = [];
    for (let k = 1; k <= strings; k++) cur.push(I(`string${k}_corriente`));
    const live = cur.filter((v, i) => v != null && v > 0.3 && !dead.has(i + 1));
    const med = median(live);
    const per = mppts ? Math.max(1, Math.ceil(strings / mppts)) : 1;
    const low = [], none = [];
    for (let k = 1; k <= strings; k++) {
      const e = this._els['s' + k]; if (!e) continue;
      const v = cur[k - 1], mpptP = mp[Math.ceil(k / per) - 1] || 0;
      let cls = '', why;
      if (dead.has(k)) { cls = 'dead'; why = 'desconectado según el inversor'; }
      else if (v == null) { cls = 'idle'; why = 'sin datos'; }
      else if (v < 0.3) {
        // No current: an unused input if its MPPT is idle too, suspicious if the MPPT produces.
        if (mpptP > 500 && med != null && med >= 1.5) { cls = 'low'; none.push(k); why = 'sin corriente con su MPPT produciendo'; }
        else { cls = 'idle'; why = mpptP > 500 ? 'sin corriente' : 'entrada sin uso o sin sol'; }
      } else if (med != null && med >= 1.5 && v < med * 0.6) { cls = 'low'; low.push(k); }
      if (e.className !== cls) e.className = cls;
      e.title = `String ${k}: ${why || nf(v, 1) + ' A'}`;
    }
    this._set('fieldhint', dead.size ? `${dead.size} strings sin corriente según el inversor` : 'Potencia por MPPT y corriente de cada string');

    // ---- alarmas
    this._alarms({ pGrid, pSol, pfv, eff, U, A, unb, fpt, dead, low, none, asleep, lim });

    // ---- frescura
    const am = this._age('m', 'potencia_total'), ai = this._age('i', 'potencia_ac');
    const ago = (s) => s == null ? 'sin datos' : s < 90 ? `hace ${Math.round(s)} s` : `hace ${Math.round(s / 60)} min`;
    this._set('fresh', `Medidor actualizado ${ago(am)}. Inversor actualizado ${ago(ai)}.`);
    this._live = { pGrid, pSol, pLoad };
  }

  _alarms(d) {
    const c = this._config, I = (k) => this._num('i', k), M = (k) => this._num('m', k);
    const sun = this._st('sun.sun');
    const day = sun ? sun.state === 'above_horizon' : (new Date().getHours() >= 8 && new Date().getHours() < 19);
    const al = [], chk = {};
    const mark = (k, lvl) => { const o = { ok: 0, na: -1, info: 0, warn: 1, crit: 2 }; if (!(k in chk) || o[lvl] > o[chk[k]]) chk[k] = lvl; };
    const add = (lvl, cat, title, text) => { al.push({ lvl, title, text }); mark(cat, lvl); };
    ['Comunicación', 'Tensión de red', 'Frecuencia', 'Factor de potencia', 'Equilibrio de fases', 'Vertido cero',
      'Inversor', 'Strings', 'Temperaturas', 'Aislamiento'].forEach((k) => mark(k, 'ok'));

    const am = this._age('m', 'potencia_total'), ai = this._age('i', 'potencia_ac');
    if (d.pGrid == null || am > 90) add('crit', 'Comunicación', 'Sin datos del medidor de red', 'Revisa el canal del medidor en la pasarela RS485 y el complemento GrowSnif.');
    if (!d.asleep && day && (d.pSol == null || ai > 300)) add('warn', 'Comunicación', 'Sin datos recientes del inversor', 'El canal del inversor no recibe lecturas con el sol fuera.');
    d.U.forEach((u, i) => {
      if (u != null && (u < 207 || u > 253)) add('crit', 'Tensión de red', `Tensión L${i + 1} fuera de margen: ${nf(u, 1)} V`, 'El margen reglamentario es 230 V ±10 %.');
    });
    if (d.U.every((u) => u == null)) mark('Tensión de red', 'na');
    const f = M('frecuencia');
    if (f != null && (f < 49.8 || f > 50.2)) add('warn', 'Frecuencia', `Frecuencia anómala: ${nf(f, 2)} Hz`, 'Lo normal es 50 Hz ±0,2.');
    if (f == null) mark('Frecuencia', 'na');
    if (d.fpt != null && Math.abs(d.fpt) < 0.95 && d.pGrid > 2000) {
      const qmax = I('reactiva_maxima');
      add('warn', 'Factor de potencia', `cos φ de ${nf(Math.abs(d.fpt), 3)}, por debajo de 0,95`,
        `Con ${kw(M('reactiva_total'))} kvar de reactiva la factura 6.1TD penaliza.` +
        (qmax ? ` El inversor podría aportar hasta ${kw(qmax, 0)} kvar.` : ''));
    }
    if (d.fpt == null) mark('Factor de potencia', 'na');
    if (d.unb != null && d.unb > 25 && Math.max(...d.A.filter((v) => v != null)) > 20) {
      add('warn', 'Equilibrio de fases', `Fases desequilibradas un ${nf(d.unb, 0)} %`, `Corrientes ${d.A.map((a) => nf(a, 0)).join(', ')} A. Conviene repartir cargas.`);
    }
    if (c.zero_export && d.pGrid != null && d.pGrid < -1000) {
      add('warn', 'Vertido cero', `Vertiendo ${kw(-d.pGrid)} kW a la red`, 'La limitación de vertido debería mantenerlo en cero. Revisa el datalogger.');
    }
    const st = this._str('i', 'estado');
    if (st === 'Fallo') add('crit', 'Inversor', 'Inversor en fallo', `Código de fallo ${I('fallo_codigo') ?? '—'}. Consulta el manual del inversor.`);
    else if (d.asleep && day) add('crit', 'Inversor', 'El inversor no responde con el sol fuera', 'El datalogger pregunta y no recibe respuesta. Revisa el inversor y su cableado RS485.');
    else if (d.asleep) add('info', 'Inversor', 'Inversor en reposo nocturno', 'Volverá a producir al amanecer.');
    else if (st && st !== 'Normal' && day) add('warn', 'Inversor', `Inversor en estado ${st}`, 'No está produciendo con normalidad.');
    if (!st && d.pSol == null) mark('Inversor', 'na');
    if (I('fallo_codigo') > 0 && st !== 'Fallo') add('crit', 'Inversor', `Código de fallo ${I('fallo_codigo')}`, 'El inversor informa de un fallo.');
    if (I('aviso_codigo') > 0) add('warn', 'Inversor', `Código de aviso ${I('aviso_codigo')}`, 'El inversor informa de un aviso.');
    if (I('ventiladores_averiados') > 0) add('crit', 'Temperaturas', `${I('ventiladores_averiados')} ventilador(es) averiado(s)`, 'El inversor perderá potencia por temperatura.');
    const der = this._str('i', 'limitacion');
    if (der && der !== 'Ninguna') add('info', 'Inversor', `Potencia limitada por ${der.toLowerCase()}`, 'El inversor está recortando su producción.');
    if (d.lim != null && d.lim < 99.5) add('info', 'Vertido cero', `Recorte antivertido al ${nf(d.lim, 0)} %`, 'El datalogger limita la producción para no verter a la red.');
    if (d.eff != null && d.pfv > 10000 && d.eff < 94) add('warn', 'Inversor', `Rendimiento bajo: ${nf(d.eff, 1)} %`, 'Lo habitual a esta carga es más del 97 %.');
    if (d.dead.size) {
      add('warn', 'Strings', `${d.dead.size} strings sin corriente: ${[...d.dead].join(', ')}`,
        'El inversor los marca como desconectados. Revisa fusibles y seccionadores, o confirma que son entradas sin uso.');
    }
    if (d.low.length) add('warn', 'Strings', `Strings con poca corriente: ${d.low.join(', ')}`, 'Dan menos del 60 % de la mediana. Posible suciedad, sombra o conexión defectuosa.');
    if (d.none.length) add('warn', 'Strings', `Strings sin corriente: ${d.none.join(', ')}`, 'Su MPPT produce pero ellos no. Revisa su fusible o conector.');
    if (!+c.strings) mark('Strings', 'na');
    [['temperatura_inversor', 'Inversor', 65, 75], ['temperatura_ipm', 'Módulo de potencia', 80, 90]].forEach(([k, n, w, cr]) => {
      const t = I(k);
      if (t > cr) add('crit', 'Temperaturas', `${n} a ${nf(t, 1)} °C`, 'Temperatura crítica. Revisa ventilación y filtros.');
      else if (t > w) add('warn', 'Temperaturas', `${n} a ${nf(t, 1)} °C`, 'Temperatura alta. Revisa ventilación.');
    });
    if (I('temperatura_inversor') == null) mark('Temperaturas', 'na');
    const iso = I('aislamiento'), leak = I('fuga_tierra');
    if (iso != null && iso < 1000 && !d.asleep) add('warn', 'Aislamiento', `Aislamiento bajo: ${nf(iso, 0)} kΩ`, 'Posible humedad o cable dañado en el campo solar.');
    if (leak != null && leak > 150) add('warn', 'Aislamiento', `Corriente de fuga de ${nf(leak, 0)} mA`, 'El inversor se desconecta hacia 300 mA.');
    if (iso == null && leak == null) mark('Aislamiento', 'na');

    const sig = JSON.stringify([al, chk]);
    if (sig === this._alSig) return;
    this._alSig = sig;
    const order = { crit: 0, warn: 1, info: 2 };
    al.sort((a, b) => order[a.lvl] - order[b.lvl]);
    this._els.checks.innerHTML = Object.entries(chk).map(([k, v]) =>
      `<div class="chk ${v === 'info' ? '' : v}"><i></i>${esc(k)}</div>`).join('');
    this._els.alarms.innerHTML = al.length ? al.map((a) =>
      `<div class="al ${a.lvl}"><b>${esc(a.title)}</b><span>${esc(a.text)}</span></div>`).join('')
      : '<p class="empty">Sin alarmas. Todas las verificaciones están en orden.</p>';
    const nc = al.filter((a) => a.lvl === 'crit').length, nw = al.filter((a) => a.lvl === 'warn').length;
    const s = this._els.status;
    s.className = 'status ' + (nc ? 'crit' : nw ? 'warn' : '');
    this._set('statustxt', nc ? `${nc} alarma${nc > 1 ? 's' : ''}${nw ? ` y ${nw} aviso${nw > 1 ? 's' : ''}` : ''}`
      : nw ? `${nw} aviso${nw > 1 ? 's' : ''}` : 'Todo en orden');
  }

  // ------------------------------------------------------------------ statistics

  _refreshStats() {
    if (!this._hass || !this._els || this._uid === undefined) return;
    this._refreshBalance();
    this._refreshChart();
  }

  async _change(eid, period) {
    if (!eid || !this._st(eid)) return null;
    try {
      const r = await this._hass.callWS({ type: 'recorder/statistic_during_period', statistic_id: eid,
        calendar: { period }, types: ['change'] });
      return r && r.change != null ? r.change : null;
    } catch (e) { return null; }
  }

  async _refreshBalance() {
    const p = this._period, c = this._config;
    const [imp, exp, sol] = await Promise.all([
      this._change(this._id('m', 'energia_importada'), p),
      this._change(this._id('m', 'energia_exportada'), p),
      this._change(this._id('i', 'energia_total'), p)]);
    if (p !== this._period) return;
    const self = sol != null ? Math.max(0, sol - (exp || 0)) : null;
    const load = imp != null ? imp + (self || 0) : null;
    const cover = load > 0 && self != null ? self / load * 100 : null;
    const dig = (v) => v == null ? 1 : v >= 1000 ? 0 : 1;
    const put = (id, v, unit) => { this._els[id].innerHTML = `${nf(v, dig(v))}<small>${unit}</small>`; };
    put('b_sol', sol, 'kWh'); put('b_load', load, 'kWh'); put('b_imp', imp, 'kWh'); put('b_exp', exp, 'kWh');
    const co2st = c.co2_entity && this._st(c.co2_entity), co2f = co2st && isFinite(+co2st.state) ? +co2st.state : +c.co2_factor;
    put('b_co2', sol != null ? sol * co2f / 1000 : null, 'kg');
    this._els.b_savrow.style.display = c.price_kwh ? '' : 'none';
    if (c.price_kwh) put('b_sav', self != null ? self * c.price_kwh : null, '€');
    this._els.ring.setAttribute('d', arc(75, 75, 60, 0, 359.99 * clamp((cover || 0) / 100, 0, 1)));
    this._set('ringv', cover == null ? '—' : nf(cover, 0) + ' %');
  }

  async _refreshChart() {
    const ids = { grid: this._id('m', 'potencia_total'), sol: this._id('i', 'potencia_ac') };
    const end = new Date(), start = new Date(end - 24 * 3600 * 1000);
    let res;
    try {
      res = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: start.toISOString(),
        end_time: end.toISOString(), statistic_ids: Object.values(ids).filter(Boolean), period: '5minute', types: ['mean'] });
    } catch (e) { return; }
    const toMap = (arr) => {
      const m = new Map();
      (arr || []).forEach((p) => { if (p.mean != null) m.set(Math.round((typeof p.start === 'number' ? p.start : Date.parse(p.start)) / 300000), p.mean); });
      return m;
    };
    const g = toMap(res[ids.grid]), s = toMap(res[ids.sol]);
    const keys = [...new Set([...g.keys(), ...s.keys()])].sort((a, b) => a - b);
    this._series = keys.map((k) => {
      const gv = g.get(k) ?? null, sv = s.get(k) ?? 0;
      return { t: k * 300000, grid: gv, sol: sv, load: gv == null ? null : gv + sv };
    });
    this._drawChart(start.getTime(), end.getTime());
  }

  _drawChart(t0, t1) {
    const svg = this._els.chartsvg, S = this._series || [];
    this._chartRange = [t0, t1];
    if (!S.length) { svg.innerHTML = `<text x="500" y="130" text-anchor="middle" class="lbl">Aún no hay estadísticas de las últimas 24 horas.</text>`; return; }
    const vals = S.flatMap((p) => [p.grid, p.sol, p.load]).filter((v) => v != null);
    const hi = Math.max(1000, ...vals) * 1.1, lo = Math.min(0, ...vals) * 1.1;
    const X = (t) => (t - t0) / (t1 - t0) * 1000, Y = (v) => 20 + (hi - v) / (hi - lo) * 210;
    this._chartXY = { X, Y, lo, hi };
    const line = (k) => {
      let d = '', pen = false;
      S.forEach((p, i) => {
        const v = p[k]; const gap = i && p.t - S[i - 1].t > 900000;
        if (v == null || gap) pen = false;
        if (v == null) return;
        d += (pen ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(v).toFixed(1); pen = true;
      });
      return d;
    };
    const solArea = 'M' + X(S[0].t).toFixed(1) + ',' + Y(0) + S.map((p) => 'L' + X(p.t).toFixed(1) + ',' + Y(p.sol || 0).toFixed(1)).join('')
      + 'L' + X(S[S.length - 1].t).toFixed(1) + ',' + Y(0) + 'Z';
    let grid = '', ylab = '';
    const step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))) * (((hi - lo) / 4) / Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))) > 5 ? 5 : 2);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      grid += `<line x1="0" x2="1000" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--rule)" stroke-width="1" vector-effect="non-scaling-stroke"></line>`;
      ylab += `<span style="position:absolute;left:4px;top:calc(${(Y(v) / 260 * 100).toFixed(2)}% - 16px);color:var(--dim);font-size:12px">${nf(v / 1000, 0)} kW</span>`;
    }
    const labels = [];
    for (let h = Math.ceil(t0 / 3600000 / 3) * 3; h * 3600000 <= t1; h += 3) {
      const t = h * 3600000;
      labels.push(`<span style="position:absolute;transform:translateX(-50%);top:2px;left:${(X(t) / 10).toFixed(2)}%">${String(new Date(t).getHours()).padStart(2, '0')}:00</span>`);
    }
    svg.innerHTML = `<defs><linearGradient id="gsol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb547" stop-opacity=".45"/><stop offset="1" stop-color="#ffb547" stop-opacity=".03"/></linearGradient></defs>
      ${grid}<line x1="0" x2="1000" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--rule2)" vector-effect="non-scaling-stroke"></line>
      <path d="${solArea}" fill="url(#gsol)"></path>
      <path d="${line('sol')}" fill="none" stroke="var(--sol)" stroke-width="2" vector-effect="non-scaling-stroke"></path>
      <path d="${line('load')}" fill="none" stroke="var(--bus)" stroke-width="2" vector-effect="non-scaling-stroke"></path>
      <path d="${line('grid')}" fill="none" stroke="var(--imp)" stroke-width="1.6" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"></path>
      <line data-cursor x1="0" x2="0" y1="10" y2="240" stroke="var(--txt)" stroke-width="1" opacity="0" vector-effect="non-scaling-stroke"></line>`;
    let axis = this._els.chart.querySelector('.axis');
    if (!axis) {
      axis = document.createElement('div'); axis.className = 'axis';
      axis.style.cssText = 'position:relative;height:18px;color:var(--dim);font-size:12.5px';
      this._els.chart.appendChild(axis);
      const leg = document.createElement('div');
      leg.className = 'legend'; leg.style.marginTop = '8px';
      leg.innerHTML = '<span><i style="background:var(--sol)"></i>Solar</span><span><i style="background:var(--bus)"></i>Consumo del edificio</span><span><i style="background:var(--imp)"></i>Red (negativo, vertido)</span><span>Escala máxima ' + kw(hi, 0) + ' kW</span>';
      this._els.chart.appendChild(leg); this._legend = leg;
    } else this._legend.lastElementChild.textContent = 'Escala máxima ' + kw(hi, 0) + ' kW';
    axis.innerHTML = labels.join('');
    let yl = this._els.chart.querySelector('.ylab');
    if (!yl) { yl = document.createElement('div'); yl.className = 'ylab'; yl.style.cssText = 'position:absolute;left:0;top:0;height:260px;width:100%;pointer-events:none'; this._els.chart.appendChild(yl); }
    yl.innerHTML = ylab;
  }

  _setCursor(x) {
    const l = this._els.chartsvg.querySelector('[data-cursor]');
    if (!l) return;
    if (x == null) { l.setAttribute('opacity', 0); return; }
    l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('opacity', 0.5);
  }

  _hover(ev) {
    const S = this._series; if (!S || !S.length || !this._chartRange) return;
    const r = this._els.chartsvg.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width, [t0, t1] = this._chartRange, t = t0 + fx * (t1 - t0);
    let best = S[0];
    for (const p of S) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    const x = this._chartXY.X(best.t);
    this._setCursor(x);
    const tip = this._els.tip;
    tip.innerHTML = `<b>${new Date(best.t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</b><br>
      <span style="color:var(--sol)">Solar ${kw(best.sol)} kW</span><br><span style="color:var(--bus)">Consumo ${kw(best.load)} kW</span><br>
      <span style="color:var(--imp)">Red ${kw(best.grid)} kW</span>`;
    tip.style.opacity = 1;
    const left = clamp(x / 1000 * r.width + 12, 0, r.width - 150);
    tip.style.left = left + 'px'; tip.style.top = '20px';
  }
}

if (!customElements.get('growsnif-panel')) customElements.define('growsnif-panel', GrowSnifPanel);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'growsnif-panel')) {
  window.customCards.push({ type: 'growsnif-panel', name: 'GrowSnif · Centro de control',
    description: 'Esquema unifilar, red trifásica, generación solar, campo FV, alarmas y balance.', preview: false });
}
console.info('%c GrowSnif panel %c ' + GSP_VERSION + ' ', 'background:#5fd4ff;color:#0c1b2b;font-weight:600', 'background:#12263b;color:#e3edf7');
