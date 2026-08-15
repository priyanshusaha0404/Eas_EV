/* ═══ Eas_EV — agent.js ═══
   Google Gemini agent (FREE tier) · any language · voice in/out · photo place ID · map tools */

const Agent = {
  history:[], open:false, voiceUsed:false, pendingImage:null,

  TOOLS:[
    { name:'find_ev_stations', description:'Find EV charging stations near the user or a named place; highlights on map; returns nearest with distances.',
      input_schema:{type:'object',properties:{charger_type:{type:'string',enum:['AC','DC','all']},location:{type:'string',description:"place or 'current'"},limit:{type:'number'}},required:[]} },
    { name:'route_to', description:'Draw a driving route to a destination. Optionally specify a starting place (from_place); if omitted, routes from the user\'s current location. Both can be place names anywhere in India.',
      input_schema:{type:'object',properties:{dest_lat:{type:'number'},dest_lon:{type:'number'},dest_name:{type:'string'},place:{type:'string',description:'destination place name'},from_place:{type:'string',description:'optional starting place name'}},required:[]} },
    { name:'search_amenities', description:'Search nearby amenities and show on map. Any category like hospital, pharmacy, restaurant, cafe, hotel, parking, fuel, atm, bank, police, railway, mall, park, washroom, service centre.',
      input_schema:{type:'object',properties:{category:{type:'string'},radius_km:{type:'number'}},required:['category']} },
    { name:'go_to_place', description:'Search any place in India (country/state/district/sub-district/city/village/landmark) and move the map. Big admin areas load boundary; small places load radius. Reloads stations.',
      input_schema:{type:'object',properties:{place:{type:'string'}},required:['place']} },
    { name:'plan_trip', description:'Plan a multi-stop EV trip with weather-aware battery model and charging stops; draws on map.',
      input_schema:{type:'object',properties:{stops:{type:'array',items:{type:'string'}},battery_percent:{type:'number'},range_km:{type:'number'}},required:['stops']} },
    { name:'evaluate_site', description:'Run AI suitability evaluation (XAI) for a coordinate — score, charger advice, explanation.',
      input_schema:{type:'object',properties:{lat:{type:'number'},lon:{type:'number'}},required:['lat','lon']} },
    { name:'area_insights', description:'Generate an AI summary of the currently visible map area (demand, gap, recommended chargers).',
      input_schema:{type:'object',properties:{},required:[]} },
    { name:'drop_pin_scan', description:'Drop a pin and scan stations + amenities within a radius.',
      input_schema:{type:'object',properties:{lat:{type:'number'},lon:{type:'number'},radius_km:{type:'number'}},required:['lat','lon']} },
    { name:'clear_map', description:'Clear route and/or amenity layers.',
      input_schema:{type:'object',properties:{what:{type:'string',enum:['route','amenities','all']}},required:['what']} },
    { name:'set_station_filter', description:'Filter which charger types are visible on the map. Types: AC, DC, AC_DC (both), SWAP (battery swap). Speed: fast (>=50kW), ultra (>=150kW). Use only=[...] to show just those types, or all=true to reset.',
      input_schema:{type:'object',properties:{only:{type:'array',items:{type:'string',enum:['AC','DC','AC_DC','SWAP']}},fast:{type:'boolean'},ultra:{type:'boolean'},all:{type:'boolean'}},required:[]} },
  ],

  init(){
    document.getElementById('chatFab').onclick=()=>this.toggle();
    this.autoGreet();
    document.getElementById('sendBtn').onclick=()=>this.send();
    document.getElementById('chatInput').addEventListener('keydown',e=>{ if(e.key==='Enter') this.send(); });
    document.querySelectorAll('#chatSuggest .sg').forEach(s=>s.onclick=()=>{ document.getElementById('chatInput').value=s.dataset.q; this.send(); });

    const mic=document.getElementById('chatMic');
    this.rec=U.makeSpeech(t=>{document.getElementById('chatInput').value=t;this.voiceUsed=true;this.send();},()=>mic.classList.remove('listening'));
    mic.onclick=()=>{ if(!this.rec){U.toast('Voice not supported here');return;} mic.classList.add('listening'); try{this.rec.start();}catch(e){} };

    const smic=document.getElementById('searchMic');
    this.srec=U.makeSpeech(t=>{document.getElementById('searchInput').value=t;App.runSearch();},()=>smic.classList.remove('listening'));
    smic.onclick=()=>{ if(!this.srec){U.toast('Voice not supported here');return;} smic.classList.add('listening'); try{this.srec.start();}catch(e){} };

    document.getElementById('photoBtn').onclick=()=>document.getElementById('photoInput').click();
    document.getElementById('photoInput').addEventListener('change',async e=>{
      const f=e.target.files[0]; if(!f) return;
      this.pendingImage=await U.resizeImage(f);
      this.addMsg('user','📷 Photo attached');
      const img=document.createElement('img'); img.src='data:image/jpeg;base64,'+this.pendingImage;
      document.querySelector('#chatBody .msg.user:last-child').appendChild(img);
      this.send('Identify the place in this photo. If recognizable, name it and call go_to_place to move the map there.');
      e.target.value='';
    });
  },

  toggle(){ this.open=!this.open; document.getElementById('chatWin').classList.toggle('open',this.open); document.getElementById('chatFab').classList.toggle('hidden',this.open); this.dismissGreet(); },
  dismissGreet(){ const g=document.getElementById('aiGreet'); if(g) g.classList.remove('show'); },

  /* the robot ITSELF comes out, waves its arm and says hi — every load */
  _showGreet(text, ms=9000){
    if (this.open) return;
    const g=document.getElementById('aiGreet'); if(!g) return;
    document.getElementById('aiGreetText').innerHTML=text;
    g.classList.add('show');
    const fab=document.getElementById('chatFab');
    fab.classList.remove('rise'); void fab.offsetWidth; fab.classList.add('rise');
    clearTimeout(this._greetT);
    this._greetT=setTimeout(()=>{ this.dismissGreet(); fab.classList.remove('rise'); }, ms);
  },
  autoGreet(){
    /* entrance: robot bounces in from below, arm waves, then speaks */
    const fab=document.getElementById('chatFab');
    fab.style.visibility='hidden';
    setTimeout(()=>{
      fab.style.visibility='visible';
      fab.classList.add('enter');
      setTimeout(()=>this._showGreet('Hi! I am <b>Boney</b>, your AI assistant. Ask me anything.'), 700);
      setTimeout(()=>fab.classList.remove('enter'), 2600);
    }, 900);
    /* periodic friendly check-in while the chat stays closed */
    const nudges=['Do you need any help? Tap me and ask.',
      'I can find chargers, plan trips or analyse an area for you.',
      'Stuck anywhere? I am right here.'];
    let i=0;
    this._nudgeT=setInterval(()=>{ if(!this.open && !document.hidden) this._showGreet(nudges[i++%nudges.length], 7000); }, 150000);
  },

  /* 2-hourly driving suggestion — Yes pauses the trip and starts the scan */
  askBreak(hrs){
    if (this.open) return;
    const el=document.getElementById('aiGreet'); if(!el) return;
    document.getElementById('aiGreetText').innerHTML =
      `You've been driving for about <b>${hrs} h</b>. Would you like to take a short rest? I can find rest spots nearby. `+
      `<button class="ag-yn" onclick="Agent.dismissGreet();Trip.pauseTrip()">Yes</button>`+
      `<button class="ag-yn no" onclick="Agent.dismissGreet()">No</button>`;
    el.classList.add('show');
    const fab=document.getElementById('chatFab');
    fab.classList.remove('rise'); void fab.offsetWidth; fab.classList.add('rise');
    clearTimeout(this._greetT);
    this._greetT=setTimeout(()=>{ this.dismissGreet(); fab.classList.remove('rise'); }, 20000);
    U.speak&&U.speak('You have been driving for a while. Would you like to take a short rest?');
  },

  /* state-change welcome — Boney greets when the car enters a new state */
  stateWelcome(name){
    if (this.open) return;
    const el=document.getElementById('aiGreet'); if(!el) return;
    document.getElementById('aiGreetText').innerHTML = `Welcome to <b>${name}</b>! 🎉 You've just entered a new state.`;
    el.classList.add('show');
    const fab=document.getElementById('chatFab');
    fab.classList.remove('rise'); void fab.offsetWidth; fab.classList.add('rise');
    clearTimeout(this._greetT);
    this._greetT=setTimeout(()=>{ this.dismissGreet(); fab.classList.remove('rise'); }, 8000);
    U.speak&&U.speak('Welcome to '+name);
  },

  /* auto-stop low-battery notice */
  lowBattery(pct){
    if (this.open) return;
    const el=document.getElementById('aiGreet'); if(!el) return;
    document.getElementById('aiGreetText').innerHTML = `Battery is at <b>${pct}%</b> — I've stopped the car and found chargers within 5 km. Tap a charger to head there.`;
    el.classList.add('show');
    const fab=document.getElementById('chatFab');
    fab.classList.remove('rise'); void fab.offsetWidth; fab.classList.add('rise');
    clearTimeout(this._greetT);
    this._greetT=setTimeout(()=>{ this.dismissGreet(); fab.classList.remove('rise'); }, 10000);
  },

  /* context-aware helper nudges — fired by the app while the user works */
  _lastNudge:0,
  nudge(kind, label){
    const now=Date.now();
    if (this.open || now-this._lastNudge<45000) return;   // never spam
    this._lastNudge=now;
    const texts={
      search:`Want a full <b>area analysis</b> of ${U.esc(label||'this place')}? Ask me — or open Intel → Dashboard.`,
      trip:`Trip planned. I can also check <b>weather</b>, find <b>cafés at your charge stops</b>, or export the plan — just ask.`,
      data:`Tip: you can export exactly what's on the map as CSV, GeoJSON, KML or Shapefile from the Data tab.`,
      intel:`Tip: every Intel tab has <b>Word / Excel / PPT report</b> buttons at the bottom.`,
    };
    if (texts[kind]) setTimeout(()=>this._showGreet(texts[kind], 9000), 1500);
  },
  addMsg(role,text){ const d=document.createElement('div'); d.className='msg '+role; d.textContent=text; document.getElementById('chatBody').appendChild(d); d.scrollIntoView({behavior:'smooth'}); return d; },

  /* background data-refresh found brand-new stations → surface them as a
     chatbot suggestion line, e.g.
     "⚡ New charging station installed at Hyderabad, Telangana — Statiq Hub (DC)" */
  notifyNewStations(list, total){
    try{
      const lines=(list||[]).slice(0,6).map(s=>{
        const place=[s.city||s.district, s.state].filter(Boolean).join(', ');
        return `⚡ New charging station installed at ${place||'India'} — ${s.name||'Charging station'}${s.category?` (${s.category})`:''}`;
      });
      if (!lines.length) return;
      if (total>lines.length) lines.push(`…and ${total-lines.length} more new stations added across India.`);
      this.addMsg('ai', lines.join('\n'));
      /* subtle nudge on the chat bubble if the panel is closed */
      const bub=document.getElementById('chatBubble')||document.querySelector('.chat-bubble');
      if (bub){ bub.classList.add('has-news'); setTimeout(()=>bub.classList.remove('has-news'), 60000); }
    }catch(e){}
  },
  typing(s){ document.getElementById('typing')?.remove(); if(s){ const d=document.createElement('div'); d.className='typing'; d.id='typing'; d.innerHTML='<span></span><span></span><span></span>'; document.getElementById('chatBody').appendChild(d); d.scrollIntoView(); } },

  /* convert our Anthropic-style TOOLS to Gemini functionDeclarations */
  geminiTools(){
    return [{ functionDeclarations: this.TOOLS.map(t=>{
      const props = JSON.parse(JSON.stringify(t.input_schema.properties||{}));
      /* Gemini wants uppercase JSON-schema types and no empty objects */
      const fix = o => { for (const k in o){ const p=o[k];
        if (p.type) p.type = p.type.toUpperCase();
        if (p.items && p.items.type) p.items.type = p.items.type.toUpperCase();
      } return o; };
      const decl = { name:t.name, description:t.description };
      if (Object.keys(props).length){
        decl.parameters = { type:'OBJECT', properties:fix(props) };
        if (t.input_schema.required && t.input_schema.required.length) decl.parameters.required = t.input_schema.required;
      }
      return decl;
    })}];
  },

  async send(forced){
    const inp=document.getElementById('chatInput'); const text=forced||inp.value.trim();
    if (!text&&!this.pendingImage) return;
    if (!forced) this.addMsg('user',text);
    inp.value=''; document.getElementById('sendBtn').disabled=true;

    /* two modes:
       (a) BACKEND mode (deployed): call /api/gemini — keys live on the server, hidden from browser
       (b) DIRECT mode (local dev): use keys from config.js, rotate in the browser */
    const backendMode = !!CONFIG.USE_BACKEND_AGENT;
    const keyPool = backendMode ? ['__backend__']
      : [CONFIG.GEMINI_API_KEY, ...(CONFIG.GEMINI_API_KEYS||[])].map(k=>(k||'').trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
    if (!keyPool.length){
      this.addMsg('ai','⚠ No Gemini API key set.\n\n💡 Get a FREE key at https://aistudio.google.com/apikey (no credit card), then paste it into js/config.js as GEMINI_API_KEY.');
      document.getElementById('sendBtn').disabled=false; return;
    }
    if (this._keyIdx==null) this._keyIdx=0;
    if (this._keyIdx>=keyPool.length) this._keyIdx=0;

    /* build the user turn (text and/or image) as Gemini parts */
    const parts=[];
    if (this.pendingImage){ parts.push({ inlineData:{ mimeType:'image/jpeg', data:this.pendingImage } }); this.pendingImage=null; }
    parts.push({ text: text || 'Identify this.' });
    this.history.push({ role:'user', parts });
    this.typing(true);

    const makeUrl=()=> backendMode
      ? '/api/gemini'
      : `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${keyPool[this._keyIdx]}`;
    let url=makeUrl();
    const body={
      systemInstruction:{ parts:[{ text:this.systemPrompt() }] },
      tools:this.geminiTools(),
      contents:this.history,
      generationConfig:{ maxOutputTokens:1100, temperature:0.6 },
    };

    try {
      for (let loop=0; loop<7; loop++){
        let res, data, rateLimited=false;
        /* allow trying every key once (instant rotation), plus one timed retry if all are limited */
        const maxAttempts = keyPool.length + 1;
        let triedKeys = 0;
        for (let attempt=0; attempt<maxAttempts; attempt++){
          res=await fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
          data=await res.json();
          if ((res.status===429||res.status===503)){
            triedKeys++;
            /* still have an untried key? rotate instantly, no waiting */
            if (triedKeys < keyPool.length){
              this._keyIdx=(this._keyIdx+1)%keyPool.length;
              url=makeUrl();
              this.typing(false);
              const n=this.addMsg('tool',`🔄 Key ${this._keyIdx+1}/${keyPool.length} — switching…`);
              await new Promise(r=>setTimeout(r,300)); n.remove(); this.typing(true);
              continue;
            }
            /* all keys limited → one timed retry on the next key */
            if (attempt < maxAttempts-1){
              let wait=0;
              const det=data.error?.details||[];
              const ri=det.find(d=>d['@type']&&d['@type'].includes('RetryInfo'));
              if (ri && ri.retryDelay) wait=Math.ceil(parseFloat(ri.retryDelay));
              if (!wait){ const m=/retry in ([\d.]+)s/i.exec(data.error?.message||''); if(m) wait=Math.ceil(parseFloat(m[1])); }
              wait=Math.min(Math.max(wait||10,3),30);
              this._keyIdx=(this._keyIdx+1)%keyPool.length; url=makeUrl();
              this.typing(false);
              const note=this.addMsg('tool',`⏳ All keys busy — retrying in ${wait}s…`);
              for (let s=wait; s>0; s--){ note.textContent=`⏳ All keys busy — retrying in ${s}s…`; await new Promise(r=>setTimeout(r,1000)); }
              note.remove(); this.typing(true);
              continue;
            }
            rateLimited=true;
          }
          break;
        }
        if (rateLimited){
          this.typing(false);
          const tip = keyPool.length>1
            ? `🚦 All ${keyPool.length} keys are rate-limited right now. Wait about a minute, then try again.`
            : '🚦 Gemini free tier is rate-limited (max ~20 requests/min). Wait about a minute, then try again.\n\n💡 Tip: add 2-3 keys from different Google accounts to GEMINI_API_KEYS in config.js to triple your limit.';
          this.addMsg('ai',tip);
          break;
        }
        if (data.error) throw new Error(data.error.message||'Gemini API error');
        const cand=(data.candidates||[])[0];
        if (!cand) throw new Error('Empty response from Gemini');
        const partsOut=cand.content?.parts||[];
        const calls=partsOut.filter(p=>p.functionCall);

        if (calls.length){
          /* record the model's function-call turn */
          body.contents.push({ role:'model', parts:partsOut });
          this.history=body.contents;
          /* run each tool and feed results back */
          const respParts=[];
          for (const c of calls){
            const fc=c.functionCall;
            this.addMsg('tool',`⚙ ${fc.name}`);
            let out; try{ out=await this.exec(fc.name, fc.args||{}); }catch(err){ out={error:err.message}; }
            respParts.push({ functionResponse:{ name:fc.name, response:{ result: out } } });
          }
          body.contents.push({ role:'user', parts:respParts });
          this.history=body.contents;
          continue;
        }

        const finalText=partsOut.filter(p=>p.text).map(p=>p.text).join('\n').trim();
        this.typing(false); this.addMsg('ai',finalText||'(no response)');
        body.contents.push({ role:'model', parts:[{ text:finalText }] });
        this.history=body.contents;
        if (this.history.length>16) this.history=this.history.slice(-16);
        if (this.voiceUsed){ U.speak(U.cleanForSpeech?U.cleanForSpeech(finalText):finalText); this.voiceUsed=false; }
        break;
      }
    } catch(e){
      this.typing(false);
      let hint=/api key|api_key|invalid|permission|401|403/i.test(e.message)?'\n\n💡 Check your GEMINI_API_KEY in js/config.js — get a free one at https://aistudio.google.com/apikey':'';
      this.addMsg('ai','⚠ '+e.message+hint);
    }
    document.getElementById('sendBtn').disabled=false;
  },

  systemPrompt(){
    const c=MapMod.ctx;
    return `You are Eas_EV Assistant inside Eas_EV — an AI-GIS EV platform for India (Google-Maps-like UX).
Map context: ${c.label} (${c.mode} mode). User: lat ${MapMod.userPos.lat.toFixed(4)}, lon ${MapMod.userPos.lon.toFixed(4)}. Stations loaded: ${MapMod.allStations.length}.
You control the live map via tools — results appear instantly on the user's map. ALWAYS use tools for location tasks; never invent station data. After tool results give a short, friendly summary (names, distances, scores).
When the user says a route "from X to Y", pass from_place:X and place:Y to route_to. For "to Y" only, omit from_place (routes from current location).
Reply in the SAME language the user writes in (English, Hindi, Bengali, or any other) — mirror their language naturally. For photos, identify the place then call go_to_place.`;
  },

  async exec(name,input){
    switch(name){
      case 'find_ev_stations':{
        let center=MapMod.userPos;
        if (input.location&&input.location!=='current'){ const g=await this.geo(input.location); if(g) center=g; }
        if (!MapMod.datasetLoaded) await MapMod.loadDataset();
        let list=(MapMod.masterStations&&MapMod.masterStations.length)?MapMod.masterStations.slice():[...MapMod.stationStore.values()];
        if (input.charger_type&&input.charger_type!=='all') list=list.filter(s=>s.type===input.charger_type);
        const top=list.map(s=>({...s,distKm:+U.haversine(center.lat,center.lon,s.lat,s.lon).toFixed(2)})).sort((a,b)=>a.distKm-b.distKm).slice(0,input.limit||5);
        top.forEach(s=>{ const it=MapMod.stationToPOI(s); L.circleMarker([s.lat,s.lon],{radius:12,color:'#fff',weight:2.5,fillColor:CONFIG.TYPE_COLORS[s.type],fillOpacity:1}).addTo(MapMod.map).bindPopup(POI.popupHTML(it)).on('popupopen',()=>POI.bindPopup(it)); });
        if (top.length) MapMod.map.setView([top[0].lat,top[0].lon],14);
        return top.map(s=>({name:s.name,type:s.type,powerKW:s.powerKW,distKm:s.distKm,lat:s.lat,lon:s.lon}));
      }
      case 'route_to':{
        let lat=input.dest_lat,lon=input.dest_lon,nm=input.dest_name||input.place||'Destination';
        if ((!lat||!lon)&&input.place){ const g=await this.geo(input.place); if(!g) return {error:'destination not found: '+input.place}; lat=g.lat; lon=g.lon; }
        if (!lat||!lon) return {error:'no destination'};
        /* optional explicit start point */
        let from=null;
        if (input.from_place){ const gf=await this.geo(input.from_place); if(gf){ from={lat:gf.lat,lon:gf.lon}; MapMod.userPos=from; MapMod.setUserMarker&&MapMod.setUserMarker(gf.lat,gf.lon); } }
        const r=await Trip.quickRoute(lat,lon,nm);
        return r?{ok:true,from:input.from_place||'current location',to:nm,distanceKm:r.km,timeMin:r.min}:{error:'routing failed — OSRM unreachable'};
      }
      case 'search_amenities':{
        const key=this.matchAmenity(input.category); if(!key) return {error:'unknown category: '+input.category};
        const cb=document.querySelector(`[data-amcat="${key}"]`); if(cb) cb.checked=true;
        const r=await Amen.load(key); DL.refreshList(); return r;
      }
      case 'go_to_place':{
        const results=await MapMod.suggest(input.place); if(!results.length) return {error:'not found: '+input.place};
        await MapMod.applyResult(results[0]);
        return { ok:true, moved_to:MapMod.ctx.label, mode:MapMod.ctx.mode, stations:MapMod.allStations.length };
      }
      case 'plan_trip':{
        if (!input.stops||input.stops.length<2) return {error:'need ≥2 stops'};
        Trip.waypoints=input.stops.map((s,i)=>({id:i+1,value:s})); Trip._id=input.stops.length+1; Trip.render();
        if (input.battery_percent) document.getElementById('tripBattery').value=input.battery_percent;
        if (input.range_km) document.getElementById('tripRange').value=input.range_km;
        App.openDrawer('trip');
        return await Trip.plan();
      }
      case 'evaluate_site':{
        App.openDrawer('intel');
        document.querySelector('[data-itab="dash"]')?.click();
        await Intel.evaluateSite(input.lat,input.lon);
        return { ok:true, see:'Strategic Intelligence → Dashboard for the full breakdown' };
      }
      case 'area_insights':{
        App.openDrawer('intel'); await Intel.areaInsights();
        return { ok:true, see:'insight panel' };
      }
      case 'drop_pin_scan':{
        MapMod.dropPin(input.lat,input.lon);
        if (input.radius_km){ document.getElementById('apRadius').value=Math.min(25,input.radius_km); document.getElementById('apRadVal').textContent=input.radius_km+' km'; MapMod.updatePinRadius(input.radius_km); }
        await MapMod.scanArea();
        return { ok:true, results:document.getElementById('apResults').textContent };
      }
      case 'set_station_filter':{
        if (args.all){
          document.querySelectorAll('#dp-stations [data-type]').forEach(cb=>cb.checked=true);
          document.querySelectorAll('#dp-stations [data-speed]').forEach(cb=>cb.checked=false);
        } else {
          if (args.only && args.only.length)
            document.querySelectorAll('#dp-stations [data-type]').forEach(cb=>cb.checked=args.only.includes(cb.dataset.type));
          document.querySelectorAll('#dp-stations [data-speed]').forEach(cb=>{
            if (cb.dataset.speed==='fast' && args.fast!==undefined) cb.checked=!!args.fast;
            if (cb.dataset.speed==='ultra' && args.ultra!==undefined) cb.checked=!!args.ultra;
          });
        }
        MapMod.renderStations();
        const counts={}; document.querySelectorAll('#dp-stations [data-type]').forEach(cb=>{ if(cb.checked) counts[cb.dataset.type]=document.getElementById('cnt-'+cb.dataset.type)?.textContent; });
        return { applied:true, visible_types:counts, note:'Map filter applied' };
      }
      case 'clear_map':{
        if (input.what==='route'||input.what==='all') Trip.clearRoute();
        if (input.what==='amenities'||input.what==='all') Amen.clearAll();
        return { ok:true };
      }
    }
    return { error:'unknown tool' };
  },

  matchAmenity(cat){
    cat=(cat||'').toLowerCase().replace(/\s+/g,'_');
    for (const cats of Object.values(Amen.CATALOG)) for (const k of Object.keys(cats)) if (k===cat||cats[k].label.toLowerCase().replace(/\s+/g,'_')===cat) return k;
    const alias={hospitals:'hospital',restaurants:'restaurant',hotels:'hotel',cafes:'cafe',petrol:'fuel',gas:'fuel',train:'railway',station:'railway',medical:'hospital',chemist:'pharmacy',medicine:'pharmacy',shopping:'mall',metro:'railway',washroom:'toilets',toilet:'toilets',service:'car_repair',service_centre:'car_repair'};
    return alias[cat]||(Amen.findCat(cat)?cat:null);
  },
  async geo(q){ try{ const r=await fetch(`${CONFIG.NOMINATIM}/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=in`); const d=await r.json(); return d.length?{lat:+d[0].lat,lon:+d[0].lon}:null; }catch(e){return null;} },
};
