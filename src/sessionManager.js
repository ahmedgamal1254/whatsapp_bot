const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

// Determine the base directory for writing files
let DATA_DIR = process.env.DATA_DIR;

if (!DATA_DIR) {
  // Check if running on AWS Lambda, Vercel, or similar serverless environments where root directory is read-only
  if (process.env.LAMBDA_TASK_ROOT || process.cwd().startsWith("/var/task")) {
    DATA_DIR = "/tmp";
  } else {
    DATA_DIR = process.cwd();
  }
}

const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const AUTH_DIR_ROOT = path.join(DATA_DIR, ".wwebjs_auth");

class SessionManager {
  constructor() {
    this.sessions = {}; // In-memory session store: { [id]: { id, name, client, status, qr, error } }
  }

  /**
   * Initialize and load all saved sessions from sessions.json
   */
  async init() {
    console.log(`Initializing Session Manager (Data Dir: ${DATA_DIR})...`);
    let savedSessions = [];

    // Load from sessions.json
    if (fs.existsSync(SESSIONS_FILE)) {
      try {
        const data = fs.readFileSync(SESSIONS_FILE, "utf-8");
        savedSessions = JSON.parse(data);
      } catch (err) {
        console.error("Error reading sessions.json:", err);
      }
    }

    // Initialize each saved session
    for (const sessionData of savedSessions) {
      console.log(`Restoring session: ${sessionData.name} (${sessionData.id})`);
      this.createClient(sessionData.id, sessionData.name);
    }
  }

  /**
   * Save current sessions metadata to sessions.json
   */
  saveSessionsToDisk() {
    const list = Object.values(this.sessions).map((s) => ({
      id: s.id,
      name: s.name,
    }));
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2), "utf-8");
    } catch (err) {
      console.error("Failed to save sessions.json:", err);
    }
  }

  /**
   * Create a new Client instance and manage its lifecycle
   */
  createClient(id, name) {
    // Prevent duplicate initialization
    if (this.sessions[id] && this.sessions[id].client) {
      console.log(`Session ${id} is already initialized.`);
      return this.sessions[id];
    }

    // Configure Puppeteer options
    const puppeteerOpts = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    };

    // 1. Check for custom executable path in environment variables
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === "linux") {
      // 2. Auto-detect common Chromium/Chrome paths on Linux systems
      const commonLinuxPaths = [
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chrome"
      ];
      for (const p of commonLinuxPaths) {
        if (fs.existsSync(p)) {
          console.log(`Auto-detected system Chrome/Chromium binary at: ${p}`);
          puppeteerOpts.executablePath = p;
          break;
        }
      }
    }

    const client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: id,
        dataPath: AUTH_DIR_ROOT
      }),
      puppeteer: puppeteerOpts,
    });

    const sessionObj = {
      id,
      name,
      client,
      status: "initializing",
      qr: null,
      error: null,
    };

    this.sessions[id] = sessionObj;

    // Listeners
    client.on("qr", async (qr) => {
      console.log(`QR Code generated for session: ${name}`);
      try {
        const qrDataUrl = await QRCode.toDataURL(qr);
        sessionObj.qr = qrDataUrl;
        sessionObj.status = "qr";
      } catch (err) {
        console.error(`Failed to generate QR Data URL for session ${name}:`, err);
        sessionObj.status = "error";
        sessionObj.error = "Failed to render QR Code";
      }
    });

    client.on("ready", () => {
      console.log(`WhatsApp client ready for session: ${name}`);
      sessionObj.status = "ready";
      sessionObj.qr = null;
      sessionObj.error = null;
    });

    client.on("authenticated", () => {
      console.log(`Session ${name} authenticated`);
      sessionObj.status = "connecting";
      sessionObj.qr = null;
    });

    client.on("auth_failure", (msg) => {
      console.error(`Auth failure for session ${name}:`, msg);
      sessionObj.status = "disconnected";
      sessionObj.error = "Authentication failed. Please scan QR again.";
      sessionObj.qr = null;
    });

    client.on("disconnected", (reason) => {
      console.log(`Client disconnected for session ${name}. Reason:`, reason);
      sessionObj.status = "disconnected";
      sessionObj.qr = null;
    });

    // Handle initialization promise
    client.initialize().catch((err) => {
      console.error(`Error initializing client for ${name}:`, err);
      sessionObj.status = "disconnected";
      sessionObj.error = `Failed to start: ${err.message}`;
    });

    return sessionObj;
  }

  /**
   * Create a new session dynamically
   */
  async createSession(name) {
    const id = "session_" + Date.now();
    const session = this.createClient(id, name);
    this.saveSessionsToDisk();
    return session;
  }

  /**
   * Delete and clean up a session
   */
  async deleteSession(id) {
    const session = this.sessions[id];
    if (!session) {
      throw new Error(`Session ${id} not found.`);
    }

    console.log(`Deleting session: ${session.name} (${id})`);

    // Destroy client instance
    if (session.client) {
      try {
        await session.client.destroy();
      } catch (err) {
        console.error(`Error destroying client for session ${id}:`, err);
      }
    }

    // Delete in-memory references
    delete this.sessions[id];

    // Save configuration change
    this.saveSessionsToDisk();

    // Delete Auth Folder from disk
    const sessionAuthDir = path.join(AUTH_DIR_ROOT, `session-${id}`);
    if (fs.existsSync(sessionAuthDir)) {
      try {
        fs.rmSync(sessionAuthDir, { recursive: true, force: true });
        console.log(`Deleted auth directory: ${sessionAuthDir}`);
      } catch (err) {
        console.error(`Failed to delete auth directory ${sessionAuthDir}:`, err);
      }
    }
  }

  /**
   * Retrieve active sessions metadata (for public API)
   */
  getSessions() {
    return Object.values(this.sessions).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      qr: s.qr,
      error: s.error,
    }));
  }

  /**
   * Route send message requests to specific session
   */
  async sendMessage(id, phoneNumber, message) {
    const session = this.sessions[id];
    if (!session) {
      throw new Error("Session not found or inactive.");
    }
    if (session.status !== "ready") {
      throw new Error("WhatsApp client for this session is not ready.");
    }

    const normalized = phoneNumber.replace(/\D/g, "");
    const chatId = `${normalized}@c.us`;

    const result = await session.client.sendMessage(chatId, message);
    return {
      id: result.id?._serialized,
      timestamp: result.timestamp,
      to: chatId,
    };
  }
}

module.exports = new SessionManager();
