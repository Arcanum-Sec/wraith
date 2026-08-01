// Local / Localhost Scan module --------------------------------------------
// MODERN rebuild. The old BeEF-era LAN ping-sweep is dead: Chrome 142+ Local
// Network Access (LNA, Oct 2025) gates requests to private ranges (10/172.16/
// 192.168) behind a permission prompt, so a blind 192.168.x sweep never reaches
// the wire. See https://developer.chrome.com/blog/local-network-access
//
// What STILL works reliably, and is the real-world attack (eBay/Best Buy/Macy's
// were caught doing it), is LOOPBACK scanning: a page can fetch 127.0.0.1:<port>
// in no-cors mode and tell open from closed by timing. We make it reliable with
// CALIBRATION -- probe a known-closed port first to learn this machine's RST
// baseline, then anything meaningfully slower (or that resolves, or that hangs)
// is open. Ref: PortSwigger "reliable browser-based port scanning",
// Mozilla bug 1827173, eBay check.js (WebSocket timing).
//
// Modes:
//   localhost  -> calibrated 127.0.0.1 service scan        (RELIABLE, default)
//   host       -> scan one IP/host (works only if LNA lets it through)
//   discover   -> sweep a subnet                            (mostly LNA-blocked)
module.exports = {
  id: 'portscan',
  label: 'Local / Localhost Scan',
  blurb: 'Calibrated 127.0.0.1 service scan (+ LAN modes)',
  kind: 'task',

  run: `
  // Real local services worth fingerprinting on a dev/work box.
  var SERVICES = {
    22:'SSH', 80:'HTTP', 443:'HTTPS', 445:'SMB', 3389:'RDP', 5900:'VNC',
    5938:'TeamViewer', 6568:'AnyDesk', 5931:'Ammyy', 6333:'remote', 7070:'remote',
    3000:'Node/React dev', 3001:'dev server', 4200:'Angular dev', 5173:'Vite',
    5174:'Vite', 4000:'dev server', 8000:'HTTP-alt/Django', 8080:'HTTP-proxy',
    8081:'HTTP-alt', 8443:'HTTPS-alt', 8888:'Jupyter', 6006:'Storybook',
    9229:'Node debugger', 1313:'Hugo', 5000:'Flask/AirPlay', 9000:'PHP-FPM/SonarQube',
    5432:'PostgreSQL', 3306:'MySQL', 6379:'Redis', 27017:'MongoDB', 11211:'Memcached',
    9200:'Elasticsearch', 5601:'Kibana', 8086:'InfluxDB', 15672:'RabbitMQ',
    7474:'Neo4j', 9090:'Prometheus', 3030:'dev', 631:'CUPS',
    2375:'Docker API', 2376:'Docker TLS', 4040:'ngrok', 8200:'Vault',
    11434:'Ollama', 1234:'LM Studio', 7860:'Gradio', 8188:'ComfyUI', 5279:'remote'
  };

  var DEFAULT_LOCAL = [3000,3001,4200,5173,8000,8080,8443,8888,9229,5000,9000,
    5432,3306,6379,27017,9200,5601,2375,11434,1234,7860,3389,5900,5938,6568,631,9090,8200];

  var P = Object.assign({
    mode: 'localhost',
    target: '127.0.0.1',
    ports: null,           // null -> use DEFAULT_LOCAL for localhost mode
    timeout: 2200,
    concurrency: 12
  }, params || {});
  if (!P.ports || !P.ports.length) P.ports = DEFAULT_LOCAL.slice();

  // Ports browsers refuse to connect to (ERR_UNSAFE_PORT) -> not testable.
  var BLOCKED = {};
  [1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,
   109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,
   515,526,530,531,532,540,548,554,556,563,587,601,636,993,995,2049,3659,4045,5060,
   5061,6000,6566,6697,10080].forEach(function(p){ BLOCKED[p] = true; });

  function now(){ return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function svc(port){ return SERVICES[port] || ''; }
  function median(a){ a = a.slice().sort(function(x,y){return x-y;}); return a.length ? a[Math.floor(a.length/2)] : 0; }

  function probe(url, timeout){
    return new Promise(function(resolve){
      var ctrl = new AbortController();
      var to = setTimeout(function(){ ctrl.abort(); }, timeout || P.timeout);
      var t0 = now();
      fetch(url, { mode:'no-cors', cache:'no-store', redirect:'manual', signal:ctrl.signal })
        .then(function(){ clearTimeout(to); resolve({ outcome:'resolved', ms: now()-t0 }); })
        .catch(function(e){
          clearTimeout(to);
          resolve({ outcome: (e && e.name === 'AbortError') ? 'timeout' : 'error', ms: now()-t0 });
        });
    });
  }

  // The eBay check.js primitive: open a WebSocket and time how long until it
  // errors. Closed port -> instant RST -> fast error. Open (non-WS) port -> TCP
  // + WS-upgrade handshake proceeds, so the error fires noticeably later.
  function probeWS(host, port, timeout){
    return new Promise(function(resolve){
      var t0 = now(), settled = false, ws, to;
      function finish(outcome){
        if (settled) return; settled = true; clearTimeout(to);
        try { ws && ws.close(); } catch(e){}
        resolve({ outcome: outcome, ms: now() - t0 });
      }
      to = setTimeout(function(){ finish('timeout'); }, timeout || P.timeout);
      try { ws = new WebSocket('ws://' + host + ':' + port + '/'); }
      catch(e){ finish('error'); return; }   // blocked port etc.
      ws.onopen  = function(){ finish('resolved'); };  // an actual WS server
      ws.onerror = function(){ finish('error'); };
      ws.onclose = function(){ finish('error'); };
    });
  }

  // Shared classification: resolved/hung = open; slow error = open; fast error
  // (near the calibrated closed baseline) = closed.
  function verdict(r, hi){
    if (r.outcome === 'resolved' || r.outcome === 'timeout') return 'open';
    return r.ms > hi ? 'open' : 'closed';
  }

  function pool(items, worker, n){
    var idx = 0;
    function run(){
      if (idx >= items.length || wraith.aborted()) return Promise.resolve();
      var i = idx++;
      return Promise.resolve(worker(items[i], i)).then(run);
    }
    var runners = [];
    for (var k = 0; k < Math.min(n, items.length); k++) runners.push(run());
    return Promise.all(runners);
  }

  function expand(spec){
    var out = [];
    String(spec).split(',').forEach(function(part){
      part = part.trim(); if (!part) return;
      var m = part.match(/^(\\d+\\.\\d+\\.\\d+)\\.(\\d+)-(\\d+)$/);
      if (m){ for (var i = +m[2]; i <= +m[3] && i <= 255; i++) out.push(m[1] + '.' + i); }
      else out.push(part);
    });
    return out;
  }

  function localIP(){
    return new Promise(function(resolve){
      var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      if (!RTC){ resolve(null); return; }
      var pc, found = null, done = false;
      try { pc = new RTC({ iceServers: [] }); } catch(e){ resolve(null); return; }
      function finish(){ if (done) return; done = true; try { pc.close(); } catch(_){} resolve(found); }
      try { pc.createDataChannel('x'); } catch(e){}
      pc.onicecandidate = function(e){
        if (!e || !e.candidate){ finish(); return; }
        var m = /([0-9]{1,3}(\\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
        if (m && m[1].indexOf('0.0.0.0') !== 0){ found = m[1]; finish(); }
      };
      pc.createOffer().then(function(o){ return pc.setLocalDescription(o); }).catch(finish);
      setTimeout(finish, 900);
    });
  }

  // Calibrate the machine's "closed port" timing baseline on a host, using
  // random high ports that are almost certainly not listening.
  function calibrate(scheme, host){
    var controls = [49991, 49993, 49997, 50021];
    var times = [];
    return pool(controls, function(port){
      return probe(scheme + '://' + host + ':' + port + '/', 1200).then(function(r){
        if (r.outcome === 'error') times.push(r.ms);   // a clean RST/refused
      });
    }, 4).then(function(){
      var base = times.length ? median(times) : 6;     // ms; fallback if all weird
      return { base: base, samples: times.length };
    });
  }

  // Same idea for the WebSocket primitive.
  function calibrateWS(host){
    var controls = [49992, 49994, 49998, 50022];
    var times = [];
    return pool(controls, function(port){
      return probeWS(host, port, 1200).then(function(r){ if (r.outcome === 'error') times.push(r.ms); });
    }, 4).then(function(){ return times.length ? median(times) : 5; });
  }

  // ---- the reliable path: calibrated loopback scan, TWO primitives ------
  // Each port is probed with BOTH fetch-timing and WebSocket-timing. Students
  // see the two independent side-channels corroborate (or disagree) per port.
  function scanLocalhost(){
    var host = '127.0.0.1', scheme = 'http';   // loopback is http, no mixed-content issue
    wraith.report({ kind:'start', mode:'localhost', target:'this machine (127.0.0.1)', total: P.ports.length });
    return Promise.all([ calibrate(scheme, host), calibrateWS(host) ]).then(function(cals){
      var fbase = cals[0].base, wbase = cals[1];
      var hiF = Math.max(fbase * 3, fbase + 35);
      var hiW = Math.max(wbase * 3, wbase + 35);
      wraith.report({ kind:'info', text:'Calibrated baselines — fetch closed ~' + Math.round(fbase) +
        'ms, websocket closed ~' + Math.round(wbase) + 'ms. Two independent timing primitives; ' +
        'OPEN = a port that resolves, hangs, or runs slower than its baseline on either channel.' });
      var probed = 0, openCount = 0;
      return pool(P.ports, function(port){
        if (BLOCKED[port]){
          probed++;
          wraith.report({ kind:'port', host:host, port:port, status:'blocked', service: svc(port), ms:0 });
          wraith.report({ kind:'progress', done: probed, last: port });
          return Promise.resolve();
        }
        return Promise.all([
          probe(scheme + '://' + host + ':' + port + '/'),
          probeWS(host, port)
        ]).then(function(rs){
          var sf = verdict(rs[0], hiF), sw = verdict(rs[1], hiW);
          var open = (sf === 'open' || sw === 'open');
          var agree = (sf === 'open' && sw === 'open') ? 'both'
                    : (sf === 'open') ? 'fetch'
                    : (sw === 'open') ? 'ws' : 'none';
          if (open) openCount++;
          wraith.report({ kind:'port', host:host, port:port, status: open ? 'open' : 'closed',
            service: svc(port), ms: Math.round(rs[0].ms),
            fetchStatus: sf, fetchMs: Math.round(rs[0].ms),
            wsStatus: sw, wsMs: Math.round(rs[1].ms), agree: agree });
          wraith.report({ kind:'progress', done: ++probed, last: port });
        });
      }, P.concurrency).then(function(){
        wraith.done({ mode:'localhost', host:host, scanned:P.ports.length, open:openCount });
      });
    });
  }

  // ---- LAN host / discover (LNA-gated, kept honest) ---------------------
  function classifyLan(r){
    if (r.outcome === 'resolved') return 'open';
    if (r.outcome === 'error')    return r.ms < P.timeout * 0.7 ? 'closed' : 'filtered';
    return 'filtered';
  }
  function lanWarnTracker(){
    var probed = 0, instant = 0;
    return {
      tally: function(r){ probed++; if (r.outcome === 'error' && r.ms < 30) instant++; },
      done: function(){
        if (probed >= 8 && instant / probed > 0.7)
          wraith.report({ kind:'warn', text:
            'Almost every probe was rejected instantly. The browser is BLOCKING this range ' +
            '(Local Network Access, Chrome 142+). Private LAN scanning needs the user to grant the ' +
            'LNA prompt, or a non-Chromium browser. Loopback (this-machine) mode is the reliable one.' });
      }
    };
  }

  function scanHost(target){
    var host = String(target).trim(), scheme = location.protocol === 'https:' ? 'https' : 'http';
    wraith.report({ kind:'start', mode:'host', target:host, total:P.ports.length });
    wraith.report({ kind:'info', text:'Scanning ' + P.ports.length + ' ports on ' + host +
      ' (LAN targets are gated by Local Network Access in Chrome 142+).' });
    var w = lanWarnTracker(), probed = 0, openCount = 0;
    return pool(P.ports, function(port){
      if (BLOCKED[port]){ probed++; wraith.report({kind:'port',host:host,port:port,status:'blocked',service:svc(port),ms:0});
        wraith.report({kind:'progress',done:probed,last:port}); return Promise.resolve(); }
      return probe(scheme + '://' + host + ':' + port + '/').then(function(r){
        w.tally(r); var st = classifyLan(r); if (st === 'open') openCount++;
        wraith.report({ kind:'port', host:host, port:port, status:st, service:svc(port), ms:Math.round(r.ms) });
        wraith.report({ kind:'progress', done: ++probed, last: port });
      });
    }, P.concurrency).then(function(){ w.done(); wraith.done({mode:'host',host:host,scanned:P.ports.length,open:openCount}); });
  }

  function discover(target){
    var hosts = expand(target), scheme = location.protocol === 'https:' ? 'https' : 'http';
    wraith.report({ kind:'start', mode:'discover', target:target, total:hosts.length });
    wraith.report({ kind:'info', text:'Looking for live WEB hosts across ' + hosts.length +
      ' addresses. Only hosts that answer HTTP can be confirmed, and Chrome 142+ LNA blocks most LAN probes.' });
    var w = lanWarnTracker(), probed = 0, up = 0;
    return pool(hosts, function(h){
      return probe(scheme + '://' + h + '/', 1500).then(function(r){
        w.tally(r);
        if (classifyLan(r) === 'open'){ up++; wraith.report({kind:'host',host:h,status:'up',note:'answered HTTP on :80',ms:Math.round(r.ms)}); }
        wraith.report({ kind:'progress', done: ++probed, last: h });
      });
    }, P.concurrency).then(function(){ w.done(); wraith.done({mode:'discover',scanned:hosts.length,up:up}); });
  }

  // ---- dispatch ---------------------------------------------------------
  (function(){
    if (P.mode === 'localhost') return scanLocalhost().catch(function(e){ wraith.done({error:String(e)}); });
    // LAN modes get the local-IP hint first
    return localIP().then(function(ip){
      if (ip) wraith.report({ kind:'local-ip', ip: ip });
      else    wraith.report({ kind:'info', text:'Local IP masked (mDNS / modern browser). Pick a subnet manually.' });
      return (P.mode === 'discover') ? discover(P.target) : scanHost(P.target);
    }).catch(function(e){ wraith.done({ error: String(e) }); });
  })();
  `
};
