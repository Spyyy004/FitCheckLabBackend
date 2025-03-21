import express from "express";
import { supabase } from "../config/supabaseClient.js"; // Ensure you have a valid Supabase client setup

const router = express.Router();

// 🔹 Update Profile Endpoint
router.put("/", async (req, res) => {
  try {
    // Extract access token from headers
    const accessToken = req.headers.authorization?.split(" ")[1];

    if (!accessToken) {
      return res.status(401).json({ error: "Unauthorized. No token provided." });
    }

    // Authenticate user via Supabase
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !userData?.user) {
      console.error("❌ Authentication Error:", userError?.message || "Invalid token");
      return res.status(401).json({ error: "Invalid token. Please log in again." });
    }

    const userId = userData.user.id; // Get the authenticated user's ID

    // Extract updatable fields from request body
    const { full_name, height, weight, style } = req.body;
    const gender = req.body.gender?.toLowerCase();
    // Ensure email cannot be updated
    if (req.body.email) {
      return res.status(400).json({ error: "Email cannot be updated." });
    }

    // Update user profile in Supabase
    const { data, error } = await supabase
      .from("profiles") // Ensure your user profiles are stored in this table
      .update({ full_name, height, weight, gender,style })
      .match({ id: userId })
      .select("*");

    if (error) {
      console.error("❌ Error updating profile:", error.message);
      return res.status(500).json({ error: "Error updating profile." });
    }


    return res.json({ message: "Profile updated successfully.", profile: data[0] });

  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
