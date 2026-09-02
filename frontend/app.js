const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authForm = document.getElementById("authForm");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const authSubmit = document.getElementById("authSubmit");
const authError = document.getElementById("authError");
const loginTab = document.getElementById("loginTab");
const registerTab = document.getElementById("registerTab");
const currentUsername = document.getElementById("currentUsername");

const vmGrid = document.getElementById("vmGrid");
const vmDialog = document.getElementById("vmDialog");
const vmForm = document.getElementById("vmForm");

const settingsDialog = document.getElementById("settingsDialog");
const settingsDialogTitle = document.getElementById("settingsDialogTitle");
const diskList = document.getElementById("diskList");
const diskForm = document.getElementById("diskForm");
const disksTab = document.getElementById("disksTab");
const mediaTab = document.getElementById("mediaTab");
const disksPanel = document.getElementById("disksPanel");
const mediaPanel = document.getElementById("mediaPanel");

const cdromCurrent = document.getElementById("cdromCurrent");
const floppyCurrent = document.getElementById("floppyCurrent");
const cdromSelect = document.getElementById("cdromSelect");
const floppySelect = document.getElementById("floppySelect");

const consoleDialog = document.getElementById("consoleDialog");
const consoleWindow = document.getElementById("consoleWindow");
const consoleTitle = document.getElementById("consoleTitle");
const consoleFrame = document.getElementById("consoleFrame");
const maximizeConsole = document.getElementById("maximizeConsole");

let authMode = "login";
let currentUser = null;
let vms = [];
let activeVM = null;
let refreshTimer = null;


async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? {"Content-Type": "application/json"} : {}),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    showAuth();
    throw new Error("Nejste přihlášen.");
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      data && typeof data === "object"
        ? (data.detail || JSON.stringify(data))
        : String(data || `HTTP ${response.status}`);

    throw new Error(message);
  }

  return data;
}


function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}


function setAuthMode(mode) {
  authMode = mode;
  const register = mode === "register";

  loginTab.classList.toggle("active", !register);
  registerTab.classList.toggle("active", register);
  authSubmit.textContent = register ? "Registrovat" : "Přihlásit";
  authPassword.autocomplete = register ? "new-password" : "current-password";
  authError.textContent = "";
}


function showAuth() {
  currentUser = null;
  appView.classList.add("hidden");
  authView.classList.remove("hidden");

  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}


async function showApp(user) {
  currentUser = user;
  currentUsername.textContent = user.username;
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  await loadVMs();
  scheduleRefresh();
}


async function checkSession() {
  try {
    const user = await api("/api/auth/me");
    await showApp(user);
  } catch {
    showAuth();
  }
}


loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));


authForm.addEventListener("submit", async event => {
  event.preventDefault();
  authError.textContent = "";
  authSubmit.disabled = true;

  try {
    const user = await api(`/api/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify({
        username: authUsername.value.trim(),
        password: authPassword.value
      })
    });

    authPassword.value = "";
    await showApp(user);
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});


document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", {method: "POST"});
  } finally {
    showAuth();
  }
});


async function loadVMs() {
  try {
    vms = await api("/api/vms");
    renderVMs();
  } catch (error) {
    if (!currentUser) return;
    vmGrid.innerHTML = `
      <article class="vm-card">
        <h3>Chyba backendu</h3>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }
}


function renderVMs() {
  vmGrid.innerHTML = "";

  if (vms.length === 0) {
    vmGrid.innerHTML = `
      <article class="vm-card empty-card">
        <h3>Žádné virtuální stroje</h3>
        <p>Klikni na <strong>+ Nová VM</strong> a vytvoř první instanci.</p>
      </article>
    `;
    return;
  }

  for (const vm of vms) {
    const card = document.createElement("article");
    card.className = `vm-card ${vm.running ? "running" : ""}`;

    const mediaBits = [
      vm.cdrom ? `CD: ${escapeHtml(vm.cdrom)}` : null,
      vm.floppy ? `FDD: ${escapeHtml(vm.floppy)}` : null
    ].filter(Boolean).join("<br>");

    card.innerHTML = `
      <div class="vm-card-title">
        <div>
          <h3>${escapeHtml(vm.name)}</h3>
          <div class="status">
            <span class="status-dot"></span>
            ${vm.running ? "Running" : "Stopped"}
          </div>
        </div>
        <button class="danger compact" data-action="delete" data-id="${vm.id}" title="Smazat VM">×</button>
      </div>

      <div class="vm-specs">
        <span>Architecture</span><strong>${escapeHtml(vm.arch)}</strong>
        <span>RAM</span><strong>${vm.ram} MB</strong>
        <span>CPU</span><strong>${vm.cpus} vCPU</strong>
        <span>Disky</span><strong>${vm.disk_count} / ${vm.disk} GB</strong>
        <span>Média</span><strong>${mediaBits || "—"}</strong>
      </div>

      <div class="vm-actions">
        <button data-action="toggle" data-id="${vm.id}">
          ${vm.running ? "Stop" : "Start"}
        </button>

        <button class="secondary" data-action="console" data-id="${vm.id}">
          Console
        </button>

        <button class="secondary" data-action="settings" data-id="${vm.id}">
          Nastavení
        </button>
      </div>
    `;

    vmGrid.appendChild(card);
  }
}


async function startVM(vm) {
  await api(`/api/vms/${encodeURIComponent(vm.id)}/start`, {method: "POST"});
  await loadVMs();
}


async function stopVM(vm) {
  await api(`/api/vms/${encodeURIComponent(vm.id)}/stop`, {method: "POST"});
  await loadVMs();
}


async function deleteVM(vm) {
  if (vm.running) {
    alert("Nejdřív VM zastav.");
    return;
  }

  if (!confirm(`Opravdu smazat "${vm.name}" včetně všech disků?`)) {
    return;
  }

  await api(`/api/vms/${encodeURIComponent(vm.id)}`, {method: "DELETE"});
  await loadVMs();
}


function openConsole(vm) {
  if (!vm.running) {
    alert("Virtuální stroj není spuštěný.");
    return;
  }

  consoleTitle.textContent = `${vm.name} — Console`;

  /*
   * noVNC běží pod /novnc/. Relativní ../ws/... se z něj přeloží
   * na /ws/... místo chybného /novnc/ws/... .
   */
  const wsPath = `../ws/vms/${encodeURIComponent(vm.id)}/console`;

  consoleFrame.src =
    "/novnc/vnc.html" +
    "?autoconnect=true" +
    "&resize=scale" +
    `&path=${encodeURIComponent(wsPath)}`;

  consoleDialog.showModal();
}


async function closeConsole() {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }

  consoleFrame.src = "";
  consoleDialog.close();
}


maximizeConsole.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await consoleWindow.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    alert(`Maximalizaci se nepodařilo zapnout: ${error.message}`);
  }
});


document.addEventListener("fullscreenchange", () => {
  maximizeConsole.textContent =
    document.fullscreenElement ? "Obnovit" : "Maximalizovat";
});


document.getElementById("closeConsole").addEventListener("click", closeConsole);

consoleDialog.addEventListener("cancel", event => {
  event.preventDefault();
  closeConsole();
});


function setSettingsTab(tab) {
  const showDisks = tab === "disks";
  disksTab.classList.toggle("active", showDisks);
  mediaTab.classList.toggle("active", !showDisks);
  disksPanel.classList.toggle("hidden", !showDisks);
  mediaPanel.classList.toggle("hidden", showDisks);
}


disksTab.addEventListener("click", () => setSettingsTab("disks"));
mediaTab.addEventListener("click", async () => {
  setSettingsTab("media");
  await loadMediaPanel();
});


async function openSettings(vm) {
  activeVM = vm;
  settingsDialogTitle.textContent = `${vm.name} — Nastavení`;
  setSettingsTab("disks");
  await loadDisks();
  settingsDialog.showModal();
}


async function loadDisks() {
  if (!activeVM) return;

  const disks = await api(`/api/vms/${encodeURIComponent(activeVM.id)}/disks`);
  diskList.innerHTML = "";

  for (const disk of disks) {
    const row = document.createElement("div");
    row.className = "disk-row";

    row.innerHTML = `
      <div>
        <strong>${escapeHtml(disk.name)}</strong>
        <span>${disk.size_gb} GB · qcow2</span>
      </div>
      <button
        class="danger secondary"
        data-disk-id="${disk.id}"
        ${disks.length <= 1 || activeVM.running ? "disabled" : ""}>
        Smazat
      </button>
    `;

    diskList.appendChild(row);
  }

  if (activeVM.running) {
    diskList.insertAdjacentHTML(
      "beforeend",
      '<p class="hint">Pro změny disků nejdřív VM zastav.</p>'
    );
  }
}


async function loadMediaPanel() {
  if (!activeVM) return;

  const [available, attached] = await Promise.all([
    api("/api/media"),
    api(`/api/vms/${encodeURIComponent(activeVM.id)}/media`)
  ]);

  cdromCurrent.textContent = attached.cdrom || "Žádné médium";
  floppyCurrent.textContent = attached.floppy || "Žádné médium";

  const cds = available.filter(item => item.type === "cdrom");
  const floppies = available.filter(item => item.type === "floppy");

  cdromSelect.innerHTML = cds.length
    ? cds.map(item => `<option value="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</option>`).join("")
    : '<option value="">Žádná ISO v /data/media</option>';

  floppySelect.innerHTML = floppies.length
    ? floppies.map(item => `<option value="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</option>`).join("")
    : '<option value="">Žádná disketa v /data/media</option>';

  const disabled = activeVM.running;
  for (const id of ["attachCdrom", "ejectCdrom", "attachFloppy", "ejectFloppy"]) {
    document.getElementById(id).disabled = disabled;
  }
  cdromSelect.disabled = disabled || cds.length === 0;
  floppySelect.disabled = disabled || floppies.length === 0;
}


async function attachMedia(type, select) {
  if (!activeVM || !select.value) return;

  await api(`/api/vms/${encodeURIComponent(activeVM.id)}/media`, {
    method: "POST",
    body: JSON.stringify({
      filename: select.value,
      media_type: type
    })
  });

  await loadMediaPanel();
  await loadVMs();
}


async function ejectMedia(type) {
  if (!activeVM) return;

  await api(`/api/vms/${encodeURIComponent(activeVM.id)}/media/${type}`, {
    method: "DELETE"
  });

  await loadMediaPanel();
  await loadVMs();
}


document.getElementById("attachCdrom").addEventListener("click", async () => {
  try { await attachMedia("cdrom", cdromSelect); }
  catch (error) { alert(error.message); }
});

document.getElementById("ejectCdrom").addEventListener("click", async () => {
  try { await ejectMedia("cdrom"); }
  catch (error) { alert(error.message); }
});

document.getElementById("attachFloppy").addEventListener("click", async () => {
  try { await attachMedia("floppy", floppySelect); }
  catch (error) { alert(error.message); }
});

document.getElementById("ejectFloppy").addEventListener("click", async () => {
  try { await ejectMedia("floppy"); }
  catch (error) { alert(error.message); }
});


diskList.addEventListener("click", async event => {
  const button = event.target.closest("[data-disk-id]");
  if (!button || !activeVM) return;

  if (!confirm("Opravdu smazat tento disk? Data budou ztracena.")) {
    return;
  }

  try {
    await api(
      `/api/vms/${encodeURIComponent(activeVM.id)}/disks/${encodeURIComponent(button.dataset.diskId)}`,
      {method: "DELETE"}
    );
    await loadDisks();
    await loadVMs();
  } catch (error) {
    alert(error.message);
  }
});


diskForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeVM) return;

  try {
    await api(`/api/vms/${encodeURIComponent(activeVM.id)}/disks`, {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("diskName").value.trim(),
        size_gb: Number(document.getElementById("diskSize").value)
      })
    });

    await loadDisks();
    await loadVMs();
  } catch (error) {
    alert(error.message);
  }
});


document.getElementById("closeSettingsDialog").addEventListener("click", () => {
  activeVM = null;
  settingsDialog.close();
});


vmGrid.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const vm = vms.find(item => item.id === button.dataset.id);
  if (!vm) return;

  button.disabled = true;

  try {
    if (button.dataset.action === "toggle") {
      if (vm.running) await stopVM(vm);
      else await startVM(vm);
    }

    if (button.dataset.action === "console") {
      openConsole(vm);
    }

    if (button.dataset.action === "settings") {
      await openSettings(vm);
    }

    if (button.dataset.action === "delete") {
      await deleteVM(vm);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});


document.getElementById("newVmBtn").addEventListener("click", () => {
  vmDialog.showModal();
});


document.getElementById("cancelBtn").addEventListener("click", () => {
  vmDialog.close();
});


vmForm.addEventListener("submit", async event => {
  event.preventDefault();

  const submit = vmForm.querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    await api("/api/vms", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("vmName").value.trim(),
        arch: document.getElementById("vmArch").value,
        ram: Number(document.getElementById("vmRam").value),
        cpus: Number(document.getElementById("vmCpu").value),
        disk: Number(document.getElementById("vmDisk").value)
      })
    });

    vmDialog.close();
    await loadVMs();
  } catch (error) {
    alert(error.message);
  } finally {
    submit.disabled = false;
  }
});


function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);

  const tick = async () => {
    if (currentUser) {
      await loadVMs();
      refreshTimer = setTimeout(tick, 3000);
    }
  };

  refreshTimer = setTimeout(tick, 3000);
}


setAuthMode("login");
checkSession();
