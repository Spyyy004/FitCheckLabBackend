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

export const colorPairings = {
  White: ["Black", "Blue", "Olive", "Beige", "Grey", "Brown", "Denim", "Pastel", "Red", "Lavender"],
  Black: ["White", "Beige", "Denim", "Grey", "Olive", "Red", "Lavender", "Light Blue", "Pink"],
  Grey: ["White", "Black", "Blue", "Olive", "Maroon", "Pink", "Pastel Green"],
  Gray: ["White", "Black", "Blue", "Olive", "Maroon", "Pink", "Pastel Green"], // Duplicate key if both exist
  Beige: ["Black", "Brown", "Olive", "White", "Maroon", "Navy", "Rust", "Teal"],
  Brown: ["White", "Tan", "Olive", "Blue", "Grey", "Beige"],
  Blue: ["White", "Beige", "Brown", "Grey", "Olive", "Tan", "Red"],
  Navy: ["White", "Beige", "Grey", "Mustard", "Olive", "Pink"],
  "Navy Blue": ["White", "Beige", "Grey", "Mustard", "Olive", "Pink"],
  Olive: ["White", "Black", "Beige", "Mustard", "Brown", "Tan", "Pastel Blue"],
  Tan: ["Navy", "Olive", "White", "Brown", "Black", "Pink"],
  Mustard: ["Navy", "Olive", "Brown", "White", "Black"],
  Red: ["White", "Black", "Navy", "Beige", "Tan", "Denim"],
  Maroon: ["White", "Beige", "Black", "Grey", "Navy", "Brown"],
  Pink: ["Grey", "White", "Black", "Navy", "Tan", "Lavender"],
  Lavender: ["White", "Grey", "Navy", "Denim", "Pink"],
  "Pastel Blue": ["White", "Grey", "Beige", "Olive", "Denim"],
  "Pastel Green": ["White", "Tan", "Beige", "Navy", "Brown"],
  Teal: ["White", "Beige", "Grey", "Denim", "Tan"],
  Mint: ["White", "Navy", "Pastel Blue", "Grey"],
  Orange: ["Navy", "White", "Black", "Brown"],
  Yellow: ["Navy", "White", "Olive", "Black"],
  Rust: ["Beige", "Olive", "White", "Denim"],
  Denim: ["White", "Grey", "Black", "Tan", "Olive", "Pastel Blue"],
  Gold: ["Black", "White", "Navy", "Maroon"],
  Silver: ["Black", "White", "Grey", "Navy"],
  "Light Blue": [
  "White",         // crisp & clean
  "Beige",         // soft & neutral
  "Grey",          // classic & safe
  "Navy",          // tonal contrast
  "Black",         // modern edge
  "Olive",         // earthy balance
  "Tan",           // warm offset
  "Pastel Pink",   // playful pastel pairing
  "Lavender",      // soft contrast
  "Denim"          // tone-on-tone
]
};



const subcategoryMatches = {
  // 🧥 Tops
  "T-shirt": ["Jeans", "Chinos", "Shorts", "Cargo Pants", "Track Pants", "Sweatpants"],
  "Shirt": ["Jeans", "Chinos", "Dress Pants", "Skirt"],
  "Blouse": ["Dress Pants", "Skirt", "Chinos"],
  "Sweater": ["Jeans", "Leggings", "Skirt"],
  "Hoodie": ["Jeans", "Track Pants", "Sweatpants", "Cargo Pants"],
  "Tank Top": ["Shorts", "Skirt", "Jeans"],
  "Turtleneck": ["Dress Pants", "Jeans", "Skirt"],
  "Cardigan": ["Dress Pants", "Jeans", "Skirt"],
  "Crop Top": ["High-waisted Jeans", "Skirt", "Shorts"],
  "Jacket": ["Jeans", "Dress Pants", "Skirt"],
  "Coat": ["Jeans", "Dress Pants"],
  "Blazer": ["Dress Pants", "Skirt", "Jeans"],
  "Denim Jacket": ["Chinos", "Dress Pants", "Jeans"],
  "Bomber Jacket": ["Jeans", "Track Pants"],
  "Windbreaker": ["Cargo Pants", "Track Pants"],
  "Leather Jacket": ["Jeans", "Chinos"],
  "Parka": ["Jeans", "Track Pants"],
  "Trench Coat": ["Dress Pants", "Jeans"],
  "Puffer Jacket": ["Jeans", "Sweatpants"],

  // 👖 Bottoms
  "Jeans": ["T-shirt", "Shirt", "Blouse", "Sweater", "Jacket", "Hoodie", "Turtleneck"],
  "Chinos": ["T-shirt", "Shirt", "Blazer", "Sweater"],
  "Dress Pants": ["Shirt", "Blouse", "Turtleneck", "Blazer"],
  "Shorts": ["T-shirt", "Tank Top", "Shirt", "Crop Top"],
  "Skirt": ["Blouse", "T-shirt", "Sweater", "Crop Top"],
  "Leggings": ["Sweater", "Hoodie", "Crop Top"],
  "Track Pants": ["Hoodie", "Athletic Shirt", "T-shirt"],
  "Cargo Pants": ["T-shirt", "Hoodie", "Jacket"],
  "Sweatpants": ["Hoodie", "T-shirt", "Athletic Shirt"],

  // 👗 Dresses
  "Casual Dress": ["Sneakers", "Flats", "Sandals"],
  "Formal Dress": ["Heels", "Dress Shoes", "Clutch"],
  "Cocktail Dress": ["Heels", "Clutch", "Jewelry"],
  "Sundress": ["Sandals", "Flats", "Sun Hat"],
  "Maxi Dress": ["Flats", "Heels", "Jewelry"],
  "Mini Dress": ["Heels", "Sneakers", "Jacket"],
  "Evening Gown": ["Heels", "Formal Shoes", "Jewelry"],
  "Wrap Dress": ["Heels", "Flats", "Clutch"],

  // 👔 Formal
  "Suit": ["Dress Shirt", "Formal Shoes", "Tie"],
  "Tuxedo": ["Dress Shirt", "Bow Tie", "Formal Shoes"],
  "Dress Shirt": ["Dress Pants", "Suit", "Chinos"],
  "Vest": ["Dress Shirt", "Dress Pants"],
  "Bow Tie": ["Tuxedo", "Suit"],
  "Formal Shoes": ["Suit", "Dress Pants"],
  "Gown": ["Heels", "Clutch", "Jewelry"],
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
    const primaryColor = data?.primary_color;
    const matchColors = colorPairings[primaryColor] || [];
    
    const matchSubCategories = subcategoryMatches[data?.sub_category] || [];
    // 3️⃣ Fetch wardrobe items that match the color pairing
    const { data: matchingItems, error: matchError } = await supabase
      .from("clothing_items")
      .select("*")
      .eq("user_id", user_id)
      .in("primary_color", matchColors)
      .in("sub_category", matchSubCategories)
      .neq("id", id); // exclude current item

    if (matchError) {
      console.warn("⚠️ Error fetching matching items:", matchError.message);
    }

    return res.json({
      data,
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
