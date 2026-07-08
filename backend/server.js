import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./src/routes/auth.js";
import postRoutes from "./src/routes/posts.js";
import userRoutes from "./src/routes/users.js";
import messageRoutes from "./src/routes/messages.js";

import { authOptional } from "./src/middleware/auth.js";
import { addClient, removeClient } from "./src/realtime/hub.js";

dotenv.config();

const app = express();

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || "http://localhost:3000";

const corsCfg = {
  origin: FRONTEND_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsCfg));
app.options(/.*/, cors(corsCfg));

app.use(express.json());

// Make req.user available if JWT exists
app.use(authOptional);

/* ======================
   Server-Sent Events
====================== */
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (res.flushHeaders) {
    res.flushHeaders();
  }

  res.write(`event: connected\ndata: {}\n\n`);

  addClient(res);

  req.on("close", () => {
    removeClient(res);
  });
});

/* ======================
   Routes
====================== */

app.use("/auth", authRoutes);
app.use("/posts", postRoutes);
app.use("/users", userRoutes);
app.use("/messages", messageRoutes);

/* ======================
   Health Check
====================== */

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/* ======================
   Start Server
====================== */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
