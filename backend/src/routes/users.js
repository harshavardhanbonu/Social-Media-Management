import express from "express";
import { createId } from "@paralleldrive/cuid2";
import { authRequired } from "../middleware/auth.js";
import pool from "../../database/db.js";

const router = express.Router();

// --- Helper Functions ---

// Pass the active connection (db) to maintain transaction isolation
async function isEitherBlocked(aId, bId, db = pool) {
  if (!aId || !bId) return false;
  const [rows] = await db.execute(
    `SELECT 1 FROM blocks 
     WHERE (blockerId = ? AND blockedId = ?) 
        OR (blockerId = ? AND blockedId = ?) LIMIT 1`,
    [aId, bId, bId, aId]
  );
  return rows.length > 0;
}

// Pass the active connection (db) to future-proof against nested transaction calls
async function checkPrivateAccess(viewerId, targetId, res, db = pool) {
  const [rows] = await db.execute(
    `SELECT account_type AS accountType FROM user WHERE user_id = ? LIMIT 1`,
    [targetId]
  );
  if (rows.length === 0) {
    res.status(404).json({ message: "User not found" });
    return false;
  }
  const target = rows[0];
  
  if (target.accountType === "PRIVATE" && viewerId !== targetId) {
    const [follows] = await db.execute(
      `SELECT 1 FROM follows WHERE followerId = ? AND followingId = ? LIMIT 1`,
      [viewerId || "", targetId]
    );
    if (follows.length === 0) {
      res.status(403).json({ message: "Private account" });
      return false;
    }
  }
  return true;
}

const handleUnfollow = async (req, res) => {
  const me = req.user.id;
  const targetId = req.params.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [delFollow] = await connection.execute(
      `DELETE FROM follows WHERE followerId = ? AND followingId = ?`,
      [me, targetId]
    );

    await connection.execute(
      `DELETE FROM followrequest WHERE requester_id = ? AND target_id = ? AND status = 'PENDING'`,
      [me, targetId]
    );

    if (delFollow.affectedRows > 0) {
      await connection.execute(`UPDATE user SET following_cnt = GREATEST(0, following_cnt - 1) WHERE user_id = ?`, [me]);
      await connection.execute(`UPDATE user SET follower_cnt = GREATEST(0, follower_cnt - 1) WHERE user_id = ?`, [targetId]);
    }

    await connection.commit();
    return res.json({ status: "UNFOLLOWED" });
  } catch (err) {
    await connection.rollback();
    console.error("Unfollow failed:", err);
    res.status(500).json({ message: "Unfollow failed" });
  } finally {
    connection.release();
  }
};

// --- Routes ---

/**
 * GET /users/by-username/:username
 */
router.get("/by-username/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const viewerId = req.user?.id || null;

    const [uRows] = await pool.execute(
      `SELECT 
        user_id AS id, user_name AS username, name, bio, avatar_url AS avatarUrl, 
        account_type AS accountType, follower_cnt AS followerCount, 
        following_cnt AS followingCount, post_cnt AS postCount 
       FROM user WHERE user_name = ? LIMIT 1`,
      [username]
    );

    if (uRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const u = uRows[0];
    const isSelf = viewerId === u.id;

    if (viewerId && !isSelf) {
      if (await isEitherBlocked(viewerId, u.id)) {
        return res.status(404).json({ message: "User not found" });
      }
    }

    let followStatus = "NONE";

    if (viewerId && !isSelf) {
      const [fRows] = await pool.execute(
        `SELECT 1 FROM follows WHERE followerId = ? AND followingId = ? LIMIT 1`,
        [viewerId, u.id]
      );
      
      if (fRows.length > 0) {
        followStatus = "FOLLOWING";
      } else {
        const [frRows] = await pool.execute(
          `SELECT status FROM followrequest WHERE requester_id = ? AND target_id = ? LIMIT 1`,
          [viewerId, u.id]
        );
        if (frRows.length > 0 && frRows[0].status === "PENDING") {
          followStatus = "REQUESTED";
        }
      }
    }

    const isPrivate = u.accountType === "PRIVATE";
    const canViewPosts = !isPrivate || isSelf || followStatus === "FOLLOWING";
    
    let postsList = [];
    if (canViewPosts) {
      const [pRows] = await pool.execute(
        `SELECT post_id AS id, caption, media_url AS mediaUrl, post_type AS postType, posted_at AS postedAt 
         FROM post 
         WHERE user_id = ? AND is_hidden = 0 
         ORDER BY posted_at DESC`,
        [u.id]
      );
      postsList = pRows;
    }

    return res.json({
      id: u.id,
      username: u.username,
      name: u.name,
      bio: u.bio,
      avatarUrl: u.avatarUrl,
      followerCount: u.followerCount,
      followingCount: u.followingCount,
      postCount: u.postCount,
      accountType: u.accountType,
      isSelf,
      followStatus,
      postsList,
      postsGrid: postsList,
    });
  } catch (err) {
    console.error("by-username failed:", err);
    res.status(500).json({ message: "Failed to load profile" });
  }
});

/**
 * GET /users/:id/posts
 */
router.get("/:id/posts", async (req, res) => {
  try {
    const targetId = req.params.id;
    const viewerId = req.user?.id || null;

    if (viewerId && viewerId !== targetId && await isEitherBlocked(viewerId, targetId)) {
      return res.status(404).json({ message: "User not found" });
    }

    const hasAccess = await checkPrivateAccess(viewerId, targetId, res);
    if (!hasAccess) return;

    const [rows] = await pool.execute(
      `SELECT 
        p.post_id AS id, p.caption, p.media_url AS mediaUrl, p.post_type AS postType, 
        p.posted_at AS postedAt, p.like_cnt AS likeCount, p.comment_cnt AS commentCount,
        u.user_name AS authorUsername
       FROM post p
       JOIN user u ON p.user_id = u.user_id
       WHERE p.user_id = ? AND p.is_hidden = 0
       ORDER BY p.posted_at DESC`,
      [targetId]
    );

    const posts = rows.map(r => ({
      id: r.id,
      caption: r.caption,
      mediaUrl: r.mediaUrl,
      postType: r.postType,
      postedAt: r.postedAt,
      likeCount: r.likeCount,
      commentCount: r.commentCount,
      author: { username: r.authorUsername }
    }));

    res.json(posts);
  } catch (err) {
    console.error("user posts failed:", err);
    res.status(500).json({ message: "Failed to load posts" });
  }
});

/**
 * POST /users/:id/follow
 */
router.post("/:id/follow", authRequired, async (req, res) => {
  const me = req.user.id;
  const targetId = req.params.id;
  const connection = await pool.getConnection();

  try {
    if (me === targetId) return res.status(400).json({ message: "Cannot follow yourself" });

    await connection.beginTransaction();

    // Use the active transaction connection for the helper
    if (await isEitherBlocked(me, targetId, connection)) {
      await connection.rollback();
      return res.status(403).json({ message: "One of you has blocked the other" });
    }

    const [users] = await connection.execute(
      `SELECT account_type AS accountType FROM user WHERE user_id = ? LIMIT 1`,
      [targetId]
    );
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "User not found" });
    }
    
    const target = users[0];

    if (target.accountType === "PRIVATE") {
      const [reqs] = await connection.execute(
        `SELECT status FROM followrequest WHERE requester_id = ? AND target_id = ? LIMIT 1`,
        [me, targetId]
      );
      
      if (reqs.length > 0 && reqs[0].status === "PENDING") {
        await connection.rollback();
        return res.json({ status: "REQUESTED" });
      }

      await connection.execute(
        `DELETE FROM followrequest WHERE requester_id = ? AND target_id = ?`,
        [me, targetId]
      );
      
      await connection.execute(
        `INSERT INTO followrequest (fr_id, requester_id, target_id, status) VALUES (?, ?, ?, 'PENDING')`,
        [createId(), me, targetId]
      );
      
      await connection.commit();
      return res.json({ status: "REQUESTED" });
    }

    // Eliminate TOCTOU race condition: rely on INSERT IGNORE and affectedRows
    const [insertFollow] = await connection.execute(
      `INSERT IGNORE INTO follows (followerId, followingId) VALUES (?, ?)`,
      [me, targetId]
    );

    if (insertFollow.affectedRows > 0) {
      await connection.execute(`UPDATE user SET following_cnt = following_cnt + 1 WHERE user_id = ?`, [me]);
      await connection.execute(`UPDATE user SET follower_cnt = follower_cnt + 1 WHERE user_id = ?`, [targetId]);
    }

    await connection.commit();
    return res.json({ status: "FOLLOWING" });
  } catch (err) {
    await connection.rollback();
    console.error("Follow failed:", err);
    return res.status(500).json({ message: "Follow failed" });
  } finally {
    connection.release();
  }
});

router.delete("/:id/follow", authRequired, handleUnfollow);
router.post("/unfollow/:id", authRequired, handleUnfollow);

/**
 * GET /users/me/follow-requests
 */
router.get("/me/follow-requests", authRequired, async (req, res) => {
  try {
    const me = req.user.id;
    const [rows] = await pool.execute(
      `SELECT 
        fr.createdAt, 
        u.user_id AS id, u.user_name AS username, u.avatar_url AS avatarUrl 
       FROM followrequest fr
       JOIN user u ON fr.requester_id = u.user_id
       WHERE fr.target_id = ? AND fr.status = 'PENDING'
       ORDER BY fr.createdAt DESC`,
      [me]
    );
    
    const items = rows.map(r => ({
      createdAt: r.createdAt,
      requester: { id: r.id, username: r.username, avatarUrl: r.avatarUrl }
    }));
    
    res.json(items);
  } catch (err) {
    console.error("follow-requests list failed:", err);
    res.status(500).json({ message: "Failed to load follow requests" });
  }
});

/**
 * POST /users/follow-requests/:requesterId/approve
 */
router.post("/follow-requests/:requesterId/approve", authRequired, async (req, res) => {
  const me = req.user.id;
  const requesterId = req.params.requesterId;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [delReq] = await connection.execute(
      `DELETE FROM followrequest WHERE requester_id = ? AND target_id = ? AND status = 'PENDING'`,
      [requesterId, me]
    );

    if (delReq.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Follow request not found" });
    }

    const [insertFollow] = await connection.execute(
      `INSERT IGNORE INTO follows (followerId, followingId) VALUES (?, ?)`,
      [requesterId, me]
    );

    if (insertFollow.affectedRows > 0) {
      await connection.execute(`UPDATE user SET follower_cnt = follower_cnt + 1 WHERE user_id = ?`, [me]);
      await connection.execute(`UPDATE user SET following_cnt = following_cnt + 1 WHERE user_id = ?`, [requesterId]);
    }

    await connection.commit();
    res.json({ ok: true });
  } catch (err) {
    await connection.rollback();
    console.error("approve follow-request failed:", err);
    res.status(500).json({ message: "Approve failed" });
  } finally {
    connection.release();
  }
});

/**
 * POST /users/follow-requests/:requesterId/reject
 */
router.post("/follow-requests/:requesterId/reject", authRequired, async (req, res) => {
  try {
    const me = req.user.id;
    const requesterId = req.params.requesterId;
    
    await pool.execute(
      `DELETE FROM followrequest WHERE requester_id = ? AND target_id = ? AND status = 'PENDING'`,
      [requesterId, me]
    );
    
    res.json({ ok: true });
  } catch (err) {
    console.error("reject follow-request failed:", err);
    res.status(500).json({ message: "Reject failed" });
  }
});

/**
 * GET /users/:id/followers
 */
router.get("/:id/followers", async (req, res) => {
  try {
    const targetId = req.params.id;
    const viewerId = req.user?.id || null;

    if (viewerId && await isEitherBlocked(viewerId, targetId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const hasAccess = await checkPrivateAccess(viewerId, targetId, res);
    if (!hasAccess) return;

    const queryParams = [targetId];
    let blockJoinClause = "";
    if (viewerId) {
      blockJoinClause = `LEFT JOIN blocks b ON (b.blockerId = ? AND b.blockedId = u.user_id) OR (b.blockerId = u.user_id AND b.blockedId = ?)`;
      queryParams.unshift(viewerId, viewerId);
    }

    const [rows] = await pool.execute(
      `SELECT u.user_id AS id, u.user_name AS username, u.avatar_url AS avatarUrl 
       FROM follows f
       JOIN user u ON f.followerId = u.user_id
       ${blockJoinClause}
       WHERE f.followingId = ? ${viewerId ? "AND b.blockerId IS NULL" : ""}
       ORDER BY f.createdAt DESC`,
      queryParams
    );

    res.json(rows);
  } catch (err) {
    console.error("followers list failed:", err);
    res.status(500).json({ message: "Failed to load followers" });
  }
});

/**
 * GET /users/:id/following
 */
router.get("/:id/following", async (req, res) => {
  try {
    const targetId = req.params.id;
    const viewerId = req.user?.id || null;

    if (viewerId && await isEitherBlocked(viewerId, targetId)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const hasAccess = await checkPrivateAccess(viewerId, targetId, res);
    if (!hasAccess) return;

    const queryParams = [targetId];
    let blockJoinClause = "";
    if (viewerId) {
      blockJoinClause = `LEFT JOIN blocks b ON (b.blockerId = ? AND b.blockedId = u.user_id) OR (b.blockerId = u.user_id AND b.blockedId = ?)`;
      queryParams.unshift(viewerId, viewerId);
    }

    const [rows] = await pool.execute(
      `SELECT u.user_id AS id, u.user_name AS username, u.avatar_url AS avatarUrl 
       FROM follows f
       JOIN user u ON f.followingId = u.user_id
       ${blockJoinClause}
       WHERE f.followerId = ? ${viewerId ? "AND b.blockerId IS NULL" : ""}
       ORDER BY f.createdAt DESC`,
      queryParams
    );

    res.json(rows);
  } catch (err) {
    console.error("following list failed:", err);
    res.status(500).json({ message: "Failed to load following" });
  }
});

/**
 * GET /users/search
 */
router.get("/search", async (req, res) => {
  try {
    const viewerId = req.user?.id || null;
    const q = String(req.query.q || req.query.query || "").trim();
    const take = Math.min(50, Number(req.query.limit) || 20);
    const cursorId = req.query.cursor ? String(req.query.cursor) : null;

    let cursorVal = null;
    if (cursorId) {
      const [cRows] = await pool.execute(
        `SELECT user_name, createdAt FROM user WHERE user_id = ? LIMIT 1`, 
        [cursorId]
      );
      if (cRows.length > 0) cursorVal = cRows[0];
    }

    let searchConditions = [];
    let queryParams = [];

    if (viewerId) {
      // Use UNION ALL to bypass deduplication sorting
      searchConditions.push(`u.user_id NOT IN (
        SELECT blockedId FROM blocks WHERE blockerId = ? 
        UNION ALL 
        SELECT blockerId FROM blocks WHERE blockedId = ?
      )`);
      queryParams.push(viewerId, viewerId);
    }

    if (q) {
      const searchStr = `%${q}%`;
      searchConditions.push(`(u.user_name LIKE ? OR u.name LIKE ? OR u.bio LIKE ?)`);
      queryParams.push(searchStr, searchStr, searchStr);
      
      if (cursorVal) {
        searchConditions.push(`(u.user_name > ? OR (u.user_name = ? AND u.user_id > ?))`);
        queryParams.push(cursorVal.user_name, cursorVal.user_name, cursorId);
      }
    } else {
      if (cursorVal) {
        searchConditions.push(`(u.createdAt < ? OR (u.createdAt = ? AND u.user_id < ?))`);
        queryParams.push(cursorVal.createdAt, cursorVal.createdAt, cursorId);
      }
    }

    const whereClause = searchConditions.length > 0 ? `WHERE ${searchConditions.join(" AND ")}` : "";
    queryParams.push(take + 1);
    
    const orderBy = q 
      ? `ORDER BY u.user_name ASC, u.user_id ASC` 
      : `ORDER BY u.createdAt DESC, u.user_id DESC`;

    const [rows] = await pool.execute(
      `SELECT 
        u.user_id AS id, u.user_name AS username, u.bio, u.account_type AS accountType, 
        u.follower_cnt AS followers, u.following_cnt AS following, u.createdAt, u.avatar_url AS avatar
       FROM user u
       ${whereClause}
       ${orderBy}
       LIMIT ?`,
      queryParams
    );

    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    
    let followingSet = new Set();
    if (viewerId && page.length > 0) {
      const ids = page.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      const [follows] = await pool.execute(
        `SELECT followingId FROM follows WHERE followerId = ? AND followingId IN (${placeholders})`,
        [viewerId, ...ids]
      );
      followingSet = new Set(follows.map((f) => f.followingId));
    }

    const items = page.map((r) => ({
      id: r.id,
      username: r.username,
      bio: r.bio || "",
      avatar: r.avatar || null,
      isPrivate: r.accountType === "PRIVATE",
      followers: r.followers || 0,
      following: r.following || 0,
      isFollowing: viewerId ? followingSet.has(r.id) : false,
    }));

    res.json({
      items,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (err) {
    console.error("search failed:", err);
    res.status(500).json({ message: "Search failed" });
  }
});

/**
 * POST /users/:id/block
 */
router.post("/:id/block", authRequired, async (req, res) => {
  const me = req.user.id;
  const targetId = String(req.params.id);
  const connection = await pool.getConnection();

  try {
    if (me === targetId) return res.status(400).json({ message: "Cannot block yourself" });

    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT IGNORE INTO blocks (blockerId, blockedId) VALUES (?, ?)`,
      [me, targetId]
    );

    if (result.affectedRows > 0) {
      // Use atomic DELETEs and check affectedRows to prevent double-decrement races
      const [del1] = await connection.execute(
        `DELETE FROM follows WHERE followerId = ? AND followingId = ?`, [me, targetId]
      );
      if (del1.affectedRows > 0) {
        await connection.execute(`UPDATE user SET following_cnt = GREATEST(0, following_cnt - 1) WHERE user_id = ?`, [me]);
        await connection.execute(`UPDATE user SET follower_cnt = GREATEST(0, follower_cnt - 1) WHERE user_id = ?`, [targetId]);
      }

      const [del2] = await connection.execute(
        `DELETE FROM follows WHERE followerId = ? AND followingId = ?`, [targetId, me]
      );
      if (del2.affectedRows > 0) {
        await connection.execute(`UPDATE user SET follower_cnt = GREATEST(0, follower_cnt - 1) WHERE user_id = ?`, [me]);
        await connection.execute(`UPDATE user SET following_cnt = GREATEST(0, following_cnt - 1) WHERE user_id = ?`, [targetId]);
      }

      await connection.execute(
        `DELETE FROM followrequest 
         WHERE (requester_id = ? AND target_id = ?) 
            OR (requester_id = ? AND target_id = ?)`,
        [me, targetId, targetId, me]
      );
    }

    await connection.commit();
    return res.json({ ok: true, status: "BLOCKED" });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: "Block failed" });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /users/:id/block
 */
router.delete("/:id/block", authRequired, async (req, res) => {
  try {
    const me = req.user.id;
    const targetId = String(req.params.id);
    
    await pool.execute(
      `DELETE FROM blocks WHERE blockerId = ? AND blockedId = ?`,
      [me, targetId]
    );
    
    return res.json({ ok: true, status: "UNBLOCKED" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Unblock failed" });
  }
});

/**
 * GET /users/me/blocked
 */
router.get("/me/blocked", authRequired, async (req, res) => {
  try {
    const me = req.user.id;
    
    const [rows] = await pool.execute(
      `SELECT u.user_id AS id, u.user_name AS username, u.avatar_url AS avatarUrl, b.createdAt AS blockedAt 
       FROM blocks b
       JOIN user u ON b.blockedId = u.user_id
       WHERE b.blockerId = ?
       ORDER BY b.createdAt DESC`,
      [me]
    );
    
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to load blocked users" });
  }
});

export default router;
