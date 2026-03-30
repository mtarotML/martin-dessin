const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const loginError = document.getElementById("login-error");
const registerError = document.getElementById("register-error");

// Redirect if already logged in
fetch("auth/me").then(r => r.json()).then(d => {
  if (d.user) window.location.href = "./";
});

tabLogin.onclick = () => {
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");
};

tabRegister.onclick = () => {
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
};

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const fd = new FormData(loginForm);
  const res = await fetch("auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: fd.get("username"),
      password: fd.get("password"),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    loginError.textContent = data.error || "Erreur";
    return;
  }
  window.location.href = "./";
};

registerForm.onsubmit = async (e) => {
  e.preventDefault();
  registerError.textContent = "";
  const fd = new FormData(registerForm);
  const res = await fetch("auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: fd.get("username"),
      email: fd.get("email"),
      password: fd.get("password"),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    registerError.textContent = data.error || "Erreur";
    return;
  }
  window.location.href = "./";
};
