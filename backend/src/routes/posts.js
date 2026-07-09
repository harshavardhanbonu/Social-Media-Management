import express from "express";
import { createId } from "@paralleldrive/cuid2";
import { authRequired } from "../middleware/auth.js";
import { broadcast } from "../realtime/hub.js";
import pool from "../../database/db.js";

const router = express.Router();

// --- Helper Functions ---

async function getViewerLikedSet(viewerId, postIds) {
  if (!viewerId || postIds.length === 0) return new Set();
  const placeholders = postIds.map(() => "?").join(",");
  const [likes] = await pool.execute(
    `SELECT post_id FROM \`like\` WHERE user_id = ? AND post_id IN (${placeholders})`,
    [viewerId, ...postIds]
  );
  return new Set(likes.map((l) => l.post_id));
}

function mapPostRowToJSON(row, viewerLikedSet = new Set()) {
  return {
    id: row.id,
    caption: row.caption || "",
    mediaUrl: row.mediaUrl,
    postType: row.postType,
    postedAt: row.postedAt,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    viewerLiked: viewerLikedSet.has(row.id),
    author: {
      id: row.authorId,
      username: row.authorUsername,
      avatarUrl: row.authorAvatarUrl,
    },
  };
}

const POST_SELECT_CLAUSE = `
  p.post_id AS id, p.caption, p.media_url AS mediaUrl, p.post_type AS postType, 
  p.posted_at AS postedAt, p.like_cnt AS likeCount, p.comment_cnt AS commentCount,
  u.user_id AS authorId, u.user_name AS authorUsername, u.avatar_url AS authorAvatarUrl
`;

// --- Routes ---

// CREATE a post (text or media)
// SECURITY FIX: Now authenticated, ignoring any client-provided userId.
router.post("/create", authRequired, async (req, res) => {
  const userId = req.user.id;
  const { caption, mediaUrl, postType } = req.body;
  
  const connection = await pool.getConnection();
  try {
    const newPostId = createId();
    const finalCaption = caption || "";
    const finalMediaUrl = mediaUrl || null;
    const finalPostType = postType || "TEXT";

    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO post (post_id, user_id, caption, media_url, post_type) 
       VALUES (?, ?, ?, ?, ?)`,
      [newPostId, userId, finalCaption, finalMediaUrl, finalPostType]
    );

    await connection.execute(
      `UPDATE user SET post_cnt = post_cnt + 1 WHERE user_id = ?`,
      [userId]
    );

    await connection.commit();

    const [rows] = await pool.execute(
      `SELECT post_id AS id, user_id AS userId, caption, media_url AS mediaUrl, 
       post_type AS postType, posted_at AS postedAt, like_cnt AS likeCount, comment_cnt AS commentCount 
       FROM post WHERE post_id = ? LIMIT 1`,
      [newPostId]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    await connection.rollback();
    console.error("Error creating post:", err);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    connection.release();
  }
});

// GET all posts
router.get("/", async (req, res) => {
  try {
    // Note: Ensure your app middleware uses authOptional for this route to populate req.user if present
    const viewerId = req.user?.id || null;
    
    const [rows] = await pool.execute(
      `SELECT ${POST_SELECT_CLAUSE}
       FROM post p
       JOIN user u ON p.user_id = u.user_id
       ORDER BY p.posted_at DESC`
    );

    const postIds = rows.map((r) => r.id);
    const likedSet = await getViewerLikedSet(viewerId, postIds);
    
    const posts = rows.map((row) => mapPostRowToJSON(row, likedSet));
    res.json(posts);
  } catch (err) {
    console.error("Error fetching posts:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET posts by a specific user
router.get("/user/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const viewerId = req.user?.id || null;

    const [rows] = await pool.execute(
      `SELECT ${POST_SELECT_CLAUSE}
       FROM post p
       JOIN user u ON p.user_id = u.user_id
       WHERE p.user_id = ?
       ORDER BY p.posted_at DESC`,
      [userId]
    );

    const postIds = rows.map((r) => r.id);
    const likedSet = await getViewerLikedSet(viewerId, postIds);

    const posts = rows.map((row) => mapPostRowToJSON(row, likedSet));
    res.json(posts);
  } catch (err) {
    console.error("Error fetching user posts:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// EXPLORE feed
router.get("/explore", async (req, res) => {
  try {
    const take = Math.min(50, Number(req.query.limit) || 20);
    const cursorId = req.query.cursor ? String(req.query.cursor) : null;
    const viewerId = req.user?.id || null;

    let cursorDate = null;
    if (cursorId) {
      const [cRows] = await pool.execute(`SELECT posted_at FROM post WHERE post_id = ? LIMIT 1`, [cursorId]);
      if (cRows.length > 0) cursorDate = cRows[0].posted_at;
    }

    const queryParams = [];
    let cursorClause = "";
    if (cursorDate) {
      cursorClause = `AND (p.posted_at < ? OR (p.posted_at = ? AND p.post_id < ?))`;
      queryParams.push(cursorDate, cursorDate, cursorId);
    }
    queryParams.push(take + 1);

    const [rows] = await pool.execute(
      `SELECT ${POST_SELECT_CLAUSE}
       FROM post p
       JOIN user u ON p.user_id = u.user_id
       WHERE u.account_type = 'PUBLIC'
       ${cursorClause}
       ORDER BY p.posted_at DESC, p.post_id DESC
       LIMIT ?`,
      queryParams
    );

    const hasMore = rows.length > take;
    const slicedRows = rows.slice(0, take);
    
    const postIds = slicedRows.map((r) => r.id);
    const likedSet = await getViewerLikedSet(viewerId, postIds);

    const items = slicedRows.map((row) => mapPostRowToJSON(row, likedSet));

    res.json({ 
      items, 
      nextCursor: hasMore ? slicedRows[slicedRows.length - 1].id : null 
    });
  } catch (err) {
    console.error("Explore feed failed:", err);
    res.status(500).json({ message: "Explore feed failed" });
  }
});

// LIKE
router.post("/:id/like", authRequired, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    
    const [result] = await connection.execute(
      `INSERT IGNORE INTO \`like\` (post_id, user_id) VALUES (?, ?)`,
      [postId, userId]
    );

    if (result.affectedRows > 0) {
      await connection.execute(
        `UPDATE post SET like_cnt = like_cnt + 1 WHERE post_id = ?`,
        [postId]
      );
    }

    await connection.commit();

    const [rows] = await pool.execute(
      `SELECT like_cnt AS likeCount FROM post WHERE post_id = ? LIMIT 1`,
      [postId]
    );
    const likeCount = rows[0]?.likeCount || 0;

    broadcast("post_like_updated", { postId, likeCount });
    res.json({ liked: true, likeCount });
  } catch (err) {
    await connection.rollback();
    console.error("LIKE failed:", err);
    res.status(500).json({ message: "Like failed" });
  } finally {
    connection.release();
  }
});

// UNLIKE
router.delete("/:id/like", authRequired, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [del] = await connection.execute(
      `DELETE FROM \`like\` WHERE user_id = ? AND post_id = ?`,
      [userId, postId]
    );

    if (del.affectedRows > 0) {
      await connection.execute(
        `UPDATE post SET like_cnt = like_cnt - 1 WHERE post_id = ?`,
        [postId]
      );
    }

    await connection.commit();

    const [rows] = await pool.execute(
      `SELECT like_cnt AS likeCount FROM post WHERE post_id = ? LIMIT 1`,
      [postId]
    );
    const likeCount = rows[0]?.likeCount || 0;

    broadcast("post_like_updated", { postId, likeCount });
    res.json({ liked: false, likeCount });
  } catch (err) {
    await connection.rollback();
    console.error("UNLIKE failed:", err);
    res.status(500).json({ message: "Unlike failed" });
  } finally {
    connection.release();
  }
});

// LIKERS LIST
router.get("/:id/likes", async (req, res) => {
  try {
    const postId = String(req.params.id);
    const viewerId = req.user?.id || null;

    const [rows] = await pool.execute(
      `SELECT 
        u.user_id AS id, u.user_name AS username, u.avatar_url AS avatarUrl, l.createdAt
       FROM \`like\` l
       JOIN user u ON l.user_id = u.user_id
       WHERE l.post_id = ?
       ORDER BY l.createdAt DESC`,
      [postId]
    );

    let followingSet = new Set();
    if (viewerId) {
      const ids = rows.map((r) => r.id).filter((id) => id !== viewerId);
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const [follows] = await pool.execute(
          `SELECT followingId FROM follows WHERE followerId = ? AND followingId IN (${placeholders})`,
          [viewerId, ...ids]
        );
        followingSet = new Set(follows.map((f) => f.followingId));
      }
    }

    const items = rows.map((r) => ({
      id: r.id,
      username: r.username,
      avatarUrl: r.avatarUrl || null,
      isFollowing: viewerId ? followingSet.has(r.id) : false,
      isSelf: viewerId === r.id,
    }));

    res.json({ items });
  } catch (err) {
    console.error("Likes list failed:", err);
    res.status(500).json({ message: "Failed to load likes" });
  }
});

// GET /posts/:id/comments
router.get("/:id/comments", async (req, res) => {
  try {
    const postId = req.params.id;
    const take = Math.min(50, Number(req.query.limit) || 20);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    let cursorDate = null;
    if (cursor) {
      const [cRows] = await pool.execute(`SELECT createdAt FROM comment WHERE comment_id = ? LIMIT 1`, [cursor]);
      if (cRows.length > 0) cursorDate = cRows[0].createdAt;
    }

    const queryParams = [postId];
    let cursorClause = "";
    if (cursorDate) {
      cursorClause = `AND (c.createdAt > ? OR (c.createdAt = ? AND c.comment_id > ?))`;
      queryParams.push(cursorDate, cursorDate, cursor);
    }
    queryParams.push(take + 1);

    const [topLevelRows] = await pool.execute(
      `SELECT 
        c.comment_id AS id, c.content, c.createdAt, c.parent_cmtid AS parentCommentId,
        u.user_id AS authorId, u.user_name AS authorUsername, u.avatar_url AS authorAvatarUrl
       FROM comment c
       JOIN user u ON c.user_id = u.user_id
       WHERE c.post_id = ? AND c.parent_cmtid IS NULL
       ${cursorClause}
       ORDER BY c.createdAt ASC, c.comment_id ASC
       LIMIT ?`,
      queryParams
    );

    const hasMore = topLevelRows.length > take;
    const items = topLevelRows.slice(0, take).map(r => ({
      id: r.id,
      content: r.content,
      createdAt: r.createdAt,
      parentCommentId: r.parentCommentId,
      author: { id: r.authorId, username: r.authorUsername, avatarUrl: r.authorAvatarUrl },
      replies: []
    }));

    if (items.length > 0) {
      const topLevelIds = items.map(i => i.id);
      const placeholders = topLevelIds.map(() => "?").join(",");
      const [replyRows] = await pool.execute(
        `SELECT 
          c.comment_id AS id, c.content, c.createdAt, c.parent_cmtid AS parentCommentId,
          u.user_id AS authorId, u.user_name AS authorUsername, u.avatar_url AS authorAvatarUrl
         FROM comment c
         JOIN user u ON c.user_id = u.user_id
         WHERE c.parent_cmtid IN (${placeholders})
         ORDER BY c.createdAt ASC`,
        topLevelIds
      );

      const replyMap = {};
      replyRows.forEach(r => {
        if (!replyMap[r.parentCommentId]) replyMap[r.parentCommentId] = [];
        replyMap[r.parentCommentId].push({
          id: r.id,
          content: r.content,
          createdAt: r.createdAt,
          parentCommentId: r.parentCommentId,
          author: { id: r.authorId, username: r.authorUsername, avatarUrl: r.authorAvatarUrl }
        });
      });

      items.forEach(item => {
        if (replyMap[item.id]) {
          item.replies = replyMap[item.id];
        }
      });
    }

    res.json({ 
      items, 
      nextCursor: hasMore ? items[items.length - 1].id : null 
    });
  } catch (err) {
    console.error("Load comments failed:", err);
    res.status(500).json({ message: "Load comments failed" });
  }
});

// POST /posts/:id/comments
router.post("/:id/comments", authRequired, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    const content = String(req.body?.content || "").trim();
    const parentCommentId = req.body?.parentCommentId ? String(req.body.parentCommentId) : null;

    if (!content) {
      return res.status(400).json({ message: "Empty comment" });
    }

    if (parentCommentId) {
      const [parents] = await connection.execute(
        `SELECT post_id, parent_cmtid FROM comment WHERE comment_id = ? LIMIT 1`,
        [parentCommentId]
      );
      const parent = parents[0];
      
      if (!parent || String(parent.post_id) !== String(postId)) {
        return res.status(400).json({ message: "Invalid parentCommentId" });
      }
      if (parent.parent_cmtid) {
        return res.status(400).json({ message: "Replies are allowed only one level deep" });
      }
    }

    const newCommentId = createId();

    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO comment (comment_id, post_id, user_id, content, parent_cmtid)
       VALUES (?, ?, ?, ?, ?)`,
      [newCommentId, postId, userId, content, parentCommentId]
    );

    await connection.execute(
      `UPDATE post SET comment_cnt = comment_cnt + 1 WHERE post_id = ?`,
      [postId]
    );

    await connection.commit();

    const [commentRows] = await pool.execute(
      `SELECT 
        c.comment_id AS id, c.content, c.createdAt, c.parent_cmtid AS parentCommentId,
        u.user_id AS authorId, u.user_name AS authorUsername, u.avatar_url AS authorAvatarUrl
       FROM comment c
       JOIN user u ON c.user_id = u.user_id
       WHERE c.comment_id = ? LIMIT 1`,
      [newCommentId]
    );
    
    const cRow = commentRows[0];
    const withAuthor = {
      id: cRow.id,
      content: cRow.content,
      createdAt: cRow.createdAt,
      parentCommentId: cRow.parentCommentId,
      author: {
        id: cRow.authorId,
        username: cRow.authorUsername,
        avatarUrl: cRow.authorAvatarUrl
      }
    };

    const [postRows] = await pool.execute(
      `SELECT comment_cnt AS commentCount FROM post WHERE post_id = ? LIMIT 1`,
      [postId]
    );
    const commentCount = postRows[0]?.commentCount || 0;

    broadcast("post_comment_added", {
      postId: String(postId),
      commentCount,
      comment: withAuthor,
    });

    res.status(201).json(withAuthor);
  } catch (err) {
    await connection.rollback();
    console.error("Add comment failed:", err);
    res.status(500).json({ message: "Add comment failed" });
  } finally {
    connection.release();
  }
});

export default router;
