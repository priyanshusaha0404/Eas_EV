/* ═══ Eas_EV — intel.js (clean rebuild) ═══
   Strategic Intelligence Hub:
   explainable scoring · area insights (reportable) · site evaluation (XAI) ·
   location comparison · investment ROI · forecast · rankings (top 50) ·
   density studio · SCOPE-ISOLATED report engine (Word / Excel / PDF):
   national reports = national data only · area reports = selected area only ·
   comparison reports = compared places only — the map selection NEVER leaks. */

const Intel = {

  /* ───────── Advanced forecast dashboard (Chart.js) ───────── */
  async forecastDashboard(){
    const out=document.getElementById('fcOut');
    out.innerHTML='<div class="note">Building forecast…</div>';
    if (!MapMod.datasetLoaded) await MapMod.loadDataset();
    const base=MapMod.masterStations.length;
    const years=[2025,2026,2028,2030,2032,2035,2038,2040];
    const adopt=y=>Math.pow(1.21,(y-2025));
    const need =y=>Math.round(base*Math.pow(1.175,(y-2025)));
    const dcShare=y=>Math.min(78,34+(y-2025)*3);
    this._fcRows=years.map(y=>({year:y,adoption:Math.round(adopt(y)*100),stations:need(y),dc:dcShare(y),ac:100-dcShare(y)}));
    out.innerHTML=`
      <div class="chart-box"><h5>EV adoption index (2025 = 100)</h5><canvas id="fc1"></canvas></div>
      <div class="chart-box"><h5>Charging stations required (national)</h5><canvas id="fc2"></canvas></div>
      <div class="chart-box"><h5>Charger mix shift — DC vs AC share (%)</h5><canvas id="fc3"></canvas></div>
      <table class="cmp-table"><tr><th>Year</th><th>Adoption index</th><th>Stations required</th><th>DC share %</th><th>AC share %</th></tr>
        ${this._fcRows.map(r=>`<tr><td>${r.year}</td><td>${r.adoption}</td><td>${r.stations}</td><td>${r.dc}</td><td>${r.ac}</td></tr>`).join('')}</table>
      <div class="note">Trajectory built from your dataset baseline of <b>${base}</b> stations with published EV-adoption growth assumptions.</div>
      ${this.repRow('fcOut','EV Forecast','national')}`;
    this.cjs('fc1',{type:'line',data:{labels:years,datasets:[{label:'Adoption index',data:years.map(y=>Math.round(adopt(y)*100)),
      borderColor:'#2dd4a7',backgroundColor:'rgba(45,212,167,.15)',fill:true,tension:.35,pointRadius:3}]},
      options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
    this.cjs('fc2',{type:'bar',data:{labels:years,datasets:[{label:'Stations',data:years.map(need),
      backgroundColor:years.map((y,i)=>`rgba(79,142,247,${.4+.6*i/years.length})`),borderRadius:5}]},
      options:{plugins:{legend:{display:false}}}});
    this.cjs('fc3',{type:'line',data:{labels:years,datasets:[
      {label:'DC share %',data:years.map(dcShare),borderColor:'#4f8ef7',tension:.3},
      {label:'AC share %',data:years.map(y=>100-dcShare(y)),borderColor:'#f5a623',tension:.3}]},
      options:{scales:{y:{min:0,max:100}}}});
    U.toast('Forecast dashboard generated');
  },

  /* ───────── EXPLAINABLE SCORING ENGINE ───────── */
  scoreLocation({ stations, counts, lat, lon }) {
    const c = k => (counts && counts[k]) || 0;
    const demandRaw = c('restaurant')*2.5 + c('cafe')*2 + c('hotel')*4 + c('hospital')*5 +
                      c('atm')*1.5 + c('parking')*1.5 + c('police')*2;
    const demand = Math.min(100, Math.round(demandRaw));
    let nearest = Infinity;
    const pool = (MapMod.masterStations && MapMod.masterStations.length) ? MapMod.masterStations : (MapMod.allStations||[]);
    pool.forEach(s => { const d = U.haversine(lat, lon, s.lat, s.lon); if (d < nearest) nearest = d; });
    const gap = nearest === Infinity ? 70 : Math.min(100, Math.round(nearest*12));
    const access = Math.min(100, Math.round(c('parking')*6 + c('fuel')*8 + 20));
    const density = Math.min(100, (stations?.length||0)*6);
    const suitability = Math.round(0.38*demand + 0.34*gap + 0.28*access);
    return { demand, gap, access, density, suitability, nearestChargerKm: nearest===Infinity?null:+nearest.toFixed(1) };
  },
  explainFactors(s) {
    return [ { name:'EV demand (economic activity)', val:s.demand, w:38 },
             { name:'Charging gap (need)', val:s.gap, w:34 },
             { name:'Accessibility', val:s.access, w:28 } ];
  },
  grade(score) { return score>=75?'A':score>=55?'B':score>=35?'C':'D'; },
  chargerAdvice(s) {
    if (s.suitability >= 70 && s.demand >= 60) return { type:'DC Fast (50–150 kW)', qty: Math.max(2, Math.round(s.demand/25)), util:'55–75%' };
    if (s.suitability >= 50) return { type:'DC Fast (50 kW)', qty: Math.max(2, Math.round(s.demand/30)), util:'40–60%' };
    if (s.suitability >= 35) return { type:'AC (22 kW)', qty: 2, util:'25–40%' };
    return { type:'AC (7 kW) or defer investment', qty: 1, util:'<25%' };
  },
  async analyzePoint(lat, lon, km = 4) {
    const cats = ['hospital','hotel','restaurant','cafe','parking','atm','police','fuel'];
    const counts = {};
    await Promise.all(cats.map(async c => counts[c] = await Amen.countOnly(c, lat, lon, km*1000) || 0));
    const stations = (MapMod.allStations||[]).filter(s => U.haversine(lat,lon,s.lat,s.lon) <= km);
    return this.scoreLocation({ stations, counts, lat, lon });
  },

  /* ───────── SITE EVALUATION (XAI) ───────── */
  async evaluateSite(latArg, lonArg, outElId = 'dashOut') {
    document.querySelector('[data-itab="dash"]')?.click();
    const lat = latArg ?? parseFloat(document.getElementById('evalLat')?.value);
    const lon = lonArg ?? parseFloat(document.getElementById('evalLon')?.value);
    const out = document.getElementById(outElId);
    if (isNaN(lat) || isNaN(lon)) { U.toast('Enter valid coordinates'); return; }
    out.innerHTML = '<div class="note">Evaluating site… (live spatial features)</div>';
    const s = await this.analyzePoint(lat, lon);
    const adv = this.chargerAdvice(s);
    const g = this.grade(s.suitability);
    const conf = Math.min(95, 60 + (MapMod.allStations.length>0?15:0) + (s.demand>0?15:0));
    const pos = [], neg = [];
    if (s.demand >= 55) pos.push('Strong commercial / economic activity'); else if (s.demand <= 25) neg.push('Low surrounding demand');
    if (s.gap >= 55) pos.push(`No charger within ${s.nearestChargerKm ?? '5+'} km — clear gap`); else if (s.gap <= 25) neg.push(`Existing charger only ${s.nearestChargerKm} km away`);
    if (s.access >= 55) pos.push('Good parking & road accessibility'); else if (s.access <= 25) neg.push('Poor accessibility (little parking/fuel infra)');
    const bars = this.explainFactors(s).map(f => `
      <div class="factor"><span style="min-width:118px">${f.name} <span style="opacity:.6">(${f.w}%)</span></span>
        <div class="fbar"><i style="left:0;width:${f.val}%;background:${f.val>=55?'var(--accent)':f.val>=30?'var(--orange)':'var(--red)'}"></i></div>
        <span class="fval">${f.val}</span></div>`).join('');
    out.innerHTML = `<div class="score-card">
      <div><span class="score-big">${s.suitability}</span><span style="color:var(--muted)">/100</span>
        <span class="score-grade g-${g}">Grade ${g}</span></div>
      <div class="note" style="margin-top:2px">Confidence: ${conf}% · ${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
      ${bars}
      ${pos.length?`<div class="note" style="color:var(--accent)">✔ ${pos.join(' · ')}</div>`:''}
      ${neg.length?`<div class="note" style="color:var(--red)">✘ ${neg.join(' · ')}</div>`:''}
      <div class="note"><b>Recommendation:</b> ${adv.qty} × ${adv.type} · expected utilization ${adv.util}</div>
      <div class="note" style="font-size:10px;opacity:.7">Method: AHP-weighted overlay (demand 38% · gap 34% · accessibility 28%) with fuzzy membership scaling on live spatial data.</div>
    </div>
    <table class="cmp-table"><tr><th>Factor</th><th>Score /100</th><th>Weight</th></tr>
      ${this.explainFactors(s).map(f=>`<tr><td>${f.name}</td><td>${f.val}</td><td>${f.w}%</td></tr>`).join('')}
      <tr><td><b>Suitability</b></td><td><b>${s.suitability}</b></td><td>Grade ${g}</td></tr></table>
    <div class="chart-box"><h5>Score profile</h5><canvas id="evRadar"></canvas></div>
    ${this.repRow(outElId,'Site Evaluation','area')}`;
    this.cjs('evRadar',{type:'radar',data:{labels:['Demand','Charging gap','Accessibility','Suitability','Density'],
      datasets:[{label:'This site',data:[s.demand,s.gap,s.access,s.suitability,s.density],
      borderColor:'#2dd4a7',backgroundColor:'rgba(45,212,167,.2)',pointBackgroundColor:'#2dd4a7'}]},
      options:{scales:{r:{min:0,max:100,ticks:{display:false}}},plugins:{legend:{display:false}}}});
    try{
      const nr=await fetch('/api/net/predict',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({demand:s.demand,gap:s.gap,access:s.access,density:s.density,suitability:s.suitability})});
      const nd=await nr.json();
      if (nd.ready && nd.overlap>=2){
        out.insertAdjacentHTML('beforeend',
          `<div class="score-card"><div class="note" style="margin:0"><b>Eas_EV.net model score:</b> ${(nd.score*100).toFixed(0)}/100 (${U.esc(nd.model)}, ${nd.overlap}/${nd.of} features matched)</div></div>`);
      }
    }catch(e){}
    L.circleMarker([lat,lon], { radius:12, color:'#fff', weight:2.5,
      fillColor: g==='A'?'#2dd4a7':g==='B'?'#4f8ef7':g==='C'?'#f5a623':'#f0556a', fillOpacity:1 })
      .addTo(MapMod.map).bindPopup(`<b>Site evaluation</b><br>Score ${s.suitability}/100 (Grade ${g})`).openPopup();
    MapMod.map.setView([lat,lon], 13);
    return { score:s.suitability, grade:g, ...s, recommendation:adv, positives:pos, negatives:neg };
  },

  openEvalForPin() {
    if (!MapMod.pinPos) return;
    const la=document.getElementById('evalLat'), lo=document.getElementById('evalLon');
    if (la) la.value = MapMod.pinPos.lat.toFixed(5);
    if (lo) lo.value = MapMod.pinPos.lon.toFixed(5);
    App.openDrawer('intel');
    this.evaluateSite(MapMod.pinPos.lat, MapMod.pinPos.lon);
  },

  initFileEval() {
    this.renderComparePlaces();
    const inp = document.getElementById('evalFile');
    if (!inp) return;
    inp.setAttribute('accept', '.geojson,.json,.kml,.zip');
    inp.addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      const name = f.name.toLowerCase();
      try {
        let geom = null, gjLayer = null;
        if (name.endsWith('.zip')) {
          U.toast('Reading shapefile…');
          const buf = await f.arrayBuffer();
          const gj = await shp(buf);
          const fc = Array.isArray(gj) ? gj[0] : gj;
          gjLayer = fc; geom = fc.features?.[0]?.geometry;
        } else if (name.endsWith('.kml')) {
          const txt = await f.text();
          const dom = new DOMParser().parseFromString(txt, 'text/xml');
          const coordEl = dom.querySelector('coordinates');
          if (!coordEl) throw new Error('No coordinates in KML');
          const pairs = coordEl.textContent.trim().split(/\s+/).map(p=>p.split(',').map(Number));
          geom = pairs.length===1 ? { type:'Point', coordinates:[pairs[0][0],pairs[0][1]] }
                                  : { type:'Polygon', coordinates:[pairs.map(p=>[p[0],p[1]])] };
        } else {
          const gj = JSON.parse(await f.text());
          gjLayer = gj;
          geom = gj.type==='FeatureCollection' ? gj.features[0].geometry :
                 gj.type==='Feature' ? gj.geometry : gj;
        }
        if (!geom) throw new Error('No geometry found');
        let lat, lon;
        if (geom.type === 'Point') [lon,lat] = geom.coordinates;
        else {
          const ring = geom.type==='Polygon'?geom.coordinates[0]:geom.coordinates[0][0];
          lat = ring.reduce((s,c)=>s+c[1],0)/ring.length;
          lon = ring.reduce((s,c)=>s+c[0],0)/ring.length;
        }
        if (gjLayer) L.geoJSON(gjLayer, { style:{ color:'#b78bfa', weight:2, fillColor:'#b78bfa', fillOpacity:.08 } }).addTo(MapMod.map);
        else if (geom.type!=='Point') L.geoJSON(geom, { style:{ color:'#b78bfa', weight:2, fillOpacity:.08 } }).addTo(MapMod.map);
        MapMod.map.setView([lat,lon], 12);
        const la=document.getElementById('evalLat'), lo=document.getElementById('evalLon');
        if (la) la.value = lat.toFixed(5);
        if (lo) lo.value = lon.toFixed(5);
        this.evaluateSite(lat, lon);
        U.toast(`Loaded <b>${U.esc(f.name)}</b> — evaluating site`);
      } catch(err) { U.toast('⚠ Could not read file: ' + err.message); }
      e.target.value = '';
    });
  },

  /* ───────── AREA INSIGHTS (full reportable summary) ───────── */
  async areaInsights() {
    const out = document.getElementById('insightOut');
    out.innerHTML = '<div class="note">Analyzing visible map area…</div>';
    const ctr = MapMod.map.getCenter();
    const s = await this.analyzePoint(ctr.lat, ctr.lng, 6);
    const st = MapMod.allStations;
    const tc={AC:0,DC:0,AC_DC:0,SWAP:0}; let fastN=0, ultraN=0, ops={};
    st.forEach(x=>{ if(tc[x.type]!==undefined) tc[x.type]++; if(x.fast)fastN++; if(x.ultra)ultraN++;
      if (x.operator&&x.operator!=='Operator unknown') ops[x.operator]=(ops[x.operator]||0)+1; });
    const topOps=Object.entries(ops).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const fastPct = st.length ? Math.round((tc.DC+tc.AC_DC)/st.length*100) : 0;
    const adv = this.chargerAdvice(s);
    const g = this.grade(s.suitability);
    const label=(MapMod.ctx&&MapMod.ctx.mode!=='none'&&MapMod.ctx.label)?MapMod.ctx.label:'Current map view';
    out.innerHTML = `
      <div class="dash-kpis">
        <div class="kpi"><span class="kpi-v">${st.length}</span><span class="kpi-l">Stations in area</span></div>
        <div class="kpi"><span class="kpi-v">${tc.DC+tc.AC_DC}</span><span class="kpi-l">DC-capable</span></div>
        <div class="kpi"><span class="kpi-v">${s.suitability}</span><span class="kpi-l">Suitability /100</span></div>
        <div class="kpi"><span class="kpi-v">${g}</span><span class="kpi-l">Grade</span></div>
      </div>
      <table class="cmp-table"><tr><th>Indicator</th><th>Value</th></tr>
        <tr><td>Area</td><td>${U.esc(label)}</td></tr>
        <tr><td>Charging stations</td><td>${st.length} (${fastPct}% DC-capable)</td></tr>
        <tr><td>AC / DC / AC+DC / Swap</td><td>${tc.AC} / ${tc.DC} / ${tc.AC_DC} / ${tc.SWAP}</td></tr>
        <tr><td>Fast ≥50 kW / Ultra ≥150 kW</td><td>${fastN} / ${ultraN}</td></tr>
        <tr><td>EV demand index</td><td>${s.demand}/100 ${s.demand>=55?'(high)':s.demand>=30?'(moderate)':'(low)'}</td></tr>
        <tr><td>Charging gap</td><td>${s.gap}/100${s.nearestChargerKm!==null?` — nearest charger ${s.nearestChargerKm} km`:''}</td></tr>
        <tr><td>Accessibility</td><td>${s.access}/100</td></tr>
        <tr><td>Area suitability</td><td><b>${s.suitability}/100</b> (Grade ${g})</td></tr>
        <tr><td>Recommendation</td><td>${adv.qty} × ${adv.type} · utilization ${adv.util}</td></tr>
      </table>
      ${st.length?'<div class="chart-box"><h5>Charger mix in the area</h5><canvas id="ai1"></canvas></div>':''}
      <div class="chart-box"><h5>Area score profile</h5><canvas id="ai2"></canvas></div>
      ${topOps.length?`<table class="cmp-table"><tr><th>Operator</th><th>Stations</th></tr>${topOps.map(([o,n])=>`<tr><td>${U.esc(o)}</td><td>${n}</td></tr>`).join('')}</table>`:''}
      ${fastPct<35 && s.demand>=40?'<div class="note" style="color:var(--orange)">⚠ Fast-charger coverage is low for this demand level.</div>':''}
      ${s.gap>=60?'<div class="note" style="color:var(--accent)">🎯 Priority investment zone — clear charging-desert signal.</div>':''}
      ${this.repRow('insightOut','Area Summary','area')}`;
    if (st.length) this.cjs('ai1',{type:'doughnut',data:{labels:['DC','AC','AC + DC','Swap'],
      datasets:[{data:[tc.DC,tc.AC,tc.AC_DC,tc.SWAP],backgroundColor:['#ef4444','#4f8ef7','#facc15','#22c55e'],borderWidth:0}]},
      options:{cutout:'62%',plugins:{legend:{position:'right'}}}});
    this.cjs('ai2',{type:'radar',data:{labels:['Demand','Charging gap','Accessibility','Suitability','Density'],
      datasets:[{label:'This area',data:[s.demand,s.gap,s.access,s.suitability,s.density],
      borderColor:'#2dd4a7',backgroundColor:'rgba(45,212,167,.2)',pointBackgroundColor:'#2dd4a7'}]},
      options:{scales:{r:{min:0,max:100,ticks:{display:false}}},plugins:{legend:{display:false}}}});
  },

  /* ───────── COMPARISON ───────── */
  _cmpPlaces:['',''],
  renderComparePlaces(){
    const root=document.getElementById('cmpPlaces'); if(!root) return;
    if (this._cmpPlaces.length<2) this._cmpPlaces=['',''];
    root.innerHTML=this._cmpPlaces.map((v,i)=>`
      <div class="cmp-place-row">
        <span class="cmp-num">${i+1}</span>
        <input type="text" placeholder="Place ${i+1} (city / area / district)" value="${U.esc(v)}" onchange="Intel.setComparePlace(${i},this.value)">
        ${this._cmpPlaces.length>2?`<button class="wp-del" onclick="Intel.removeComparePlace(${i})">✕</button>`:''}
      </div>`).join('');
  },
  addComparePlace(){ this._cmpPlaces.push(''); this.renderComparePlaces(); },
  removeComparePlace(i){ this._cmpPlaces.splice(i,1); this.renderComparePlaces(); },
  setComparePlace(i,v){ this._cmpPlaces[i]=v; },

  async compare() {
    const raw = (this._cmpPlaces||[]).map(s=>s.trim()).filter(Boolean);
    const names = [...new Set(raw)];
    if (names.length < 2) { U.toast('Enter at least 2 locations'); return; }
    const out = document.getElementById('cmpOut');
    out.innerHTML = '<div class="note">Comparing '+names.length+' locations… (geocode → analyze each)</div>';
    const rows = [];
    for (const n of names) {
      try {
        const res = await fetch(`${CONFIG.NOMINATIM}/search?q=${encodeURIComponent(n)}&format=json&limit=1&countrycodes=in`);
        const d = await res.json();
        if (!d.length) { rows.push({ name:n, err:true }); continue; }
        const s = await this.analyzePoint(+d[0].lat, +d[0].lon, 5);
        const roi = Math.round(8 + s.demand*0.18 - (100-s.gap)*0.06);
        rows.push({ name:n, lat:+d[0].lat, lon:+d[0].lon, ...s, roi, grade:this.grade(s.suitability) });
      } catch(e) { rows.push({ name:n, err:true }); }
    }
    this._cmpRows = rows;
    const best = rows.filter(r=>!r.err).sort((a,b)=>b.suitability-a.suitability)[0];
    out.innerHTML = `<table class="cmp-table">
      <tr><th>Metric</th>${rows.map(r=>`<th>${U.esc(r.name)}</th>`).join('')}</tr>
      <tr><td>Suitability</td>${rows.map(r=>`<td><b>${r.err?'—':r.suitability}</b>${r.err?'':' ('+r.grade+')'}</td>`).join('')}</tr>
      <tr><td>Demand</td>${rows.map(r=>`<td><b>${r.err?'—':r.demand}</b></td>`).join('')}</tr>
      <tr><td>Gap (need)</td>${rows.map(r=>`<td><b>${r.err?'—':r.gap}</b></td>`).join('')}</tr>
      <tr><td>Access</td>${rows.map(r=>`<td><b>${r.err?'—':r.access}</b></td>`).join('')}</tr>
      <tr><td>Charger density</td>${rows.map(r=>`<td><b>${r.err?'—':r.density}</b></td>`).join('')}</tr>
      <tr><td>Nearest charger</td>${rows.map(r=>`<td><b>${r.err?'—':(r.nearestChargerKm??'—')} km</b></td>`).join('')}</tr>
      <tr><td>Est. ROI %/yr</td>${rows.map(r=>`<td><b>${r.err?'—':r.roi}%</b></td>`).join('')}</tr>
    </table>
    ${best?`<div class="note">Best candidate: <b style="color:var(--accent)">${U.esc(best.name)}</b> (suitability ${best.suitability}/100)</div>`:''}
    <div class="chart-box"><h5>Metric comparison</h5><canvas id="cmpChart"></canvas></div>
    ${this.repRow('cmpOut','Location Comparison','compare')}`;
    const ok=rows.filter(r=>!r.err);
    this.cjs('cmpChart',{type:'bar',data:{labels:['Suitability','Demand','Gap','Access','Density'],
      datasets:ok.map((r,i)=>({label:r.name,data:[r.suitability,r.demand,r.gap,r.access,r.density],
        backgroundColor:['#2dd4a7','#4f8ef7','#f5a623','#b78bfa','#fb7185'][i%5],borderRadius:4}))},
      options:{scales:{y:{min:0,max:100}}}});
    return rows;
  },

  exportCompare(fmt){ this.exportPanel('cmpOut','Location Comparison',fmt,'compare'); },

  /* ───────── INVESTMENT PLANNER ───────── */
  async investment() {
    const type = document.getElementById('invType').value;
    const count = +document.getElementById('invCount').value;
    const tariff = +document.getElementById('invTariff').value;
    const areaName = (document.getElementById('invArea').value||'').trim();
    const out = document.getElementById('invOut');
    out.innerHTML = '<div class="note">Analyzing area demand…</div>';
    let lat, lon, areaLabel='current map area';
    if (areaName){
      try { const r=await fetch(`${CONFIG.NOMINATIM}/search?q=${encodeURIComponent(areaName)}&format=json&limit=1&countrycodes=in`); const d=await r.json(); if(d.length){ lat=+d[0].lat; lon=+d[0].lon; areaLabel=areaName; } } catch(e){}
    }
    if (lat==null){ const c=MapMod.map.getCenter(); lat=c.lat; lon=c.lng; }
    const s = await this.analyzePoint(lat, lon, 5);
    const util = Math.max(0.12, Math.min(0.55, 0.12 + s.demand/100*0.43));
    const SPEC = { AC:{ capexL:1.5, kw:22, opexLyr:0.6 }, DC:{ capexL:14, kw:50, opexLyr:2.2 } }[type];
    const capex = SPEC.capexL * count;
    const opex = SPEC.opexLyr * count;
    const kwhPerDay = SPEC.kw * 24 * util * count * 0.65;
    const margin = 7;
    const revenue = kwhPerDay * Math.min(margin, tariff*0.45) * 365 / 100000;
    const profit = revenue - opex;
    const payback = profit > 0 ? (capex/profit) : null;
    const roi = profit > 0 ? Math.round(profit/capex*100) : 0;
    const curve = []; let cum=-capex;
    for (let y=1;y<=6;y++){ cum += profit; curve.push({label:'Y'+y, value:+cum.toFixed(1)}); }
    out.innerHTML = `
      <table class="cmp-table"><tr><th>Item</th><th>Value</th></tr>
        <tr><td>Area</td><td>${U.esc(areaLabel)}</td></tr>
        <tr><td>Configuration</td><td>${count} × ${CONFIG.TYPE_NAMES[type]}</td></tr>
        <tr><td>Demand index</td><td>${s.demand}/100</td></tr>
        <tr><td>Expected utilization</td><td>${Math.round(util*100)}%</td></tr>
        <tr><td>Infrastructure cost (CAPEX)</td><td>₹${capex.toFixed(1)} lakh</td></tr>
        <tr><td>Operating cost (OPEX)</td><td>₹${opex.toFixed(1)} lakh / year</td></tr>
        <tr><td>Energy served</td><td>≈ ${Math.round(kwhPerDay)} kWh / day</td></tr>
        <tr><td>Revenue forecast</td><td>₹${revenue.toFixed(1)} lakh / year</td></tr>
        <tr><td>Net profit</td><td>₹${profit.toFixed(1)} lakh / year</td></tr>
        <tr><td>ROI</td><td>${roi}% / year</td></tr>
        <tr><td>Break-even</td><td>${payback?payback.toFixed(1)+' years':'—'}</td></tr>
        <tr><td>Verdict</td><td>${payback && payback<5?'Strong investment case':payback&&payback<9?'Moderate case':'Weak case at this utilization'}</td></tr>
      </table>
      <div class="chart-box"><h5>Cumulative profit — 6 years (₹ lakh)</h5><canvas id="invChart"></canvas></div>
      ${this.repRow('invOut','Investment Analysis','area')}`;
    this.cjs('invChart',{type:'line',data:{labels:curve.map(c=>c.label),
      datasets:[{label:'Cumulative ₹ lakh',data:curve.map(c=>c.value),borderColor:'#2dd4a7',
        backgroundColor:'rgba(45,212,167,.15)',fill:true,tension:.3,pointRadius:4}]},
      options:{plugins:{legend:{display:false}}}});
  },

  /* ───────── SCENARIO SIMULATOR ───────── */
  scenario() {
    const n = +document.getElementById('scnCount')?.value || 5;
    const out = document.getElementById('scnOut'); if(!out) return;
    const c = MapMod.ctx;
    if (!MapMod.allStations.length) { out.innerHTML = '<div class="note">Load an area first.</div>'; return; }
    const b = MapMod.map.getBounds();
    const pts = [];
    const rnd = U.rng(4242);
    for (let i = 0; i < 240; i++)
      pts.push({ lat: b.getSouth()+rnd()*(b.getNorth()-b.getSouth()),
                 lon: b.getWest()+rnd()*(b.getEast()-b.getWest()) });
    const covered = (stations) => pts.filter(p => stations.some(s => U.haversine(p.lat,p.lon,s.lat,s.lon) <= 5)).length;
    const before = covered(MapMod.allStations);
    const virtual = [];
    let pool = [...MapMod.allStations];
    for (let k = 0; k < n; k++) {
      let worst = null, worstD = -1;
      pts.forEach(p => {
        let nearest = Infinity;
        pool.forEach(s => { const d = U.haversine(p.lat,p.lon,s.lat,s.lon); if (d<nearest) nearest=d; });
        virtual.forEach(s => { const d = U.haversine(p.lat,p.lon,s.lat,s.lon); if (d<nearest) nearest=d; });
        if (nearest > worstD) { worstD = nearest; worst = p; }
      });
      if (worst) virtual.push({ lat:worst.lat, lon:worst.lon });
    }
    const after = covered([...pool, ...virtual]);
    virtual.forEach((v,i) => L.circleMarker([v.lat,v.lon], {
      radius:9, color:'#fff', weight:2, fillColor:'#b78bfa', fillOpacity:.95
    }).addTo(MapMod.map).bindPopup(`Proposed charger ${i+1} (scenario)`));
    const b1 = Math.round(before/pts.length*100), a1 = Math.round(after/pts.length*100);
    out.innerHTML = `<div class="score-card"><div class="note" style="margin:0">
      <b>Scenario:</b> +${n} chargers in ${U.esc(c.label)}<br>
      Coverage (≤5 km): <b>${b1}%</b> → <b style="color:var(--accent)">${a1}%</b> (+${a1-b1} pts)<br>
      Proposed sites marked on map (greedy max-coverage placement)
      </div></div>
      ${this.repRow('scnOut','Coverage Scenario','area')}`;
  },

  /* ───────── FORECAST SLIDER ───────── */
  forecastYear: 2025,
  setForecastYear(y) {
    this.forecastYear = +y;
    document.getElementById('fcYearVal').textContent = y;
    const growth = { 2025:1, 2030:2.6, 2035:5.2, 2040:8.5 }[y] || 1;
    document.getElementById('fcOut').innerHTML = `<div class="note">
      ${y}: projected EV demand ≈ <b>${growth}×</b> of 2025 baseline
      ${y>=2035?' — plan ultra-fast corridor infrastructure now':''}</div>`;
    this.refreshHeat();
  },

  /* ───────── HEATMAP / DENSITY STUDIO ───────── */
  async densModeChanged(){
    const mode=document.getElementById('densMode').value;
    const sub=document.getElementById('densSub');
    if (mode==='all'){ sub.style.display='none'; this.refreshHeat(); return; }
    if (!MapMod.datasetLoaded) await MapMod.loadDataset();
    if (mode==='type'){
      sub.innerHTML=['AC','DC','AC_DC','SWAP','FAST','ULTRA'].map(t=>`<option value="${t}">${t==='AC_DC'?'AC + DC':t==='SWAP'?'Battery Swap':t==='FAST'?'Fast ≥50kW':t==='ULTRA'?'Ultra ≥150kW':t}</option>`).join('');
    } else {
      const ops={}; MapMod.masterStations.forEach(s=>{ if(s.operator) ops[s.operator]=(ops[s.operator]||0)+1; });
      const top=Object.entries(ops).sort((a,b)=>b[1]-a[1]).slice(0,10);
      sub.innerHTML=top.map(([o,n])=>`<option value="${U.esc(o)}">${U.esc(o)} (${n})</option>`).join('');
    }
    sub.style.display='';
    this.refreshHeat();
  },
  _densityPool(pool){
    const mode=document.getElementById('densMode')?.value||'all';
    const sub=document.getElementById('densSub')?.value;
    if (mode==='type'&&sub){
      if (sub==='FAST') return pool.filter(s=>s.fast);
      if (sub==='ULTRA') return pool.filter(s=>s.ultra);
      return pool.filter(s=>s.type===sub);
    }
    if (mode==='operator'&&sub) return pool.filter(s=>s.operator===sub);
    return pool;
  },
  _densLabel(){
    const mode=document.getElementById('densMode')?.value||'all';
    const sub=document.getElementById('densSub');
    if (mode==='type'&&sub) return ' · '+sub.options[sub.selectedIndex].text;
    if (mode==='operator'&&sub) return ' · '+sub.value;
    return '';
  },
  refreshHeat() {
    if (typeof L.heatLayer !== 'function') return;
    let pool = (MapMod.masterStations && MapMod.masterStations.length) ? MapMod.masterStations : MapMod.allStations;
    const c = MapMod.ctx;
    if (c && c.mode==='boundary' && c.polygon)
      pool = pool.filter(s=>U.pointInGeoJSON(s.lon, s.lat, c.polygon));
    else if (c && c.mode==='radius' && c.center)
      pool = pool.filter(s=>U.haversine(c.center.lat,c.center.lon,s.lat,s.lon)<=c.radiusKm+0.05);
    pool = this._densityPool(pool);
    document.querySelectorAll('[data-heat]').forEach(cb => {
      const kind = cb.dataset.heat;
      if (MapMod.heatLayers[kind]) { MapMod.map.removeLayer(MapMod.heatLayers[kind]); delete MapMod.heatLayers[kind]; }
      if (!cb.checked) return;
      const pts = pool.map(s => [s.lat, s.lon, (s.type==='DC'||s.type==='AC_DC')?0.9:0.6]);
      if (pts.length)
        MapMod.heatLayers[kind] = L.heatLayer(pts, { radius:30, blur:24, maxZoom:12 }).addTo(MapMod.map);
      U.toast(`Charger density: <b>${pts.length}</b> stations ${c&&c.mode!=='none'&&c.label?('in <b>'+U.esc(c.label)+'</b>'):'across India'}`);
    });
  },

  /* ───────── RANKINGS (TOP 50) ───────── */
  async rankings(mode='state') {
    const out = document.getElementById('rankOut');
    out.innerHTML = '<div class="note">Computing from dataset…</div>';
    if (!MapMod.datasetLoaded) await MapMod.loadDataset();
    const keyOf = mode==='city' ? (s=>s.city||'Unknown') : (s=>s.state||'Unknown');
    const grp = {};
    MapMod.masterStations.forEach(s => {
      const k = keyOf(s);
      if (!k || k==='Unknown') return;
      grp[k] = grp[k] || { total:0, AC:0, DC:0, AC_DC:0, SWAP:0, ultra:0 };
      grp[k].total++; if (grp[k][s.type]!==undefined) grp[k][s.type]++;
      if (s.powerKW >= 100) grp[k].ultra++;
    });
    const maxTotal = Math.max(...Object.values(grp).map(x=>x.total), 1);
    const rows = Object.entries(grp).map(([name,m]) => {
      const coverage=(m.total/maxTotal)*60, dcRatio=m.total?(m.DC/m.total)*25:0, ultra=m.total?(m.ultra/m.total)*15:0;
      const score=Math.round(coverage+dcRatio+ultra);
      return { name, total:m.total, dc:m.DC, score, grade:this.grade(score) };
    }).filter(r=>mode==='state'||r.total>=2).sort((a,b)=>b.score-a.score);
    this._rankRows=rows.slice(0,50); this._rankMode=mode;
    out.innerHTML = `<table class="cmp-table">
      <tr><th>#</th><th>${mode==='city'?'City/District':'State'}</th><th>Stations</th><th>DC</th><th>Readiness</th><th>Grade</th></tr>
      ${rows.slice(0,50).map((d,i)=>`<tr>
        <td>${i+1}</td><td>${U.esc(d.name)}</td><td>${d.total}</td><td>${d.dc}</td>
        <td><b>${d.score}</b>/100</td>
        <td><span class="score-grade g-${d.grade}" style="margin:0">${d.grade}</span></td></tr>`).join('')}
    </table>
    <div class="note">Top 50 — ${mode==='city'?'city/district':'state'}-level readiness = coverage (60%) + DC ratio (25%) + ultra-power (15%), from your dataset of <b>${MapMod.masterStations.length}</b> stations.</div>
    ${this.repRow('rankOut','Readiness Rankings','national')}`;
  },

  /* ───────── DASHBOARDS ───────── */
  dashTab(which, btn){
    document.querySelectorAll('.dash-tab').forEach(b=>b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (which==='national') this.nationalDashboard();
    else this.areaDashboard();
  },

  async areaDashboard(){
    const out=document.getElementById('dashOut'); if(!out) return;
    out.innerHTML='<div class="note">Analyzing current map area…</div>';
    if (!MapMod.datasetLoaded) await MapMod.loadDataset();
    const b=MapMod.map.getBounds();
    const inView=MapMod.masterStations.filter(s=>s.lat>=b.getSouth()&&s.lat<=b.getNorth()&&s.lon>=b.getWest()&&s.lon<=b.getEast());
    const tc={AC:0,DC:0,AC_DC:0,SWAP:0}; inView.forEach(s=>{ if(tc[s.type]!==undefined) tc[s.type]++; });
    const ctr=MapMod.map.getCenter();
    const s=await this.analyzePoint(ctr.lat,ctr.lng,6);
    const adv=this.chargerAdvice(s);
    out.innerHTML=`
      <div class="dash-kpis">
        <div class="kpi"><span class="kpi-v">${inView.length}</span><span class="kpi-l">Stations in view</span></div>
        <div class="kpi"><span class="kpi-v">${tc.DC+tc.AC_DC}</span><span class="kpi-l">DC-capable</span></div>
        <div class="kpi"><span class="kpi-v">${s.demand}</span><span class="kpi-l">Demand /100</span></div>
        <div class="kpi"><span class="kpi-v">${s.suitability}</span><span class="kpi-l">Suitability</span></div>
      </div>
      <table class="cmp-table"><tr><th>Indicator</th><th>Value</th></tr>
        <tr><td>Stations in view</td><td>${inView.length}</td></tr>
        <tr><td>AC / DC / AC+DC / Swap</td><td>${tc.AC} / ${tc.DC} / ${tc.AC_DC} / ${tc.SWAP}</td></tr>
        <tr><td>Demand index</td><td>${s.demand}/100</td></tr>
        <tr><td>Charging gap</td><td>${s.gap}/100</td></tr>
        <tr><td>Accessibility</td><td>${s.access}/100</td></tr>
        <tr><td>Suitability</td><td>${s.suitability}/100 (Grade ${this.grade(s.suitability)})</td></tr>
        <tr><td>Recommendation</td><td>${adv.qty} × ${adv.type} · utilization ${adv.util}</td></tr>
      </table>
      ${inView.length?'<div class="chart-box"><h5>Charger mix (in view)</h5><canvas id="ad1"></canvas></div>':''}
      <div class="chart-box"><h5>Area score profile</h5><canvas id="ad2"></canvas></div>
      <div class="note">Pan/zoom the map and re-open this tab to refresh for a different area.</div>
      ${this.repRow('dashOut','Area Dashboard','area')}`;
    if (inView.length) this.cjs('ad1',{type:'doughnut',data:{labels:['DC','AC','AC + DC','Swap'],
      datasets:[{data:[tc.DC,tc.AC,tc.AC_DC,tc.SWAP],backgroundColor:['#ef4444','#4f8ef7','#facc15','#22c55e'],borderWidth:0}]},
      options:{cutout:'62%',plugins:{legend:{position:'right'}}}});
    this.cjs('ad2',{type:'radar',data:{labels:['Demand','Charging gap','Accessibility','Suitability','Density'],
      datasets:[{label:'This area',data:[s.demand,s.gap,s.access,s.suitability,s.density],
      borderColor:'#2dd4a7',backgroundColor:'rgba(45,212,167,.2)',pointBackgroundColor:'#2dd4a7'}]},
      options:{scales:{r:{min:0,max:100,ticks:{display:false}}},plugins:{legend:{display:false}}}});
  },

  async nationalDashboard() {
    const out = document.getElementById('dashOut');
    if (!out) return;
    out.innerHTML = '<div class="note">Loading…</div>';
    if (!MapMod.datasetLoaded) await MapMod.loadDataset();
    const all = MapMod.masterStations;
    const tc={AC:0,DC:0,AC_DC:0,SWAP:0}; let fast=0,ultra=0;
    all.forEach(s=>{ if(tc[s.type]!==undefined) tc[s.type]++; if(s.fast)fast++; if(s.ultra)ultra++; });
    const states = {}; all.forEach(s=>{ if(s.state) states[s.state]=(states[s.state]||0)+1; });
    const top = Object.entries(states).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const ops = {}; all.forEach(s=>{ if(s.operator&&s.operator!=='Operator unknown') ops[s.operator]=(ops[s.operator]||0)+1; });
    const topOps = Object.entries(ops).sort((a,b)=>b[1]-a[1]).slice(0,7);
    const cities={}; all.forEach(s=>{ if(s.city) cities[s.city]=(cities[s.city]||0)+1; });
    const topCities=Object.entries(cities).sort((a,b)=>b[1]-a[1]).slice(0,10);
    out.innerHTML = `
      <div class="dash-kpis">
        <div class="kpi"><span class="kpi-v">${all.length}</span><span class="kpi-l">Total stations</span></div>
        <div class="kpi"><span class="kpi-v">${tc.DC+tc.AC_DC}</span><span class="kpi-l">DC-capable</span></div>
        <div class="kpi"><span class="kpi-v">${fast}</span><span class="kpi-l">Fast ≥50kW</span></div>
        <div class="kpi"><span class="kpi-v">${Object.keys(states).length}</span><span class="kpi-l">States/UTs</span></div>
      </div>
      <div class="chart-box"><h5>Charger type split</h5><canvas id="nd1"></canvas></div>
      <div class="chart-box"><h5>Top 10 states by station count</h5><canvas id="nd2"></canvas></div>
      <div class="chart-box"><h5>Operator distribution</h5><canvas id="nd3"></canvas></div>
      <div class="chart-box"><h5>Charging speed split</h5><canvas id="nd4"></canvas></div>
      <div class="chart-box"><h5>Top 10 cities</h5><canvas id="nd5"></canvas></div>
      <table class="cmp-table"><tr><th>State</th><th>Stations</th></tr>${top.map(([s,n])=>`<tr><td>${U.esc(s)}</td><td>${n}</td></tr>`).join('')}</table>
      <div class="note">Live from your Stage-1 master dataset (${all.length} stations, ${ultra} ultra-fast). This dashboard is ALWAYS national — the report exports national data only, whatever is selected on the map.</div>
      ${this.repRow('dashOut','National Dashboard','national')}`;
    this.cjs('nd1',{type:'doughnut',data:{labels:['DC','AC','AC + DC','Battery Swap'],
      datasets:[{data:[tc.DC,tc.AC,tc.AC_DC,tc.SWAP],backgroundColor:['#ef4444','#4f8ef7','#facc15','#22c55e'],borderWidth:0}]},
      options:{cutout:'62%',plugins:{legend:{position:'right'}}}});
    this.cjs('nd2',{type:'bar',data:{labels:top.map(([s])=>s),datasets:[{data:top.map(([,n])=>n),
      backgroundColor:'#2dd4a7',borderRadius:5}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}}}});
    this.cjs('nd3',{type:'bar',data:{labels:topOps.map(([o])=>o.length>16?o.slice(0,16)+'…':o),datasets:[{data:topOps.map(([,n])=>n),
      backgroundColor:'#b78bfa',borderRadius:5}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}}}});
    this.cjs('nd4',{type:'doughnut',data:{labels:['Ultra fast ≥150kW','Fast ≥50kW','Standard'],
      datasets:[{data:[ultra,fast-ultra,all.length-fast],backgroundColor:['#e11d48','#fb7185','#4f8ef7'],borderWidth:0}]},
      options:{cutout:'62%',plugins:{legend:{position:'right'}}}});
    this.cjs('nd5',{type:'bar',data:{labels:topCities.map(([c])=>c.length>14?c.slice(0,14)+'…':c),
      datasets:[{data:topCities.map(([,n])=>n),backgroundColor:'#f5a623',borderRadius:5}]},
      options:{indexAxis:'y',plugins:{legend:{display:false}}}});
  },

  /* ───────── Chart.js helper ───────── */
  _charts:{},
  cjs(id, cfg){
    if (typeof Chart==='undefined') return;
    const el=document.getElementById(id); if(!el) return;
    if (this._charts[id]) this._charts[id].destroy();
    Chart.defaults.color='#94a0bf'; Chart.defaults.borderColor='rgba(120,140,190,.15)';
    Chart.defaults.font.family="'Plus Jakarta Sans',sans-serif";
    this._charts[id]=new Chart(el, cfg);
  },

  /* ───────── DENSITY DATA + REPORT (scoped to current selection BY DESIGN) ───────── */
  _featBounds(f){ return Boundaries.featureBounds(f); },

  async _densityData(levelOverride){
    if (!MapMod.datasetLoaded) await MapMod.loadDataset();
    let level = levelOverride || 'states';
    if (!levelOverride){
      if (document.getElementById('bnd-subdistricts')?.checked) level='subdistricts';
      else if (document.getElementById('bnd-districts')?.checked) level='districts';
    }
    let g = await Boundaries.load(level);
    if (!g && level==='subdistricts'){ U.toast('Sub-district file missing — using district level'); level='districts'; g=await Boundaries.load('districts'); }
    if (!g){ U.toast('Boundary data unavailable'); return null; }
    const c=MapMod.ctx;
    let pool=MapMod.masterStations;
    if (c && c.mode==='boundary' && c.polygon) pool=pool.filter(s=>U.pointInGeoJSON(s.lon,s.lat,c.polygon));
    else if (c && c.mode==='radius' && c.center) pool=pool.filter(s=>U.haversine(c.center.lat,c.center.lon,s.lat,s.lon)<=c.radiusKm+0.05);
    pool=this._densityPool(pool);
    const feats = g.features.map(f=>({f, b:this._featBounds(f), rec:{name:f.properties.name||f.properties.NAME||'—',
      state:f.properties.state||'', total:0, AC:0, DC:0, AC_DC:0, SWAP:0, fast:0, ultra:0}}));
    for (const s of pool){
      for (const ft of feats){
        const [mnLa,mnLo,mxLa,mxLo]=ft.b;
        if (s.lat<mnLa||s.lat>mxLa||s.lon<mnLo||s.lon>mxLo) continue;
        if (!U.pointInGeoJSON(s.lon,s.lat,ft.f.geometry)) continue;
        ft.rec.total++; if(ft.rec[s.type]!==undefined) ft.rec[s.type]++;
        if (s.fast) ft.rec.fast++; if (s.ultra) ft.rec.ultra++;
        break;
      }
    }
    let scoped = feats;
    if (c && c.mode==='boundary' && c.bbox){
      const [s0,w0,n0,e0]=c.bbox;
      scoped = feats.filter(ft=>!(ft.b[2]<s0||ft.b[0]>n0||ft.b[3]<w0||ft.b[1]>e0) && ft.rec.total>0);
      if (!scoped.length) scoped=feats.filter(ft=>ft.rec.total>0);
    }
    const rows = scoped.map(ft=>ft.rec).sort((a,b)=>b.total-a.total);
    return { level, feats:scoped, rows, poolSize:pool.length, scopeLabel:(c&&c.mode!=='none'&&c.label)?c.label:'All India' };
  },

  _densityMapImage(feats){
    const W=1200,H=900,pad=40;
    let mnLa=90,mxLa=-90,mnLo=180,mxLo=-180;
    feats.forEach(ft=>{ mnLa=Math.min(mnLa,ft.b[0]); mxLa=Math.max(mxLa,ft.b[2]); mnLo=Math.min(mnLo,ft.b[1]); mxLo=Math.max(mxLo,ft.b[3]); });
    const sx=(W-pad*2)/((mxLo-mnLo)||1), sy=(H-pad*2)/((mxLa-mnLa)||1), sc=Math.min(sx,sy);
    const px=lon=>pad+(lon-mnLo)*sc, py=lat=>H-pad-(lat-mnLa)*sc;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const ctx=cv.getContext('2d');
    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
    const max=Math.max(1,...feats.map(ft=>ft.rec.total));
    const color=v=>{ const t=Math.pow(v/max,0.5);
      const r=Math.round(232-t*(232-13)), gg=Math.round(247-t*(247-148)), b=Math.round(240-t*(240-99));
      return `rgb(${r},${gg},${b})`; };
    const drawPoly=(coords)=>{ ctx.beginPath();
      coords.forEach((ring)=>{ ring.forEach((pt,i)=>{ const x=px(pt[0]),y=py(pt[1]); i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); });
      ctx.fill(); ctx.stroke(); };
    feats.forEach(ft=>{
      ctx.fillStyle=color(ft.rec.total); ctx.strokeStyle='#5a6b8c'; ctx.lineWidth=0.7;
      const geom=ft.f.geometry;
      if (geom.type==='Polygon') drawPoly(geom.coordinates);
      else if (geom.type==='MultiPolygon') geom.coordinates.forEach(p=>drawPoly(p));
    });
    ctx.fillStyle='#16203a'; ctx.font='bold 26px Arial'; ctx.fillText('Charger density',pad,32);
    const lw=220;
    for(let i=0;i<lw;i++){ ctx.fillStyle=color(max*i/lw); ctx.fillRect(W-pad-lw+i,H-46,1,16); }
    ctx.fillStyle='#16203a'; ctx.font='13px Arial';
    ctx.fillText('0',W-pad-lw,H-52); ctx.fillText(String(max),W-pad-14,H-52);
    return cv.toDataURL('image/png');
  },

  async densityReport(fmt='docx'){
    U.toast('Building density report…');
    const d = await this._densityData(); if(!d) return;
    const levelName = d.level==='states'?'State':d.level==='districts'?'District':'Sub-district';
    const img = this._densityMapImage(d.feats);
    if (fmt==='png'){
      const a=document.createElement('a'); a.href=img;
      a.download=`Eas_EV_Density_${levelName}_${d.scopeLabel.replace(/\s+/g,'_')}.png`; a.click();
      U.toast('Density map PNG downloaded');
      return;
    }
    const fname = `Eas_EV_Density_${levelName}_${d.scopeLabel.replace(/\s+/g,'_')}`;
    const rows = d.rows;
    const headArr = [levelName, ...(d.level!=='states'?['State']:[]), 'Total','AC','DC','AC+DC','Swap','Fast ≥50kW','Ultra'];
    const rowArr = rows.map(r=>[r.name, ...(d.level!=='states'?[r.state]:[]), r.total,r.AC,r.DC,r.AC_DC,r.SWAP,r.fast,r.ultra]);

    if (fmt==='xlsx'){
      if (typeof XLSX==='undefined'){ U.toast('Excel library not loaded'); return; }
      const wb=XLSX.utils.book_new();
      const totAll=rows.reduce((a,r)=>a+r.total,0)||1, mx=Math.max(...rows.map(r=>r.total),1);
      const aoa=[[`Eas_EV — ${levelName}-wise charger density`],[`Scope: ${d.scopeLabel}`,`Stations: ${d.poolSize}`,`Generated: ${new Date().toLocaleString()}`],[],
        [...headArr,'Share %','Bar (visual)'],
        ...rowArr.map((r,i)=>[...r, Math.round(rows[i].total/totAll*1000)/10, this._xlsxBar(rows[i].total,mx)]),
        ['TOTAL',...(d.level!=='states'?['']:[]),
          totAll, rows.reduce((a,r)=>a+r.AC,0), rows.reduce((a,r)=>a+r.DC,0), rows.reduce((a,r)=>a+r.AC_DC,0),
          rows.reduce((a,r)=>a+r.SWAP,0), rows.reduce((a,r)=>a+r.fast,0), rows.reduce((a,r)=>a+r.ultra,0),'100','']];
      const ws=XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols']=[{wch:28},{wch:18},{wch:8},{wch:8},{wch:8},{wch:8},{wch:12},{wch:12},{wch:10},{wch:9},{wch:28}];
      XLSX.utils.book_append_sheet(wb, ws, 'Density');
      XLSX.writeFile(wb, fname+'.xlsx');
      const a=document.createElement('a'); a.href=img; a.download=fname+'_map.png'; a.click();
      U.toast('📊 Excel report + map PNG downloaded');
      return;
    }
    const meta={scope:d.scopeLabel,count:d.poolSize,docType:'DENSITY REPORT'};
    const sections=[
      { h:'Report scope', table:{ head:['Item','Value'], rows:[
          ['Scope', d.scopeLabel],['Boundary level', levelName],['Stations analysed', String(d.poolSize)],
          ['Density mode','Overall'+this._densLabel()],['Generated', new Date().toLocaleString()]], cap:'Report scope and settings' } },
      { h:'Density map', image:{data:img, cap:`${levelName}-wise charger density — ${d.scopeLabel}`, w:560, h:420}, pageBreak:true },
      { h:`${levelName}-wise density table`, table:{ head:headArr, rows:rowArr, cap:`${levelName}-wise charger counts (${d.scopeLabel})` } },
    ];
    if (fmt==='pdf'){ this._printPDF(`${levelName}-wise Charger Density`, meta, sections); return; }
    await this.buildDocx(`${levelName}-wise Charger Density Report`, `${d.scopeLabel} · ${d.poolSize} stations · ${new Date().toLocaleDateString()}`, meta, sections, fname);
    U.toast('📝 Word density report downloaded');
  },

  /* ═════════ SCOPE-ISOLATED REPORT ENGINE ═════════
     scope: 'national'  → national data + all-India map (map selection IGNORED)
            'area'      → the selected area only
            'compare'   → compared places only (NO area map, NO map-scope data)   */
  repRow(panelId, title, scope='area'){
    return `<div class="rep-row"><span class="lbl">Report</span>
      <button class="btn sm" onclick="Intel.exportPanel('${panelId}','${title.replace(/'/g,"\\'")}','docx','${scope}')">Word</button>
      <button class="btn sm" onclick="Intel.exportPanel('${panelId}','${title.replace(/'/g,"\\'")}','xlsx','${scope}')">Excel</button>
      <button class="btn sm" onclick="Intel.exportPanel('${panelId}','${title.replace(/'/g,"\\'")}','pdf','${scope}')">PDF</button></div>`;
  },

  /* pool + label for a given report scope — NEVER leaks the map selection into national reports */
  _scopeInfo(scope){
    const all=MapMod.masterStations||[];
    if (scope==='national') return { pool:all, label:'All India', mode:'national' };
    if (scope==='compare'){
      const names=(this._cmpRows||[]).filter(r=>!r.err).map(r=>r.name);
      return { pool:[], label:names.join(' vs ')||'Compared locations', mode:'compare' };
    }
    const c=MapMod.ctx||{mode:'none'};
    if (c.mode==='boundary'&&c.polygon) return { pool:all.filter(s=>U.pointInGeoJSON(s.lon,s.lat,c.polygon)), label:c.label||'Selected area', mode:'area' };
    if (c.mode==='radius'&&c.center) return { pool:all.filter(s=>U.haversine(c.center.lat,c.center.lon,s.lat,s.lon)<=c.radiusKm+0.05), label:c.label||'Selected radius', mode:'area' };
    return { pool:all, label:'All India', mode:'national' };
  },

  /* map snapshot honouring the report scope */
  async ctxMapImage(style='points', scope='area'){
    const W=1200,H=900,pad=48;
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const x=cv.getContext('2d');
    x.fillStyle='#ffffff'; x.fillRect(0,0,W,H);
    if (!MapMod.datasetLoaded) try{ await MapMod.loadDataset(); }catch(e){}
    const info=this._scopeInfo(scope);
    const c=(scope==='area')?(MapMod.ctx||{mode:'none'}):{mode:'none'};
    let pool=info.pool, outline=null, label=info.label;
    if (scope==='area'&&c.mode==='boundary'&&c.polygon) outline=c.polygon;

    let mnLa=90,mxLa=-90,mnLo=180,mxLo=-180;
    const feed=g=>{ const walk=cc=>{ if(typeof cc[0]==='number'){ mnLo=Math.min(mnLo,cc[0]);mxLo=Math.max(mxLo,cc[0]);mnLa=Math.min(mnLa,cc[1]);mxLa=Math.max(mxLa,cc[1]); } else cc.forEach(walk); }; walk(g.coordinates); };
    if (outline) feed(outline.type?outline:outline.geometry||outline);
    else if (scope==='area'&&c.mode==='radius'&&c.center){ const d=c.radiusKm/95; mnLa=c.center.lat-d;mxLa=c.center.lat+d;mnLo=c.center.lon-d;mxLo=c.center.lon+d; }
    else { const g=await Boundaries.load('states'); if(g) g.features.forEach(f=>feed(f.geometry)); else { mnLa=6;mxLa=37;mnLo=68;mxLo=98; } }
    const grow=(mxLa-mnLa)*0.04; mnLa-=grow;mxLa+=grow; const growL=(mxLo-mnLo)*0.04; mnLo-=growL;mxLo+=growL;
    const sc=Math.min((W-pad*2)/((mxLo-mnLo)||1),(H-pad*2)/((mxLa-mnLa)||1));
    const px=lo=>pad+(lo-mnLo)*sc, py=la=>H-pad-(la-mnLa)*sc;
    const drawGeom=(g,fill,stroke,w)=>{ x.fillStyle=fill;x.strokeStyle=stroke;x.lineWidth=w;
      const poly=cs=>{ x.beginPath(); cs.forEach(r=>{ r.forEach((pt,k)=>{ k?x.lineTo(px(pt[0]),py(pt[1])):x.moveTo(px(pt[0]),py(pt[1])); }); x.closePath(); }); x.fill(); x.stroke(); };
      if (g.type==='Polygon') poly(g.coordinates);
      else if (g.type==='MultiPolygon') g.coordinates.forEach(poly); };

    if (outline){ drawGeom(outline.type?outline:outline.geometry,'#eef7f3','#0d9463',2); }
    else if (scope==='area'&&c.mode==='radius'&&c.center){ x.fillStyle='#eef7f3';x.strokeStyle='#0d9463';x.lineWidth=2;
      x.beginPath(); x.arc(px(c.center.lon),py(c.center.lat),c.radiusKm/95*sc,0,7); x.fill(); x.stroke(); }
    else { const g=await Boundaries.load('states'); if(g) g.features.forEach(f=>drawGeom(f.geometry,'#f4f7fb','#8ea2c4',0.8)); }

    const colors={AC:'#4f8ef7',DC:'#ef4444',AC_DC:'#eab308',SWAP:'#22c55e'};
    const zoomed = !!outline || (scope==='area'&&c.mode==='radius');
    const step=Math.max(1,Math.floor(pool.length/4000));
    if (style==='heat'){
      x.globalAlpha=0.16;
      for(let k=0;k<pool.length;k+=step){ const s=pool[k];
        const gr=x.createRadialGradient(px(s.lon),py(s.lat),1,px(s.lon),py(s.lat),zoomed?26:12);
        gr.addColorStop(0,'#0D9463'); gr.addColorStop(0.6,'#2DD4A7'); gr.addColorStop(1,'rgba(45,212,167,0)');
        x.fillStyle=gr; x.beginPath(); x.arc(px(s.lon),py(s.lat),zoomed?26:12,0,7); x.fill(); }
      x.globalAlpha=1;
      for(let k=0;k<pool.length;k+=step){ const s=pool[k];
        x.fillStyle='#0D9463'; x.beginPath(); x.arc(px(s.lon),py(s.lat),2.2,0,7); x.fill(); }
    } else {
      for(let k=0;k<pool.length;k+=step){ const s=pool[k];
        x.fillStyle=colors[s.type]||'#1faa82';
        x.beginPath(); x.arc(px(s.lon),py(s.lat),zoomed?3.4:2.1,0,7); x.fill(); }
    }
    x.fillStyle='#16203a'; x.font='bold 25px Arial'; x.fillText(label+(style==='heat'?' — charger density':' — EV charging stations'),pad,32);
    let lx=pad;
    Object.entries(colors).forEach(([t,col])=>{ x.fillStyle=col; x.beginPath(); x.arc(lx+6,H-24,6,0,7); x.fill();
      x.fillStyle='#16203a'; x.font='13px Arial'; x.fillText(t.replace('_','+'),lx+16,H-19); lx+=x.measureText(t).width+52; });
    return { img:cv.toDataURL('image/png'), label, count:pool.length };
  },

  /* raw Chart.js data (labels + numeric series) so graphs can be rebuilt
     inside Excel as data tables + visual bars */
  _panelChartData(panel){
    const out=[];
    panel.querySelectorAll('canvas').forEach(cv=>{
      try{
        const ch=Chart.getChart(cv); if(!ch) return;
        const title=cv.closest('.chart-box')?.querySelector('h5')?.textContent||'Chart';
        const labels=(ch.data.labels||[]).map(String);
        const series=(ch.data.datasets||[]).map(d=>({label:String(d.label||'Series'), data:(d.data||[]).map(Number)}));
        if (labels.length && series.length) out.push({title, labels, series});
      }catch(e){}
    });
    return out;
  },
  /* text bar for Excel cells — renders as a horizontal bar chart in the sheet */
  _xlsxBar(v,max,width=24){
    const n=(!max||!isFinite(v))?0:Math.round((v/max)*width);
    return '█'.repeat(Math.max(0,Math.min(width,n)));
  },
  _wsName(s){ return String(s).replace(/[\[\]:*?\/\\]/g,' ').trim().slice(0,31)||'Sheet'; },

  /* panel content extraction — everything table-first */
  _panelCharts(panel){
    const imgs=[];
    panel.querySelectorAll('canvas').forEach(cv=>{
      try{ const ch=Chart.getChart(cv); if(!ch) return;
        const t=cv.closest('.chart-box')?.querySelector('h5')?.textContent||'Chart';
        const tmp=document.createElement('canvas'); tmp.width=cv.width*2; tmp.height=cv.height*2;
        const tx=tmp.getContext('2d'); tx.fillStyle='#ffffff'; tx.fillRect(0,0,tmp.width,tmp.height);
        tx.imageSmoothingQuality='high'; tx.drawImage(cv,0,0,tmp.width,tmp.height);
        imgs.push({title:t, data:tmp.toDataURL('image/png'), ar:cv.height/cv.width});
      }catch(e){}
    });
    return imgs;
  },
  _panelTableData(panel){
    return [...panel.querySelectorAll('table')].map(tb=>{
      const trs=[...tb.querySelectorAll('tr')];
      if (!trs.length) return null;
      const head=[...trs[0].querySelectorAll('th,td')].map(c=>c.innerText.trim());
      const rows=trs.slice(1).map(tr=>[...tr.querySelectorAll('td,th')].map(c=>c.innerText.trim()));
      const cap=tb.previousElementSibling&&/H[1-6]|DIV/.test(tb.previousElementSibling.tagName)?tb.previousElementSibling.innerText.trim().slice(0,80):'';
      return { head, rows, cap };
    }).filter(Boolean);
  },
  _panelKPIs(panel){
    return [...panel.querySelectorAll('.kpi')].map(k=>[
      k.querySelector('.kpi-l')?.innerText.trim()||'', k.querySelector('.kpi-v')?.innerText.trim()||'' ]);
  },
  _panelNotes(panel){
    const clone=panel.cloneNode(true);
    clone.querySelectorAll('button,input,select,canvas,table,.rep-row,.dl-row,.chart-box,.dash-kpis').forEach(n=>n.remove());
    return clone.innerText.split('\n').map(l=>l.replace(/^[•·]\s*/,'').trim()).filter(l=>l.length>2);
  },
  _chartInsight(panel){
    const out=[];
    panel.querySelectorAll('canvas').forEach(cv=>{
      try{
        const ch=Chart.getChart(cv); if(!ch) return;
        const title=cv.closest('.chart-box')?.querySelector('h5')?.textContent||'Chart';
        const labels=ch.data.labels||[];
        const ds=ch.data.datasets||[];
        if (!ds.length||!labels.length) return;
        if (ds.length===1){
          const vals=ds[0].data.map(Number);
          const tot=vals.reduce((a,b)=>a+b,0)||1;
          const pairs=labels.map((l,k)=>({l,v:vals[k]})).sort((a,b)=>b.v-a.v);
          const top=pairs[0], second=pairs[1];
          out.push({title, text:`${title}: ${top.l} leads with ${top.v} (${Math.round(top.v/tot*100)}% of the ${Math.round(tot)} total)`+
            (second?`, followed by ${second.l} with ${second.v} (${Math.round(second.v/tot*100)}%)`:'')+
            `. The bottom of the distribution is ${pairs[pairs.length-1].l} at ${pairs[pairs.length-1].v}.`});
        } else {
          const sums=ds.map(d=>({label:d.label,sum:d.data.reduce((a,b)=>a+Number(b),0)})).sort((a,b)=>b.sum-a.sum);
          out.push({title, text:`${title}: across ${labels.length} categories, ${sums[0].label} records the highest cumulative value`+
            (sums[1]?` ahead of ${sums[1].label}`:'')+`; see the corresponding figure for the category-wise pattern.`});
        }
      }catch(e){}
    });
    return out;
  },

  /* THE universal panel exporter */
  async exportPanel(panelId, title, fmt, scope='area'){
    const panel=document.getElementById(panelId);
    if (!panel || !panel.innerText.trim()){ U.toast('Run this analysis first, then export'); return; }
    U.toast('Building '+fmt.toUpperCase()+' report…');
    const info=this._scopeInfo(scope);
    const includeMap = scope!=='compare';
    const map = includeMap ? await this.ctxMapImage('points', scope) : { img:null, label:info.label, count:info.pool.length };
    const charts=this._panelCharts(panel);
    const tables=this._panelTableData(panel);
    const kpis=this._panelKPIs(panel);
    const notes=this._panelNotes(panel);
    const insights=this._chartInsight(panel);
    const stamp=new Date().toLocaleString();
    const fname=`Eas_EV_${title.replace(/\s+/g,'_')}_${map.label.replace(/[^\w]+/g,'_').slice(0,40)}`;
    const meta={scope:map.label, count:includeMap?map.count:(this._cmpRows||[]).filter(r=>!r.err).length+' locations', docType:title.toUpperCase()};

    /* assemble sections — TABLE-FIRST */
    const sections=[];
    sections.push({ h:'Report scope', table:{ head:['Item','Value'], rows:[
      ['Report', title],
      ['Scope', map.label],
      [scope==='compare'?'Locations compared':'Stations in scope', String(meta.count)],
      ['Scope rule', scope==='national'?'National data only — map selection ignored':scope==='compare'?'Compared locations only — map selection ignored':'Selected area only'],
      ['Generated', stamp]], cap:'Report scope' } });
    if (kpis.length) sections.push({ h:'Key indicators', table:{ head:['Indicator','Value'], rows:kpis, cap:'Headline indicators' } });
    if (includeMap && map.img) sections.push({ h:'Analysed area map', image:{data:map.img, cap:`${map.label} — EV charging stations`, w:560, h:420}, pageBreak:true });
    for (const ch of charts){
      const h=Math.round(560*(ch.ar||0.5));
      sections.push({ h:ch.title, image:{data:ch.data, cap:ch.title, w:560, h:Math.min(420,Math.max(240,h))},
        paras: (insights.find(i=>i.title===ch.title)||{}).text ? [insights.find(i=>i.title===ch.title).text] : [] });
    }
    for (const tb of tables) sections.push({ h:tb.cap||'Data table', table:{ head:tb.head, rows:tb.rows, cap:tb.cap||'Data table' } });
    if (notes.length) sections.push({ h:'Notes & findings', table:{ head:['#','Finding'], rows:notes.slice(0,40).map((n,i)=>[i+1,n]), cap:'Findings and remarks' } });

    if (fmt==='xlsx'){
      if (typeof XLSX==='undefined'){ U.toast('Excel library not loaded'); return; }
      const wb=XLSX.utils.book_new();
      const chartData=this._panelChartData(panel);

      /* ── Sheet 1: Report — title, scope, KPIs, chart insights, notes, contents ── */
      const rep=[[`Eas_EV — ${title}`],
        ['Scope', map.label],
        [scope==='compare'?'Locations compared':'Stations in scope', String(meta.count)],
        ['Scope rule', scope==='national'?'National data only — map selection ignored':scope==='compare'?'Compared locations only — map selection ignored':'Selected area only'],
        ['Generated', stamp],[]];
      if (kpis.length){ rep.push(['KEY INDICATORS','']); kpis.forEach(k=>rep.push([k[0],k[1]])); rep.push([]); }
      if (insights.length){ rep.push(['CHART FINDINGS','']); insights.forEach(i=>rep.push([i.title,i.text])); rep.push([]); }
      if (notes.length){ rep.push(['NOTES & FINDINGS','']); notes.slice(0,60).forEach((l,i)=>rep.push([i+1,l])); rep.push([]); }
      rep.push(['WORKBOOK CONTENTS','']);
      chartData.forEach((c,i)=>rep.push([`Chart ${i+1}`, c.title]));
      tables.forEach((tb,i)=>rep.push([`Table ${i+1}`, tb.cap||('Data table '+(i+1))]));
      if (info.pool.length) rep.push(['Distribution','Category / state / operator breakdown of the in-scope stations'],['Stations','Station-level data for the analysed scope']);
      const wsR=XLSX.utils.aoa_to_sheet(rep);
      wsR['!cols']=[{wch:26},{wch:110}];
      XLSX.utils.book_append_sheet(wb,wsR,'Report');

      /* ── one sheet per graph: the chart's own data + █-bar visual ── */
      chartData.forEach((c,i)=>{
        const aoa=[[c.title],[ (insights.find(x=>x.title===c.title)||{}).text||'' ],[]];
        const multi=c.series.length>1;
        aoa.push(['Category',...c.series.map(s=>s.label),...(multi?[]:['Share %','Bar (visual)'])]);
        const v0=c.series[0].data, tot=v0.reduce((a,b)=>a+(+b||0),0)||1, mx=Math.max(...v0.map(x=>+x||0),1);
        c.labels.forEach((l,k)=>{
          const row=[l,...c.series.map(s=>s.data[k]??'')];
          if (!multi) row.push(Math.round((v0[k]||0)/tot*1000)/10, this._xlsxBar(v0[k]||0,mx));
          aoa.push(row);
        });
        if (!multi) aoa.push(['TOTAL',Math.round(tot*100)/100,'100','']);
        else { const trow=['TOTAL',...c.series.map(s=>Math.round(s.data.reduce((a,b)=>a+(+b||0),0)*100)/100)]; aoa.push(trow); }
        aoa.push([],['Tip: select the Category column + a value column → Insert → Chart in Excel to redraw this graph natively.']);
        const ws=XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols']=[{wch:26},...c.series.map(()=>({wch:14})),{wch:9},{wch:28}];
        XLSX.utils.book_append_sheet(wb,ws,this._wsName(`Chart${i+1} ${c.title}`));
      });

      /* ── one sheet per on-screen table (with caption + sized columns) ── */
      tables.forEach((tb,i)=>{
        const ws=XLSX.utils.aoa_to_sheet([[tb.cap||('Table '+(i+1))],[],tb.head,...tb.rows]);
        ws['!cols']=tb.head.map((h,ci)=>({wch:Math.min(42,Math.max(10,...[h,...tb.rows.map(r=>String(r[ci]??''))].map(s=>String(s).length+2)))}));
        XLSX.utils.book_append_sheet(wb,ws,this._wsName(`Table${i+1} ${tb.cap||''}`));
      });

      /* ── Distribution sheet: category / top-state / top-operator breakdown + █ bars ── */
      if (info.pool.length){
        const cnt=(key)=>{ const m={}; info.pool.forEach(s=>{ const k=(s[key]||'—'); m[k]=(m[k]||0)+1; }); 
          return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
        const cat=cnt('category').length>1?cnt('category'):cnt('type');
        const stt=cnt('state').slice(0,15), ops=cnt('operator').slice(0,15);
        const N=info.pool.length;
        const block=(name,pairs)=>{ const mx=Math.max(...pairs.map(p=>p[1]),1);
          return [[name],[ 'Name','Stations','Share %','Bar (visual)'],
            ...pairs.map(p=>[p[0],p[1],Math.round(p[1]/N*1000)/10,this._xlsxBar(p[1],mx)]),[]]; };
        const aoa=[[`Distribution — ${map.label}`],[`${N} stations in scope`],[],
          ...block('BY CHARGER CATEGORY',cat),
          ...block('TOP 15 STATES',stt),
          ...block('TOP 15 OPERATORS',ops)];
        const ws=XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols']=[{wch:30},{wch:10},{wch:9},{wch:28}];
        XLSX.utils.book_append_sheet(wb,ws,'Distribution');
      }

      /* ── Stations sheet: the underlying station-level data for the scope ── */
      if (info.pool.length){
        const CAP=5000, pool=info.pool.slice(0,CAP);
        const head=['Name','Operator','Network','Category','Power kW','Fast','Ultra','Ports','AC pts','DC pts','Status','Access','24×7','State','District','City','Address','Pincode','Phone','Rating','Updated','Lat','Lon'];
        const rows=pool.map(s=>[s.name||'',s.operator||'',s.network||'',s.category||s.type||'',s.powerKW||'',s.fast?'Yes':'',s.ultra?'Yes':'',s.ports||'',s.acCount||'',s.dcCount||'',s.status||'',s.access||'',s.open247?'Yes':'',s.state||'',s.district||'',s.city||'',s.address||'',s.pincode||'',s.phone||'',s.rating||'',s.updated||'',s.lat,s.lon]);
        const note=info.pool.length>CAP?[[`Showing first ${CAP} of ${info.pool.length} in-scope stations`],[]]:[];
        const ws=XLSX.utils.aoa_to_sheet([...note,head,...rows]);
        ws['!cols']=head.map((h,i)=>({wch:i===16?36:(i===0?30:Math.max(9,h.length+2))}));
        XLSX.utils.book_append_sheet(wb,ws,'Stations');
      }

      XLSX.writeFile(wb,fname+'.xlsx');
      if (includeMap && map.img){ const a=document.createElement('a'); a.href=map.img; a.download=fname+'_map.png'; a.click(); }
      U.toast('📊 Enriched Excel report downloaded');
      return;
    }
    if (fmt==='pdf'){ this._printPDF(title, meta, sections); return; }
    await this.buildDocx(title, `${map.label} · ${stamp}`, meta, sections, fname);
    U.toast('Word report downloaded');
  },

  /* ── PDF: print-window renderer with black-boxed figures — always works ── */
  async _printPDF(title, meta, sections){
    const logo=await this._logo();
    let fig=0, tab=0, sN=0, body='';
    for (const s of sections){
      sN++; body+=`<h1>${sN}. ${U.esc(s.h||'')}</h1>`;
      (s.paras||[]).forEach(p=>body+=`<p>${U.esc(p)}</p>`);
      const imgs=s.images||(s.image?[s.image]:[]);
      imgs.forEach(im=>{ fig++;
        body+=`<div class="fig"><img src="${im.data}"></div><div class="cap">Figure ${fig}. ${U.esc(im.cap||'')}</div>`; });
      const tbs=s.tables||(s.table?[s.table]:[]);
      tbs.forEach(tb=>{ tab++;
        body+=`<div class="tcap">Table ${tab}. ${U.esc(tb.cap||'')}</div>
          <table><tr>${tb.head.map(x=>`<th>${U.esc(String(x))}</th>`).join('')}</tr>
          ${tb.rows.map(r=>`<tr>${r.map(x=>`<td>${U.esc(String(x))}</td>`).join('')}</tr>`).join('')}</table>`; });
      if (s.pageBreak) body+='<div class="pb"></div>';
    }
    const html=this._docShell(title, `${meta.scope} · ${new Date().toLocaleString()}`, body, logo, meta);
    /* print through a hidden iframe — immune to popup blockers */
    const frame=document.createElement('iframe');
    frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(frame);
    const fdoc=frame.contentDocument||frame.contentWindow.document;
    fdoc.open(); fdoc.write(html); fdoc.close();
    const doPrint=()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ U.toast('PDF print failed — try again'); }
      setTimeout(()=>frame.remove(), 60000); };
    /* wait for images to load before printing */
    const imgsEls=[...fdoc.images];
    if (!imgsEls.length){ setTimeout(doPrint,300); }
    else {
      let left=imgsEls.length;
      const done=()=>{ if(--left<=0) setTimeout(doPrint,250); };
      imgsEls.forEach(im=>{ if (im.complete) done(); else { im.onload=done; im.onerror=done; } });
      setTimeout(doPrint, 6000);   /* safety net */
    }
    U.toast('PDF print dialog opening — choose "Save as PDF"');
  },

  /* ═════════ REAL .docx BUILDER — tables-first, black-framed figures ═════════ */
  _b64bytes(dataUrl){
    const b64=dataUrl.split(',')[1]||'';
    const bin=atob(b64), u=new Uint8Array(bin.length);
    for(let k=0;k<bin.length;k++) u[k]=bin.charCodeAt(k);
    return u;
  },
  /* sections: [{h, paras:[], bullets:[], image|images:{data,cap,w,h}, table|tables:{head:[],rows:[[]],cap}, pageBreak}] */
  async buildDocx(title, subtitle, meta, sections, fname){
    if (typeof docx==='undefined'){ U.toast('Word engine still loading — try again in a moment'); return; }
    const D=docx;
    const G1='0B3B2E',G2='0D9463',TINT='E4F4EC',TXT='123528',SUB='38695A',LINE='BFE3D4',BLACK='000000';
    const logo=await this._logo();
    const T=(t,o={})=>new D.TextRun({text:t,font:'Calibri',size:o.size||22,color:o.color||TXT,bold:o.bold,italics:o.i});
    const kids=[];
    let figN=0, tabN=0, secN=0;
    if (logo) kids.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{before:200,after:120},
      children:[new D.ImageRun({type:'png',data:this._b64bytes(logo),transformation:{width:88,height:88}})]}));
    kids.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{after:60},
      children:[T('Eas',{size:52,bold:true,color:G1}),T('_EV',{size:52,bold:true,color:G2})]}));
    kids.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{after:200},
      children:[T('INDIA EV INTELLIGENCE PLATFORM',{size:18,color:SUB})]}));
    kids.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{after:60},
      shading:{type:D.ShadingType.CLEAR,fill:G1},children:[T('  '+title+'  ',{size:32,bold:true,color:'FFFFFF'})]}));
    kids.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{after:240},
      children:[T(subtitle,{size:20,color:G2,bold:true})]}));
    const metaRows=[['Report scope',String(meta.scope||'—'),'In scope',String(meta.count??'—')],
                    ['Data source','Eas_EV Stage-1 master database','Boundaries','Survey of India (WGS84)'],
                    ['Generated',new Date().toLocaleString(),'Platform','Eas_EV WebGIS · Stage 5']];
    kids.push(new D.Table({width:{size:100,type:D.WidthType.PERCENTAGE},
      rows:metaRows.map(r=>new D.TableRow({children:r.map((cell,ci)=>new D.TableCell({
        shading:{type:D.ShadingType.CLEAR,fill:ci%2===0?TINT:'FFFFFF'},
        margins:{top:70,bottom:70,left:110,right:110},
        borders:{top:{style:D.BorderStyle.SINGLE,size:2,color:LINE},bottom:{style:D.BorderStyle.SINGLE,size:2,color:LINE},left:{style:D.BorderStyle.SINGLE,size:2,color:LINE},right:{style:D.BorderStyle.SINGLE,size:2,color:LINE}},
        children:[new D.Paragraph({children:[T(cell,{size:18,bold:ci%2===0,color:ci%2===0?SUB:TXT})]})]}))}))}));
    kids.push(new D.Paragraph({children:[new D.PageBreak()]}));

    const blackFrame=(imgPara)=>new D.Table({ width:{size:100,type:D.WidthType.PERCENTAGE},
      rows:[new D.TableRow({children:[new D.TableCell({
        margins:{top:120,bottom:120,left:120,right:120},
        borders:{top:{style:D.BorderStyle.SINGLE,size:16,color:BLACK},bottom:{style:D.BorderStyle.SINGLE,size:16,color:BLACK},
                 left:{style:D.BorderStyle.SINGLE,size:16,color:BLACK},right:{style:D.BorderStyle.SINGLE,size:16,color:BLACK}},
        children:[imgPara]})]})]});

    for (const s of sections){
      if (s.h){ secN++;
        kids.push(new D.Paragraph({spacing:{before:300,after:140},
          border:{bottom:{style:D.BorderStyle.SINGLE,size:14,color:G2}},
          children:[T(`${secN}. ${s.h}`,{size:28,bold:true,color:G1})]})); }
      (s.paras||[]).forEach(p=>kids.push(new D.Paragraph({spacing:{after:140},alignment:D.AlignmentType.JUSTIFIED,children:[T(p)]})));
      (s.bullets||[]).forEach(b=>kids.push(new D.Paragraph({bullet:{level:0},spacing:{after:80},children:[T(b)]})));
      const imgs=s.images||(s.image?[s.image]:[]);
      for (const im of imgs){
        figN++;
        const imgPara=new D.Paragraph({alignment:D.AlignmentType.CENTER,
          children:[new D.ImageRun({type:'png',data:this._b64bytes(im.data),transformation:{width:im.w||560,height:im.h||420}})]});
        kids.push(blackFrame(imgPara));   /* every graph/map sits inside a black boundary box */
        kids.push(new D.Paragraph({alignment:D.AlignmentType.CENTER,spacing:{before:60,after:180},
          children:[T(`Figure ${figN}. ${im.cap||''}`,{size:18,i:true,color:SUB})]}));
      }
      const tbs=s.tables||(s.table?[s.table]:[]);
      for (const tb of tbs){
        tabN++;
        kids.push(new D.Paragraph({spacing:{before:120,after:60},
          children:[T(`Table ${tabN}. ${tb.cap||''}`,{size:19,bold:true,color:G1})]}));
        kids.push(new D.Table({width:{size:100,type:D.WidthType.PERCENTAGE},
          rows:[new D.TableRow({tableHeader:true,children:tb.head.map(hc=>new D.TableCell({
            shading:{type:D.ShadingType.CLEAR,fill:G2},margins:{top:60,bottom:60,left:100,right:100},
            children:[new D.Paragraph({children:[T(String(hc),{size:18,bold:true,color:'FFFFFF'})]})]}))}),
          ...tb.rows.slice(0,200).map((r,ri)=>new D.TableRow({children:r.map(cell=>new D.TableCell({
            shading:{type:D.ShadingType.CLEAR,fill:ri%2?TINT:'FFFFFF'},margins:{top:50,bottom:50,left:100,right:100},
            children:[new D.Paragraph({children:[T(String(cell),{size:18})]})]}))}))]}));
        kids.push(new D.Paragraph({spacing:{after:120},children:[T('',{size:2})]}));
      }
      if (s.pageBreak) kids.push(new D.Paragraph({children:[new D.PageBreak()]}));
    }

    const doc=new D.Document({sections:[{
      properties:{page:{margin:{top:1000,bottom:1000,left:1100,right:1100}}},
      headers:{default:new D.Header({children:[new D.Paragraph({
        border:{bottom:{style:D.BorderStyle.SINGLE,size:8,color:G2}},
        tabStops:[{type:D.TabStopType.RIGHT,position:9600}],
        children:[T('Eas',{size:19,bold:true,color:G1}),T('_EV',{size:19,bold:true,color:G2}),
          new D.TextRun({text:'\t'+(meta.docType||'ANALYTICAL REPORT'),font:'Calibri',size:16,color:SUB})]})]})},
      footers:{default:new D.Footer({children:[new D.Paragraph({alignment:D.AlignmentType.CENTER,
        border:{top:{style:D.BorderStyle.SINGLE,size:8,color:G1}},
        children:[new D.TextRun({text:"Eas_EV · Geospatial-AI Ecosystem for India's EV Charging Infrastructure  ·  Page ",font:'Calibri',size:15,color:SUB}),
          new D.TextRun({children:[D.PageNumber.CURRENT],font:'Calibri',size:15,color:G2,bold:true})]})]})},
      children:kids}]});
    const blob=await D.Packer.toBlob(doc);
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=fname+'.docx'; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
  },

  _logoData:null,
  async _logo(){
    if (this._logoData) return this._logoData;
    try{
      const b=await (await fetch('assets/easev-mark.png')).blob();
      this._logoData=await new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(b); });
    }catch(e){ this._logoData=''; }
    return this._logoData;
  },
  /* branded print shell — big figures inside BLACK boundary boxes */
  _docShell(title, subtitle, bodyHtml, logo, meta={}){
    return `<html><head><meta charset="utf-8"><title>${U.esc(title)}</title>
<style>
@page{ size:A4; margin:14mm }
body{font-family:Calibri,Arial,sans-serif;color:#123528;line-height:1.55;margin:0}
.hdr{background:#E4F7EE;color:#0B3B2E;padding:14px 26px;border-bottom:5px solid #2DD4A7}
.hdr table{border:none;border-collapse:collapse}.hdr td{border:none;padding:0}
.hdr .t{font-size:21px;font-weight:800;letter-spacing:.04em}
.hdr .t .ev{color:#0D9463}
.hdr .s{font-size:11px;color:#3E6B58}
.wrap{padding:20px 30px}
h1{font-size:19px;color:#0E4D3A;border-bottom:3px solid #0D9463;padding-bottom:6px;margin-top:26px}
table{border-collapse:collapse;margin:10px 0;width:100%}
td,th{border:1px solid #BFE3D4;padding:5px 10px;font-size:11.5px}
th{background:#0D9463;color:#fff}
tr:nth-child(even) td{background:#E4F4EC}
.fig{border:3px solid #000;padding:10px;margin:14px 0 4px;text-align:center;background:#fff;page-break-inside:avoid}
.fig img{max-width:100%;width:640px}
.cap{text-align:center;font-style:italic;color:#38695A;font-size:11px;margin-bottom:14px}
.tcap{font-weight:700;color:#0B3B2E;font-size:12.5px;margin:14px 0 2px}
.pb{page-break-after:always}
.ftr{margin-top:26px;background:#E4F4EC;border-top:3px solid #0E4D3A;color:#38695A;font-size:10px;padding:9px 26px}
@media print{ .hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact} th{-webkit-print-color-adjust:exact;print-color-adjust:exact} }
</style></head><body>
<div class="hdr"><table><tr>
<td width="52">${logo?`<img src="${logo}" width="42" height="42" style="border:none;background:#fff;border-radius:50%">`:''}</td>
<td><div class="t">Eas<span class="ev">_EV</span> &nbsp;·&nbsp; India EV Intelligence Platform</div>
<div class="s">${U.esc(subtitle)}</div></td></tr></table></div>
<div class="wrap">${bodyHtml}</div>
<div class="ftr">Eas_EV — Geospatial-AI Ecosystem for India's EV Charging Infrastructure &nbsp;|&nbsp; ${U.esc(meta.docType||'Report')} &nbsp;|&nbsp; Generated ${new Date().toLocaleString()}</div>
</body></html>`;
  },

  _corridorMarkers:[],
};
