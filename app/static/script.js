let currentUser = null;
let currentDrawingId = null;
let currentContestId = null;
let timerEndsAt = null;
let timerTickHandle = null;
let timerPollHandle = null;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const gallery = document.getElementById("gallery");
const leaderboardList = document.getElementById("leaderboard-list");
const contestBanner = document.getElementById("contest-banner");
const timerContainer = document.getElementById("contest-timer");
const timerTextEl = document.getElementById("contest-time-text");
const timerTextWrap = timerTextEl.parentElement;
const winnersFeatured = document.getElementById("winners-featured");
const winnersFeaturedImage = document.getElementById("winners-featured-image");
const winnersFeaturedAuthor = document.getElementById("winners-featured-author");
const winnersFeaturedLikes = document.getElementById("winners-featured-likes");
const winnersFeaturedDate = document.getElementById("winners-featured-date");
const winnersList = document.getElementById("winners-list");
const winnersEmpty = document.getElementById("winners-empty");
const modal = document.getElementById("detail-modal");
const detailImage = document.getElementById("detail-image");
const detailHeartCount = document.getElementById("detail-heart-count");
const detailHeartNum = document.getElementById("detail-heart-num");
const detailAuthor = document.getElementById("detail-author");
const likeBtn = document.getElementById("like-btn");
const likeLabel = document.getElementById("like-label");
const commentsList = document.getElementById("comments-list");
const commentForm = document.getElementById("comment-form");
const commentInput = document.getElementById("comment-input");
const usernameDisplay = document.getElementById("username-display");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const commentSubmitBtn = commentForm.querySelector("button");
const usernameModal = document.getElementById("username-modal");
const usernameModalForm = document.getElementById("username-modal-form");
const usernameModalInput = document.getElementById("username-modal-input");
const usernameModalError = document.getElementById("username-modal-error");
const usernameModalEmail = document.getElementById("username-modal-email");
const usernameModalCancel = document.getElementById("username-modal-cancel");

let drawing = false;

ctx.lineWidth = 4;
ctx.lineCap = "round";
ctx.strokeStyle = "#000000";

document.querySelectorAll(".color-dot").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".color-dot").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ctx.strokeStyle = btn.dataset.color;
  });
});

document.querySelectorAll(".size-dot").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".size-dot").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ctx.lineWidth = parseInt(btn.dataset.size, 10);
  });
});

function refreshLucide() {
  if (typeof lucide !== "undefined") lucide.createIcons();
}

// ==================== Auth ====================

function renderAuthControls() {
  const isLoggedIn = Boolean(currentUser);
  usernameDisplay.textContent = isLoggedIn ? currentUser.username : "Invité";
  loginBtn.classList.toggle("hidden", isLoggedIn);
  logoutBtn.classList.toggle("hidden", !isLoggedIn);

  commentInput.disabled = !isLoggedIn;
  commentSubmitBtn.disabled = !isLoggedIn;
  commentInput.placeholder = isLoggedIn
    ? "Ajouter un commentaire..."
    : "Connecte-toi avec Google pour commenter";
}

function openUsernameModal(email) {
  usernameModalEmail.textContent = email || "";
  usernameModalError.textContent = "";
  usernameModalInput.value = "";
  usernameModal.classList.remove("hidden");
  setTimeout(() => usernameModalInput.focus(), 30);
  refreshLucide();
}

function closeUsernameModal() {
  usernameModal.classList.add("hidden");
}

async function checkAuth() {
  let pending = null;
  try {
    const res = await fetch("auth/me");
    const data = await res.json();
    currentUser = data.user || null;
    pending = data.pending_signup || null;
  } catch {
    currentUser = null;
  }
  renderAuthControls();

  if (!currentUser && pending) {
    openUsernameModal(pending.email);
  } else {
    closeUsernameModal();
  }
}

logoutBtn.onclick = async () => {
  await fetch("auth/logout", { method: "POST" });
  currentUser = null;
  renderAuthControls();
  loadGallery();
  loadLeaderboard();
  loadWinners();
};

usernameModalForm.onsubmit = async (e) => {
  e.preventDefault();
  usernameModalError.textContent = "";
  const username = usernameModalInput.value.trim();

  const res = await fetch("auth/google/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    usernameModalError.textContent = data.error || "Erreur";
    return;
  }

  closeUsernameModal();
  await checkAuth();
  loadGallery();
  loadLeaderboard();
  loadWinners();
};

usernameModalCancel.onclick = async () => {
  await fetch("auth/google/cancel", { method: "POST" });
  closeUsernameModal();
  await checkAuth();
};

// ==================== Canvas drawing ====================

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getTouchCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvas.addEventListener("mousedown", e => {
  drawing = true;
  const c = getCanvasCoords(e);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
});
canvas.addEventListener("mouseup", () => (drawing = false));
canvas.addEventListener("mousemove", e => {
  if (!drawing) return;
  const c = getCanvasCoords(e);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
});

canvas.addEventListener("touchstart", e => {
  e.preventDefault();
  drawing = true;
  const c = getTouchCoords(e);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
});
canvas.addEventListener("touchend", e => { e.preventDefault(); drawing = false; });
canvas.addEventListener("touchmove", e => {
  e.preventDefault();
  if (!drawing) return;
  const c = getTouchCoords(e);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
});

document.getElementById("clear").onclick = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

function isCanvasEmpty() {
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) return false;
  }
  return true;
}

document.getElementById("send").onclick = async () => {
  if (isCanvasEmpty()) {
    const container = document.querySelector(".canvas-container");
    container.classList.remove("shake");
    void container.offsetWidth;
    container.classList.add("shake");
    return;
  }
  const image = canvas.toDataURL("image/png");
  const res = await fetch("drawings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  if (!res.ok) {
    alert("Impossible d'envoyer le dessin.");
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  loadGallery();
  loadLeaderboard();
  loadWinners();
};

// ==================== Gallery ====================

async function loadGallery() {
  const res = await fetch("drawings");
  const data = await res.json();
  renderGallery(data.drawings);
}

async function loadLeaderboard() {
  const res = await fetch("leaderboard");
  const data = await res.json();
  renderLeaderboard(data.leaderboard || []);
}

async function loadWinners() {
  const res = await fetch("contests/winners");
  const data = await res.json();
  renderWinners(data.winners || []);
}

function formatWinnerDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderWinners(winners) {
  winnersList.innerHTML = "";

  if (!winners.length) {
    winnersFeatured.classList.add("hidden");
    winnersEmpty.classList.remove("hidden");
    refreshLucide();
    return;
  }

  winnersEmpty.classList.add("hidden");

  const [latest, ...rest] = winners;
  winnersFeaturedImage.src = latest.image;
  winnersFeaturedAuthor.textContent = `par ${latest.author || "anonyme"}`;
  winnersFeaturedLikes.textContent = latest.like_count || 0;
  winnersFeaturedDate.textContent = formatWinnerDate(latest.archived_at);
  winnersFeatured.classList.remove("hidden");

  rest.forEach((w) => {
    const li = document.createElement("li");
    li.className = "winners-row";

    const img = document.createElement("img");
    img.className = "winners-row-image";
    img.src = w.image;
    img.alt = `Vainqueur du ${formatWinnerDate(w.archived_at)}`;

    const meta = document.createElement("div");
    meta.className = "winners-row-meta";

    const author = document.createElement("span");
    author.className = "winners-row-author";
    author.textContent = w.author || "anonyme";

    const stats = document.createElement("span");
    stats.className = "winners-row-stats";
    stats.innerHTML =
      `<i data-lucide="heart" class="winners-row-heart" aria-hidden="true"></i>` +
      `<span>${w.like_count || 0}</span>` +
      `<span class="winners-dot">·</span>` +
      `<span>${formatWinnerDate(w.archived_at)}</span>`;

    meta.appendChild(author);
    meta.appendChild(stats);
    li.appendChild(img);
    li.appendChild(meta);
    winnersList.appendChild(li);
  });

  refreshLucide();
}

// ==================== Contest timer ====================

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function stopTimerTick() {
  if (timerTickHandle) {
    clearInterval(timerTickHandle);
    timerTickHandle = null;
  }
}

function hideContestBanner() {
  contestBanner.classList.add("hidden");
  stopTimerTick();
  timerEndsAt = null;
}

function renderTimer(secondsLeft) {
  const total = Math.max(0, Math.floor(secondsLeft));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const txt = days > 0
    ? `${days}:${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  timerTextEl.textContent = txt;
  timerTextWrap.dataset.ghost = txt.replace(/\d/g, "8");

  timerContainer.classList.toggle("urgent", total > 0 && total <= 60);
  timerContainer.classList.toggle("expired", total === 0);
}

function startTimerTick() {
  stopTimerTick();
  timerTickHandle = setInterval(() => {
    if (!timerEndsAt) return;
    const left = Math.max(0, Math.floor((timerEndsAt - Date.now()) / 1000));
    renderTimer(left);
    if (left <= 0) {
      stopTimerTick();
      onContestExpired();
    }
  }, 250);
}

async function onContestExpired() {
  // Server finalises lazily on the next /contest hit, then we refresh the rest.
  await loadContest();
  await Promise.all([loadGallery(), loadLeaderboard(), loadWinners()]);
}

async function loadContest() {
  try {
    const res = await fetch("contest");
    const data = await res.json();
    const contest = data.contest;

    if (!contest) {
      currentContestId = null;
      hideContestBanner();
      return;
    }

    const newId = contest.id;
    if (currentContestId !== null && currentContestId !== newId) {
      // A new contest started while we were on the page → refresh everything.
      await Promise.all([loadGallery(), loadLeaderboard(), loadWinners()]);
    }
    currentContestId = newId;

    const parsed = Date.parse(contest.ends_at);
    const fromIso = Number.isFinite(parsed) ? parsed : null;
    const fromSecondsLeft = Date.now() + contest.seconds_left * 1000;
    timerEndsAt = fromIso || fromSecondsLeft;

    renderTimer(Math.max(0, Math.floor((timerEndsAt - Date.now()) / 1000)));
    contestBanner.classList.remove("hidden");
    startTimerTick();
  } catch {
    /* network hiccup, keep last state */
  }
}

function startContestPolling() {
  if (timerPollHandle) return;
  // Light re-sync every 30s to handle clock drift / contest changes from the admin.
  timerPollHandle = setInterval(loadContest, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadContest();
  });
}

function renderGallery(drawings) {
  gallery.innerHTML = "";
  drawings.forEach(d => {
    const card = document.createElement("div");
    card.className = "gallery-card" + (d.user_liked ? " user-liked" : "");

    const heartBadge = document.createElement("span");
    heartBadge.className = "heart-preview-badge";
    heartBadge.innerHTML =
      `<i data-lucide="heart" class="heart-icon" aria-hidden="true"></i>` +
      `<span class="heart-num">${d.heart_count || 0}</span>`;

    const imgWrap = document.createElement("div");
    imgWrap.className = "gallery-image-wrap";

    const img = document.createElement("img");
    img.src = d.image;
    img.width = 80;
    img.height = 80;

    imgWrap.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "gallery-meta";
    const authorSpan = document.createElement("span");
    authorSpan.className = "gallery-author";
    authorSpan.textContent = d.author || "anonyme";
    const statsSpan = document.createElement("span");
    statsSpan.className = "gallery-stats";
    statsSpan.textContent = `${d.comment_count || 0} com.`;
    meta.appendChild(authorSpan);
    meta.appendChild(statsSpan);

    card.appendChild(heartBadge);
    card.appendChild(imgWrap);
    card.appendChild(meta);
    card.onclick = () => openDetail(d.id);
    gallery.appendChild(card);
  });
  refreshLucide();
}

function renderLeaderboard(entries) {
  leaderboardList.innerHTML = "";
  if (!entries || entries.length === 0) {
    const li = document.createElement("li");
    li.className = "leaderboard-empty";
    li.textContent = "Aucun like pour le moment.";
    leaderboardList.appendChild(li);
    refreshLucide();
    return;
  }

  entries.forEach((e, idx) => {
    const li = document.createElement("li");
    li.className = "leaderboard-row";

    const rank = document.createElement("div");
    rank.className = "leaderboard-rank";
    rank.textContent = `${idx + 1}.`;

    const username = document.createElement("div");
    username.className = "leaderboard-username";
    username.textContent = e.username;

    const stats = document.createElement("div");
    stats.className = "leaderboard-stats";

    const drawingsStat = document.createElement("div");
    drawingsStat.className = "leaderboard-stat";
    const drawingsIcon = document.createElement("i");
    drawingsIcon.setAttribute("data-lucide", "images");
    drawingsIcon.className = "leaderboard-stat-icon";
    drawingsIcon.setAttribute("aria-hidden", "true");
    const drawingsNum = document.createElement("span");
    drawingsNum.className = "leaderboard-stat-num";
    drawingsNum.textContent = e.drawing_count || 0;
    drawingsStat.appendChild(drawingsIcon);
    drawingsStat.appendChild(drawingsNum);

    const likesStat = document.createElement("div");
    likesStat.className = "leaderboard-stat";
    const likesIcon = document.createElement("i");
    likesIcon.setAttribute("data-lucide", "heart");
    likesIcon.className = "leaderboard-stat-icon";
    likesIcon.setAttribute("aria-hidden", "true");
    const likesNum = document.createElement("span");
    likesNum.className = "leaderboard-stat-num";
    likesNum.textContent = e.like_count || 0;
    likesStat.appendChild(likesIcon);
    likesStat.appendChild(likesNum);

    stats.appendChild(drawingsStat);
    stats.appendChild(likesStat);

    li.appendChild(rank);
    li.appendChild(username);
    li.appendChild(stats);
    leaderboardList.appendChild(li);
  });

  refreshLucide();
}

// ==================== Detail modal ====================

async function openDetail(drawingId) {
  currentDrawingId = drawingId;
  const res = await fetch(`drawings/${drawingId}`);
  const data = await res.json();

  detailImage.src = data.drawing.image;
  detailHeartNum.textContent = data.heart_count || 0;
  detailAuthor.textContent = `par ${data.drawing.author || "anonyme"}`;

  renderLike(data.user_liked);
  renderComments(data.comments);

  modal.classList.remove("hidden");
}

function closeDetail() {
  modal.classList.add("hidden");
  currentDrawingId = null;
  loadGallery();
  loadLeaderboard();
  loadWinners();
}

document.getElementById("modal-close").onclick = closeDetail;
document.querySelector(".modal-backdrop").onclick = closeDetail;

// ==================== Reactions ====================

function renderLike(userLiked) {
  if (!currentUser) {
    likeBtn.className = "like-btn";
    likeLabel.textContent = "Google pour aimer";
    likeBtn.dataset.liked = "false";
    return;
  }

  likeBtn.className = "like-btn" + (userLiked ? " active" : "");
  likeLabel.textContent = userLiked ? "Aimé" : "J'aime";
  likeBtn.dataset.liked = userLiked ? "true" : "false";
}

async function toggleLike() {
  if (!currentDrawingId) return;
  if (!currentUser) {
    window.location.href = "auth/google/start";
    return;
  }
  const userLiked = likeBtn.dataset.liked === "true";

  if (userLiked) {
    await fetch(`drawings/${currentDrawingId}/reaction`, { method: "DELETE" });
  } else {
    await fetch(`drawings/${currentDrawingId}/reaction`, {
      method: "POST",
    });
  }

  const res = await fetch(`drawings/${currentDrawingId}`);
  const data = await res.json();
  detailHeartNum.textContent = data.heart_count || 0;
  renderLike(data.user_liked);
  loadGallery();
  loadLeaderboard();
  loadWinners();
}

likeBtn.onclick = toggleLike;

// ==================== Comments ====================

function renderComments(comments) {
  commentsList.innerHTML = "";
  if (comments.length === 0) {
    commentsList.innerHTML = "<p class='no-comments'>Aucun commentaire</p>";
    return;
  }
  comments.forEach(c => {
    const div = document.createElement("div");
    div.className = "comment";
    const strong = document.createElement("strong");
    strong.textContent = c.username;
    const span = document.createElement("span");
    span.textContent = c.content;
    div.appendChild(strong);
    div.append(" ");
    div.appendChild(span);
    commentsList.appendChild(div);
  });
}

commentForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!currentUser) {
    window.location.href = "auth/google/start";
    return;
  }
  const content = commentInput.value.trim();
  if (!content || !currentDrawingId) return;

  await fetch(`drawings/${currentDrawingId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  commentInput.value = "";

  const res = await fetch(`drawings/${currentDrawingId}`);
  const data = await res.json();
  renderComments(data.comments);
};

// ==================== Init ====================

checkAuth().then(() => {
  loadGallery();
  loadLeaderboard();
  loadWinners();
  loadContest();
  startContestPolling();
});
