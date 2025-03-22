import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
const router = express.Router();

// Add an Occasion
router.post("/add",authenticateUser, async (req, res) => {
  const userId = req?.user?.id;
  const { occasion, name, date_time, recurring, season, outfit_id } = req.body;

  const { data, error } = await supabase
    .from("occasions")
    .insert([{ user_id: userId, occasion, name, date_time, recurring, season, outfit_id }]);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Occasion added successfully", occasion: data });
});

// Get Occasions for a User
router.get("/",authenticateUser, async (req, res) => {
  const userId = req?.user?.id;
  
  try {
    // 1. Get all occasions for the user 
    const { data: occasions, error: occasionsError } = await supabase
      .from("occasions")
      .select("*")
      .eq("user_id", userId);

    if (occasionsError) 
      return res.status(400).json({ error: occasionsError.message });
    
    // Early return if no occasions found
    if (!occasions || occasions.length === 0) {
      return res.json({ occasions: [] });
    }
    
    // 2. Collect all outfit IDs that need to be fetched
    const outfitIds = occasions
      .filter(occasion => occasion.outfit_id)
      .map(occasion => occasion.outfit_id);
    
    // If no outfits to fetch, return just the occasions
    if (outfitIds.length === 0) {
      return res.json({ occasions });
    }
    
    // 3. Get all outfits in a single database call
    const { data: outfits, error: outfitsError } = await supabase
      .from("outfits")
      .select("*")
      .in("id", outfitIds);
      
    if (outfitsError) {
      console.error("Error fetching outfits:", outfitsError);
      // Return occasions without outfit data if there was an error
      return res.json({ occasions });
    }
    
    // 4. Create a map of outfit IDs to outfit data for quick lookup
    const outfitsMap = {};
    outfits.forEach(outfit => {
      outfitsMap[outfit.id] = outfit;
    });
    
    // 5. Collect all clothing item IDs that need to be fetched
    const clothingItemIds = outfits
      .flatMap(outfit => outfit.clothing_item_ids || [])
      .filter(id => id); // Filter out any null/undefined IDs
    
    // 6. Get all clothing items in a single database call
    let clothingItems = [];
    if (clothingItemIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from("clothing_items")
        .select("id, name, image_url, category, sub_category, colors, primary_color")
        .in("id", clothingItemIds);
        
      if (!itemsError && items) {
        clothingItems = items;
      } else {
        console.error("Error fetching clothing items:", itemsError);
      }
    }
    
    // 7. Create a map of clothing item IDs to item data for quick lookup
    const clothingItemsMap = {};
    clothingItems.forEach(item => {
      clothingItemsMap[item.id] = item;
    });
    
    // 8. For each outfit, attach its clothing items
    Object.keys(outfitsMap).forEach(outfitId => {
      const outfit = outfitsMap[outfitId];
      const outfitItemIds = outfit.clothing_item_ids || [];
      outfit.items = outfitItemIds
        .map(itemId => clothingItemsMap[itemId])
        .filter(item => item); // Filter out any undefined items
    });
    
    // 9. Merge occasion data with outfit data
    const occasionsWithOutfits = occasions.map(occasion => {
      if (occasion.outfit_id && outfitsMap[occasion.outfit_id]) {
        return {
          ...occasion,
          outfit: outfitsMap[occasion.outfit_id]
        };
      }
      return occasion;
    });
    
    return res.json({ occasions: occasionsWithOutfits });
    
  } catch (error) {
    console.error("Error in GET /occasions:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Delete an Occasion
router.delete("/:occasion_id", async (req, res) => {
  const { occasion_id } = req.params;

  const { data, error } = await supabase
    .from("occasions")
    .delete()
    .eq("id", occasion_id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Occasion deleted successfully" });
});

export default router;
