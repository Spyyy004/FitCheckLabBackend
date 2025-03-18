import express from "express";
import multer from "multer";
import { supabase } from "../config/supabaseClient.js";
import { OpenAI } from "openai";
import { authenticateUser } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Add clothing item to wardrobe with AI analysis
router.post("/add", upload.single("image"), async (req, res) => {
  try {
    const { category, subCategory, material, brand, fit } = req.body || {};
    
    // Validate required fields
    if (!req.file) return res.status(400).json({ error: "No image uploaded." });
    if (!category) return res.status(400).json({ error: "No category provided." });
    if (!subCategory) return res.status(400).json({ error: "No subCategory provided." });
    
    // Log received data
    console.log("Form data received:", {
      category,
      subCategory,
      material: material || "Not provided",
      brand: brand || "Not provided",
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
              text: `Analyze this clothing item. User provided: Category: ${category}, Subcategory: ${subCategory}${material ? `, Material: ${material}` : ''}${brand ? `, Brand: ${brand}` : ''}${fit ? `, Fit: ${fit}` : ''}` 
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
          user_id: req.user?.id, // If using authentication
          category,
          sub_category: subCategory,
          material: material || analysisResult.material,
          brand: brand || null,
          fit_type: fit || null,
          image_url: imageUrl,
          
          // AI analyzed data
          name: analysisResult.suggested_name || `${analysisResult.primary_color || ''} ${subCategory}`,
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


// Get all wardrobe items for a user
router.get("/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    
    const { data, error } = await supabase
      .from("clothing_items")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });
      
    if (error) {
      console.error("❌ Database Query Error:", error);
      return res.status(500).json({ error: "Error fetching wardrobe items." });
    }
    
    return res.json({ items: data });
    
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
  
  Focus on accuracy and detail in your analysis. If you can't determine something confidently, provide your best guess but keep it reasonable.`;
}

export default router;