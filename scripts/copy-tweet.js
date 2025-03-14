#!/usr/bin/env node

/**
 * Script to copy tweets with media from a specified Twitter user
 * 
 * Usage:
 *   node scripts/copy-tweet.js <username>
 * 
 * Example:
 *   node scripts/copy-tweet.js elonmusk
 */

import { DirectClient } from "@elizaos/client-direct";
import { elizaLogger } from "@elizaos/core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the username from command line arguments
const username = process.argv[2];

if (!username) {
  console.error("Please provide a Twitter username");
  console.error("Usage: node scripts/copy-tweet.js <username>");
  process.exit(1);
}

async function main() {
  try {
    // Initialize the direct client
    const directClient = new DirectClient();
    
    // Get the first agent
    const agents = await directClient.getAgents();
    if (agents.length === 0) {
      console.error("No agents found. Please start the main application first.");
      process.exit(1);
    }
    
    const agent = agents[0];
    
    // Find the Twitter client
    const twitterClient = agent.clients.find(client => 
      client.constructor.name.toLowerCase().includes('twitter')
    );
    
    if (!twitterClient) {
      console.error("Twitter client not found. Make sure the agent has Twitter enabled.");
      process.exit(1);
    }
    
    // Find and copy a random tweet with media
    elizaLogger.log(`Finding and copying a random tweet with media from ${username}...`);
    const result = await twitterClient.findAndCopyRandomTweet(username);
    
    if (result) {
      elizaLogger.success("Successfully copied tweet with media!");
    } else {
      elizaLogger.error("Failed to copy tweet. Check the logs for more details.");
    }
    
    // Exit the process
    process.exit(0);
  } catch (error) {
    elizaLogger.error("Error:", error);
    process.exit(1);
  }
}

main();
