// import OpenAI from "openai";



// /**
//  * Function to extract clothing metadata from an image using OpenAI API
//  * @param {string} imageUrl - The URL of the image to analyze
//  * @returns {Promise<object>} - The extracted metadata in JSON format
//  */
// async function analyzeClothingFromImage(imageUrl) {
//   try {
//     // Define the structured prompt
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
//       8. **Seasons**: The most suitable seasons to wear the item (e.g., ["Summer", "Winter"]).
//       9. **Occasions**: The types of events this item is suitable for (e.g., ["Casual", "Streetwear", "Work", "Formal"]).
//       10. **Style Tags**: Keywords that best describe the item's fashion style (e.g., ["Minimalist", "Sporty", "Trendy", "Vintage"]).
//       11. **Image URL** (if available): A cropped version of the detected clothing item.

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
//             "style_tags": ["Supreme", "Streetwear", "Cozy"],
//           }
//         ]
//       }
//     `;

//     // Make API request to OpenAI
//     const response = await openai.chat.completions.create({
//       model: "gpt-4o",
//       messages: [
//         { role: "system", content: "You are an expert fashion AI that extracts detailed metadata from clothing images." },
//         { role: "user", content: prompt },
//         {
//           role: "user",
//           content: [
//             { type: "text", text: "Analyze this outfit image and provide structured metadata for each detected clothing item." },
//             { type: "image_url", image_url: { url: imageUrl } },
//           ],
//         },
//       ],
//       max_tokens: 1000,
//     });

//     // Parse the OpenAI response
//     const rawContent = response.choices[0].message.content.trim();
//     const jsonResponse = JSON.parse(rawContent.replace(/```json|```/g, "").trim());

//     return jsonResponse;
//   } catch (error) {
//     console.error("❌ OpenAI API Error:", error);
//     return { error: "Failed to process the image." };
//   }
// }

// // Example usage
// (async () => {
//   const imageUrl = "https://itdkorjbpoddeiarmbji.supabase.co/storage/v1/object/public/outfits//outfit_1742448234076.jpg"; // Replace with actual image URL
//   const metadata = await analyzeClothingFromImage(imageUrl);
//   console.log("Extracted Clothing Metadata:", metadata);
// })();
