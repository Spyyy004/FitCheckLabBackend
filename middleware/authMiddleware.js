import { supabase } from "../config/supabaseClient.js";

/**
 * Middleware to authenticate users via Supabase.
 * - Reads `access_token` from cookies (instead of Authorization header).
 * - Verifies the token with Supabase.
 * - Auto-refreshes expired tokens if a `refresh_token` exists.
 */
export const authenticateUser = async (req, res, next) => {
  try {
    // Extract tokens from cookies
    let accessToken = req.cookies.access_token;
    let refreshToken = req.cookies.refresh_token;

    // If no access token in cookies, check Authorization header
    if (!accessToken && req.headers.authorization?.startsWith("Bearer ")) {
      accessToken = req.headers.authorization.split(" ")[1]; // Extract token from "Bearer <token>"
    }

    if(!refreshToken){
      refreshToken = req.headers['x-refresh-token'] || req.cookies.refresh_token;

    }


    // If no access token found in both cookies & header, return 401
    if (!accessToken) {
      return res.status(401).json({ error: "Unauthorized: No access token provided." });
    }

    // Verify user from Supabase
    const { data, error } = await supabase.auth.getUser(accessToken);
    let user = data?.user;
    console.log(user,'USER IN AUTH')
    // If token is expired or invalid, try refreshing
    if (error || !user) {
      console.warn(" Access token expired or invalid, attempting refresh...");

      // If no refresh token is available, return unauthorized
      if (!refreshToken) {
        return res.status(401).json({ error: "Unauthorized: No refresh token provided." });
      }

      // Attempt session refresh using the refresh token
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: refreshToken
      });

      if (refreshError || !refreshData.session) {
        console.error(" Failed to refresh session:", refreshError);
        return res.status(401).json({ error: "Unauthorized: Session expired. Please log in again." });
      }

      // Set new tokens in cookies
      const isProduction = process.env.NODE_ENV === "production";
      
      res.cookie("access_token", refreshData.session.access_token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "None" : "Lax",
        maxAge: 60 * 60 * 24 * 7 * 1000, // 7 days
      });
      
      res.cookie("refresh_token", refreshData.session.refresh_token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "None" : "Lax",
        maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
      });

      user = refreshData.session.user; // Update user with refreshed session
    }
    
    if (!user) {
      return res.status(401).json({ error: "Unauthorized: Invalid user session." });
    }
    
    req.user = user; // Attach user data to request
    next(); // Proceed to next middleware
  } catch (error) {
    console.error(" Authentication Middleware Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
