// Redirect if already logged in
fetch("auth/me").then(r => r.json()).then(d => {
  if (d.user) window.location.href = "./";
});
