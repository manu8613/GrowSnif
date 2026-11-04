/*
 * GrowSnif · Centro de control energético
 * Creado por manu8613 · https://github.com/manu8613/GrowSnif · Licencia MIT
 * Si reutilizas este código, mantén este aviso y menciona al autor original.
 * Tarjeta para Home Assistant (vista de panel). Sin dependencias.
 *
 *   type: custom:growsnif-panel
 *   meter_prefix: growsnif              # prefijo del medidor en GrowSnif
 *   inverter_prefix: growsnif_inversor  # prefijo del inversor en GrowSnif
 *
 * Incluye también custom:growsnif-ahorro y custom:growsnif-impacto.
 *
 * Las entidades se encuentran por su unique_id de GrowSnif, así que siguen
 * funcionando aunque las hayas renombrado. Opciones completas en cards/README.md.
 */
const GSP_VERSION = '1.2.0';
const GSP_AUTHOR = 'manu8613';
const GSP_REPO = 'https://github.com/manu8613/GrowSnif';
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
footer a{color:var(--dim)}
.dim-bg{position:fixed;inset:0;background:rgba(4,10,18,.6);opacity:0;pointer-events:none;transition:opacity .2s;z-index:10}
.dim-bg.open{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(460px,100vw);background:var(--panel);border-left:1px solid var(--rule2);z-index:11;
 transform:translateX(102%);transition:transform .25s ease;display:flex;flex-direction:column;padding:22px 24px;overflow-y:auto;visibility:hidden}
.drawer.open{transform:none;visibility:visible}
.drawer .tabs{align-self:flex-start}
.drawer h3{font-family:"Barlow Condensed",sans-serif;font-size:28px;font-weight:600;margin:0 40px 2px 0}
.drawer .x{position:absolute;top:16px;right:16px;background:none;border:1px solid var(--rule2);color:var(--txt);border-radius:5px;width:36px;height:36px;font-size:20px;cursor:pointer}
.dval{font-family:"Barlow Condensed",sans-serif;font-size:56px;font-weight:600;line-height:1;margin:10px 0 14px;font-variant-numeric:tabular-nums}
.dval small{font-size:22px;color:var(--dim);font-weight:500;margin-left:4px}
.dchart{min-height:190px;margin-top:4px}
.dstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 4px}
.dstats div{background:var(--panel2);border-radius:4px;padding:8px 10px}.dstats span{display:block;color:var(--dim);font-size:12.5px}
.dstats b{font-family:"Barlow Condensed",sans-serif;font-size:20px;font-weight:500}
.drel{display:grid;gap:6px;margin-top:12px}
.drel button{display:flex;justify-content:space-between;gap:10px;width:100%;font:inherit;font-size:14.5px;color:var(--txt);background:var(--panel2);border:1px solid var(--rule);border-radius:4px;padding:9px 11px;cursor:pointer;text-align:left}
.drel button span{color:var(--dim)}.drel button b{font-family:"Barlow Condensed",sans-serif;font-weight:500;font-size:17px}
.drel button:hover{border-color:var(--rule2)}
.btn{font:inherit;font-size:14.5px;color:var(--ink);background:var(--bus);border:0;border-radius:5px;padding:10px 16px;cursor:pointer;font-weight:600;margin-top:18px;align-self:flex-start}
[data-detail],[data-more]{cursor:pointer}
[data-more]:hover .n,[data-more]:hover>b{text-decoration:underline;text-decoration-color:var(--rule2);text-underline-offset:3px}
.hitbox{fill:transparent}.hitbox:hover{fill:rgba(95,212,255,.06)}
g[data-detail]:hover .ghost{stroke:var(--dim)}
.mppt[data-detail]:hover{border-color:var(--rule2)}.str b:hover{filter:brightness(1.3)}
[data-detail]:focus-visible,[data-more]:focus-visible,.drawer button:focus-visible,.al button:focus-visible{outline:2px solid var(--bus);outline-offset:2px}
.al .acts{display:flex;gap:8px;margin-top:7px;flex-wrap:wrap}
.al .acts button,.linkbtn{font:inherit;font-size:13px;color:var(--txt);background:none;border:1px solid var(--rule2);border-radius:4px;padding:3px 10px;cursor:pointer}
.linkbtn{border:0;color:var(--dim);padding:4px 0;text-decoration:underline;text-underline-offset:3px}
.al.acked{opacity:.6}
.chart-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
@media (max-width:1180px){.s7,.s6,.s5{grid-column:span 12}}
@media (max-width:720px){
 .root{padding:14px 12px}
 header{grid-template-columns:1fr;gap:14px}.sys{text-align:left}
 .row2,.gen,.bal{grid-template-columns:1fr}
 .row2 svg,.gen svg{max-width:240px;margin:0 auto}.bal svg{max-width:150px;margin:0 auto}
 .phase{grid-template-columns:34px repeat(5,minmax(0,1fr));gap:4px 6px}.phase .n{font-size:16px}
 h1{font-size:28px}}
@media (prefers-reduced-motion:reduce){.drawer,.dim-bg{transition:none}.flow{animation:none;stroke-dasharray:none;opacity:.7}.fbar,.bar i,.mppt .tube i,.cosbar em{transition:none}}
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
      grid_max: null, strings_per_mppt: 0, thresholds: {},
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

  _per() {
    const c = this._config, mppts = clamp(+c.mppts || 0, 0, 16), strings = clamp(+c.strings || 0, 0, 32);
    return +c.strings_per_mppt > 0 ? +c.strings_per_mppt : mppts ? Math.max(1, Math.ceil(strings / mppts)) : 1;
  }

  _th() {
    return Object.assign({ pf_min: 0.95, v_min: 207, v_max: 253, f_min: 49.8, f_max: 50.2, unbalance_max: 25,
      export_max: 1000, temp_warn: 65, temp_crit: 75, ipm_warn: 80, ipm_crit: 90, iso_min: 1000, leak_max: 150,
      eff_min: 94, string_low: 0.6 }, this._config.thresholds || {});
  }
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
    const per = this._per();
    let field = '';
    for (let n = 1; n <= mppts; n++) {
      let s = '';
      for (let k = (n - 1) * per + 1; k <= Math.min(strings, n * per); k++) {
        s += `<b data-id="s${k}" data-detail="string:${k}" tabindex="0" role="button" title="String ${k}">${k}</b>`;
      }
      field += `<div class="mppt" data-detail="mppt:${n}" tabindex="0" role="button" aria-label="MPPT ${n}, ver detalle"><div class="t">MPPT ${n}</div><div class="tube"><i data-id="m${n}t" style="height:0"></i></div>
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
     ${[1, 2, 3].map((p) => `<span class="ph" data-detail="phase:${p}" tabindex="0" role="button" aria-label="Fase L${p}, ver detalle" style="color:${PHASE_COLORS[p - 1]}">L${p}</span>
      <span data-more="m:tension_l${p}"><span class="n num" data-id="u${p}">—</span> <small>V</small></span>
      <span data-more="m:corriente_l${p}"><span class="n num" data-id="i${p}">—</span> <small>A</small><div class="bar"><i data-id="ib${p}" style="background:${PHASE_COLORS[p - 1]};width:0"></i></div></span>
      <span data-more="m:potencia_l${p}"><span class="n num" data-id="p${p}">—</span> <small>kW</small></span>
      <span data-more="m:reactiva_l${p}"><span class="n num" data-id="q${p}">—</span> <small>kvar</small></span>
      <span data-more="m:fp_l${p}"><span class="n num" data-id="f${p}">—</span></span>`).join('')}
    </div>${this._phasorSvg()}</div>
   <div class="facts">
    <div class="fact" data-more="m:frecuencia"><span>Frecuencia</span><b class="num" data-id="freq">—</b><small>Hz</small></div>
    <div class="fact"><span>Desequilibrio de corriente</span><b class="num" data-id="unb">—</b><small>%</small></div>
    <div class="fact" data-more="m:tension_ab"><span>Tensiones compuestas</span><b class="num" data-id="ull">—</b><small>V</small></div>
    <div class="fact" data-more="m:reactiva_total"><span>Reactiva total</span><b class="num" data-id="qt">—</b><small>kvar</small></div>
    <div class="fact" data-more="m:fp_total" style="grid-column:span 2"><span>Factor de potencia total, penaliza por debajo de ${nf(this._th().pf_min, 2)}</span>
     <b class="num" data-id="fpt">—</b><div class="cosbar"><em data-id="fpm" style="left:0"></em></div></div>
   </div>
  </section>
  <section class="panel s6"><h2>Generación solar</h2><p class="hint" data-id="genhint">Inversor</p>
   <div class="gen"><div data-detail="solar" tabindex="0" role="button" aria-label="Generación solar, ver detalle">${this._gaugeSvg()}</div>
    <div class="kv">
     <div data-more="i:potencia_fv"><span>Potencia de los paneles</span><b class="num" data-id="pfv">—</b> <small>kW</small></div>
     <div><span>Rendimiento del inversor</span><b class="num" data-id="eff">—</b> <small>%</small></div>
     <div data-more="i:estado"><span>Estado</span><b data-id="state">—</b></div>
     <div data-more="i:limitacion"><span>Limitación</span><b data-id="derate">—</b></div>
     <div data-more="i:limite_antivertido"><span>Límite antivertido</span><b class="num" data-id="lim">—</b> <small>%</small></div>
     <div data-more="i:energia_hoy"><span>Energía hoy</span><b class="num" data-id="eday">—</b> <small>kWh</small></div>
     <div data-more="i:reactiva"><span>Reactiva entregada</span><b class="num" data-id="iq">—</b> <small data-id="iqmax">kvar</small></div>
     <div data-more="i:aislamiento"><span>Aislamiento de los paneles</span><b class="num" data-id="iso">—</b> <small>kΩ</small></div>
    </div></div>
   <div class="temps">
    ${[['ti', 'Inversor', 'temperatura_inversor'], ['tipm', 'Módulo de potencia', 'temperatura_ipm'], ['tb', 'Boost', 'temperatura_boost']].map(([id, n, k]) =>
      `<div data-more="i:${k}"><span>${n}</span><b class="num" data-id="${id}">—</b><div class="bar"><i data-id="${id}b" style="width:0"></i></div></div>`).join('')}
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
    <div data-more="i:energia_total"><span>Producción solar</span><b class="num" data-id="b_sol">—<small>kWh</small></b></div>
    <div><span>Consumo del edificio</span><b class="num" data-id="b_load">—<small>kWh</small></b></div>
    <div data-more="m:energia_importada"><span>Importado de la red</span><b class="num" data-id="b_imp">—<small>kWh</small></b></div>
    <div data-more="m:energia_exportada"><span>Vertido a la red</span><b class="num" data-id="b_exp">—<small>kWh</small></b></div>
    <div><span>CO₂ evitado</span><b class="num" data-id="b_co2">—<small>kg</small></b></div>
    <div data-id="b_savrow"><span>Ahorro estimado</span><b class="num" data-id="b_sav">—<small>€</small></b></div>
   </div></div>
  </section>
  <section class="panel s7"><div class="chart-head"><div><h2 data-id="ctitle">Últimas 24 horas</h2><p class="hint" data-id="chint">Medias de 5 minutos. Pasa el cursor por la gráfica para ver cada momento.</p></div>
   <div class="tabs" role="group" aria-label="Intervalo de la gráfica">${[['day', '24 h'], ['week', '7 días'], ['month', '30 días']].map(([k, n]) =>
     `<button data-range="${k}" aria-pressed="${k === (this._range || 'day')}">${n}</button>`).join('')}</div></div>
   <div class="chart" data-id="chart"><svg viewBox="0 0 1000 260" preserveAspectRatio="none" data-id="chartsvg" style="height:260px"></svg><div class="tip" data-id="tip"></div></div>
  </section>
 </div>
 <footer><span data-id="fresh">Esperando datos…</span><span>GrowSnif ${GSP_VERSION}, creado por <a href="${GSP_REPO}" target="_blank" rel="noopener">${GSP_AUTHOR}</a></span></footer>
 <div class="dim-bg" data-id="dimbg"></div>
 <aside class="drawer" data-id="drawer" role="dialog" aria-modal="true" aria-labelledby="gsp-dtitle" aria-hidden="true">
  <button class="x" data-id="dclose" aria-label="Cerrar">×</button>
  <h3 id="gsp-dtitle" data-id="dtitle"></h3><p class="hint" data-id="dsub"></p>
  <div class="dval" data-id="dval"></div>
  <div class="tabs" role="group" aria-label="Intervalo">${[['day', '24 h'], ['week', '7 días'], ['month', '30 días']].map(([k, n]) =>
    `<button data-drange="${k}" aria-pressed="${k === 'day'}">${n}</button>`).join('')}</div>
  <div class="dchart" data-id="dchart"></div>
  <div class="dstats" data-id="dstats"></div>
  <div class="drel" data-id="drel"></div>
  <button class="btn" data-id="dmore">Abrir en Home Assistant</button>
 </aside>
</div>`;
    this._els = {};
    this.shadowRoot.querySelectorAll('[data-id]').forEach((e) => { this._els[e.dataset.id] = e; });
    this.shadowRoot.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this._period = b.dataset.tab;
      this.shadowRoot.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      this._refreshBalance();
    }));
    this._wire();
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
      feeders += `<g data-feeder="${i}" data-detail="feeder:${i}" tabindex="0" role="button" aria-label="${esc(l.name || code)}, ver detalle"><title data-id="ft${i}">${esc(l.name || code)}</title>
       <rect class="hitbox" x="${x - 18}" y="204" width="36" height="206" rx="3"></rect>
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
  <rect class="hitbox" data-detail="grid" tabindex="0" role="button" aria-label="Red eléctrica, ver detalle" x="28" y="100" width="412" height="160" rx="6"></rect>
  <rect class="hitbox" data-detail="solar" tabindex="0" role="button" aria-label="Generación solar, ver detalle" x="28" y="262" width="412" height="112" rx="6"></rect>
  <rect class="hitbox" data-detail="load" tabindex="0" role="button" aria-label="Consumo del edificio, ver detalle" x="600" y="46" width="400" height="120" rx="6"></rect>
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
  _html(id, html) { const e = this._els[id]; if (e && e.innerHTML !== html) e.innerHTML = html; }
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
    const per = this._per(), th = this._th();
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
      } else if (med != null && med >= 1.5 && v < med * th.string_low) { cls = 'low'; low.push(k); }
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
    if (this._detail) this._detailLive();
  }

  _alarms(d) {
    const c = this._config, th = this._th(), I = (k) => this._num('i', k), M = (k) => this._num('m', k);
    const mid = (k) => this._id('m', k), iid = (k) => this._id('i', k);
    const sun = this._st('sun.sun');
    const day = sun ? sun.state === 'above_horizon' : (new Date().getHours() >= 8 && new Date().getHours() < 19);
    const al = [], chk = {};
    const mark = (k, lvl) => { const o = { ok: 0, na: -1, info: 0, warn: 1, crit: 2 }; if (!(k in chk) || o[lvl] > o[chk[k]]) chk[k] = lvl; };
    const add = (lvl, cat, key, title, text, eid) => { al.push({ lvl, cat, key, title, text, eid }); };
    ['Comunicación', 'Tensión de red', 'Frecuencia', 'Factor de potencia', 'Equilibrio de fases', 'Vertido cero',
      'Inversor', 'Strings', 'Temperaturas', 'Aislamiento'].forEach((k) => mark(k, 'ok'));

    const am = this._age('m', 'potencia_total'), ai = this._age('i', 'potencia_ac');
    if (d.pGrid == null || am > 90) add('crit', 'Comunicación', 'nometer', 'Sin datos del medidor de red', 'Revisa el canal del medidor en la pasarela RS485 y el complemento GrowSnif.', mid('potencia_total'));
    if (!d.asleep && day && (d.pSol == null || ai > 300)) add('warn', 'Comunicación', 'noinv', 'Sin datos recientes del inversor', 'El canal del inversor no recibe lecturas con el sol fuera.', iid('potencia_ac'));
    d.U.forEach((u, i) => {
      if (u != null && (u < th.v_min || u > th.v_max)) add('crit', 'Tensión de red', 'u' + i, `Tensión L${i + 1} fuera de margen: ${nf(u, 1)} V`, `El margen configurado es de ${th.v_min} a ${th.v_max} V.`, mid('tension_l' + (i + 1)));
    });
    if (d.U.every((u) => u == null)) mark('Tensión de red', 'na');
    const f = M('frecuencia');
    if (f != null && (f < th.f_min || f > th.f_max)) add('warn', 'Frecuencia', 'freq', `Frecuencia anómala: ${nf(f, 2)} Hz`, `El margen configurado es de ${nf(th.f_min, 1)} a ${nf(th.f_max, 1)} Hz.`, mid('frecuencia'));
    if (f == null) mark('Frecuencia', 'na');
    if (d.fpt != null && Math.abs(d.fpt) < th.pf_min && d.pGrid > 2000) {
      const qmax = I('reactiva_maxima');
      add('warn', 'Factor de potencia', 'pf', `cos φ de ${nf(Math.abs(d.fpt), 3)}, por debajo de ${nf(th.pf_min, 2)}`,
        `Con ${kw(M('reactiva_total'))} kvar de reactiva la factura penaliza.` + (qmax ? ` El inversor podría aportar hasta ${kw(qmax, 0)} kvar.` : ''), mid('fp_total'));
    }
    if (d.fpt == null) mark('Factor de potencia', 'na');
    if (d.unb != null && d.unb > th.unbalance_max && Math.max(...d.A.filter((v) => v != null)) > 20) {
      add('warn', 'Equilibrio de fases', 'unb', `Fases desequilibradas un ${nf(d.unb, 0)} %`, `Corrientes ${d.A.map((a) => nf(a, 0)).join(', ')} A. Conviene repartir cargas.`, mid('corriente_l1'));
    }
    if (c.zero_export && d.pGrid != null && d.pGrid < -th.export_max) {
      add('warn', 'Vertido cero', 'export', `Vertiendo ${kw(-d.pGrid)} kW a la red`, 'La limitación de vertido debería mantenerlo en cero. Revisa el datalogger.', mid('potencia_total'));
    }
    const st = this._str('i', 'estado');
    if (st === 'Fallo') add('crit', 'Inversor', 'fault', 'Inversor en fallo', `Código de fallo ${I('fallo_codigo') ?? '—'}. Consulta el manual del inversor.`, iid('fallo_codigo'));
    else if (d.asleep && day) add('crit', 'Inversor', 'noresp', 'El inversor no responde con el sol fuera', 'El datalogger pregunta y no recibe respuesta. Revisa el inversor y su cableado RS485.', iid('estado'));
    else if (d.asleep) add('info', 'Inversor', 'sleep', 'Inversor en reposo nocturno', 'Volverá a producir al amanecer.', iid('estado'));
    else if (st && st !== 'Normal' && day) add('warn', 'Inversor', 'state', `Inversor en estado ${st}`, 'No está produciendo con normalidad.', iid('estado'));
    if (!st && d.pSol == null) mark('Inversor', 'na');
    if (I('fallo_codigo') > 0 && st !== 'Fallo') add('crit', 'Inversor', 'faultcode', `Código de fallo ${I('fallo_codigo')}`, 'El inversor informa de un fallo.', iid('fallo_codigo'));
    if (I('aviso_codigo') > 0) add('warn', 'Inversor', 'warncode', `Código de aviso ${I('aviso_codigo')}`, 'El inversor informa de un aviso.', iid('aviso_codigo'));
    if (I('ventiladores_averiados') > 0) add('crit', 'Temperaturas', 'fans', `${I('ventiladores_averiados')} ventilador(es) averiado(s)`, 'El inversor perderá potencia por temperatura.', iid('ventiladores_averiados'));
    const der = this._str('i', 'limitacion');
    if (der && der !== 'Ninguna') add('info', 'Inversor', 'derate', `Potencia limitada por ${der.toLowerCase()}`, 'El inversor está recortando su producción.', iid('limitacion'));
    if (d.lim != null && d.lim < 99.5) add('info', 'Vertido cero', 'lim', `Recorte antivertido al ${nf(d.lim, 0)} %`, 'El datalogger limita la producción para no verter a la red.', iid('limite_antivertido'));
    if (d.eff != null && d.pfv > 10000 && d.eff < th.eff_min) add('warn', 'Inversor', 'eff', `Rendimiento bajo: ${nf(d.eff, 1)} %`, `Por debajo del ${nf(th.eff_min, 0)} % configurado; lo habitual a esta carga es más del 97 %.`, iid('potencia_fv'));
    if (d.dead.size) {
      add('warn', 'Strings', 'dead', `${d.dead.size} strings sin corriente: ${[...d.dead].join(', ')}`,
        'El inversor los marca como desconectados. Revisa fusibles y seccionadores, o confirma que son entradas sin uso.', iid('strings_desconectados'));
    }
    if (d.low.length) add('warn', 'Strings', 'low', `Strings con poca corriente: ${d.low.join(', ')}`, `Dan menos del ${nf(th.string_low * 100, 0)} % de la mediana. Posible suciedad, sombra o conexión defectuosa.`, iid(`string${d.low[0]}_corriente`));
    if (d.none.length) add('warn', 'Strings', 'none', `Strings sin corriente: ${d.none.join(', ')}`, 'Su MPPT produce pero ellos no. Revisa su fusible o conector.', iid(`string${d.none[0]}_corriente`));
    if (!+c.strings) mark('Strings', 'na');
    [['temperatura_inversor', 'Inversor', th.temp_warn, th.temp_crit], ['temperatura_ipm', 'Módulo de potencia', th.ipm_warn, th.ipm_crit]].forEach(([k, n, w, cr]) => {
      const t = I(k);
      if (t > cr) add('crit', 'Temperaturas', k, `${n} a ${nf(t, 1)} °C`, 'Temperatura crítica. Revisa ventilación y filtros.', iid(k));
      else if (t > w) add('warn', 'Temperaturas', k, `${n} a ${nf(t, 1)} °C`, 'Temperatura alta. Revisa ventilación.', iid(k));
    });
    if (I('temperatura_inversor') == null) mark('Temperaturas', 'na');
    const iso = I('aislamiento'), leak = I('fuga_tierra');
    if (iso != null && iso < th.iso_min && !d.asleep) add('warn', 'Aislamiento', 'iso', `Aislamiento bajo: ${nf(iso, 0)} kΩ`, 'Posible humedad o cable dañado en el campo solar.', iid('aislamiento'));
    if (leak != null && leak > th.leak_max) add('warn', 'Aislamiento', 'leak', `Corriente de fuga de ${nf(leak, 0)} mA`, 'El inversor se desconecta hacia 300 mA.', iid('fuga_tierra'));
    if (iso == null && leak == null) mark('Aislamiento', 'na');

    const acks = this._acks();
    al.forEach((a) => { a.acked = !!acks[a.key]; if (!a.acked) mark(a.cat, a.lvl); });
    const sig = JSON.stringify([al, chk, this._showAcked]);
    if (sig === this._alSig) return;
    this._alSig = sig;
    const order = { crit: 0, warn: 1, info: 2 };
    al.sort((a, b) => (a.acked - b.acked) || (order[a.lvl] - order[b.lvl]));
    this._els.checks.innerHTML = Object.entries(chk).map(([k, v]) =>
      `<div class="chk ${v === 'info' ? '' : v}"><i></i>${esc(k)}</div>`).join('');
    const open = al.filter((a) => !a.acked), acked = al.filter((a) => a.acked);
    const card = (a) => `<div class="al ${a.lvl}${a.acked ? ' acked' : ''}"><b>${esc(a.title)}</b><span>${esc(a.text)}</span>
      <div class="acts">${a.eid && this._st(a.eid) ? `<button data-more="eid:${esc(a.eid)}">Ver el dato</button>` : ''}
      ${a.lvl === 'info' ? '' : a.acked ? `<button data-unack="${a.key}">Volver a avisar</button>` : `<button data-ack="${a.key}">Entendido</button>`}</div></div>`;
    this._els.alarms.innerHTML = (open.length ? open.map(card).join('') : '<p class="empty">Sin alarmas pendientes. Todas las verificaciones están en orden.</p>')
      + (acked.length ? `<button class="linkbtn" data-showacked="1">${this._showAcked ? 'Ocultar' : 'Mostrar'} ${acked.length} reconocida${acked.length > 1 ? 's' : ''}</button>`
        + (this._showAcked ? acked.map(card).join('') : '') : '');
    const nc = open.filter((a) => a.lvl === 'crit').length, nw = open.filter((a) => a.lvl === 'warn').length;
    const s = this._els.status;
    s.className = 'status ' + (nc ? 'crit' : nw ? 'warn' : '');
    this._set('statustxt', nc ? `${nc} alarma${nc > 1 ? 's' : ''}${nw ? ` y ${nw} aviso${nw > 1 ? 's' : ''}` : ''}`
      : nw ? `${nw} aviso${nw > 1 ? 's' : ''}` : 'Todo en orden');
  }

  // ------------------------------------------------------------------ interaction

  _acks() {
    let a = {};
    try { a = JSON.parse(localStorage.getItem('growsnif-ack') || '{}'); } catch (e) { a = this._ackMem || {}; }
    const now = Date.now();
    for (const k of Object.keys(a)) if (a[k] < now) delete a[k];
    return a;
  }

  _ack(key, on) {
    const a = this._acks();
    if (on) a[key] = Date.now() + 24 * 3600 * 1000; else delete a[key];
    this._ackMem = a;
    try { localStorage.setItem('growsnif-ack', JSON.stringify(a)); } catch (e) { /* private mode: memory only */ }
    this._alSig = null;
    this._update();
  }

  _more(eid) {
    if (!eid) return;
    this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: eid }, bubbles: true, composed: true }));
  }

  _wire() {
    const root = this.shadowRoot;
    const act = (el) => {
      const ds = el.dataset;
      if (ds.ack) return this._ack(ds.ack, true);
      if (ds.unack) return this._ack(ds.unack, false);
      if (ds.showacked) { this._showAcked = !this._showAcked; this._alSig = null; return this._update(); }
      if (ds.range) {
        this._range = ds.range;
        root.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', b === el));
        return this._refreshChart();
      }
      if (ds.drange && this._detail) {
        this._detail.range = ds.drange;
        root.querySelectorAll('[data-drange]').forEach((b) => b.setAttribute('aria-pressed', b === el));
        return this._loadDetail();
      }
      if (ds.detail) { const [k, a] = ds.detail.split(':'); return this._openDetail(k, a == null ? null : +a, el); }
      if (ds.more) {
        const i = ds.more.indexOf(':'), dev = ds.more.slice(0, i), key = ds.more.slice(i + 1);
        return this._more(dev === 'eid' ? key : this._id(dev, key));
      }
    };
    const find = (path) => path.find((n) => n.dataset && (n.dataset.detail || n.dataset.more || n.dataset.ack
      || n.dataset.unack || n.dataset.showacked || n.dataset.range || n.dataset.drange));
    root.addEventListener('click', (ev) => { const el = find(ev.composedPath()); if (el) { ev.stopPropagation(); act(el); } });
    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this._detail) { ev.stopPropagation(); return this._closeDetail(); }
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const el = ev.target;
      if (el && el.getAttribute && el.getAttribute('tabindex') === '0' && el.dataset && (el.dataset.detail || el.dataset.more)) { ev.preventDefault(); act(el); }
    });
    this._els.dclose.addEventListener('click', () => this._closeDetail());
    this._els.dimbg.addEventListener('click', () => this._closeDetail());
    this._els.dmore.addEventListener('click', () => { const s = this._detail && this._detail.spec.series[0]; if (s) this._more(s.eid); });
    root.querySelectorAll('[data-more]').forEach((e) => { if (!e.hasAttribute('tabindex') && e.tagName !== 'BUTTON') e.setAttribute('tabindex', '0'); });
  }

  _detailSpec(kind, arg) {
    const c = this._config, M = (k) => this._id('m', k), I = (k) => this._id('i', k);
    const lines = c.lines || [];
    if (kind === 'feeder' && arg < lines.length) {
      const l = lines[arg];
      return { title: l.name || l.code || 'Línea', sub: l.code ? `Salida ${l.code} del embarrado general` : 'Salida del embarrado general',
        series: [{ eid: l.power, label: 'Potencia', color: 'var(--bus)' }],
        related: [l.energy && ['Energía', l.energy], l.current && ['Corriente', l.current]].filter(Boolean) };
    }
    if (kind === 'feeder' || kind === 'load') {
      return { title: 'Consumo del edificio', sub: 'Red más solar. Los datos guardados son los de la red y la solar por separado.',
        live: () => this._live && this._live.pLoad, unit: 'W',
        series: [{ eid: M('potencia_total'), label: 'Red', color: 'var(--imp)' }, { eid: I('potencia_ac'), label: 'Solar', color: 'var(--sol)' }],
        related: [['Potencia de red', M('potencia_total')], ['Potencia solar', I('potencia_ac')], ['Energía importada', M('energia_importada')]] };
    }
    if (kind === 'grid') {
      return { title: 'Red eléctrica', sub: 'Medidor de acometida. Positivo, importación; negativo, vertido.',
        series: [{ eid: M('potencia_total'), label: 'Potencia de red', color: 'var(--imp)' }, { eid: M('reactiva_total'), label: 'Reactiva', color: 'var(--q)' }],
        related: [['Energía importada', M('energia_importada')], ['Energía exportada', M('energia_exportada')], ['Factor de potencia', M('fp_total')],
          ['Frecuencia', M('frecuencia')], ['Potencia aparente', M('aparente_total')]] };
    }
    if (kind === 'solar') {
      return { title: 'Generación solar', sub: 'Inversor',
        series: [{ eid: I('potencia_ac'), label: 'Potencia AC', color: 'var(--sol)' }, { eid: I('potencia_fv'), label: 'Potencia FV', color: '#ffd88a' }],
        related: [['Estado', I('estado')], ['Energía hoy', I('energia_hoy')], ['Energía total', I('energia_total')], ['Límite antivertido', I('limite_antivertido')],
          ['Temperatura del inversor', I('temperatura_inversor')], ['Aislamiento', I('aislamiento')], ['Corriente de fuga', I('fuga_tierra')]] };
    }
    if (kind === 'phase') {
      return { title: `Fase L${arg}`, sub: 'Medidor de acometida',
        series: [{ eid: M('corriente_l' + arg), label: 'Corriente', color: PHASE_COLORS[arg - 1] }],
        related: [['Tensión', M('tension_l' + arg)], ['Potencia activa', M('potencia_l' + arg)], ['Potencia reactiva', M('reactiva_l' + arg)],
          ['Factor de potencia', M('fp_l' + arg)]] };
    }
    if (kind === 'mppt') {
      const per = this._per(), strs = [];
      for (let k = (arg - 1) * per + 1; k <= Math.min(+c.strings || 0, arg * per); k++) strs.push(['String ' + k, I(`string${k}_corriente`)]);
      return { title: `MPPT ${arg}`, sub: 'Entrada de paneles del inversor',
        series: [{ eid: I(`mppt${arg}_potencia`), label: 'Potencia', color: 'var(--sol)' }],
        related: [['Tensión', I(`mppt${arg}_tension`)], ['Corriente', I(`mppt${arg}_corriente`)], ['Energía hoy', I(`mppt${arg}_energia_hoy`)],
          ['Energía total', I(`mppt${arg}_energia_total`)], ...strs] };
    }
    if (kind === 'string') {
      return { title: `String ${arg}`, sub: `En el MPPT ${Math.ceil(arg / this._per())}`,
        series: [{ eid: I(`string${arg}_corriente`), label: 'Corriente', color: 'var(--sol)' }],
        related: [['Tensión', I(`string${arg}_tension`)], ['Corriente', I(`string${arg}_corriente`)]] };
    }
    return null;
  }

  _fmt(v, unit) {
    if (v == null || !isFinite(v)) return { v: '—', u: unit || '' };
    if (unit === 'W' && Math.abs(v) >= 1000) return { v: nf(v / 1000, 1), u: 'kW' };
    if (unit === 'var' && Math.abs(v) >= 1000) return { v: nf(v / 1000, 1), u: 'kvar' };
    if (unit === 'VA' && Math.abs(v) >= 1000) return { v: nf(v / 1000, 1), u: 'kVA' };
    return { v: nf(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2), u: unit || '' };
  }

  _openDetail(kind, arg, from) {
    const spec = this._detailSpec(kind, arg);
    if (!spec) return;
    this._detail = { spec, range: 'day', from };
    this._set('dtitle', spec.title); this._set('dsub', spec.sub || '');
    this.shadowRoot.querySelectorAll('[data-drange]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.drange === 'day'));
    this._els.dmore.style.display = spec.series[0] && this._st(spec.series[0].eid) ? '' : 'none';
    this._els.drawer.classList.add('open'); this._els.dimbg.classList.add('open');
    this._els.drawer.setAttribute('aria-hidden', 'false');
    this._els.dclose.focus();
    this._detailLive();
    this._loadDetail();
  }

  _closeDetail() {
    if (!this._detail) return;
    const from = this._detail.from;
    this._detail = null;
    this._els.drawer.classList.remove('open'); this._els.dimbg.classList.remove('open');
    this._els.drawer.setAttribute('aria-hidden', 'true');
    if (from && from.focus) from.focus();
  }

  _detailLive() {
    const spec = this._detail.spec, s0 = spec.series[0];
    const st0 = this._st(s0 && s0.eid);
    let val = spec.live ? spec.live() : st0 ? parseFloat(st0.state) : null;
    const unit = spec.unit || (st0 && st0.attributes.unit_of_measurement) || '';
    if (!spec.live && st0 && !isFinite(val)) { this._html('dval', esc(st0.state)); }
    else { const f = this._fmt(val, unit); this._html('dval', `${f.v}<small>${esc(f.u)}</small>`); }
    this._html('drel', spec.related.filter(([, eid]) => eid).map(([label, eid]) => {
      const s = this._st(eid);
      const raw = s ? parseFloat(s.state) : NaN;
      const f = s && isFinite(raw) ? this._fmt(raw, s.attributes.unit_of_measurement) : { v: s ? s.state : 'sin datos', u: '' };
      return s ? `<button data-more="eid:${esc(eid)}"><span>${esc(label)}</span><b>${esc(f.v)} ${esc(f.u)}</b></button>`
        : `<button disabled style="cursor:default;opacity:.6"><span>${esc(label)}</span><b>${esc(f.v)}</b></button>`;
    }).join('') || '<p class="empty">Sin datos relacionados.</p>');
  }

  async _loadDetail() {
    const det = this._detail; if (!det) return;
    const ranges = { day: [24, '5minute'], week: [24 * 7, 'hour'], month: [24 * 30, 'day'] };
    const [hours, period] = ranges[det.range];
    const end = new Date(), start = new Date(end - hours * 3600 * 1000);
    const ids = det.spec.series.map((s) => s.eid).filter((e) => e && this._st(e));
    this._html('dchart', '<p class="empty">Cargando historial…</p>'); this._html('dstats', '');
    let res = {};
    if (ids.length) {
      try {
        res = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: start.toISOString(), end_time: end.toISOString(),
          statistic_ids: ids, period, types: ['mean', 'min', 'max'] }) || {};
      } catch (e) { res = {}; }
    }
    if (this._detail !== det) return;
    const ts = (p) => typeof p.start === 'number' ? p.start : Date.parse(p.start);
    const series = det.spec.series.map((s) => ({ ...s, pts: (res[s.eid] || []).filter((p) => p.mean != null).map((p) => [ts(p), p.mean, p.min, p.max]) }))
      .filter((s) => s.pts.length);
    if (!series.length) { this._html('dchart', '<p class="empty">No hay estadísticas guardadas de este dato en ese intervalo.</p>'); return; }
    const all = series.flatMap((s) => s.pts.flatMap((p) => [p[1], p[2] ?? p[1], p[3] ?? p[1]]));
    let hi = Math.max(...all), lo = Math.min(...all);
    if (hi === lo) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.08; hi += pad; lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad;
    const t0 = start.getTime(), t1 = end.getTime(), W = 420, H = 170;
    const X = (t) => ((t - t0) / (t1 - t0) * W).toFixed(1), Y = (v) => (8 + (hi - v) / (hi - lo) * (H - 20)).toFixed(1);
    let svg = '';
    if (lo < 0 && hi > 0) svg += `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--rule2)" vector-effect="non-scaling-stroke"></line>`;
    series.forEach((s, i) => {
      if (i === 0 && s.pts.some((p) => p[2] != null)) {
        svg += `<path d="M${s.pts.map((p) => `${X(p[0])},${Y(p[3] ?? p[1])}`).join('L')}L${[...s.pts].reverse().map((p) => `${X(p[0])},${Y(p[2] ?? p[1])}`).join('L')}Z" fill="${s.color}" opacity=".14"></path>`;
      }
      svg += `<path d="M${s.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join('L')}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke"></path>`;
    });
    const unit = (this._st(series[0].eid) || { attributes: {} }).attributes.unit_of_measurement || '';
    const lbl = det.range === 'day' ? 'Medias de 5 minutos, con su máximo y mínimo sombreados' : det.range === 'week' ? 'Medias horarias' : 'Medias diarias';
    this._html('dchart', `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img" aria-label="Historial">${svg}</svg>
      <div class="legend" style="margin-top:6px">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}<span>${lbl}</span></div>`);
    const p0 = series[0].pts, mx = Math.max(...p0.map((p) => p[3] ?? p[1])), mn = Math.min(...p0.map((p) => p[2] ?? p[1]));
    const avg = p0.reduce((a, p) => a + p[1], 0) / p0.length;
    const box = (n, v) => { const f = this._fmt(v, unit); return `<div><span>${n}</span><b>${f.v} ${esc(f.u)}</b></div>`; };
    this._html('dstats', box('Máximo', mx) + box('Media', avg) + box('Mínimo', mn));
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
    const range = this._range || 'day';
    const conf = { day: [24, '5minute', 300000, 'Últimas 24 horas', 'Medias de 5 minutos'], week: [168, 'hour', 3600000, 'Últimos 7 días', 'Medias horarias'],
      month: [720, 'day', 86400000, 'Últimos 30 días', 'Medias diarias'] }[range];
    const end = new Date(), start = new Date(end - conf[0] * 3600 * 1000), stepMs = conf[2];
    this._set('ctitle', conf[3]); this._set('chint', `${conf[4]}. Pasa el cursor por la gráfica para ver cada momento.`);
    let res;
    try {
      res = await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: start.toISOString(),
        end_time: end.toISOString(), statistic_ids: Object.values(ids).filter(Boolean), period: conf[1], types: ['mean'] });
    } catch (e) { return; }
    if (range !== (this._range || 'day')) return;
    this._step = stepMs;
    const toMap = (arr) => {
      const m = new Map();
      (arr || []).forEach((p) => { if (p.mean != null) m.set(Math.round((typeof p.start === 'number' ? p.start : Date.parse(p.start)) / stepMs), p.mean); });
      return m;
    };
    const g = toMap(res[ids.grid]), s = toMap(res[ids.sol]);
    const keys = [...new Set([...g.keys(), ...s.keys()])].sort((a, b) => a - b);
    this._series = keys.map((k) => {
      const gv = g.get(k) ?? null, sv = s.get(k) ?? 0;
      return { t: k * stepMs, grid: gv, sol: sv, load: gv == null ? null : gv + sv };
    });
    this._drawChart(start.getTime(), end.getTime());
  }

  _drawChart(t0, t1) {
    const svg = this._els.chartsvg, S = this._series || [];
    this._chartRange = [t0, t1];
    if (!S.length) { svg.innerHTML = `<text x="500" y="130" text-anchor="middle" class="lbl">Aún no hay estadísticas en este intervalo.</text>`; return; }
    const vals = S.flatMap((p) => [p.grid, p.sol, p.load]).filter((v) => v != null);
    const hi = Math.max(1000, ...vals) * 1.1, lo = Math.min(0, ...vals) * 1.1;
    const X = (t) => (t - t0) / (t1 - t0) * 1000, Y = (v) => 20 + (hi - v) / (hi - lo) * 210;
    this._chartXY = { X, Y, lo, hi };
    const line = (k) => {
      let d = '', pen = false;
      S.forEach((p, i) => {
        const v = p[k]; const gap = i && p.t - S[i - 1].t > (this._step || 300000) * 3;
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
    const labels = [], range = this._range || 'day', ticks = [];
    if (range === 'day') {
      for (let h = Math.ceil(t0 / 3600000 / 3) * 3; h * 3600000 <= t1; h += 3) ticks.push(h * 3600000);
    } else {
      const d = new Date(t0); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
      for (; d.getTime() <= t1; d.setDate(d.getDate() + (range === 'week' ? 1 : 5))) ticks.push(d.getTime());
    }
    const tl = (t) => range === 'day' ? String(new Date(t).getHours()).padStart(2, '0') + ':00'
      : new Date(t).toLocaleDateString('es-ES', range === 'week' ? { weekday: 'short', day: 'numeric' } : { day: 'numeric', month: 'short' });
    for (const t of ticks) labels.push(`<span style="position:absolute;transform:translateX(-50%);top:2px;white-space:nowrap;left:${(X(t) / 10).toFixed(2)}%">${tl(t)}</span>`);
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
    const rg = this._range || 'day', dt = new Date(best.t);
    const when = rg === 'day' ? dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : rg === 'week' ? dt.toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : dt.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    tip.innerHTML = `<b>${when}</b><br>
      <span style="color:var(--sol)">Solar ${kw(best.sol)} kW</span><br><span style="color:var(--bus)">Consumo ${kw(best.load)} kW</span><br>
      <span style="color:var(--imp)">Red ${kw(best.grid)} kW</span>`;
    tip.style.opacity = 1;
    const left = clamp(x / 1000 * r.width + 12, 0, r.width - 150);
    tip.style.left = left + 'px'; tip.style.top = '20px';
  }
}

// ==================================================================== shared base

const EXTRA_CSS = `
.chartwrap{overflow-x:auto}.chartwrap svg{min-width:620px}
.s8{grid-column:span 8}.s4{grid-column:span 4}
@media (max-width:1180px){.s8,.s4{grid-column:span 12}}
.lead{font-size:17px;color:var(--dim);margin:0}
.huge{font-family:"Barlow Condensed",sans-serif;font-weight:600;font-size:112px;line-height:.95;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.huge small{font-size:44px;font-weight:500;margin-left:6px}
.story{font-size:17px;line-height:1.45;max-width:62ch;margin:10px 0 0;color:var(--txt)}
.story em{font-style:normal;color:var(--dim)}
.cmp{display:grid;gap:14px;align-content:center}
.cmp div span{display:flex;justify-content:space-between;font-size:15px;color:var(--dim);margin-bottom:5px}
.cmp div span b{color:var(--txt);font-weight:500;font-family:"Barlow Condensed",sans-serif;font-size:22px}
.cmp .track{height:22px;border-radius:3px;background:var(--panel2);overflow:hidden}
.cmp .track i{display:block;height:100%;transition:width 1s ease}
.split{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:32px;align-items:center}
.live{text-align:right}
.live .now{font-family:"Barlow Condensed",sans-serif;font-weight:600;font-size:40px;line-height:1;font-variant-numeric:tabular-nums}
.live span{display:block;color:var(--dim);font-size:13.5px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.tile{background:var(--panel2);border:1px solid var(--rule);border-radius:5px;padding:12px 14px}
.tile span{display:block;color:var(--dim);font-size:13.5px}
.tile b{font-family:"Barlow Condensed",sans-serif;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.1}
.tile b small{font-size:16px;font-weight:500;color:var(--dim);margin-left:4px}
.tile em{display:block;font-style:normal;color:var(--dim);font-size:13px;margin-top:2px}
.prow{display:grid;grid-template-columns:42px minmax(0,1fr) 84px;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--rule);font-size:14px}
.prow .chip{font-family:"Barlow Condensed",sans-serif;font-weight:600;color:var(--ink);text-align:center;border-radius:4px;padding:1px 0}
.prow b{font-family:"Barlow Condensed",sans-serif;font-size:19px;font-weight:500;text-align:right}
.prow small{color:var(--dim)}
.note{color:var(--dim);font-size:13.5px;max-width:90ch;margin:14px 0 0;line-height:1.45}
.forest .tree{transform-box:fill-box;transform-origin:50% 100%;animation:grow .7s cubic-bezier(.2,.8,.3,1.2) both}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.forest .tree{animation:none}.cmp .track i{transition:none}}
@media (max-width:720px){.split{grid-template-columns:1fr}.live{text-align:left}.huge{font-size:72px}.huge small{font-size:30px}}
`;

class GSBase extends HTMLElement {
  _defaults() { return {}; }

  setConfig(config) {
    if (!config || (!config.meter_prefix && !config.inverter_prefix)) throw new Error('Pon al menos meter_prefix o inverter_prefix');
    this._config = Object.assign({ entities: {} }, this._defaults(), config);
    this._built = false;
    if (this._hass) this._build();
  }

  set hass(h) {
    this._hass = h;
    if (!this._config) return;
    if (!this._built) this._build();
    if (!this._regTried) { this._regTried = true; this._loadRegistry(); }
    const now = performance.now();
    if (!this._last || now - this._last > 1500) { this._last = now; this._update(); }
  }

  getCardSize() { return 30; }
  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  connectedCallback() {
    if (!document.querySelector('link[data-gsp-font]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = FONT_HREF; l.dataset.gspFont = '1';
      document.head.appendChild(l);
    }
    this._timer = setInterval(() => this._refresh(), 10 * 60 * 1000);
    if (this._built && this._uid !== undefined) this._refresh();
  }

  disconnectedCallback() { clearInterval(this._timer); }

  async _loadRegistry() {
    try {
      const list = await this._hass.callWS({ type: 'config/entity_registry/list' });
      const map = {};
      for (const e of list) if (e.platform === 'mqtt' && e.unique_id) map[e.unique_id] = e.entity_id;
      this._uid = map;
    } catch (e) { this._uid = {}; }
    this._update();
    this._refresh();
  }

  _id(dev, key) {
    const c = this._config, ov = c.entities[(dev === 'm' ? 'meter.' : 'inverter.') + key];
    if (ov) return ov;
    const p = dev === 'm' ? c.meter_prefix : c.inverter_prefix;
    if (!p) return null;
    return (this._uid && this._uid[p + '_' + key]) || `sensor.${p}_${key}`;
  }

  _st(eid) { return eid && this._hass ? this._hass.states[eid] : undefined; }
  _val(eid) { const s = this._st(eid); if (!s) return null; const v = parseFloat(s.state); return isFinite(v) ? v : null; }
  _num(dev, key) { return this._val(this._id(dev, key)); }
  _set(id, text) { const e = this._els && this._els[id]; if (e && e.textContent !== text) e.textContent = text; }
  _html(id, html) { const e = this._els && this._els[id]; if (e && e.innerHTML !== html) e.innerHTML = html; }

  _mount(html) {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${CSS}${EXTRA_CSS}</style>${html}`;
    this._els = {};
    this.shadowRoot.querySelectorAll('[data-id]').forEach((e) => { this._els[e.dataset.id] = e; });
  }

  async _stats(ids, start, period, types) {
    ids = ids.filter((id) => id && this._st(id));
    if (!ids.length) return {};
    try {
      return await this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: start.toISOString(),
        end_time: new Date().toISOString(), statistic_ids: ids, period, types }) || {};
    } catch (e) { return {}; }
  }

  static ts(p) { return typeof p.start === 'number' ? p.start : Date.parse(p.start); }

  _livePower() {
    const pGrid = this._num('m', 'potencia_total');
    let pSol = this._num('i', 'potencia_ac');
    if (pSol == null) pSol = 0;
    const pLoad = pGrid != null ? pGrid + pSol : null;
    return { pGrid, pSol, pLoad, self: pLoad == null ? null : Math.max(0, Math.min(pSol, pLoad)) };
  }
}

const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
const monthName = (k, len = 'short') => new Date(Math.floor(k / 12), k % 12, 1).toLocaleDateString('es-ES', { month: len });
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const eur = (v, d) => v == null ? '—' : nf(v, d == null ? (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 0 : 2) : d);

function barChart(groups, opts) {
  // groups: [{label, parts:[{v, color, title}], top}] -> SVG
  const W = opts.width || 800, H = 260, padB = 28, padT = 26, n = Math.max(1, groups.length);
  const max = Math.max(1, ...groups.map((g) => g.parts.reduce((a, p) => a + (p.v || 0), 0)));
  const bw = Math.min(54, (W / n) * 0.62), gap = W / n;
  let out = '';
  groups.forEach((g, i) => {
    const cx = gap * i + gap / 2;
    let y = H - padB;
    g.parts.forEach((p) => {
      const h = (p.v || 0) / max * (H - padB - padT);
      if (h > 0) out += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${p.color}"><title>${esc(p.title || '')}</title></rect>`;
      y -= h;
    });
    if (g.top) out += `<text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" style="fill:${opts.topColor || 'var(--txt)'};font-size:15px;font-weight:600">${esc(g.top)}</text>`;
    out += `<text x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="lbl">${esc(g.label)}</text>`;
  });
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}"><line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" stroke="var(--rule2)"></line>${out}</svg></div>`;
}

// ==================================================================== ahorro

class GrowSnifAhorro extends GSBase {
  _defaults() {
    return { title: 'Ahorro solar', subtitle: 'Lo que la instalación solar te evita pagar a la compañía', price_entities: [],
      price_kwh: null, price_now_entity: null, cost_entity: null, tax_factor: 1, months: 12 };
  }

  _price(p) {
    const c = this._config, eid = (c.price_entities || [])[p - 1];
    let v = eid ? this._val(eid) : null;
    if (v != null && v > 5) v /= 1000;           // €/MWh -> €/kWh
    if (v == null && c.price_kwh != null) v = +c.price_kwh;
    return v;
  }

  _build() {
    this._built = true;
    const c = this._config;
    this._mount(`<div class="root">
 <header>
  <div><h1>${esc(c.title)}</h1><div class="sub">${esc(c.subtitle)}</div></div><div></div>
  <div class="live"><span>Ahorrando ahora mismo</span><div class="now" data-id="nowe" style="color:var(--sol)">—</div>
   <span data-id="nowp"></span></div>
 </header>
 <div class="grid">
  <section class="panel hero s12" style="padding:24px 28px"><div class="split">
   <div><p class="lead" data-id="hlead">Este mes la instalación solar te ha ahorrado</p>
    <div class="huge" data-id="hval" style="color:var(--sol)">—</div>
    <p class="story" data-id="hstory">Calculando con las estadísticas de Home Assistant…</p></div>
   <div class="cmp">
    <div><span>Sin paneles habrías pagado<b data-id="cwo">—</b></span><div class="track"><i data-id="two" style="width:0;background:var(--imp)"></i></div></div>
    <div><span>Has pagado<b data-id="cw">—</b></span><div class="track"><i data-id="tw" style="width:0;background:var(--imp);opacity:.55"></i></div></div>
    <div><span>Ahorro<b data-id="cs" style="color:var(--sol)">—</b></span><div class="track"><i data-id="ts" style="width:0;background:var(--sol)"></i></div></div>
   </div></div></section>
  <section class="panel s8"><h2>Ahorro por mes</h2><p class="hint" data-id="mhint">Lo pagado y lo que la solar te ha evitado pagar</p>
   <div data-id="mchart"></div>
   <div class="legend" style="margin-top:6px"><span><i style="background:var(--imp);opacity:.55"></i>Pagado en energía</span><span><i style="background:var(--sol)"></i>Ahorrado con la solar</span></div></section>
  <section class="panel s4"><h2>Este mes por periodo</h2><p class="hint">Energía solar consumida en cada periodo tarifario y lo que vale</p>
   <div data-id="periods"></div></section>
  <section class="panel s12"><h2>Resumen</h2><p class="hint">Ahorro y energía solar consumida en el propio edificio</p>
   <div class="tiles" data-id="tiles"></div>
   <p class="note" data-id="method"></p></section>
 </div>
 <footer><span data-id="fresh">Esperando estadísticas…</span><span>GrowSnif ${GSP_VERSION}, creado por <a href="${GSP_REPO}" target="_blank" rel="noopener">${GSP_AUTHOR}</a></span></footer>
</div>`);
  }

  _update() {
    if (!this._els) return;
    const { self } = this._livePower(), now = new Date(), p = period61(now);
    const priceNow = this._val(this._config.price_now_entity) ?? this._price(p);
    const pr = priceNow != null && priceNow > 5 ? priceNow / 1000 : priceNow;
    const eh = self != null && pr != null ? self / 1000 * pr * this._config.tax_factor : null;
    this._set('nowe', eh == null ? '—' : `${nf(eh, 2)} €/h`);
    this._set('nowp', `Periodo P${p}${pr != null ? `, ${nf(pr, 4)} €/kWh` : ''}${self != null ? `, ${kw(self)} kW solares consumidos` : ''}`);
  }

  async _refresh() {
    if (!this._hass || !this._els || this._uid === undefined) return;
    const c = this._config, now = new Date();
    const months = clamp(+c.months || 12, 1, 24);
    const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const solId = this._id('i', 'energia_total'), expId = this._id('m', 'energia_exportada');
    const [hourly, costs] = await Promise.all([
      this._stats([solId, expId], start, 'hour', ['change']),
      c.cost_entity ? this._stats([c.cost_entity], start, 'month', ['change']) : Promise.resolve({})]);
    const exp = new Map((hourly[expId] || []).map((x) => [GSBase.ts(x), x.change || 0]));
    const mk0 = monthKey(start), mkNow = monthKey(now), t0 = startOfDay(now).getTime(), tw = startOfWeek(now).getTime();
    const M = {}, P = {}, sum = { day: [0, 0], week: [0, 0], month: [0, 0], all: [0, 0] };
    let missing = false, hours = 0;
    for (const x of hourly[solId] || []) {
      const t = GSBase.ts(x), d = new Date(t);
      const selfKwh = Math.max(0, (x.change || 0) - Math.max(0, exp.get(t) || 0));
      if (!selfKwh) continue;
      hours++;
      const per = period61(d), price = this._price(per);
      if (price == null) missing = true;
      const saved = price == null ? 0 : selfKwh * price * c.tax_factor;
      const k = monthKey(d);
      M[k] = M[k] || { saved: 0, kwh: 0 }; M[k].saved += saved; M[k].kwh += selfKwh;
      if (k === mkNow) { P[per] = P[per] || { saved: 0, kwh: 0 }; P[per].saved += saved; P[per].kwh += selfKwh; sum.month[0] += saved; sum.month[1] += selfKwh; }
      if (t >= t0) { sum.day[0] += saved; sum.day[1] += selfKwh; }
      if (t >= tw) { sum.week[0] += saved; sum.week[1] += selfKwh; }
      sum.all[0] += saved; sum.all[1] += selfKwh;
    }
    const paid = {};
    for (const x of costs[c.cost_entity] || []) paid[monthKey(new Date(GSBase.ts(x)))] = x.change;

    // hero: this month
    const m = M[mkNow] || { saved: 0, kwh: 0 }, pm = paid[mkNow];
    const mname = monthName(mkNow, 'long');
    this._set('hlead', `En ${mname} la instalación solar te ha ahorrado`);
    this._html('hval', `${eur(m.saved, 0)}<small>€</small>`);
    if (pm != null) {
      const wo = pm + m.saved;
      this._els.cwo.parentElement.parentElement.style.display = '';
      this._els.cw.parentElement.parentElement.style.display = '';
      this._set('hstory', `Sin paneles habrías pagado ${eur(wo, 0)} € en energía este mes. Has pagado ${eur(pm, 0)} €, un ${nf(wo > 0 ? m.saved / wo * 100 : 0, 0)}\u00a0% menos, gracias a ${nf(m.kwh, 0)} kWh solares consumidos en el propio edificio.`);
      this._set('cwo', eur(wo, 0) + ' €'); this._set('cw', eur(pm, 0) + ' €'); this._set('cs', eur(m.saved, 0) + ' €');
      this._els.two.style.width = '100%';
      this._els.tw.style.width = (wo > 0 ? pm / wo * 100 : 0) + '%';
      this._els.ts.style.width = (wo > 0 ? m.saved / wo * 100 : 0) + '%';
    } else {
      this._set('hstory', `Son ${nf(m.kwh, 0)} kWh solares consumidos en el propio edificio, valorados al precio de cada periodo. Añade cost_entity para compararlo con lo que has pagado.`);
      this._els.cwo.parentElement.parentElement.style.display = 'none';
      this._els.cw.parentElement.parentElement.style.display = 'none';
      this._set('cs', eur(m.saved, 0) + ' €'); this._els.ts.style.width = '100%';
    }

    // monthly chart
    const groups = [];
    for (let k = mk0; k <= mkNow; k++) {
      const s = M[k] ? M[k].saved : 0, pd = paid[k];
      if (!s && pd == null && groups.length === 0) continue;   // skip leading months without data
      groups.push({ label: monthName(k) + (k === mkNow ? '*' : ''), top: s ? eur(s, 0) + ' €' : '',
        parts: [{ v: pd || 0, color: 'rgba(255,93,108,.55)', title: `Pagado ${eur(pd, 0)} €` },
          { v: s, color: 'var(--sol)', title: `Ahorrado ${eur(s, 0)} €` }] });
    }
    this._html('mchart', groups.length ? barChart(groups, { label: 'Ahorro por mes', topColor: 'var(--sol)' })
      : '<p class="empty">Aún no hay estadísticas de energía solar.</p>');
    this._set('mhint', groups.length ? `Lo pagado y lo que la solar te ha evitado pagar. * mes en curso.` : 'Sin datos todavía');

    // periods
    const pmax = Math.max(1, ...Object.values(P).map((x) => x.saved));
    let rows = '';
    for (let n = 1; n <= 6; n++) {
      const x = P[n] || { saved: 0, kwh: 0 }, price = this._price(n);
      rows += `<div class="prow"><span class="chip" style="background:${PERIOD_COLORS[n]}">P${n}</span>
        <span>${nf(x.kwh, 0)} kWh <small>${price != null ? `a ${nf(price, 4)} €/kWh` : 'sin precio'}</small>
        <div class="bar"><i style="width:${(x.saved / pmax * 100).toFixed(1)}%;background:${PERIOD_COLORS[n]}"></i></div></span>
        <b>${eur(x.saved, 0)} €</b></div>`;
    }
    this._html('periods', rows);

    // tiles
    const tile = (name, [s, k]) => `<div class="tile"><span>${name}</span><b>${eur(s)}<small>€</small></b>
      <em>${nf(k, 0)} kWh solares consumidos${k > 0 ? `, ${nf(s / k, 3)} €/kWh de media` : ''}</em></div>`;
    this._html('tiles', tile('Hoy', sum.day) + tile('Esta semana', sum.week) + tile(`En ${mname}`, sum.month)
      + tile(groups.length < months ? 'Desde que hay estadísticas' : `Últimos ${months} meses`, sum.all));
    this._set('method', `Cómo se calcula: cada hora, la energía solar consumida en el edificio (producción menos vertido) por el precio de la energía del periodo de esa hora${c.price_entities && c.price_entities.length ? ', con los precios de tu última factura' : ''}${c.tax_factor !== 1 ? `, multiplicado por ${nf(c.tax_factor, 4)} de impuestos` : ', sin impuestos'}. No incluye el término de potencia ni la reactiva, que la solar no reduce.${missing ? ' Faltan precios de algún periodo: esas horas no suman ahorro.' : ''}`);
    this._set('fresh', `Estadísticas recalculadas a las ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} con ${hours} horas de producción.`);
  }
}

// ==================================================================== impacto

class GrowSnifImpacto extends GSBase {
  _defaults() {
    return { title: 'Impacto ambiental', subtitle: 'Las emisiones que la instalación solar ha evitado a la red',
      co2_entity: null, co2_factor: 150, tree_kg: 22, car_g_km: 120, home_kwh: 3500, diesel_kg_l: 2.68 };
  }

  _build() {
    this._built = true;
    const c = this._config;
    this._scope = this._scope || 'total';
    this._mount(`<div class="root">
 <header>
  <div><h1>${esc(c.title)}</h1><div class="sub">${esc(c.subtitle)}</div></div><div></div>
  <div class="live"><span>Evitando ahora mismo</span><div class="now" data-id="nowc" style="color:var(--exp)">—</div><span data-id="nowi"></span></div>
 </header>
 <div class="grid">
  <section class="panel hero s12" style="padding:24px 28px">
   <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start">
    <div><p class="lead" data-id="hlead">Desde su puesta en marcha, la instalación ha evitado</p>
     <div class="huge" data-id="hval" style="color:var(--exp)">—</div>
     <p class="story" data-id="hstory"></p></div>
    <div class="tabs" role="group" aria-label="Periodo">${[['total', 'Total'], ['year', 'Este año'], ['month', 'Este mes']].map(([k, n]) =>
      `<button data-scope="${k}" aria-pressed="${k === this._scope}">${n}</button>`).join('')}</div>
   </div>
   <div class="forest" data-id="forest" style="margin-top:12px"></div>
   <p class="note" data-id="fnote"></p>
  </section>
  <section class="panel s12"><h2>Equivale a</h2><p class="hint" data-id="ehint">Comparaciones orientativas con el CO₂ evitado</p><div class="tiles" data-id="eq"></div></section>
  <section class="panel s12"><h2>CO₂ evitado por mes</h2><p class="hint" data-id="mhint">Este año</p><div data-id="mchart"></div></section>
 </div>
 <footer><span data-id="fresh">Esperando estadísticas…</span><span>GrowSnif ${GSP_VERSION}, creado por <a href="${GSP_REPO}" target="_blank" rel="noopener">${GSP_AUTHOR}</a></span></footer>
</div>`);
    this.shadowRoot.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
      this._scope = b.dataset.scope;
      this.shadowRoot.querySelectorAll('[data-scope]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      this._render(true);
    }));
  }

  _factor() {
    const v = this._val(this._config.co2_entity);
    return v != null && v > 0 ? v : +this._config.co2_factor;
  }

  _update() {
    if (!this._els) return;
    const { pSol } = this._livePower(), f = this._factor();
    this._set('nowc', pSol ? `${nf(pSol / 1000 * f / 1000, 1)} kg/h` : '0 kg/h');
    this._set('nowi', `${kw(pSol)} kW solares, red a ${nf(f, 0)} g de CO₂ por kWh${this._config.co2_entity && this._val(this._config.co2_entity) != null ? '' : ' (valor fijo)'}`);
    const total = this._num('i', 'energia_total');
    if (total != null && total !== this._lifetime) { this._lifetime = total; if (this._data) this._render(false); }
  }

  async _refresh() {
    if (!this._hass || !this._els || this._uid === undefined) return;
    const c = this._config, now = new Date(), start = new Date(now.getFullYear(), 0, 1);
    const solId = this._id('i', 'energia_total');
    const r = await this._stats([solId, c.co2_entity], start, 'hour', ['change', 'mean']);
    const co2 = new Map((r[c.co2_entity] || []).filter((x) => x.mean != null).map((x) => [GSBase.ts(x), x.mean]));
    const M = {}, mkNow = monthKey(now);
    let year = [0, 0], month = [0, 0], measured = 0, hours = 0;
    for (const x of r[solId] || []) {
      const kwh = Math.max(0, x.change || 0); if (!kwh) continue;
      const t = GSBase.ts(x), g = co2.has(t) ? co2.get(t) : +c.co2_factor;
      if (co2.has(t)) measured++;
      hours++;
      const kg = kwh * g / 1000, k = monthKey(new Date(t));
      M[k] = (M[k] || 0) + kg; year[0] += kg; year[1] += kwh;
      if (k === mkNow) { month[0] += kg; month[1] += kwh; }
    }
    this._data = { M, year, month, measured, hours, avg: year[1] ? year[0] * 1000 / year[1] : +c.co2_factor };
    this._render(true);
    // monthly chart
    const groups = [];
    for (let k = monthKey(start); k <= mkNow; k++) {
      if (!M[k] && !groups.length) continue;
      groups.push({ label: monthName(k) + (k === mkNow ? '*' : ''), top: M[k] ? `${nf(M[k] / 1000, 1)} t` : '',
        parts: [{ v: M[k] || 0, color: 'var(--exp)', title: `${nf(M[k] || 0, 0)} kg` }] });
    }
    this._html('mchart', groups.length ? barChart(groups, { label: 'CO₂ evitado por mes', topColor: 'var(--exp)', width: 1100 })
      : '<p class="empty">Aún no hay estadísticas de producción solar este año.</p>');
    this._set('mhint', `Este año, en toneladas. * mes en curso.${measured ? ` ${nf(measured / Math.max(1, hours) * 100, 0)} % de las horas con la intensidad real de la red.` : ''}`);
    this._set('fresh', `Estadísticas recalculadas a las ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`);
  }

  _render(animate) {
    const d = this._data, c = this._config;
    if (!d) return;
    const life = this._lifetime ?? this._num('i', 'energia_total');
    const scope = this._scope;
    let kg, kwh, lead, est;
    if (scope === 'year') { [kg, kwh] = d.year; lead = `En ${new Date().getFullYear()} la instalación ha evitado`; }
    else if (scope === 'month') { [kg, kwh] = d.month; lead = `En ${monthName(monthKey(new Date()), 'long')} la instalación ha evitado`; }
    else {
      kwh = life; kg = life != null ? life * d.avg / 1000 : null;
      lead = 'Desde su puesta en marcha, la instalación ha evitado'; est = true;
    }
    this._set('hlead', lead);
    this._html('hval', kg == null ? '—' : kg >= 1000 ? `${nf(kg / 1000, 1)}<small>t de CO₂</small>` : `${nf(kg, 0)}<small>kg de CO₂</small>`);
    const trees = kg == null ? 0 : kg / c.tree_kg;
    this._set('hstory', kg == null ? '' : `Con ${nf(kwh, 0)} kWh de energía solar que la red no ha tenido que generar. Es el CO₂ que absorben ${nf(trees, 0)} árboles durante un año.`);
    // forest
    const units = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const unit = units.find((u) => trees / u <= 96) || 10000;
    const count = Math.round(trees / unit);
    const cols = 24, cw = 36, rh = 46, rows = Math.max(1, Math.ceil(count / cols));
    let g = '';
    for (let i = 0; i < count; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const rnd = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      const s = 0.82 + rnd * 0.3, x = col * cw + cw / 2 + (rnd - 0.5) * 6, y = row * rh + rh;
      const col1 = rnd > 0.5 ? '#4ef0b0' : '#2fc98f', delay = animate ? (i * 9) : 0;
      const shape = rnd > 0.38
        ? `<path d="M0,0 L-11,-14 L-5,-14 L-13,-26 L-6,-26 L0,-38 L6,-26 L13,-26 L5,-14 L11,-14 Z" fill="${col1}"></path>`
        : `<circle cx="0" cy="-22" r="12" fill="${col1}"></circle>`;
      g += `<g transform="translate(${x.toFixed(1)},${y}) scale(${s.toFixed(2)})"><g class="tree" style="animation-delay:${delay}ms${animate ? '' : ';animation:none'}">
        <rect x="-1.5" y="-8" width="3" height="8" fill="#7d93ab"></rect>${shape}</g></g>`;
    }
    this._html('forest', count ? `<svg viewBox="0 0 ${cols * cw} ${rows * rh + 6}" role="img" aria-label="${nf(trees, 0)} árboles"><line x1="0" x2="${cols * cw}" y1="${rows * rh + 1}" y2="${rows * rh + 1}" stroke="var(--rule2)"></line>${g}</svg>`
      : '<p class="empty">Todavía no hay producción en este periodo.</p>');
    this._set('fnote', count ? `Cada árbol del dibujo representa ${unit === 1 ? 'un árbol' : nf(unit, 0) + ' árboles'}, a ${c.tree_kg} kg de CO₂ absorbidos por árbol y año.${est ? ` El total usa ${nf(d.avg, 0)} g de CO₂ por kWh de la red${d.measured ? ', la media real de este año' : ', un valor fijo'}.` : ''}` : '');
    // equivalences
    const tile = (t, v, u, sub) => `<div class="tile"><span>${t}</span><b>${v}<small>${u}</small></b><em>${sub}</em></div>`;
    const km = kg == null ? null : kg * 1000 / c.car_g_km;
    this._html('eq', kg == null ? '' :
      tile('Kilómetros en coche', nf(km, 0), 'km', `${nf(km / 40075, 1)} vueltas a la Tierra, a ${c.car_g_km} g/km`)
      + tile('Gasóleo sin quemar', nf(kg / c.diesel_kg_l, 0), 'litros', `a ${nf(c.diesel_kg_l, 2)} kg de CO₂ por litro`)
      + tile('Consumo de hogares', nf(kwh / c.home_kwh, 0), 'hogares', `durante un año, a ${nf(c.home_kwh, 0)} kWh por hogar`)
      + tile('Árboles', nf(trees, 0), 'árboles', `absorbiendo CO₂ durante un año, a ${c.tree_kg} kg cada uno`));
  }
}

for (const [tag, cls, name, desc] of [
  ['growsnif-ahorro', GrowSnifAhorro, 'GrowSnif · Ahorro solar', 'Ahorro hora a hora con los precios de cada periodo 6.1TD.'],
  ['growsnif-impacto', GrowSnifImpacto, 'GrowSnif · Impacto ambiental', 'CO₂ evitado, árboles y equivalencias.']]) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === tag)) window.customCards.push({ type: tag, name, description: desc, preview: false });
}

if (!customElements.get('growsnif-panel')) customElements.define('growsnif-panel', GrowSnifPanel);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'growsnif-panel')) {
  window.customCards.push({ type: 'growsnif-panel', name: 'GrowSnif · Centro de control',
    description: 'Esquema unifilar, red trifásica, generación solar, campo FV, alarmas y balance.', preview: false });
}
console.info('%c GrowSnif panel %c ' + GSP_VERSION + ' · creado por ' + GSP_AUTHOR + ' ', 'background:#5fd4ff;color:#0c1b2b;font-weight:600', 'background:#12263b;color:#e3edf7');
