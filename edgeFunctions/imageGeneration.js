import { supabase } from "../config/supabaseClient.js";
import { OpenAI } from "openai";

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuration
const RATE_LIMIT = 5; // 5 requests per minute
const QUEUE_NAME = "image_generation";

// Helper function to add message back to queue
const requeueMessage = async (message, error) => {
  try {
    const body = typeof message.message === "string"
      ? JSON.parse(message.message)
      : message.message;

    console.log(`⏳ Re-queueing failed message for item ${body.itemId}`);

    await supabase.schema("pgmq_public").rpc("send", {
      queue_name: QUEUE_NAME,
      message: body,
      sleep_seconds: 10, // Delay retry by 10 seconds
    });

    console.log(`✅ Successfully re-queued message for item ${body.itemId}`);
  } catch (requeueError) {
    console.error(
      `❌ Failed to re-queue message:`,
      requeueError,
      "Original error:",
      error
    );
  }
};

// Process queue function that will be called by cron every 5 seconds
export const processImageGenerationQueue = async () => {
  try {
    // 1. Check current rate limit usage from database
    const { data: rateLimitData, error: rateLimitError } = await supabase
      .from("api_rate_limits")
      .select("*")
      .eq("api_name", "openai_image_generation")
      .single();
    if (rateLimitError && rateLimitError.code !== "PGRST116") {
      console.error("❌ Error checking rate limits:", rateLimitError);
      return { success: false, message: "Failed to check rate limits" };
    }

    // 2. Calculate how many requests we can make in this window
    const now = new Date();
    let currentCount = 0;
    let windowStart = now;

    if (rateLimitData) {
      // If we have an existing rate limit record
      windowStart = new Date(rateLimitData.window_start);
      const windowEnd = new Date(windowStart.getTime() + 60000); // 1 minute window

      // If window has expired, reset count and window
      if (now >= windowEnd) {
        windowStart = now;
        currentCount = 0;
      } else {
        currentCount = rateLimitData.request_count;
      }
    }
    // Abort if we've hit the rate limit
    if (currentCount >= RATE_LIMIT) {
      return {
        success: true,
        message: "Rate limit reached, waiting for window to reset",
        processed: 0,
      };
    }

    // 3. Calculate how many requests we can process
    const remainingCapacity = RATE_LIMIT - currentCount;

    // 4. Pop multiple messages from queue up to our capacity limit
    const messagesToProcess = [];

    for (let i = 0; i < remainingCapacity; i++) {
      const { data: message, error: popError } = await supabase
        .schema("pgmq_public")
        .rpc("pop", { queue_name: QUEUE_NAME });

      if (popError) {
        console.error("❌ Failed to pop from queue:", popError);
        break;
      }
      // No more messages in queue
      if (!message || !(message && message.length)) break;

      // Add to our list to process
      messagesToProcess.push(message[0]);
    }

    // If we have no messages to process, we're done
    if (messagesToProcess.length === 0) {
      return {
        success: true,
        message: "No messages in queue to process",
        processed: 0,
      };
    }

    // 5. Update rate limit in database IMMEDIATELY (before processing)
    const newCount = currentCount + messagesToProcess.length;

    try {

    if (rateLimitData) {
      // Update existing record
      await supabase
        .from("api_rate_limits")
        .update({
          request_count: newCount,
          window_start: windowStart.toISOString(),
          last_updated: now.toISOString(),
        })
        .eq("id", rateLimitData.id);
    } else {
      // Create new record
      await supabase.from("api_rate_limits").insert({
        api_name: "openai_image_generation",
        request_count: newCount,
        window_start: windowStart.toISOString(),
        last_updated: now.toISOString(),
      });
    }
    } catch (error) {
      console.error("❌ Error updating rate limit:", error);
      Promise.all(messagesToProcess.map(message => requeueMessage(message, error)));
      return { success: false, message: "Error updating rate limit" };
    }

    // 6. Process all messages in parallel
    const processPromises = messagesToProcess.map((message) => {
      try {
        const body =
          typeof message.message === "string"
            ? JSON.parse(message.message)
            : message.message;

        return generateAndSaveImage(body)
          .then((result) => {
            if (!result.success) {
              // If processing failed, requeue the message
              return requeueMessage(message, result.error).then(() => result);
            }
            return result;
          })
          .catch((error) => {
            console.error("❌ Error processing message:", error);
            // Requeue the message if an error occurred
            return requeueMessage(message, error).then(() => ({
              success: false,
              error,
              requeued: true,
            }));
          });
      } catch (parseError) {
        console.error("❌ Error parsing message:", parseError);
        // Requeue the message if parsing failed
        return requeueMessage(message, parseError).then(() => ({
          success: false,
          error: parseError,
          requeued: true,
        }));
      }
    });

    // Start all processing in parallel and don't wait for completion
    // This allows the cron function to complete quickly
    Promise.all(processPromises)
      .then((results) => {
        const successCount = results.filter((r) => r.success).length;
        const failCount = results.length - successCount;
        const requeuedCount = results.filter((r) => r.requeued).length;

        console.log(
          `✅ Processed ${messagesToProcess.length} items: ${successCount} successful, ${failCount} failed, ${requeuedCount} requeued`
        );
      })
      .catch((error) => {
        console.error("❌ Error in parallel processing:", error);
      });

    // 7. Return success immediately after starting the parallel processing
    return {
      success: true,
      message: `Started processing ${messagesToProcess.length} items from queue`,
      processed: messagesToProcess.length,
    };
  } catch (error) {
    console.error("❌ Error in image queue processor:", error);
    return { success: false, message: "Error processing queue" };
  }
};

const generateAndSaveImage = async (body) => {
  try {
    const { textPrompt, itemId } = body;
    const imageGen = await openai.images.generate({
      model: "dall-e-3",
      prompt: textPrompt,
      size: "1024x1024",
      n: 1,
    });

    const generatedUrl = imageGen?.data?.[0]?.url;

    let finalImageUrl = "";
    try {
      if (generatedUrl) {
        const response = await fetch(generatedUrl);
        const buffer = await response.arrayBuffer();

        const imagePath = `wardrobe/generated_${Date.now()}_${Math.random()}.png`;

        const { data: uploaded, error: uploadError } = await supabase.storage
          .from("wardrobe")
          .upload(imagePath, Buffer.from(buffer), {
            contentType: "image/png",
          });

        if (uploadError) {
          console.warn(
            "⚠️ Supabase Upload Failed. Using fallback image.",
            uploadError
          );
          return {
            success: false,
            message: "Supabase Upload Failed.",
          };
        } else {
          finalImageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/wardrobe/${uploaded.path}`;
        }
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch/upload generated image:", err);
      return {
        success: false,
        message: "Failed to fetch/upload generated image.",
      };
    }

    const { data: clothingItem, error: dbError } = await supabase
      .from("clothing_items")
      .update({ image_url: finalImageUrl })
      .eq("id", itemId);

    if (dbError) {
      console.error("❌ Database Update Error:", dbError);
      return {
        success: false,
        message: "Database Update Error.",
      };
    }

    return {
      success: true,
      message: "Image generated and saved successfully.",
    };
  } catch (genErr) {
    console.warn("⚠️ Failed to generate image for item:", genErr);
    return {
      success: false,
      message: "Failed to generate image",
      error: genErr,
    };
  }
};

// Export the generateAndSaveImage function
export { generateAndSaveImage };
