import express from "express";
import multer from "multer";
import { supabase } from "../config/supabaseClient.js";
import { OpenAI } from "openai";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// // Add clothing item to wardrobe with AI analysis
// router.post("/add", authenticateUser, upload.single("image"), async (req, res) => {
//   try {
//     const { category, subCategory, material, brand, fit } = req.body || {};
//     // Validate required fields
//     if (!req.file) return res.status(400).json({ error: "No image uploaded." });
//     if (!category) return res.status(400).json({ error: "No category provided." });
//     if (!subCategory) return res.status(400).json({ error: "No subCategory provided." });
    
//     // Log received data
   
    
//     // 1. Upload image to Supabase Storage
//     const imageBuffer = req.file.buffer;
//     const filePath = `wardrobe_${Date.now()}.jpg`;
    
//     const { data: uploadData, error: uploadError } = await supabase.storage
//       .from("wardrobe")
//       .upload(filePath, imageBuffer, { contentType: "image/jpeg" });
      
//     if (uploadError) {
//       console.error("❌ Supabase Upload Error:", uploadError);
//       return res.status(500).json({ error: "Error uploading image to Supabase." });
//     }
    
//     const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/wardrobe/${uploadData.path}`;
    
//     // 2. Generate AI prompt for clothing analysis
//     const prompt = getClothingAnalysisPrompt();
    
//     // 3. Call OpenAI API for clothing analysis
//     const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
//     const aiResponse = await openai.chat.completions.create({
//       model: "gpt-4o",
//       messages: [
//         { role: "system", content: prompt },
//         {
//           role: "user",
//           content: [
//             { 
//               type: "text", 
//               text: `Analyze this clothing item. User provided: Category: ${category}, Subcategory: ${subCategory}${material ? `, Material: ${material}` : ''}${brand ? `, Brand: ${brand}` : ''}${fit ? `, Fit: ${fit}` : ''}` 
//             },
//             { type: "image_url", image_url: { url: imageUrl } },
//           ],
//         },
//       ],
//     });
    
//     // 4. Process AI response
//     if (!aiResponse?.choices?.[0]?.message?.content) {
//       console.error("❌ OpenAI Response Error: No valid response received");
//       return res.status(500).json({ error: "Error processing AI response." });
//     }
    
//     let rawResponse = aiResponse.choices[0].message.content.trim();
//     if (rawResponse.startsWith("```json")) rawResponse = rawResponse.replace("```json", "").trim();
//     if (rawResponse.endsWith("```")) rawResponse = rawResponse.replace("```", "").trim();
    
//     let analysisResult;
//     try {
//       analysisResult = JSON.parse(rawResponse);
//     } catch (parseError) {
//       console.error("❌ Failed to parse OpenAI response:", parseError);
//       return res.status(500).json({ error: "Invalid AI response format." });
//     }
    
//     // 5. Store clothing item with AI analysis in database
//     const { data: clothingItem, error: dbError } = await supabase
//       .from("clothing_items")
//       .insert([
//         {
//           // User provided data
//           user_id: req?.user?.id, // If using authentication
//           category,
//           sub_category: subCategory,
//           material: material || analysisResult.material,
//           brand: brand || null,
//           fit_type: fit || null,
//           image_url: imageUrl,
          
//           // AI analyzed data
//           name: analysisResult.suggested_name || `${analysisResult.primary_color || ''} ${subCategory}`,
//           colors: analysisResult.colors,
//           primary_color: analysisResult.primary_color,
//           pattern: analysisResult.pattern,
//           seasons: analysisResult.seasons,
//           occasions: analysisResult.occasions,
//           style_tags: analysisResult.style_tags,
//           analysis_json: analysisResult,
//         },
//       ])
//       .select();
      
//     if (dbError) {
//       console.error("❌ Database Insert Error:", dbError);
//       return res.status(500).json({ error: "Error saving clothing item to database." });
//     }
    
//     // 6. Return success with the combined data
//     return res.status(201).json({
//       message: "Clothing item added successfully",
//       item: clothingItem[0],
//     });
    
//   } catch (error) {
//     console.error("❌ Server Error:", error);
//     return res.status(500).json({ error: "Internal Server Error" });
//   }
// });

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
    const supabaseUrl = process.env.SUPABASE_URL;
    const prompt = `
      You are an advanced fashion AI trained to analyze outfit images and extract structured metadata for each clothing item. Your task is to identify all clothing and accessory pieces in the given image and return a structured JSON response containing their metadata.

      Extraction Guidelines:
      For each detected item, classify it based on the following attributes:
      
      1. **Category**: The general type of clothing (e.g., "Tops", "Bottoms", "Footwear", "Accessories").
      2. **Subcategory**: A more specific type (e.g., "Sweatshirt", "Joggers", "Sneakers", "Hat", "Bag").
      3. **Material**: The primary fabric or material used (e.g., "Cotton blend", "Denim", "Synthetic", "Leather").
      4. **Fit**: How the item fits on the body (e.g., "Relaxed", "Slim", "Oversized", "Regular").
      5. **Colors**: A list of all detected colors in the item (e.g., ["Black", "White", "Red"]).
      6. **Primary Color**: The dominant color of the item (e.g., "Navy Blue").
      7. **Pattern**: Any notable patterns (e.g., "Solid", "Striped", "Graphic Print", "Logo-based").
      8. **Seasons**: The most suitable seasons to wear the item (e.g., ["Summer", "Winter"]).
      9. **Occasions**: The types of events this item is suitable for (e.g., ["Casual", "Streetwear", "Work", "Formal"]).
      10. **Style Tags**: Keywords that best describe the item's fashion style (e.g., ["Minimalist", "Sporty", "Trendy", "Vintage"]).
      11. **Image URL** (if available): A cropped version of the detected clothing item.

      Return the JSON output in this exact format:
      {
        "items": [
          {
            "category": "Tops",
            "subcategory": "Sweatshirt",
            "material": "Cotton blend",
            "fit": "Relaxed",
            "colors": ["Navy Blue"],
            "primary_color": "Navy Blue",
            "pattern": "Solid",
            "seasons": ["Fall", "Winter"],
            "occasions": ["Streetwear", "Casual"],
            "style_tags": ["Supreme", "Streetwear", "Cozy"]
          }
        ]
      }
    `;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tempImageUrl = `${supabaseUrl}/storage/v1/object/public/temp/${filePath}`;
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
            { type: "image_url", image_url: { url: tempImageUrl } },
          ],
        },
      ],
    });

    let rawResponse = aiResponse.choices[0].message.content.trim();
    if (rawResponse.startsWith("```json")) rawResponse = rawResponse.replace("```json", "").trim();
    if (rawResponse.endsWith("```")) rawResponse = rawResponse.replace("```", "").trim();

    let analysisResult;
    try {
      analysisResult = JSON.parse(rawResponse);
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

    const insertedItems = [];

    for (const item of analysisResult.items) {
      const { data: clothingItem, error: dbError } = await supabase
        .from("clothing_items")
        .insert([
          {
            user_id: req?.user?.id,
            category: category || item.category,
            sub_category: subCategory || item.subcategory,
            material: material || item.material,
            brand: brand || null,
            fit_type: fit || item.fit,
            image_url: imageUrl,
            name: item.suggested_name || `${item.primary_color || ''} ${item.subcategory}`,
            colors: item.colors,
            primary_color: item.primary_color,
            pattern: item.pattern,
            seasons: item.seasons,
            occasions: item.occasions,
            style_tags: item.style_tags,
            analysis_json: item,
          },
        ])
        .select();

      if (dbError) {
        console.error("❌ Database Insert Error:", dbError);
        return res.status(500).json({ error: "Error saving clothing item to database." });
      }

      insertedItems.push(clothingItem[0]);
    }

    return res.status(201).json({
      message: "Clothing items added successfully",
      items: insertedItems,
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