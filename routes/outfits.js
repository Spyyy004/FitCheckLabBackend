import express from "express";
import multer from "multer";
import { supabase } from "../config/supabaseClient.js";
import { fetchWardrobeItems } from "./wardrobe.js";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { OpenAI } from "openai";

const router = express.Router();

router.post("/generate", authenticateUser, async (req, res) => {
  try {
    const userId = req?.user?.id;

    // Extract all possible filter parameters from query
    const {
      occasion,
      season,
      category,
      subCategory,
      color,
      pattern,
      material,
      brand,
    } = req.body;

    // Use the reusable function with all parameters
    const result = await fetchWardrobeItems({
      userId,
      occasion,
      season,
      category,
      subCategory,
      color,
      pattern,
      material,
      brand,
      fieldsToFetch:
        "id, user_id, name, image_url, category, sub_category, colors, primary_color, pattern, material",
    });

    const filteredItems = result?.filteredItems;

    if (!filteredItems?.length) {
      return res.json({ ...result });
    }


    // Step 2: Organize items by category for better AI processing
    const organizedItems = {};
    filteredItems.forEach((item) => {
      if (!organizedItems[item.category]) {
        organizedItems[item.category] = [];
      }

      organizedItems[item.category].push({
        id: item.id,
        name: item.name,
        category: item.category,
        subCategory: item.sub_category,
        primaryColor: item.primary_color,
        colors: item.colors,
        pattern: item.pattern,
        material: item.material,
      });
    });

    // Step 3: Generate prompt for the AI
    const prompt = getOutfitGenerationPrompt({
      occasion,
      season,
      wardrobeItems: organizedItems,
    });

    // Step 4: Call OpenAI API for outfit recommendation
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log("🤖 Sending request to OpenAI for outfit generation...");
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Generate a stylish outfit for ${
            occasion || "everyday wear"
          } in ${season || "current season"}.`,
        },
      ],
      temperature: 0.7, // Slight creativity in outfit combinations
    });

    // Step 5: Process AI response
    if (!aiResponse?.choices?.[0]?.message?.content) {
      console.error("❌ OpenAI Response Error: No valid response received");
      return res.status(500).json({ error: "Error processing AI response." });
    }

    console.log("✅ AI Outfit Recommendation Received");
    let rawResponse = aiResponse.choices[0].message.content.trim();
    if (rawResponse.startsWith("```json"))
      rawResponse = rawResponse.replace("```json", "").trim();
    if (rawResponse.endsWith("```"))
      rawResponse = rawResponse.replace("```", "").trim();

    console.log("rawResponse", rawResponse)
    let outfitRecommendation = {};
    try {
      outfitRecommendation = JSON.parse(rawResponse);
      console.log("Parsed AI outfit recommendation:", outfitRecommendation);
    } catch (parseError) {
      console.error("❌ Failed to parse OpenAI response:", parseError);
      return res.status(500).json({ error: "Invalid AI response format." });
    }

    return res.json({ ...result, ...outfitRecommendation });
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

function getOutfitGenerationPrompt({ occasion, season, wardrobeItems }) {
  return `You are an expert fashion stylist specializing in outfit creation and personal styling.
  
  Create a cohesive and stylish outfit from the user's wardrobe items based on the occasion and season.
  
  AVAILABLE WARDROBE ITEMS:
  ${JSON.stringify(wardrobeItems, null, 2)}
  
  PREFERENCES:
  - Occasion: ${occasion || "Casual/Everyday"}
  - Season: ${season || "Any"}
  
  INSTRUCTIONS:
  1. Select ONE item from each necessary category to create a complete outfit.
  2. Ensure the items complement each other in terms of color, pattern, and style.
  3. Consider the occasion and season in your selection.
  4. Not all categories may be necessary (e.g., you might not need accessories).
  5. If there are multiple good options in a category, choose the one that works best with the overall outfit.
  
  Provide a structured JSON response with:
  - selectedItems: Array of item IDs that make up the outfit
  - outfitName: A creative name for this outfit
  
  Example format:
  {
    "outfitName": "Casual Friday Chic",
    "selectedItems": ["item-id-1", "item-id-2", "item-id-3"],
  }
  
  Focus on creating a cohesive, fashionable outfit that makes sense for the specified context using only items from the user's wardrobe.
  Also only give me the response in JSON format which I have mentioned above, nothing else.`;
}

// Add an outfit to the user's collection
router.post("/add", authenticateUser, async (req, res) => {
  try {
    const userId = req?.user?.id;
    // Extract outfit data from request body
    const { 
      name, 
      itemIds, 
      occasion, 
      season 
    } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: "Outfit name is required." });
    }
    
    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: "At least one clothing item is required." });
    }
    
    console.log("📝 Adding new outfit:", {
      name,
      itemCount: itemIds.length,
      occasion: occasion || "Not specified",
      season: season || "Not specified"
    });
    
    // Store outfit in the database
    const { data: outfit, error } = await supabase
      .from("outfits")
      .insert([
        {
          user_id: userId,
          name,
          clothing_item_ids: itemIds,
          occasion: occasion || null,
          season: season || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ])
      .select();
    
    if (error) {
      console.error("❌ Database Insert Error:", error);
      return res.status(500).json({ error: "Error saving outfit to database." });
    }
    
    console.log(`✅ Outfit "${name}" saved with ID: ${outfit[0].id}`);
  
    
    // Return success response with the outfit data
    return res.status(201).json({
      message: "Outfit added successfully",
    });
    
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get all outfits for a user
router.get("/", authenticateUser, async (req, res) => {
  try {
    const userId = req?.user?.id;
    
    // Get all outfits for the user
    const { data: outfits, error } = await supabase
      .from("outfits")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("❌ Database Query Error:", error);
      return res.status(500).json({ error: "Error fetching outfits." });
    }
    
    // For each outfit, fetch the clothing items
    const outfitsWithItems = await Promise.all(outfits.map(async (outfit) => {
      const { data: items } = await supabase
        .from("clothing_items")
        .select("id, name, image_url, category, sub_category")
        .in("id", outfit.clothing_item_ids);
      
      return {
        ...outfit,
        items: items || []
      };
    }));
    
    return res.json({ outfits: outfitsWithItems });
    
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get a single outfit by ID
router.get("/:id", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req?.user?.id;
    
    // Get the outfit
    const { data: outfit, error } = await supabase
      .from("outfits")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    
    if (error) {
      console.error("❌ Database Query Error:", error);
      return res.status(404).json({ error: "Outfit not found." });
    }
    
    // Fetch the clothing items
    const { data: items } = await supabase
      .from("clothing_items")
      .select("id, name, image_url, category, sub_category, colors, primary_color")
      .in("id", outfit.clothing_item_ids);
    
    return res.json({ 
      outfit: {
        ...outfit,
        items: items || []
      }
    });
    
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Update an outfit
router.put("/:id", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req?.user?.id;
    
    // Extract outfit data from request body
    const { 
      name, 
      clothing_item_ids, 
      occasion, 
      season 
    } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: "Outfit name is required." });
    }
    
    if (!clothing_item_ids || !Array.isArray(clothing_item_ids) || clothing_item_ids.length === 0) {
      return res.status(400).json({ error: "At least one clothing item is required." });
    }
    
    // Update the outfit
    const { data: outfit, error } = await supabase
      .from("outfits")
      .update({
        name,
        clothing_item_ids,
        occasion: occasion || null,
        season: season || null,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", userId)
      .select();
    
    if (error) {
      console.error("❌ Database Update Error:", error);
      return res.status(500).json({ error: "Error updating outfit." });
    }
    
    if (!outfit || outfit.length === 0) {
      return res.status(404).json({ error: "Outfit not found or you don't have permission to update it." });
    }
    
    console.log(`✅ Outfit "${name}" updated successfully`);
    
    // Return success response with the updated outfit data
    return res.json({
      message: "Outfit updated successfully",
    });
    
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete an outfit
router.delete("/:id", authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req?.user?.id;
    
    // Delete the outfit
    const { error } = await supabase
      .from("outfits")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    
    if (error) {
      console.error("❌ Database Delete Error:", error);
      return res.status(500).json({ error: "Error deleting outfit." });
    }
    
    return res.json({ message: "Outfit deleted successfully" });
    
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
