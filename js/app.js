/* ═══ Eas_EV — app.js ═══  UI glue & boot */
const App = {
  currentDrawer:null,

  openDrawer(name){
    if (name==='intel') Agent.nudge && Agent.nudge('intel');
    if (name==='data') Agent.nudge && Agent.nudge('data');
    const titles={stations:'EV stations',amenities:'Amenities',trip:'Trip planner',data:'Data export',intel:'Strategic Intelligence',net:'Eas_EV.net — Explainable ML'};
    document.querySelectorAll('.dpanel').forEach(p=>p.classList.remove('show'));
    document.getElementById('dp-'+name).classList.add('show');
    document.getElementById('drawerTitle').textContent=titles[name];
    document.getElementById('drawer').classList.add('open');
    document.querySelectorAll('.rail-btn').forEach(b=>b.classList.toggle('active',b.dataset.drawer===name));
    this.currentDrawer=name;
    if (name==='data') DL.refreshList();
    if (name==='intel' && !Intel._dashLoaded){ Intel._dashLoaded=true; Intel.nationalDashboard(); }
  },
  closeDrawer(){ document.getElementById('drawer').classList.remove('open'); document.querySelectorAll('.rail-btn').forEach(b=>b.classList.remove('active')); this.currentDrawer=null; },

  async runSearch(){
    const q=document.getElementById('searchInput').value.trim(); if(!q) return;
    const box=document.getElementById('searchResults');
    box.innerHTML='<div class="sr-item"><div class="sr-name">Searching…</div></div>'; box.classList.add('show');
    try {
      const results=await MapMod.suggest(q);
      if (!results.length){ box.innerHTML='<div class="sr-item"><div class="sr-name">No results found</div></div>'; return; }
      box.innerHTML=results.map((r,i)=>{
        const kind=MapMod.classifyResult(r); const parts=r.display_name.split(',');
        return `<div class="sr-item" data-i="${i}"><div><div class="sr-name">${U.esc(parts[0])}</div><div class="sr-sub">${U.esc(parts.slice(1,4).join(',').trim())}</div></div><span class="sr-badge ${kind==='area'?'area':''}">${kind==='area'?'Boundary':'Radius'} · ${U.esc(MapMod.labelType(r))}</span></div>`;
      }).join('');
      box.querySelectorAll('.sr-item').forEach(el=>{ el.onclick=async()=>{ box.classList.remove('show'); await MapMod.applyResult(results[+el.dataset.i]); }; });
    } catch(e){ box.innerHTML='<div class="sr-item"><div class="sr-name">Search failed — Nominatim unreachable</div></div>'; }
  },

  /* shared: recentre on a coordinate and load nearest stations + amenities */
  async useMyLocation(lat, lon, opts){
    opts = opts || {};
    const zoom = opts.zoom || 13, radiusKm = opts.radiusKm || MapMod.ctx.radiusKm || 10;
    MapMod.userPos = { lat, lon };
    MapMod.ctx.mode = 'radius';
    MapMod.ctx.center = { lat, lon };
    MapMod.ctx.label = 'My location';
    MapMod.ctx.radiusKm = radiusKm;
    const rs = document.getElementById('radiusSlider');
    if (rs){ rs.value = radiusKm; const rv = document.getElementById('radVal'); if (rv) rv.textContent = radiusKm + ' km'; }
    MapMod.clearBoundary && MapMod.clearBoundary();
    MapMod.map.setView([lat, lon], zoom);
    if (MapMod.userMarker) MapMod.map.removeLayer(MapMod.userMarker);
    MapMod.userMarker = L.marker([lat, lon], { icon:MapMod.pin3D('\u{1F4CD}','#ff2ea6',42), zIndexOffset:900 }).addTo(MapMod.map);
    MapMod.drawRadiusCircle(lat, lon, radiusKm);
    await MapMod.loadStations();
    Amen.reloadActive && Amen.reloadActive();
    DL.refreshList && DL.refreshList();
    let addr = '';
    try { const r = await fetch(`${CONFIG.NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json`); const d = await r.json(); addr = d.display_name || ''; } catch(e){}
    const item = { id:'mylocation', name:'My location', kind:'Current position', subtitle:addr||'Current position',
      lat, lon, rows:[['Latitude',lat.toFixed(5)],['Longitude',lon.toFixed(5)],['Address',addr]] };
    MapMod.userMarker.bindPopup(POI.popupHTML(item), { minWidth:230 });
    MapMod.userMarker.on('popupopen', ()=>POI.bindPopup(item));
    Store.save && Store.save();
    if (opts.announce !== false) U.toast('At your location - nearest stations & amenities loaded');
    return item;
  },

  locateMe(){
    if (!navigator.geolocation){ U.toast('Geolocation unsupported'); return; }
    U.toast('Getting GPS...');
    navigator.geolocation.getCurrentPosition(
      pos=>this.useMyLocation(pos.coords.latitude, pos.coords.longitude, { zoom:13, radiusKm:10 }),
      ()=>U.toast('GPS permission denied'),
      { enableHighAccuracy:true, timeout:10000, maximumAge:60000 }
    );
  },

  /* auto-locate on first load; resolves false if denied/unavailable */
  autoLocate(){
    return new Promise(resolve=>{
      if (!navigator.geolocation){ resolve(false); return; }
      navigator.geolocation.getCurrentPosition(
        async pos=>{ try { await this.useMyLocation(pos.coords.latitude, pos.coords.longitude, { zoom:12, radiusKm:10 }); } catch(e){} resolve(true); },
        ()=>resolve(false),
        { enableHighAccuracy:true, timeout:8000, maximumAge:300000 }
      );
    });
  },

  /* SILENT: on boot, set userPos + ctx.center to the device's real location so
     "nearest", amenities and "My location" all use it — WITHOUT moving/zooming
     the map (nationwide view stays). Falls back to the default if denied. */
  initLocationSilently(){
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async pos=>{
      const lat=pos.coords.latitude, lon=pos.coords.longitude;
      MapMod.userPos = { lat, lon };
      if (MapMod.ctx){ MapMod.ctx.center = { lat, lon }; MapMod.ctx.label = 'My location'; }
      try{
        const r=await fetch(`${CONFIG.NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json`);
        const d=await r.json();
        if (d && d.address){ const a=d.address; MapMod.ctx.label = a.city||a.town||a.village||a.suburb||a.state_district||a.state||'My location'; }
      }catch(e){}
    }, ()=>{}, { enableHighAccuracy:true, timeout:8000, maximumAge:300000 });
  },

  reloadStations(){
    if (MapMod.ctx.mode==='radius'){
      MapMod.ctx.radiusKm=+document.getElementById('radiusSlider').value;
      MapMod.clearBoundary();
      MapMod.drawRadiusCircle(MapMod.ctx.center.lat,MapMod.ctx.center.lon,MapMod.ctx.radiusKm);
    }
    MapMod.loadStations().then(()=>{ Amen.reloadActive(); DL.refreshList(); });
  },
  loadSelectedAmenities(){ Amen.loadSelected(); },
  clearAmenities(){ Amen.clearAll(); },
  /* Module 43 #3 — dedicated clear controls */
  clearRoute(){ POI.clearRoutePreview(); Trip.clearRoute(); Trip.clearChain&&Trip.clearChain(); Toggle.state.route=false; U.toast('Route cleared'); Store.save(); },
  clearRadius(){ MapMod.clearBoundary(); Toggle.state.radius=false; U.toast('Radius / boundary cleared'); Store.save(); },
  clearSelection(){ Amen.clearAll(); U.toast('Amenity selection cleared'); },
  scanArea(){ MapMod.scanArea(); },
  closeAreaPanel(){
    document.getElementById('areaPanel').classList.remove('show');
    if (MapMod.pin){ MapMod.map.removeLayer(MapMod.pin); MapMod.pin=null; }
    if (MapMod.pinCircle){ MapMod.map.removeLayer(MapMod.pinCircle); MapMod.pinCircle=null; }
    MapMod.pinPos=null; DL.refreshList();
  },

  init(){
    MapMod.init(); Amen.buildUI(); Trip.init(); Agent.init(); Net.init && Net.init();
    this.initLocationSilently();          // set userPos/center to device location (no zoom)
    if (Intel.initFileEval) Intel.initFileEval();

    document.querySelectorAll('.rail-btn[data-drawer]').forEach(b=>{ b.onclick=()=>{ if(this.currentDrawer===b.dataset.drawer) this.closeDrawer(); else this.openDrawer(b.dataset.drawer); }; });
    document.querySelectorAll('.base-card').forEach(b=>b.onclick=()=>MapMod.setBase(b.dataset.base));

    /* layers popover — floating circular button */
    const lp=document.getElementById('layersPop'), lb=document.getElementById('layersBtn');
    lb.onclick=e=>{ e.stopPropagation(); lp.classList.toggle('show'); lb.classList.toggle('active'); };
    document.addEventListener('click',e=>{ if(!e.target.closest('#layersPop')&&!e.target.closest('#layersBtn')){ lp.classList.remove('show'); lb.classList.remove('active'); } });

    /* state / district / sub-district boundary toggles (official boundaries) */
    document.getElementById('bnd-states').addEventListener('change',e=>MapMod.toggleBoundaryLayer('states',e.target.checked));
    document.getElementById('bnd-districts').addEventListener('change',e=>MapMod.toggleBoundaryLayer('districts',e.target.checked));
    document.getElementById('bnd-subdistricts')?.addEventListener('change',e=>MapMod.toggleBoundaryLayer('subdistricts',e.target.checked));

    /* heatmap toggles */
    document.querySelectorAll('[data-heat]').forEach(cb=>cb.addEventListener('change',()=>Intel.refreshHeat()));

    /* station filters — type + speed */
    document.querySelectorAll('#dp-stations [data-type],#dp-stations [data-speed]').forEach(cb=>cb.addEventListener('change',()=>MapMod.renderStations()));

    /* radius sliders */
    document.getElementById('radiusSlider').addEventListener('input',e=>document.getElementById('radVal').textContent=e.target.value+' km');
    document.getElementById('apRadius').addEventListener('input',e=>{ document.getElementById('apRadVal').textContent=e.target.value+' km'; MapMod.updatePinRadius(+e.target.value); });

    /* intel tabs */
    document.querySelectorAll('.itab').forEach(t=>t.onclick=()=>{
      document.querySelectorAll('.itab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.itab-panel').forEach(x=>x.classList.remove('show'));
      t.classList.add('active'); document.getElementById('it-'+t.dataset.itab).classList.add('show');
    });

    /* search box */
    const si=document.getElementById('searchInput');
    /* live autocomplete (debounced Nominatim, India-biased) */
    const sugBox=document.getElementById('searchSuggest');
    let sugT=null, sugAbort=null;
    si.addEventListener('input',()=>{
      clearTimeout(sugT);
      const q=si.value.trim();
      if (q.length<2){ sugBox.classList.remove('show'); return; }
      sugT=setTimeout(async()=>{
        try{
          sugAbort&&sugAbort.abort(); sugAbort=new AbortController();
          const r=await fetch(`${CONFIG.NOMINATIM}/search?format=jsonv2&countrycodes=in&limit=8&polygon_geojson=1&q=${encodeURIComponent(q)}`,{signal:sugAbort.signal,headers:{'accept-language':'en'}});
          const items=await r.json();
          if (!items.length){ sugBox.classList.remove('show'); return; }
          sugBox.innerHTML=items.map((it,k)=>{
            const parts=(it.display_name||'').split(',');
            return `<div class="si" data-k="${k}"><span class="si-ic">📍</span><span>${U.esc(parts[0])}<span class="si-sub">${U.esc(parts.slice(1,4).join(',').trim())}</span></span></div>`;
          }).join('');
          sugBox.classList.add('show');
          sugBox.querySelectorAll('.si').forEach(el=>el.onclick=()=>{
            const it=items[+el.dataset.k];
            si.value=(it.display_name||'').split(',')[0];
            sugBox.classList.remove('show');
            MapMod.applyResult(it);
          });
        }catch(e){}
      },320);
    });
    si.addEventListener('keydown',e=>{ if(e.key==='Escape') sugBox.classList.remove('show'); });
    document.addEventListener('click',e=>{ if(!e.target.closest('.search-wrap')) sugBox.classList.remove('show'); });
    si.addEventListener('keydown',e=>{ if(e.key==='Enter') this.runSearch(); });
    let deb; si.addEventListener('input',()=>{ clearTimeout(deb); if(si.value.trim().length<3){ document.getElementById('searchResults').classList.remove('show'); return; } deb=setTimeout(()=>this.runSearch(),650); });
    document.addEventListener('click',e=>{ if(!e.target.closest('.search-wrap')) document.getElementById('searchResults').classList.remove('show'); });


    /* Module 43 #4 — restore previous session if present */
    const restored = (window.Store && Store.restore());
    Trip.renderSaved && Trip.renderSaved();
    Trip.renderJourneys && Trip.renderJourneys();

    /* autosave on map move / zoom */
    MapMod.map.on('moveend zoomend', ()=>Store.save());

    /* preload the master dataset (so search/intel are instant) but DON'T render anything */
    MapMod.loadDataset();
    /* draw the clean India outline as a subtle backdrop */
    Boundaries.load('india').then(g=>{
      if (g && !MapMod._indiaOutline){
        MapMod._indiaOutline = L.geoJSON(g,{ style:{color:MapMod.bndTheme().india,weight:1.2,fill:false,opacity:.4,dashArray:'3 5'}, interactive:false }).addTo(MapMod.map);
      }
    });

    if (restored && MapMod.ctx && MapMod.ctx.center && MapMod.ctx.label){
      /* user had an active place last time — restore it */
      MapMod.loadStations().then(()=>{ Amen.reloadActive&&Amen.reloadActive(); DL.refreshList(); });
      U.toast('Welcome back — your last session was restored');
    } else {
      /* nationwide start — the FULL dataset renders as clusters immediately */
      /* nationwide start — do NOT auto-locate; location only on the My-location button */
      MapMod.map.setView(CONFIG.INDIA_CENTER, CONFIG.INDIA_ZOOM);
      MapMod.showAll().then(()=>DL.refreshList());
      U.toast('Welcome to <b>Eas_EV</b> - all stations loaded. Search any place to zoom in.');
    }
  },
};
window.addEventListener('DOMContentLoaded',()=>App.init());

/* ─── silent background-data watcher ───────────────────────────────────────
   The backend re-runs the Stage-1 collector invisibly (backend/collector/).
   We poll /api/data/status; when the dataset `version` changes, the fresh
   stations.json is hot-swapped into the live map with zero user interaction
   and zero visible interruption. In static (no-backend) mode the endpoint
   404s and this watcher simply stays dormant. */
(function(){
  let ver = null;
  const check = async () => {
    try{
      const r = await fetch('/api/data/status', {cache:'no-store'});
      if (!r.ok) return;
      const j = await r.json();
      if (!j || !j.version) return;
      if (ver === null){ ver = j.version; return; }       // baseline on first poll
      if (j.version !== ver){
        ver = j.version;
        const ok = MapMod.reloadDataset && await MapMod.reloadDataset();   // silent swap
        if (ok && j.new_count > 0 && Agent.notifyNewStations)
          Agent.notifyNewStations(j.new_stations || [], j.new_count);
      }
    }catch(e){ /* offline / static mode — stay quiet */ }
  };
  setTimeout(check, 5000);           // first baseline shortly after load
  setInterval(check, 30000);         // then every 30 s → new data live within ~2 min
})();