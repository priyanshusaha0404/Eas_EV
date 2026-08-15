/* ═══ Eas_EV — map.js ═══
   Map · base layers · India-wide search (boundary/radius) ·
   CUMULATIVE radius (nothing disappears) · stations · pin scan · scale bar */

const MapMod = {
  map:null, baseLayers:{}, currentBase:null,
  userPos:{ lat:22.5726, lon:88.3639 }, userMarker:null,

  ctx:{ mode:'radius', center:{lat:22.5726,lon:88.3639}, radiusKm:10, bbox:null, polygon:null, label:'Kolkata' },

  boundaryLayer:null, radiusCircle:null,
  masterStations:[],          // full local dataset (loaded once from data/stations.json)
  datasetLoaded:false,
  stationStore:new Map(),     // id -> station (cumulative, never cleared on radius grow)
  allStations:[],             // what is currently visible (within radius / boundary)
  stationCluster:null,
  heatLayers:{},
  pin:null, pinCircle:null, pinPos:null, pinMode:false,

  init() {
    this.map = L.map('map', { zoomControl:false, minZoom:4 })
      .setView(CONFIG.INDIA_CENTER, CONFIG.INDIA_ZOOM);
    L.control.zoom({ position:'bottomright' }).addTo(this.map);
    L.control.scale({ position:'bottomleft', imperial:false, maxWidth:160 }).addTo(this.map);

    this.baseLayers = {
      dark:     L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© OSM © CARTO',maxZoom:19}),
      light:    L.tileLayer('https://{s}.basemaps.cartocdn.com/voyager/{z}/{x}/{y}{r}.png',{attribution:'© OSM © CARTO',maxZoom:19}),
      streets:  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}),
      satellite:L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{attribution:'© Esri',maxZoom:19}),
      terrain:  L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{attribution:'© OpenTopoMap',maxZoom:17}),
    };
    /* auto dark/light by system */
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    this.setBase(prefersLight ? 'light' : 'dark');

    this.stationCluster = L.markerClusterGroup({ maxClusterRadius:52, showCoverageOnHover:false, chunkedLoading:true, chunkInterval:80 });
    this.map.addLayer(this.stationCluster);

    this.map.on('click', e => { if (this.pinMode) this.dropPin(e.latlng.lat, e.latlng.lng); });
    this.map.on('contextmenu', e => this.dropPin(e.latlng.lat, e.latlng.lng));
  },

  /* ── basemap-adaptive boundary palette ──
     every basemap gets its own high-visibility combination for
     country / state / district / sub-district / search boundary */
  BND_THEME:{
    dark:      { india:'#2dd4a7', states:'#39ff9e', districts:'#c58bff', subdistricts:'#ffb347', search:'#2dd4a7', wBoost:0   },
    light:     { india:'#0d9463', states:'#0b5cad', districts:'#7c3aed', subdistricts:'#c2410c', search:'#0d9463', wBoost:0.2 },
    streets:   { india:'#047857', states:'#1d4ed8', districts:'#86198f', subdistricts:'#b91c1c', search:'#047857', wBoost:0.4 },
    satellite: { india:'#00e5ff', states:'#00e5ff', districts:'#ffee58', subdistricts:'#ff80ab', search:'#7CFC00', wBoost:0.6 },
    terrain:   { india:'#0d2c9e', states:'#0d2c9e', districts:'#8e24aa', subdistricts:'#c62828', search:'#00513a', wBoost:0.6 },
  },
  bndTheme(){ return this.BND_THEME[this.currentBaseName] || this.BND_THEME.dark; },
  /* restyle every boundary layer that is on, whenever the basemap changes */
  refreshBoundaryTheme(){
    const t=this.bndTheme();
    if (this._indiaOutline) this._indiaOutline.setStyle({ color:t.india });
    if (this.boundaryLayer) this.boundaryLayer.setStyle({ color:t.search, fillColor:t.search });
    if (this.radiusCircle)  this.radiusCircle.setStyle({ color:t.search, fillColor:t.search });
    Object.entries(this._bndLayers||{}).forEach(([which,layer])=>{
      const weight=(which==='states'?1.5:which==='districts'?0.9:0.6)+t.wBoost;
      layer.setStyle({ color:t[which], weight });
    });
  },

  /* official GADM state/district boundary overlays */
  _bndLayers:{},
  async toggleBoundaryLayer(which, on){
    if (on){
      const g = await Boundaries.load(which);
      if (!g){
        U.toast(which==='subdistricts'
          ? '⚠ Sub-district boundaries need <b>data/boundaries/subdistricts.geojson</b> — see GUIDE.md §2 to add the Survey of India file'
          : 'Boundary data unavailable', 5000);
        document.getElementById('bnd-'+which) && (document.getElementById('bnd-'+which).checked=false);
        return;
      }
      const t=this.bndTheme();
      const color = t[which];
      const weight = (which==='states'?1.5:which==='districts'?0.9:0.6)+t.wBoost;
      let data=g;
      const c=this.ctx;
      if (c && c.mode==='boundary' && c.bbox){          /* clip to the selected area */
        const [s0,w0,n0,e0]=c.bbox;
        const feats=g.features.filter(f=>{
          const b=Boundaries.featureBounds(f);
          if (b[2]<s0||b[0]>n0||b[3]<w0||b[1]>e0) return false;
          const cLat=(b[0]+b[2])/2, cLon=(b[1]+b[3])/2;   /* centroid must be inside */
          return c.polygon ? U.pointInGeoJSON(cLon,cLat,c.polygon) : true;
        });
        data={type:'FeatureCollection',features:feats};
      }
      this._bndLayers[which] = L.geoJSON(data,{ style:{color,weight,fill:false,opacity:.85}, interactive:false }).addTo(this.map);
      U.toast(`${which==='states'?'State':which==='districts'?'District':'Sub-district'} boundaries on`);
    } else if (this._bndLayers[which]){
      this.map.removeLayer(this._bndLayers[which]); delete this._bndLayers[which];
    }
  },

  setBase(name) {
    if (this.currentBase) this.map.removeLayer(this.currentBase);
    this.currentBase = this.baseLayers[name];
    this.currentBaseName = name;
    this.currentBase.addTo(this.map);
    document.querySelectorAll('.base-card').forEach(b => b.classList.toggle('active', b.dataset.base===name));
    /* adaptive brand: white logo chip on dark basemaps, black chip on light basemaps */
    const lightBases = ['light','streets','terrain'];
    document.body.classList.toggle('base-light', lightBases.includes(name));
    this.refreshBoundaryTheme();
    if (window.Store) Store.save();
  },

  /* ───── EXCLUSIVE DISPLAY — only one analysis visible at a time ─────
     kinds: 'search' | 'trip' | 'pin' | 'heat'
     Starting one clears the visual layers of the others (data stays cached). */
  exclusive(kind){
    if (kind!=='trip'){
      POI.clearRoutePreview && POI.clearRoutePreview();
      Trip.clearRoute && Trip.clearRoute();
    }
    if (kind!=='search'){
      this.clearBoundary();
    }
    if (kind==='trip'){ this.hideStations(); } else { this.showStations(); }
    if (kind!=='pin'){
      if (this.pin){ this.map.removeLayer(this.pin); this.pin=null; }
      if (this.pinCircle){ this.map.removeLayer(this.pinCircle); this.pinCircle=null; }
      this.pinPos=null;
      document.getElementById('areaPanel')?.classList.remove('show');
    }
    if (kind!=='heat'){
      Object.values(this.heatLayers||{}).forEach(l=>this.map.removeLayer(l));
      this.heatLayers={};
      document.querySelectorAll('[data-heat]').forEach(cb=>cb.checked=false);
    }
  },

  /* ───── RESET MAP (Module 43 #3) — clears everything without page refresh ───── */
  resetMap() {
    POI.clearRoutePreview();
    Trip.clearRoute();
    Trip.clearChain && Trip.clearChain();
    Trip.exitNavigation && Trip.exitNavigation();        // exit nav mode
    if (document.body.classList.contains('view-3d')) Trip.toggle3D && Trip.toggle3D();  // exit 3D
    Amen.clearAll();
    this.clearBoundary();
    /* corridor markers + selected-area context */
    (Intel._corridorMarkers||[]).forEach(m=>this.map.removeLayer(m)); Intel._corridorMarkers=[];
    if (this.pin) { this.map.removeLayer(this.pin); this.pin=null; }
    if (this.pinCircle) { this.map.removeLayer(this.pinCircle); this.pinCircle=null; }
    this.pinPos=null; this.pinMode=false;
    
    document.getElementById('areaPanel')?.classList.remove('show');
    Object.values(this.heatLayers||{}).forEach(l=>this.map.removeLayer(l));
    this.heatLayers={};
    document.querySelectorAll('[data-heat]').forEach(cb=>cb.checked=false);
    /* reset selected area to neutral → back to the all-India clustered view */
    this.stationStore.clear(); this.allStations=[];
    this.ctx={mode:'none',center:null,radiusKm:10,bbox:null,polygon:null,label:'',level:null};
    this.updateLayersPanel();
    /* reset filters to default */
    document.querySelectorAll('#dp-stations [data-type]').forEach(cb=>cb.checked=true);
    document.querySelectorAll('#dp-stations [data-speed]').forEach(cb=>cb.checked=false);
    if (!this.map.hasLayer(this.stationCluster)) this.map.addLayer(this.stationCluster);
    this.showAll();
    Toggle.state={ radius:false, route:false, pin:false, stations:true, amenities:true };
    this.map.setView(CONFIG.INDIA_CENTER, CONFIG.INDIA_ZOOM);
    Store.save();
    U.toast('Map reset — back to the all-India view');
  },

  /* ───── SEARCH ───── */
  async suggest(q) {
    const r = await fetch(`${CONFIG.NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6&countrycodes=in&polygon_geojson=1&addressdetails=1`);
    return r.json();
  },
  classifyResult(r) {
    const t = (r.addresstype||r.type||'').toLowerCase();
    const admin = ['state','county','district','state_district','municipality','subdistrict','region','province','administrative','country'];
    const poly = r.geojson && (r.geojson.type==='Polygon'||r.geojson.type==='MultiPolygon');
    if (admin.includes(t) && poly) return 'area';
    if (['city','town','village','suburb'].includes(t) && poly && r.place_rank<=16) return 'area';
    return 'point';
  },
  labelType(r){ const t=(r.addresstype||r.type||'').replace(/_/g,' '); return t.charAt(0).toUpperCase()+t.slice(1); },

  async applyResult(r) {
    const lat=+r.lat, lon=+r.lon, kind=this.classifyResult(r);
    this.exclusive('search');         // one thing on the map at a time
    this.stationStore.clear();        // new place → fresh dataset
    if (kind==='area') {
      const bb = r.boundingbox.map(Number);
      /* prefer the official GADM boundary over OSM's polygon when we can match it */
      let polygon = r.geojson, bbox = [bb[0],bb[2],bb[1],bb[3]], label = r.display_name.split(',')[0], level='city';
      const t=(r.addresstype||r.type||'').toLowerCase();
      if (t==='country') level='country';
      else if (['state','region','province'].includes(t)) level='state';
      else if (['state_district','county','district','municipality'].includes(t)) level='district';
      else if (['subdistrict','sub_district','tehsil','taluk','block'].includes(t)) level='subdistrict';
      try {
        const official = await Boundaries.resolve(r);
        if (official) {
          polygon = official.geometry;
          const ob = Boundaries.featureBounds(official);   // [minLat,minLon,maxLat,maxLon]
          bbox = ob;
          label = official.properties.name || label;
          if (official.properties.district) level='subdistrict';
          else if (official.properties.state) level='district';
          else if (official.properties.name && !official.properties.state) level = t==='country'?'country':'state';
        }
      } catch(e){}
      this.ctx = { mode:'boundary', center:{lat,lon}, radiusKm:null, bbox, polygon, label, level };
      this.updateLayersPanel();
      const bt=this.bndTheme();
      this.boundaryLayer = L.geoJSON(polygon,{ style:{color:bt.search,weight:2.5,fillColor:bt.search,fillOpacity:.05,dashArray:'6 4'} }).addTo(this.map);
      this.map.fitBounds(this.boundaryLayer.getBounds(),{padding:[40,40]});
      U.toast(`Boundary: <b>${U.esc(label)}</b> — loading everything inside…`);
      Agent.nudge && Agent.nudge('search', label);
    } else {
      const radius = +document.getElementById('radiusSlider').value;
      this.ctx = { mode:'radius', center:{lat,lon}, radiusKm:radius, bbox:null, polygon:null, label:r.display_name.split(',')[0], level:'city' };
      this.updateLayersPanel();
      this.userPos = { lat, lon };
      this.setUserMarker(lat,lon);
      this.drawRadiusCircle(lat,lon,radius);
      this.map.setView([lat,lon], radius>20?10:12);
      U.toast(`<b>${U.esc(this.ctx.label)}</b> — everything within ${radius} km`);
    }
    await this.loadStations();
    Amen.reloadActive();
    DL.refreshList();
  },

  drawRadiusCircle(lat,lon,km){
    if (this.radiusCircle) this.map.removeLayer(this.radiusCircle);
    const bt=this.bndTheme();
    this.radiusCircle = L.circle([lat,lon],{ radius:km*1000, color:bt.search, weight:1.5, fillColor:bt.search, fillOpacity:.05, dashArray:'5 5' }).addTo(this.map);
  },
  clearBoundary(){
    if (this.boundaryLayer){ this.map.removeLayer(this.boundaryLayer); this.boundaryLayer=null; }
    if (this.radiusCircle){ this.map.removeLayer(this.radiusCircle); this.radiusCircle=null; }
  },
  /* normal flat marker — a coloured round disc with a WHITE centre disc that
     holds the symbol (points 6 + 8). Colour is the ring/outer; centre is white. */
  pin3D(emoji, color, size=32){
    const s=size, h=Math.round(s*1.32);
    return L.divIcon({ className:'', iconSize:[s,h], iconAnchor:[s/2,h-2], popupAnchor:[0,-h+4],
      html:`<div class="mkr" style="--pin:${color};--sz:${s}px"><span class="mkr-sym">${emoji}</span></div>` });
  },
  setUserMarker(lat,lon){
    if (this.userMarker) this.map.removeLayer(this.userMarker);
    this.userMarker = L.marker([lat,lon],{ icon:this.pin3D('📍','#ff2ea6',40), zIndexOffset:900 })
      .addTo(this.map).bindPopup('<b>Your position</b>');
  },

  /* ───── load master dataset once (Module 44 #6 — local DB only) ───── */
  async loadDataset(){
    if (this.datasetLoaded) return;
    try {
      const res = await fetch('data/stations.json');
      if (!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('stations.json is not an array');
      this.masterStations = data;
      this.datasetLoaded = true;
    } catch(e){
      console.error('loadDataset failed:', e);
      U.toast('Could not load data/stations.json — run via the backend or Live Server (not file://)', 6000);
      this.masterStations = [];      // always an array — nothing downstream can crash
      this.datasetLoaded = true;
    }
  },

  /* ───── silent hot-swap: re-fetch stations.json after a background refresh
     (called by the app.js data-watcher when /api/data/status version changes).
     The user sees nothing — the same layers simply carry fresher records. ───── */
  async reloadDataset(){
    try{
      const res = await fetch('data/stations.json?v='+Date.now(), {cache:'no-store'});
      if (!res.ok) return false;
      const data = await res.json();
      if (!Array.isArray(data) || data.length < 1000) return false;   // sanity floor
      this.masterStations = data;
      this.datasetLoaded = true;
      /* refresh every record already sitting in the cumulative store */
      const byId = new Map(data.map(s=>[s.id, s]));
      [...this.stationStore.keys()].forEach(id=>{ const f=byId.get(id); if (f) this.stationStore.set(id, f); });
      await this.loadStations();          // re-scope + silently re-render
      return true;
    }catch(e){ return false; }
  },

  /* ───── STATIONS (cumulative, from local dataset) ───── */
  async loadStations() {
    await this.loadDataset();
    const c = this.ctx;
    if (!c || c.mode==='none' || !c.center) { this.refreshVisible(); return; }
    let inScope;
    if (c.mode==='boundary' && c.bbox){
      const [s,w,n,e]=c.bbox;
      inScope = this.masterStations.filter(st => st.lat>=s && st.lat<=n && st.lon>=w && st.lon<=e);
      if (c.polygon) inScope = inScope.filter(st => U.pointInGeoJSON(st.lon, st.lat, c.polygon));
    } else {
      inScope = this.masterStations.filter(st => U.haversine(c.center.lat, c.center.lon, st.lat, st.lon) <= (c.radiusKm||10) + 0.05);
    }
    /* merge into cumulative store — nothing already loaded is removed */
    inScope.forEach(s => this.stationStore.set(s.id, s));
    this.refreshVisible();
    document.getElementById('stationNote').innerHTML =
      `<b>${this.allStations.length}</b> stations in <b>${U.esc(c.label)}</b> · dataset total <b>${this.masterStations.length}</b>`;
  },

  /* recompute which stored stations are currently visible (radius superset) */
  refreshVisible() {
    const c = this.ctx;
    let vis = [...this.stationStore.values()];
    if (c.mode==='boundary' && c.polygon)
      vis = vis.filter(s => U.pointInGeoJSON(s.lon, s.lat, c.polygon));
    else if (c.mode==='radius')
      vis = vis.filter(s => U.haversine(c.center.lat, c.center.lon, s.lat, s.lon) <= c.radiusKm + 0.05);
    this.allStations = vis;
    this.renderStations();
  },

  renderStations(){
    const active={}; document.querySelectorAll('#dp-stations [data-type]').forEach(cb=>active[cb.dataset.type]=cb.checked);
    const speed={};  document.querySelectorAll('#dp-stations [data-speed]').forEach(cb=>speed[cb.dataset.speed]=cb.checked);
    const speedOn = speed.fast || speed.ultra;   // any speed box ticked → restrict
    this.stationCluster.clearLayers();
    const counts={AC:0,DC:0,AC_DC:0,SWAP:0,fast:0,ultra:0};
    const layers=[];
    this.allStations.forEach(s=>{
      if (counts[s.type]!==undefined) counts[s.type]++;
      if (s.fast) counts.fast++; if (s.ultra) counts.ultra++;
      if (!active[s.type]) return;
      if (speedOn && !((speed.fast&&s.fast)||(speed.ultra&&s.ultra))) return;
      const m=L.circleMarker([s.lat,s.lon],{ radius:8,color:'#0a0f1e',weight:1.5,
        fillColor:CONFIG.TYPE_COLORS[s.type]||'#2dd4a7',fillOpacity:.94 });
      m.on('click',()=>{
        const item=this.stationToPOI(s);
        m.bindPopup(POI.popupHTML(item),{ minWidth:250, maxWidth:300 }).openPopup();
        setTimeout(()=>POI.bindPopup(item),0);
      });
      layers.push(m);
    });
    this.stationCluster.addLayers(layers);      // chunked — smooth even with 21k markers
    Object.keys(counts).forEach(t=>{ const el=document.getElementById('cnt-'+t); if(el) el.textContent=counts[t]; });
  },

  /* ── layers panel adapts to the selected area ──
     all-India → state + district + sub-district options
     state     → district + sub-district (clipped to that state)
     district  → sub-district only (clipped to that district)
     sub-district / city / radius → no boundary options              */
  updateLayersPanel(){
    const lvl=(this.ctx&&this.ctx.mode!=='none')?(this.ctx.level||'city'):'india';
    const show={states:false,districts:false,subdistricts:false};
    if (lvl==='india'||lvl==='country'){ show.states=show.districts=show.subdistricts=true; }
    else if (lvl==='state'){ show.districts=show.subdistricts=true; }
    else if (lvl==='district'){ show.subdistricts=true; }
    ['states','districts','subdistricts'].forEach(k=>{
      const row=document.getElementById('row-bnd-'+k); if(!row) return;
      row.style.display=show[k]?'':'none';
      if (!show[k]){ const cb=document.getElementById('bnd-'+k);
        if (cb&&cb.checked){ cb.checked=false; this.toggleBoundaryLayer(k,false); } }
    });
    const any=Object.values(show).some(Boolean);
    const title=document.getElementById('bndGrpTitle'); if(title) title.style.display=any?'':'none';
    const note=document.getElementById('bndScopeNote');
    if (note){
      if (lvl==='india'||lvl==='country'){ note.style.display='none'; }
      else { note.style.display='';
        note.innerHTML=any
          ? `Scoped to <b>${U.esc(this.ctx.label)}</b> — only boundaries inside it will draw.`
          : `<b>${U.esc(this.ctx.label)}</b> is the smallest unit here — no inner boundaries to show.`; }
    }
    /* re-clip any boundary layer that is currently on */
    Object.keys(this._bndLayers||{}).forEach(k=>{ this.toggleBoundaryLayer(k,false); const cb=document.getElementById('bnd-'+k); if(cb&&cb.checked) this.toggleBoundaryLayer(k,true); });
  },

  hideStations(){ if (this.map.hasLayer(this.stationCluster)) this.map.removeLayer(this.stationCluster); },
  showStations(){ if (!this.map.hasLayer(this.stationCluster)) this.map.addLayer(this.stationCluster); },

  /* ── show the ENTIRE national dataset clustered (default view on load) ── */
  async showAll(){
    await this.loadDataset();
    this.stationStore.clear();
    (this.masterStations||[]).forEach(s=>this.stationStore.set(s.id,s));
    this.ctx = { mode:'none', center:null, radiusKm:10, bbox:null, polygon:null, label:'India', level:null };
    this.updateLayersPanel();
    this.allStations = [...this.stationStore.values()];
    this.renderStations();
    const note=document.getElementById('stationNote');
    if (note) note.innerHTML=`<b>${this.allStations.length}</b> stations across <b>India</b> — search a place to zoom in.`;
  },

  /* convert a station record to the universal POI shape — shows EVERY field */
  stationToPOI(s){
    const speedTag = s.ultra ? ' · ⚡⚡ Ultra fast' : (s.fast ? ' · ⚡ Fast' : '');
    const addr = [s.address, s.area, s.locality, s.landmark].filter(Boolean).join(', ');
    const place = [s.city, s.district, s.state, s.pincode].filter(Boolean).join(', ');
    return {
      id:s.id, name:s.name, kind:'EV charging station',
      subtitle:`${s.operator||'Operator unknown'}${s.network&&s.network!==s.operator?' · '+s.network:''} · ${s.source||''}`,
      lat:s.lat, lon:s.lon, type:s.type, amenities:s.amenities||[],
      phone:s.phone||'', website:s.website||'', email:s.email||'',
      rows:[
        ['Charger', (CONFIG.TYPE_NAMES[s.type]||s.type)+speedTag],
        ['Max power', s.powerKW?`${s.powerKW} kW`:''],
        ['Min power', s.minKW?`${s.minKW} kW`:''],
        ['Connectors', s.connector||s.connDetail||''],
        ['Charger levels', s.levels||''],
        ['Ports / guns', s.ports],
        ['Chargers on site', s.chargers||''],
        ['AC / DC guns', (s.acCount||s.dcCount)?`${s.acCount||0} AC · ${s.dcCount||0} DC`:''],
        ['Status', s.status||''],
        ['Operational', s.operational===false?'No':(s.operational?'Yes':'')],
        ['Access', s.access||''],
        ['Open 24×7', s.open247?'Yes':''],
        ['Working hours', s.hours||''],
        ['Pricing', s.pricing||''],
        ['Rating', s.rating!=null?`${s.rating}★${s.ratingCount?` (${s.ratingCount})`:''}`:''],
        ['Brand', s.brand||''],
        ['Sub-operator', s.subOperator||''],
        ['Address', addr],
        ['Location', place],
        ['Verified', s.verified?'✔ Yes':''],
        ['Verified on', s.verifiedOn||''],
        ['Data confidence', s.confidence!=null?`${Math.round(s.confidence*100)}%`:''],
        ['Quality score', s.quality!=null?`${s.quality}`:''],
        ['Station ID', s.id],
        ['Source', s.source||''],
        ['Updated', s.updated||''],
      ]
    };
  },

  /* ───── PIN / AREA SCAN ───── */
  togglePinMode(){
    this.pinMode=!this.pinMode;
    
    U.toast(this.pinMode?'📍 Pin mode ON — click anywhere (or right-click anytime)':'Pin mode off');
  },
  dropPin(lat,lon){
    if (this.pin) this.map.removeLayer(this.pin);
    if (this.pinCircle) this.map.removeLayer(this.pinCircle);
    this.pin=L.marker([lat,lon],{ icon:L.divIcon({html:'<div style="font-size:30px;filter:drop-shadow(0 2px 5px rgba(0,0,0,.6))">📍</div>',className:'',iconSize:[30,30],iconAnchor:[15,28]}) }).addTo(this.map);
    this.pinPos={lat,lon};
    const km=+document.getElementById('apRadius').value;
    this.pinCircle=L.circle([lat,lon],{ radius:km*1000,color:'#f5a623',weight:1.5,fillColor:'#f5a623',fillOpacity:.07,dashArray:'5 5' }).addTo(this.map);
    document.getElementById('areaPanel').classList.add('show');
    document.getElementById('apTitle').textContent=`📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    document.getElementById('apResults').innerHTML='';
  },
  updatePinRadius(km){ if (this.pinCircle&&this.pinPos) this.pinCircle.setRadius(km*1000); },

  async scanArea(){
    if (!this.pinPos) return;
    const km=+document.getElementById('apRadius').value;
    const {lat,lon}=this.pinPos;
    const res=document.getElementById('apResults');
    res.innerHTML='<span class="ap-chip">Scanning…</span>';
    const stIn=[...this.stationStore.values()].filter(s=>U.haversine(lat,lon,s.lat,s.lon)<=km);
    const byType={}; stIn.forEach(s=>byType[s.type]=(byType[s.type]||0)+1);
    const cats=['hospital','hotel','restaurant','cafe','parking','fuel','atm'];
    const counts={};
    for (const cat of cats) counts[cat]=await Amen.countOnly(cat,lat,lon,km*1000);
    const icons={hospital:'🏥',hotel:'🏨',restaurant:'🍽️',cafe:'☕',parking:'🅿️',fuel:'⛽',atm:'🏧'};
    let html=`<span class="ap-chip clickable" data-scan="stations">⚡ Stations <b>${stIn.length}</b></span>`;
    Object.entries(byType).forEach(([t,n])=>html+=`<span class="ap-chip">${t} <b>${n}</b></span>`);
    Object.entries(counts).forEach(([cKey,n])=>html+=`<span class="ap-chip clickable" data-scan="${cKey}">${icons[cKey]} <b>${n===null?'—':n}</b></span>`);
    res.innerHTML=html;
    /* clicking a chip shows those items on the map */
    res.querySelectorAll('.ap-chip.clickable').forEach(ch=>{
      ch.onclick=async()=>{
        const w=ch.dataset.scan;
        if (w==='stations'){ const pts=[]; stIn.forEach(s=>{ const it=this.stationToPOI(s); L.circleMarker([s.lat,s.lon],{radius:11,color:'#fff',weight:2,fillColor:CONFIG.TYPE_COLORS[s.type],fillOpacity:1}).addTo(this.map).bindPopup(POI.popupHTML(it)).on('popupopen',()=>POI.bindPopup(it)); pts.push([s.lat,s.lon]); }); Amen.pulseHighlight(stIn); U.toast(`✨ ${stIn.length} stations highlighted`); }
        else { const cb=document.querySelector(`[data-amcat="${w}"]`); if(cb) cb.checked=true; ch.classList.add('scanning'); await Amen.loadAround(w,lat,lon,km*1000); Amen.pulseHighlight(Amen.getCache(w)); ch.classList.remove('scanning'); U.toast(`✨ ${w} highlighted around pin`); }
      };
    });
    U.toast(`Scanned: <b>${stIn.length}</b> stations within ${km} km of pin`);
  },

  /* helper for Intel: analyze any point */
  async analyzeCounts(lat,lon,km){
    const cats=['hospital','hotel','restaurant','cafe','parking','fuel','atm','police'];
    const counts={};
    for (const cat of cats) counts[cat]=await Amen.countOnly(cat,lat,lon,km*1000)||0;
    return counts;
  },
};
