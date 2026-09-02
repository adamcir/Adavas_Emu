const vmGrid = document.getElementById("vmGrid");
const vmDialog = document.getElementById("vmDialog");
const vmForm = document.getElementById("vmForm");
const consoleDialog = document.getElementById("consoleDialog");
const consoleTitle = document.getElementById("consoleTitle");

let vms = [];


async function loadVMs() {
  try {
    const response = await fetch("/api/vms");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    vms = await response.json();
    render();
  } catch (error) {
    console.error("Failed to load VMs:", error);

    vmGrid.innerHTML = `
      <article class="vm-card">
        <h3>Chyba backendu</h3>
        <p>Nepodařilo se načíst seznam virtuálních strojů.</p>
        <p>${escapeHtml(String(error))}</p>
      </article>
    `;
  }
}


function render() {
  vmGrid.innerHTML = "";

  if (vms.length === 0) {
    vmGrid.innerHTML = `
      <article class="vm-card">
        <h3>Žádné virtuální stroje</h3>
        <p>Zatím není vytvořen žádný virtuální stroj.</p>
      </article>
    `;
    return;
  }

  for (const vm of vms) {
    const card = document.createElement("article");

    card.className = `vm-card ${vm.running ? "running" : ""}`;

    card.innerHTML = `
      <h3>${escapeHtml(vm.name)}</h3>

      <div class="status">
        <span class="status-dot"></span>
        ${vm.running ? "Running" : "Stopped"}
      </div>

      <div class="vm-specs">
        <span>Architecture</span>
        <strong>${escapeHtml(vm.arch)}</strong>

        <span>RAM</span>
        <strong>${vm.ram} MB</strong>

        <span>CPU</span>
        <strong>${vm.cpus} vCPU</strong>

        <span>Disk</span>
        <strong>${vm.disk} GB</strong>
      </div>

      <div class="vm-actions">
        <button
          data-action="toggle"
          data-id="${vm.id}">
          ${vm.running ? "Stop" : "Start"}
        </button>

        <button
          class="secondary"
          data-action="console"
          data-id="${vm.id}">
          Console
        </button>
      </div>
    `;

    vmGrid.appendChild(card);
  }
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


async function startVM(vm) {
  try {
    const response = await fetch(
      `/api/vms/${encodeURIComponent(vm.id)}/start`,
      {
        method: "POST"
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message);
    }

    const result = await response.json();

    console.log("VM start result:", result);

    await loadVMs();

  } catch (error) {
    console.error("Failed to start VM:", error);

    alert(
      "Nepodařilo se spustit VM.\n\n" +
      error
    );
  }
}


async function stopVM(vm) {
  try {
    const response = await fetch(
      `/api/vms/${encodeURIComponent(vm.id)}/stop`,
      {
        method: "POST"
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message);
    }

    const result = await response.json();

    console.log("VM stop result:", result);

    await loadVMs();

  } catch (error) {
    console.error("Failed to stop VM:", error);

    alert(
      "Nepodařilo se zastavit VM.\n\n" +
      error
    );
  }
}


vmGrid.addEventListener("click", async event => {
  const button = event.target.closest("button");

  if (!button) {
    return;
  }

  const vm = vms.find(
    item => item.id === button.dataset.id
  );

  if (!vm) {
    console.error(
      "VM not found:",
      button.dataset.id
    );

    return;
  }

  const action = button.dataset.action;


  if (action === "toggle") {

    button.disabled = true;

    try {

      if (vm.running) {
        await stopVM(vm);
      } else {
        await startVM(vm);
      }

    } finally {
      button.disabled = false;
    }
  }


  if (action === "console") {

    consoleTitle.textContent =
      `${vm.name} — Console`;

    consoleDialog.showModal();
  }
});


document
  .getElementById("newVmBtn")
  .addEventListener("click", () => {

    vmDialog.showModal();

  });


document
  .getElementById("cancelBtn")
  .addEventListener("click", () => {

    vmDialog.close();

  });


document
  .getElementById("closeConsole")
  .addEventListener("click", () => {

    consoleDialog.close();

  });


vmForm.addEventListener(
  "submit",
  async event => {

    event.preventDefault();

    const name =
      document.getElementById("vmName").value;

    const arch =
      document.getElementById("vmArch").value;

    const ram =
      Number(
        document.getElementById("vmRam").value
      );

    const cpus =
      Number(
        document.getElementById("vmCpu").value
      );

    const disk =
      Number(
        document.getElementById("vmDisk").value
      );


    console.log(
      "Create VM requested:",
      {
        name,
        arch,
        ram,
        cpus,
        disk
      }
    );


    /*
     * Create VM API zatím ještě nemáme.
     *
     * Později:
     *
     * const response = await fetch(
     *   "/api/vms",
     *   {
     *     method: "POST",
     *     headers: {
     *       "Content-Type": "application/json"
     *     },
     *     body: JSON.stringify({
     *       name,
     *       arch,
     *       ram,
     *       cpus,
     *       disk
     *     })
     *   }
     * );
     */


    alert(
      "Vytváření vlastních VM zatím není " +
      "napojené na backend."
    );

    vmDialog.close();
  }
);


async function refreshLoop() {
  try {
    await loadVMs();
  } catch (error) {
    console.error(error);
  }

  setTimeout(
    refreshLoop,
    3000
  );
}


loadVMs();

setTimeout(
  refreshLoop,
  3000
);

