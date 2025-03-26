import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js"; // Middleware for user authentication
import { trackEvent } from "../mixpanel.js";
const router = express.Router();

/**
 * 📌 Get Clothing Item by ID
 * Endpoint: GET /api/clothing-items/:id
 * Authenticated request - Only returns clothing items for the logged-in user.
 */

const colorPairings = {
  white: ["black", "blue", "olive", "beige", "grey", "brown", "denim", "pastel"],
  black: ["white", "beige", "denim", "grey", "olive", "red", "light blue"],
  beige: ["black", "brown", "olive", "white", "maroon", "navy"],
  grey: ["white", "black", "blue", "olive", "maroon", "pink"],
  navy: ["white", "beige", "grey", "mustard", "olive"],
  brown: ["white", "tan", "olive", "blue", "grey"],
  blue: ["white", "beige", "brown", "grey", "olive", "tan"],
  olive: ["white", "black", "beige", "mustard", "brown"],
  denim: ["white", "grey", "black", "tan", "olive"],
  maroon: ["white", "beige", "black", "grey", "navy"],
  mustard: ["navy", "olive", "brown", "white"],
  tan: ["navy", "olive", "white", "brown", "black"],
  red: ["white", "black", "navy", "beige"],
  pink: ["grey", "white", "black", "navy"],
  "pastel blue": ["white", "grey", "beige", "olive"],
  "pastel green": ["white", "tan", "beige", "navy"],
  lavender: ["white", "grey", "navy", "denim"],
};
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
    const primaryColor = data.primary_color?.toLowerCase();
    const matchColors = colorPairings[primaryColor] || [];

    // 3️⃣ Fetch wardrobe items that match the color pairing
    const { data: matchingItems, error: matchError } = await supabase
      .from("clothing_items")
      .select("*")
      .eq("user_id", user_id)
      .in("primary_color", matchColors)
      .neq("id", id); // exclude current item

    if (matchError) {
      console.warn("⚠️ Error fetching matching items:", matchError.message);
    }

    return res.json({
      item,
      color_matches: matchColors,
      matching_items: matchingItems || [],
    });


  } catch (error) {
    trackEvent("","API Failure",{
      error : error?.message ?? "Error Message",
      type: "get-single-cloth"
    })
    return res.status(500).json({ error: `Internal Server Error ${error?.message}` });
  }
});

/**
 * 📌 Delete Clothing Item by ID
 * Endpoint: DELETE /api/clothing-items/:id
 * Authenticated request - Only allows users to delete their own clothing items.
 */
router.delete("/:id", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id; // Extracted from authenticated session

    // 1️⃣ Verify the item belongs to the user before deletion
    const { data: itemToDelete, error: fetchError } = await supabase
      .from("clothing_items")
      .select("id")
      .eq("id", id)
      .eq("user_id", user_id)
      .single();

    if (fetchError || !itemToDelete) {
      console.error("❌ Item Not Found or Not Authorized:", fetchError?.message);
      return res.status(404).json({ error: "Item not found or you don't have permission to delete it." });
    }

    // 2️⃣ Delete the clothing item from Supabase
    const { error: deleteError } = await supabase
      .from("clothing_items")
      .delete()
      .eq("id", id)
      .eq("user_id", user_id); // Extra security to ensure only the owner can delete

    if (deleteError) {
      console.error("❌ Delete Operation Failed:", deleteError.message);
      return res.status(500).json({ error: "Failed to delete the clothing item." });
    }

    return res.status(200).json({ message: "Clothing item successfully deleted." });
  } catch (error) {
    trackEvent("", "API Failure", {
      error: error?.message ?? "Error Message",
      type: "delete-cloth-item"
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
