import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./network/socketHandlers.js";
import { broadcastUpdate } from "./network/broadcast.js";
import { rooms, customImagesVersions } from "./state/store.js";
import { tryAdvancePhase } from "./state/phaseController.js";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // We expect the frontend to send the ID in the body
    cb(null, `${req.body.id}.jpg`);
  }
});
const upload = multer({ storage });

app.post("/api/upload-image", upload.single("image"), (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "Missing id" });
  
  const numId = parseInt(id);
  customImagesVersions[numId] = Date.now();
  
  // Notify all connected clients
  io.emit("syncProjectImages", customImagesVersions);
  
  res.json({ success: true, timestamp: customImagesVersions[numId] });
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
    if (
      game.phase === "INVESTMENT" &&
      game.investmentEndsAt &&
      Date.now() >= game.investmentEndsAt
    ) {
      console.log(`⏰ Room ${game.roomId}: Investment time is up! Force submitting.`);
      game.players.forEach(p => {
        p.ready = true;
        game.readyPlayers.add(p.id);
      });
      game.investmentEndsAt = undefined;
      tryAdvancePhase(game);
      broadcastUpdate(io, game);
    }
  });
}, 1000);

server.listen(PORT, () => {
  console.log(`✅ 光阴对赌新新新 Server running on port ${PORT}`);
});
