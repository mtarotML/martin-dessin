let currentUser = null;
let currentDrawingId = null;

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const gallery = document.getElementById("gallery");
const leaderboardList = document.getElementById("leaderboard-list");
const topLikedImage = document.getElementById("top-liked-image");
const topLikedLikeCount = document.getElementById("top-liked-like-count");
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

// ==================== Auth gate ====================

async function checkAuth() {
  const res = await fetch("auth/me");
  const data = await res.json();
  if (!data.user) {
    window.location.href = "auth";
    return;
  }
  currentUser = data.user;
  document.getElementById("username-display").textContent = currentUser.username;
}

document.getElementById("logout-btn").onclick = async () => {
  await fetch("auth/logout", { method: "POST" });
  window.location.href = "auth";
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
  await fetch("drawings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  loadGallery();
  loadLeaderboard();
  loadTopLiked();
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

async function loadTopLiked() {
  const res = await fetch("top-liked");
  const data = await res.json();
  const top = data.top;

  if (!top) {
    topLikedImage.removeAttribute("src");
    topLikedImage.style.display = "none";
    topLikedLikeCount.textContent = "0";
    refreshLucide();
    return;
  }

  topLikedImage.style.display = "block";
  topLikedImage.src = top.image;
  topLikedLikeCount.textContent = top.like_count || 0;
  refreshLucide();
}

function renderGallery(drawings) {
  gallery.innerHTML = "";
  drawings.forEach(d => {
    const card = document.createElement("div");
    card.className = "gallery-card";

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
  loadTopLiked();
}

document.getElementById("modal-close").onclick = closeDetail;
document.querySelector(".modal-backdrop").onclick = closeDetail;

// ==================== Reactions ====================

function renderLike(userLiked) {
  likeBtn.className = "like-btn" + (userLiked ? " active" : "");
  likeLabel.textContent = userLiked ? "Aimé" : "J'aime";
  likeBtn.dataset.liked = userLiked ? "true" : "false";
}

async function toggleLike() {
  if (!currentDrawingId) return;
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
  loadTopLiked();
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
  loadTopLiked();
});
