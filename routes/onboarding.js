import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", authenticateUser, async (req, res) => {
  try {
    const { full_name, date_of_birth, gender, height, weight } = req.body;
    const user_id = req.user.id; // Extracted from Auth Middleware

    if (!full_name || !date_of_birth || !gender || !height || !weight) {
      return res.status(400).json({ error: "All fields are required." });
    }

    // 🔹 Update Profile
    const { error } = await supabase
      .from("profiles")
      .update({ full_name, date_of_birth, gender, height, weight })
      .eq("id", user_id);

    if (error) {
      console.error("❌ Profile Update Error:", error);
      return res.status(500).json({ error: "Failed to update profile." });
    }

    console.log(`✅ Profile updated for user: ${user_id}`);
    return res.json({ message: "Profile updated successfully!" });

  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
