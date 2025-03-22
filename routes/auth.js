import express from "express";
import { supabase } from "../config/supabaseClient.js";
import cookieParser from "cookie-parser";
import crypto from "crypto"; // Add crypto import for UUID generation
import { addUserToMixpanel, trackEvent } from "../mixpanel.js";

const router = express.Router();
router.use(cookieParser()); // Enable cookie parsing

router.post("/signup", async (req, res) => {
    try {
      const { email, password, full_name, session_token } = req.body;
  
      if (!email || !password || !full_name) {
        return res.status(400).json({ error: "Missing required fields." });
      }
  
  
      // 1️⃣ Try to create user in Supabase Auth
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options:{
            data:{
                username: full_name
            }
        }
      });

  
      if (signUpError) {
        console.error("❌ Sign-Up Error:", signUpError);
  
        // Handle specific errors
        if (signUpError.message.includes("Database error saving new user")) {
          return res.status(500).json({ error: "Supabase Database Error: Please try again later." });
        }
        if (signUpError.message.includes("duplicate key")) {
          return res.status(400).json({ error: "Email already registered. Please log in." });
        }
        if (signUpError.message.includes("password")) {
          return res.status(400).json({ error: "Password does not meet security requirements." });
        }
  
        return res.status(500).json({ error: signUpError.message });
      }
  
      const user = signUpData.user;
      if (!user) {
        return res.status(500).json({ error: "User creation failed. No user data returned." });
      }
  
      addUserToMixpanel(user.id,{
        email,
        full_name
      })
      trackEvent(user.id,"Signup Success", { method: "Email+Password" });
  
  
      return res.json({
        message: "User signed up successfully.",
        user_id: user.id
      });
  
    } catch (error) {
      trackEvent("","API Failure",{
        error : error?.message ?? "Error Message",
        type: "signup"
      })
      console.error("❌ Server Error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });
  

router.post("/signin", async (req, res) => {
  try {
    const { email, password, session_token } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password." });
    }


    // 1️⃣ Authenticate user
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      console.error("❌ Sign-In Error:", error);
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const { access_token, refresh_token, user } = data.session;

    // 2️⃣ Store tokens in secure HttpOnly cookies
    res.cookie("access_token", access_token, {
      httpOnly: true,
      secure: true, // Use secure cookies in production
      sameSite: "None",
      maxAge: 60 * 60 * 24 * 7 * 1000, // 7 days
    });

    res.cookie("refresh_token", refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 60 * 60 * 24 * 30 * 1000, // 30 days
    });

    // 3️⃣ Map previous guest analyses if session_token exists
    // 3️⃣ Map previous guest analyses if session_token exists
// 3️⃣ Map previous guest analyses if session_token exists
if (session_token) {
    const trimmedSessionToken = session_token.trim(); // Trim spaces
  
  
    // Fetch stored session tokens to log and debug
    const { data: storedTokens, error: fetchError } = await supabase
      .from("outfit_analyses")
      .select("session_token");
  
  
    if (fetchError) {
      console.error("❌ Error fetching session tokens:", fetchError);
    }
  
    // Try updating the user_id for matching session_token
    const { data: updateResult, error: updateError } = await supabase
      .from("outfit_analyses")
      .update({ user_id: user.id })
      .match({ session_token: trimmedSessionToken });
  
    if (updateError) {
      console.error("❌ Update Error:", updateError);
    } 
  }
  
 
  
  trackEvent(user.id, "Login Success", { method: "Email+Password" });

    return res.json({
      message: "User signed in successfully.",
      access_token, // Send token for frontend use
      refresh_token
    });
  } catch (error) {
    console.error("❌ Server Error:", error);
    trackEvent("","API Failure",{
      error : error?.message ?? "Error Message",
      type: "signin"
    })
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * 🔍 Google Sign-In API
 * - Handles authentication with Google credentials
 * - Creates new user if not exists or signs in existing user
 * - Returns access token and onboarding flag
 */

router.post("/google-sign-in", async (req, res) => {
  try {
    const { email, full_name, google_id } = req.body;

    if (!email || !full_name || !google_id) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    // 🔍 Step 1: Check if user exists in Supabase Auth
    const { data: existingUser, error: getUserError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    // ✅ Step 2: User does not exist → Sign up
    if (!existingUser) {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password: google_id,
        options: {
          data: {
            username: full_name,
          },
        },
      });

      if (signUpError) {
        console.error("❌ Google Sign-Up Error:", signUpError);
        return res.status(500).json({ error: signUpError.message });
      }

      const userId = signUpData.user?.id;
      if (!userId) {
        return res.status(500).json({ error: "User creation failed. No user data returned." });
      }

      // 🔐 Sign in after sign-up
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: google_id,
      });

      if (signInError || !signInData.session) {
        return res.status(401).json({ error: "Authentication failed." });
      }

      const { access_token, refresh_token } = signInData.session;

      res.cookie("access_token", access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
        maxAge: 60 * 60 * 24 * 7 * 1000,
      });

      res.cookie("refresh_token", refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
        maxAge: 60 * 60 * 24 * 30 * 1000,
      });

      addUserToMixpanel(userId,{
        email
      })
      trackEvent(userId, "Login Success", { method: "Google" });
      return res.json({
        message: "Google sign-up successful.",
        access_token,
        refresh_token,
        onboarding: true,
        user_id: userId,
      });
    }

    // 🚨 Step 3: User exists → Try to sign in with Google ID as password
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: google_id,
    });

    // ✅ Sign-in successful → this is a Google-registered user
    if (signInData?.session) {
      const { access_token, refresh_token } = signInData.session;

      res.cookie("access_token", access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
        maxAge: 60 * 60 * 24 * 7 * 1000,
      });

      res.cookie("refresh_token", refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
        maxAge: 60 * 60 * 24 * 30 * 1000,
      });

      return res.json({
        message: "Signed in via Google successfully.",
        access_token,
        refresh_token,
        onboarding: false,
        user_id: signInData.user.id,
      });
    }

    // ❌ If sign-in fails, it's likely a non-Google user
    return res.status(400).json({
      error: "User already exists. Try signing in with email & password.",
    });

  } catch (error) {
    console.error("❌ Server Error:", error);
    trackEvent("","API Failure",{
      error : error?.message ?? "Error Message",
      type: "google-sign-in"
    })
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


/**
 * 🚪 Sign-Out API
 * - Clears `access_token` & `refresh_token` cookies on logout.
 */
router.post("/signout", async (req, res) => {
  try {
    res.clearCookie("access_token");
    res.clearCookie("refresh_token");

    return res.json({ message: "User signed out successfully." });
  } catch (error) {
    trackEvent("","API Failure",{
      error : error?.message ?? "Error Message",
      type: "signout"
    })
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * 🔍 Verify Auth API
 * - Checks if the user is authenticated using cookies.
 * - Returns `access_token` for frontend storage.
 */
router.get("/verify-auth", async (req, res) => {
  const access_token = req.cookies.access_token;

  if (!access_token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const { data, error } = await supabase.auth.getUser(access_token);

    if (error) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    return res.json({ user: data.user, access_token });
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
