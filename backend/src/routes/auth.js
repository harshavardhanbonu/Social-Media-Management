import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { createId } from "@paralleldrive/cuid2";
import { authRequired } from "../middleware/auth.js";
import pool from "../../database/db.js";

dotenv.config();

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "login_signup"; // use env in prod

// Signup route
router.post("/signup", async (req, res) => {
  try {
    const { username, name, email, password, accountType, avatarUrl } = req.body;

    if (!username || !name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if email exists
    const [existingEmailRows] = await pool.query(
      "SELECT user_id FROM user WHERE email = ?",
      [email]
    );
    if (existingEmailRows.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Check if username exists
    const [existingUsernameRows] = await pool.query(
      "SELECT user_id FROM user WHERE user_name = ?",
      [username]
    );
    if (existingUsernameRows.length > 0) {
      return res.status(400).json({ message: "Username already exists" });
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
    console.error("signup error:", err);
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

    let user = null;
    
    // Find by email
    if (email) {
      const [rows] = await pool.query(
        `SELECT 
          user_id AS id, 
          user_name AS username, 
          name, 
          email, 
          password_hashed AS passwordHashed 
        FROM user 
        WHERE email = ?`,
        [email]
      );
      if (rows.length > 0) user = rows[0];
    }
    
    // Find by username if not found by email
    if (!user && username) {
      const [rows] = await pool.query(
        `SELECT 
          user_id AS id, 
          user_name AS username, 
          name, 
          email, 
          password_hashed AS passwordHashed 
        FROM user 
        WHERE user_name = ?`,
        [username]
      );
      if (rows.length > 0) user = rows[0];
    }

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHashed);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1d" });

    res.json({
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
    console.error("login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// Get current user
router.get("/me", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.query(
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
      WHERE user_id = ?`,
      [req.user.id] // Assumes your auth middleware attaches user.id
    );

    const u = rows.length > 0 ? rows[0] : null;

    if (!u) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(u);
  } catch (err) {
    console.error("/auth/me error:", err);
    res.status(500).json({ message: "Failed to load user" });
  }
});

export default router;
