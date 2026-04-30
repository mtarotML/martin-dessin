const gallery = document.getElementById("gallery");
const usersTbody = document.getElementById("users-tbody");
const adminEmailEl = document.getElementById("admin-email");

const contestStatusPill = document.getElementById("contest-status-pill");
const contestStatusDetail = document.getElementById("contest-status-detail");
const contestStartForm = document.getElementById("contest-start-form");
const contestDurationValue = document.getElementById("contest-duration-value");
const contestDurationUnit = document.getElementById("contest-duration-unit");
const contestStartBtn = document.getElementById("contest-start-btn");
const contestCloseBtn = document.getElementById("contest-close-btn");
const contestCancelBtn = document.getElementById("contest-cancel-btn");
const contestError = document.getElementById("contest-error");

let selectedIds = new Set();
let adminId = null;
let contestTickHandle = null;
let contestEndsAt = null;

function refreshLucide() {
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

async function checkSession() {
  const res = await fetch("auth/me");
  const data = await res.json();
  if (!data.user || !data.user.is_admin) {
    window.location.href = "./";
    return null;
  }
  if (adminEmailEl) adminEmailEl.textContent = data.user.email;
  return data.user;
}

async function loadDrawings() {
  const res = await fetch("admin/drawings");
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      window.location.href = "./";
    }
    return;
  }
  const data = await res.json();
  renderDrawings(data.drawings);
}

function renderDrawings(drawings) {
  gallery.innerHTML = "";
  selectedIds.clear();

  drawings.forEach((d) => {
    const wrapper = document.createElement("div");
    wrapper.className = "admin-item";

    const img = document.createElement("img");
    img.src = d.image;
    img.width = 80;
    img.height = 80;

    img.onclick = () => {
      if (selectedIds.has(d.id)) {
        selectedIds.delete(d.id);
        img.classList.remove("selected");
      } else {
        selectedIds.add(d.id);
        img.classList.add("selected");
      }
    };

    wrapper.appendChild(img);
    gallery.appendChild(wrapper);
  });
}

async function loadUsers() {
  const res = await fetch("admin/users");
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      window.location.href = "./";
    }
    return;
  }
  const data = await res.json();
  adminId = data.admin_id;
  renderUsers(data.users);
}

function renderUsers(users) {
  usersTbody.innerHTML = "";
  if (!users.length) {
    usersTbody.innerHTML = `<tr><td colspan="5" class="admin-users-empty">Aucun utilisateur.</td></tr>`;
    return;
  }

  users.forEach((u) => {
    const tr = document.createElement("tr");
    const isSelf = u.id === adminId;
    const badge = isSelf ? ` <span class="admin-self-badge">toi</span>` : "";

    tr.innerHTML = `
      <td><strong>${escapeHtml(u.username)}</strong>${badge}</td>
      <td class="admin-users-email">${escapeHtml(u.email)}</td>
      <td>${u.drawing_count}</td>
      <td>${escapeHtml(formatDate(u.created_at))}</td>
      <td>
        <button class="btn-with-icon btn-danger-outline btn-small admin-delete-user"
                data-id="${u.id}"
                data-username="${escapeHtml(u.username)}"
                ${isSelf ? "disabled" : ""}>
          <i data-lucide="trash-2" aria-hidden="true"></i>
          <span>Supprimer</span>
        </button>
      </td>
    `;
    usersTbody.appendChild(tr);
  });

  usersTbody.querySelectorAll(".admin-delete-user").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const username = btn.dataset.username;
      if (!confirm(`Supprimer définitivement l'utilisateur « ${username} » ?\n\nSes commentaires et likes seront supprimés. Ses dessins seront conservés mais anonymisés.`)) {
        return;
      }
      const res = await fetch(`admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Suppression impossible");
        return;
      }
      await Promise.all([loadUsers(), loadDrawings()]);
    });
  });

  refreshLucide();
}

// ==================== Contest ====================

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatRemaining(secondsLeft) {
  const total = Math.max(0, Math.floor(secondsLeft));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}j ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stopContestTick() {
  if (contestTickHandle) {
    clearInterval(contestTickHandle);
    contestTickHandle = null;
  }
}

function setContestUiRunning(contest) {
  contestEndsAt = Date.parse(contest.ends_at);
  contestStatusPill.textContent = "En cours";
  contestStatusPill.className = "contest-status-pill is-running";

  const tick = () => {
    const left = Math.max(0, Math.floor((contestEndsAt - Date.now()) / 1000));
    contestStatusDetail.textContent =
      `Fin dans ${formatRemaining(left)} · prévue le ${formatDateTime(contest.ends_at)}`;
    if (left <= 0) {
      stopContestTick();
      setTimeout(loadContest, 600);
    }
  };
  tick();
  stopContestTick();
  contestTickHandle = setInterval(tick, 1000);

  contestStartForm.classList.add("hidden");
  contestCloseBtn.classList.remove("hidden");
  contestCancelBtn.classList.remove("hidden");
}

function setContestUiIdle() {
  contestEndsAt = null;
  stopContestTick();
  contestStatusPill.textContent = "Aucun concours";
  contestStatusPill.className = "contest-status-pill is-idle";
  contestStatusDetail.textContent = "Aucun concours en cours.";
  contestStartForm.classList.remove("hidden");
  contestCloseBtn.classList.add("hidden");
  contestCancelBtn.classList.add("hidden");
}

async function loadContest() {
  contestError.textContent = "";
  try {
    const res = await fetch("admin/contest");
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        window.location.href = "./";
      }
      return;
    }
    const data = await res.json();
    if (data.contest && data.contest.status === "running") {
      setContestUiRunning(data.contest);
    } else {
      setContestUiIdle();
    }
  } catch {
    contestError.textContent = "Impossible de charger l'état du concours.";
  }
}

contestStartForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  contestError.textContent = "";
  const value = parseInt(contestDurationValue.value, 10);
  const unit = parseInt(contestDurationUnit.value, 10);
  if (!Number.isFinite(value) || value <= 0) {
    contestError.textContent = "Durée invalide.";
    return;
  }
  const duration = value * unit;
  contestStartBtn.disabled = true;
  try {
    const res = await fetch("admin/contest/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_seconds: duration }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      contestError.textContent = data.error || "Impossible de démarrer le concours.";
      return;
    }
    await Promise.all([loadContest(), loadDrawings()]);
  } finally {
    contestStartBtn.disabled = false;
  }
});

contestCloseBtn.addEventListener("click", async () => {
  if (!confirm("Clôturer le concours maintenant ?\n\nLe gagnant sera archivé et tous les autres dessins supprimés.")) return;
  contestError.textContent = "";
  const res = await fetch("admin/contest/close-now", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    contestError.textContent = data.error || "Impossible de clôturer le concours.";
    return;
  }
  await Promise.all([loadContest(), loadDrawings()]);
});

contestCancelBtn.addEventListener("click", async () => {
  if (!confirm("Annuler le concours ?\n\nAucun gagnant ne sera archivé. Les dessins resteront en place.")) return;
  contestError.textContent = "";
  const res = await fetch("admin/contest/cancel", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    contestError.textContent = data.error || "Impossible d'annuler le concours.";
    return;
  }
  await loadContest();
});

document.getElementById("delete").onclick = async () => {
  if (selectedIds.size === 0) return;
  await fetch("admin/drawings", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: Array.from(selectedIds) }),
  });
  loadDrawings();
};

document.getElementById("delete-all").onclick = async () => {
  if (!confirm("⚠️ Supprimer TOUS les dessins ?")) return;
  await fetch("admin/drawings/all", { method: "DELETE" });
  loadDrawings();
};

(async () => {
  const user = await checkSession();
  if (!user) return;
  await Promise.all([loadContest(), loadDrawings(), loadUsers()]);
})();
