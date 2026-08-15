/* ═══ Eas_EV — smarttrip.js ═══
   Layers advanced smart-trip features on top of Trip:
   · vehicle make/model presets (auto-fill range + battery)
   · re-route THROUGH chosen chargers (stations ON the route, not beside it)
   · charge-status prediction is reused from Trip.batteryPlan
   · smart break suggestions ("need a break? café nearby") with Yes/No
   · smart suggestions master toggle
   · Open the finished route (with charging waypoints) in Google Maps
   · 3D-style charging-stop popup cards                                    */

const SmartTrip = {

  /* India EV catalogue — usable (real-world) range in km */
  vehicles: {
    "Tata": {
      "Nexon EV (45 kWh)":{range:325,batt:80}, "Punch EV LR":{range:300,batt:80},
      "Curvv EV (55 kWh)":{range:360,batt:80}, "Tiago EV LR":{range:180,batt:80},
      "Tigor EV":{range:225,batt:80},
    },
    "Mahindra": {
      "XUV400 EL Pro":{range:320,batt:80}, "BE 6 (79 kWh)":{range:450,batt:80},
      "XEV 9e (79 kWh)":{range:500,batt:80},
    },
    "MG": { "ZS EV":{range:330,batt:80}, "Windsor EV":{range:280,batt:80}, "Comet EV":{range:165,batt:80} },
    "Hyundai": { "Creta Electric LR":{range:380,batt:80}, "Kona Electric":{range:350,batt:80}, "Ioniq 5":{range:500,batt:80} },
    "Kia": { "EV6":{range:550,batt:80}, "EV9":{range:520,batt:80} },
    "BYD": { "Atto 3":{range:420,batt:80}, "Seal":{range:520,batt:80}, "eMAX 7":{range:420,batt:80} },
    "Ather (2W)": { "450 Apex":{range:120,batt:80}, "Rizta Z":{range:120,batt:80} },
    "Ola (2W)": { "S1 Pro (Gen 2)":{range:140,batt:80}, "S1 X+":{range:110,batt:80} },
    "TVS (2W)": { "iQube ST":{range:100,batt:80} },
    "Bajaj (2W)": { "Chetak 3501":{range:110,batt:80} },
    "Other / custom": { "Custom range":{range:300,batt:80} },
  },

  init(){
    const mk=document.getElementById('vehMake'); if(!mk) return;
    Object.keys(this.vehicles).forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; mk.appendChild(o); });
    // wrap Trip.plan so smart features run after a normal plan
    if (window.Trip && !Trip._smartWrapped){
      const orig=Trip.plan.bind(Trip);
      Trip.plan=async(...a)=>{ const r=await orig(...a); this.afterPlan(); return r; };
      Trip._smartWrapped=true;
    }
  },

  onMake(make){
    const md=document.getElementById('vehModel');
    md.innerHTML='<option value="">Model…</option>';
    if(!this.vehicles[make]) return;
    Object.keys(this.vehicles[make]).forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; md.appendChild(o); });
    md.dataset.make=make;
  },
  onModel(model){
    const make=document.getElementById('vehModel').dataset.make;
    const v=this.vehicles[make]?.[model]; if(!v) return;
    document.getElementById('tripRange').value=v.range;
    document.getElementById('tripBattery').value=v.batt;
    this.currentVehicle=`${make} · ${model}`;
    U.toast(`${make} ${model} — ${v.range} km usable range`);
  },

  smartOn(){ const el=document.getElementById('smartSuggest'); return !el || el.checked; },

  /* runs after Trip.plan() succeeds */
  async afterPlan(){
    if (!Trip.lastPlan) return;
    document.getElementById('gmapsBtn').style.display='block';
    if (!this.smartOn()) return;
    // 1) re-route THROUGH the charging stops so they sit ON the polyline
    try{ await this.rerouteThroughChargers(); }catch(e){ console.warn('reroute skipped:',e); }
    // 2) proactive mid-trip predictions — each isolated so one failure never hides the rest
    try{ this.suggestBreak(); }catch(e){ console.warn(e); }
    try{ await this.autoSuggest(); }catch(e){ console.warn(e); }
    Agent.nudge && Agent.nudge('trip');
  },

  /* ── PROACTIVE SUGGESTIONS ──
     Predicts what the driver will need mid-trip, offers Yes/No cards,
     and (on Yes) marks the amenities on the map with amber pins. */
  _ssMarkers:[],
  clearSSMarkers(){ this._ssMarkers.forEach(m=>MapMod.map.removeLayer(m)); this._ssMarkers=[]; },

  async autoSuggest(){
    const p=Trip.lastPlan; if(!p||!p.route) return;
    if (!MapMod.datasetLoaded) try{ await MapMod.loadDataset(); }catch(e){}
    this.clearSSMarkers();
    const totalKm=parseFloat(p.km), totalMin=p.min;
    const preds=[];

    // a) meal prediction — if the drive crosses a mealtime, suggest food near the closest point
    const now=new Date(); const startH=now.getHours()+now.getMinutes()/60;
    const meals=[{h:8.5,name:'breakfast',ic:'🍳'},{h:13.5,name:'lunch',ic:'🍽️'},{h:20.5,name:'dinner',ic:'🍲'}];
    for (const m of meals){
      const hrsUntil=m.h-startH;
      if (hrsUntil>0.4 && hrsUntil<totalMin/60){
        const frac=Math.min(0.95,(hrsUntil*60)/totalMin);
        const pt=Trip.pointAlong(p.route.geometry.coordinates,frac);
        preds.push({ic:m.ic,title:`${m.name[0].toUpperCase()+m.name.slice(1)} on the way`,cat:'restaurant',pt,
          msg:`You'll hit <b>${m.name} time</b> around km ${Math.round(totalKm*frac)}. Want me to mark restaurants & dhabas there?`});
        break;
      }
    }
    // b) washroom / rest prediction every ~2.5 h of driving
    if (totalMin>150){
      const frac=Math.min(0.9,150/totalMin);
      const pt=Trip.pointAlong(p.route.geometry.coordinates,frac);
      preds.push({ic:'🚻',title:'Rest & washroom stop',cat:'toilets',fallback:'fuel',pt,
        msg:`~2.5 hours in (km ${Math.round(totalKm*frac)}) is a healthy point for a rest + washroom break. Mark options there?`});
    }
    // c) extra on-route DC chargers near each planned charge stop (backup options)
    (p.chargeStops||[]).forEach(cs=>{
      if (!cs.station) return;
      const near=[...(MapMod.masterStations||[])].filter(s=>(s.type==='DC'||s.type==='AC_DC') &&
        U.haversine(cs.station.lat,cs.station.lon,s.lat,s.lon)<=8 && s.id!==cs.station.id).slice(0,4);
      if (near.length) preds.push({ic:'⚡',title:'Backup chargers nearby',stations:near,pt:{lat:cs.station.lat,lon:cs.station.lon},
        msg:`Around your charge stop <b>${U.esc(cs.station.name)}</b> there ${near.length===1?'is':'are'} <b>${near.length}</b> other fast charger${near.length>1?'s':''} — mark them as backups?`});
    });

    const sum=document.getElementById('tripSummary'); if(!sum) return;
    preds.slice(0,3).forEach((pr,idx)=>{
      const card=document.createElement('div');
      card.className='smart-suggest-card';
      card.innerHTML=`<div class="ssc-ic">${pr.ic}</div>
        <div class="ssc-body"><div class="ssc-title">${pr.title}</div><div class="ssc-msg">${pr.msg}</div>
        <div class="ssc-acts">
          <button class="btn sm" data-ss="${idx}">Yes, mark on map</button>
          <button class="btn sm ghost" onclick="this.closest('.smart-suggest-card').remove()">No thanks</button>
        </div></div>`;
      card.querySelector('[data-ss]').onclick=()=>{ this.applySuggestion(pr); card.remove(); };
      sum.prepend(card);
    });
  },

  async applySuggestion(pr){
    if (pr.stations){          // backup chargers — mark directly from the dataset
      pr.stations.forEach(s=>{
        const mk=L.marker([s.lat,s.lon],{icon:MapMod.pin3D('⚡','#2dd4a7',32)}).addTo(MapMod.map);
        const item=MapMod.stationToPOI(s);
        mk.bindPopup(POI.popupHTML(item),{minWidth:250}); mk.on('popupopen',()=>POI.bindPopup(item));
        this._ssMarkers.push(mk);
      });
      MapMod.map.setView([pr.pt.lat,pr.pt.lon],12);
      U.toast(`${pr.stations.length} backup charger(s) marked`);
      return;
    }
    U.toast(`Finding ${pr.title.toLowerCase()}…`);
    const ic={restaurant:'🍽️',toilets:'🚻',cafe:'☕',fuel:'⛽'}[pr.cat]||'📍';
    try{
      let items=await Amen.fetchNear(pr.cat,pr.pt.lat,pr.pt.lon,6000);
      if ((!items||!items.length) && pr.fallback) items=await Amen.fetchNear(pr.fallback,pr.pt.lat,pr.pt.lon,6000);
      (items||[]).slice(0,6).forEach(it=>{
        const mk=L.marker([it.lat,it.lon],{icon:MapMod.pin3D(ic,'#f5a623',30)}).addTo(MapMod.map)
          .bindPopup(`${ic} <b>${U.esc(it.name||pr.title)}</b>`);
        this._ssMarkers.push(mk);
      });
      MapMod.map.setView([pr.pt.lat,pr.pt.lon],13);
      U.toast(`${ic} ${Math.min(6,(items||[]).length)} spot(s) marked on the route`);
    }catch(e){ U.toast('Could not fetch places right now'); }
  },

  async rerouteThroughChargers(){
    const p=Trip.lastPlan; if(!p||!p.chargeStops?.length) return;
    const chosen=p.chargeStops.filter(c=>c.station);
    if(!chosen.length) return;
    // origin, [chargers...], destination
    const via=[ p.pts[0], ...chosen.map(c=>c.station), p.pts[p.pts.length-1] ];
    const coords=via.map(s=>`${s.lon},${s.lat}`).join(';');
    try{
      const res=await fetch(`${CONFIG.OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      const d=await res.json(); if(!d.routes?.length) return;
      const route=d.routes[0];
      if (Trip.routeLayer){ MapMod.map.removeLayer(Trip.routeLayer); }
      // draw the through-charger route in Eas_EV green with a subtle glow
      Trip.routeLayer=L.geoJSON(route.geometry,{style:{color:'#16a34a',weight:6,opacity:.9}}).addTo(MapMod.map);
      Trip.lastPlan.route=route;
      // mark each on-route charger with a 3D-style popup
      chosen.forEach((c,i)=>{
        const st=c.station;
        const mk=L.marker([st.lat,st.lon],{icon:L.divIcon({className:'',iconSize:[34,34],iconAnchor:[17,34],
          html:`<div class="ev-pin"><span>⚡</span></div>`})}).addTo(MapMod.map);
        mk.bindPopup(this.stationCard3D(st,c),{maxWidth:320,className:'card3d-popup'});
        Trip.routeMarkers.push(mk);
      });
      U.toast('🛣️ Route now runs <b>through</b> '+chosen.length+' charging stop(s)');
    }catch(e){ /* keep original route on failure */ }
  },

  /* 3D-style station popup card */
  stationCard3D(st,cs){
    const pct = cs? cs.pctAtStop : null;
    const eta = st.type==='DC' ? '30–45 min' : '3–5 hr';
    return `<div class="card3d">
      <div class="c3-top">
        <div class="c3-badge ${st.type==='DC'?'dc':'ac'}">${st.type}</div>
        <div class="c3-title">${U.esc(st.name)}</div>
        <div class="c3-sub">${U.esc(st.operator||'—')}${st.city?' · '+U.esc(st.city):''}</div>
      </div>
      <div class="c3-scene"><div class="c3-charger"><div class="c3-bolt">⚡</div><div class="c3-plug"></div></div>
        ${pct!=null?`<div class="c3-batt"><div class="c3-batt-fill" style="width:${pct}%"></div><span>${pct}%</span></div>`:''}
      </div>
      <div class="c3-stats">
        <div><b>${st.powerKW||'—'}</b><span>kW</span></div>
        <div><b>${st.ports||1}</b><span>ports</span></div>
        <div><b>${eta}</b><span>charge</span></div>
        ${cs&&cs.detourKm!=null?`<div><b>${cs.detourKm}</b><span>km detour</span></div>`:''}
      </div>
      ${st.connector?`<div class="c3-conn">🔌 ${U.esc(st.connector)}</div>`:''}
      <div class="c3-acts">
        <a href="#" onclick="MapMod.map.setView([${st.lat},${st.lon}],15);return false">📍 Focus</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${st.lat},${st.lon}&travelmode=driving" target="_blank" rel="noopener">🧭 Navigate</a>
      </div>
    </div>`;
  },

  suggestBreak(){
    const p=Trip.lastPlan; if(!p) return;
    // pick the longest gap or a charge stop that has cafés nearby
    const withCafe=(p.chargeStops||[]).find(c=>c.cafesNearby>0 && c.station);
    let host, msg;
    if (withCafe){
      host=withCafe;
      msg=`You'll be driving a while before <b>${U.esc(withCafe.station.name)}</b> (~km ${withCafe.atKm}). There ${withCafe.cafesNearby===1?'is':'are'} <b>${withCafe.cafesNearby}</b> café${withCafe.cafesNearby>1?'s':''} nearby — take a break while you charge?`;
    } else if (p.km>180){
      const mid=Trip.pointAlong(p.route.geometry.coordinates,0.5);
      host={point:mid,atKm:Math.round(p.km/2)};
      msg=`This is a <b>${p.km} km</b> drive. A short break around the halfway point (~km ${host.atKm}) keeps you fresh — want me to find a café/rest stop there?`;
    } else return;

    const sum=document.getElementById('tripSummary');
    const card=document.createElement('div');
    card.className='smart-suggest-card';
    card.innerHTML=`<div class="ssc-ic">☕</div>
      <div class="ssc-body"><div class="ssc-title">Need a break?</div><div class="ssc-msg">${msg}</div>
        <div class="ssc-acts">
          <button class="btn sm" onclick="SmartTrip.acceptBreak(${host.point.lat},${host.point.lon})">Yes, find a spot</button>
          <button class="btn sm ghost" onclick="this.closest('.smart-suggest-card').remove()">No thanks</button>
        </div></div>`;
    sum.prepend(card);
  },

  async acceptBreak(lat,lon){
    U.toast('☕ Finding rest stops near your break point…');
    try{
      const items=await Amen.fetchNear('cafe',lat,lon,4000);
      (items||[]).slice(0,6).forEach(it=>{
        L.circleMarker([it.lat,it.lon],{radius:7,color:'#fff',weight:2,fillColor:'#f59e0b',fillOpacity:1})
          .addTo(MapMod.map).bindPopup(`☕ <b>${U.esc(it.name||'Café / rest stop')}</b>`);
      });
      MapMod.map.setView([lat,lon],13);
      U.toast(`☕ Marked ${Math.min(6,(items||[]).length)} rest stops for your break`);
    }catch(e){ U.toast('Could not fetch rest stops right now'); }
    document.querySelector('.smart-suggest-card')?.remove();
  },

  openInGoogleMaps(){
    const p=Trip.lastPlan; if(!p){ U.toast('Plan a trip first'); return; }
    const stops=(p.chargeStops||[]).filter(c=>c.station).map(c=>c.station);
    const origin=`${p.pts[0].lat},${p.pts[0].lon}`;
    const dest=`${p.pts[p.pts.length-1].lat},${p.pts[p.pts.length-1].lon}`;
    // Google Maps allows waypoints via the dir API (charging stops pre-selected on the route)
    let url=`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
    const way=[...p.pts.slice(1,-1).map(x=>`${x.lat},${x.lon}`), ...stops.map(s=>`${s.lat},${s.lon}`)];
    if (way.length) url+=`&waypoints=${encodeURIComponent(way.join('|'))}`;
    window.open(url,'_blank','noopener');
    U.toast('🗺️ Opening route + charging stops in Google Maps');
  },
};

window.addEventListener('DOMContentLoaded',()=>{ setTimeout(()=>SmartTrip.init(),400); });
