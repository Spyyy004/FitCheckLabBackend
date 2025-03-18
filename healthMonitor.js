// healthMonitor.js
import fetch from 'node-fetch';
import fs from 'fs/promises';
import { format } from 'date-fns';

// Health check endpoint
const HEALTH_URL = "https://fitchecklabbackend.onrender.com/health";

// Time interval (in milliseconds)
const CHECK_INTERVAL = 30 * 1000;  // 30 seconds

/**
 * Log the message with timestamp
 * @param {string} message - The message to log
 */
async function logStatus(message) {
    // Create timestamp
    const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");
    const logMessage = `[${timestamp}] ${message}`;
    
    // Print log to console
    console.log(logMessage);

    // Append log to file
    try {
        await fs.appendFile("health_log.txt", logMessage + "\n");
    } catch (error) {
        console.error("Error writing to log file:", error);
    }
}

/**
 * Ping the health endpoint and log the status
 */
async function checkHealth() {
    try {
        const startTime = Date.now();  // Track response time
        const response = await fetch(HEALTH_URL, { timeout: 5000 });
        const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);

        if (response.status === 200) {
            await logStatus(`✅ Service is UP | Response Time: ${responseTime}s`);
        } else {
            const responseText = await response.text();
            await logStatus(`⚠️ Service returned status ${response.status} | Response: ${responseText}`);
        }
    } catch (error) {
        await logStatus(`❌ Service is DOWN | Error: ${error.message}`);
    }
}

/**
 * Main function to run the health monitor
 */
async function main() {
    await logStatus("🚀 Starting Health Monitor...");
    
    // Run the health check at regular intervals
    setInterval(async () => {
        await checkHealth();
    }, CHECK_INTERVAL);
    
    // Run the first check immediately
    await checkHealth();
}

// Start the monitor
main().catch(error => {
    console.error("Error in health monitor:", error);
});