// backend/scripts/syncLikeCounts.js
import pool from "../database/db.js";

const main = async () => {
  try {
    const [posts] = await pool.query('SELECT post_id FROM post');
    
    for (const p of posts) {
      const [countResult] = await pool.query(
        'SELECT COUNT(*) as count FROM `like` WHERE post_id = ?', 
        [p.post_id]
      );
      const likeCount = countResult[0].count;
      
      await pool.query(
        'UPDATE post SET like_cnt = ? WHERE post_id = ?', 
        [likeCount, p.post_id]
      );
    }
    
    console.log("Synced likeCount for", posts.length, "posts");
  } catch (error) {
    console.error("Error syncing like counts:", error);
  } finally {
    await pool.end();
  }
};

main();
