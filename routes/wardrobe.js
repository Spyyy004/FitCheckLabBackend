import express from "express";
import multer from "multer";
import { supabase } from "../config/supabaseClient.js";
import { OpenAI } from "openai";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Add clothing item to wardrobe with AI analysis
router.post("/add", authenticateUser, upload.single("image"), async (req, res) => {
  try {
    const { fit } = req.body || {};
    // Validate required fields
    if (!req.file) return res.status(400).json({ error: "No image uploaded." });
    
    // Log received data
    console.log("Form data received:", {
      fit: fit || "Not provided",
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });
    
    // 1. Upload image to Supabase Storage
    const imageBuffer = req.file.buffer;
    const filePath = `wardrobe_${Date.now()}.jpg`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("wardrobe")
      .upload(filePath, imageBuffer, { contentType: "image/jpeg" });
      
    if (uploadError) {
      console.error("❌ Supabase Upload Error:", uploadError);
      return res.status(500).json({ error: "Error uploading image to Supabase." });
    }
    
    const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/wardrobe/${uploadData.path}`;
    console.log("✅ Image uploaded successfully:", imageUrl);
    
    // 2. Generate AI prompt for clothing analysis
    const prompt = getClothingAnalysisPrompt();
    
    // 3. Call OpenAI API for clothing analysis
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    console.log("🤖 Sending request to OpenAI...");
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Analyze this clothing item. User provided: ${fit ? `, Fit: ${fit}` : ''}` 
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    
    // 4. Process AI response
    if (!aiResponse?.choices?.[0]?.message?.content) {
      console.error("❌ OpenAI Response Error: No valid response received");
      return res.status(500).json({ error: "Error processing AI response." });
    }
    
    console.log("✅ AI Response Received");
    let rawResponse = aiResponse.choices[0].message.content.trim();
    if (rawResponse.startsWith("```json")) rawResponse = rawResponse.replace("```json", "").trim();
    if (rawResponse.endsWith("```")) rawResponse = rawResponse.replace("```", "").trim();
    
    let analysisResult;
    try {
      analysisResult = JSON.parse(rawResponse);
      console.log("Parsed AI analysis:", analysisResult);
    } catch (parseError) {
      console.error("❌ Failed to parse OpenAI response:", parseError);
      return res.status(500).json({ error: "Invalid AI response format." });
    }
    
    // 5. Store clothing item with AI analysis in database
    const { data: clothingItem, error: dbError } = await supabase
      .from("clothing_items")
      .insert([
        {
          // User provided data
          user_id: req?.user?.id, // If using authentication
          category: analysisResult.category,
          sub_category: analysisResult.sub_category,
          material: analysisResult.material,
          brand: null,
          fit_type: fit || null,
          image_url: imageUrl,
          
          // AI analyzed data
          name: analysisResult.suggested_name || `${analysisResult.primary_color || ''} ${analysisResult.sub_category}`,
          colors: analysisResult.colors,
          primary_color: analysisResult.primary_color,
          pattern: analysisResult.pattern,
          seasons: analysisResult.seasons,
          occasions: analysisResult.occasions,
          style_tags: analysisResult.style_tags,
          analysis_json: analysisResult,
        },
      ])
      .select();
      
    if (dbError) {
      console.error("❌ Database Insert Error:", dbError);
      return res.status(500).json({ error: "Error saving clothing item to database." });
    }
    
    console.log(`✅ Clothing item saved with ID: ${clothingItem[0].id}`);
    
    // 6. Return success with the combined data
    return res.status(201).json({
      message: "Clothing item added successfully",
      item: clothingItem[0],
    });
    
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export async function fetchWardrobeItems({
  userId,
  occasion,
  season,
  category,
  subCategory,
  color,
  pattern,
  material,
  brand,
  fieldsToFetch,
}) {
  try {
    console.log("🔍 Fetching wardrobe items with parameters:", {
      userId,
      occasion,
      season,
      category,
      subCategory,
      color,
      pattern,
      material,
      brand,
    });

    if (!userId) {
      throw new Error("User ID is required");
    }

    // Fetch all wardrobe items for the user
    let query = supabase
      .from("clothing_items")
      .select()
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const { data: allItems, error: dbError } = await query;

    if (dbError) {
      console.error("❌ Database Fetch Error:", dbError);
      throw new Error(`Error fetching wardrobe items: ${dbError.message}`);
    }

    console.log(`✅ Retrieved ${allItems.length} wardrobe items`);

    // Filter items based on provided parameters
    const filteredItems = [];
    let excludedItems = [];
    const hasFilters = !!(occasion || season || category || subCategory || color || pattern || material || brand);
    const colors = color ? color.split(",").map(c => c.trim()) : null;
    if (hasFilters) {
      for (const item of allItems) {
      let includeItem = true;
      // Check all conditions
      if (occasion && (!item.occasions || !item.occasions.includes(occasion))) {
        includeItem = false;
      }

      if (includeItem && season && (!item.seasons || !item.seasons.includes(season))) {
        includeItem = false;
      }

      if (includeItem && category && item.category !== category) {
        includeItem = false;
      }

      if (includeItem && subCategory && item.sub_category !== subCategory) {
        includeItem = false;
      }

      if (includeItem && colors) {
        const colorMatch = item.primary_color && colors.includes(item.primary_color);
        const colorsArrayMatch = item.colors && item.colors.some(c => colors.includes(c));
        if (!colorMatch && !colorsArrayMatch) {
          includeItem = false;
        }
      }

      if (includeItem && pattern && item.pattern !== pattern) {
        includeItem = false;
      }

      if (includeItem && material && item.material !== material) {
        includeItem = false;
      }

      if (includeItem && brand && item.brand !== brand) {
        includeItem = false;
      }

      // Add to appropriate array
      if (includeItem) {
        filteredItems.push(item);
      } else {
        excludedItems.push(item);
      }
      }
    } else {
      excludedItems = allItems;
    }

    if (fieldsToFetch) {
      const fieldsArray = fieldsToFetch.split(',');
      filteredItems.forEach(item => {
        const filteredItem = fieldsArray.reduce((acc, field) => {
          if (item[field.trim()]) {
            acc[field.trim()] = item[field.trim()];
          }
          return acc;
        }, {});
        item = filteredItem;
      });
      excludedItems = excludedItems.map(item => {
        const filteredItem = fieldsArray.reduce((acc, field) => {
          if (item[field.trim()]) {
            acc[field.trim()] = item[field.trim()];
          }
          return acc;
        }, {});
        return filteredItem;
      });
    }

    console.log(`✅ Filtered ${filteredItems.length} wardrobe items with applied filters`);

    return {
      filteredItems,
      items: excludedItems,
      count: allItems.length,
      filters: {
        userId,
        occasion: occasion || null,
        season: season || null,
        category: category || null,
        subCategory: subCategory || null,
        color: color || null,
        pattern: pattern || null,
        material: material || null,
        brand: brand || null
      }
    };

  } catch (error) {
    console.error("❌ Wardrobe Items Fetch Error:", error);
    throw error;
  }
}

// Update existing GET endpoint to use the reusable function
router.get("/", authenticateUser, async (req, res) => {
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
    } = req.query;
    
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
      fieldsToFetch: "id, user_id, name, image_url, sub_category, colors, category"
    });
    
    return res.json(result);

  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


// Helper function to generate clothing analysis prompt
function getClothingAnalysisPrompt() {
  return `You are an expert fashion analyst specializing in wardrobe management. 
  Analyze the provided clothing item image and extract detailed information about it.

  Provide a structured JSON response with the following information:
  - category: The category of the item
  - sub_category: The subcategory of the item
  - primary_color: The dominant color of the item
  - colors: Array of all colors present in the item
  - pattern: The pattern type (solid, striped, plaid, floral, graphic, etc.)
  - material: Your best guess at the material (cotton, wool, silk, denim, polyester, etc.)
  - seasons: Array of seasons when this item would be appropriate ["summer", "winter", "fall", "spring"]
  - occasions: Array of occasions this item would be suitable for ["casual", "formal", "office", "party", "date", "wedding", "sport"]
  - style_tags: Array of style descriptors that match this item ["classic", "trendy", "vintage", "minimalist", "preppy", "bohemian", "sporty", etc.]
  - suggested_name: A concise name for this item based on its characteristics
  
  Example format:
  {
    "primary_color": "Navy",
    "colors": ["Navy", "White"],
    "pattern": "Striped",
    "material": "Cotton",
    "seasons": ["Spring", "Summer"],
    "occasions": ["Casual", "Beach", "Weekend"],
    "style_tags": ["Nautical", "Preppy", "Classic"],
    "suggested_name": "Navy Striped T-shirt",
  }

  Here is list of categories and subcategories:
  ${JSON.stringify({
  Tops: [
    "T-Shirt",
    "Shirt",
    "Blouse",
    "Sweater",
    "Hoodie",
    "Tank Top",
    "Turtleneck",
    "Cardigan",
    "Crop Top",
  ],
  Bottoms: [
    "Jeans",
    "Chinos",
    "Dress Pants",
    "Shorts",
    "Skirt",
    "Leggings",
    "Track Pants",
    "Cargo Pants",
    "Sweatpants",
  ],
  Dresses: [
    "Casual Dress",
    "Formal Dress",
    "Cocktail Dress",
    "Sundress",
    "Maxi Dress",
    "Mini Dress",
    "Evening Gown",
    "Wrap Dress",
  ],
  Outerwear: [
    "Jacket",
    "Coat",
    "Blazer",
    "Denim Jacket",
    "Bomber Jacket",
    "Windbreaker",
    "Leather Jacket",
    "Parka",
    "Trench Coat",
    "Puffer Jacket",
  ],
  Footwear: [
    "Sneakers",
    "Dress Shoes",
    "Boots",
    "Sandals",
    "Loafers",
    "Heels",
    "Flats",
    "Athletic Shoes",
    "Slippers",
    "Oxford Shoes",
  ],
  Accessories: [
    "Belt",
    "Tie",
    "Scarf",
    "Gloves",
    "Sunglasses",
    "Jewelry",
    "Watch",
    "Cufflinks",
    "Pocket Square",
    "Hair Accessories",
  ],
  Bags: [
    "Backpack",
    "Purse",
    "Tote Bag",
    "Messenger Bag",
    "Clutch",
    "Duffel Bag",
    "Crossbody Bag",
    "Briefcase",
    "Wallet",
  ],
  Headwear: [
    "Cap",
    "Beanie",
    "Sun Hat",
    "Fedora",
    "Baseball Cap",
    "Bucket Hat",
    "Beret",
  ],
  Activewear: [
    "Athletic Shirt",
    "Sports Bra",
    "Workout Shorts",
    "Yoga Pants",
    "Athletic Jacket",
    "Compression Wear",
    "Swimwear",
    "Track Suit",
  ],
  Sleepwear: [
    "Pajamas",
    "Robe",
    "Nightgown",
    "Loungewear",
    "Sleep Shorts",
    "Sleep Shirt",
  ],
  Formal: [
    "Suit",
    "Tuxedo",
    "Dress Shirt",
    "Vest",
    "Bow Tie",
    "Formal Shoes",
    "Gown",
  ],
  Other: ["Costume", "Uniform", "Traditional Wear", "Specialty Items"],
  })}

  categories is the main category of the item which is one of the keys in the above list and sub_category is the subcategory of the item which is one of the values in the above list corresponding to the main category.
  
  Focus on accuracy and detail in your analysis. If you can't determine something confidently, provide your best guess but keep it reasonable.`;
}

export default router;