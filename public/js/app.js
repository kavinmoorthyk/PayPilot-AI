
const API = {
  health: "/api/health",
  invoices: "/api/invoices",
  transactions: "/api/transactions",
  chat: "/api/ai/chat"
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  connection: $("#connection-status"),
  pageTitle: $("#page-title"),
  invoiceModal: $("#invoice-modal"),
  invoiceForm: $("#invoice-form"),
  invoiceError: $("#invoice-error"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),
  chatMessages: $("#chat-messages"),
  sendChat: $("#send-chat"),
  toast: $("#toast")
};

let toastTimer;
let allInvoices = [];

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 3200);
}

const pageNames = {
  overview: "Overview",
  invoices: "Invoices",
  transactions: "Transactions",
  assistant: "AI assistant"
};

function openPage(page) {
  if (!pageNames[page]) return;

  document.querySelectorAll(".page").forEach(section => {
    section.classList.remove("active");
  });

  document.querySelectorAll(".nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  const target = $(`#page-${page}`);

  if (target) target.classList.add("active");

  elements.pageTitle.textContent = pageNames[page];

  $("#sidebar").classList.remove("open");

  if (page === "overview" || page === "invoices") {
    loadInvoices();
  }

  if (page === "transactions") {
    loadTransactions();
  }
}

document.querySelectorAll("[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    openPage(button.dataset.page);
  });
});

$("#menu-toggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

async function checkServer() {
  try {
    const data = await apiRequest(API.health);
    const online = data.status === "Online";

    elements.connection.innerHTML =
      `<span class="pulse-dot"></span> ${online ? "Server online" : "Server unavailable"}`;

    elements.connection.style.color = online ? "#a3b0c9" : "#ff9999";

    return data;

  } catch (error) {
    elements.connection.textContent = "● Server offline";
    elements.connection.style.color = "#ff9999";

    console.error("Health check failed:", error);

    return null;
  }
}

function formatAmount(amount, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(amount) || 0);

  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

function formatDate(date) {
  if (!date) return "—";

  const parsed = new Date(
    date.includes("T") ? date : date.replace(" ", "T") + "Z"
  );

  if (Number.isNaN(parsed.getTime())) return date;

  return parsed.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function statusBadge(status) {
  const normalized = String(status || "PENDING").toLowerCase();

  const safe = ["paid", "pending", "cancelled"].includes(normalized)
    ? normalized
    : "pending";

  return `<span class="status-badge ${safe}">${escapeHTML(status || "PENDING")}</span>`;
}

// --------------------------------------------------
// INVOICE TABLE
// --------------------------------------------------

function createInvoiceTable(invoices, compact = false) {
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return `
      <div class="empty-state">
        No invoices yet. Create your first invoice to get started.
      </div>
    `;
  }

  const visible = compact ? invoices.slice(0, 5) : invoices;

  const rows = visible.map(invoice => {
    const id = escapeHTML(invoice.id || "");
    const status = String(invoice.status || "PENDING").toUpperCase();

    return `
      <tr>
        <td>${escapeHTML(String(invoice.id || "").slice(0, 17))}</td>

        <td>${escapeHTML(invoice.customer || "")}</td>

        <td>${escapeHTML(invoice.description || "")}</td>

        <td>${formatAmount(invoice.amount, invoice.currency)}</td>

        <td>
          ${
            compact
              ? statusBadge(status)
              : `
                <select
                  class="invoice-status-select"
                  data-id="${id}"
                >
                  <option value="PENDING" ${status === "PENDING" ? "selected" : ""}>
                    Pending
                  </option>

                  <option value="PAID" ${status === "PAID" ? "selected" : ""}>
                    Paid
                  </option>

                  <option value="CANCELLED" ${status === "CANCELLED" ? "selected" : ""}>
                    Cancelled
                  </option>
                </select>
              `
          }
        </td>

        <td>${formatDate(invoice.created_at)}</td>

        ${
          compact
            ? ""
            : `
              <td>
                ${
                  invoice.receipt_filename
                    ? `
                      <a
                        href="${API.invoices}/${encodeURIComponent(invoice.id)}/receipt"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View Receipt
                      </a>
                    `
                    : ""
                }

                <button
                  type="button"
                  class="delete-invoice-button"
                  data-id="${id}"
                >
                  Delete
                </button>
              </td>
            `
        }
      </tr>
    `;
  }).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>INVOICE ID</th>
          <th>CUSTOMER</th>
          <th>DESCRIPTION</th>
          <th>AMOUNT</th>
          <th>STATUS</th>
          <th>DATE</th>
          ${compact ? "" : "<th>ACTIONS</th>"}
        </tr>
      </thead>

      <tbody>${rows}</tbody>
    </table>
  `;
}

// --------------------------------------------------
// DASHBOARD ANIMATIONS
// --------------------------------------------------

function animateNumber(element, target, prefix = "", decimals = 0) {
  if (!element) return;

  const start = performance.now();
  const duration = 650;
  const from = 0;

  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + (target - from) * eased;

    element.textContent = prefix + value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  };

  requestAnimationFrame(tick);
}

// --------------------------------------------------
// INVOICE DISPLAY AND FILTERING
// --------------------------------------------------

function renderInvoiceLists() {
  const overview = $("#overview-invoices");
  const list = $("#invoices-list");

  if (overview) {
    overview.innerHTML = createInvoiceTable(allInvoices, true);
  }

  if (list) {
    renderFilteredInvoices();
  }
}

function renderFilteredInvoices() {
  const search = ($("#invoice-search")?.value || "").trim().toLowerCase();
  const filter = ($("#invoice-filter")?.value || "all").toLowerCase();

  const filtered = allInvoices.filter(invoice => {
    const searchable = [
      invoice.id,
      invoice.customer,
      invoice.description,
      invoice.status
    ].join(" ").toLowerCase();

    const statusMatch =
      filter === "all" ||
      String(invoice.status || "pending").toLowerCase() === filter;

    return searchable.includes(search) && statusMatch;
  });

  $("#invoices-list").innerHTML = createInvoiceTable(filtered);
}

async function loadInvoices() {
  const overview = $("#overview-invoices");
  const list = $("#invoices-list");

  try {
    const data = await apiRequest(API.invoices);

    allInvoices = Array.isArray(data.invoices)
      ? data.invoices
      : [];

    const total = allInvoices.reduce(
      (sum, invoice) => sum + (Number(invoice.amount) || 0),
      0
    );

    animateNumber(
      $("#total-invoices"),
      data.count ?? allInvoices.length
    );

    animateNumber(
      $("#total-value"),
      total,
      "$",
      2
    );

    renderInvoiceLists();

    $("#last-updated").textContent =
      `Updated ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })}`;

  } catch (error) {
    console.error("Invoice loading error:", error);

    $("#total-invoices").textContent = "—";
    $("#total-value").textContent = "—";

    const message = `
      <div class="empty-state">
        Unable to load invoices. ${escapeHTML(error.message)}
      </div>
    `;

    if (overview) overview.innerHTML = message;
    if (list) list.innerHTML = message;
  }
}

$("#invoice-search").addEventListener("input", renderFilteredInvoices);
$("#invoice-filter").addEventListener("change", renderFilteredInvoices);

const invoiceList = $("#invoices-list");

// --------------------------------------------------
// RECEIPT UPLOAD
// --------------------------------------------------

async function uploadReceipt(invoiceId, file) {
  if (file.size > 5 * 1024 * 1024) {
    showToast("Receipt must be smaller than 5 MB.", true);
    await loadInvoices();
    return;
  }

  const allowedTypes = [
    "application/pdf",
    "image/jpeg",
    "image/png"
  ];

  if (!allowedTypes.includes(file.type)) {
    showToast("Only PDF, JPG and PNG files are allowed.", true);
    await loadInvoices();
    return;
  }

  const formData = new FormData();

  formData.append("receipt", file);

  try {
    // Do not manually set Content-Type for FormData.
    const response = await fetch(
      `${API.invoices}/${encodeURIComponent(invoiceId)}/receipt`,
      {
        method: "POST",
        body: formData
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      throw new Error("The server returned an invalid response.");
    }

    if (!response.ok || data.success === false) {
      throw new Error(data.message || "Receipt upload failed.");
    }

    showToast(data.message || "Receipt uploaded successfully.");

    await loadInvoices();

  } catch (error) {
    showToast(error.message, true);
    await loadInvoices();
  }
}

// --------------------------------------------------
// DELETE INVOICE
// --------------------------------------------------

invoiceList.addEventListener("click", async event => {
  const button = event.target.closest(".delete-invoice-button");

  if (!button) return;

  const invoiceId = button.dataset.id;

  if (!confirm("Are you sure you want to delete this invoice?")) {
    return;
  }

  button.disabled = true;
  button.textContent = "Deleting...";

  try {
    const result = await apiRequest(
      `${API.invoices}/${encodeURIComponent(invoiceId)}`,
      {
        method: "DELETE"
      }
    );

    showToast(result.message || "Invoice deleted successfully.");

    await loadInvoices();

  } catch (error) {
    showToast(error.message, true);

    button.disabled = false;
    button.textContent = "Delete";
  }
});

// --------------------------------------------------
// UPDATE STATUS AND UPLOAD RECEIPT
// --------------------------------------------------

invoiceList.addEventListener("change", async event => {
  const select = event.target.closest(".invoice-status-select");

  if (!select) return;

  const invoiceId = select.dataset.id;
  const newStatus = select.value;

  // PAID requires a receipt upload.
  if (newStatus === "PAID") {
    const confirmed = confirm(
      "Select a payment receipt to mark this invoice as PAID."
    );

    if (!confirmed) {
      await loadInvoices();
      return;
    }

    const fileInput = document.createElement("input");

    fileInput.type = "file";
    fileInput.accept = ".pdf,.jpg,.jpeg,.png";
    fileInput.style.display = "none";

    document.body.appendChild(fileInput);

    select.disabled = true;

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];

      if (!file) {
        fileInput.remove();
        await loadInvoices();
        return;
      }

      fileInput.remove();

      await uploadReceipt(invoiceId, file);
    });

    fileInput.addEventListener("cancel", async () => {
      fileInput.remove();
      await loadInvoices();
    }, { once: true });

    fileInput.click();

    return;
  }

  // PENDING and CANCELLED use the status API.
  select.disabled = true;

  try {
    const result = await apiRequest(
      `${API.invoices}/${encodeURIComponent(invoiceId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: newStatus
        })
      }
    );

    showToast(result.message || "Invoice status updated.");

    await loadInvoices();

  } catch (error) {
    showToast(error.message, true);

    await loadInvoices();
  }
});

// --------------------------------------------------
// INVOICE MODAL
// --------------------------------------------------

function openInvoiceModal() {
  elements.invoiceModal.classList.add("open");

  elements.invoiceModal.setAttribute("aria-hidden", "false");

  elements.invoiceError.textContent = "";

  setTimeout(() => {
    $("#customer-name").focus();
  }, 80);
}

function closeInvoiceModal() {
  elements.invoiceModal.classList.remove("open");

  elements.invoiceModal.setAttribute("aria-hidden", "true");
}

$("#create-invoice-button").addEventListener("click", openInvoiceModal);
$("#quick-create-invoice").addEventListener("click", openInvoiceModal);
$("#close-modal").addEventListener("click", closeInvoiceModal);
$("#cancel-modal").addEventListener("click", closeInvoiceModal);

elements.invoiceModal.addEventListener("click", event => {
  if (event.target === elements.invoiceModal) {
    closeInvoiceModal();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeInvoiceModal();
  }
});

// --------------------------------------------------
// CREATE INVOICE
// --------------------------------------------------

elements.invoiceForm.addEventListener("submit", async event => {
  event.preventDefault();

  const saveButton = $("#save-invoice");

  const customer = $("#customer-name").value.trim();
  const description = $("#invoice-description").value.trim();
  const amount = Number($("#invoice-amount").value);

  elements.invoiceError.textContent = "";

  if (!customer || !description) {
    elements.invoiceError.textContent = "Please complete all fields.";
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
    elements.invoiceError.textContent =
      "Amount must be greater than 0 and no more than $10,000.";

    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    const data = await apiRequest(API.invoices, {
      method: "POST",

      body: JSON.stringify({
        customer,
        description,
        amount,
        currency: "USD"
      })
    });

    elements.invoiceForm.reset();

    closeInvoiceModal();

    await loadInvoices();

    showToast(data.message || "Invoice saved successfully.");

  } catch (error) {
    elements.invoiceError.textContent = error.message;

  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = 'Save invoice <span>↗</span>';
  }
});

// --------------------------------------------------
// TRANSACTIONS
// --------------------------------------------------

async function loadTransactions() {
  const container = $("#transactions-list");

  $("#total-transactions").textContent = "—";

  container.innerHTML = `
    <div class="loading-state">
      <span class="loader"></span>
      Checking transaction records...
    </div>
  `;

  try {
    const data = await apiRequest(API.transactions);

    const transactions = Array.isArray(data.transactions)
      ? data.transactions
      : [];

    $("#total-transactions").textContent =
      data.count ?? transactions.length;

    if (!transactions.length) {
      container.innerHTML = `
        <div class="empty-state">
          No confirmed transactions have been recorded yet.
        </div>
      `;

      return;
    }

    const rows = transactions.map(transaction => `
      <tr>
        <td>${escapeHTML(String(transaction.id || "").slice(0, 18))}</td>

        <td>${escapeHTML(transaction.description || "")}</td>

        <td>${formatAmount(transaction.amount, transaction.currency)}</td>

        <td>${statusBadge(transaction.status)}</td>

        <td>${formatDate(transaction.created_at)}</td>
      </tr>
    `).join("");

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>TRANSACTION ID</th>
            <th>DESCRIPTION</th>
            <th>AMOUNT</th>
            <th>STATUS</th>
            <th>DATE</th>
          </tr>
        </thead>

        <tbody>${rows}</tbody>
      </table>
    `;

  } catch (error) {
    console.info("Transaction endpoint unavailable:", error.message);

    container.innerHTML = `
      <div class="empty-state">
        Transaction records are not connected yet.

        <br><br>

        The current backend does not expose a transactions API.
        PayPal order creation and capture must be completed before
        confirmed payments can appear here.
      </div>
    `;
  }
}

// --------------------------------------------------
// AI CHAT
// --------------------------------------------------

function addChatMessage(role, message) {
  const messageElement = document.createElement("div");

  messageElement.className = `message ${role}`;

  const label = document.createElement("span");

  label.className = "message-label";

  label.textContent = role === "user" ? "YOU" : "PAYPILOT AI";

  const content = document.createElement("div");

  content.textContent = message;

  messageElement.append(label, content);

  elements.chatMessages.appendChild(messageElement);

  elements.chatMessages.scrollTop =
    elements.chatMessages.scrollHeight;
}

function addTypingIndicator() {
  const node = document.createElement("div");

  node.className = "message assistant";

  node.innerHTML = `
    <span class="message-label">PAYPILOT AI</span>

    <div class="typing-dots">
      <span></span>
      <span></span>
      <span></span>
    </div>
  `;

  elements.chatMessages.appendChild(node);

  elements.chatMessages.scrollTop =
    elements.chatMessages.scrollHeight;

  return node;
}

async function sendAIMessage(message) {
  addChatMessage("user", message);

  elements.chatInput.value = "";

  elements.sendChat.disabled = true;

  const loading = addTypingIndicator();

  try {
    const data = await apiRequest(API.chat, {
      method: "POST",

      body: JSON.stringify({
        message
      })
    });

    loading.remove();

    addChatMessage(
      "assistant",
      data.message || "I couldn't generate a response."
    );

  } catch (error) {
    loading.remove();

    addChatMessage(
      "assistant",
      `I couldn't process that request. ${error.message}`
    );

  } finally {
    elements.sendChat.disabled = false;
    elements.chatInput.focus();
  }
}

elements.chatForm.addEventListener("submit", async event => {
  event.preventDefault();

  const message = elements.chatInput.value.trim();

  if (message && !elements.sendChat.disabled) {
    await sendAIMessage(message);
  }
});

document.querySelectorAll("[data-prompt]").forEach(button => {
  button.addEventListener("click", async () => {
    const prompt = button.dataset.prompt;

    if (prompt && !elements.sendChat.disabled) {
      await sendAIMessage(prompt);
    }
  });
});

// --------------------------------------------------
// REFRESH DASHBOARD
// --------------------------------------------------

async function refreshDashboard() {
  await checkServer();

  await loadInvoices();

  showToast("Workspace data refreshed.");
}

$("#refresh-data").addEventListener("click", refreshDashboard);

// --------------------------------------------------
// INITIALIZE APPLICATION
// --------------------------------------------------

async function initializeApp() {
  console.log("PayPilot AI frontend starting...");

  await checkServer();

  await loadInvoices();

  console.log("PayPilot AI frontend initialized.");
}

initializeApp();
