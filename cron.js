import { supabase } from './config/supabaseClient.js'
import cron from 'node-cron'
import fetch from 'node-fetch'
import dotenv from 'dotenv'
import { processImageGenerationQueue } from './edgeFunctions/imageGeneration.js'

dotenv.config()

const cleanupUnlinkedOutfits = async () => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const today9PM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0)
  
    const { data, error } = await supabase
      .from('outfit_analyses')
      .select('id, image_url')
      .is('user_id', null)
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', today9PM.toISOString())
  
    if (error) {
      console.error('Error fetching orphaned outfits:', error)
      return
    }
  
    for (const item of data) {
      const path = item.image_url?.split('/storage/v1/object/public/')[1]
      if (path) {
        const { error: removeError } = await supabase.storage.from('outfits').remove([path])
        if (removeError) {
          console.error(`Error removing image for ID ${item.id}:`, removeError)
        }
      }
  
      const { error: deleteError } = await supabase
        .from('outfit_analyses')
        .delete()
        .eq('id', item.id)
  
      if (deleteError) {
        console.error(`Error deleting DB entry for ID ${item.id}:`, deleteError)
      }
    }
  
    console.log(`🧹 Deleted ${data.length} orphaned outfit analyses created today between 12:00 AM and 9:00 PM`)
  }
  

// Process the image generation queue
const processImageQueue = async () => {
  try {
    await processImageGenerationQueue();
  } catch (error) {
    console.error('❌ Error triggering image queue processing:', error);
  }
};

// Schedule to run every day at 12:00 AM
cron.schedule('55 23 * * *', () => {
    cleanupUnlinkedOutfits()
})

// Schedule to run image processing every 10 seconds
cron.schedule('*/10 * * * * *', () => {
    processImageQueue()
})

// Log that cron jobs are running
console.log('🕒 Cron jobs scheduled successfully');
