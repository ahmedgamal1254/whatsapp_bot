const express = require("express");
const path = require("path");
const sessionManager = require("./sessionManager");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, "../public")));

// --- REST API FOR GUI DASHBOARD ---

// GET /api/sessions - Get metadata for all active sessions
app.get("/api/sessions", (req, res) => {
  res.json(sessionManager.getSessions());
});

// POST /api/sessions - Create a new session instance
app.post("/api/sessions", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Session name is required" });
    }
    const session = await sessionManager.createSession(name);
    res.status(201).json({
      success: true,
      id: session.id,
      name: session.name,
      status: session.status,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sessions/:id - Disconnect and delete a session
app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await sessionManager.deleteSession(id);
    res.json({ success: true, message: `Session ${id} deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/send-message - Send a message from a specific session
app.post("/api/send-message", async (req, res) => {
  try {
    const { sessionId, phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({ error: "phoneNumber and message are required" });
    }

    let targetSessionId = sessionId;

    // Backward compatibility: If no sessionId is provided, use the first ready session
    if (!targetSessionId) {
      const readySessions = sessionManager.getSessions().filter((s) => s.status === "ready");
      if (readySessions.length === 0) {
        return res.status(503).json({ error: "No ready WhatsApp session available" });
      }
      targetSessionId = readySessions[0].id;
    }

    const result = await sessionManager.sendMessage(targetSessionId, phoneNumber, message);
    res.json({
      success: true,
      id: result.id,
      timestamp: result.timestamp,
      to: result.to,
      senderSessionId: targetSessionId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BACKWARD COMPATIBLE LEGACY ENDPOINTS ---

// GET /health - Simple health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// GET /session-status - Checks if at least one session is ready (legacy behavior)
app.get("/session-status", (req, res) => {
  const readySessions = sessionManager.getSessions().filter((s) => s.status === "ready");
  res.json({ ready: readySessions.length > 0 });
});

// POST /send-message - Send message using default (first ready) session (legacy behavior)
app.post("/send-message", async (req, res) => {
  // Directly forward to the unified send-message handler logic
  try {
    const { phoneNumber, message, sessionId } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({ error: "phoneNumber and message are required" });
    }

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const readySessions = sessionManager.getSessions().filter((s) => s.status === "ready");
      if (readySessions.length === 0) {
        return res.status(503).json({ error: "WhatsApp client not ready" });
      }
      targetSessionId = readySessions[0].id;
    }

    const result = await sessionManager.sendMessage(targetSessionId, phoneNumber, message);
    res.json({
      success: true,
      id: result.id,
      timestamp: result.timestamp,
      to: result.to,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to send message" });
  }
});

// --- SERVER INIT ---

app.listen(port, async () => {
  console.log(`Server is running on port ${port}`);
  
  // Initialize and reload saved sessions
  try {
    await sessionManager.init();
  } catch (err) {
    console.error("Error during session manager initialization:", err);
  }
});
