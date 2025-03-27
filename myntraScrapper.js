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
    
    const productId = extractProductIdFromUrl(productUrl);
      if (productId) {
        return await getProductFromApi(productId);
      }
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
    executablePath: '/opt/render/project/src/.cache/puppeteer/chrome/linux-134.0.6998.35/chrome-linux64/chrome',
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--disable-dev-shm-usage'
    ] ,
    ignoreDefaultArgs: ['--disable-extensions'] 
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
    await page.waitForSelector('.image-grid-container', { timeout: 10000 });
    // Get page content
    const content = await page.evaluate(() => document.documentElement.outerHTML);

    const allClasses = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('*')).map(el => el.className);
    });
    console.log("Classes on page:", allClasses);
    
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
 * Extract product ID from URL
 * @param {string} url - The product URL
 * @returns {string|null} - The product ID
 */
function extractProductIdFromUrl(url) {
  // First pattern: /12345/buy
  const buyMatches = url.match(/\/(\d+)\/buy/);
  if (buyMatches && buyMatches[1]) {
    return buyMatches[1];
  }
  
  // Second pattern: myntra.com/12345?
  const directMatches = url.match(/myntra\.com\/(\d+)(\?|$)/);
  if (directMatches && directMatches[1]) {
    return directMatches[1];
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
      'Origin': 'https://www.myntra.com',
      'Cookie': '_d_id=a6af3b2c-d64b-4986-bbdf-2edf9d421739; mynt-eupv=1; cookieKeys=false; _ma_session=%7B%22id%22%3A%226cfc0506-3160-4cce-bcdd-e03b7151856a-a6af3b2c-d64b-4986-bbdf-2edf9d421739%22%2C%22referrer_url%22%3A%22%22%2C%22utm_medium%22%3A%22%22%2C%22utm_source%22%3A%22%22%2C%22utm_channel%22%3A%22direct%22%7D; bm_mi=2CE7E3A07307CEEF0C89334DF79271C9~YAAQrkxhaAOXGaaVAQAALKt51hv+94cARouE+pY3BkouMu9Ate4XU3KZAD+H/c7Nm+ia9lQDEMbOVUbpH0nR0EaNSnDdcu7VqFd9xB2xaCE/l9lEYE8M1FSsoF9ZqcdVCyYS63K3DmOExagE1DC2OUv3gBZ2baa+bIYmDYf12rjNc8zoH4QsRkK828WL3AP3NR1M3TuiXRCxY8UH3PYC2tqODhiTsXul3oC6iowVMe+DaxEpech2R3DQ9tcOBGjxk+ldLRip3xjgvbpW5pIMcZY8ETdZdoT0eid5Pohui8y99C3STQ5e3EoN2MP6WtZfhxI=~1; G_ENABLED_IDPS=google; at=ZXlKcmFXUWlPaUl5SWl3aWRIbHdJam9pU2xkVUlpd2lZV3huSWpvaVVsTXlOVFlpZlEuZXlKemRXSWlPaUk0T1RrNE16VTJPQzQzTURRM0xqUmtNV1F1T1RJME1TNDVNR1kyT0dNMk4yTXhZVFY1UmpjMlpXRnRjbWxRSWl3aVlYQndUbUZ0WlNJNkltMTViblJ5WVNJc0ltbHpjeUk2SWtsRVJVRWlMQ0owYjJ0bGJsOTBlWEJsSWpvaVlYUWlMQ0p6ZEc5eVpVbGtJam9pTWpJNU55SXNJbXh6YVdRaU9pSXpZbUUwTlRaa1lpMHlaREkxTFRSa016Y3RZbVJsWWkweU5qTm1NVEF6WW1FMk5qQXRNVGMwTXpBMk1EQTJOVFkyTnlJc0luQWlPaUl5TWprM0lpd2lZWFZrSWpvaWJYbHVkSEpoTFRBeVpEZGtaV00xTFRoaE1EQXROR00zTkMwNVkyWTNMVGxrTmpKa1ltVmhOV1UyTVNJc0luQndjeUk2TVRBc0ltTnBaSGdpT2lKdGVXNTBjbUV0TURKa04yUmxZelV0T0dFd01DMDBZemMwTFRsalpqY3RPV1EyTW1SaVpXRTFaVFl4SWl3aWMzVmlYM1I1Y0dVaU9qQXNJbk5qYjNCbElqb2lRa0ZUU1VNZ1VFOVNWRUZNSWl3aVpYaHdJam94TnpRek1EWXpOalkxTENKdWFXUjRJam9pTnpOall6RmxNV1V0TURrNVl5MHhNV1l3TFdFelpERXRZekk1T0RnMk9UTTBPRGMzSWl3aWFXRjBJam94TnpRek1EWXdNRFkxTENKMWFXUjRJam9pT0RrNU9ETTFOamd1TnpBME55NDBaREZrTGpreU5ERXVPVEJtTmpoak5qZGpNV0UxZVVZM05tVmhiWEpwVUNKOS5Ia1poRHh6UXRfMWlrSVN6OFBoV3p1bzhCUGpqLXJ6b2xfR1ZPQy1idFpJclpuZ3djaWZxX2VZUFpVWHBTZ3JMNG1VSzVRNjFwY0k3TUpwVDZTcTQzS2laQkhQLUwwbndRcktKTkxhbUlhRTVsWHdkRHlhcHpLc0M4Sl9JdzFJckRJM0I3WTlOV0hKMlhuR0QweDdOM3dyTjBtcWFIMk83bHd4d1d1Z2c5NXM=; rt=ZXlKcmFXUWlPaUl5SWl3aWRIbHdJam9pU2xkVUlpd2lZV3huSWpvaVVsTXlOVFlpZlEuZXlKemRXSWlPaUk0T1RrNE16VTJPQzQzTURRM0xqUmtNV1F1T1RJME1TNDVNR1kyT0dNMk4yTXhZVFY1UmpjMlpXRnRjbWxRSWl3aWNuUnBkeUk2TWpNek1qZ3dNREFzSW1Gd2NFNWhiV1VpT2lKdGVXNTBjbUVpTENKcGMzTWlPaUpKUkVWQklpd2lkRzlyWlc1ZmRIbHdaU0k2SW5KMElpd2ljM1J2Y21WSlpDSTZJakl5T1RjaUxDSnNjMmxrSWpvaU0ySmhORFUyWkdJdE1tUXlOUzAwWkRNM0xXSmtaV0l0TWpZelpqRXdNMkpoTmpZd0xURTNORE13TmpBd05qVTJOamNpTENKd0lqb2lNakk1TnlJc0ltRjFaQ0k2SW0xNWJuUnlZUzB3TW1RM1pHVmpOUzA0WVRBd0xUUmpOelF0T1dObU55MDVaRFl5WkdKbFlUVmxOakVpTENKMGIyNGlPakUzTkRNd05qQXdOalVzSW5Cd2N5STZNVEFzSW5KMGRDSTZNU3dpWTJsa2VDSTZJbTE1Ym5SeVlTMHdNbVEzWkdWak5TMDRZVEF3TFRSak56UXRPV05tTnkwNVpEWXlaR0psWVRWbE5qRWlMQ0p6ZFdKZmRIbHdaU0k2TUN3aWMyTnZjR1VpT2lKQ1FWTkpReUJRVDFKVVFVd2lMQ0psZUhBaU9qRTNOall6T0Rnd05qVXNJbTVwWkhnaU9pSTNNMk5qTVdVeFpTMHdPVGxqTFRFeFpqQXRZVE5rTVMxak1qazRPRFk1TXpRNE56Y2lMQ0pwWVhRaU9qRTNORE13TmpBd05qVXNJblZwWkhnaU9pSTRPVGs0TXpVMk9DNDNNRFEzTGpSa01XUXVPVEkwTVM0NU1HWTJPR00yTjJNeFlUVjVSamMyWldGdGNtbFFJbjAuZ2d3Z2l4NXpVdjJrVFFYZnA4SGw0VUJIeUtkUzRjR1kwd09ieVp5TGQxRUtSMHREemFVSkhqbDdibkwzbGRCMzBFendCT2VCSHgwWGtOTXllRG9FY2VnWnNFYkJ1aTdlYUQtQ19zOVJ2bmFlYUthNmRSNzlRMFdXdmVheEZ2OV9GV08wS3IzWlZtWnRmbDJNS3llamNpRWQzbnVWLWU0MHlJLXo4RUUyeWNz; _abck=A5403C7BBABB50E19607355A8136ECF2~0~YAAQrExhaJXKxdSVAQAAi9151g0TwBgIkONMH5UDXurqYqf2bV3CpyhDa4BRP6EdR8zWkVervRfL0fwbEPv1TqV6AkGr4dHcn/wwGE0f+ddFdTfNx2tfruKU/Ip7z3IPFLnutDJ8eiTi61cPgR9dkGFu2GoDgTfcAOtnTrFFOa8kjvk+FDOMbqvttHeTcuWYSvg/D5gyen6HVKA32lXgatM6CgXmmNQsdLFDvQCQ342zbYEUOjHolPu8cCxZK8rzqF5Gkk4ELHWmSTh78xrd8+rfIWXYSvveQo7XFfi3+Ptn/aK7JcTh4MrM7FPSnvv6gqUeJfBPqz+Aa/65/bhwn5mT1PMfFdxsYXWQycYYsS+zVZQIoPhNjTT01hDYX40605ZDGZigJ6ktfCavdOzr50JLMjeVvaJU0EU92/cglaX3a2GQwaZ7+PmXfktrMo4vmuknDVe/8KaIv9jJSldTM/QBhqPfKi2kQMBY/qUj7dUaUuxg/Ug3CJO3MURi/3/sVwAD+GWZAeWThD5HhJ5L7sblPR4pqslzl2fi6eIW+2lcpyQk1qq6aQkPtfk7H+sL6820TVREaHf+tkim5HA/y3H67kr3h/Q3l9HSwq5MsYmJ59TNDIu6vGIp4WG0DWR0LdjX6+wnsxulNtbz88p6HfzNDVzaWNKyUVmO/yEBvnhlnKm3uiIMv9fznbhqii05CK49isioMyA=~-1~-1~-1; ilgim=true; uidx=89983568.7047.4d1d.9241.90f68c67c1a5yF76eamriP; user_uuid=89983568.7047.4d1d.9241.90f68c67c1a5yF76eamriP; x-mynt-pca=BZucxpDqx2cYOLX0KAKagstt_SfJGWA5WlXo5WKUgk9uNUWwJFHlirh0UFOtARFHjm45_JONHlUrMBoIPynl8PgJ6d30x8QGPpKd3pTntAcI8XLGxRwavleoJC4Bdx3R_86qvqVZ0QNXVQC3OJ9zOFCNQWzKLCNyH6SgKXvnGqpLxBOzeTJuxDKqpl3F1CWjQsjeh-1ieuxjc6iPmH-HJL2-mp4%3D; mynt-ulc=pincode%3A110017%7CaddressId%3A428986909; mynt-ulc-api=pincode%3A110017%7CaddressId%3A428986909; bm_sv=891AC4A8145F67867AE97C3D16EE02B0~YAAQrExhaPvKxdSVAQAATOF51htPPjnRTm717/ctPJJuyxGGYIZBnjfAYYLlNF7K81AVT1EEQmIuh3t15RK9aMRwT1+6K9ZPqpFOswhAuvO08aA2qvHcUOMSVml9BPMo9T67UUk3rYAh07NkCEW6M+yvz/N7jy7eHqDhNGkXJsSuDGH7dRjmGfyePJ9jT6UsSAmV8ZOwxSPlg3cEEB/u9Hpn6myPFWPPe7f9C6KlEIgYgHksdDr5Rv7TxsBaOjqtkg==~1; mynt-loc-src=expiry%3A1743061530999%7Csource%3AUSER; _mxab_=config.bucket%3Dregular%3Bpdp.desktop.savedAddress%3Denabled%3Bpayments.cod.captcharemoval%3Ddisabledoption2%3Bcoupon.cart.channelAware%3DchannelAware_Enabled%3Breturns.obd%3Denabled%3Bcheckout.payment.cvvless%3Denabled; _pv=default; lt_timeout=1; lt_session=1; microsessid=506; _xsrf=XDJvqroAxKqxZK1GkGySzMVCEVOxcDwu; newUser=false; user_session=xxqg-BuneZ9pFVX0gMQPfw.fWhF8vOAXf7waBoIijr1Rrl4c7YmMwmutpgyi2nRJW-lWvglm70AeRD9rvjCmAPMAHXt1fRvtK3aOwCTtNFmsNkTUrU8-IMxmMI2iDzXH1BOLvZZRzElUICAWdLZ60DDnWtJHU_rfZedag3UnheJ7gVX8hByTRzr0aSXDS58fo5Hj0iAwnmous0KUAFGF1ka_9KstU8e7tUAsVsk3OeqSwmrT-2cNyDDkTUBjeMHjooWO3J6gzWDxg7Iw2ZJfjm_e9HYuxKFFg13Jb42Mjbik7fobp1lFYHvB6bOwyZysdsGkEHebzab979AHT50Bv5Jqja7pzYREIw3nxnH_DOK_5aYs3AKkSDKRvjAw2Dvb-KivtNTPPOfkhGJ8ZKOAtKitG1jsEan7ftxJRKBdxapxPxgnxyq3W4X42ozryBzVSr8zVZK4wGgjqRMjFBXhVYYHV1oUjzozQQlV1SgxJIvgiX_khclC_DhuVGwEZaAG5QnirOEMJfMgLMDULXMyr-A.1743062556195.86400000.ZyG1g4itz4e0UYPIKwToHVF-INA8o2r5vcVahNjP5L4; ismd=1; dp=m; ru=TFB1D1xxCEBbHWodTXZcT3o6eVd3CxJEAGYkG2kUE1BYexpTCiJODlcoLloKY0AwIzI4MDc5OTg1OSQy.341e7278fbde585b11b9bda8c053f797; utrid=uuid-17429228010864; ak_bmsc=6CED119A509A98483BEF7336EC94636B~000000000000000000000000000000~YAAQRQkuF7pi8auVAQAAvNKg1htUmwiXooFPOjCwZ0UNGwtgfkzREzPMpqZm4m2MDe9tRKGb9EfLbbMSYpogw5W3tExg1Rp5jcT2t9EKcbbwPYD7oSEm57WHQv/v3BleEwx2jypvq67Qf83QaeFgx2V/fn4stpPEEa/1IDTHJyz3GjbII51nCd8uqgNzui9feE1kHozaEPTuhIesfOYYWelMC3w/Y8I1/UIBZ/gHtY5shiLT47bm+b8ukrWDYbdPZHamQ21mhUkQCpGaXYwDl07zeeMU4WcE2WefDbRU3vdwlA1iJJaNajrfLYXab7mNrfEsoUKPndzG/EhwcivselMmcUmuneVPDU8SvVkohruGFxm8BvwkN9dmglnEjE9dRSkbP0eREpY4hKUd4jsBixzh4xXLG1jGgavfQtu8eWOyA08/59Uiepahgivyn/er; bm_sz=4B18C1C11787BCFA4DC5C9B38FB275F3~YAAQRQkuF7ti8auVAQAAvNKg1hvdRvzc5K7WE4NhWy/5pbbBibJxlOydLPFnPkENw4qtDI5xFDNkfX5eDFZ3Sb8JQ1UP4QcS5EXcKZynrxmK2azuYxdid6JdE0mQdWZ1SQiiMpKDiQ/0zNQmPnUIAS9ozTsXe7F32+HEhhiMYpwI4TOC0vWbYIr7mgnuMytkRNx7dXq2sIiiHtRakiMXcWOC2J/kiLcn4f7NFasXIvV6tJk7yNH2gxWQyOuxNbjbHflNneSH2fcag4DlS+Lzslczzv54f1i3yDup/XJfZNLP9YLV8otUWSZN74EItDpfyi4jRu5PBprXQvD6Qk11ovQYouvZQIgg67GLhTDIj493BSPv3hkEmqSy2SvO7HNsgiHz2WsSLhuqXDRTbg4MfbwEbbg9xF4dBhZ5ugAoTa0LG8LMGcuypmXCWIub3h+tQJcfYN2SSfN5TeedfakwtbSx0TBIcMMLon2wK8KMIwj1p/T+1JMqwoQizHzCA6HJIlwR1ko6~3420481~4539716'
    }
    
    const response = await axios.get(apiUrl, { headers });
    const data = response.data;

    console.log("myntra data", data)
    
    // Format API data to match our expected format
    if (data && data.style) {
      const product = data.style;
      
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
    console.log(alternateImage, "ALTERNATEE")
  }
  console.log(firstImageElement, "FIRST IMAGEE")
  
  return productData;
}
// Export the functions
export { scrapeProduct };
