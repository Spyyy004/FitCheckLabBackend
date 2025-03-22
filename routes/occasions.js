import express from "express";
import { supabase } from "../config/supabaseClient.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { trackEvent } from "../mixpanel.js";
const router = express.Router();

// Add an Occasion
router.post("/add",authenticateUser, async (req, res) => {
  const userId = req?.user?.id;
  const { occasion, name, date_time, recurring, season, outfit_id } = req.body;

  const { data, error } = await supabase
    .from("occasions")
    .insert([{ user_id: userId, occasion, name, date_time, recurring, season, outfit_id }]);

  if (error)
    {
      trackEvent(userId,"API Failure",{
        error : error?.message ?? "Error Message",
        type: "add-occassion"
      })
      return res.status(400).json({ error: error.message });
    }
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
    trackEvent("","API Failure",{
      error : error?.message ?? "Error Message",
      type: "get-occassion"
    })
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get a Specific Occasion by ID
router.get("/:id", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req?.user?.id;

    // 1. Get the specific occasion
    const { data: occasion, error: occasionError } = await supabase
      .from("occasions")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (occasionError) {
      if (occasionError.code === 'PGRST116') {
        return res.status(404).json({ error: "Occasion not found" });
      }
      return res.status(400).json({ error: occasionError.message });
    }

    // If no outfit_id, return just the occasion
    if (!occasion.outfit_id) {
      return res.json({ occasion });
    }

    // 2. Get the associated outfit
    const { data: outfit, error: outfitError } = await supabase
      .from("outfits")
      .select("*")
      .eq("id", occasion.outfit_id)
      .single();

    if (outfitError) {
      console.error("Error fetching outfit:", outfitError);
      // Return occasion without outfit data if there was an error
      return res.json({ occasion });
    }

    // 3. Get all clothing items in a single database call
    let clothingItems = [];
    if (outfit.clothing_item_ids && outfit.clothing_item_ids.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from("clothing_items")
        .select("id, name, image_url, category, sub_category, colors, primary_color, pattern, material")
        .in("id", outfit.clothing_item_ids);
        
      if (!itemsError && items) {
        clothingItems = items;
      } else {
        console.error("Error fetching clothing items:", itemsError);
      }
    }

    // 4. Add clothing items to the outfit
    const outfitWithItems = {
      ...outfit,
      items: clothingItems
    };

    // 5. Add outfit to the occasion
    const occasionWithOutfit = {
      ...occasion,
      outfit: outfitWithItems
    };

    return res.json({ occasion: occasionWithOutfit });
    
  } catch (error) {
    console.error("Error in GET /occasions/:id:", error);
    trackEvent("","API Failure",{
      error : error?.message ?? "Error Message",
      type: "get-single-occassion"
    })
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Delete an Occasion
router.delete("/:occasion_id", authenticateUser, async (req, res) => {
  const { occasion_id } = req.params;
  const userId = req?.user?.id;

  const { data, error } = await supabase
    .from("occasions")
    .delete()
    .eq("id", occasion_id)
    .eq("user_id", userId);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: "Occasion deleted successfully" });
});

// Create a new occasion with outfit data
export async function createOccasionWithOutfit(userId, occasionData, outfitId) {
  try {
    if (!userId || !outfitId) {
      throw new Error("User ID and outfit ID are required");
    }

    // Validate required fields
    if (!occasionData.name || !occasionData.occasion) {
      throw new Error("Occasion name and type are required");
    }

    // Prepare occasion data
    const newOccasion = {
      user_id: userId,
      outfit_id: outfitId,
      name: occasionData.name,
      occasion: occasionData.occasion,
      date_time: occasionData.date_time || new Date().toISOString(),
      recurring: occasionData.recurring || false,
      season: occasionData.season || null,
    };

    // Insert the occasion into the database
    const { data, error } = await supabase
      .from("occasions")
      .insert([newOccasion])
      .select();

    if (error) {
      console.error("Error creating occasion:", error);
      throw new Error(`Failed to create occasion: ${error.message}`);
    }

    return data[0];
  } catch (error) {
    console.error("❌ Error in createOccasionWithOutfit:", error);
    throw error;
  }
}

export default router;
