/* ═══ Eas_EV — net.js ═══
   Eas_EV.net front-end (Stage-4 explainable ML inside the WebGIS):
   · upload the Stage-3 master ML dataset → server trains RF / GBM / Extra
     Trees / linear baseline with 5-fold CV, compares, keeps the best
   · upload any area (Shapefile ZIP / GeoJSON / CSV grid) → per-cell
     suitability scores, global + per-cell XAI, station recommendation
   · scored cells plotted on the map, full Word/Excel/PPT report        */

const Net = {
  _last: null,
  _markers: [],

  init(){
    const af=document.getElementById('netAnalyzeFile');
    if (!af) return;
    document.getElementById('netAnalyzeDrop').addEventListener('click',()=>af.click());
    af.addEventListener('change',()=>af.files[0]&&this.analyze(af.files[0]));
    this.refreshStatus();
    /* the model trains automatically on the server from backend/data_input/dataset.csv */
    setTimeout(()=>this.refreshStatus(), 15000);
  },

  async refreshStatus(){
    const badge=document.getElementById('netBadge'); if(!badge) return;
    try{
      const r=await fetch('/api/net/status'); const d=await r.json();
      if (d.ready){
        badge.textContent='READY';
        badge.classList.add('ready');
        this.modelReady=true;
      } else { badge.textContent='TRAINING…'; badge.classList.remove('ready'); this.modelReady=false; }
    }catch(e){ badge.textContent='backend off'; }
  },

  async train(file){
    const out=document.getElementById('netTrainOut');
    out.innerHTML='<div class="note">Training &amp; comparing models (5-fold CV) — this can take a minute on large datasets…</div>';
    const fd=new FormData(); fd.append('file',file);
    try{
      const r=await fetch('/api/net/train',{method:'POST',body:fd});
      const d=await r.json();
      if (!r.ok) throw new Error(d.detail||'Training failed');
      out.innerHTML=`
        <div class="score-card">
          <div class="note" style="margin:0 0 6px"><b>Best model: ${U.esc(d.best)}</b> — ${d.metric} <b>${d.score}</b> (5-fold CV) · ${d.rows} rows · ${d.n_features} features</div>
          <table class="cmp-table"><tr><th>Model</th><th>${U.esc(d.metric)}</th></tr>
          ${d.comparison.sort((a,b)=>b[d.metric]-a[d.metric]).map(c=>`<tr${c.model===d.best?' style="color:var(--accent);font-weight:700"':''}><td>${U.esc(c.model)}</td><td>${c[d.metric]}</td></tr>`).join('')}</table>
        </div>
        <div class="chart-box"><h5>Global feature importance (XAI)</h5><canvas id="netImpChart"></canvas></div>
        ${Intel.repRow('netTrainOut','EasEVnet Model Training')}`;
      Intel.cjs('netImpChart',{type:'bar',data:{labels:d.importances.map(i=>i.feature),
        datasets:[{data:d.importances.map(i=>i.weight),backgroundColor:'#2dd4a7',borderRadius:4}]},
        options:{indexAxis:'y',plugins:{legend:{display:false}}}});
      this.refreshStatus();
      U.toast(`Eas_EV.net trained — ${d.best} selected (${d.metric} ${d.score})`);
    }catch(e){ out.innerHTML=`<div class="note" style="color:var(--red)">${U.esc(e.message)}</div>`; }
  },

  async analyze(file){
    const out=document.getElementById('netOut');
    out.innerHTML='<div class="note">Reading features → aligning to model → scoring every cell → building explanations…</div>';
    const fd=new FormData(); fd.append('file',file);
    try{
      const r=await fetch('/api/net/analyze',{method:'POST',body:fd});
      const d=await r.json();
      if (!r.ok) throw new Error(d.detail||'Analysis failed');
      this._last=d;
      this.plot(d);

      if (d.mode==='profile'){
        out.innerHTML=`<div class="note" style="color:var(--orange)">${U.esc(d.message)}</div>
          <div class="note">${d.n_features_uploaded} features read · numeric attributes: ${d.numeric_attributes.map(U.esc).join(', ')||'none'}</div>`;
        return;
      }
      const s=d.summary, rec=d.recommendation;
      out.innerHTML=`
        <div class="dash-kpis">
          <div class="kpi"><span class="kpi-v">${d.cells_analyzed!=null?d.cells_analyzed:d.n_features_uploaded}</span><span class="kpi-l">Cells analysed</span></div>
          <div class="kpi"><span class="kpi-v">${(s.mean*100).toFixed(0)}%</span><span class="kpi-l">Mean suitability</span></div>
          <div class="kpi"><span class="kpi-v">${s.high}</span><span class="kpi-l">High cells ≥0.70</span></div>
          <div class="kpi"><span class="kpi-v">${rec.stations_needed}</span><span class="kpi-l">Stations needed</span></div>
        </div>
        <div class="score-card"><div class="note" style="margin:0">
          <b>Model:</b> Eas_EV.net · ${d.model.metric} ${d.model.score} (trained on ${d.model.trained_rows} cells)<br>
          <b>Feature match:</b> ${d.feature_overlap.matched}/${d.feature_overlap.of} model features present (${d.feature_overlap.missing_filled_with_medians} median-imputed)<br>
          <b>Recommendation:</b> ${rec.stations_needed} stations — ${Object.entries(rec.mix).map(([k,v])=>`${v} × ${k}`).join(' + ')}<br>
          <span class="hint">${U.esc(rec.logic)}</span>
        </div></div>
        <div class="chart-box"><h5>Suitability distribution</h5><canvas id="netDistChart"></canvas></div>
        <div class="chart-box"><h5>Why — global drivers (XAI)</h5><canvas id="netXaiChart"></canvas></div>
        <div class="score-card"><div class="note" style="margin:0"><b>Explanation:</b> ${U.esc(d.explanation.replace(/Eas_EV\.net \([^)]+\)/,'Eas_EV.net'))}</div></div>
        <h3 class="grp">Per-cell explanations (top drivers)</h3>
        <div class="net-cells">${(d.row_explanations||[]).slice(0,8).map((ex,i)=>
          `<div class="net-cell"><b>Cell ${i+1}</b> · score ${d.scores[i]} — ${ex.map(e=>`${U.esc(e.feature)} (${e.impact>0?'+':''}${e.impact})`).join(', ')}</div>`).join('')}</div>
        ${Intel.repRow('netOut','EasEVnet Area Analysis · '+(d.area_name||'Uploaded area'))}`;

      const bins=[0,0,0,0,0];
      d.scores.forEach(v=>bins[Math.min(4,Math.floor(v*5))]++);
      Intel.cjs('netDistChart',{type:'bar',data:{labels:['0–0.2','0.2–0.4','0.4–0.6','0.6–0.8','0.8–1.0'],
        datasets:[{data:bins,backgroundColor:['#f0556a','#f5a623','#facc15','#4f8ef7','#2dd4a7'],borderRadius:5}]},
        options:{plugins:{legend:{display:false}}}});
      Intel.cjs('netXaiChart',{type:'bar',data:{labels:d.global_importances.map(i=>i.feature),
        datasets:[{data:d.global_importances.map(i=>i.weight),backgroundColor:'#b78bfa',borderRadius:4}]},
        options:{indexAxis:'y',plugins:{legend:{display:false}}}});
      U.toast(`Eas_EV.net: ${d.cells_analyzed!=null?d.cells_analyzed:d.n_features_uploaded} cells scored — ${rec.stations_needed} stations recommended`);
    }catch(e){
      out.innerHTML=`<div class="note" style="color:var(--red)">${U.esc(e.message==='Failed to fetch'?'Backend not running — start uvicorn (GUIDE §1)':e.message)}</div>`;
    }
  },

  /* plot scored cells on the map, coloured by suitability */
  plot(d){
    this._markers.forEach(m=>MapMod.map.removeLayer(m)); this._markers=[];
    const pts=d.points||[]; if(!pts.length) return;
    MapMod.exclusive && MapMod.exclusive('trip');   // clear other layers; hide clusters
    // scope the map + every report to THIS uploaded area (not "All India")
    if (d.polygon){
      MapMod.clearBoundary && MapMod.clearBoundary();
      try{ MapMod.boundaryLayer = L.geoJSON(d.polygon,{ style:{color:'#2dd4a7',weight:2,fillColor:'#2dd4a7',fillOpacity:.05,dashArray:'6 4'}, interactive:false }).addTo(MapMod.map); }catch(e){}
      MapMod.ctx = { mode:'boundary', center:null, radiusKm:null, bbox:null, polygon:d.polygon, label:(d.area_name||'Uploaded area'), level:'area' };
    }
    const col=v=>v>=0.7?'#2dd4a7':v>=0.4?'#f5a623':'#f0556a';
    pts.forEach((p,i)=>{
      const sc=d.scores?d.scores[i]:null;
      const m=L.circleMarker([p[0],p[1]],{radius:6,color:'#0a0f1e',weight:1,
        fillColor:sc!=null?col(sc):'#4f8ef7',fillOpacity:.9}).addTo(MapMod.map);
      if (sc!=null){
        const ex=(d.row_explanations||[])[i];
        m.bindPopup(`<b>Suitability: ${sc}</b>${ex?`<br>Drivers: ${ex.map(e=>`${U.esc(e.feature)} (${e.impact>0?'+':''}${e.impact})`).join(', ')}`:''}`);
      }
      this._markers.push(m);
    });
    const g=L.featureGroup(this._markers);
    MapMod.map.fitBounds(g.getBounds().pad(0.2));
  },
};