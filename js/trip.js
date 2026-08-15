/* ═══ Eas_EV — trip.js ═══
   Multi-stop planner · reorder (↑↓) · weather-aware battery model ·
   smart charging+food stops · save to library · offline (PDF/GPX/JSON) ·
   route chain (click stations → build a trip)                        */

const Trip = {
  waypoints:[], routeLayer:null, routeMarkers:[], lastPlan:null, _id:1,
  chain:[],          // route-chain stations
  get saved(){ return U.load('trips',[]); },
  set saved(v){ U.store('trips',v||[]); },

  init(){
    this.addWaypoint(''); this.addWaypoint('');
    this.renderSaved();
    this.renderJourneys();
  },

  addWaypoint(v=''){ this.waypoints.push({id:this._id++,value:v}); this.render(); },
  addStopFromStation(s){
    /* fill first empty, else push before destination */
    const empty=this.waypoints.find(w=>!w.value.trim());
    if (empty) empty.value=`${s.name} (${s.lat.toFixed(4)},${s.lon.toFixed(4)})`;
    else this.waypoints.splice(this.waypoints.length-1,0,{id:this._id++,value:`${s.name} (${s.lat.toFixed(4)},${s.lon.toFixed(4)})`});
    this.render(); App.openDrawer('trip');
  },
  /* Module 44 #8 — add ANY POI (station, hospital, hotel, restaurant…) to the trip */
  addPOI(item){
    const label=`${item.name} (${item.lat.toFixed(4)},${item.lon.toFixed(4)})`;
    const empty=this.waypoints.find(w=>!w.value.trim());
    if (empty) empty.value=label;
    else this.waypoints.splice(this.waypoints.length-1,0,{id:this._id++,value:label});
    this.render(); App.openDrawer('trip');
  },
  removeWaypoint(id){ if (this.waypoints.length<=2) return; this.waypoints=this.waypoints.filter(w=>w.id!==id); this.render(); },
  move(id,dir){
    const i=this.waypoints.findIndex(w=>w.id===id); const j=i+dir;
    if (j<0||j>=this.waypoints.length) return;
    [this.waypoints[i],this.waypoints[j]]=[this.waypoints[j],this.waypoints[i]];
    this.render();
  },
  setVal(id,v){ const w=this.waypoints.find(x=>x.id===id); if (w) w.value=v; },

  render(){
    const root=document.getElementById('waypointList');
    root.innerHTML=this.waypoints.map((w,i)=>`
      <div class="wp-row" draggable="true" data-wpid="${w.id}"
           ondragstart="Trip.dragStart(event,${w.id})" ondragover="event.preventDefault()"
           ondrop="Trip.drop(event,${w.id})" ondragend="Trip.dragEnd(event)">
        <div class="wp-grip" title="Drag to reorder">⋮⋮</div>
        <div class="wp-num">${i===0?'A':i===this.waypoints.length-1?'B':i}</div>
        <input type="text" placeholder="${i===0?'Start':i===this.waypoints.length-1?'Destination':'Via stop'}" value="${U.esc(w.value)}" onchange="Trip.setVal(${w.id},this.value)">
        <div class="wp-ctl">
          <button class="wp-mv" onclick="Trip.move(${w.id},-1)" title="Up">▲</button>
          <button class="wp-mv" onclick="Trip.move(${w.id},1)" title="Down">▼</button>
          ${this.waypoints.length>2?`<button class="wp-del" onclick="Trip.removeWaypoint(${w.id})" title="Remove">✕</button>`:''}
        </div>
      </div>`).join('');
  },
  dragStart(e,id){ this._dragId=id; e.dataTransfer.effectAllowed='move'; e.target.closest('.wp-row')?.classList.add('dragging'); },
  dragEnd(e){ e.target.closest('.wp-row')?.classList.remove('dragging'); },
  drop(e,targetId){
    e.preventDefault();
    if (this._dragId==null || this._dragId===targetId) return;
    const from=this.waypoints.findIndex(w=>w.id===this._dragId);
    const to=this.waypoints.findIndex(w=>w.id===targetId);
    if (from<0||to<0) return;
    const [moved]=this.waypoints.splice(from,1);
    this.waypoints.splice(to,0,moved);
    this._dragId=null;
    this.render();
  },

  async geocodeOne(v){
    /* accept "Name (lat,lon)" or plain place */
    const m=v.match(/\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/);
    if (m) return { lat:+m[1], lon:+m[2], name:v.replace(/\s*\(.*\)/,'').trim() };
    const r=await fetch(`${CONFIG.NOMINATIM}/search?q=${encodeURIComponent(v)}&format=json&limit=1&countrycodes=in`);
    const d=await r.json(); if (!d.length) throw new Error('Not found: '+v);
    return { lat:+d[0].lat, lon:+d[0].lon, name:v };
  },

  async getWeatherFactor(lat,lon){
    try {
      const r=await fetch(`${CONFIG.OPEN_METEO}?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m`);
      const d=await r.json(); const cur=d.current||{};
      const temp=cur.temperature_2m??25, rain=cur.precipitation??0, wind=cur.wind_speed_10m??0;
      /* EV range factors: optimal ~22°C; heat/cold + rain + wind reduce range */
      let f=1 - Math.abs(temp-22)*0.006 - (rain>0?0.06:0) - (wind>25?0.04:0);
      f=Math.max(0.7,Math.min(1,f));
      return { factor:+f.toFixed(3), temp, rain, wind, note:`${Math.round(temp)}°C${rain>0?', rain':''}${wind>25?', windy':''}` };
    } catch(e){ return { factor:0.9, temp:null, note:'weather n/a' }; }
  },

  async plan(){
    MapMod.exclusive && MapMod.exclusive('trip');      // one thing on the map at a time
    SmartTrip.clearSSMarkers && SmartTrip.clearSSMarkers();
    const sum=document.getElementById('tripSummary');
    sum.innerHTML='<div class="note">Planning smart trip… (route + weather + battery model)</div>';
    document.getElementById('tripSaveRow').style.display='none';
    try {
      /* speed: geocode every stop IN PARALLEL instead of one-by-one */
      for (const w of this.waypoints){ if(!w.value.trim()) throw new Error('Fill all stops first'); }
      const pts=await Promise.all(this.waypoints.map(w=>this.geocodeOne(w.value)));
      const coords=pts.map(p=>`${p.lon},${p.lat}`).join(';');
      const res=await fetch(`${CONFIG.OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
      let data=await res.json(); if (!data.routes?.length) throw new Error('No route found');
      data=await this.keepRouteInIndia(pts, data);
      const route=data.routes[0];

      this.clearRoute();
      this.routeLayer=L.geoJSON(route.geometry,{style:{color:'#4f8ef7',weight:5,opacity:.85}}).addTo(MapMod.map);
      pts.forEach((p,i)=>{
        const mk=L.marker([p.lat,p.lon],{icon:L.divIcon({html:`<div style="background:${i===0?'#2dd4a7':i===pts.length-1?'#f0556a':'#4f8ef7'};color:#fff;width:27px;height:27px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)">${i===0?'A':i===pts.length-1?'B':i}</div>`,className:'',iconSize:[27,27],iconAnchor:[13,13]})}).addTo(MapMod.map).bindPopup(`<b>${U.esc(p.name)}</b>`);
        this.routeMarkers.push(mk);
      });
      MapMod.map.fitBounds(this.routeLayer.getBounds(),{padding:[60,60]});

      const km=route.distance/1000, min=Math.round(route.duration/60);
      const battery=+document.getElementById('tripBattery').value;
      const range=+document.getElementById('tripRange').value;

      /* weather at midpoint */
      const mid=this.pointAlong(route.geometry.coordinates,0.5);
      const wx=await this.getWeatherFactor(mid.lat,mid.lon);

      /* battery depletion model + smart stops */
      const plan=await this.batteryPlan(route,km,battery,range,wx,pts);
      this.lastPlan={ route, pts, km:+km.toFixed(1), min, battery, range, wx, ...plan };

      this.renderSummary(this.lastPlan);
      this._enrichCafes(this.lastPlan);                 // background — never blocks
      document.getElementById('tripSaveRow').style.display='block';
      DL.refreshList();
      U.toast(`Trip ready: <b>${km.toFixed(0)} km</b>, ${U.fmtTime(min)}`);
      return { km:km.toFixed(1), timeMin:min, chargeStops:plan.chargeStops.length };
    } catch(e){ sum.innerHTML=`<div class="note">⚠ ${U.esc(e.message)}</div>`; return {error:e.message}; }
  },

  /* depletion model with weather; suggests charge + nearby food */
  async batteryPlan(route,totalKm,batteryPct,rangeKm,wx,pts){
    const effRange = rangeKm * wx.factor;               // weather-adjusted full range
    const usableNow = effRange * (batteryPct/100) * 0.9; // 10% reserve
    const fullLeg   = effRange * 0.9;
    const coords=route.geometry.coordinates;

    /* battery curve sample points */
    const curve=[];
    for (let f=0; f<=1.0001; f+=0.2){
      const dist=totalKm*f;
      const used=dist/effRange*100;
      curve.push({ km:Math.round(dist), pct:Math.max(0,Math.round(batteryPct-used)) });
    }

    const chargeStops=[];
    if (totalKm>usableNow){
      let covered=usableNow;
      while (covered<totalKm){
        const pt=this.pointAlong(coords,covered/totalKm);
        /* Module 44 #3,#4 — search the FULL dataset (DC preferred), never just visible ones */
        const pool = (MapMod.masterStations && MapMod.masterStations.length) ? MapMod.masterStations : [...MapMod.stationStore.values()];
        let near=null,best=Infinity, nearAny=null,bestAny=Infinity;
        pool.forEach(s=>{
          const d=U.haversine(pt.lat,pt.lon,s.lat,s.lon);
          if (d<bestAny){ bestAny=d; nearAny=s; }
          if (s.type==='DC' && d<best){ best=d; near=s; }
        });
        /* prefer DC; if none reasonably close, fall back to ANY charger so route stays feasible */
        const chosen = (near && best<=60) ? near : nearAny;
        /* speed: café count is fetched in the background AFTER the plan renders
           (Overpass can take many seconds — it must never block planning) */
        chargeStops.push({ atKm:Math.round(covered), point:pt,
          pctAtStop:Math.max(5,Math.round(batteryPct-covered/effRange*100)),
          station:chosen, detourKm:chosen?+U.haversine(pt.lat,pt.lon,chosen.lat,chosen.lon).toFixed(1):null,
          cafesNearby:null });
        covered+=fullLeg;
      }
    }
    return { effRange:Math.round(effRange), usableNow:Math.round(usableNow), curve, chargeStops };
  },

  renderSummary(p){
    this._csMarkers=[];
    const sum=document.getElementById('tripSummary');
    const a=p.pts[0].name, b=p.pts[p.pts.length-1].name;
    let html=`<div class="trip-card">
      <h4>${U.esc(a)} → ${U.esc(b)}</h4>
      <div class="tc-row">Distance: <b>${p.km} km</b></div>
      <div class="tc-row">Drive time: <b>${U.fmtTime(p.min)}</b> · ETA <b>${U.etaClock(p.min)}</b></div>
      <div class="tc-row">Weather (mid-route): <b>${U.esc(p.wx.note)}</b> · range ×${p.wx.factor}</div>
      <div class="tc-row">Usable range now: <b>${p.usableNow} km</b> of ${p.effRange} km</div>
    </div>`;

    /* battery curve bar */
    html+=`<div class="trip-card"><h4>Battery forecast</h4><div class="batt-curve">`;
    p.curve.forEach(c=>{
      const col=c.pct>40?'#2dd4a7':c.pct>20?'#f5a623':'#f0556a';
      html+=`<div class="bc-col"><div class="bc-bar" style="height:${Math.max(4,c.pct)}%;background:${col}"></div><div class="bc-pct">${c.pct}%</div><div class="bc-km">${c.km}</div></div>`;
    });
    html+=`</div><div class="tc-row" style="margin-top:4px;font-size:11px">km along route →</div></div>`;

    if (p.chargeStops.length){
      html+=`<div class="trip-card"><h4>Charging stop plan (${p.chargeStops.length})</h4>`;
      p.chargeStops.forEach((cs,i)=>{
        const st=cs.station;
        html+=`<div class="cs-block">
          <div class="cs-head">Stop ${i+1} · ~km ${cs.atKm} · battery ≈ <b>${cs.pctAtStop}%</b></div>`;
        if (st){
          html+=`<div class="cs-name">${U.esc(st.name)}</div>
            <div class="cs-rows">
              <span>Operator: <b>${U.esc(st.operator||'—')}</b></span>
              <span>Type: <b>${st.type}${st.powerKW?` · ${st.powerKW}kW`:''}</b></span>
              ${st.connector?`<span>Connector: <b>${U.esc(st.connector)}</b></span>`:''}
              ${cs.detourKm!=null?`<span>Detour: <b>${cs.detourKm} km</b></span>`:''}
              ${st.pricing?`<span>Price: <b>${U.esc(st.pricing)}</b></span>`:''}
              ${st.availability?`<span>Status: <b>${U.esc(st.availability)}</b></span>`:''}
              <span>Charge time: <b>~${st.type==='DC'?'30–45 min':'3–5 hr'}</b></span>
              <span id="csCafes${i}" style="display:none"></span>
            </div>
            <div class="cs-acts">
              ${st.phone?`<a href="tel:${U.esc(st.phone)}">Call</a>`:''}
              ${st.website?`<a href="${U.esc(st.website)}" target="_blank" rel="noopener">Web</a>`:''}
              <a href="#" onclick="Trip.stopDetails(${i});return false">Details</a>
              <a href="#" onclick="MapMod.map.setView([${st.lat},${st.lon}],15);return false">Show</a>
            </div>`;
          const det=this._pauseDetailRows(st,'charge');
          const mk=L.marker([st.lat,st.lon],{ icon:MapMod.pin3D('⚡','#f5a623',34), zIndexOffset:600 }).addTo(MapMod.map)
            .bindPopup(`<b>Charge stop ${i+1} — ${U.esc(st.name)}</b><br>Battery here ≈ <b>${cs.pctAtStop}%</b>${det?`<br><a class="pp-more" onclick="Trip.togglePauseDetails(this)">Details ▾</a><div class="pp-det" style="display:none">${det}</div>`:''}`,{maxWidth:290});
          this.routeMarkers.push(mk);
          this._csMarkers[i]=mk;
        } else {
          html+=`<div class="cs-rows"><span style="color:var(--orange)">No charger found near this segment — extend search radius or add a manual stop.</span></div>`;
        }
        html+=`</div>`;
      });
      html+=`</div>`;
    } else {
      html+=`<div class="trip-card"><h4>No charging needed</h4><div class="tc-row">Battery covers the trip with a 10% reserve.</div></div>`;
    }

    /* offline export */
    html+=`<div class="trip-card"><h4>Offline package</h4>
      <div class="dl-row">
        <button class="btn sm" onclick="Trip.exportPlan('json')">JSON</button>
        <button class="btn sm" onclick="Trip.exportPlan('gpx')">GPX</button>
        <button class="btn sm" onclick="Trip.exportPlan('pdf')">PDF</button>
      </div></div>`;

    /* Module 44 #10 — trip action bar */
    html+=`<div class="trip-actions">
      <button class="btn" onclick="Trip.saveCurrent()">Save</button>
      <button class="btn" onclick="Trip.startNavigation()">Start</button>
      <button class="btn gmaps" onclick="SmartTrip.openInGoogleMaps()">Go via Google Maps</button>
      <button class="btn ghost" onclick="Trip.cancelTrip()">Cancel</button>
    </div>`;
    sum.innerHTML=html;
  },

  /* ───── NAVIGATION MODE (Module 44 #11) ───── */
  /* ── keep the route inside India ──
     If the shortest OSRM path cuts through Nepal/Bangladesh/etc., pull the
     escaping stretch back with an in-India via-point and re-route (max 3 passes). */
  async keepRouteInIndia(pts, data){
    try{
      const india=await Boundaries.load('india'); if(!india) return data;
      const geom=india.features?india.features[0].geometry:india.geometry||india;
      const inside=(lon,lat)=>U.pointInGeoJSON(lon,lat,geom);
      let route=data.routes[0], vias=[];
      for (let pass=0; pass<3; pass++){
        const cs=route.geometry.coordinates;
        const step=Math.max(1,Math.floor(cs.length/400));
        let out=[];
        for (let i=0;i<cs.length;i+=step) if(!inside(cs[i][0],cs[i][1])) out.push(i);
        if (!out.length) break;                       // fully inside — done
        /* midpoint of the escape, pulled back toward India until inside */
        const mid=cs[out[Math.floor(out.length/2)]];
        let via=null;
        for (const [dx,dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]){
          for (let d=0.15; d<=1.6; d+=0.15){
            const lon=mid[0]+dx*d, lat=mid[1]+dy*d;
            if (inside(lon,lat)){ via=[lon,lat]; break; }
          }
          if (via) break;
        }
        if (!via) break;
        vias.push(via);
        /* rebuild waypoint string with vias inserted between start and end */
        const wp=[`${pts[0].lon},${pts[0].lat}`,
                  ...vias.map(v=>`${v[0]},${v[1]}`),
                  ...pts.slice(1).map(p=>`${p.lon},${p.lat}`)].join(';');
        const r2=await fetch(`${CONFIG.OSRM}/route/v1/driving/${wp}?overview=full&geometries=geojson&steps=false`);
        const d2=await r2.json();
        if (!d2.routes?.length) break;
        route=d2.routes[0]; data=d2;
      }
      if (vias.length) U.toast('Route adjusted to stay within India',3500);
    }catch(e){ console.warn('border guard skipped:',e); }
    return data;
  },

  /* ── on-route charger scan: stations within `corridorKm` of the polyline,
        positioned by km along the route ── */
  scanRouteChargers(coords, totalKm, corridorKm=4){
    const pool=(MapMod.masterStations&&MapMod.masterStations.length)?MapMod.masterStations:MapMod.allStations;
    const step=Math.max(1,Math.floor(coords.length/300));
    const found=new Map();
    for(let i=0;i<coords.length;i+=step){
      const [lon,lat]=coords[i], frac=i/(coords.length-1);
      for(const s of pool){
        if (Math.abs(s.lat-lat)>0.06||Math.abs(s.lon-lon)>0.06) continue;
        if (U.haversine(lat,lon,s.lat,s.lon)>corridorKm) continue;
        const km=totalKm*frac;
        if (!found.has(s.id)||found.get(s.id).km>km) found.set(s.id,{station:s,km:Math.round(km*10)/10,frac});
      }
    }
    return [...found.values()].sort((a,b)=>a.km-b.km);
  },

  /* bearing between two [lon,lat] points, degrees clockwise from north */
  _bearing(a,b){
    const toR=Math.PI/180, la1=a[1]*toR, la2=b[1]*toR, dLon=(b[0]-a[0])*toR;
    const y=Math.sin(dLon)*Math.cos(la2);
    const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLon);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  },
  /* north-up follow: NO map rotation (keeps the map readable, edges never cut).
     3D view is handled purely by the CSS .view-3d class (tilt only, no spin). */
  _applyHeading(target){
    this._hdg=0;   // always north-up
  },
  _clearHeading(){
    const el=document.getElementById('map'); el.style.transform='';
    this._hdg=0;
  },

  startNavigation(fromIndex, fromBattery){
    if (!this.lastPlan){ U.toast('Plan a trip first'); return; }
    const p=this.lastPlan;
    document.body.classList.add('nav-mode');
    const coords=p.route.geometry.coordinates;
    const total=coords.length;
    let i = fromIndex ? Math.min(total-1, Math.max(0, fromIndex)) : 0;
    this._navStartIndex=i;
    document.getElementById('navHud').classList.add('show');
    document.body.classList.add('nav-follow');
    setTimeout(()=>MapMod.map.invalidateSize(),80);
    this._hdg=this._hdg||0;
    MapMod.map.setView([coords[i][1],coords[i][0]],14);

    /* NAV MODE VISIBILITY: only the route + on-route chargers — nothing else */
    MapMod.hideStations();
    SmartTrip.clearSSMarkers && SmartTrip.clearSSMarkers();
    const totalKm=parseFloat(p.km), range=p.effRange||p.range||300;
    const reserveKm=Math.max(12, range*0.08);         // never plan below ~8% reserve
    const startBatt=(fromBattery!=null)?fromBattery:p.battery;
    if (!fromIndex || !this._routeChargers){
      this._routeChargers=this.scanRouteChargers(coords,totalKm);
    }

    /* ── PLAN THE STOPS ONCE (petrol-tank rule, computed up-front) ──
       walk the route: while destination isn't reachable with reserve, jump to
       the FURTHEST reachable charger, fill to 100%, repeat. Deterministic —
       the battery can never run flat unless the route truly has a dead gap. */
    if (!fromIndex || !this._chargePlan){
      const plan=[]; let pos=0, b=startBatt; this._routeGap=null;
      for (let guard=0; guard<40; guard++){
        const canGo=b/100*range - reserveKm;
        if (pos+canGo>=totalKm) break;                       // destination reachable
        const reach=this._routeChargers.filter(rc=>rc.km>pos+0.5 && rc.km<=pos+canGo);
        if (!reach.length){                                   // dead gap on the route
          const nxt=this._routeChargers.find(rc=>rc.km>pos);
          this._routeGap={ fromKm:Math.round(pos), needKm:Math.round((nxt?nxt.km:totalKm)-pos) };
          break;
        }
        const stop=reach[reach.length-1];                     // furthest reachable pump
        plan.push(stop); pos=stop.km; b=100;
      }
      this._chargePlan=plan;
      if (this._routeGap)
        U.toast(`Heads-up: after km ${this._routeGap.fromKm} there is a ${this._routeGap.needKm} km stretch with no charger in range — a detour will be needed there.`,8000);
      else if (plan.length)
        U.toast(`Charging plan ready: ${plan.length} stop${plan.length>1?'s':''} — ${plan.map(p=>U.esc(p.station.name)).join(' → ')}`,6000);
    }

    const veh=L.circleMarker([coords[i][1],coords[i][0]],{radius:9,color:'#fff',weight:3,fillColor:'#2dd4a7',fillOpacity:1}).addTo(MapMod.map);
    this._navVeh=veh; this._navTimer&&clearInterval(this._navTimer); this._warned=this._warned||{};
    if (!fromIndex || !this._timeline){
      this._timeline={ name:`${p.pts[0]?.name} → ${p.pts.at(-1)?.name}`, startedAt:new Date().toISOString(),
        km:p.km, min:p.min, battery:p.battery, samples:[], events:[],
        chargeStops:[], breakStops:[], stateCrossings:[] };
      this._breaksDone=0; this._curState=null;
    } else { this._timeline.events.push('Resumed after charging'); }
    const avgKmh=totalKm/(p.min/60)||45;
    const kmAtStart=totalKm*(i/(total-1));

    this._navTimer=setInterval(()=>{
      i+=Math.max(1,Math.round(total/240));
      if (i>=total) i=total-1;
      const c=coords[i]; veh.setLatLng([c[1],c[0]]);
      MapMod.map.panTo([c[1],c[0]],{animate:true,duration:.4});
      const look=coords[Math.min(total-1,i+Math.max(2,Math.round(total/120)))];
      this._applyHeading(this._bearing(c,look));
      const frac=i/(total-1);
      this._navIndex=i;
      const doneKm=totalKm*frac;
      const remKm=(totalKm*(1-frac)).toFixed(1);
      const legKm=doneKm-kmAtStart;
      const batt=Math.max(0,Math.round(startBatt-(legKm/range)*100));
      const remMin=Math.round(p.min*(1-frac));
      const spd=Math.round(avgKmh*(0.85+Math.random()*0.3));
      const kmCanGo=batt/100*range;

      document.getElementById('navDist').textContent=remKm+' km';
      document.getElementById('navEta').textContent=U.fmtTime(remMin);
      document.getElementById('navBatt').textContent=batt+'%';
      document.getElementById('navBatt').style.color=batt>40?'#2dd4a7':batt>20?'#f5a623':'#f0556a';
      const navSpd=document.getElementById('navSpeed'); if(navSpd) navSpd.textContent=spd+' km/h';
      const navRange=document.getElementById('navRange'); if(navRange) navRange.textContent=Math.round(kmCanGo)+' km';
      this._timeline.samples.push({ km:+doneKm.toFixed(1), battery:batt, speed:spd, lat:c[1], lon:c[0] });
      /* state-change welcome (throttled — every ~10 ticks) */
      this._navDoneKm=doneKm;
      if (!this._stTick || (i-this._stTick)>=Math.max(4,Math.round(total/60))){ this._stTick=i; this._detectState(c[1],c[0]); }

      /* ── EXECUTE THE CHARGE PLAN ── */
      const nextStop=(this._chargePlan||[]).find(p=>p.km>doneKm-0.4);
      const ahead=this._routeChargers.filter(rc=>rc.km>doneKm-0.3);
      document.getElementById('navNext').textContent =
        nextStop?`Planned charge stop in ${Math.max(0,(nextStop.km-doneKm)).toFixed(1)} km — ${nextStop.station.name}`
        :(ahead[0]?`Charger in ${Math.max(0,(ahead[0].km-doneKm)).toFixed(1)} km — ${ahead[0].station.name}`:'Destination ahead');

      if (nextStop && (nextStop.km-doneKm)<=Math.max(1.2,totalKm/240)){
        /* stop: draw a red sub-route from the highway to the station, drive along it,
           show ONLY its 3D pin, then Boney asks to charge */
        clearInterval(this._navTimer); this._navTimer=null;
        this._atStop=true;
        this._chargePlan=this._chargePlan.filter(p=>p!==nextStop);
        this._pausedAt={ idx:i, batt };
        this._timeline.chargeStops.push({atKm:nextStop.km,station:nextStop.station.name,lat:nextStop.station.lat,lon:nextStop.station.lon});
        document.getElementById('navNext').innerHTML=`<span class="nav-charging">Approaching ${U.esc(nextStop.station.name)}…</span>`;
        this.driveToStop(c, nextStop.station, 'charge', batt);
        U.speak&&U.speak('Approaching your planned charging stop.');
        return;
      }
      /* ── #25 AUTO-STOP AT 15% ── if the driver never stops and battery hits 15%,
         the car halts itself and opens the SAME pause/scan flow (5 km pulse,
         chargers marked, amenity search). Fires once per 15%→ crossing. */
      if (batt<=15 && !this._paused && !this._atStop && !this._warned['lowbatt'+Math.floor(doneKm/50)]){
        this._warned['lowbatt'+Math.floor(doneKm/50)]=true;
        clearInterval(this._navTimer); this._navTimer=null;
        this._timeline.events.push(`Auto-stop — battery ${batt}% at km ${Math.round(doneKm)}`);
        U.toast(`Battery at ${batt}% — stopping to find a charger nearby.`,5000);
        U.speak&&U.speak(`Battery low at ${batt} percent. Stopping to locate a charger.`);
        Agent.lowBattery && Agent.lowBattery(batt);
        this.pauseTrip();          // full 5 km scan + amenity search + click-to-charge
        return;
      }
      if (this._routeGap && doneKm>=this._routeGap.fromKm-2 && !this._warned.gapNow){
        this._warned.gapNow=true;
        U.toast(`Entering the ${this._routeGap.needKm} km no-charger stretch — in a real drive, detour to charge first.`,7000);
      }

      /* every ~2 h: Boney only SUGGESTS a break (Yes/No) — never auto-pauses */
      const drivenMin=p.min*frac;
      if (drivenMin > 120*((this._breaksDone||0)+1)){
        this._breaksDone=(this._breaksDone||0)+1;
        Agent.askBreak && Agent.askBreak(Math.round(drivenMin/60*10)/10);
      }

      if (batt<=0 && !this._warned.dead){ this._warned.dead=true;
        clearInterval(this._navTimer);
        document.getElementById('navNext').textContent='Battery depleted — trip halted';
        U.toast('Battery depleted — navigation stopped.',6000);
        U.speak&&U.speak('Battery depleted. Navigation stopped.');
        return;
      }
      if (i>=total-1){ clearInterval(this._navTimer);
        this._timeline.endedAt=new Date().toISOString(); this._timeline.events.push('Arrived at destination');
        document.getElementById('navNext').innerHTML =
          'Arrived — trip report: <button class="nav-charge-btn" onclick="Trip.tripReport(\'docx\')">Word</button> <button class="nav-charge-btn" onclick="Trip.tripReport(\'pdf\')">PDF</button> <button class="nav-charge-btn ghost" onclick="this.parentElement.textContent=\'Arrived\'">Not now</button>';
        U.toast('Trip complete. Want the full trip report? Use the button in the top bar.',6000);
        U.speak&&U.speak('You have arrived at your destination'); }
    },300);
    U.toast('Navigation started');
  },

  /* ═══ PAUSE ENGINE ═══
     Pause (button or Boney's Yes) → pulse scans a 5 km circle, charging
     stations inside it are marked, an amenity SEARCH BAR appears — type
     anything (cafe, hotel, hospital…) and matches are marked too. Click any
     marked point → sub-route draws → the car drives there and waits.
     Resume → the car returns to the main route and the trip continues.   */
  _pulse:null,_pulseT:null,_pulseRing:null,_breakMarkers:[],_paused:false,_atStop:false,
  /* repeating 5 km pulse: an outer fixed ring + an inner ring that grows & fades on loop */
  _startPulse(here){
    this._pulseHere=here;
    /* fixed boundary ring at 5 km */
    this._pulseRing=L.circle([here.lat,here.lon],{radius:5000,color:'#2dd4a7',weight:2,fill:true,fillColor:'#2dd4a7',fillOpacity:.06,dashArray:'6 6'}).addTo(MapMod.map);
    /* animated inner pulse */
    this._pulse=L.circle([here.lat,here.lon],{radius:300,color:'#2dd4a7',weight:2.5,fillColor:'#2dd4a7',fillOpacity:.14}).addTo(MapMod.map);
    let r=300;
    this._pulseT=setInterval(()=>{
      r+=340;
      if (r>5000){ r=300; }                         // loop back — keeps pulsing
      const op=Math.max(0, .16*(1-(r-300)/4700));
      if (this._pulse){ this._pulse.setRadius(r); this._pulse.setStyle({fillOpacity:op, opacity:Math.max(.2,op*4)}); }
    },60);
  },
  _clearPulse(){ this._pulseT&&clearInterval(this._pulseT); this._pulseT=null;
    if(this._pulse){ MapMod.map.removeLayer(this._pulse); this._pulse=null; }
    if(this._pulseRing){ MapMod.map.removeLayer(this._pulseRing); this._pulseRing=null; }
    this._breakMarkers.forEach(m=>MapMod.map.removeLayer(m)); this._breakMarkers=[]; },

  togglePause(){
    if (this._paused){ this.resumeFromBreak(); return; }
    this.pauseTrip();
  },
  _setPauseBtn(on){
    const b=document.getElementById('navPauseBtn'); if(!b) return;
    b.textContent=on?'▶ Resume':'⏸ Pause';
    b.classList.toggle('on',on);
  },

  async pauseTrip(){
    if (!this._navTimer && !this.lastPlan) return;
    clearInterval(this._navTimer); this._navTimer=null;
    this._paused=true; this._setPauseBtn(true);
    const p=this.lastPlan, coords=p.route.geometry.coordinates;
    const idx=this._navIndex||0;
    this._pausedAt={ idx, batt:parseInt(document.getElementById('navBatt').textContent)||50 };
    const c=coords[idx], here={lat:c[1],lon:c[0]};
    this._pauseHere=here;
    document.getElementById('navNext').innerHTML='<span class="nav-charging">Paused — scanning 5 km around you…</span>';

    /* continuous 5 km pulse — grows to the ring, fades, repeats; keeps
       pulsing the whole time we're paused/searching (stops on resume/select) */
    this._clearPulse();
    this._startPulse(here);
    MapMod.map.setView([here.lat,here.lon],13);

    /* chargers inside 5 km — marked immediately, click-to-go */
    const pool=(MapMod.masterStations&&MapMod.masterStations.length)?MapMod.masterStations:[];
    const chargers=pool.filter(s=>U.haversine(here.lat,here.lon,s.lat,s.lon)<=5).slice(0,15);
    chargers.forEach(st=>this._addPauseMarker(st,'charge'));

    let el=document.getElementById('navSuggest');
    if (!el){ el=document.createElement('div'); el.id='navSuggest'; el.className='nav-suggest'; document.body.appendChild(el); }
    el.innerHTML=`<div style="width:100%">
      <div class="ns-txt"><b>${chargers.length}</b> charging station${chargers.length===1?'':'s'} within <b>5 km</b> — marked on the map. Tap any marker to drive there.</div>
      <div class="ns-search"><input id="pauseAmenQ" type="text" placeholder="Search any amenity… (cafe, hotel, hospital, atm)">
        <button onclick="Trip.pauseAmenitySearch()">Search</button></div>
      <div class="ns-txt hint" id="pauseAmenMsg"></div>
      <div class="ns-acts"><button onclick="Trip.resumeFromBreak()">Resume trip</button></div></div>`;
    el.classList.add('show');
    document.getElementById('pauseAmenQ').addEventListener('keydown',e=>{ if(e.key==='Enter') this.pauseAmenitySearch(); });
    document.getElementById('navNext').innerHTML=`<span class="nav-charging">Paused</span> — ${chargers.length} charger(s) in 5 km`;
    U.speak&&U.speak(`Trip paused. ${chargers.length} charging stations within five kilometres are marked.`);
  },

  _addPauseMarker(target, kind){
    const emoji=kind==='rest'?'📍':'⚡', col=kind==='rest'?'#f5a623':'#2dd4a7';
    const mk=L.marker([target.lat,target.lon],{ icon:MapMod.pin3D(emoji,col,34), zIndexOffset:800 }).addTo(MapMod.map);
    const label=target.name||'Place';
    const det=this._pauseDetailRows(target, kind);
    const detBlock = det
      ? `<br><a class="pp-more" onclick="Trip.togglePauseDetails(this)">Details ▾</a><div class="pp-det" style="display:none">${det}</div>`
      : '';
    mk.bindPopup(`<b>${U.esc(label)}</b><br><button class="nav-charge-btn" style="margin-top:6px" onclick="Trip.goToStop(${target.lat},${target.lon},'${kind}','${U.esc(label).replace(/'/g,"\\'")}','${target.id||''}')">Go here</button>${detBlock}`,{maxWidth:290});
    this._breakMarkers.push(mk);
  },

  /* build the hidden detail rows for a pause-scan popup.
     Chargers carry the full master-station record; amenity spots carry only
     name + coordinates, so we show what genuinely exists — nothing invented. */
  _pauseDetailRows(t, kind){
    const row=(l,v)=>v?`<div class="ppd-row"><span>${l}</span><b>${v}</b></div>`:'';
    const esc=U.esc;
    const rows=[];
    if (kind!=='rest'){
      const st = (t.id && MapMod.masterStations && MapMod.masterStations.find(s=>s.id===t.id)) || t;
      rows.push(row('Operator', esc(st.operator||st.network||'')));
      if (st.network && st.network!==st.operator) rows.push(row('Network', esc(st.network)));
      rows.push(row('Category', esc(st.category||st.type||'')));
      const pw=[st.powerKW?`${st.powerKW} kW`:null, st.fast?'Fast':null, st.ultra?'Ultra-fast':null].filter(Boolean).join(' · ');
      rows.push(row('Power', esc(pw)));
      rows.push(row('Connector', esc(st.connector||'')));
      const pc=[st.ports?`${st.ports} port${st.ports>1?'s':''}`:null,
                (st.acCount||st.dcCount)?`AC ${st.acCount||0} / DC ${st.dcCount||0}`:null].filter(Boolean).join(' · ');
      rows.push(row('Points', esc(pc)));
      const stt=[st.status&&st.status!=='Unknown'?st.status:null, st.operational===false?'Not operational':null,
                 st.open247?'Open 24×7':null].filter(Boolean).join(' · ');
      rows.push(row('Status', esc(stt)));
      rows.push(row('Access', esc(st.access||'')));
      rows.push(row('Pricing', esc(st.pricing||'')));
      const addr=[st.address,st.area,st.city,st.district,st.state,st.pincode].filter(Boolean).join(', ');
      rows.push(row('Address', esc(addr)));
      if (st.phone) rows.push(row('Phone', `<a href="tel:${esc(st.phone)}">${esc(st.phone)}</a>`));
      if (st.website) rows.push(row('Website', `<a href="${esc(st.website)}" target="_blank" rel="noopener">Open ↗</a>`));
      if (st.rating) rows.push(row('Rating', `${esc(String(st.rating))}★${st.ratingCount?` (${st.ratingCount})`:''}`));
      rows.push(row('Updated', esc(st.updated||'')));
    } else {
      rows.push(row('Type', 'Amenity / rest stop'));
      if (this._pauseHere) rows.push(row('From you', U.haversine(this._pauseHere.lat,this._pauseHere.lon,t.lat,t.lon).toFixed(1)+' km'));
      rows.push(row('Location', `${(+t.lat).toFixed(5)}, ${(+t.lon).toFixed(5)}`));
    }
    const body=rows.filter(Boolean).join('');
    return body||null;
  },

  /* expand/collapse the popup's detail section, then re-layout the popup */
  togglePauseDetails(a){
    const d=a.nextElementSibling; if(!d) return;
    const open=d.style.display!=='none';
    d.style.display=open?'none':'block';
    a.textContent=open?'Details ▾':'Details ▴';
    const pp=MapMod.map&&MapMod.map._popup; if(pp&&pp.update) pp.update();
  },

  /* "Details" in a charge-stop card → fly to that stop and open its rich popup */
  stopDetails(i){
    const mk=(this._csMarkers||[])[i]; if(!mk) return;
    MapMod.map.setView(mk.getLatLng(), 14, {animate:true});
    mk.openPopup();
  },

  /* background café counts for charge stops — patches the summary when ready */
  async _enrichCafes(plan){
    if (!plan || !plan.chargeStops || !plan.chargeStops.length) return;
    await Promise.allSettled(plan.chargeStops.map(async (cs,i)=>{
      try{
        const n=await Amen.countOnly('cafe', cs.point.lat, cs.point.lon, 4000);
        if (n!=null){ cs.cafesNearby=n;
          const el=document.getElementById('csCafes'+i);
          if (el){ el.innerHTML=`<b>${n}</b> cafés to wait`; el.style.display='inline'; } }
      }catch(e){}
    }));
  },

  /* free-text amenity search inside the 5 km ring */
  async pauseAmenitySearch(){
    const q=(document.getElementById('pauseAmenQ')?.value||'').trim().toLowerCase();
    const msg=document.getElementById('pauseAmenMsg');
    if (!q||!this._pauseHere){ return; }
    msg.textContent='Searching "'+q+'" within 5 km…';
    /* clear previous rest markers, keep chargers */
    this._breakMarkers=this._breakMarkers.filter(m=>{ if(m._rest){ MapMod.map.removeLayer(m); return false; } return true; });
    const {lat,lon}=this._pauseHere;
    let items=[];
    /* known category → Amen engine; anything else → raw Overpass name/amenity match */
    const key=Object.keys(Amen.CATALOG||{}).length?Object.keys(Amen.CATALOG).flatMap(g=>Object.keys(Amen.CATALOG[g])).find(k=>{ const cat=Amen.findCat(k); return k===q||(cat&&cat.label.toLowerCase().includes(q)); }):null;
    try{
      if (key) items=await Amen.fetchNear(key,lat,lon,5000);
      else {
        const ql=`[out:json][timeout:15];(node["amenity"="${q}"](around:5000,${lat},${lon});node["name"~"${q}",i](around:5000,${lat},${lon});node["shop"="${q}"](around:5000,${lat},${lon}););out center 25;`;
        const d=await Amen.overpassFetch(ql);
        items=(d.elements||[]).map(e=>({lat:e.lat??e.center?.lat,lon:e.lon??e.center?.lon,name:e.tags?.name||q})).filter(x=>x.lat&&x.lon);
      }
    }catch(e){}
    (items||[]).slice(0,15).forEach(it=>{ const before=this._breakMarkers.length;
      this._addPauseMarker(it,'rest'); this._breakMarkers[before]._rest=true; });
    msg.textContent=(items&&items.length)?`${Math.min(15,items.length)} "${q}" spot(s) marked — tap one and "Go here".`:`Nothing found for "${q}" within 5 km.`;
  },

  /* pause-flow: a marked charger/amenity was tapped → drive there */
  async goToStop(lat,lon,kind,name,id){
    const p=this.lastPlan, coords=p.route.geometry.coordinates;
    const idx=(this._pausedAt&&this._pausedAt.idx)||this._navIndex||0;
    const c=coords[idx];
    const target = (id && MapMod.masterStations.find(s=>s.id===id)) || {lat,lon,name};
    MapMod.map.closePopup();
    /* hide the other pause markers — only the chosen target's pin stays */
    this._breakMarkers.forEach(m=>MapMod.map.removeLayer(m)); this._breakMarkers=[];
    this._clearPulse();
    await this.driveToStop(c, target, kind==='rest'?'rest':'charge', (this._pausedAt&&this._pausedAt.batt)||40);
  },

  /* ═══ shared: animate the car along the red sub-route, then prompt at arrival ═══ */
  async driveToStop(fromCoord, target, kind, batt){
    this._atStop=true;
    await this._showStopPoint(fromCoord, target, kind);   // red subroute + 3D pin + popup
    const line=this._stopArtifacts.find(o=>!o._isPin);
    const path=(line&&line.getLatLngs)?line.getLatLngs():[[fromCoord[1],fromCoord[0]],[target.lat,target.lon]];
    const flat=path.map(pt=>[pt.lat??pt[0], pt.lng??pt[1]]);
    const arrive=()=>{
      if (kind==='rest'){
        this._timeline.breakStops.push({name:target.name,lat:target.lat,lon:target.lon});
        this._timeline.events.push(`Break at ${target.name}`);
        document.getElementById('navNext').innerHTML=
          `<span class="nav-charging">Resting at ${U.esc(target.name)}</span> — <button class="nav-charge-btn" onclick="Trip.resumeFromBreak()">Resume trip</button>`;
      } else {
        /* Boney asks — Start charging, with a Stop-anytime / charge-to-100 choice */
        document.getElementById('navNext').innerHTML=
          `<span class="nav-charging">Arrived at ${U.esc(target.name)}</span> — Boney: <b>Do you want to charge?</b>
           <button class="nav-charge-btn" onclick="Trip.startCharging(${batt},100)">Start charging → 100%</button>
           <button class="nav-charge-btn ghost" onclick="Trip.resumeFromBreak()">Skip</button>`;
        U.speak&&U.speak('Arrived at the charging station. Do you want to charge?');
      }
    };
    if (this._navVeh && flat.length>1){
      let step=0, N=Math.max(10,Math.min(40,flat.length));
      const pick=k=>flat[Math.min(flat.length-1,Math.round(k*(flat.length-1)/(N-1)))];
      const anim=setInterval(()=>{ step++;
        this._navVeh.setLatLng(pick(step));
        if (step>=N-1){ clearInterval(anim); arrive(); }
      },80);
    } else { if(this._navVeh) this._navVeh.setLatLng([target.lat,target.lon]); arrive(); }
  },

  resumeFromBreak(){
    this._clearPulse();
    this._clearStopArtifacts(false);
    this._paused=false; this._atStop=false; this._setPauseBtn(false);
    const el=document.getElementById('navSuggest'); el&&el.classList.remove('show');
    const p=this._pausedAt||{idx:this._navIndex,batt:50};
    this.exitNavigation(true);
    this.startNavigation(p.idx, p.batt);
    U.toast('Back on the main route — trip resumed');
  },

  exitNavigation(keepTimeline){
    this._paused=false; this._setPauseBtn(false);
    document.body.classList.remove('nav-follow');
    this._clearHeading();
    setTimeout(()=>MapMod.map.invalidateSize(),80);
    document.body.classList.remove('nav-mode');
    document.getElementById('navHud').classList.remove('show');
    this._navTimer&&clearInterval(this._navTimer);
    if (this._navVeh){ MapMod.map.removeLayer(this._navVeh); this._navVeh=null; }
    const ns=document.getElementById('navSuggest'); if(ns) ns.classList.remove('show');
    if (!keepTimeline){
      this._chargerMarkers&&this._chargerMarkers.forEach(mk=>MapMod.map.removeLayer(mk)); this._chargerMarkers=null; this._routeChargers=null;
      this._chargePlan=null; this._routeGap=null;
      this._pulse&&this._clearPulse();
      this._clearStopArtifacts(false);
      MapMod.showStations();
    }
    if (keepTimeline) return;          // resuming — don't save/clear yet
    /* save completed journey to history (M20) */
    if (this._timeline && this._timeline.samples.length>3){
      this._timeline.endedAt=this._timeline.endedAt||new Date().toISOString();
      const hist=U.load('journeys',[]); hist.push({...this._timeline,id:Date.now()});
      U.store('journeys',hist.slice(-25)); this.renderJourneys();
      U.toast('Journey saved to history — replay it from “Past journeys”');
    }
    this._timeline=null;
  },

  /* ───── M20 — Trip Timeline & Replay ───── */
  renderJourneys(){
    const root=document.getElementById('journeyList'); if(!root) return;
    const hist=U.load('journeys',[]);
    if (!hist.length){ root.innerHTML='<div class="note">No completed journeys yet. Start a trip and finish it to record one.</div>'; return; }
    root.innerHTML=hist.slice().reverse().map(j=>`
      <div class="data-item" style="cursor:default;flex-wrap:wrap">
        <span style="flex:1;min-width:120px">${U.esc(j.name||'Journey')}<br><span style="font-size:10.5px;color:var(--muted)">${j.km} km · battery ${j.battery}%→${j.samples?.at(-1)?.battery??'?'}% · ${new Date(j.startedAt).toLocaleDateString()}</span></span>
        <div class="st-acts">
          <button class="wp-mv" onclick="Trip.replayJourney(${j.id})" title="Replay">▶</button>
          <button class="wp-del" onclick="Trip.deleteJourney(${j.id})" title="Delete">✕</button>
        </div>
      </div>`).join('');
  },
  replayJourney(id){
    const j=U.load('journeys',[]).find(x=>x.id===id); if(!j||!j.samples?.length){ U.toast('No replay data'); return; }
    App.openDrawer && App.openDrawer('trip');
    /* draw the recorded path */
    this.clearRoute();
    const latlngs=j.samples.map(s=>[s.lat,s.lon]);
    this.routeLayer=L.polyline(latlngs,{color:'#b78bfa',weight:5,opacity:.85}).addTo(MapMod.map);
    MapMod.map.fitBounds(this.routeLayer.getBounds(),{padding:[60,60]});
    const veh=L.circleMarker(latlngs[0],{radius:9,color:'#fff',weight:3,fillColor:'#b78bfa',fillOpacity:1}).addTo(MapMod.map);
    this.routeMarkers.push(veh);
    /* battery history mini-card */
    const sum=document.getElementById('tripSummary');
    sum.innerHTML=`<div class="trip-card"><h4>🛣️ Replay — ${U.esc(j.name)}</h4>
      <div class="tc-row">Distance <b>${j.km} km</b> · battery <b>${j.battery}%→${j.samples.at(-1).battery}%</b></div>
      <div class="batt-curve" id="replayCurve"></div>
      <div class="tc-row" style="font-size:11px">battery % over distance →</div></div>`;
    const cv=document.getElementById('replayCurve');
    const step=Math.max(1,Math.floor(j.samples.length/14));
    for(let k=0;k<j.samples.length;k+=step){ const s=j.samples[k];
      const col=s.battery>40?'#2dd4a7':s.battery>20?'#f5a623':'#f0556a';
      cv.innerHTML+=`<div class="bc-col"><div class="bc-bar" style="height:${Math.max(4,s.battery)}%;background:${col}"></div><div class="bc-pct">${s.battery}</div><div class="bc-km">${Math.round(s.km)}</div></div>`;
    }
    /* animate vehicle along recorded samples */
    let i=0; this._replayTimer&&clearInterval(this._replayTimer);
    this._replayTimer=setInterval(()=>{ i+=step; if(i>=j.samples.length){ clearInterval(this._replayTimer); return; } veh.setLatLng([j.samples[i].lat,j.samples[i].lon]); },200);
    U.toast(`▶ Replaying ${U.esc(j.name)}`);
  },
  deleteJourney(id){ U.store('journeys',U.load('journeys',[]).filter(x=>x.id!==id)); this.renderJourneys(); U.toast('Journey deleted'); },
  cancelTrip(){
    this.clearRoute();
    this.waypoints=[{id:this._id++,value:''},{id:this._id++,value:''}];
    this.render();
    document.getElementById('tripSummary').innerHTML='';
    this.lastPlan=null;
    MapMod.showAll && MapMod.showAll();
    U.toast('Trip cancelled');
  },

  /* ═══ CHARGING: animates up to 100% (or until the user taps Stop) ═══
     Stop mid-charge OR auto-stop at 100 → car returns down the sub-route → Resume. */
  startCharging(fromPct, targetPct){
    const nav=document.getElementById('navNext');
    let pct=Math.max(1,fromPct||15); const target=Math.min(100,targetPct||100);
    this._charging=true;
    MapMod.map.closePopup();
    nav.innerHTML=`<span class="nav-charging">Charging…</span> <b id="chgPct">${pct}%</b> → ${target}%
      <button class="nav-charge-btn danger" onclick="Trip.stopCharging()">Stop charging</button>`;
    U.speak&&U.speak('Charging started.');
    this._chgTimer&&clearInterval(this._chgTimer);
    this._chgTimer=setInterval(()=>{
      pct+=Math.max(1,Math.round((100-pct)/22));
      if (pct>=target) pct=target;
      const el=document.getElementById('chgPct'); if(el) el.textContent=pct+'%';
      const bt=document.getElementById('navBatt'); if(bt){ bt.textContent=pct+'%'; bt.style.color=pct>40?'#2dd4a7':pct>20?'#f5a623':'#f0556a'; }
      if (pct>=target){ clearInterval(this._chgTimer); this._chgTimer=null;
        this._finishCharge(pct);   // auto-stop at 100%
      }
    },160);
  },
  /* user tapped Stop — charge halts wherever it is (mid-charge) */
  stopCharging(){
    if (this._chgTimer){ clearInterval(this._chgTimer); this._chgTimer=null; }
    const pct=parseInt(document.getElementById('chgPct')?.textContent)||parseInt(document.getElementById('navBatt')?.textContent)||50;
    this._finishCharge(pct);
  },
  _finishCharge(pct){
    this._charging=false;
    this._resumeBattery=pct;
    const last=this._timeline.chargeStops.at(-1); if(last) last.toPct=pct;
    this._timeline.events.push(`Charged to ${pct}%`);
    document.getElementById('navNext').innerHTML=`<span class="nav-charging">Charged to ${pct}% — returning to route…</span>`;
    U.toast(`Charged to <b>${pct}%</b> — returning to the main route`,3000);
    U.speak&&U.speak(`Charging stopped at ${pct} percent. Returning to the route.`);
    this._returnAndResume();
  },
  /* drive the car BACK down the sub-route to the main route, then resume clean */
  _returnAndResume(){
    const line=this._stopArtifacts.find(o=>!o._isPin);
    if (this._navVeh && line && line.getLatLngs){
      const flat=line.getLatLngs().map(pt=>[pt.lat,pt.lng]).reverse();  // station → highway
      let step=0, N=Math.max(8,Math.min(30,flat.length));
      const pick=k=>flat[Math.min(flat.length-1,Math.round(k*(flat.length-1)/(N-1)))];
      const anim=setInterval(()=>{ step++;
        this._navVeh.setLatLng(pick(step));
        if (step>=N-1){ clearInterval(anim); this._resumeNav(); }
      },70);
    } else { this._resumeNav(); }
  },
  _resumeNav(){
    this._clearStopArtifacts(false);   // #24 — remove the sub-route, pin and popup: clean route
    this._atStop=false; this._paused=false; this._setPauseBtn(false);
    const el=document.getElementById('navSuggest'); el&&el.classList.remove('show');
    if (!this.lastPlan) return;
    const resumeIdx = (this._pausedAt&&this._pausedAt.idx) || this._navIndex || 0;
    this.exitNavigation(true);          // keep timeline
    this.startNavigation(resumeIdx, this._resumeBattery||80);
  },

  /* ───── M40 — simplified 3D navigation view (CSS perspective tilt) ───── */

  toggle3D(){
    const on = document.body.classList.toggle('view-3d');
    document.getElementById('nav3dBtn')?.classList.toggle('active', on);
    setTimeout(()=>MapMod.map.invalidateSize(), 350);
    U.toast(on ? '🧊 3D view on (tilted perspective)' : '2D view restored');
  },

  pointAlong(coords,frac){ const i=Math.min(coords.length-1,Math.max(0,Math.round(frac*(coords.length-1)))); return { lat:coords[i][1], lon:coords[i][0] }; },

  /* ═══ STOP ARTIFACTS: red sub-route from the highway to a chosen point + its 3D pin ═══
     Only the target station's 3D pin is shown during a stop — the route stays clean. */
  _stopArtifacts:[],
  _clearStopArtifacts(keepPin){
    (this._stopArtifacts||[]).forEach(o=>{ if (keepPin && o._isPin) return; try{ MapMod.map.removeLayer(o); }catch(e){} });
    this._stopArtifacts=(this._stopArtifacts||[]).filter(o=>keepPin && o._isPin);
    MapMod.map.closePopup();
  },
  async _showStopPoint(fromLatLng, target, kind){
    /* fromLatLng is a [lon,lat] coord from the route; target={lat,lon,name,...} */
    this._clearStopArtifacts(false);
    const fLat=fromLatLng[1], fLon=fromLatLng[0];
    let coords=[[fLat,fLon],[target.lat,target.lon]];
    try{
      const r=await fetch(`${CONFIG.OSRM}/route/v1/driving/${fLon},${fLat};${target.lon},${target.lat}?overview=full&geometries=geojson`);
      const d=await r.json();
      if (d.routes&&d.routes.length) coords=d.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
    }catch(e){}
    /* red sub-route */
    const line=L.polyline(coords,{color:'#ef4444',weight:5,opacity:.95,dashArray:'2 6'}).addTo(MapMod.map);
    this._stopArtifacts.push(line);
    /* the ONLY station marker visible during the stop — a 3D pin */
    const emoji = kind==='rest' ? '📍' : '⚡';
    const col   = kind==='rest' ? '#f5a623' : '#2dd4a7';
    const pin=L.marker([target.lat,target.lon],{ icon:MapMod.pin3D(emoji,col,38), zIndexOffset:1000 }).addTo(MapMod.map);
    pin._isPin=true; this._stopArtifacts.push(pin);
    const details = target.operator ? `${U.esc(target.operator)}${target.powerKW?` · ${target.powerKW} kW`:''}<br>` : '';
    pin.bindPopup(
      `<div class="pop"><h3>${U.esc(target.name||(kind==='rest'?'Place':'Charging station'))}</h3>${details}`+
      (kind==='rest'
        ? `<div style="margin:6px 0;font-size:12px;color:#94a0bf">Amenity stop — resume the trip when you're ready.</div>
           <div class="pop-btns"><button class="nav-charge-btn ghost" onclick="Trip.resumeFromBreak()">Resume trip</button></div>`
        : `<div style="margin:6px 0;font-size:12px">Boney: <b>Do you want to charge?</b></div>
           <div class="pop-btns"><button class="nav-charge-btn" onclick="Trip.startCharging(${(this._pausedAt&&this._pausedAt.batt)||parseInt(document.getElementById('navBatt')?.textContent)||40},100)">Start charging → 100%</button></div>`)+
      `</div>`).openPopup();
    return line;
  },

  /* ═══ STATE-CHANGE DETECTION during navigation → Boney welcome ═══ */
  _curState:null,
  async _detectState(lat,lon){
    try{
      const g=await Boundaries.load('states'); if(!g) return;
      for (const f of g.features){
        const b=Boundaries.featureBounds(f);
        if (lat<b[0]||lat>b[2]||lon<b[1]||lon>b[3]) continue;
        if (U.pointInGeoJSON(lon,lat,f.geometry)){
          const name=f.properties.name;
          if (name && name!==this._curState){
            const first=this._curState!==null;
            this._curState=name;
            const el=document.getElementById('navState'); if(el) el.textContent=name;
            if (first){ this._timeline&&this._timeline.stateCrossings?.push({state:name,atKm:this._navDoneKm||0});
              Agent.stateWelcome && Agent.stateWelcome(name); }
          }
          return;
        }
      }
    }catch(e){}
  },

  /* ───── SAVE / LIBRARY ───── */
  saveCurrent(){
    if (!this.lastPlan){ U.toast('Plan a trip first'); return; }
    const lib=U.load('trips',[]);
    const p=this.lastPlan;
    lib.push({ id:Date.now(), name:`${p.pts[0].name} → ${p.pts[p.pts.length-1].name}`, savedAt:new Date().toISOString(),
      waypoints:this.waypoints.map(w=>w.value), km:p.km, min:p.min, battery:p.battery, range:p.range,
      geometry:p.route.geometry, pts:p.pts, chargeStops:p.chargeStops });
    U.store('trips',lib);
    this.renderSaved();
    U.toast('💾 Trip saved to your library (this browser)');
  },
  renderSaved(){
    const root=document.getElementById('savedTrips'); const lib=U.load('trips',[]);
    if (!lib.length){ root.innerHTML='<div class="note">No saved plans yet.</div>'; return; }
    root.innerHTML=lib.slice().reverse().map(t=>`
      <div class="data-item saved-trip" style="cursor:default;flex-wrap:wrap">
        <span style="flex:1;min-width:120px">🧭 ${U.esc(t.name)}<br><span style="font-size:10.5px;color:var(--muted)">${t.km} km · ${U.fmtTime(t.min)}</span></span>
        <div class="st-acts">
          <button class="wp-mv" onclick="Trip.loadSaved(${t.id})" title="Load">↻</button>
          <button class="wp-mv" onclick="Trip.editSaved(${t.id})" title="Edit name">✎</button>
          <button class="wp-mv" onclick="Trip.duplicateSaved(${t.id})" title="Duplicate">⧉</button>
          <button class="wp-mv" onclick="Trip.shareSaved(${t.id})" title="Share">↗</button>
          <button class="wp-del" onclick="Trip.deleteSaved(${t.id})" title="Delete">✕</button>
        </div>
      </div>`).join('');
  },
  loadSaved(id){
    const t=U.load('trips',[]).find(x=>x.id===id); if (!t) return;
    this.waypoints=t.waypoints.map((v,i)=>({id:this._id++,value:v})); this.render();
    document.getElementById('tripBattery').value=t.battery; document.getElementById('tripRange').value=t.range;
    this.clearRoute();
    this.routeLayer=L.geoJSON(t.geometry,{style:{color:'#4f8ef7',weight:5,opacity:.85}}).addTo(MapMod.map);
    MapMod.map.fitBounds(this.routeLayer.getBounds(),{padding:[60,60]});
    this.lastPlan={ route:{geometry:t.geometry,distance:t.km*1000,duration:t.min*60}, pts:t.pts, km:t.km, min:t.min, battery:t.battery, range:t.range, wx:{factor:1,note:'saved'}, chargeStops:t.chargeStops, curve:[], effRange:t.range, usableNow:0 };
    U.toast(`Loaded: ${U.esc(t.name)}`);
  },
  editSaved(id){
    const lib=U.load('trips',[]); const t=lib.find(x=>x.id===id); if(!t) return;
    const name=prompt('Rename trip:', t.name); if(name==null) return;
    t.name=name.trim()||t.name; U.store('trips',lib); this.renderSaved(); U.toast('Trip renamed');
  },
  duplicateSaved(id){
    const lib=U.load('trips',[]); const t=lib.find(x=>x.id===id); if(!t) return;
    const copy={...t, id:Date.now(), name:t.name+' (copy)', savedAt:new Date().toISOString()};
    lib.push(copy); U.store('trips',lib); this.renderSaved(); U.toast('Trip duplicated');
  },
  shareSaved(id){
    const t=U.load('trips',[]).find(x=>x.id===id); if(!t) return;
    /* compact shareable text + try Web Share / clipboard */
    const text=`Eas_EV trip — ${t.name}\n${t.waypoints.join(' → ')}\n${t.km} km · ${U.fmtTime(t.min)} · battery ${t.battery}%`;
    if (navigator.share){ navigator.share({title:'Eas_EV Trip', text}).catch(()=>{}); }
    else if (navigator.clipboard){ navigator.clipboard.writeText(text).then(()=>U.toast('Trip copied to clipboard')); }
    else { U.toast('Share not supported — exported JSON instead'); this.lastPlan&&this.exportPlan('json'); }
  },
  deleteSaved(id){ U.store('trips',U.load('trips',[]).filter(x=>x.id!==id)); this.renderSaved(); U.toast('Trip deleted'); },

  /* ───── OFFLINE EXPORT ───── */
  /* white-background route map with STATE-BOUNDARY backdrop: polyline + stops (for report) */
  routeMapImage(timeline){
    const p=this.lastPlan; if(!p||!p.route) return null;
    const cs=p.route.geometry.coordinates;
    const W=1200,H=760,pad=60;
    let mnLa=90,mxLa=-90,mnLo=180,mxLo=-180;
    cs.forEach(c=>{ mnLo=Math.min(mnLo,c[0]);mxLo=Math.max(mxLo,c[0]);mnLa=Math.min(mnLa,c[1]);mxLa=Math.max(mxLa,c[1]); });
    const gLa=(mxLa-mnLa)*.14||.4, gLo=(mxLo-mnLo)*.14||.4; mnLa-=gLa;mxLa+=gLa;mnLo-=gLo;mxLo+=gLo;
    const sc=Math.min((W-pad*2)/(mxLo-mnLo),(H-pad*2)/(mxLa-mnLa));
    const px=lo=>pad+(lo-mnLo)*sc, py=la=>H-pad-(la-mnLa)*sc;
    const cv=document.createElement('canvas'); cv.width=W;cv.height=H;
    const x=cv.getContext('2d');
    x.fillStyle='#ffffff'; x.fillRect(0,0,W,H);
    /* STATE BOUNDARY BASE — draw states that intersect the route's bbox */
    const g=Boundaries.states;
    if (g && g.features){
      x.strokeStyle='#c3d6cc'; x.fillStyle='#f3f8f5'; x.lineWidth=1;
      g.features.forEach(f=>{
        const b=Boundaries.featureBounds(f);
        if (b[2]<mnLa||b[0]>mxLa||b[3]<mnLo||b[1]>mxLo) return;
        const poly=cs2=>{ x.beginPath(); cs2.forEach(r=>{ r.forEach((pt,i)=>{ i?x.lineTo(px(pt[0]),py(pt[1])):x.moveTo(px(pt[0]),py(pt[1])); }); x.closePath(); }); x.fill(); x.stroke(); };
        const gm=f.geometry;
        if (gm.type==='Polygon') poly(gm.coordinates);
        else if (gm.type==='MultiPolygon') gm.coordinates.forEach(poly);
      });
    }
    x.strokeStyle='#0D9463'; x.lineWidth=4; x.lineJoin='round'; x.beginPath();
    cs.forEach((c,i)=>{ i?x.lineTo(px(c[0]),py(c[1])):x.moveTo(px(c[0]),py(c[1])); }); x.stroke();
    const dot=(lat,lon,col,r,lbl)=>{ x.fillStyle=col; x.strokeStyle='#fff'; x.lineWidth=2.5;
      x.beginPath(); x.arc(px(lon),py(lat),r,0,7); x.fill(); x.stroke();
      if (lbl){ x.fillStyle='#123528'; x.font='bold 15px Arial'; x.fillText(lbl,px(lon)+11,py(lat)+5); } };
    p.pts.forEach((s,i)=>dot(s.lat,s.lon,i===0?'#0E4D3A':i===p.pts.length-1?'#F0556A':'#2C6E5B',9,s.name.slice(0,18)));
    const chs=(timeline&&timeline.chargeStops)||p.chargeStops.filter(c=>c.station).map(c=>({lat:c.station.lat,lon:c.station.lon,station:c.station.name}));
    chs.forEach(c=>{ if(c.lat!=null) dot(c.lat,c.lon,'#2DD4A7',8,'Charge'); });
    ((timeline&&timeline.breakStops)||[]).forEach(b=>dot(b.lat,b.lon,'#F5A623',7,'Break'));
    x.fillStyle='#123528'; x.font='bold 24px Arial';
    x.fillText(`${p.pts[0].name} → ${p.pts[p.pts.length-1].name}  ·  ${p.km} km`,pad,36);
    return cv.toDataURL('image/png');
  },

  /* battery curve from the journey timeline */
  batteryCurveImage(timeline){
    const s=(timeline&&timeline.samples)||[]; if(s.length<3) return null;
    const W=1100,H=380,pad=54;
    const cv=document.createElement('canvas'); cv.width=W;cv.height=H;
    const x=cv.getContext('2d');
    x.fillStyle='#fff'; x.fillRect(0,0,W,H);
    const maxKm=s[s.length-1].km||1;
    const px=km=>pad+(km/maxKm)*(W-pad*2), py=b=>H-pad-(b/100)*(H-pad*2);
    x.strokeStyle='#C7E5D8'; x.lineWidth=1;
    [0,25,50,75,100].forEach(b=>{ x.beginPath(); x.moveTo(pad,py(b)); x.lineTo(W-pad,py(b)); x.stroke();
      x.fillStyle='#57806E'; x.font='12px Arial'; x.fillText(b+'%',10,py(b)+4); });
    x.strokeStyle='#0D9463'; x.lineWidth=3; x.beginPath();
    s.forEach((pt,i)=>{ i?x.lineTo(px(pt.km),py(pt.battery)):x.moveTo(px(pt.km),py(pt.battery)); }); x.stroke();
    x.fillStyle='#123528'; x.font='bold 17px Arial'; x.fillText('Battery over distance',pad,26);
    x.font='12px Arial'; x.fillStyle='#57806E'; x.fillText('0 km',pad,H-24); x.fillText(Math.round(maxKm)+' km',W-pad-40,H-24);
    return cv.toDataURL('image/png');
  },

  /* ═══ end-of-trip report — real .docx (images guaranteed) or PDF ═══ */
  async tripReport(fmt='docx'){
    const tl=this._timeline; const p=this.lastPlan;
    if (!tl||!p){ U.toast('No completed trip in memory'); return; }
    U.toast('Building trip report…');
    const mapImg=this.routeMapImage(tl);
    const curveImg=this.batteryCurveImage(tl);
    const dur=tl.endedAt?Math.round((new Date(tl.endedAt)-new Date(tl.startedAt))/1000):null;
    const battStart=tl.samples[0]?.battery??p.battery, battEnd=tl.samples.at(-1)?.battery??'—';
    const summaryTable={ head:['Distance','Planned time','Avg speed','Battery start → end','Charge stops','Breaks'],
      rows:[[`${p.km} km`, U.fmtTime(p.min), `${Math.round(p.km/(p.min/60))} km/h`, `${battStart}% → ${battEnd}%`,
        String((tl.chargeStops||[]).length), String((tl.breakStops||[]).length)]],
      cap:'Trip summary' };
    const sections=[
      { h:'Trip summary',
        paras:[`Journey ${tl.name}: ${p.km} km planned over ${U.fmtTime(p.min)}. The vehicle departed with ${battStart}% battery and arrived with ${battEnd}%, making ${(tl.chargeStops||[]).length} charging stop(s) and ${(tl.breakStops||[]).length} rest stop(s). All charging decisions followed the platform's full-charge, last-reachable-charger rule.`],
        table:summaryTable },
      ...(mapImg?[{ h:'Route map',
        paras:['The complete driven route with start/end points, planned charging stops (green) and rest stops (amber).'],
        image:{data:mapImg, cap:`Route — ${tl.name}`, w:560, h:356}, pageBreak:true }]:[]),
      ...(curveImg?[{ h:'Battery profile',
        paras:['Battery percentage against distance. Vertical recoveries correspond to charging stops; the discharge slope reflects the vehicle\'s effective range under trip conditions.'],
        image:{data:curveImg, cap:'Battery over distance', w:560, h:194} }]:[]),
      { h:'Charging stops',
        paras:(tl.chargeStops||[]).length?[]:['No charging was needed on this trip.'],
        tables:(tl.chargeStops||[]).length?[{head:['#','Station','At km'],
          rows:tl.chargeStops.map((c,i)=>[i+1,c.station,c.atKm]),cap:'Charging stops in order'}]:[] },
      ...((tl.breakStops||[]).length?[{ h:'Rest stops',
        tables:[{head:['#','Place'],rows:tl.breakStops.map((b,i)=>[i+1,b.name]),cap:'Driver rest stops'}] }]:[]),
      { h:'Journey log',
        tables:[{head:['Event'],rows:(tl.events||[]).map(e=>[e]),cap:'Chronological journey events'}] },
      ...((tl.stateCrossings||[]).length?[{ h:'States crossed',
        tables:[{head:['#','State','At km'],rows:tl.stateCrossings.map((s,i)=>[i+1,s.state,Math.round(s.atKm||0)]),cap:'States entered during the trip'}] }]:[]),
      { h:'Waypoints',
        tables:[{head:['Type','Place','Coordinates'],
          rows:p.pts.map((s,i)=>[i===0?'Start':i===p.pts.length-1?'End':'Stop '+i, s.name, `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`]),
          cap:'Planned waypoints'}] },
    ];
    const meta={scope:tl.name, count:`${p.km} km`, docType:'TRIP REPORT'};
    if (fmt==='pdf'){
      /* robust iframe-based print — no popup blocker issues */
      Intel._printPDF(`Trip Report — ${tl.name}`, meta, sections);
      return;
    }
    await Intel.buildDocx(`Trip Report — ${tl.name}`, `${p.km} km · ${U.fmtTime(p.min)} · ${new Date().toLocaleDateString()}`,
      meta, sections, `Eas_EV_Trip_Report_${new Date().toISOString().slice(0,10)}`);
    U.toast('Trip report downloaded');
  },

  exportPlan(fmt){
    if (!this.lastPlan){ U.toast('Plan a trip first'); return; }
    const p=this.lastPlan; const stamp=new Date().toISOString().slice(0,10);
    if (fmt==='json'){
      U.downloadBlob(JSON.stringify({ name:`${p.pts[0].name}→${p.pts[p.pts.length-1].name}`, km:p.km, minutes:p.min, battery:p.battery, range:p.range, weather:p.wx, stops:p.pts, chargeStops:p.chargeStops, geometry:p.route.geometry },null,1), `trip_${stamp}.json`,'application/json');
      U.toast('Trip JSON downloaded');
    } else if (fmt==='gpx'){
      U.downloadBlob(U.buildGPX(`${p.pts[0].name}→${p.pts[p.pts.length-1].name}`, p.route.geometry.coordinates, [...p.pts, ...p.chargeStops.filter(c=>c.station).map(c=>({lat:c.station.lat,lon:c.station.lon,name:'Charge: '+c.station.name}))]), `trip_${stamp}.gpx`,'application/gpx+xml');
      U.toast('GPX downloaded (works offline in GPS apps)');
    } else if (fmt==='pdf'){
      this.printPDF(p);
    }
  },
  printPDF(p){
    const mapImg=this.routeMapImage(this._timeline);
    const stops=p.pts.map((s,i)=>`<tr><td>${i===0?'Start':i===p.pts.length-1?'End':'Stop '+i}</td><td>${U.esc(s.name)}</td><td>${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</td></tr>`).join('');
    const charges=p.chargeStops.map((c,i)=>`<li>~km ${c.atKm}: battery ≈ ${c.pctAtStop}% — ${c.station?U.esc(c.station.name):'no fast charger nearby'}</li>`).join('')||'<li>No charging needed</li>';
    const html=`<html><head><title>Eas_EV Trip</title><style>body{font-family:Arial;padding:32px;color:#111}h1{color:#0d9463}table{width:100%;border-collapse:collapse;margin:14px 0}td,th{border:1px solid #ccc;padding:7px;font-size:13px;text-align:left}.muted{color:#666;font-size:12px}</style></head><body>
      <h1>Eas_EV — Trip Plan</h1>
      <p class="muted">Generated ${new Date().toLocaleString()}</p>
      ${mapImg?`<img src="${mapImg}" style="width:100%;max-width:720px;border:1px solid #cde3d8;margin:8px 0">`:''}
      <p><b>${U.esc(p.pts[0].name)} → ${U.esc(p.pts[p.pts.length-1].name)}</b><br>
      Distance: ${p.km} km · Drive time: ${U.fmtTime(p.min)} · Battery: ${p.battery}% · Range: ${p.range} km<br>
      Weather (mid-route): ${U.esc(p.wx.note||'n/a')}</p>
      <h3>Stops</h3><table><tr><th>Type</th><th>Place</th><th>Coordinates</th></tr>${stops}</table>
      <h3>Charging plan</h3><ul>${charges}</ul>
      <p class="muted">Verify charger availability before travel.</p>
      </body></html>`;
    const w=window.open('','_blank'); w.document.write(html); w.document.close(); setTimeout(()=>w.print(),500);
  },

  /* ───── QUICK ROUTE + ROUTE CHAIN ───── */
  async quickRoute(toLat,toLon,name){
    try {
      const f=MapMod.userPos;
      if (!f || f.lat==null){ U.toast('⚠ Set a start point first (e.g. say “from Kolkata”)'); return null; }
      const res=await fetch(`${CONFIG.OSRM}/route/v1/driving/${f.lon},${f.lat};${toLon},${toLat}?overview=full&geometries=geojson`);
      const data=await res.json(); if (!data.routes?.length) throw new Error('no route');
      const route=data.routes[0];
      this.clearRoute();
      this.routeLayer=L.geoJSON(route.geometry,{style:{color:'#4f8ef7',weight:5,opacity:.9}}).addTo(MapMod.map);
      const mkA=L.circleMarker([f.lat,f.lon],{radius:8,color:'#fff',weight:2,fillColor:'#2dd4a7',fillOpacity:1}).addTo(MapMod.map).bindPopup('Start');
      const mk=L.circleMarker([toLat,toLon],{radius:9,color:'#fff',weight:2,fillColor:'#4f8ef7',fillOpacity:1}).addTo(MapMod.map).bindPopup(U.esc(name));
      this.routeMarkers.push(mkA,mk);
      try { MapMod.map.fitBounds(this.routeLayer.getBounds(),{padding:[60,60]}); }
      catch(e){ MapMod.map.fitBounds([[f.lat,f.lon],[toLat,toLon]],{padding:[60,60]}); }
      const km=(route.distance/1000).toFixed(1),min=Math.round(route.duration/60);
      this.lastPlan={ route, pts:[{lat:f.lat,lon:f.lon,name:'You'},{lat:toLat,lon:toLon,name}], km:+km, min, battery:80, range:300, wx:{factor:1,note:'n/a'}, chargeStops:[], curve:[], effRange:300, usableNow:0 };
      U.toast(`→ <b>${U.esc(name)}</b> · ${km} km · ${U.fmtTime(min)}`);
      DL.refreshList();
      return { km, min };
    } catch(e){ U.toast('⚠ Routing failed (OSRM unreachable)'); return null; }
  },

  /* clicking station "Navigate" adds to a chain; chain → trip */
  routeChainAdd(s){
    this.chain.push(s);
    document.getElementById('chainBar').classList.add('show');
    document.getElementById('chainInfo').textContent=`🧭 ${this.chain.length} stop${this.chain.length>1?'s':''} chained`;
    L.circleMarker([s.lat,s.lon],{radius:10,color:'#fff',weight:2,fillColor:'#4f8ef7',fillOpacity:1}).addTo(MapMod.map);
    if (this.chain.length>=2){
      /* draw running route through chain from user */
      const all=[MapMod.userPos,...this.chain];
      const coords=all.map(p=>`${p.lon},${p.lat}`).join(';');
      fetch(`${CONFIG.OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`).then(r=>r.json()).then(d=>{
        if (!d.routes?.length) return;
        if (this._chainLayer) MapMod.map.removeLayer(this._chainLayer);
        this._chainLayer=L.geoJSON(d.routes[0].geometry,{style:{color:'#b78bfa',weight:4,opacity:.8,dashArray:'4 6'}}).addTo(MapMod.map);
      });
    }
    U.toast(`Chained <b>${U.esc(s.name)}</b> — click more, then "Save as trip"`);
  },
  chainToTrip(){
    if (this.chain.length<1){ U.toast('Click "Navigate" on stations to chain them first'); return; }
    this.waypoints=[{id:this._id++,value:'My location ('+MapMod.userPos.lat.toFixed(4)+','+MapMod.userPos.lon.toFixed(4)+')'},
      ...this.chain.map(s=>({id:this._id++,value:`${s.name} (${s.lat.toFixed(4)},${s.lon.toFixed(4)})`}))];
    if (this.waypoints.length<2) this.addWaypoint('');
    this.render(); App.openDrawer('trip'); this.clearChain(); this.plan();
  },
  clearChain(){ this.chain=[]; if (this._chainLayer){ MapMod.map.removeLayer(this._chainLayer); this._chainLayer=null; } document.getElementById('chainBar').classList.remove('show'); },

  clearRoute(){
    if (this.routeLayer){ MapMod.map.removeLayer(this.routeLayer); this.routeLayer=null; }
    this.routeMarkers.forEach(m=>MapMod.map.removeLayer(m)); this.routeMarkers=[];
  },
};
