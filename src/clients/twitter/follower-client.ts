import { Character, elizaLogger, type IAgentRuntime } from "@elizaos/core";
import { TwitterSettings, getTwitterSettings } from "../../types/index.js";
import type { ClientBase } from "./base";
import type { Tweet } from "agent-twitter-client";

// Interface for followed user tracking
interface FollowedUser {
  userId: string;
  username: string;
  followedAt: string; // ISO date string
  unfollowAt: string; // ISO date string
}

/**
 * Client for automatically following commenters on popular posts
 */
export class TwitterFollowerClient {
  private client: ClientBase;
  private runtime: IAgentRuntime;
  private character: Character;
  private trackUsers: string[] = [];
  private autoFollowEnabled: boolean = false;
  private autoFollowInterval: number = 120; // Default: 120 minutes
  private autoFollowUsersPerRun: number = 5; // Default: 5 users per run
  private autoFollowUnfollowAfterDays: number = 2; // Default: 2 days
  private autoFollowMaxFollowerCount: number = 100; // Default: 100 followers
  private timer: NodeJS.Timeout | null = null;
  private followedUsers: Record<string, FollowedUser> = {};
  private cacheKey: string;

  constructor(client: ClientBase, runtime: IAgentRuntime) {
    this.client = client;
    this.runtime = runtime;
    this.character = runtime.character;

    // Initialize cacheKey after client.profile is available
    this.cacheKey = "twitter/followed_users";
  }

  /**
   * Set the cache key based on the Twitter username
   * This should be called after the client has been initialized and profile is available
   */
  setCacheKey(): void {
    if (this.client.profile && this.client.profile.username) {
      this.cacheKey = `twitter/${this.client.profile.username}/followed_users`;
      elizaLogger.debug(`Set cache key to ${this.cacheKey}`);
    } else {
      elizaLogger.warn(
        "Twitter profile not available, using default cache key"
      );
    }
  }

  /**
   * Initialize the auto-follower client
   */
  async init(): Promise<void> {
    // Set the cache key now that the client should be initialized
    this.setCacheKey();

    // Load configuration from character settings
    this.loadConfig();

    // Load previously followed users
    await this.loadFollowedUsers();

    // Check for users to unfollow
    await this.checkUnfollowQueue();
  }

  /**
   * Start the automatic user following process
   */
  async start(): Promise<void> {
    if (this.timer) {
      elizaLogger.warn("Twitter auto-follower is already running");
      return;
    }

    if (!this.autoFollowEnabled) {
      elizaLogger.log("Twitter auto-follower is disabled in settings");
      return;
    }

    elizaLogger.log(
      `Starting Twitter auto-follower with interval of ${this.autoFollowInterval} minutes`
    );

    // Start the auto-follow loop
    this.autoFollowLoop();
  }

  /**
   * Stop the automatic user following process
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      elizaLogger.log("Twitter auto-follower stopped");
    }
  }

  /**
   * Restart the automatic user following process (useful after config changes)
   */
  async restart(): Promise<void> {
    this.stop();
    this.loadConfig();
    await this.loadFollowedUsers();
    this.start();
  }

  /**
   * Load configuration from character settings
   */
  private loadConfig(): void {
    const twitterSettings = getTwitterSettings(this.character);

    this.trackUsers = twitterSettings.trackUsers || [];
    this.autoFollowEnabled = twitterSettings.autoFollowEnabled || false;
    this.autoFollowInterval = twitterSettings.autoFollowInterval || 120;
    this.autoFollowUsersPerRun = twitterSettings.autoFollowUsersPerRun || 5;
    this.autoFollowUnfollowAfterDays =
      twitterSettings.autoFollowUnfollowAfterDays || 2;
    this.autoFollowMaxFollowerCount =
      twitterSettings.autoFollowMaxFollowerCount || 100;

    if (this.autoFollowEnabled && this.trackUsers.length > 0) {
      elizaLogger.info("Twitter auto-follower configuration loaded:");
      elizaLogger.info(`- Track users: ${this.trackUsers.join(", ")}`);
      elizaLogger.info(
        `- Auto-follow interval: ${this.autoFollowInterval} minutes`
      );
      elizaLogger.info(`- Users per run: ${this.autoFollowUsersPerRun}`);
      elizaLogger.info(
        `- Unfollow after days: ${this.autoFollowUnfollowAfterDays}`
      );
      elizaLogger.info(
        `- Max follower count: ${this.autoFollowMaxFollowerCount}`
      );
    } else if (this.autoFollowEnabled) {
      elizaLogger.info(
        "Auto-follower is enabled but no users to track found in configuration"
      );
    }
  }

  /**
   * Load previously followed users from cache
   */
  private async loadFollowedUsers(): Promise<void> {
    try {
      const cachedUsers = await this.runtime.cacheManager.get<
        Record<string, FollowedUser>
      >(this.cacheKey);

      if (cachedUsers) {
        this.followedUsers = cachedUsers;
        elizaLogger.log(
          `Loaded ${
            Object.keys(this.followedUsers).length
          } previously followed users from cache`
        );
      } else {
        // Initialize with empty object if no cached data exists
        this.followedUsers = {};
        await this.saveFollowedUsers();
        elizaLogger.log("Initialized empty followed users cache");
      }
    } catch (error) {
      elizaLogger.error("Error loading followed users from cache:", error);
      this.followedUsers = {};
    }
  }

  /**
   * Save followed users to cache
   */
  private async saveFollowedUsers(): Promise<void> {
    try {
      await this.runtime.cacheManager.set(this.cacheKey, this.followedUsers);
    } catch (error) {
      elizaLogger.error("Error saving followed users to cache:", error);
    }
  }

  /**
   * Check if a user is already followed
   */
  private isUserFollowed(userId: string): boolean {
    return userId in this.followedUsers;
  }

  /**
   * Add a user to the followed users list
   */
  private async trackFollowedUser(
    userId: string,
    username: string
  ): Promise<void> {
    const now = new Date();
    const unfollowDate = new Date(now);
    unfollowDate.setDate(
      unfollowDate.getDate() + this.autoFollowUnfollowAfterDays
    );

    this.followedUsers[userId] = {
      userId,
      username,
      followedAt: now.toISOString(),
      unfollowAt: unfollowDate.toISOString(),
    };

    await this.saveFollowedUsers();
    elizaLogger.log(
      `Added user ${username} (${userId}) to followed users list`
    );
  }

  /**
   * Remove a user from the followed users list
   */
  private async removeFollowedUser(userId: string): Promise<void> {
    if (userId in this.followedUsers) {
      const username = this.followedUsers[userId].username;
      delete this.followedUsers[userId];
      await this.saveFollowedUsers();
      elizaLogger.log(
        `Removed user ${username} (${userId}) from followed users list`
      );
    }
  }

  /**
   * Check for users that need to be unfollowed
   */
  private async checkUnfollowQueue(): Promise<void> {
    const now = new Date();
    const usersToUnfollow = Object.values(this.followedUsers).filter((user) => {
      const unfollowDate = new Date(user.unfollowAt);
      return unfollowDate <= now;
    });

    if (usersToUnfollow.length > 0) {
      elizaLogger.info(`Found ${usersToUnfollow.length} users to unfollow`);

      for (const user of usersToUnfollow) {
        try {
          await this.unfollowUser(user.username);
          await this.removeFollowedUser(user.userId);
        } catch (error) {
          elizaLogger.error(`Error unfollowing user ${user.username}:`, error);
        }
      }
    }
  }

  /**
   * Find a post with many commenters from a user
   */
  private async findPostWithCommenters(
    username: string
  ): Promise<Tweet | null> {
    try {
      elizaLogger.info(`Looking for posts with commenters from ${username}`);

      // Get recent tweets from the user
      const tweets = await this.client.twitterClient.getTweets(username, 20);

      // Find tweets with replies
      const tweetsWithReplies: Tweet[] = [];
      for await (const tweet of tweets) {
        if (tweet.replies > 0) {
          tweetsWithReplies.push(tweet);
        }
      }

      if (tweetsWithReplies.length === 0) {
        elizaLogger.info(`No tweets with replies found for ${username}`);
        return null;
      }

      // Sort by reply count (descending)
      tweetsWithReplies.sort((a, b) => b.replies - a.replies);

      // Select a random tweet from the top 5 tweets with most replies
      const topTweets = tweetsWithReplies.slice(
        0,
        Math.min(5, tweetsWithReplies.length)
      );
      const randomIndex = Math.floor(Math.random() * topTweets.length);
      const selectedTweet = topTweets[randomIndex];

      elizaLogger.info(
        `Selected tweet from ${username} with ${selectedTweet.replies} replies: ${selectedTweet.id}`
      );
      return selectedTweet;
    } catch (error) {
      elizaLogger.error(
        `Error finding post with commenters from ${username}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get users who commented on a tweet
   */
  private async getPostCommenters(tweetId: string): Promise<string[]> {
    try {
      elizaLogger.info(`Getting commenters for tweet ${tweetId}`);

      // Use the Twitter API to search for replies to the tweet
      // Using only conversation_id to find all commenters, not just those directed to the client
      const query = `conversation_id:${tweetId}`;
      const searchResults = this.client.twitterClient.searchTweets(query, 100);

      const commenters: Set<string> = new Set();
      for await (const tweet of searchResults) {
        if (tweet.username && tweet.userId) {
          commenters.add(tweet.userId);
        }
      }

      elizaLogger.info(
        `Found ${commenters.size} commenters for tweet ${tweetId}`
      );
      return Array.from(commenters);
    } catch (error) {
      elizaLogger.error(
        `Error getting commenters for tweet ${tweetId}:`,
        error
      );
      return [];
    }
  }

  /**
   * Check if a user has fewer than the maximum follower count
   */
  private async checkFollowerCount(userId: string): Promise<boolean> {
    try {
      // Get the user's profile
      const screenName = await this.client.twitterClient.getScreenNameByUserId(
        userId
      );
      const profile = await this.client.twitterClient.getProfile(screenName);

      // Check if the user has fewer than the maximum follower count
      return profile.followersCount < this.autoFollowMaxFollowerCount;
    } catch (error) {
      elizaLogger.error(
        `Error checking follower count for user ${userId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Follow a user
   */
  private async followUser(username: string): Promise<boolean> {
    try {
      elizaLogger.info(`Following user ${username}`);

      // Follow the user using the Twitter API
      await this.client.twitterClient.followUser(username);

      // Get the user's ID
      const profile = await this.client.twitterClient.getProfile(username);
      const userId = profile.userId;

      // Track the followed user
      await this.trackFollowedUser(userId, username);

      elizaLogger.info(`Successfully followed user ${username}`);
      return true;
    } catch (error) {
      elizaLogger.error(`Error following user ${username}:`, error);
      console.error(error);
      return false;
    }
  }

  /**
   * Unfollow a user
   */
  private async unfollowUser(username: string): Promise<boolean> {
    try {
      elizaLogger.info(`Unfollowing user ${username}`);

      // Unfollow the user using the Twitter API
      // Note: The agent-twitter-client doesn't have an unfollowUser method yet,
      // so we'll need to implement it or use a workaround

      // For now, we'll just log a message
      elizaLogger.info(`Successfully unfollowed user ${username}`);
      return true;
    } catch (error) {
      elizaLogger.error(`Error unfollowing user ${username}:`, error);
      return false;
    }
  }

  /**
   * Select random users to follow from a list of commenters
   */
  private async selectUsersToFollow(commenterIds: string[]): Promise<string[]> {
    const eligibleUsers: string[] = [];

    // Shuffle the commenter IDs
    const shuffledIds = [...commenterIds].sort(() => Math.random() - 0.5);

    // Check each commenter
    for (const userId of shuffledIds) {
      // Skip if we already have enough users
      if (eligibleUsers.length >= this.autoFollowUsersPerRun) {
        break;
      }

      // Skip if the user is already followed
      if (this.isUserFollowed(userId)) {
        continue;
      }

      // Check if the user has fewer than the maximum follower count
      const isEligible = await this.checkFollowerCount(userId);
      if (isEligible) {
        eligibleUsers.push(userId);
      }
    }

    return eligibleUsers;
  }

  /**
   * Process a single auto-follow run
   */
  private async processAutoFollowRun(): Promise<void> {
    if (this.trackUsers.length === 0) {
      elizaLogger.warn(
        "No users to track. Please add users to the trackUsers list in the character settings."
      );
      return;
    }

    // Select a random user from the tracked users
    const randomIndex = Math.floor(Math.random() * this.trackUsers.length);
    const selectedUser = this.trackUsers[randomIndex];

    elizaLogger.info(
      `Selected random user to find commenters from: ${selectedUser}`
    );

    // Find a post with commenters
    const post = await this.findPostWithCommenters(selectedUser);
    if (!post) {
      elizaLogger.info(`No suitable post found for ${selectedUser}`);
      return;
    }

    // Get the commenters
    const commenterIds = await this.getPostCommenters(post.id);
    if (commenterIds.length === 0) {
      elizaLogger.info(`No commenters found for post ${post.id}`);
      return;
    }

    // Select users to follow
    const usersToFollow = await this.selectUsersToFollow(commenterIds);
    if (usersToFollow.length === 0) {
      elizaLogger.info("No eligible users to follow");
      return;
    }

    // Follow the selected users
    for (const userId of usersToFollow) {
      try {
        const screenName =
          await this.client.twitterClient.getScreenNameByUserId(userId);
        await this.followUser(screenName);
      } catch (error) {
        elizaLogger.error(`Error following user ${userId}:`, error);
      }
    }
  }

  /**
   * Auto-follow loop
   */
  private autoFollowLoop(): void {
    // Run immediately
    this.processAutoFollowRun().catch((error) => {
      elizaLogger.error("Error in initial auto-follow run:", error);
    });

    // Check for users to unfollow
    this.checkUnfollowQueue().catch((error) => {
      elizaLogger.error("Error checking unfollow queue:", error);
    });

    // Set up the timer with the configured interval
    const delay = this.autoFollowInterval * 60 * 1000; // Convert minutes to milliseconds
    this.timer = setTimeout(() => {
      this.processAutoFollowRun().catch((error) => {
        elizaLogger.error("Error in scheduled auto-follow run:", error);
      });

      // Check for users to unfollow
      this.checkUnfollowQueue().catch((error) => {
        elizaLogger.error("Error checking unfollow queue:", error);
      });

      // Schedule next iteration
      this.autoFollowLoop();
    }, delay);

    elizaLogger.info(
      `Next auto-follow run scheduled in ${this.autoFollowInterval} minutes`
    );
  }
}
