import {
  Character,
  elizaLogger,
  type IAgentRuntime,
  composeContext,
  generateText,
  ModelClass,
  stringToUuid,
  truncateToCompleteSentence,
  parseJSONObjectFromText,
  extractAttributes,
  cleanJsonResponse,
  type IImageDescriptionService,
  ServiceType,
} from "@elizaos/core";
import { TwitterSettings, getTwitterSettings } from "../../types/index.js";
import type { ClientBase } from "./base";
import { downloadTweetMedia } from "./utils.js";
import type { Tweet } from "agent-twitter-client";

// Define a template for generating tweets
const twitterPostTemplate = `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

# Image Context
{{imageDescriptions}}

# Task: Generate a very short post in the voice and style of {{agentName}} @{{twitterUserName}}.
Write a post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}.
Your response MUST be extremely short (4-5 words maximum) with a single emoji at the end.
If image descriptions are provided, make your post subtly reference or relate to what's in the image without directly describing it.
Use casual, flirty language similar to these examples:
- "Hey, hot stuff 🔥"
- "Winking at u ✨"
- "Cutie alert! 🌹"
- "Stealing ur heart 💖"

The total character count MUST be less than {{maxTweetLength}} and should be as brief as possible.`;

// Define the shape of the client with our custom methods
interface TwitterClientWithCopy extends Record<string, any> {
  copyTweetWithMedia: (tweet: any) => Promise<any>;
  findTweetsWithMedia: (username: string, count?: number) => Promise<any[]>;
  findAndCopyPopularTweet: (username: string, count?: number) => Promise<any>;
}

// Interface for copied tweet tracking
interface CopiedTweet {
  id: string;
  username: string;
  timestamp: string;
}

/**
 * Client for automatically copying tweets with media from specified users
 */
export class TwitterAutoCopyClient {
  private client: ClientBase & TwitterClientWithCopy;
  private runtime: IAgentRuntime;
  private character: Character;
  private trackUsers: string[] = [];
  private includeVideos: boolean = true;
  private maxPostsToCheck: number = 20;
  private avoidDuplicates: boolean = true;
  private timer: NodeJS.Timeout | null = null;
  private copiedTweets: CopiedTweet[] = [];
  private cacheKey: string;

  constructor(client: ClientBase, runtime: IAgentRuntime) {
    // Cast to ClientBase & TwitterClientWithCopy since we'll be adding methods to it
    this.client = client as ClientBase & TwitterClientWithCopy;
    this.runtime = runtime;
    this.character = runtime.character;

    // Initialize cacheKey after client.profile is available
    this.cacheKey = "twitter/copied_tweets";

    // Add methods to the client for tweet copying
    this.extendClient();
  }

  /**
   * Set the cache key based on the Twitter username
   * This should be called after the client has been initialized and profile is available
   */
  setCacheKey(): void {
    if (this.client.profile && this.client.profile.username) {
      this.cacheKey = `twitter/${this.client.profile.username}/copied_tweets`;
      elizaLogger.debug(`Set cache key to ${this.cacheKey}`);
    } else {
      elizaLogger.warn(
        "Twitter profile not available, using default cache key"
      );
    }
  }

  /**
   * Initialize the auto-copy client
   */
  async init(): Promise<void> {
    // Set the cache key now that the client should be initialized
    this.setCacheKey();

    // Load configuration from character settings
    this.loadConfig();

    // Load previously copied tweets
    await this.loadCopiedTweets();
  }

  /**
   * Start the automatic tweet copying process
   */
  async start(): Promise<void> {
    if (this.timer) {
      elizaLogger.warn("Twitter auto-copy is already running");
      return;
    }

    // Start the tweet generation loop
    this.generateNewTweetLoop();
  }

  /**
   * Stop the automatic tweet copying process
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      elizaLogger.log("Twitter auto-copy stopped");
    }
  }

  /**
   * Restart the automatic tweet copying process (useful after config changes)
   */
  async restart(): Promise<void> {
    this.stop();
    this.loadConfig();
    await this.loadCopiedTweets();
    this.start();
  }

  /**
   * Load configuration from character settings
   */
  private loadConfig(): void {
    const twitterSettings = getTwitterSettings(this.character);

    this.trackUsers = twitterSettings.trackUsers || [];
    this.includeVideos = twitterSettings.includeVideos !== false;
    this.maxPostsToCheck = twitterSettings.maxPostsToCheck || 20;
    this.avoidDuplicates = twitterSettings.avoidDuplicates !== false;

    if (this.trackUsers.length > 0) {
      elizaLogger.log("Twitter auto-copy configuration loaded:");
      elizaLogger.log(`- Track users: ${this.trackUsers.join(", ")}`);
      elizaLogger.log(`- Include videos: ${this.includeVideos}`);
      elizaLogger.log(`- Max posts to check: ${this.maxPostsToCheck}`);
      elizaLogger.log(`- Avoid duplicates: ${this.avoidDuplicates}`);
    } else {
      elizaLogger.warn("No users to track found in character configuration");
    }
  }

  /**
   * Load previously copied tweets from cache
   */
  private async loadCopiedTweets(): Promise<void> {
    try {
      const cachedTweets = await this.runtime.cacheManager.get<CopiedTweet[]>(
        this.cacheKey
      );

      if (cachedTweets) {
        this.copiedTweets = cachedTweets;
        elizaLogger.log(
          `Loaded ${this.copiedTweets.length} previously copied tweets from cache`
        );
      } else {
        // Initialize with empty array if no cached data exists
        this.copiedTweets = [];
        await this.saveCopiedTweets();
        elizaLogger.log("Initialized empty copied tweets cache");
      }
    } catch (error) {
      elizaLogger.error("Error loading copied tweets from cache:", error);
      this.copiedTweets = [];
    }
  }

  /**
   * Save copied tweets to cache
   */
  private async saveCopiedTweets(): Promise<void> {
    try {
      await this.runtime.cacheManager.set(this.cacheKey, this.copiedTweets);
    } catch (error) {
      elizaLogger.error("Error saving copied tweets to cache:", error);
    }
  }

  /**
   * Check if a tweet has already been copied
   */
  private isTweetCopied(tweetId: string): boolean {
    return this.copiedTweets.some((tweet) => tweet.id === tweetId);
  }

  /**
   * Add a tweet to the copied tweets list
   */
  private async addCopiedTweet(tweet: any, username: string): Promise<void> {
    this.copiedTweets.push({
      id: tweet.id,
      username,
      timestamp: new Date().toISOString(),
    });

    // Keep only the last 1000 copied tweets
    if (this.copiedTweets.length > 1000) {
      this.copiedTweets = this.copiedTweets.slice(-1000);
    }

    await this.saveCopiedTweets();
  }

  /**
   * Find tweets with media from a user
   */
  private async findTweetsWithMedia(username: string): Promise<any[]> {
    try {
      elizaLogger.info(`Searching for tweets with media from ${username}...`);

      // Get the user's tweets using the correct method from the Twitter client
      const response = await this.client.twitterClient.getTweets(
        username,
        this.maxPostsToCheck
      );

      // Handle AsyncGenerator response
      const tweetsWithMedia = [];

      // If response is an AsyncGenerator
      if (response && typeof response[Symbol.asyncIterator] === "function") {
        // Iterate through the AsyncGenerator
        for await (const tweet of response) {
          // Process each tweet from the AsyncGenerator
          await this.processTweetForMedia(tweet, tweetsWithMedia);
        }
      } else {
        // Handle regular array response
        const tweets = Array.isArray(response)
          ? response
          : (response as any).tweets || [];

        // Ensure tweets is iterable
        if (tweets && tweets.length > 0) {
          // Collect tweets that have photos or videos
          for (const tweet of tweets) {
            await this.processTweetForMedia(tweet, tweetsWithMedia);
          }
        }
      }

      elizaLogger.log(
        `Found ${tweetsWithMedia.length} tweets with media from ${username}`
      );
      return tweetsWithMedia;
    } catch (error) {
      elizaLogger.error(
        `Error finding tweets with media from ${username}:`,
        error
      );
      console.error(error);
      return [];
    }
  }

  /**
   * Copy the most popular tweet (by comments/replies) with media from a user
   */
  private async copyMostPopularTweet(username: string): Promise<boolean> {
    try {
      const tweetsWithMedia = await this.findTweetsWithMedia(username);

      if (tweetsWithMedia.length === 0) {
        elizaLogger.log(`No tweets with media found for user ${username}`);
        return false;
      }

      // Sort tweets by reply count (most replies first)
      tweetsWithMedia.sort((a, b) => (b.replies || 0) - (a.replies || 0));

      // Select the tweet with most replies
      const selectedTweet = tweetsWithMedia[0];

      elizaLogger.log(
        `Selected most popular tweet from ${username} with ${
          selectedTweet.replies
        } comments: ${selectedTweet.text.substring(0, 50)}...`
      );

      // Copy the selected tweet
      const result = await this.copyTweetWithMedia(selectedTweet);

      if (result) {
        elizaLogger.success(`Successfully copied tweet from ${username}!`);
        await this.addCopiedTweet(selectedTweet, username);
        return true;
      } else {
        elizaLogger.error(`Failed to copy tweet from ${username}`);
        return false;
      }
    } catch (error) {
      elizaLogger.error(`Error copying popular tweet from ${username}:`, error);
      return false;
    }
  }

  /**
   * Copy the most popular tweet from a random tracked user
   */
  private async copyPopularTweetFromRandomUser(): Promise<boolean> {
    if (this.trackUsers.length === 0) {
      elizaLogger.warn(
        "No users to track. Please add users to the trackUsers list in the character settings."
      );
      return false;
    }

    // Select a random user
    const randomIndex = Math.floor(Math.random() * this.trackUsers.length);
    const selectedUser = this.trackUsers[randomIndex];

    elizaLogger.log(`Selected random user to copy from: ${selectedUser}`);

    // Copy the most popular tweet from the selected user
    return await this.copyMostPopularTweet(selectedUser);
  }

  /**
   * Generate tweet content using the character's configuration and AI
   */
  private async generateTweetContent(
    imageDescriptions: string[] = []
  ): Promise<string> {
    try {
      const roomId = stringToUuid(
        "twitter_generate_room-" + this.client.profile.username
      );

      // Ensure the agent exists
      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        this.client.profile.username,
        this.runtime.character.name,
        "twitter"
      );

      const topics = this.runtime.character.topics.join(", ");
      const maxTweetLength = this.client.twitterConfig.MAX_TWEET_LENGTH || 280;

      // Compose the state for the AI
      const state = await this.runtime.composeState(
        {
          userId: this.runtime.agentId,
          roomId: roomId,
          agentId: this.runtime.agentId,
          content: {
            text: topics || "",
            action: "TWEET",
          },
        },
        {
          twitterUserName: this.client.profile.username,
          maxTweetLength,
          imageDescriptions:
            imageDescriptions.length > 0
              ? `Images in the tweet show: ${imageDescriptions.join(". ")}`
              : "No image descriptions available.",
        }
      );

      // Use the character's template or the default one
      const template =
        this.runtime.character.templates?.twitterPostTemplate ||
        twitterPostTemplate;

      const context = composeContext({
        state,
        template,
      });

      elizaLogger.debug("Generate post prompt:\n" + context);

      const response = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.SMALL,
      });

      const rawTweetContent = cleanJsonResponse(response);

      // Clean up and parse the content
      let tweetTextForPosting = null;

      // Try parsing as JSON first
      const parsedResponse = parseJSONObjectFromText(rawTweetContent);
      if (parsedResponse?.text) {
        tweetTextForPosting = parsedResponse.text;
      } else {
        // If not JSON, use the raw text directly
        tweetTextForPosting = rawTweetContent.trim();
      }

      // Try extracting text attribute if needed
      if (!tweetTextForPosting) {
        const parsingText = extractAttributes(rawTweetContent, ["text"]).text;
        if (parsingText) {
          tweetTextForPosting = truncateToCompleteSentence(
            extractAttributes(rawTweetContent, ["text"]).text,
            maxTweetLength
          );
        }
      }

      // Use the raw text if parsing failed
      if (!tweetTextForPosting) {
        tweetTextForPosting = rawTweetContent;
      }

      // Truncate to tweet length limits
      if (maxTweetLength) {
        tweetTextForPosting = truncateToCompleteSentence(
          tweetTextForPosting,
          maxTweetLength
        );
      }

      const removeQuotes = (str: string) => str.replace(/^['"](.*)['"]$/, "$1");
      const fixNewLines = (str: string) => str.replaceAll(/\\n/g, "\n\n"); // ensures double spaces

      // Final cleaning
      tweetTextForPosting = removeQuotes(fixNewLines(tweetTextForPosting));

      elizaLogger.info(`Generated tweet text: "${tweetTextForPosting}"`);
      return tweetTextForPosting;
    } catch (error) {
      elizaLogger.error("Error generating tweet content:", error);

      // Fallback to a random post example if AI generation fails
      const postExamples = this.character.postExamples || [];
      if (postExamples.length > 0) {
        const randomIndex = Math.floor(Math.random() * postExamples.length);
        return postExamples[randomIndex];
      }

      return ""; // Return empty string if all else fails
    }
  }

  /**
   * Copy a tweet with its media
   */
  private async copyTweetWithMedia(tweet: any): Promise<any> {
    try {
      // Download media from original tweet
      const photoUrls = tweet.photos?.map((photo: any) => photo.url) || [];
      const videoUrls = tweet.videos?.map((video: any) => video.url) || [];
      const mediaUrls = [...photoUrls, ...videoUrls];

      elizaLogger.info(
        `Downloading ${mediaUrls.length} media files from tweet (${photoUrls.length} photos, ${videoUrls.length} videos)`
      );

      const mediaData = await downloadTweetMedia(mediaUrls);
      elizaLogger.info(
        `Successfully downloaded ${mediaData.length} media files`
      );

      // Get image descriptions
      const imageDescriptions = [];
      if (photoUrls.length > 0) {
        elizaLogger.info(`Analyzing ${photoUrls.length} images from tweet`);
        for (const photoUrl of photoUrls) {
          try {
            const description = await this.runtime
              .getService<IImageDescriptionService>(
                ServiceType.IMAGE_DESCRIPTION
              )
              .describeImage(photoUrl);
            imageDescriptions.push(description);
            elizaLogger.info(`Image description: ${description}`);
          } catch (error) {
            elizaLogger.error(`Error analyzing image ${photoUrl}:`, error);
          }
        }
      }

      // Generate AI-powered tweet content based on character's profile and image descriptions
      const postText = await this.generateTweetContent(imageDescriptions);

      // Create new tweet with generated text and downloaded media
      const result = await this.client.twitterClient.sendTweet(
        postText,
        undefined,
        mediaData
      );
      elizaLogger.info(`Successfully copied tweet with media`);

      return result;
    } catch (error) {
      elizaLogger.error("Error copying tweet:", error);
      return null;
    }
  }

  /**
   * Process a tweet to check if it has media and add it to the collection
   */
  private async processTweetForMedia(
    tweet: Tweet,
    tweetsWithMedia: Tweet[]
  ): Promise<void> {
    // Skip tweets that have already been copied if avoidDuplicates is enabled
    if (this.avoidDuplicates && this.isTweetCopied(tweet.id)) {
      return;
    }

    // Check for photos
    if (tweet.photos && tweet.photos.length > 0) {
      tweetsWithMedia.push(tweet);
      elizaLogger.log(
        `Found tweet with ${tweet.photos.length} photos: ${tweet.text.substring(
          0,
          50
        )}...`
      );
    }
    // Check for videos if includeVideos is enabled
    else if (this.includeVideos && tweet.videos && tweet.videos.length > 0) {
      tweetsWithMedia.push(tweet);
      elizaLogger.log(
        `Found tweet with ${tweet.videos.length} videos: ${tweet.text.substring(
          0,
          50
        )}...`
      );
    }
  }

  /**
   * Generate new tweets at random intervals
   */
  private generateNewTweetLoop(): void {
    // Run immediately
    this.copyPopularTweetFromRandomUser().catch((error) => {
      elizaLogger.error("Error in initial tweet copy:", error);
    });

    const minMinutes = this.client.twitterConfig.POST_INTERVAL_MIN;
    const maxMinutes = this.client.twitterConfig.POST_INTERVAL_MAX;
    const randomMinutes =
      Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
    const delay = randomMinutes * 60 * 1000;

    // Set up the timer with random interval
    this.timer = setTimeout(() => {
      this.copyPopularTweetFromRandomUser().catch((error) => {
        elizaLogger.error("Error in scheduled tweet copy:", error);
      });

      // Schedule next iteration
      this.generateNewTweetLoop();
    }, delay);

    elizaLogger.log(`Next tweet copy scheduled in ${randomMinutes} minutes`);
  }

  /**
   * Extend the client with methods for tweet copying
   */
  private extendClient(): void {
    // Add copyTweetWithMedia method to the client
    this.client.copyTweetWithMedia = this.copyTweetWithMedia.bind(this);

    // Add findTweetsWithMedia method to the client
    this.client.findTweetsWithMedia = async (
      username: string,
      count: number = 10
    ) => {
      try {
        elizaLogger.log(
          `Searching for tweets with media from user: ${username}`
        );

        // Get the user's tweets using the correct method from the Twitter client
        const response = await this.client.twitterClient.getTweets(
          username,
          count
        );

        const tweetsWithMedia: Tweet[] = [];

        // Handle AsyncGenerator
        if (response && typeof response[Symbol.asyncIterator] === "function") {
          for await (const tweet of response) {
            // Check for photos
            if (tweet.photos && tweet.photos.length > 0) {
              tweetsWithMedia.push(tweet);
              elizaLogger.log(
                `Found tweet with ${
                  tweet.photos.length
                } photos: ${tweet.text.substring(0, 50)}...`
              );
            }
            // Check for videos if includeVideos is enabled
            else if (
              this.includeVideos &&
              tweet.videos &&
              tweet.videos.length > 0
            ) {
              tweetsWithMedia.push(tweet);
              elizaLogger.log(
                `Found tweet with ${
                  tweet.videos.length
                } videos: ${tweet.text.substring(0, 50)}...`
              );
            }
          }
        } else {
          // Handle array response
          const tweets = Array.isArray(response)
            ? response
            : (response as any).tweets || [];

          for (const tweet of tweets) {
            // Check for photos
            if (tweet.photos && tweet.photos.length > 0) {
              tweetsWithMedia.push(tweet);
              elizaLogger.log(
                `Found tweet with ${
                  tweet.photos.length
                } photos: ${tweet.text.substring(0, 50)}...`
              );
            }
            // Check for videos if includeVideos is enabled
            else if (
              this.includeVideos &&
              tweet.videos &&
              tweet.videos.length > 0
            ) {
              tweetsWithMedia.push(tweet);
              elizaLogger.log(
                `Found tweet with ${
                  tweet.videos.length
                } videos: ${tweet.text.substring(0, 50)}...`
              );
            }
          }
        }

        elizaLogger.log(
          `Found ${tweetsWithMedia.length} tweets with media from ${username}`
        );
        return tweetsWithMedia;
      } catch (error) {
        elizaLogger.error(
          `Error finding tweets with media from ${username}:`,
          error
        );
        return [];
      }
    };

    // Add findAndCopyPopularTweet method to the client
    this.client.findAndCopyPopularTweet = async (
      username: string,
      count: number = 20
    ) => {
      try {
        const tweetsWithMedia = await this.client.findTweetsWithMedia(
          username,
          count
        );

        if (tweetsWithMedia.length === 0) {
          elizaLogger.log(`No tweets with media found for user ${username}`);
          return null;
        }

        // Sort tweets by reply count (most comments first)
        tweetsWithMedia.sort((a, b) => (b.replies || 0) - (a.replies || 0));

        // Select the most popular tweet
        const selectedTweet = tweetsWithMedia[0];

        elizaLogger.log(
          `Selected most popular tweet from ${username} with ${
            selectedTweet.replies
          } comments: ${selectedTweet.text.substring(0, 50)}...`
        );

        // Copy the selected tweet
        return await this.client.copyTweetWithMedia(selectedTweet);
      } catch (error) {
        elizaLogger.error(
          `Error finding and copying popular tweet from ${username}:`,
          error
        );
        return null;
      }
    };
  }
}
