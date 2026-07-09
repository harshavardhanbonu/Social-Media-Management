import express from "express";
import { createId } from "@paralleldrive/cuid2";
import { authRequired } from "../middleware/auth.js";
import { broadcast } from "../realtime/hub.js";
import pool from "../../database/db.js";
import { formatMessageTime } from "../utils/date.js"; // Assuming your utility is here

const router = express.Router();

// GET /messages/conversations
router.get("/conversations", authRequired, async (req, res) => {
  const me = req.user.id;
  try {
    // INNER JOIN since foreign keys guarantee both sender and receiver exist
    const [rows] = await pool.execute(
      `SELECT 
        m.message_id, 
        m.content, 
        m.media_url, 
        m.post_id, 
        m.sent_at, 
        m.sender_id, 
        m.receiver_id,
        sender.user_id AS sender_id_ref, 
        sender.user_name AS sender_username, 
        sender.avatar_url AS sender_avatar,
        receiver.user_id AS receiver_id_ref, 
        receiver.user_name AS receiver_username, 
        receiver.avatar_url AS receiver_avatar
      FROM message m
      INNER JOIN user sender ON m.sender_id = sender.user_id
      INNER JOIN user receiver ON m.receiver_id = receiver.user_id
      WHERE m.sender_id = ? OR m.receiver_id = ?
      ORDER BY m.sent_at DESC`,
      [me, me]
    );

    const byPartner = new Map();

    for (const m of rows) {
      const isMeSender = m.sender_id === me;
      
      const partnerId = isMeSender ? m.receiver_id_ref : m.sender_id_ref;
      const partnerUsername = isMeSender ? m.receiver_username : m.sender_username;
      const partnerAvatar = isMeSender ? m.receiver_avatar : m.sender_avatar;

      if (byPartner.has(partnerId)) continue;

      byPartner.set(partnerId, {
        partnerId: partnerId,
        username: partnerUsername,
        avatarUrl: partnerAvatar,
        lastMessage:
          m.content ||
          (m.post_id ? "Shared a post" : m.media_url ? "Sent media" : ""),
        sentAt: m.sent_at,
      });
    }

    res.status(200).json(Array.from(byPartner.values()));
  } catch (err) {
    console.error("[Messages - Conversations] Error:", err);
    res.status(500).json({ message: "Failed to load conversations" });
  }
});

// GET /messages/with/:partnerId
router.get("/with/:partnerId", authRequired, async (req, res) => {
  const me = req.user.id;
  const partnerId = req.params.partnerId;
  try {
    const [rows] = await pool.execute(
      `SELECT 
        message_id AS id, 
        content, 
        media_url AS mediaUrl, 
        post_id AS postId, 
        sender_id AS senderId, 
        sent_at AS sentAt
      FROM message
      WHERE (sender_id = ? AND receiver_id = ?)
         OR (sender_id = ? AND receiver_id = ?)
      ORDER BY sent_at ASC`,
      [me, partnerId, partnerId, me]
    );

    const mapped = rows.map((m) => ({
      id: m.id,
      text:
        m.content ||
        (m.postId ? "Shared a post" : m.mediaUrl ? "Sent media" : ""),
      sender: m.senderId === me ? "me" : "other",
      timestamp: formatMessageTime(m.sentAt), // Original frontend formatting preserved
    }));

    res.status(200).json(mapped);
  } catch (err) {
    console.error("[Messages - Thread] Error:", err);
    res.status(500).json({ message: "Failed to load messages" });
  }
});

// POST /messages/send
// body: { to, content?, mediaUrl?, postId? }
router.post("/send", authRequired, async (req, res) => {
  const me = req.user.id;
  const { to, content, mediaUrl, postId } = req.body || {};

  if (!to) return res.status(400).json({ message: "Missing 'to'" });
  if (!content && !mediaUrl && !postId) {
    return res.status(400).json({ message: "Message is empty" });
  }

  try {
    // 1. Verify both sender and receiver exist using a single IN query
    const [users] = await pool.execute(
      `SELECT 
        user_id AS id, 
        user_name AS username, 
        avatar_url AS avatarUrl 
      FROM user 
      WHERE user_id IN (?, ?)`,
      [me, to]
    );

    const fromUser = users.find((u) => u.id === me);
    const toUser = users.find((u) => u.id === to);

    if (!fromUser) return res.status(404).json({ message: "Sender not found" });
    if (!toUser) return res.status(404).json({ message: "Receiver not found" });

    // 2. Generate new ID
    const newMsgId = createId();

    // 3. Insert new message (letting MySQL handle sent_at generation)
    await pool.execute(
      `INSERT INTO message (
        message_id, 
        sender_id, 
        receiver_id, 
        content, 
        media_url, 
        post_id
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        newMsgId,
        me,
        to,
        content ?? null,
        mediaUrl ?? null,
        postId ?? null,
      ]
    );

    // 4. Retrieve the newly inserted row to trust the DB state (sent_at)
    const [insertedRows] = await pool.execute(
      `SELECT 
        message_id AS id, 
        content, 
        media_url AS mediaUrl, 
        post_id AS postId, 
        sent_at AS sentAt 
      FROM message 
      WHERE message_id = ? 
      LIMIT 1`,
      [newMsgId]
    );

    const dbMsg = insertedRows[0];
    if (!dbMsg) throw new Error("Failed to retrieve inserted message");

    // 5. Broadcast to realtime hub using trusted DB data
    broadcast("message_new", {
      id: dbMsg.id,
      content: dbMsg.content,
      mediaUrl: dbMsg.mediaUrl,
      postId: dbMsg.postId,
      fromUserId: fromUser.id,
      toUserId: toUser.id,
      fromUsername: fromUser.username,
      toUsername: toUser.username,
      fromAvatarUrl: fromUser.avatarUrl,
      toAvatarUrl: toUser.avatarUrl,
      sentAt: dbMsg.sentAt,
    });

    // 6. Return preserved frontend response format
    res.status(201).json({
      id: dbMsg.id,
      content: dbMsg.content,
      sentAt: dbMsg.sentAt,
      to: toUser.id,
    });
  } catch (err) {
    console.error("[Messages - Send] Error:", err);
    res.status(500).json({ message: "Send failed" });
  }
});

export default router;
