import { Character, elizaLogger, type IAgentRuntime } from "@elizaos/core";
import { TwitterSettings, getTwitterSettings } from "../../types/index.js";
import type { ClientBase } from "./base";
import type { Tweet } from "agent-twitter-client";

// Interface for liked comment tracking
interface LikedComment {
  id: string;
  tweetId: string;
  username: string;
  likedAt: string; // ISO date string
}

/**
 * Client for automatically liking comments on popular posts
 */
export class TwitterLikerClient {
  private client: ClientBase;
  private runtime: IAgentRuntime;
  private character: Character;
  private trackUsers: string[] = [];
  private autoLikeEnabled: boolean = false;
  private autoLikeInterval: number = 60; // Default: 60 minutes
  private autoLikeCommentsPerRun: number = 10; // Default: 10 comments per run
  private autoLikeMinCommentLength: number = 5; // Default: 5 characters minimum
  private autoLikeMaxLikesPerDay: number = 100; // Default: 100 likes per day
  private timer: NodeJS.Timeout | null = null;
  private likedComments: Record<string, LikedComment> = {};
  private cacheKey: string;
  private todayLikeCount: number = 0;
  private lastLikeCountReset: string = new Date().toISOString().split("T")[0]; // Today's date in YYYY-MM-DD format

  constructor(client: ClientBase, runtime: IAgentRuntime) {
    this.client = client;
    this.runtime = runtime;
    this.character = runtime.character;

    // Initialize cacheKey after client.profile is available
    this.cacheKey = "twitter/liked_comments";
  }

  /**
   * Set the cache key based on the Twitter username
   * This should be called after the client has been initialized and profile is available
   */
  setCacheKey(): void {
    if (this.client.profile && this.client.profile.username) {
      this.cacheKey = `twitter/${this.client.profile.username}/liked_comments`;
      elizaLogger.debug(`Set cache key to ${this.cacheKey}`);
    } else {
      elizaLogger.warn(
        "Twitter profile not available, using default cache key"
      );
    }
  }

  /**
   * Initialize the auto-liker client
   */
  async init(): Promise<void> {
    // Set the cache key now that the client should be initialized
    this.setCacheKey();

    // Load configuration from character settings
    this.loadConfig();

    // Load previously liked comments
    await this.loadLikedComments();

    // Reset daily like counter if it's a new day
    this.checkAndResetDailyLikeCounter();
  }

  /**
   * Start the automatic comment liking process
   */
  async start(): Promise<void> {
    if (this.timer) {
      elizaLogger.warn("Twitter auto-liker is already running");
      return;
    }

    if (!this.autoLikeEnabled) {
      elizaLogger.log("Twitter auto-liker is disabled in settings");
      return;
    }

    elizaLogger.info(
      `Starting Twitter auto-liker with interval of ${this.autoLikeInterval} minutes`
    );

    // Start the auto-like loop
    this.autoLikeLoop();
  }

  /**
   * Stop the automatic comment liking process
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      elizaLogger.log("Twitter auto-liker stopped");
    }
  }

  /**
   * Restart the automatic comment liking process (useful after config changes)
   */
  async restart(): Promise<void> {
    this.stop();
    this.loadConfig();
    await this.loadLikedComments();
    this.start();
  }

  /**
   * Load configuration from character settings
   */
  private loadConfig(): void {
    const twitterSettings = getTwitterSettings(this.character);

    this.trackUsers = twitterSettings.trackUsers || [];
    this.autoLikeEnabled = twitterSettings.autoLikeEnabled || false;
    this.autoLikeInterval = twitterSettings.autoLikeInterval || 60;
    this.autoLikeCommentsPerRun = twitterSettings.autoLikeCommentsPerRun || 10;
    this.autoLikeMinCommentLength =
      twitterSettings.autoLikeMinCommentLength || 5;
    this.autoLikeMaxLikesPerDay = twitterSettings.autoLikeMaxLikesPerDay || 100;

    if (this.autoLikeEnabled && this.trackUsers.length > 0) {
      elizaLogger.info("Twitter auto-liker configuration loaded:");
      elizaLogger.info(`- Track users: ${this.trackUsers.join(", ")}`);
      elizaLogger.info(
        `- Auto-like interval: ${this.autoLikeInterval} minutes`
      );
      elizaLogger.info(`- Comments per run: ${this.autoLikeCommentsPerRun}`);
      elizaLogger.info(
        `- Min comment length: ${this.autoLikeMinCommentLength} characters`
      );
      elizaLogger.info(`- Max likes per day: ${this.autoLikeMaxLikesPerDay}`);
    } else if (this.autoLikeEnabled) {
      elizaLogger.info(
        "Auto-liker is enabled but no users to track found in configuration"
      );
    }
  }

  /**
   * Load previously liked comments from cache
   */
  private async loadLikedComments(): Promise<void> {
    try {
      const cachedComments = await this.runtime.cacheManager.get<
        Record<string, LikedComment>
      >(this.cacheKey);

      if (cachedComments) {
        this.likedComments = cachedComments;
        elizaLogger.log(
          `Loaded ${
            Object.keys(this.likedComments).length
          } previously liked comments from cache`
        );

        // Count today's likes
        const today = new Date().toISOString().split("T")[0];
        this.todayLikeCount = Object.values(this.likedComments).filter(
          (comment) => comment.likedAt.startsWith(today)
        ).length;

        elizaLogger.log(`Already liked ${this.todayLikeCount} comments today`);
      } else {
        // Initialize with empty object if no cached data exists
        this.likedComments = {};
        await this.saveLikedComments();
        elizaLogger.log("Initialized empty liked comments cache");
      }
    } catch (error) {
      elizaLogger.error("Error loading liked comments from cache:", error);
      this.likedComments = {};
    }
  }

  /**
   * Save liked comments to cache
   */
  private async saveLikedComments(): Promise<void> {
    try {
      await this.runtime.cacheManager.set(this.cacheKey, this.likedComments);
    } catch (error) {
      elizaLogger.error("Error saving liked comments to cache:", error);
    }
  }

  /**
   * Check if a comment is already liked
   */
  private isCommentLiked(commentId: string): boolean {
    return commentId in this.likedComments;
  }

  /**
   * Add a comment to the liked comments list
   */
  private async trackLikedComment(
    commentId: string,
    tweetId: string,
    username: string
  ): Promise<void> {
    const now = new Date();

    this.likedComments[commentId] = {
      id: commentId,
      tweetId,
      username,
      likedAt: now.toISOString(),
    };

    // Increment today's like counter
    this.todayLikeCount++;

    await this.saveLikedComments();
    elizaLogger.log(
      `Added comment ${commentId} from ${username} to liked comments list`
    );
  }

  /**
   * Check and reset daily like counter if it's a new day
   */
  private checkAndResetDailyLikeCounter(): void {
    const today = new Date().toISOString().split("T")[0];

    if (today !== this.lastLikeCountReset) {
      elizaLogger.log(`New day detected, resetting daily like counter`);
      this.todayLikeCount = 0;
      this.lastLikeCountReset = today;
    }
  }

  /**
   * Find a post with many commenters from a user
   */
  private async findPostWithComments(username: string): Promise<Tweet | null> {
    try {
      elizaLogger.info(`Looking for posts with comments from ${username}`);

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
        `Error finding post with comments from ${username}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get comments on a tweet
   */
  private async getPostComments(tweetId: string): Promise<Tweet[]> {
    try {
      elizaLogger.info(`Getting comments for tweet ${tweetId}`);

      // Use the Twitter API to search for replies to the tweet
      const query = `conversation_id:${tweetId}`;
      const searchResults = this.client.twitterClient.searchTweets(query, 100);

      const comments: Tweet[] = [];
      for await (const tweet of searchResults) {
        // Skip the original tweet
        if (tweet.id !== tweetId && tweet.inReplyToStatusId === tweetId) {
          comments.push(tweet);
        }
      }

      elizaLogger.info(
        `Found ${comments.length} comments for tweet ${tweetId}`
      );
      return comments;
    } catch (error) {
      elizaLogger.error(`Error getting comments for tweet ${tweetId}:`, error);
      return [];
    }
  }

  /**
   * Like a comment
   */
  private async likeComment(tweet: Tweet): Promise<boolean> {
    try {
      elizaLogger.info(`Liking comment ${tweet.id} from ${tweet.username}`);

      // Like the tweet using the Twitter API
      await this.client.twitterClient.likeTweet(tweet.id);

      // Track the liked comment
      await this.trackLikedComment(
        tweet.id,
        tweet.inReplyToStatusId,
        tweet.username
      );

      elizaLogger.info(
        `Successfully liked comment ${tweet.id} from ${tweet.username}`
      );
      return true;
    } catch (error) {
      elizaLogger.error(`Error liking comment ${tweet.id}:`, error);
      return false;
    }
  }

  /**
   * Select comments to like from a list of comments
   */
  private selectCommentsToLike(comments: Tweet[]): Tweet[] {
    // Check if we've reached the daily like limit
    if (this.todayLikeCount >= this.autoLikeMaxLikesPerDay) {
      elizaLogger.info(
        `Daily like limit of ${this.autoLikeMaxLikesPerDay} reached, skipping`
      );
      return [];
    }

    // Calculate how many comments we can like in this run
    const remainingLikesToday =
      this.autoLikeMaxLikesPerDay - this.todayLikeCount;
    const maxLikesThisRun = Math.min(
      this.autoLikeCommentsPerRun,
      remainingLikesToday
    );

    // Filter out comments that are too short or already liked
    const eligibleComments = comments.filter(
      (comment) =>
        !this.isCommentLiked(comment.id) &&
        comment.text &&
        comment.text.length >= this.autoLikeMinCommentLength
    );

    // Shuffle the eligible comments
    const shuffledComments = [...eligibleComments].sort(
      () => Math.random() - 0.5
    );

    // Take up to maxLikesThisRun comments
    return shuffledComments.slice(0, maxLikesThisRun);
  }

  /**
   * Process a single auto-like run
   */
  private async processAutoLikeRun(): Promise<void> {
    // Check and reset daily like counter if it's a new day
    this.checkAndResetDailyLikeCounter();

    if (this.trackUsers.length === 0) {
      elizaLogger.warn(
        "No users to track. Please add users to the trackUsers list in the character settings."
      );
      return;
    }

    // Check if we've reached the daily like limit
    if (this.todayLikeCount >= this.autoLikeMaxLikesPerDay) {
      elizaLogger.info(
        `Daily like limit of ${this.autoLikeMaxLikesPerDay} reached, skipping this run`
      );
      return;
    }

    // Select a random user from the tracked users
    const randomIndex = Math.floor(Math.random() * this.trackUsers.length);
    const selectedUser = this.trackUsers[randomIndex];

    elizaLogger.info(
      `Selected random user to find comments from: ${selectedUser}`
    );

    // Find a post with comments
    const post = await this.findPostWithComments(selectedUser);
    if (!post) {
      elizaLogger.info(`No suitable post found for ${selectedUser}`);
      return;
    }

    // Get the comments
    const comments = await this.getPostComments(post.id);
    if (comments.length === 0) {
      elizaLogger.info(`No comments found for post ${post.id}`);
      return;
    }

    // Select comments to like
    const commentsToLike = this.selectCommentsToLike(comments);
    if (commentsToLike.length === 0) {
      elizaLogger.info("No eligible comments to like");
      return;
    }

    // Like the selected comments
    for (const comment of commentsToLike) {
      try {
        await this.likeComment(comment);

        // Add a small random delay between likes to appear more natural
        const delay = Math.floor(Math.random() * 3000) + 1000; // 1-4 seconds
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        elizaLogger.error(`Error liking comment ${comment.id}:`, error);
      }
    }
  }

  /**
   * Auto-like loop
   */
  private autoLikeLoop(): void {
    // Run immediately
    this.processAutoLikeRun().catch((error) => {
      elizaLogger.error("Error in initial auto-like run:", error);
    });

    // Set up the timer with the configured interval
    const delay = this.autoLikeInterval * 60 * 1000; // Convert minutes to milliseconds
    this.timer = setTimeout(() => {
      this.processAutoLikeRun().catch((error) => {
        elizaLogger.error("Error in scheduled auto-like run:", error);
      });

      // Schedule next iteration
      this.autoLikeLoop();
    }, delay);

    elizaLogger.info(
      `Next auto-like run scheduled in ${this.autoLikeInterval} minutes`
    );
  }
}
