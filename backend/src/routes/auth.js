import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createId } from "@paralleldrive/cuid2";
import { authRequired } from "../middleware/auth.js";
import pool from "../../database/db.js";
import { JWT_SECRET } from "../config/jwt.js";

const router = express.Router();

// --- Helper Functions ---
const findUserByEmail = async (email) => {
  const [rows] = await pool.execute(
    `SELECT 
      user_id AS id, 
      user_name AS username, 
      name, 
      email, 
      password_hashed AS passwordHashed 
    FROM user 
    WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows.length > 0 ? rows[0] : null;
};

const findUserByUsername = async (username) => {
  const [rows] = await pool.execute(
    `SELECT 
      user_id AS id, 
      user_name AS username, 
      name, 
      email, 
      password_hashed AS passwordHashed 
    FROM user 
    WHERE user_name = ? LIMIT 1`,
    [username]
  );
  return rows.length > 0 ? rows[0] : null;
};
// ------------------------

// Signup route
router.post("/signup", async (req, res) => {
  try {
    const { username, name, email, password, accountType, avatarUrl } = req.body;

    if (!username || !name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check for existing users to prevent duplicates
    const existingEmail = await findUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const existingUsername = await findUserByUsername(username);
    if (existingUsername) {
      return res.status(409).json({ message: "Username already exists" });
    }

    const hashedpassword = await bcrypt.hash(password, 10);
    const newId = createId();
    const finalAccountType = accountType || "PUBLIC";
    const finalAvatarUrl = avatarUrl || null;

    // Insert new user
    await pool.execute(
      `INSERT INTO user (
        user_id, 
        user_name, 
        name, 
        email, 
        password_hashed, 
        account_type, 
        avatar_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId, username, name, email, hashedpassword, finalAccountType, finalAvatarUrl]
    );

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: newId,
        username,
        name,
        email,
      },
    });
  } catch (err) {
    console.error("[Auth - Signup] Error:", err);
    res.status(500).json({ message: "Server error during signup" });
  }
});

// Login route
router.post("/login", async (req, res) => {
  try {
    const { email, username, password } = req.body;

    if (!password || (!email && !username)) {
      return res
        .status(400)
        .json({ message: "Email or username and password are required" });
    }

    // Find by email or username based on provided input
    const user = email 
      ? await findUserByEmail(email) 
      : await findUserByUsername(username);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHashed);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid password" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1d" });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("[Auth - Login] Error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// Get current user
router.get("/me", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT 
        user_id AS id, 
        user_name AS username, 
        name, 
        bio, 
        follower_cnt AS followerCount, 
        following_cnt AS followingCount, 
        post_cnt AS postCount, 
        account_type AS accountType, 
        avatar_url AS avatarUrl, 
        email 
      FROM user 
      WHERE user_id = ? LIMIT 1`,
      [req.user.id] // Supplied securely via auth middleware
    );

    const user = rows.length > 0 ? rows[0] : null;

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error("[Auth - Get Me] Error:", err);
    res.status(500).json({ message: "Failed to load user" });
  }
});

export default router;
