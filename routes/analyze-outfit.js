import express from "express";
import multer from "multer";
import { OpenAI } from "openai";
import { supabase } from "../config/supabaseClient.js";
import { v4 as uuidv4 } from "uuid";
import { authenticateUser } from "../middleware/authMiddleware.js";
import { trackEvent } from "../mixpanel.js";
import fs from "fs";
import path from "path";
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.post("/", upload.single("image"), async (req, res) => {
  try {
    // **1️⃣ Validate Request**
    if (!req.file) {
      console.error("❌ No image uploaded");
      return res.status(400).json({ error: "No image uploaded." });
    }

    const { occasion, session_token } = req.body;
    const file = req.file;
    const supabaseUrl = process.env.SUPABASE_URL;
    const filePath = `outfit_${Date.now()}.jpg`;
    const newSessionToken = session_token || uuidv4();

    // Start image upload right away (don't wait for auth)
    const imageUploadPromise = supabase.storage
      .from("outfits")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    // Extract auth tokens
    let accessToken = req.cookies.access_token;
    let refreshToken = req.cookies.refresh_token;

    if (!accessToken && req.headers.authorization?.startsWith("Bearer ")) {
      accessToken = req.headers.authorization.split(" ")[1];
    }

    // Authentication and user profile fetching (runs in parallel with image upload)
    let user = null;
    let isPremium = false;
    let userProfile = null;

    const authPromise = (async () => {
      if (!accessToken) return null;

      const { data, error } = await supabase.auth.getUser(accessToken);

      if (error || !data.user) {
        if (refreshToken) {
          const { data: refreshedSession, error: refreshError } =
            await supabase.auth.refreshSession({
              refresh_token: refreshToken,
            });

          if (!refreshError) {
            user = refreshedSession.user;
            res.cookie("access_token", refreshedSession.access_token, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "Strict",
            });
            res.cookie("refresh_token", refreshedSession.refresh_token, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "Strict",
            });
          }
        }
      } else {
        user = data.user;
      }

      // If we have a user, fetch and update profile in one operation
      if (user?.id) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("is_premium, ai_outfit_analysis_count")
          .eq("id", user.id)
          .single();

        if (!profileError) {
          userProfile = profile;
          isPremium = profile?.is_premium || true;

          // Fire and forget the counter update (don't await)
          supabase
            .from("profiles")
            .update({
              ai_outfit_analysis_count:
                (profile?.ai_outfit_analysis_count || 0) + 1,
            })
            .eq("id", user.id);
        }
      }
    })();

    // Wait for both auth and image upload to complete
    const [, { data: uploadData, error: uploadError }] = await Promise.all([
      authPromise,
      imageUploadPromise,
    ]);

    if (uploadError) {
      console.error("❌ Supabase Upload Error:", uploadError);
      return res
        .status(500)
        .json({ error: "Error uploading image to Supabase." });
    }

    const imageUrl = `${supabaseUrl}/storage/v1/object/public/outfits/${uploadData.path}`;
    const user_id = user?.id || null;

    // Generate AI prompt based on isPremium status
    const prompt = getPromptForOccasion(occasion || "casual", true);

    // Call OpenAI for analysis
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this outfit image for the occasion: ${occasion}. Please make sure your response must contain only and only JSON and nothing else.`,
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
    });

    // **6️⃣ Validate OpenAI Response**
    if (
      !aiResponse ||
      !aiResponse.choices ||
      !aiResponse.choices[0]?.message?.content
    ) {
      console.error("❌ OpenAI Response Error: No valid response received");
      return res.status(500).json({ error: "Error processing AI response." });
    }

    let rawResponse = aiResponse.choices[0].message.content.trim();
    if (rawResponse.startsWith("```json"))
      rawResponse = rawResponse.replace("```json", "").trim();
    if (rawResponse.endsWith("```"))
      rawResponse = rawResponse.replace("```", "").trim();

    let analysisResult;
    try {
      analysisResult = JSON.parse(rawResponse);
    } catch (parseError) {
      console.error("❌ Failed to parse OpenAI response:", parseError);
      return res.status(500).json({ error: "Invalid AI response format." });
    }

    // Extract items for affiliate recommendations (prepare for parallel processing)
    const outfitItems = analysisResult?.items || [];
    const gender = analysisResult?.gender || "unisex";

    // Run database operations and affiliate recommendations in parallel
    const [dbResults, affiliateRecommendations] = await Promise.all([
      // Database operations in parallel
      (async () => {
        // Insert outfit analysis and get ID in one operation
        const { data: savedAnalysis, error: dbError } = await supabase
          .from("outfit_analyses")
          .insert([
            {
              user_id: user_id || null,
              session_token: user_id ? null : newSessionToken,
              image_url: imageUrl,
              overall_score: analysisResult?.overall_score ?? 0,
              analysis: analysisResult,
            },
          ])
          .select("id");

        if (dbError) {
          console.error("❌ Database Insert Error:", dbError);
          throw new Error("Error saving analysis to database.");
        }

        const outfit_id = savedAnalysis[0].id;

        // Insert shared outfit data in parallel (don't block on this)
        const { data: sharedData, error: sharedError } = await supabase
          .from("shared_outfits")
          .insert([
            {
              outfit_id,
              user_id,
              image_url: imageUrl,
              analysis_json: analysisResult,
              is_private: false,
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          ])
          .select("id")
          .single();

        if (sharedError) {
          console.error("⚠️ Failed to create shareable link:", sharedError);
        }

        return { savedAnalysis, sharedData };
      })(),

      // Affiliate recommendations (optimized)
      getAffiliateRecommendations(outfitItems, gender),
    ]);

    // Track event (fire and forget)
    trackEvent(user_id || 'Guest', "Outfit Analyzed", {
      isPremium,
      imageUrl,
    });

    // Final response
    return res.json({
      imageUrl,
      outfit_id: dbResults.savedAnalysis,
      ...analysisResult,
      affiliateRecommendations,
      link_id: dbResults.sharedData,
      isPremium,
      session_token: user_id ? null : newSessionToken,
    });
  } catch (error) {
    console.error("❌ API Error:", error);

    trackEvent("", "API Failure", {
      error: error?.message ?? "Error Message",
      type: "signup",
    });

    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// Optimized affiliate recommendation function
const getAffiliateRecommendations = async (items, gender) => {
  // If no items or empty array, return empty array
  if (!items || items.length === 0) return [];

  // For female users - process with a single query
  if (gender === "female") {
    const { data, error } = await supabase
      .from("affiliate_products")
      .select("*")
      .in("gender", ["female", "unisex"])
      .limit(20);

    if (error) {
      console.error("❌ Error fetching female recommendations:", error.message);
      return [];
    }

    return data.map((p) => ({
      ...p,
      reason: "Recommended for your style",
      source_item: null,
    }));
  }

  // For male/unisex users - optimize by doing a single query with all matchable items
  const complementMap = {
    // 👕 Tops
    "t shirt": ["Jeans", "Shorts", "Sneakers", "Jacket"],
    shirt: ["Chinos", "Dress Pants", "Loafers", "Blazer"],
    blouse: ["Skirt", "Trousers", "Heels", "Cardigan"],
    sweater: ["Jeans", "Leggings", "Boots", "Coat"],
    hoodie: ["Sweatpants", "Track Pants", "Sneakers", "Beanie"],
    "tank top": ["Shorts", "Skirt", "Sandals"],
    turtleneck: ["Dress Pants", "Coat", "Boots"],
    cardigan: ["Dress", "Leggings", "Flats"],
    "crop top": ["High-Waist Jeans", "Skirt", "Sneakers"],
    jacket: ["T-Shirt", "Jeans", "Boots"],
    coat: ["Turtleneck", "Dress Pants", "Formal Shoes"],
    blazer: ["Shirt", "Chinos", "Loafers"],
    "denim jacket": ["T-Shirt", "Jeans", "Sneakers"],
    "bomber jacket": ["T-Shirt", "Cargo Pants", "Sneakers"],
    windbreaker: ["Athletic Shirt", "Track Pants", "Athletic Shoes"],
    "leather jacket": ["T-Shirt", "Jeans", "Boots"],
    parka: ["Sweater", "Jeans", "Boots"],
    "trench coat": ["Turtleneck", "Formal Shoes", "Dress Pants"],
    "puffer jacket": ["Hoodie", "Track Pants", "Sneakers"],

    // 👖 Bottoms
    jeans: ["T-Shirt", "Sweater", "Sneakers", "Jacket"],
    chinos: ["Shirt", "Loafers", "Blazer"],
    "dress pants": ["Shirt", "Formal Shoes", "Blazer"],
    trousers: ["Shirt", "Formal Shoes", "Blazer"],
    shorts: ["Tank Top", "T-Shirt", "Sandals"],
    skirt: ["Blouse", "Heels", "Cardigan"],
    leggings: ["Sweater", "Tunic", "Sneakers"],
    "track pants": ["Athletic Shirt", "Hoodie", "Athletic Shoes"],
    " argo pants": ["T-Shirt", "Bomber Jacket", "Boots"],
    sweatpants: ["Hoodie", "Tank Top", "Sneakers"],

    // 👗 Dresses
    "casual dress": ["Cardigan", "Flats", "Crossbody Bag"],
    "formal dress": ["Heels", "Clutch", "Jewelry"],
    "cocktail dress": ["Heels", "Blazer", "Watch"],
    sundress: ["Sandals", "Sun Hat", "Tote Bag"],
    "maxi dress": ["Wedges", "Denim Jacket", "Crossbody Bag"],
    "mini dress": ["Heels", "Leather Jacket"],
    "evening gown": ["Heels", "Jewelry", "Clutch"],
    "wrap dress": ["Loafers", "Watch"],

    // 👟 Footwear
    sneakers: ["Jeans", "T-Shirt", "Bomber Jacket"],
    "dress shoes": ["Suit", "Dress Shirt", "Tuxedo"],
    boots: ["Jeans", "Sweater", "Leather Jacket"],
    sandals: ["Shorts", "Sundress", "Tank Top"],
    loafers: ["Chinos", "Shirt", "Blazer"],
    heels: ["Dress", "Skirt", "Blouse"],
    flats: ["Casual Dress", "Cardigan"],
    "athletic shoes": ["Workout Shorts", "Track Pants", "Hoodie"],
    slippers: ["Pajamas", "Robe"],
    "oxford shoes": ["Suit", "Dress Pants"],

    // 🎽 Activewear
    "athletic shirt": ["Workout Shorts", "Track Pants", "Sneakers"],
    "sports bra": ["Yoga Pants", "Athletic Jacket"],
    "workout shorts": ["Athletic Shirt", "Sneakers"],
    "yoga pants": ["Tank Top", "Sneakers"],
    "athletic jacket": ["Track Pants", "Athletic Shoes"],
    "compression wear": ["Track Suit"],
    dwimwear: ["Sunglasses", "Flip-Flops"],
    "track suit": ["Athletic Shoes", "Cap"],

    // 😴 Sleepwear
    pajamas: ["Slippers", "Robe"],
    robe: ["Sleep Shirt"],
    nightgown: ["Slippers"],
    loungewear: ["Slippers", "Cardigan"],

    // 👔 Formalwear
    suit: ["Dress Shirt", "Tie", "Formal Shoes"],
    tuxedo: ["Bow Tie", "Dress Shirt", "Formal Shoes"],
    "dress shirt": ["Blazer", "Chinos", "Formal Shoes"],
    vest: ["Suit", "Trousers"],
    "bow tie": ["Tuxedo"],
    "formal shoes": ["Suit", "Dress Pants"],
    gown: ["Heels", "Jewelry"],

    // 🎒 Accessories / Bags / Headwear
    belt: ["Chinos", "Shirt"],
    tie: ["Dress Shirt", "Suit"],
    scarf: ["Coat", "Sweater"],
    gloves: ["Coat", "Parka"],
    sunglasses: ["T-Shirt", "Swimwear"],
    jewelry: ["Dress", "Blouse"],
    watch: ["Shirt", "Blazer"],
    cufflinks: ["Tuxedo"],
    "pocket square": ["Suit"],
    "hair accessories": ["Blouse", "Dress"],
    backpack: ["T-Shirt", "Jacket"],
    clutch: ["Cocktail Dress", "Gown"],
    "tote bag": ["Sundress"],
    "messenger bag": ["Blazer", "Chinos"],
    "crossbody bag": ["Dress", "Cardigan"],
    wallet: ["Jeans"],
    cap: ["T-Shirt", "Bomber Jacket"],
    beanie: ["Hoodie", "Sweatpants"],
    "sun hat": ["Sundress"],
    fedora: ["Trench Coat"],
    "bucket hat": ["Casual Dress"],

    // 🧵 Others
    kurta: ["Ethnic Bottom", "Juttis"],
    uniform: ["Formal Shoes"],
    "traditional wear": ["Juttis", "Sherwani"],
    "Specialty Items": [],
  };

  // Collect all possible matches in one array
  const allMatchItems = [];
  const sourceMap = {}; // To track which source item matched which recommendations

  for (const item of items) {
    const matchItems = complementMap[item.toLowerCase()] || [];
    if (matchItems.length > 0) {
      allMatchItems.push(...matchItems);
      // Remember which source item suggested each match item
      matchItems.forEach((matchItem) => {
        sourceMap[matchItem] = item;
      });
    }
  }

  // If no matches found, return empty array
  if (allMatchItems.length === 0) return [];

  // Make a single query for all potential matches
  const { data, error } = await supabase
    .from("affiliate_products")
    .select("*")
    .in("subcategory", allMatchItems)
    .in("gender", ["male", "unisex"])
    .limit(20); // Overall limit instead of per-item limit

  if (error || !data) {
    console.error("❌ Error fetching recommendations:", error?.message);
    return [];
  }

  // Map results to include reason and source_item
  return data.map((product) => ({
    ...product,
    reason: `Pairs well with ${
      sourceMap[product.subcategory] || "your outfit"
    }`,
    source_item: sourceMap[product.subcategory] || null,
  }));
};

// Original recommendAffiliatesFromOutfit function is replaced by getAffiliateRecommendations
// Keeping the rest of the router and functions intact
const recommendAffiliatesFromOutfit = async (items, gender = "unisex") => {
  return getAffiliateRecommendations(items, gender);
};

router.post("/map-analyses", async (req, res) => {
  try {
    const { user_id, session_token } = req.body;

    if (!user_id || !session_token) {
      return res
        .status(400)
        .json({ error: "Missing user_id or session_token" });
    }

    // **Update analyses where session_token matches**
    const { error } = await supabase
      .from("outfit_analyses")
      .update({ user_id })
      .match({ session_token });

    if (error) {
      console.error("❌ Error updating analyses:", error);
      return res.status(500).json({ error: "Failed to map analyses to user." });
    }

    return res.json({ message: "Successfully linked analyses to account." });
  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

const getPromptForOccasion = (occasion, isPremium) => {
  if (!isPremium) {
    // **Non-Premium Users: Basic Analysis, No Suggestions**
    switch (occasion.toLowerCase()) {
      case "casual": {
        const prompt = `You are a high-end fashion consultant providing **detailed casual outfit insights**. Analyze the outfit based on:
- **Comfort & Effortlessness**
- **Fabric Choice & Breathability**
- **Color Coordination**
- **Style Cohesion**
- **Layering & Accessories**
- **Weather Appropriateness**

Provide a **structured JSON** response with:
- **overall_score** (0-10): Overall evaluation of the outfit.
- **colors**: Array of dominant and secondary colors detected.
- Individual category scores with feedback, using the following keys: **Comfort, Fabric, ColorHarmony, StyleConsistency, LayeringAndAccessories, WeatherSuitability**  
- **suggestions**: At least 3 personalized outfit improvement ideas.  
- **alternative_outfit**: Suggest an alternative casual outfit with keys: **top, bottom, footwear, accessories**.

Example format:
{
  "overall_score": 8.7,
  "colors": ["Olive Green", "White", "Tan"],
  "Comfort": { "score": 9, "feedback": "Loose fit and cotton fabric make this very wearable for a casual day." },
  "Fabric": { "score": 8, "feedback": "Breathable material suitable for mild weather." },
  "ColorHarmony": { "score": 7, "feedback": "Neutral tones work well together, but lacks a pop element." },
  "StyleConsistency": { "score": 8, "feedback": "Laid-back vibe maintained across pieces." },
  "LayeringAndAccessories": { "score": 7, "feedback": "Minimal layering; sunglasses or watch could add style." },
  "WeatherSuitability": { "score": 9, "feedback": "Ideal for spring or early summer." },
  "suggestions": [
    "Add a light denim jacket for dimension.",
    "Swap sneakers for loafers for smart casual look.",
    "Consider a hat or cap for sunny days.",
  ],
  "alternative_outfit": {
    "top": "White linen shirt",
    "bottom": "Beige chinos",
    "footwear": "Espadrilles",
    "accessories": "Brown leather strap watch"
  }
}`;
        return prompt;
    }
      case "wedding": {
const prompt = `You are a fashion consultant providing **wedding outfit analysis**. Evaluate the outfit based on:
- **Elegance & Formality**
- **Wedding Appropriateness**

Provide a **structured JSON** response with:
- **Colors detected** in the outfit.
- **Overall Score (0-10).**
- **Brief feedback (1-2 sentences max) per category.**

Example format:
{
  "overall_score": 8.5,
  "colors": ["Blue", "Black", "White"],
  "Elegance": { "score": 7, "feedback": "The outfit is stylish but could use a richer fabric." },
  "Formality": { "score": 9, "feedback": "This outfit fits well within formal wedding settings." }
}`
          return prompt;
      }

      case "party": {
        const prompt = `You are a fashion expert providing **party outfit insights**. Analyze the outfit based on:
- **Trendiness**
- **Party Appropriateness**

Provide a **structured JSON** response with:
- **Colors detected** in the outfit.
- **Overall Score (0-10).**
- **Short feedback (1-2 sentences max) per category.**

Example format:
{
  "overall_score": 7.8,
  "colors": ["Red", "Black", "Gold"],
  "Trendiness": { "score": 7, "feedback": "The outfit is fashionable but could use a statement piece." }
}`;
        return prompt;
      }

      case "office": {
        const prompt = `You are a corporate stylist providing **office outfit analysis**. Analyze the outfit based on:
- **Professionalism**
- **Office Appropriateness**

Provide a **structured JSON** response with:
- **Colors detected** in the outfit.
- **Overall Score (0-10).**
- **Short feedback (1-2 sentences max) per category.**

Example format:
{
  "overall_score": 8.1,
  "colors": ["Navy", "White", "Brown"],
  "Professionalism": { "score": 8, "feedback": "This outfit is suitable for most office settings." }
}`;
        return prompt;
      }

      case "date": {
        const prompt = `You are a casual fashion consultant providing **basic date outfit insights**. Analyze the outfit based on:
- **Comfort**
- **Basic Trend Relevance**

Provide a **structured JSON** response with:
- **Colors detected** in the outfit.
- **Overall Score (0-10).**
- **Short feedback (1-2 sentences max) per category.**

Example format:
{
  "overall_score": 7.5,
  "colors": ["Blue", "Gray", "White"],
  "Comfort": { "score": 9, "feedback": "This outfit looks cozy and easygoing." }
}`;
        return prompt;
      }

      default: {
        const prompt = `You are a fashion consultant providing **basic outfit analysis**. Analyze the outfit based on:
- **General Fit**
- **Basic Color Coordination**

Provide a **structured JSON** response with:
- **Colors detected** in the outfit.
- **Overall Score (0-10).**
- **Short feedback (1-2 sentences max) per category.**`;
        return prompt;
      }
    }
  } else {
    // **Premium Users: Advanced Analysis, Full Insights, and Suggestions**
    switch (occasion.toLowerCase()) {
      case "wedding": {
        const prompt = `You are a high-end fashion consultant providing **detailed wedding outfit insights**. Analyze the outfit based on:
- **Elegance & Formality**
- **Fabric & Material Suitability**
- **Accessories & Layering for Refinement**
- **Weather Considerations**
- **Wardrobe Enhancement Suggestions**

Provide a **structured JSON** response with:
- **Overall Score (0-10).**
- **Scores (1-10) for each category.**
- **Colors detected in the outfit.**
- **5+ personalized outfit refinements.**
- **A key named "alternative_outfit"** suggesting an alternative composition.
- **Clothing items found in the image**
- **Gender of the person in image**
Example format:
{
  "overall_score": 9.4,
  "colors": ["Beige", "Brown", "White"],
  "Elegance": { "score": 9, "feedback": "The outfit exudes sophistication with its tailored fit and material choice." },
  "suggestions": [
    "Opt for a silk tie to enhance the formality.",
    "Consider a pocket square for a touch of elegance."
  ],
  "alternative_outfit": {
    "top": "Beige double-breasted blazer",
    "bottom": "Tailored charcoal gray dress pants"
  },
  "items": ["T Shirt", "Jeans"],
  "gender": "male"
}`;
        return prompt;
      }

      case "party": {
        const prompt = `You are a fashion expert analyzing **party outfits** for premium users. Assess the outfit based on:
- **Trend Relevance**
- **Color Boldness & Contrast**
- **Visual Impact & Styling**
- **Accessories & Layering for a Striking Look**

Provide a **structured JSON** response with:
- **Overall Score (0-10).**
- **Scores (1-10) for each category.**
- **Colors detected in the outfit.**
- **3+ targeted styling improvements.**
- **An alternative outfit using wardrobe items.**
- **Clothing items found in the image**
- **Gender of the person in image**
Example format:
{
  "overall_score": 8.9,
  "colors": ["Black", "Gold", "Red"],
  "Trendiness": { "score": 9, "feedback": "The outfit reflects current trends with a confident, edgy twist." },
  "suggestions": [
    "Add a leather jacket for a rebellious finish.",
    "Introduce metallic accents for extra flair."
  ],
  "alternative_outfit": {
    "top": "Black fitted shirt",
    "bottom": "Slim-fit red pants"
  },
  items:["T Shirt", "Jeans"],
  "gender":"male"
}`;
        return prompt;
      }

      case "office": {
        const prompt = `You are a workplace fashion consultant analyzing **professional office outfits** for premium users. Adapt your analysis to suit different work environments—corporate, creative, tech, or startup.
Evaluate the outfit based on:
- **Appropriateness for the Work Environment**
- **Fit & Neatness**
- **Balance of Comfort and Professionalism**
- **Styling Effort (accessories, color coordination, polish)**

Provide a **structured JSON** response with:
- **Overall Score (0-10).**
- **Scores (1-10) for each category.**
- **Colors detected in the outfit.**
- **5+ styling tips to enhance workplace readiness.**
- **An alternative work-friendly outfit suggestion.**
- **Clothing items found in the image**
- **Gender of the person in image**
Example format:
{
  "overall_score": 8.8,
  "colors": ["Olive", "Beige", "White"],
  "Workplace Fit": { "score": 9, "feedback": "The polo and chinos are great for a tech workplace—clean, modern, and comfortable." },
  "suggestions": [
    "Consider adding a casual blazer for meetings.",
    "Monochrome sneakers would complete the look neatly."
  ],
  "alternative_outfit": {
    "top": "Olive green polo",
    "bottom": "Beige chinos"
  },
  "items":["T Shirt", "Chinos"],
  "gender":"male"
}`;
        return prompt;
      }

      case "date": {
        const prompt = `You are a casual fashion expert analyzing **date night outfits** for premium users. Consider different date settings—dinner, movie, café, or outdoors.
Evaluate the outfit based on:
- **Balance of Comfort and Style**
- **Color Appeal and Coordination**
- **Accessories for a Thoughtful Touch**
- **Footwear Appropriateness for the Setting**

Provide a **structured JSON** response with:
- **Overall Score (0-10).**
- **Scores (1-10) for each category.**
- **Colors detected in the outfit.**
- **5+ personalized styling tips.**
- **An alternative outfit for date confidence.**
- **Clothing items found in the image**
- **Gender of the person in image**
Example format:
{
  "overall_score": 8.7,
  "colors": ["Blue", "Beige", "White"],
  "Comfort & Style": { "score": 9, "feedback": "Looks relaxed yet intentional—perfect for a casual date night." },
  "suggestions": [
    "Add a casual jacket for layering and polish.",
    "Go for leather sneakers to elevate the vibe."
  ],
  "alternative_outfit": {
    "top": "Fitted navy polo",
    "bottom": "Slim-fit khaki chinos"
  },
  "items": ["T Shirt", "Jeans"],
  "gender":"male"
}`;
        return prompt;
      }

      case "casual": {
        const prompt = `You are a high-end fashion consultant providing **casual outfit insights**. Assess the outfit on:
- **Comfort & Ease**
- **Fabric Quality & Breathability**
- **Color Coordination**
- **Style Cohesion**
- **Layering & Accessories**
- **Weather Appropriateness**

Provide a **structured JSON** response with:
- **overall_score** (0–10): Overall evaluation.
- **colors**: Array of primary and secondary colors.
- Individual category scores with feedback, using the following keys: **Comfort, Fabric, ColorHarmony, StyleConsistency, LayeringAndAccessories, WeatherSuitability**  
- **suggestions**: At least 3 personalized outfit improvement ideas.  
- **alternative_outfit**: Suggest an alternative casual outfit with keys: **top, bottom, footwear, accessories**.
- **Gender of the person in image**
Example:
{
  "overall_score": 8.7,
  "colors": ["Olive Green", "White", "Tan"],
  "Comfort": { "score": 9, "feedback": "Relaxed fit and cotton fabric are ideal for comfort." },
  "Fabric": { "score": 8, "feedback": "Breathable material works well for warm days." },
  "ColorHarmony": { "score": 7, "feedback": "Earthy tones blend well, though a contrast element could enhance it." },
  "StyleConsistency": { "score": 8, "feedback": "Outfit maintains a cohesive casual aesthetic." },
  "LayeringAndAccessories": { "score": 7, "feedback": "Add-ons like a cap or bracelet would enhance depth." },
  "WeatherSuitability": { "score": 9, "feedback": "Appropriate for spring or early summer." },
  "suggestions": [
    "Add a light jacket for layering.",
    "Try suede loafers for a refined casual twist.",
    "Include subtle accessories like a canvas watch."
  ],
  "alternative_outfit": {
    "top": "White linen shirt",
    "bottom": "Beige chinos",
    "footwear": "Espadrilles",
    "accessories": "Brown leather strap watch"
  },
  "items": ["T Shirt", "Jeans"],
  "gender":"male"
}`;
        return prompt;
      }

      default: {
        const prompt = `You are analyzing a general outfit for a premium user with in-depth styling insights.`;
        return prompt;
      }
    }
  }
};

export default router;
