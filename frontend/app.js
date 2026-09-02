const vmGrid = document.getElementById("vmGrid");
const vmDialog = document.getElementById("vmDialog");
const vmForm = document.getElementById("vmForm");
const consoleDialog = document.getElementById("consoleDialog");
const consoleTitle = document.getElementById("consoleTitle");

let vms = [
  {
    id: crypto.randomUUID(),
    name: "Windows XP",
    arch: "x86_64",
    ram: 512,
    cpus: 1,
    disk: 10,
    running: true
  },
  {
    id: crypto.randomUUID(),
    name: "Debian 13",
    arch: "aarch64",
    ram: 2048,
    cpus: 2,
    disk: 20,
    running: false
  }
];

function render() {
  vmGrid.innerHTML = "";

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
        <span>Architecture</span><strong>${vm.arch}</strong>
        <span>RAM</span><strong>${vm.ram} MB</strong>
        <span>CPU</span><strong>${vm.cpus} vCPU</strong>
        <span>Disk</span><strong>${vm.disk} GB</strong>
      </div>

      <div class="vm-actions">
        <button data-action="toggle" data-id="${vm.id}">
          ${vm.running ? "Stop" : "Start"}
        </button>
        <button class="secondary" data-action="console" data-id="${vm.id}">
          Console
        </button>
      </div>
    `;

    vmGrid.appendChild(card);
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

vmGrid.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;

  const vm = vms.find(item => item.id === button.dataset.id);
  if (!vm) return;

  if (button.dataset.action === "toggle") {
    vm.running = !vm.running;
    render();
  }

  if (button.dataset.action === "console") {
    consoleTitle.textContent = `${vm.name} — Console`;
    consoleDialog.showModal();
  }
});

document.getElementById("newVmBtn").addEventListener("click", () => {
  vmDialog.showModal();
});

document.getElementById("cancelBtn").addEventListener("click", () => {
  vmDialog.close();
});

document.getElementById("closeConsole").addEventListener("click", () => {
  consoleDialog.close();
});

vmForm.addEventListener("submit", event => {
  event.preventDefault();

  vms.push({
    id: crypto.randomUUID(),
    name: document.getElementById("vmName").value,
    arch: document.getElementById("vmArch").value,
    ram: Number(document.getElementById("vmRam").value),
    cpus: Number(document.getElementById("vmCpu").value),
    disk: Number(document.getElementById("vmDisk").value),
    running: false
  });

  vmDialog.close();
  vmForm.reset();
  render();
});

render();
