const gallery = document.getElementById("gallery");
const ADMIN_TOKEN = prompt("Admin token:");
let selectedIds = new Set();


async function loadDrawings() {
  const res = await fetch("/martin-dessin/admin/drawings", {
    headers: { "X-Admin-Token": ADMIN_TOKEN }
  });

  if (!res.ok) {
    alert("Unauthorized");
    return;
  }

  const data = await res.json();
  render(data.drawings);
}

function render(drawings) {
  gallery.innerHTML = "";
  selectedIds.clear();

  drawings.forEach(d => {
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


document.getElementById("delete").onclick = async () => {
  if (selectedIds.size === 0) return;

  await fetch("/martin-dessin/admin/drawings", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": ADMIN_TOKEN
    },
    body: JSON.stringify({ ids: Array.from(selectedIds) })
  });

  loadDrawings();
};

document.getElementById("delete-all").onclick = async () => {
  if (!confirm("⚠️ Supprimer TOUS les dessins ?")) return;

  await fetch("/martin-dessin/admin/drawings/all", {
    method: "DELETE",
    headers: {
      "X-Admin-Token": ADMIN_TOKEN
    }
  });

  loadDrawings();
};


loadDrawings();
