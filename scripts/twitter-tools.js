#!/usr/bin/env node

/**
 * Twitter Tools - Command-line interface for Twitter client functionality
 * 
 * Usage:
 *   node scripts/twitter-tools.js <command> [options]
 * 
 * Commands:
 *   copy-tweet <username> - Copy a random tweet with media from a user
 *   list-tweets <username> [count] - List tweets with media from a user
 *   help - Show this help message
 * 
 * Examples:
 *   node scripts/twitter-tools.js copy-tweet elonmusk
 *   node scripts/twitter-tools.js list-tweets nasa 20
 */

import { DirectClient } from "@elizaos/client-direct";
import { elizaLogger } from "@elizaos/core";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const command = process.argv[2];
const args = process.argv.slice(3);

// Show help message
function showHelp() {
  console.log(`
Twitter Tools - Command-line interface for Twitter client functionality

Usage:
  node scripts/twitter-tools.js <command> [options]

Commands:
  copy-tweet <username>           - Copy a random tweet with media from a user
  list-tweets <username> [count]  - List tweets with media from a user
  help                           - Show this help message

Examples:
  node scripts/twitter-tools.js copy-tweet elonmusk
  node scripts/twitter-tools.js list-tweets nasa 20
  `);
}

// Get the Twitter client
async function getTwitterClient() {
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
    
    return twitterClient;
  } catch (error) {
    elizaLogger.error("Error getting Twitter client:", error);
    process.exit(1);
  }
}

// Copy a random tweet with media from a user
async function copyTweet(username) {
  if (!username) {
    console.error("Please provide a username");
    console.error("Usage: node scripts/twitter-tools.js copy-tweet <username>");
    process.exit(1);
  }
  
  const twitterClient = await getTwitterClient();
  
  elizaLogger.log(`Finding and copying a random tweet with media from ${username}...`);
  const result = await twitterClient.findAndCopyRandomTweet(username);
  
  if (result) {
    elizaLogger.success("Successfully copied tweet with media!");
  } else {
    elizaLogger.error("Failed to copy tweet. Check the logs for more details.");
  }
  
  process.exit(0);
}

// List tweets with media from a user
async function listTweets(username, count = 10) {
  if (!username) {
    console.error("Please provide a username");
    console.error("Usage: node scripts/twitter-tools.js list-tweets <username> [count]");
    process.exit(1);
  }
  
  const twitterClient = await getTwitterClient();
  
  elizaLogger.log(`Finding tweets with media from ${username}...`);
  const tweets = await twitterClient.findTweetsWithMedia(username, parseInt(count));
  
  if (tweets.length === 0) {
    elizaLogger.log(`No tweets with media found for user ${username}`);
  } else {
    elizaLogger.log(`Found ${tweets.length} tweets with media from ${username}:`);
    
    tweets.forEach((tweet, index) => {
      console.log(`\n[${index + 1}] Tweet ID: ${tweet.id}`);
      console.log(`Text: ${tweet.text}`);
      console.log(`Photos: ${tweet.photos.length}`);
      console.log(`URL: ${tweet.permanentUrl}`);
    });
  }
  
  process.exit(0);
}

// Main function
async function main() {
  try {
    switch (command) {
      case 'copy-tweet':
        await copyTweet(args[0]);
        break;
      
      case 'list-tweets':
        await listTweets(args[0], args[1]);
        break;
      
      case 'help':
      default:
        showHelp();
        process.exit(0);
    }
  } catch (error) {
    elizaLogger.error("Error:", error);
    process.exit(1);
  }
}

// Run the main function
main();
