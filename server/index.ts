import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./network/socketHandlers.js";
import { broadcastUpdate } from "./network/broadcast.js";
import { rooms, customImagesVersions, customEraImagesVersions, customBuffImagesVersions } from "./state/store.js";
import { handleActionTimeExpired } from "./state/actionTimeExpiry.js";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { assertAdminTokenConfigured, requireAdminToken } from "./config/adminAuth.js";
import {
  buildSessionExport,
  buildSessionWorkbook,
  safeExportBasename,
  contentDispositionAttachment,
} from "./export/sessionExport.js";
import { isAllowedBuffImageId } from "./util/buffImageIds.js";
import {
  getCommunityLeaderboard,
  initCommunityLeaderboardPersistence,
} from "./state/communityLeaderboard.js";

assertAdminTokenConfigured();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initCommunityLeaderboardPersistence(
  path.join(__dirname, "../data/community_leaderboard.json")
);

const app = express();
app.use(cors());

// --- File Upload Setup ---
const uploadDir = path.join(__dirname, "../data/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Populate customImagesVersions from existing files on startup
const existingFiles = fs.readdirSync(uploadDir);
for (const file of existingFiles) {
  if (file.endsWith(".jpg")) {
    const id = parseInt(file.replace(".jpg", ""));
    if (!isNaN(id)) {
      customImagesVersions[id] = Date.now();
    }
  }
}

const uploadErasDir = path.join(__dirname, "../data/uploads_eras");
if (!fs.existsSync(uploadErasDir)) {
  fs.mkdirSync(uploadErasDir, { recursive: true });
}

// Populate customEraImagesVersions
const existingEraFiles = fs.readdirSync(uploadErasDir);
for (const file of existingEraFiles) {
  if (file.endsWith(".jpg")) {
    const eraName = file.replace(".jpg", "");
    customEraImagesVersions[eraName] = Date.now();
  }
}

const uploadBuffsDir = path.join(__dirname, "../data/uploads_buffs");
if (!fs.existsSync(uploadBuffsDir)) {
  fs.mkdirSync(uploadBuffsDir, { recursive: true });
}
for (const file of fs.readdirSync(uploadBuffsDir)) {
  if (file.endsWith(".jpg")) {
    customBuffImagesVersions[file.replace(".jpg", "")] = Date.now();
  }
}

app.use("/uploads", express.static(uploadDir));
app.use("/uploads_eras", express.static(uploadErasDir));
app.use("/uploads_buffs", express.static(uploadBuffsDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // We expect the frontend to send the ID in the body
    cb(null, `${req.body.id}.jpg`);
  }
});
const upload = multer({ storage });

app.post("/api/upload-image", requireAdminToken, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing image file" });
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing id" });
  
  const numId = parseInt(id);
  if (!Number.isFinite(numId)) return res.status(400).json({ error: "Invalid id" });
  customImagesVersions[numId] = Date.now();
  
  // Notify all connected clients
  io.emit("syncProjectImages", customImagesVersions);
  
  res.json({ success: true, timestamp: customImagesVersions[numId] });
});

const storageEra = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadErasDir),
  filename: (req, file, cb) => {
    // Expect era name in body.id (e.g., '科技')
    cb(null, `${req.body.id}.jpg`);
  }
});
const uploadEra = multer({ storage: storageEra });

app.post("/api/upload-era-image", requireAdminToken, uploadEra.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing image file" });
  const { id } = req.body; // id is the era name
  if (!id) return res.status(400).json({ error: "Missing id" });
  
  customEraImagesVersions[id] = Date.now();
  
  io.emit("syncEraImages", customEraImagesVersions);
  
  res.json({ success: true, timestamp: customEraImagesVersions[id] });
});

const storageBuff = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadBuffsDir),
  filename: (req, _file, cb) => {
    cb(null, `${req.body.id}.jpg`);
  },
});
const uploadBuff = multer({ storage: storageBuff });

app.post("/api/upload-buff-image", requireAdminToken, uploadBuff.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing image file" });
  const { id } = req.body;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing id" });
  if (!isAllowedBuffImageId(id)) return res.status(400).json({ error: "Invalid buff card id" });

  customBuffImagesVersions[id] = Date.now();
  io.emit("syncBuffImages", customBuffImagesVersions);
  res.json({ success: true, timestamp: customBuffImagesVersions[id] });
});

app.post("/api/delete-buff-image", express.json(), requireAdminToken, (req, res) => {
  const { id } = req.body;
  if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing id" });
  if (!isAllowedBuffImageId(id)) return res.status(400).json({ error: "Invalid buff card id" });

  const filePath = path.join(uploadBuffsDir, `${id}.jpg`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  customBuffImagesVersions[id] = 0;
  io.emit("syncBuffImages", customBuffImagesVersions);
  res.json({ success: true, timestamp: 0 });
});

app.post("/api/delete-image", express.json(), requireAdminToken, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing id" });
  
  const numId = parseInt(id);
  const filePath = path.join(uploadDir, `${numId}.jpg`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  customImagesVersions[numId] = 0; // 0 means deleted
  io.emit("syncProjectImages", customImagesVersions);
  res.json({ success: true, timestamp: 0 });
});

app.post("/api/delete-era-image", express.json(), requireAdminToken, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing id" });
  
  const filePath = path.join(uploadErasDir, `${id}.jpg`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  customEraImagesVersions[id] = 0;
  io.emit("syncEraImages", customEraImagesVersions);
  res.json({ success: true, timestamp: 0 });
});
app.get("/api/community-leaderboard", (_req, res) => {
  res.json({ entries: getCommunityLeaderboard() });
});

app.get("/api/session-export", requireAdminToken, (req, res) => {
  const roomId = String(req.query.roomId ?? "").trim();
  const format = String(req.query.format ?? "json").toLowerCase();
  if (!roomId) {
    res.status(400).json({ error: "Missing roomId" });
    return;
  }
  const game = rooms[roomId];
  if (!game) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const base = safeExportBasename(roomId);
  const exportData = buildSessionExport(game);

  if (format === "xlsx") {
    const buf = buildSessionWorkbook(exportData);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", contentDispositionAttachment(`${base}_session.xlsx`));
    res.send(buf);
    return;
  }
  if (format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", contentDispositionAttachment(`${base}_session.json`));
    res.send(JSON.stringify(exportData, null, 2));
    return;
  }
  res.status(400).json({ error: "Invalid format (use json or xlsx)" });
});

// -----------------------

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = 3001;

io.on("connection", (socket) => {
  registerSocketHandlers(io, socket);
});

/**
 * 全局 Tick
 */
setInterval(() => {
  Object.values(rooms).forEach((game) => {
    if (handleActionTimeExpired(game)) {
      console.log(`⏰ Room ${game.roomId}: Discussion/investment time is up — auto-submitting drafts.`);
      broadcastUpdate(io, game);
    }
  });
}, 1000);

server.listen(PORT, () => {
  console.log(`✅ 光阴对赌新新新 Server running on port ${PORT}`);
});
