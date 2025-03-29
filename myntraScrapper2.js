// myntraScrapper.js
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';

/**
 * Scrapes a single product from Myntra using both Puppeteer and Axios as fallback
 * @param {string} productUrl - The URL of the product to scrape
 * @returns {Promise<Object>} - The scraped product data
 */
async function scrapeProduct(productUrl) {
  try {
    // First try with Puppeteer
    return await scrapeWithPuppeteer(productUrl);
  } catch (puppeteerError) {
    console.log('Puppeteer approach failed, trying with Axios...');
    console.error('Puppeteer error:', puppeteerError.message);
    
    // If Puppeteer fails, try with Axios
    return await scrapeWithAxios(productUrl);
  }
}

/**
 * Scrapes a product using Puppeteer
 * @param {string} productUrl - The URL of the product to scrape
 * @returns {Promise<Object>} - The scraped product data
 */
async function scrapeWithPuppeteer(productUrl) {
  // Launch browser
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security'
    ] 
  });
  
  try {
    // Open new page
    const page = await browser.newPage();
    
    // Set user agent to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    
    // Set extra HTTP headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Referer': 'https://www.myntra.com/',
      'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    });
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    // Navigate to URL
    console.log(`Navigating to ${productUrl}...`);
    await page.goto(productUrl, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });
    // Get page content
    const content = await page.content();
    
    // Load content into Cheerio
    const $ = cheerio.load(content);
    
    // Extract product data
    const productData = extractProductData($);
    
    return productData;
  } finally {
    await browser.close();
  }
}

/**
 * Scrapes a product using Axios
 * @param {string} productUrl - The URL of the product to scrape
 * @returns {Promise<Object>} - The scraped product data
 */
async function scrapeWithAxios(productUrl) {
  try {
    console.log(`Fetching ${productUrl} with Axios...`);
    
    // Set headers to mimic a browser
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Referer': 'https://www.myntra.com/',
      'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Connection': 'keep-alive'
    };
    
    // Make the request
    const response = await axios.get(productUrl, { headers });
    
    // Load the HTML content into Cheerio
    const $ = cheerio.load(response.data);
    
    // Extract product data
    const productData = extractProductData($);
    
    return productData;
  } catch (error) {
    console.error('Error in scrapeWithAxios:', error.message);
    
    // If we can't scrape directly, attempt to extract product ID and use Myntra's API
    try {
      const productId = extractProductIdFromUrl(productUrl);
      if (productId) {
        return await getProductFromApi(productId);
      }
    } catch (apiError) {
      console.error('Error fetching from API:', apiError.message);
    }
    
    throw error;
  }
}

/**
 * Extract product ID from URL
 * @param {string} url - The product URL
 * @returns {string|null} - The product ID
 */
function extractProductIdFromUrl(url) {
  const matches = url.match(/\/(\d+)\/buy/);
  if (matches && matches[1]) {
    return matches[1];
  }
  return null;
}

/**
 * Get product data from Myntra's API
 * @param {string} productId - The product ID
 * @returns {Promise<Object>} - The product data
 */
async function getProductFromApi(productId) {
  try {
    const apiUrl = `https://www.myntra.com/gateway/v2/product/${productId}`;
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.myntra.com/',
      'Origin': 'https://www.myntra.com'
    };
    
    const response = await axios.get(apiUrl, { headers });
    const data = response.data;
    
    // Format API data to match our expected format
    if (data && data.product) {
      const product = data.product;
      
      return {
        image: product.media?.albums[0]?.images[0]?.secureSrc || null,
      };
    }
    
    throw new Error('Product data not found in API response');
  } catch (error) {
    console.error('Error in getProductFromApi:', error.message);
    throw error;
  }
}

/**
 * Extract product data from Cheerio object
 * @param {Object} $ - Cheerio object
 * @returns {Object} - Extracted product data
 */
function extractProductData($) {
  // Extract product data
  const productData = {
    image: null
  };
  
  // Extract first image
  const firstImageElement = $('.image-grid-image').first();
  if (firstImageElement.length) {
    const imgUrl = firstImageElement.attr('style');
    if (imgUrl) {
      // Extract URL from background-image style
      const match = imgUrl.match(/url\(['"]?(.*?)['"]?\)/);
      if (match && match[1]) {
        productData.image = match[1];
      }
    }
  }
  
  // If no image found via the above method, try alternate selector
  if (!productData.image) {
    const alternateImage = $('.image-grid-imageContainer img').first();
    if (alternateImage.length) {
      const imgUrl = alternateImage.attr('src');
      if (imgUrl) {
        productData.image = imgUrl;
      }
    }
  }
  
  return productData;
}
// Export the functions
export { scrapeProduct };