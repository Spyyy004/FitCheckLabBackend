import express from "express";
import multer from "multer";
import { supabase } from "../config/supabaseClient.js";
import { OpenAI } from "openai";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { trackEvent } from "../mixpanel.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });



// router.post("/add", authenticateUser, upload.array("image"), async (req, res) => {
//   try {
//     const { category, subCategory, material, brand, fit } = req.body || {};
//     const supabaseUrl = process.env.SUPABASE_URL;
//     const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

//     if (!req.files || req.files.length === 0) {
//       return res.status(400).json({ error: "No images uploaded." });
//     }

//     const prompt = `
//       You are an advanced fashion AI trained to analyze outfit images and extract structured metadata for each clothing item. Your task is to identify all clothing and accessory pieces in the given image and return a structured JSON response containing their metadata.

//       Extraction Guidelines:
//       For each detected item, classify it based on the following attributes:
//       1. **Category**: The general type of clothing (e.g., "Tops", "Bottoms", "Footwear", "Accessories").
//       2. **Subcategory**: A more specific type (e.g., "Sweatshirt", "Joggers", "Sneakers", "Hat", "Bag").
//       3. **Material**: The primary fabric or material used (e.g., "Cotton blend", "Denim", "Synthetic", "Leather").
//       4. **Fit**: How the item fits on the body (e.g., "Relaxed", "Slim", "Oversized", "Regular").
//       5. **Colors**: A list of all detected colors in the item (e.g., ["Black", "White", "Red"]).
//       6. **Primary Color**: The dominant color of the item (e.g., "Navy Blue").
//       7. **Pattern**: Any notable patterns (e.g., "Solid", "Striped", "Graphic Print", "Logo-based").
//       8. **Seasons**: All the seasons to wear the item. If it is a special item like Sherwani, Wedding Suit, Bikini, Swim Suit, then return the following as output : ["Summer", "Winter", "Fall", "Spring", "Rainy"].
//       9. **Occasions**: The types of events this item is suitable for (e.g., ["Casual", "Streetwear", "Work", "Formal"]).
//       10. **Style Tags**: Keywords that best describe the item's fashion style (e.g., ["Minimalist", "Sporty", "Trendy", "Vintage"]).
//       11. **Image URL**: Generate a cropped or focused image (AI-generated if needed) representing only the specific item. You may return base64 if generated OR provide a new hosted image link if inferred. Do NOT repeat the full outfit image.


//       Return the JSON output in this exact format:
//       {
//         "items": [
//           {
//             "category": "Tops",
//             "subcategory": "Sweatshirt",
//             "material": "Cotton blend",
//             "fit": "Relaxed",
//             "colors": ["Navy Blue"],
//             "primary_color": "Navy Blue",
//             "pattern": "Solid",
//             "seasons": ["Fall", "Winter"],
//             "occasions": ["Streetwear", "Casual"],
//             "style_tags": ["Supreme", "Streetwear", "Cozy"]
//           }
//         ]
//       }
//     `;

//     const insertedItems = [];

//     for (const file of req.files) {
//       const filePath = `wardrobe_${Date.now()}_${file.originalname}`;
//       const { data: uploadData, error: uploadError } = await supabase.storage
//         .from("wardrobe")
//         .upload(filePath, file.buffer, { contentType: file.mimetype });

//       if (uploadError) {
//         console.error("❌ Supabase Upload Error:", uploadError);
//         return res.status(500).json({ error: "Error uploading image to Supabase." });
//       }

//       const imageUrl = `${supabaseUrl}/storage/v1/object/public/wardrobe/${uploadData.path}`;

//       const aiResponse = await openai.chat.completions.create({
//         model: "gpt-4o",
//         messages: [
//           { role: "system", content: prompt },
//           {
//             role: "user",
//             content: [
//               {
//                 type: "text",
//                 text: `Analyze this clothing item.}`
//               },
//               { type: "image_url", image_url: { url: imageUrl } },
//             ],
//           },
//         ],
//       });

//       let rawResponse = aiResponse.choices[0].message.content.trim();
//       if (rawResponse.startsWith("```json")) rawResponse = rawResponse.replace("```json", "").trim();
//       if (rawResponse.endsWith("```")) rawResponse = rawResponse.replace("```", "").trim();

//       let analysisResult;
//       try {
//         analysisResult = JSON.parse(rawResponse);
//       } catch (parseError) {
//         console.error("❌ Failed to parse OpenAI response:", parseError);
//         return res.status(500).json({ error: "Invalid AI response format." });
//       }
      
//       for (const item of analysisResult.items) {
//         const images_url =  item.image_url || "https://media.istockphoto.com/id/1363802563/vector/clothes-hanger-vector-icon-hanger-isolated-vector-illustration-on-white-background.jpg?s=612x612&w=0&k=20&c=Qy85rXiOK7t4PRYlSk5JG4rk87FVhPgNn7Kfqo5tS7Y="
//         const { data: clothingItem, error: dbError } = await supabase
//           .from("clothing_items")
//           .insert([
//             {
//               user_id: req?.user?.id,
//               category: category || item.category,
//               sub_category: subCategory || item.subcategory,
//               material: material || item.material,
//               brand: brand || null,
//               fit_type: fit || item.fit,
//               image_url: analysisResult?.items?.length > 1 ? images_url : imageUrl,
//               name: item.suggested_name || `${item.primary_color || ''} ${item.subcategory}`,
//               colors: item.colors,
//               primary_color: item.primary_color,
//               pattern: item.pattern,
//               seasons: item.seasons,
//               occasions: item.occasions,
//               style_tags: item.style_tags,
//               analysis_json: item,
//             },
//           ])
//           .select();

//         if (dbError) {
//           console.error("❌ Database Insert Error:", dbError);
//           return res.status(500).json({ error: "Error saving clothing item to database." });
//         }

//         insertedItems.push(clothingItem[0]);
//       }
//       trackEvent(req?.user?.id, "Wardrobe",{
//         items: analysisResult?.items?.length,
//         type : "add-item"
//       })
//     }

//     return res.status(201).json({
//       message: "Clothing items added successfully",
//       items: insertedItems,
//     });
//   } catch (error) {
//     console.error("❌ Server Error:", error);
//     return res.status(500).json({ error: "Internal Server Error" });
//   }
// });


router.post("/add", authenticateUser, upload.array("image"), async (req, res) => {
  try {
    const { category, subCategory, material, brand, fit } = req.body || {};
    const supabaseUrl = process.env.SUPABASE_URL;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded." });
    }

    const insertedItems = [];

    for (const file of req.files) {
      const filePath = `wardrobe_${Date.now()}_${file.originalname}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("wardrobe")
        .upload(filePath, file.buffer, { contentType: file.mimetype });

      if (uploadError) {
        console.error("❌ Supabase Upload Error:", uploadError);
        return res.status(500).json({ error: "Error uploading image to Supabase." });
      }

      const imageUrl = `${supabaseUrl}/storage/v1/object/public/wardrobe/${uploadData.path}`;

      const analysisItems = await analyzeAndGenerateClothingItems({ imageUrl });

      for (const item of analysisItems) {
        const { data: clothingItem, error: dbError } = await supabase
          .from("clothing_items")
          .insert([
            {
              user_id: req?.user?.id,
              category: category || item["Category"],
              sub_category: subCategory || item["Subcategory"],
              material: material || item["Material"],
              brand: brand || null,
              fit_type: fit || item["Fit"],
              image_url: item.generated_image_url || imageUrl,
              name: item.suggested_name || `${item["Primary Color"] || ""} ${item["Subcategory"]}`,
              colors: item["Colors"],
              primary_color: item["Primary Color"],
              pattern: item["Pattern"],
              seasons: item["Seasons"],
              occasions: item["Occasions"],
              style_tags: item["Style Tags"],
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

      trackEvent(req?.user?.id, "Wardrobe", {
        items: analysisItems?.length,
        type: "add-item",
      });
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




// 🔹 Helper to download image from URL to buffer
const downloadImageToBuffer = async (url) => {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

// 🔹 Analyze clothing items and generate AI images
export async function analyzeAndGenerateClothingItems({ imageUrl }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = `You are an advanced fashion AI trained to analyze outfit images and extract structured metadata for each clothing item. Your task is to identify all clothing and accessory pieces in the given image and return a structured JSON response containing their metadata.

Extraction Guidelines:
For each detected item, classify it based on the following attributes:
1. Category: The general type of clothing (e.g., "Tops", "Bottoms", "Footwear", "Accessories").
2. Subcategory: A more specific type (e.g., "Sweatshirt", "Joggers", "Sneakers", "Hat", "Bag").
3. Material: The primary fabric or material used (e.g., "Cotton blend", "Denim", "Synthetic", "Leather").
4. Fit: How the item fits on the body (e.g., "Relaxed", "Slim", "Oversized", "Regular").
5. Colors: A list of all detected colors in the item (e.g., ["Black", "White", "Red"]).
6. Primary Color: The dominant color of the item (e.g., "Navy Blue").
7. Pattern: Any notable patterns (e.g., "Solid", "Striped", "Graphic Print", "Logo-based").
8. Seasons: All the seasons to wear the item. If it is a special item like Sherwani, Wedding Suit, Bikini, Swim Suit, then return all seasons.
9. Occasions: The types of events this item is suitable for. Occassions can be more than one but all of them must be one of these : ["Casual", "Office", "Wedding", "Party", "Date", "Workout", "Formal"].
10. Style Tags: Keywords that best describe the item's fashion style (e.g., ["Minimalist", "Sporty", "Trendy", "Vintage"]).
11. Image URL: Generate a cropped or focused image (AI-generated if needed) representing only the specific item.

✅ Output Format:
Return your response in the following valid JSON structure only (no commentary):
{
  "items": [
    {
      "Category": "Tops",
      "Subcategory": "Sweatshirt",
      "Material": "Cotton blend",
      "Fit": "Relaxed",
      "Colors": ["Navy Blue"],
      "Primary Color": "Navy Blue",
      "Pattern": "Solid",
      "Seasons": ["Fall", "Winter"],
      "Occasions": ["Streetwear", "Casual"],
      "Style Tags": ["Supreme", "Streetwear", "Cozy"],
      "Image URL": "URL_of_Sweatshirt_Image"
    }
  ]
}`;

  const analysisResponse = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this clothing item and return output in JSON only." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  let rawResponse = analysisResponse.choices[0].message.content.trim();
  if (rawResponse.startsWith("```json")) rawResponse = rawResponse.replace("```json", "").trim();
  if (rawResponse.endsWith("```")) rawResponse = rawResponse.replace("```", "").trim();

  let items;
  try {
    const parsed = JSON.parse(rawResponse);
    if (!parsed.items || !Array.isArray(parsed.items)) {
      console.error("❌ AI response does not contain an 'items' array.", parsed);
      return [];
    }
    items = parsed.items;
  } catch (err) {
    console.error("❌ Failed to parse AI response:", err);
    console.error("🔎 Raw Response:", rawResponse);
    return [];
  }

  const generatedItems = [];
  if(items?.length === 1){
    return [
      {
        ...items[0],
        imageUrl
      }
    ]
  }
  for (const item of items) {
    try {
      const textPrompt = `Product-style image of a ${item["Primary Color"] || "neutral"} ${item["Fit"] || "regular"} ${item["Material"] || "fabric"} ${item["Subcategory"] || item["Category"]}`;

      const imageGen = await openai.images.generate({
        model: "dall-e-3",
        prompt: textPrompt,
        n: 1
      });

      const generatedUrl = imageGen?.data?.[0]?.url;

      generatedItems.push({
        ...item,
        generated_image_url: generatedUrl,
      });
    } catch (genErr) {
      console.warn("⚠️ Failed to generate image for item:", item, genErr);
    }
  }

  return generatedItems;
}




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