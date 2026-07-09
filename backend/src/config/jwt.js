import dotenv from "dotenv";
dotenv.config();

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("FATAL ERROR: JWT_SECRET is not defined.");
}

export const JWT_SECRET = process.env.JWT_SECRET || "login_signup";
