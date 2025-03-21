import { supabase } from "../config/supabaseClient.js";

/**
 * Middleware to authenticate users via Supabase.
 * - Reads `access_token` from cookies (instead of Authorization header).
 * - Verifies the token with Supabase.
 * - Auto-refreshes expired tokens if a `refresh_token` exists.
 */
export const authenticateUser = async (req, res, next) => {
  try {
    // 🔹 Extract tokens from cookies
    let accessToken = req.cookies.access_token;
    let refreshToken = req.cookies.refresh_token;

    // 🔹 If no access token in cookies, check Authorization header
    if (!accessToken && req.headers.authorization?.startsWith("Bearer ")) {
      accessToken = req.headers.authorization.split(" ")[1]; // Extract token from "Bearer <token>"
    }

    // ❌ If no access token found in both cookies & header, return 401
    if (!accessToken) {
      return res.status(401).json({ error: "Unauthorized: No access token provided." });
    }

    // 🔹 Verify user from Supabase
    let { data: { user }, error } = await supabase.auth.getUser(accessToken);

    // If token is expired or invalid, try refreshing
    if (error || !user) {
      console.warn("⚠️ Access token expired or invalid, attempting refresh...");

      // ❌ If no refresh token is available, return unauthorized
      if (!refreshToken) {
        return res.status(401).json({ error: "Unauthorized: No refresh token provided." });
      }

      // 🔄 Attempt session refresh using the refresh token
      const { data: session, error: refreshError } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

      if (refreshError) {
        console.error("❌ Failed to refresh session:", refreshError);
        return res.status(401).json({ error: "Unauthorized: Session expired. Please log in again." });
      }

      // ✅ Set new tokens in cookies
      res.cookie("access_token", session.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
      });
      res.cookie("refresh_token", session.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
      });

      user = session.user; // Update user with refreshed session
    }
    req.user = user; // Attach user data to request
    next(); // Proceed to next middleware
  } catch (error) {
    console.error("❌ Authentication Middleware Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
