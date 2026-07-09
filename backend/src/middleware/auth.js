// backend/src/middleware/auth.js
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/jwt.js";

const extractToken = (header) => {
  if (!header || typeof header !== 'string') return null;
  return header.startsWith("Bearer ") ? header.substring(7) : header;
};

const verifyAndAttachUser = (req, token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.userId };
    return true;
  } catch (err) {
    return false;
  }
};

export const authOptional = (req, res, next) => {
  const token = extractToken(req.headers.authorization);
  if (token) {
    verifyAndAttachUser(req, token);
  }
  next();
};

export const authRequired = (req, res, next) => {
  const token = extractToken(req.headers.authorization);
  
  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  const isValid = verifyAndAttachUser(req, token);
  
  if (!isValid) {
    return res.status(401).json({ message: "Invalid token" });
  }
  
  next();
};
