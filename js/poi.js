/* ═══ Eas_EV — poi.js ═══
   Module 43/44 core:
   • Universal POI popup (stations + every amenity) with consistent actions
   • Get Route = temporary preview (no trip created)
   • Add To Trip / Save Place
   • Universal toggle helpers + independent layer state
   • Session persistence (localStorage)                               */

const POI = {

  routePreview: null,          // {layer, markers[]}  temporary route only
  savedPlaces: [],

  /* ---------- universal popup HTML for ANY point ---------- */
  /* item = { id, name, kind, subtitle, lat, lon, rows:[[label,val,href?]], type? } */
  popupHTML(item, opts = {}) {
    const rowsHtml = (item.rows || []).map(r => {
      const [label, val, href] = r;
      if (val === undefined || val === null || val === '') return '';
      if (href) return `<div class="row">${label}: <a href="${U.esc(href)}" target="_blank" rel="noopener"><b>${U.esc(val)}</b></a></div>`;
      return `<div class="row">${label}: <b>${U.esc(val)}</b></div>`;
    }).join('');

    const tel = item.phone ? `<a href="tel:${U.esc(item.phone)}">📞 Call</a>` : '';
    const web = item.website ? `<a href="${U.esc(item.website)}" target="_blank" rel="noopener">🔗 Website</a>` : '';
    const mail = item.email ? `<a href="mailto:${U.esc(item.email)}">✉️ Email</a>` : '';
    const contact = (tel || web || mail) ? `<div class="pop-contact">${tel}${web}${mail}</div>` : '';

    const amenHtml = (item.amenities && item.amenities.length)
      ? `<div class="sec">On-site amenities</div><div class="amen-chips">${item.amenities.map(a=>`<span>${U.esc(a)}</span>`).join('')}</div>` : '';

    return `<div class="pop">
      <h3>${U.esc(item.name)}</h3>
      <div class="op">${U.esc(item.subtitle || item.kind || '')}</div>
      ${rowsHtml}
      ${amenHtml}
      ${contact}
      ${opts.noActions?'':`<div class="pop-btns">
        <button data-act="route"  data-pid="${item.id}">Get route</button>
        <button data-act="add"    data-pid="${item.id}">Add to trip</button>
        <button data-act="save"   data-pid="${item.id}">Save</button>
        <button data-act="nearby" data-pid="${item.id}">Get nearby</button>
      </div>`}</div>`;
  },

  /* bind the 4 universal actions after popup opens */
  bindPopup(item) {
    const q = a => document.querySelector(`.pop-btns button[data-act="${a}"][data-pid="${CSS.escape(item.id)}"]`);
    const r = q('route');  if (r) r.onclick = () => this.getRoutePreview(item);
    const a = q('add');    if (a) a.onclick = () => { Trip.addPOI(item); U.toast(`Added <b>${U.esc(item.name)}</b> to trip builder`); };
    const s = q('save');   if (s) s.onclick = () => this.savePlace(item);
    const nb = q('nearby'); if (nb) nb.onclick = () => {
      MapMod.dropPin(item.lat, item.lon);
      document.getElementById('apRadius').value = 3;
      document.getElementById('apRadVal').textContent = '3 km';
      MapMod.updatePinRadius(3);
      MapMod.scanArea();
      U.toast('Pick a radius, then see nearby places for this point');
    };
  },

  /* ---------- GET ROUTE = temporary preview, NO trip ---------- */
  async getRoutePreview(item) {
    this.clearRoutePreview();
    const from = MapMod.userPos;
    try {
      const url = `${CONFIG.OSRM}/route/v1/driving/${from.lon},${from.lat};${item.lon},${item.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.routes?.length) throw new Error('no route');
      const route = data.routes[0];
      const layer = L.geoJSON(route.geometry, { style:{ color:'#4f8ef7', weight:5, opacity:.8, dashArray:'1' } }).addTo(MapMod.map);
      const m1 = L.circleMarker([from.lat, from.lon], { radius:7, color:'#fff', weight:2, fillColor:'#2dd4a7', fillOpacity:1 }).addTo(MapMod.map);
      const m2 = L.circleMarker([item.lat, item.lon], { radius:8, color:'#fff', weight:2, fillColor:'#4f8ef7', fillOpacity:1 }).addTo(MapMod.map);
      this.routePreview = { layer, markers:[m1, m2] };
      MapMod.map.fitBounds(layer.getBounds(), { padding:[60,60] });
      const km = (route.distance/1000).toFixed(1), min = Math.round(route.duration/60);
      U.toast(`Route preview → <b>${U.esc(item.name)}</b> · ${km} km · ~${min} min &nbsp; <span style="opacity:.7">(preview only — use “Add to trip” to keep it)</span>`, 5000);
      Toggle.set('route', true);
    } catch(e) {
      U.toast('⚠ Route preview failed (OSRM unreachable)');
    }
  },

  clearRoutePreview() {
    if (this.routePreview) {
      MapMod.map.removeLayer(this.routePreview.layer);
      this.routePreview.markers.forEach(m => MapMod.map.removeLayer(m));
      this.routePreview = null;
    }
  },

  /* ---------- SAVE PLACE ---------- */
  savePlace(item) {
    if (this.savedPlaces.find(p => p.id === item.id)) { U.toast('Already saved'); return; }
    this.savedPlaces.push({ id:item.id, name:item.name, kind:item.kind, lat:item.lat, lon:item.lon });
    Store.save();
    U.toast(`💾 Saved <b>${U.esc(item.name)}</b>`);
  },

  /* ---------- DETAILS (expand into a side card via toast-rich) ---------- */
  showDetails(item) {
    const rows = (item.rows || []).filter(r => r[1]).map(r => `${r[0]}: ${r[1]}`).join('  ·  ');
    U.toast(`<b>${U.esc(item.name)}</b><br><span style="opacity:.8;font-size:11px">${U.esc(rows || item.subtitle || '')}</span>`, 6000);
  },
};

/* ═══ UNIVERSAL TOGGLE SYSTEM ═══
   Every tool is on/off. Independent state — turning one off never touches others. */
const Toggle = {
  state: {
    radius: false, route: false, pin: false,
    stations: true, amenities: true,
  },

  set(key, val) {
    this.state[key] = val;
    this.reflect(key);
    Store.save();
  },

  toggle(key) {
    this.set(key, !this.state[key]);
    return this.state[key];
  },

  reflect(key) {
    switch(key) {
      case 'route':
        if (!this.state.route) { POI.clearRoutePreview(); Trip.clearRoute(); }
        break;
      case 'radius':
        document.getElementById('pinModeBtn')?.classList.toggle('active', false);
        if (!this.state.radius) MapMod.clearBoundary();
        break;
      case 'stations': {
        const on = this.state.stations;
        const ov = document.getElementById('ov-stations'); if (ov) ov.checked = on;
        if (on) MapMod.map.addLayer(MapMod.stationCluster);
        else MapMod.map.removeLayer(MapMod.stationCluster);
        break;
      }
      case 'amenities': {
        const on = this.state.amenities;
        const ov = document.getElementById('ov-amenities'); if (ov) ov.checked = on;
        Object.values(Amen.layers).forEach(l => on ? MapMod.map.addLayer(l) : MapMod.map.removeLayer(l));
        break;
      }
    }
  },
};

/* ═══ SESSION PERSISTENCE ═══ */
const Store = {
  KEY: 'easev_session_v1',

  save() {
    try {
      const filters = {};
      document.querySelectorAll('#dp-stations [data-type]').forEach(cb => filters[cb.dataset.type] = cb.checked);
      const amSel = [...document.querySelectorAll('[data-amcat]:checked')].map(cb => cb.dataset.amcat);
      const data = {
        ctx: MapMod.ctx,
        center: MapMod.map ? [MapMod.map.getCenter().lat, MapMod.map.getCenter().lng] : null,
        zoom: MapMod.map ? MapMod.map.getZoom() : null,
        base: MapMod.currentBaseName,
        filters, amSel,
        toggles: Toggle.state,
        savedPlaces: POI.savedPlaces,
        savedTrips: Trip.saved,
      };
      localStorage.setItem(this.KEY, JSON.stringify(data));
    } catch(e) {}
  },

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); }
    catch(e) { return null; }
  },

  restore() {
    const d = this.load();
    if (!d) return false;
    try {
      if (d.base) MapMod.setBase(d.base);
      if (d.filters) document.querySelectorAll('#dp-stations [data-type]').forEach(cb => {
        if (d.filters[cb.dataset.type] !== undefined) cb.checked = d.filters[cb.dataset.type];
      });
      if (d.amSel) d.amSel.forEach(k => { const cb = document.querySelector(`[data-amcat="${k}"]`); if (cb) cb.checked = true; });
      if (d.toggles) Toggle.state = { ...Toggle.state, ...d.toggles };
      if (d.savedPlaces) POI.savedPlaces = d.savedPlaces;
      if (d.savedTrips) Trip.saved = d.savedTrips;
      if (d.ctx) MapMod.ctx = d.ctx;
      if (d.center && d.zoom) MapMod.map.setView(d.center, d.zoom);
      return true;
    } catch(e) { return false; }
  },

  reset() {
    localStorage.removeItem(this.KEY);
  },
};
