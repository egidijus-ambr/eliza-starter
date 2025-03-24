import {
  type Client,
  elizaLogger,
  type IAgentRuntime,
  type Plugin,
} from "@elizaos/core";
import { ClientBase } from "./base.ts";
import { validateTwitterConfig, type TwitterConfig } from "./environment.ts";
import { TwitterInteractionClient } from "./interactions.ts";
import { TwitterPostClient } from "./post.ts";
import { TwitterSearchClient } from "./search.ts";
import { TwitterAutoCopyClient } from "./auto-copy-client.js";
import { TwitterFollowerClient } from "./follower-client.js";
import { TwitterLikerClient } from "./liker-client.js";
import { getTwitterSettings } from "../../types/index.js";

/**
 * A manager that orchestrates all specialized Twitter logic:
 * - client: base operations (login, timeline caching, etc.)
 * - post: autonomous posting logic
 * - search: searching tweets / replying logic
 * - interaction: handling mentions, replies
 * - autoCopy: automatically copying tweets with media
 * - follower: automatically following commenters on popular posts
 * - liker: automatically liking comments on popular posts
 */
class TwitterManager {
  client: ClientBase;
  post: TwitterPostClient;
  search: TwitterSearchClient;
  interaction: TwitterInteractionClient;
  autoCopy: TwitterAutoCopyClient;
  follower: TwitterFollowerClient;
  liker: TwitterLikerClient;
  // Temporarily commented out as TwitterAirtableClient is not available
  // airtable: TwitterAirtableClient;

  constructor(runtime: IAgentRuntime, twitterConfig: TwitterConfig) {
    // Pass twitterConfig to the base client
    this.client = new ClientBase(runtime, twitterConfig);

    // Posting logic
    this.post = new TwitterPostClient(this.client, runtime);

    // Optional search logic (enabled if TWITTER_SEARCH_ENABLE is true)
    if (twitterConfig.TWITTER_SEARCH_ENABLE) {
      elizaLogger.warn("Twitter/X client running in a mode that:");
      elizaLogger.warn("1. violates consent of random users");
      elizaLogger.warn("2. burns your rate limit");
      elizaLogger.warn("3. can get your account banned");
      elizaLogger.warn("use at your own risk");
      this.search = new TwitterSearchClient(this.client, runtime);
    }

    // Mentions and interactions
    this.interaction = new TwitterInteractionClient(this.client, runtime);

    // Initialize auto-copy client
    this.autoCopy = new TwitterAutoCopyClient(this.client, runtime);

    // Initialize follower client
    this.follower = new TwitterFollowerClient(this.client, runtime);

    // Initialize liker client
    this.liker = new TwitterLikerClient(this.client, runtime);

    // Temporarily commented out as TwitterAirtableClient is not available
    // Initialize Airtable client
    // this.airtable = new TwitterAirtableClient(this.client, runtime);
  }

  async stop() {
    elizaLogger.warn("Twitter client does not support stopping yet");
  }
}

export const TwitterClientInterface: Client & { name: string } = {
  name: "twitter",
  async start(runtime: IAgentRuntime) {
    const twitterConfig: TwitterConfig = await validateTwitterConfig(runtime);

    elizaLogger.info("Twitter client started");

    const manager = new TwitterManager(runtime, twitterConfig);

    // Initialize login/session
    await manager.client.init();

    // Start the posting loop
    await manager.post.start();

    // Start the search logic if it exists
    if (manager.search) {
      await manager.search.start();
    }

    // Start interactions (mentions, replies)
    await manager.interaction.start();

    // Start auto-copy if configured
    const twitterSettings = getTwitterSettings(runtime.character);
    if (twitterSettings.trackUsers && twitterSettings.trackUsers.length > 0) {
      elizaLogger.log("Initializing Twitter auto-copy feature");
      await manager.autoCopy.init();
      await manager.autoCopy.start();
    }

    // Start auto-follower if configured
    if (twitterSettings.autoFollowEnabled) {
      elizaLogger.log("Initializing Twitter auto-follower feature");
      await manager.follower.init();
      await manager.follower.start();
    }

    // Start auto-liker if configured
    if (twitterSettings.autoLikeEnabled) {
      elizaLogger.log("Initializing Twitter auto-liker feature");
      await manager.liker.init();
      await manager.liker.start();
    }

    return manager;
  },
  async stop() {
    elizaLogger.warn("Twitter client does not support stopping yet");
  },
};
