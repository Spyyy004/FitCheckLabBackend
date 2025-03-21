import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js"; // Middleware for user authentication

const router = express.Router();

/**
 * 📌 Get Clothing Item by ID
 * Endpoint: GET /api/clothing-items/:id
 * Authenticated request - Only returns clothing items for the logged-in user.
 */
router.get("/:id", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id; // Extracted from authenticated session


    // 1️⃣ Fetch the clothing item from Supabase
    const { data, error } = await supabase
      .from("clothing_items")
      .select("*")
      .eq("id", id)
      .eq("user_id", user_id) // Ensure the user only accesses their own wardrobe items
      .single();

    if (error || !data) {
      console.error("❌ Clothing Item Not Found:", error?.message);
      return res.status(404).json({ error: "Clothing item not found." });
    }

    return res.json(data);
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
