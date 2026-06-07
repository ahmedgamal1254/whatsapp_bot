// Global state
let currentSessions = [];

// DOM Elements
const sessionsGrid = document.getElementById("sessions-grid");
const createSessionForm = document.getElementById("create-session-form");
const sendMessageForm = document.getElementById("send-message-form");
const selectSession = document.getElementById("select-session");
const btnCreateSession = document.getElementById("btn-create-session");
const btnSendMessage = document.getElementById("btn-send-message");
const statActiveCount = document.getElementById("stat-active-count");
const statTotalCount = document.getElementById("stat-total-count");

// Initialize application
document.addEventListener("DOMContentLoaded", () => {
  // Fetch initial session state and start polling
  fetchSessions();
  setInterval(fetchSessions, 2000);

  // Setup form submit handlers
  createSessionForm.addEventListener("submit", handleCreateSession);
  sendMessageForm.addEventListener("submit", handleSendMessage);

  // Initialize Lucide Icons
  lucide.createIcons();
});

// Fetch sessions from the API
async function fetchSessions() {
  try {
    const response = await fetch("/api/sessions");
    if (!response.ok) throw new Error("Failed to fetch sessions");
    const sessions = await response.json();
    
    // Update local state and UI
    updateSessionsUI(sessions);
  } catch (err) {
    console.error("Error fetching sessions:", err);
  }
}

// Update the entire UI based on session data
function updateSessionsUI(sessions) {
  currentSessions = sessions;

  // 1. Update header stats
  const activeCount = sessions.filter(s => s.status === "ready").length;
  statActiveCount.textContent = activeCount;
  statTotalCount.textContent = sessions.length;

  // 2. Update Sender Dropdown options
  const previouslySelected = selectSession.value;
  
  // Clear select options except the default first option
  selectSession.innerHTML = '<option value="" disabled selected>Select a session...</option>';
  
  const readySessions = sessions.filter(s => s.status === "ready");
  
  if (readySessions.length === 0) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "No active sessions connected";
    selectSession.appendChild(opt);
  } else {
    readySessions.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      selectSession.appendChild(opt);
    });
    
    // Restore selection if it still exists
    if (readySessions.some(s => s.id === previouslySelected)) {
      selectSession.value = previouslySelected;
    }
  }

  // 3. Render Session Grid
  if (sessions.length === 0) {
    sessionsGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="help-circle"></i>
        <h3>No WhatsApp Sessions</h3>
        <p>You haven't created any WhatsApp instances yet. Enter a session name on the right and click "Start Session" to begin.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Render cards
  let gridHtml = "";
  sessions.forEach(session => {
    gridHtml += createSessionCardHtml(session);
  });
  
  sessionsGrid.innerHTML = gridHtml;
  
  // Re-initialize icons inside new elements
  lucide.createIcons();
}

// Generate HTML string for a session card
function createSessionCardHtml(session) {
  let statusText = session.status;
  let bodyContent = "";
  
  // Customize status description
  if (session.status === "initializing") {
    statusText = "Initializing";
    bodyContent = `
      <div class="session-status-text">
        <div class="spinner"></div>
        <p>Launching browser...</p>
      </div>
    `;
  } else if (session.status === "qr") {
    statusText = "Scan QR";
    bodyContent = session.qr 
      ? `<img class="qr-code-img" src="${session.qr}" alt="Scan QR Code to Link Device">`
      : `<div class="session-status-text"><div class="spinner accent"></div><p>Generating QR Code...</p></div>`;
  } else if (session.status === "connecting") {
    statusText = "Connecting";
    bodyContent = `
      <div class="session-status-text">
        <div class="spinner accent"></div>
        <p>Logging into WhatsApp...</p>
      </div>
    `;
  } else if (session.status === "ready") {
    statusText = "Ready";
    bodyContent = `
      <div class="session-ready-state">
        <i data-lucide="check-circle-2"></i>
        <h4>Authenticated</h4>
        <p>Ready to route messages</p>
      </div>
    `;
  } else {
    // disconnected or error
    statusText = session.status || "Disconnected";
    const errorDetail = session.error ? `<div class="session-error-state">${session.error}</div>` : "";
    bodyContent = `
      <div class="session-status-text text-danger">
        <i data-lucide="alert-triangle" style="color: #ef4444; width: 36px; height: 36px;"></i>
        <p>Offline / Disconnected</p>
        ${errorDetail}
      </div>
    `;
  }

  return `
    <div class="session-card" id="card-${session.id}">
      <div class="session-card-header">
        <h4 title="${session.name}">${session.name}</h4>
        <span class="status-tag ${session.status}">${statusText}</span>
      </div>
      <div class="session-card-body">
        ${bodyContent}
      </div>
      <div class="session-card-footer">
        <button class="btn btn-danger-outline" onclick="handleDeleteSession('${session.id}', this)">
          <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i> Disconnect
        </button>
      </div>
    </div>
  `;
}

// Handle session creation
async function handleCreateSession(e) {
  e.preventDefault();
  const input = document.getElementById("session-name");
  const name = input.value.trim();
  if (!name) return;

  // Lock button
  btnCreateSession.disabled = true;
  btnCreateSession.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; margin: 0; border-width: 2px;"></div> Starting...';

  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Failed to create session");

    showToast("Session Initiated", `Session "${name}" is starting up.`, "success");
    input.value = "";
    
    // Refresh sessions grid immediately
    fetchSessions();
  } catch (err) {
    showToast("Creation Failed", err.message, "error");
  } finally {
    // Unlock button
    btnCreateSession.disabled = false;
    btnCreateSession.innerHTML = '<i data-lucide="power"></i> Start Session';
    lucide.createIcons();
  }
}

// Handle session deletion
async function handleDeleteSession(id, btnElement) {
  if (!confirm("Are you sure you want to disconnect and delete this session? This will log out of WhatsApp.")) {
    return;
  }

  const origContent = btnElement.innerHTML;
  btnElement.disabled = true;
  btnElement.innerHTML = '<div class="spinner" style="width: 12px; height: 12px; margin: 0; border-width: 2px;"></div>';

  try {
    const response = await fetch(`/api/sessions/${id}`, {
      method: "DELETE"
    });
    
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Failed to delete session");

    showToast("Session Removed", "Session was disconnected and deleted.", "success");
    
    // Refresh sessions grid immediately
    fetchSessions();
  } catch (err) {
    showToast("Delete Failed", err.message, "error");
    btnElement.disabled = false;
    btnElement.innerHTML = origContent;
  }
}

// Handle sending message
async function handleSendMessage(e) {
  e.preventDefault();
  
  const sessionId = selectSession.value;
  const phoneNumber = document.getElementById("phone-number").value.trim();
  const message = document.getElementById("message-content").value.trim();

  if (!sessionId || !phoneNumber || !message) {
    showToast("Validation Error", "Please fill in all fields.", "error");
    return;
  }

  // Lock button
  btnSendMessage.disabled = true;
  btnSendMessage.innerHTML = '<div class="spinner" style="width: 16px; height: 16px; margin: 0; border-width: 2px;"></div> Sending...';

  try {
    const response = await fetch("/api/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, phoneNumber, message })
    });
    
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Failed to send message");

    showToast("Message Sent", `Message successfully routed. ID: ${result.id.slice(0, 12)}...`, "success");
    
    // Clear message textbox, leave other fields as they are for ease of sending again
    document.getElementById("message-content").value = "";
  } catch (err) {
    showToast("Send Failed", err.message, "error");
  } finally {
    btnSendMessage.disabled = false;
    btnSendMessage.innerHTML = '<i data-lucide="send"></i> Send WhatsApp';
    lucide.createIcons();
  }
}

// Toast Notifications Helper
function showToast(title, message, type = "success") {
  const container = document.getElementById("toast-container");
  
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  const icon = type === "success" ? "check-circle" : "alert-circle";
  
  toast.innerHTML = `
    <i data-lucide="${icon}" style="flex-shrink: 0; width: 20px; height: 20px;"></i>
    <div class="toast-content">
      <h5>${title}</h5>
      <p>${message}</p>
    </div>
  `;
  
  container.appendChild(toast);
  lucide.createIcons();

  // Animate and remove toast
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards";
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}
