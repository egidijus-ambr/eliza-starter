import type { Tweet } from "agent-twitter-client";
import {
  composeContext,
  generateText,
  getEmbeddingZeroVector,
  type IAgentRuntime,
  ModelClass,
  stringToUuid,
  type TemplateType,
  type UUID,
  truncateToCompleteSentence,
  parseJSONObjectFromText,
  extractAttributes,
  cleanJsonResponse,
} from "@elizaos/core";
import { elizaLogger } from "@elizaos/core";
import type { ClientBase } from "./base.ts";
import { postActionResponseFooter } from "@elizaos/core";
import { generateTweetActions } from "@elizaos/core";
import { type IImageDescriptionService, ServiceType } from "@elizaos/core";
import { buildConversationThread, fetchMediaData } from "./utils.ts";
import { twitterMessageHandlerTemplate } from "./interactions.ts";
import { DEFAULT_MAX_TWEET_LENGTH } from "./environment.ts";
import { getTwitterSettings } from "../../types/index.js";
import {
  Client,
  Events,
  GatewayIntentBits,
  TextChannel,
  Partials,
} from "discord.js";
import type { State } from "@elizaos/core";
import type { ActionResponse } from "@elizaos/core";
import { MediaData } from "./types.ts";

const MAX_TIMELINES_TO_FETCH = 15;

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

# Task: Generate a post in the voice and style and perspective of {{agentName}} @{{twitterUserName}}.
Write a post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}.  
Put each sentence on a new line with a blank line between them.
Each sentence should stand alone as a concise, impactful statement.  
The total character count MUST be less than {{maxTweetLength}}.  `;

export const twitterActionTemplate =
  `
# INSTRUCTIONS: Determine actions for {{agentName}} (@{{twitterUserName}}) based on:
{{bio}}
{{postDirections}}

Guidelines:
- ONLY engage with content that DIRECTLY relates to character's core interests
- Direct mentions are priority IF they are on-topic
- Skip ALL content that is:
  - Off-topic or tangentially related
  - From high-profile accounts unless explicitly relevant
  - Generic/viral content without specific relevance
  - Political/controversial unless central to character
  - Promotional/marketing unless directly relevant
  - Spam or low-quality content
  - Avoid Crypto unless explicitly relevant
  - GM or similar greetings

Actions (respond only with tags):
[LIKE] - Perfect topic match AND aligns with character (9.8/10)  
[RETWEET] - only if its about beatiful females (9.5/10)  
[QUOTE] - only if its about beatiful females, and can express ebcouragment (9.5/10)  
[REPLY] - Meets ONE of the following:  
  - Can contribute meaningful, expert-level insight (9.5/10)  
  - Topic aligns with character AND opportunity to express support or encouragement (e.g., "Nice job!", "Great take!") (7.5/10)  
  - Relevant to character’s domain AND adds a positive, on-brand remark (8.0/10)  

Tweet:
{{currentTweet}}

# Respond with qualifying action tags only. Default to NO action unless extremely confident of relevance.` +
  postActionResponseFooter;

interface PendingTweet {
  tweetTextForPosting: string;
  roomId: UUID;
  rawTweetContent: string;
  discordMessageId: string;
  channelId: string;
  timestamp: number;
}

type PendingTweetApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export class TwitterPostClient {
  client: ClientBase;
  runtime: IAgentRuntime;
  twitterUsername: string;
  private isProcessing = false;
  private lastProcessTime = 0;
  private stopProcessingActions = false;
  private isDryRun: boolean;
  private discordClientForApproval: Client;
  private approvalRequired = false;
  private discordApprovalChannelId: string;
  private approvalCheckInterval: number;

  constructor(client: ClientBase, runtime: IAgentRuntime) {
    this.client = client;
    this.runtime = runtime;
    this.twitterUsername = this.client.twitterConfig.TWITTER_USERNAME;
    this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN;

    // Log configuration on initialization
    elizaLogger.log("Twitter Client Configuration:");
    elizaLogger.log(`- Username: ${this.twitterUsername}`);
    elizaLogger.log(
      `- Dry Run Mode: ${this.isDryRun ? "enabled" : "disabled"}`
    );

    elizaLogger.log(
      `- Enable Post: ${
        this.client.twitterConfig.ENABLE_TWITTER_POST_GENERATION
          ? "enabled"
          : "disabled"
      }`
    );

    elizaLogger.log(
      `- Post Interval: ${this.client.twitterConfig.POST_INTERVAL_MIN}-${this.client.twitterConfig.POST_INTERVAL_MAX} minutes`
    );
    elizaLogger.log(
      `- Action Processing: ${
        this.client.twitterConfig.ENABLE_ACTION_PROCESSING
          ? "enabled"
          : "disabled"
      }`
    );
    elizaLogger.log(
      `- Action Interval: ${this.client.twitterConfig.ACTION_INTERVAL} minutes`
    );

    // Log time-based scheduling configuration
    const startHour = this.client.twitterConfig.ACTION_START_HOUR;
    const endHour = this.client.twitterConfig.ACTION_END_HOUR;
    const timezone = this.client.twitterConfig.ACTION_TIMEZONE;

    if (startHour !== undefined && endHour !== undefined) {
      const timezoneStr = timezone
        ? ` (${timezone} timezone)`
        : " (local timezone)";
      elizaLogger.log(
        `- Action Time Window: ${startHour}:00 - ${endHour}:00${timezoneStr}`
      );
    } else {
      elizaLogger.log("- Action Time Window: 24/7 (no restrictions)");
    }

    elizaLogger.log(
      `- Post Immediately: ${
        this.client.twitterConfig.POST_IMMEDIATELY ? "enabled" : "disabled"
      }`
    );
    elizaLogger.log(
      `- Search Enabled: ${
        this.client.twitterConfig.TWITTER_SEARCH_ENABLE ? "enabled" : "disabled"
      }`
    );

    const targetUsers = this.client.twitterConfig.TWITTER_TARGET_USERS;
    if (targetUsers) {
      elizaLogger.log(`- Target Users: ${targetUsers}`);
    }

    if (this.isDryRun) {
      elizaLogger.log(
        "Twitter client initialized in dry run mode - no actual tweets should be posted"
      );
    }

    console.log(
      "TwitterPostClient initialized",
      runtime.getSetting("TWITTER_APPROVAL_ENABLED")
    );
    // Initialize Discord webhook
    const approvalRequired: boolean =
      this.runtime
        .getSetting("TWITTER_APPROVAL_ENABLED")
        ?.toLocaleLowerCase() === "true";
    if (approvalRequired) {
      const discordToken = this.runtime.getSetting(
        "TWITTER_APPROVAL_DISCORD_BOT_TOKEN"
      );
      const approvalChannelId = this.runtime.getSetting(
        "TWITTER_APPROVAL_DISCORD_CHANNEL_ID"
      );

      const APPROVAL_CHECK_INTERVAL =
        Number.parseInt(
          this.runtime.getSetting("TWITTER_APPROVAL_CHECK_INTERVAL")
        ) || 5 * 60 * 1000; // 5 minutes

      this.approvalCheckInterval = APPROVAL_CHECK_INTERVAL;

      if (!discordToken || !approvalChannelId) {
        throw new Error(
          "TWITTER_APPROVAL_DISCORD_BOT_TOKEN and TWITTER_APPROVAL_DISCORD_CHANNEL_ID are required for approval workflow"
        );
      }

      this.approvalRequired = true;
      this.discordApprovalChannelId = approvalChannelId;

      // Set up Discord client event handlers
      this.setupDiscordClient();
    }
  }

  private setupDiscordClient() {
    this.discordClientForApproval = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message, Partials.Reaction],
    });
    this.discordClientForApproval.once(Events.ClientReady, (readyClient) => {
      elizaLogger.log(`Discord bot is ready as ${readyClient.user.tag}!`);

      // Generate invite link with required permissions
      const invite = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=274877991936&scope=bot`;
      // 274877991936 includes permissions for:
      // - Send Messages
      // - Read Messages/View Channels
      // - Read Message History

      elizaLogger.log(
        `Use this link to properly invite the Twitter Post Approval Discord bot: ${invite}`
      );
    });
    // Login to Discord
    this.discordClientForApproval.login(
      this.runtime.getSetting("TWITTER_APPROVAL_DISCORD_BOT_TOKEN")
    );
  }

  async start() {
    if (!this.client.profile) {
      await this.client.init();
    }

    const generateNewTweetLoop = async () => {
      const lastPost = await this.runtime.cacheManager.get<{
        timestamp: number;
      }>("twitter/" + this.twitterUsername + "/lastPost");

      const lastPostTimestamp = lastPost?.timestamp ?? 0;
      const minMinutes = this.client.twitterConfig.POST_INTERVAL_MIN;
      const maxMinutes = this.client.twitterConfig.POST_INTERVAL_MAX;
      const randomMinutes =
        Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
      const delay = randomMinutes * 60 * 1000;

      if (Date.now() > lastPostTimestamp + delay) {
        await this.generateNewTweet();
      }

      setTimeout(() => {
        generateNewTweetLoop(); // Set up next iteration
      }, delay);

      elizaLogger.log(`Next tweet scheduled in ${randomMinutes} minutes`);
    };

    const processActionsLoop = async () => {
      const actionInterval = this.client.twitterConfig.ACTION_INTERVAL; // Defaults to 5 minutes
      const startHour = this.client.twitterConfig.ACTION_START_HOUR;
      const endHour = this.client.twitterConfig.ACTION_END_HOUR;

      // Log time-based configuration
      if (startHour !== undefined && endHour !== undefined) {
        const timezone = this.client.twitterConfig.ACTION_TIMEZONE || "local";
        elizaLogger.log(
          `Time-based scheduling enabled: ${startHour}:00 - ${endHour}:00 (${timezone} timezone)`
        );
      } else {
        elizaLogger.log("Time-based scheduling disabled - running 24/7");
      }

      while (!this.stopProcessingActions) {
        try {
          if (this.isWithinActiveHours()) {
            // We're in active hours - process tweets normally
            const results = await this.processTweetActions();
            if (results) {
              elizaLogger.log(`Processed ${results.length} tweets`);
              elizaLogger.log(
                `Next action processing scheduled in ${actionInterval} minutes`
              );
            }

            // Wait for the regular interval before next processing
            await new Promise((resolve) =>
              setTimeout(resolve, actionInterval * 60 * 1000)
            );
          } else {
            // We're outside active hours - wait until next active period
            const timeUntilActive = this.calculateTimeUntilActive();
            const durationStr = this.formatDuration(timeUntilActive);

            elizaLogger.log(
              `Outside active hours (${startHour}:00 - ${endHour}:00). Sleeping for ${durationStr} until next active period`
            );

            // Sleep until next active period (or check every 5 minutes minimum)
            const sleepTime = Math.min(timeUntilActive, 5 * 60 * 1000); // Check at least every 5 minutes
            await new Promise((resolve) => setTimeout(resolve, sleepTime));
          }
        } catch (error) {
          elizaLogger.error("Error in action processing loop:", error);
          console.error(error);
          // Add exponential backoff on error
          await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30s on error
        }
      }
    };

    if (this.client.twitterConfig.POST_IMMEDIATELY) {
      await this.generateNewTweet();
    }

    if (this.client.twitterConfig.ENABLE_TWITTER_POST_GENERATION) {
      generateNewTweetLoop();
      elizaLogger.log("Tweet generation loop started");
    }

    if (this.client.twitterConfig.ENABLE_ACTION_PROCESSING) {
      processActionsLoop().catch((error) => {
        elizaLogger.error("Fatal error in process actions loop:", error);
      });
    }

    // Start the pending tweet check loop if enabled
    if (this.approvalRequired) this.runPendingTweetCheckLoop();
  }

  private runPendingTweetCheckLoop() {
    setInterval(async () => {
      await this.handlePendingTweet();
    }, this.approvalCheckInterval);
  }

  createTweetObject(
    tweetResult: any,
    client: any,
    twitterUsername: string
  ): Tweet {
    return {
      id: tweetResult.rest_id,
      name: client.profile.screenName,
      username: client.profile.username,
      text: tweetResult.legacy.full_text,
      conversationId: tweetResult.legacy.conversation_id_str,
      createdAt: tweetResult.legacy.created_at,
      timestamp: new Date(tweetResult.legacy.created_at).getTime(),
      userId: client.profile.id,
      inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
      permanentUrl: `https://twitter.com/${twitterUsername}/status/${tweetResult.rest_id}`,
      hashtags: [],
      mentions: [],
      photos: [],
      thread: [],
      urls: [],
      videos: [],
    } as Tweet;
  }

  async processAndCacheTweet(
    runtime: IAgentRuntime,
    client: ClientBase,
    tweet: Tweet,
    roomId: UUID,
    rawTweetContent: string
  ) {
    // Cache the last post details
    await runtime.cacheManager.set(
      `twitter/${client.profile.username}/lastPost`,
      {
        id: tweet.id,
        timestamp: Date.now(),
      }
    );

    // Cache the tweet
    await client.cacheTweet(tweet);

    // Log the posted tweet
    elizaLogger.log(`Tweet posted:\n ${tweet.permanentUrl}`);

    // Ensure the room and participant exist
    await runtime.ensureRoomExists(roomId);
    await runtime.ensureParticipantInRoom(runtime.agentId, roomId);

    // Create a memory for the tweet
    await runtime.messageManager.createMemory({
      id: stringToUuid(tweet.id + "-" + runtime.agentId),
      userId: runtime.agentId,
      agentId: runtime.agentId,
      content: {
        text: rawTweetContent.trim(),
        url: tweet.permanentUrl,
        source: "twitter",
      },
      roomId,
      embedding: getEmbeddingZeroVector(),
      createdAt: tweet.timestamp,
    });
  }

  async handleNoteTweet(
    client: ClientBase,
    content: string,
    tweetId?: string,
    mediaData?: MediaData[]
  ) {
    try {
      const noteTweetResult = await client.requestQueue.add(
        async () =>
          await client.twitterClient.sendNoteTweet(content, tweetId, mediaData)
      );

      if (noteTweetResult.errors && noteTweetResult.errors.length > 0) {
        // Note Tweet failed due to authorization. Falling back to standard Tweet.
        const truncateContent = truncateToCompleteSentence(
          content,
          this.client.twitterConfig.MAX_TWEET_LENGTH
        );
        return await this.sendStandardTweet(client, truncateContent, tweetId);
      } else {
        return noteTweetResult.data.notetweet_create.tweet_results.result;
      }
    } catch (error) {
      throw new Error(`Note Tweet failed: ${error}`);
    }
  }

  async sendStandardTweet(
    client: ClientBase,
    content: string,
    tweetId?: string,
    mediaData?: MediaData[]
  ) {
    try {
      const standardTweetResult = await client.requestQueue.add(
        async () =>
          await client.twitterClient.sendTweet(content, tweetId, mediaData)
      );
      const body = await standardTweetResult.json();
      if (!body?.data?.create_tweet?.tweet_results?.result) {
        elizaLogger.error("Error sending tweet; Bad response:", body);
        return;
      }
      return body.data.create_tweet.tweet_results.result;
    } catch (error) {
      elizaLogger.error("Error sending standard Tweet:", error);
      throw error;
    }
  }

  async postTweet(
    runtime: IAgentRuntime,
    client: ClientBase,
    tweetTextForPosting: string,
    roomId: UUID,
    rawTweetContent: string,
    twitterUsername: string,
    mediaData?: MediaData[]
  ) {
    try {
      elizaLogger.log(`Posting new tweet:\n`);

      let result;

      if (tweetTextForPosting.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(
          client,
          tweetTextForPosting,
          undefined,
          mediaData
        );
      } else {
        result = await this.sendStandardTweet(
          client,
          tweetTextForPosting,
          undefined,
          mediaData
        );
      }

      const tweet = this.createTweetObject(result, client, twitterUsername);

      await this.processAndCacheTweet(
        runtime,
        client,
        tweet,
        roomId,
        rawTweetContent
      );
    } catch (error) {
      elizaLogger.error("Error sending tweet:", error);
    }
  }

  /**
   * Generates and posts a new tweet. If isDryRun is true, only logs what would have been posted.
   */
  async generateNewTweet() {
    elizaLogger.log("Generating new tweet");

    try {
      const roomId = stringToUuid(
        "twitter_generate_room-" + this.client.profile.username
      );
      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        this.client.profile.username,
        this.runtime.character.name,
        "twitter"
      );

      const topics = this.runtime.character.topics.join(", ");
      const maxTweetLength = this.client.twitterConfig.MAX_TWEET_LENGTH;
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
        }
      );

      const context = composeContext({
        state,
        template:
          this.runtime.character.templates?.twitterPostTemplate ||
          twitterPostTemplate,
      });

      elizaLogger.debug("generate post prompt:\n" + context);

      const response = await generateText({
        runtime: this.runtime,
        context,
        modelClass: ModelClass.SMALL,
      });

      const rawTweetContent = response; //cleanJsonResponse(response);

      // First attempt to clean content
      let tweetTextForPosting = null;
      let mediaData = null;

      // Try parsing as JSON first
      const parsedResponse = parseJSONObjectFromText(rawTweetContent);
      if (parsedResponse?.text) {
        tweetTextForPosting = parsedResponse.text;
      } else {
        // If not JSON, use the raw text directly
        tweetTextForPosting = rawTweetContent.trim();
      }

      if (
        parsedResponse?.attachments &&
        parsedResponse?.attachments.length > 0
      ) {
        mediaData = await fetchMediaData(parsedResponse.attachments);
      }

      // Try extracting text attribute
      if (!tweetTextForPosting) {
        const parsingText = extractAttributes(rawTweetContent, ["text"]).text;
        if (parsingText) {
          tweetTextForPosting = truncateToCompleteSentence(
            extractAttributes(rawTweetContent, ["text"]).text,
            this.client.twitterConfig.MAX_TWEET_LENGTH
          );
        }
      }

      // Use the raw text
      if (!tweetTextForPosting) {
        tweetTextForPosting = rawTweetContent;
      }

      // Truncate the content to the maximum tweet length specified in the environment settings, ensuring the truncation respects sentence boundaries.
      if (maxTweetLength) {
        tweetTextForPosting = truncateToCompleteSentence(
          tweetTextForPosting,
          maxTweetLength
        );
      }

      const removeQuotes = (str: string) => str.replace(/^['"](.*)['"]$/, "$1");

      const fixNewLines = (str: string) => str.replaceAll(/\\n/g, "\n\n"); //ensures double spaces
      // Final cleaning
      tweetTextForPosting = removeQuotes(fixNewLines(tweetTextForPosting));

      if (this.isDryRun) {
        elizaLogger.info(
          `Dry run: would have posted tweet: ${tweetTextForPosting}`
        );
        return;
      }

      try {
        if (this.approvalRequired) {
          // Send for approval instead of posting directly
          elizaLogger.log(
            `Sending Tweet For Approval:\n ${tweetTextForPosting}`
          );
          await this.sendForApproval(
            tweetTextForPosting,
            roomId,
            rawTweetContent
          );
          elizaLogger.log("Tweet sent for approval");
        } else {
          elizaLogger.log(`Posting new tweet:\n ${tweetTextForPosting}`);
          this.postTweet(
            this.runtime,
            this.client,
            tweetTextForPosting,
            roomId,
            rawTweetContent,
            this.twitterUsername,
            mediaData
          );
        }
      } catch (error) {
        elizaLogger.error(`Error sending tweet:"\n ${error}`);
      }
    } catch (error) {
      elizaLogger.error(`Error generating new tweet:\n ${error}`);
      console.error(error);
    }
  }

  private async generateTweetContent(
    tweetState: any,
    options?: {
      template?: TemplateType;
      context?: string;
    }
  ): Promise<string> {
    const context = composeContext({
      state: tweetState,
      template:
        options?.template ||
        this.runtime.character.templates?.twitterPostTemplate ||
        twitterPostTemplate,
    });

    const response = await generateText({
      runtime: this.runtime,
      context: options?.context || context,
      modelClass: ModelClass.SMALL,
    });

    elizaLogger.log("generate tweet content response:\n" + response);

    // First clean up any markdown and newlines
    const cleanedResponse = cleanJsonResponse(response);

    // Try to parse as JSON first
    const jsonResponse = parseJSONObjectFromText(cleanedResponse);
    if (jsonResponse.text) {
      const truncateContent = truncateToCompleteSentence(
        jsonResponse.text,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      );
      return truncateContent;
    }
    if (typeof jsonResponse === "object") {
      const possibleContent =
        jsonResponse.content || jsonResponse.message || jsonResponse.response;
      if (possibleContent) {
        const truncateContent = truncateToCompleteSentence(
          possibleContent,
          this.client.twitterConfig.MAX_TWEET_LENGTH
        );
        return truncateContent;
      }
    }

    let truncateContent = null;
    // Try extracting text attribute
    const parsingText = extractAttributes(cleanedResponse, ["text"]).text;
    if (parsingText) {
      truncateContent = truncateToCompleteSentence(
        parsingText,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      );
    }

    if (!truncateContent) {
      // If not JSON or no valid content found, clean the raw text
      truncateContent = truncateToCompleteSentence(
        cleanedResponse,
        this.client.twitterConfig.MAX_TWEET_LENGTH
      );
    }

    return truncateContent;
  }

  /**
   * Processes tweet actions (likes, retweets, quotes, replies). If isDryRun is true,
   * only simulates and logs actions without making API calls.
   */
  private async processTweetActions() {
    if (this.isProcessing) {
      elizaLogger.log("Already processing tweet actions, skipping");
      return null;
    }

    try {
      this.isProcessing = true;
      this.lastProcessTime = Date.now();

      elizaLogger.log("Processing tweet actions");

      await this.runtime.ensureUserExists(
        this.runtime.agentId,
        this.twitterUsername,
        this.runtime.character.name,
        "twitter"
      );

      const timelines = await this.client.fetchTimelineForActions(
        MAX_TIMELINES_TO_FETCH
      );
      const maxActionsProcessing =
        this.client.twitterConfig.MAX_ACTIONS_PROCESSING;
      const processedTimelines = [];

      for (const tweet of timelines) {
        try {
          // Skip if we've already processed this tweet
          const memory = await this.runtime.messageManager.getMemoryById(
            stringToUuid(tweet.id + "-" + this.runtime.agentId)
          );
          if (memory) {
            elizaLogger.log(`Already processed tweet ID: ${tweet.id}`);
            continue;
          }

          const roomId = stringToUuid(
            tweet.conversationId + "-" + this.runtime.agentId
          );

          const tweetState = await this.runtime.composeState(
            {
              userId: this.runtime.agentId,
              roomId,
              agentId: this.runtime.agentId,
              content: { text: "", action: "" },
            },
            {
              twitterUserName: this.twitterUsername,
              currentTweet: `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})\nText: ${tweet.text}`,
            }
          );

          const actionContext = composeContext({
            state: tweetState,
            template:
              this.runtime.character.templates?.twitterActionTemplate ||
              twitterActionTemplate,
          });

          const actionResponse = await generateTweetActions({
            runtime: this.runtime,
            context: actionContext,
            modelClass: ModelClass.SMALL,
          });

          if (!actionResponse) {
            elizaLogger.log(`No valid actions generated for tweet ${tweet.id}`);
            continue;
          }
          processedTimelines.push({
            tweet: tweet,
            actionResponse: actionResponse,
            tweetState: tweetState,
            roomId: roomId,
          });
        } catch (error) {
          elizaLogger.error(`Error processing tweet ${tweet.id}:`, error);
          continue;
        }
      }

      const sortProcessedTimeline = (arr: typeof processedTimelines) => {
        return arr.sort((a, b) => {
          // Count the number of true values in the actionResponse object
          const countTrue = (obj: typeof a.actionResponse) =>
            Object.values(obj).filter(Boolean).length;

          const countA = countTrue(a.actionResponse);
          const countB = countTrue(b.actionResponse);

          // Primary sort by number of true values
          if (countA !== countB) {
            return countB - countA;
          }

          // Secondary sort by the "like" property
          if (a.actionResponse.like !== b.actionResponse.like) {
            return a.actionResponse.like ? -1 : 1;
          }

          // Tertiary sort keeps the remaining objects with equal weight
          return 0;
        });
      };
      // Sort the timeline based on the action decision score,
      // then slice the results according to the environment variable to limit the number of actions per cycle.
      const sortedTimelines = sortProcessedTimeline(processedTimelines).slice(
        0,
        maxActionsProcessing
      );

      return this.processTimelineActions(sortedTimelines); // Return results array to indicate completion
    } catch (error) {
      elizaLogger.error("Error in processTweetActions:", error);
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Processes a list of timelines by executing the corresponding tweet actions.
   * Each timeline includes the tweet, action response, tweet state, and room context.
   * Results are returned for tracking completed actions.
   *
   * @param timelines - Array of objects containing tweet details, action responses, and state information.
   * @returns A promise that resolves to an array of results with details of executed actions.
   */
  private async processTimelineActions(
    timelines: {
      tweet: Tweet;
      actionResponse: ActionResponse;
      tweetState: State;
      roomId: UUID;
    }[]
  ): Promise<
    {
      tweetId: string;
      actionResponse: ActionResponse;
      executedActions: string[];
    }[]
  > {
    const results = [];
    for (const timeline of timelines) {
      const { actionResponse, tweetState, roomId, tweet } = timeline;
      try {
        const executedActions: string[] = [];
        // Execute actions
        if (actionResponse.like) {
          if (this.isDryRun) {
            elizaLogger.info(`Dry run: would have liked tweet ${tweet.id}`);
            executedActions.push("like (dry run)");
          } else {
            try {
              await this.client.twitterClient.likeTweet(tweet.id);
              executedActions.push("like");
              elizaLogger.log(`Liked tweet ${tweet.id}`);
            } catch (error) {
              elizaLogger.error(`Error liking tweet ${tweet.id}:`, error);
            }
          }
        }

        // if (actionResponse.retweet) {
        //   // Check if retweets are disabled in settings
        //   const twitterSettings = getTwitterSettings(this.runtime.character);
        //   if (twitterSettings.disableRetweets) {
        //     elizaLogger.log(
        //       `Retweets are disabled in settings, skipping retweet for tweet ${tweet.id}`
        //     );
        //   } else if (this.isDryRun) {
        //     elizaLogger.info(`Dry run: would have retweeted tweet ${tweet.id}`);
        //     executedActions.push("retweet (dry run)");
        //   } else {
        //     try {
        //       await this.client.twitterClient.retweet(tweet.id);
        //       executedActions.push("retweet");
        //       elizaLogger.log(`Retweeted tweet ${tweet.id}`);
        //     } catch (error) {
        //       elizaLogger.error(`Error retweeting tweet ${tweet.id}:`, error);
        //     }
        //   }
        // }

        // if (actionResponse.quote) {
        //   try {
        //     // Build conversation thread for context
        //     const thread = await buildConversationThread(tweet, this.client);
        //     const formattedConversation = thread
        //       .map(
        //         (t) =>
        //           `@${t.username} (${new Date(
        //             t.timestamp * 1000
        //           ).toLocaleString()}): ${t.text}`
        //       )
        //       .join("\n\n");

        //     // Generate image descriptions if present
        //     const imageDescriptions = [];
        //     if (tweet.photos?.length > 0) {
        //       elizaLogger.log("Processing images in tweet for context");

        //       for (const photo of tweet.photos) {
        //         const description = await this.runtime
        //           .getService<IImageDescriptionService>(
        //             ServiceType.IMAGE_DESCRIPTION
        //           )
        //           .describeImage(photo.url);

        //         console.log("DESCRIPTION", description);
        //         if (
        //           description.description
        //             .toLowerCase()
        //             .includes("describe_image")
        //         ) {
        //           description.description = description.description.replace(
        //             "describe_image",
        //             ""
        //           );
        //         }
        //         imageDescriptions.push(description);
        //       }
        //     }

        //     // Handle quoted tweet if present
        //     let quotedContent = "";
        //     if (tweet.quotedStatusId) {
        //       try {
        //         const quotedTweet = await this.client.twitterClient.getTweet(
        //           tweet.quotedStatusId
        //         );
        //         if (quotedTweet) {
        //           quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
        //         }
        //       } catch (error) {
        //         elizaLogger.error("Error fetching quoted tweet:", error);
        //       }
        //     }

        //     // Compose rich state with all context
        //     const enrichedState = await this.runtime.composeState(
        //       {
        //         userId: this.runtime.agentId,
        //         roomId: stringToUuid(
        //           tweet.conversationId + "-" + this.runtime.agentId
        //         ),
        //         agentId: this.runtime.agentId,
        //         content: {
        //           text: tweet.text,
        //           action: "QUOTE",
        //         },
        //       },
        //       {
        //         twitterUserName: this.twitterUsername,
        //         currentPost: `From @${tweet.username}: ${tweet.text}`,
        //         formattedConversation,
        //         imageContext:
        //           imageDescriptions.length > 0
        //             ? `\nImages in Tweet:\n${imageDescriptions
        //                 .map((desc, i) => `Image ${i + 1}: ${desc}`)
        //                 .join("\n")}`
        //             : "",
        //         quotedContent,
        //       }
        //     );

        //     const quoteContent = await this.generateTweetContent(
        //       enrichedState,
        //       {
        //         template:
        //           this.runtime.character.templates
        //             ?.twitterMessageHandlerTemplate ||
        //           twitterMessageHandlerTemplate,
        //       }
        //     );

        //     if (!quoteContent) {
        //       elizaLogger.error("Failed to generate valid quote tweet content");
        //       return;
        //     }

        //     elizaLogger.log("Generated quote tweet content:", quoteContent);
        //     // Check for dry run mode
        //     if (this.isDryRun) {
        //       elizaLogger.info(
        //         `Dry run: A quote tweet for tweet ID ${tweet.id} would have been posted with the following content: "${quoteContent}".`
        //       );
        //       executedActions.push("quote (dry run)");
        //     } else {
        //       // Send the tweet through request queue
        //       const result = await this.client.requestQueue.add(
        //         async () =>
        //           await this.client.twitterClient.sendQuoteTweet(
        //             quoteContent,
        //             tweet.id
        //           )
        //       );

        //       const body = await result.json();

        //       if (body?.data?.create_tweet?.tweet_results?.result) {
        //         elizaLogger.log("Successfully posted quote tweet");
        //         executedActions.push("quote");

        //         // Cache generation context for debugging
        //         await this.runtime.cacheManager.set(
        //           `twitter/quote_generation_${tweet.id}.txt`,
        //           `Context:\n${enrichedState}\n\nGenerated Quote:\n${quoteContent}`
        //         );
        //       } else {
        //         elizaLogger.error("Quote tweet creation failed:", body);
        //       }
        //     }
        //   } catch (error) {
        //     elizaLogger.error("Error in quote tweet generation:", error);
        //   }
        // }

        if (actionResponse.reply) {
          try {
            await this.handleTextOnlyReply(tweet, tweetState, executedActions);
          } catch (error) {
            elizaLogger.error(`Error replying to tweet ${tweet.id}:`, error);
          }
        }

        // Add these checks before creating memory
        await this.runtime.ensureRoomExists(roomId);
        await this.runtime.ensureUserExists(
          stringToUuid(tweet.userId),
          tweet.username,
          tweet.name,
          "twitter"
        );
        await this.runtime.ensureParticipantInRoom(
          this.runtime.agentId,
          roomId
        );

        if (!this.isDryRun) {
          // Then create the memory
          await this.runtime.messageManager.createMemory({
            id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
            userId: stringToUuid(tweet.userId),
            content: {
              text: tweet.text,
              url: tweet.permanentUrl,
              source: "twitter",
              action: executedActions.join(","),
            },
            agentId: this.runtime.agentId,
            roomId,
            embedding: getEmbeddingZeroVector(),
            createdAt: tweet.timestamp * 1000,
          });
        }

        results.push({
          tweetId: tweet.id,
          actionResponse: actionResponse,
          executedActions,
        });
      } catch (error) {
        elizaLogger.error(`Error processing tweet ${tweet.id}:`, error);
        continue;
      }
    }

    return results;
  }

  /**
   * Handles text-only replies to tweets. If isDryRun is true, only logs what would
   * have been replied without making API calls.
   */
  private async handleTextOnlyReply(
    tweet: Tweet,
    tweetState: any,
    executedActions: string[]
  ) {
    try {
      // Build conversation thread for context
      const thread = await buildConversationThread(tweet, this.client);
      const formattedConversation = thread
        .map(
          (t) =>
            `@${t.username} (${new Date(
              t.timestamp * 1000
            ).toLocaleString()}): ${t.text}`
        )
        .join("\n\n");

      // Generate image descriptions if present
      const imageDescriptions = [];
      if (tweet.photos?.length > 0) {
        elizaLogger.log("Processing images in tweet for context");
        for (const photo of tweet.photos) {
          const description = await this.runtime
            .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
            .describeImage(photo.url);
          imageDescriptions.push(description);
        }
      }

      // Handle quoted tweet if present
      let quotedContent = "";
      if (tweet.quotedStatusId) {
        try {
          const quotedTweet = await this.client.twitterClient.getTweet(
            tweet.quotedStatusId
          );
          if (quotedTweet) {
            quotedContent = `\nQuoted Tweet from @${quotedTweet.username}:\n${quotedTweet.text}`;
          }
        } catch (error) {
          elizaLogger.error("Error fetching quoted tweet:", error);
        }
      }

      // Compose rich state with all context
      const enrichedState = await this.runtime.composeState(
        {
          userId: this.runtime.agentId,
          roomId: stringToUuid(
            tweet.conversationId + "-" + this.runtime.agentId
          ),
          agentId: this.runtime.agentId,
          content: { text: tweet.text, action: "" },
        },
        {
          twitterUserName: this.twitterUsername,
          currentPost: `From @${tweet.username}: ${tweet.text}`,
          formattedConversation,
          imageContext:
            imageDescriptions.length > 0
              ? `\nImages in Tweet:\n${imageDescriptions
                  .map((desc, i) => `Image ${i + 1}: ${desc}`)
                  .join("\n")}`
              : "",
          quotedContent,
        }
      );

      // Generate and clean the reply content
      const replyText = await this.generateTweetContent(enrichedState, {
        template:
          this.runtime.character.templates?.twitterMessageHandlerTemplate ||
          twitterMessageHandlerTemplate,
      });

      if (!replyText) {
        elizaLogger.error("Failed to generate valid reply content");
        return;
      }

      if (this.isDryRun) {
        elizaLogger.info(
          `Dry run: reply to tweet ${tweet.id} would have been: ${replyText}`
        );
        executedActions.push("reply (dry run)");
        return;
      }

      elizaLogger.debug("Final reply text to be sent:", replyText);

      let result;

      if (replyText.length > DEFAULT_MAX_TWEET_LENGTH) {
        result = await this.handleNoteTweet(this.client, replyText, tweet.id);
      } else {
        result = await this.sendStandardTweet(this.client, replyText, tweet.id);
      }

      if (result) {
        elizaLogger.log("Successfully posted reply tweet");
        executedActions.push("reply");

        // Cache generation context for debugging
        await this.runtime.cacheManager.set(
          `twitter/reply_generation_${tweet.id}.txt`,
          `Context:\n${enrichedState}\n\nGenerated Reply:\n${replyText}`
        );
      } else {
        elizaLogger.error("Tweet reply creation failed");
      }
    } catch (error) {
      elizaLogger.error("Error in handleTextOnlyReply:", error);
    }
  }

  /**
   * Checks if the current time is within the configured active hours
   */
  private isWithinActiveHours(): boolean {
    const startHour = this.client.twitterConfig.ACTION_START_HOUR;
    const endHour = this.client.twitterConfig.ACTION_END_HOUR;

    // If no time restrictions are configured, always active
    if (startHour === undefined || endHour === undefined) {
      return true;
    }

    const now = new Date();
    const timezone = this.client.twitterConfig.ACTION_TIMEZONE;

    // Get current hour in the specified timezone (or local if not specified)
    const currentHour = timezone
      ? new Date(now.toLocaleString("en-US", { timeZone: timezone })).getHours()
      : now.getHours();

    // Handle normal case (start < end, e.g., 13-23)
    if (startHour <= endHour) {
      return currentHour >= startHour && currentHour <= endHour;
    }

    // Handle overnight case (start > end, e.g., 23-6)
    return currentHour >= startHour || currentHour <= endHour;
  }

  /**
   * Calculates milliseconds until the next active period starts
   */
  private calculateTimeUntilActive(): number {
    const startHour = this.client.twitterConfig.ACTION_START_HOUR;
    const endHour = this.client.twitterConfig.ACTION_END_HOUR;

    // If no time restrictions are configured, return 0 (immediately active)
    if (startHour === undefined || endHour === undefined) {
      return 0;
    }

    const now = new Date();
    const timezone = this.client.twitterConfig.ACTION_TIMEZONE;

    // Create a date object in the correct timezone
    const currentTime = timezone
      ? new Date(now.toLocaleString("en-US", { timeZone: timezone }))
      : now;

    const currentHour = currentTime.getHours();
    const currentMinutes = currentTime.getMinutes();
    const currentSeconds = currentTime.getSeconds();

    // Calculate start time for today
    const todayStart = new Date(currentTime);
    todayStart.setHours(startHour, 0, 0, 0);

    // Calculate start time for tomorrow
    const tomorrowStart = new Date(currentTime);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    tomorrowStart.setHours(startHour, 0, 0, 0);

    let targetTime: Date;

    if (startHour <= endHour) {
      // Normal case (start < end)
      if (currentHour < startHour) {
        // Before start time today
        targetTime = todayStart;
      } else {
        // After end time today or during active hours (shouldn't happen)
        targetTime = tomorrowStart;
      }
    } else {
      // Overnight case (start > end)
      if (currentHour < startHour && currentHour > endHour) {
        // In the gap between end and start
        targetTime = todayStart;
      } else {
        // During active hours (shouldn't happen) or after start time
        targetTime = tomorrowStart;
      }
    }

    const timeDifference = targetTime.getTime() - currentTime.getTime();
    return Math.max(0, timeDifference);
  }

  /**
   * Formats time duration for logging
   */
  private formatDuration(milliseconds: number): string {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async stop() {
    this.stopProcessingActions = true;
  }

  private async sendForApproval(
    tweetTextForPosting: string,
    roomId: UUID,
    rawTweetContent: string
  ): Promise<string | null> {
    try {
      const embed = {
        title: "New Tweet Pending Approval",
        description: tweetTextForPosting,
        fields: [
          {
            name: "Character",
            value: this.client.profile.username,
            inline: true,
          },
          {
            name: "Length",
            value: tweetTextForPosting.length.toString(),
            inline: true,
          },
        ],
        footer: {
          text: "Reply with '👍' to post or '❌' to discard, This will automatically expire and remove after 24 hours if no response received",
        },
        timestamp: new Date().toISOString(),
      };

      const channel = await this.discordClientForApproval.channels.fetch(
        this.discordApprovalChannelId
      );

      if (!channel || !(channel instanceof TextChannel)) {
        throw new Error("Invalid approval channel");
      }

      const message = await channel.send({ embeds: [embed] });

      // Store the pending tweet
      const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
      const currentPendingTweets =
        (await this.runtime.cacheManager.get<PendingTweet[]>(
          pendingTweetsKey
        )) || [];
      // Add new pending tweet
      currentPendingTweets.push({
        tweetTextForPosting,
        roomId,
        rawTweetContent,
        discordMessageId: message.id,
        channelId: this.discordApprovalChannelId,
        timestamp: Date.now(),
      });

      // Store updated array
      await this.runtime.cacheManager.set(
        pendingTweetsKey,
        currentPendingTweets
      );

      return message.id;
    } catch (error) {
      elizaLogger.error("Error Sending Twitter Post Approval Request:", error);
      return null;
    }
  }

  private async checkApprovalStatus(
    discordMessageId: string
  ): Promise<PendingTweetApprovalStatus> {
    try {
      // Fetch message and its replies from Discord
      const channel = await this.discordClientForApproval.channels.fetch(
        this.discordApprovalChannelId
      );

      elizaLogger.log(`channel ${JSON.stringify(channel)}`);

      if (!(channel instanceof TextChannel)) {
        elizaLogger.error("Invalid approval channel");
        return "PENDING";
      }

      // Fetch the original message and its replies
      const message = await channel.messages.fetch(discordMessageId);

      // Look for thumbs up reaction ('👍')
      const thumbsUpReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === "👍"
      );

      // Look for reject reaction ('❌')
      const rejectReaction = message.reactions.cache.find(
        (reaction) => reaction.emoji.name === "❌"
      );

      // Check if the reaction exists and has reactions
      if (rejectReaction) {
        const count = rejectReaction.count;
        if (count > 0) {
          return "REJECTED";
        }
      }

      // Check if the reaction exists and has reactions
      if (thumbsUpReaction) {
        // You might want to check for specific users who can approve
        // For now, we'll return true if anyone used thumbs up
        const count = thumbsUpReaction.count;
        if (count > 0) {
          return "APPROVED";
        }
      }

      return "PENDING";
    } catch (error) {
      elizaLogger.error("Error checking approval status:", error);
      return "PENDING";
    }
  }

  private async cleanupPendingTweet(discordMessageId: string) {
    const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
    const currentPendingTweets =
      (await this.runtime.cacheManager.get<PendingTweet[]>(pendingTweetsKey)) ||
      [];

    // Remove the specific tweet
    const updatedPendingTweets = currentPendingTweets.filter(
      (tweet) => tweet.discordMessageId !== discordMessageId
    );

    if (updatedPendingTweets.length === 0) {
      await this.runtime.cacheManager.delete(pendingTweetsKey);
    } else {
      await this.runtime.cacheManager.set(
        pendingTweetsKey,
        updatedPendingTweets
      );
    }
  }

  private async handlePendingTweet() {
    elizaLogger.log("Checking Pending Tweets...");
    const pendingTweetsKey = `twitter/${this.client.profile.username}/pendingTweet`;
    const pendingTweets =
      (await this.runtime.cacheManager.get<PendingTweet[]>(pendingTweetsKey)) ||
      [];

    for (const pendingTweet of pendingTweets) {
      // Check if tweet is older than 24 hours
      const isExpired =
        Date.now() - pendingTweet.timestamp > 24 * 60 * 60 * 1000;

      if (isExpired) {
        elizaLogger.log("Pending tweet expired, cleaning up");

        // Notify on Discord about expiration
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId
            );
            await originalMessage.reply(
              "This tweet approval request has expired (24h timeout)."
            );
          }
        } catch (error) {
          elizaLogger.error("Error sending expiration notification:", error);
        }

        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
        return;
      }

      // Check approval status
      elizaLogger.log("Checking approval status...");
      const approvalStatus: PendingTweetApprovalStatus =
        await this.checkApprovalStatus(pendingTweet.discordMessageId);

      if (approvalStatus === "APPROVED") {
        elizaLogger.log("Tweet Approved, Posting");
        await this.postTweet(
          this.runtime,
          this.client,
          pendingTweet.tweetTextForPosting,
          pendingTweet.roomId,
          pendingTweet.rawTweetContent,
          this.twitterUsername
        );

        // Notify on Discord about posting
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId
            );
            await originalMessage.reply(
              "Tweet has been posted successfully! ✅"
            );
          }
        } catch (error) {
          elizaLogger.error("Error sending post notification:", error);
        }

        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
      } else if (approvalStatus === "REJECTED") {
        elizaLogger.log("Tweet Rejected, Cleaning Up");
        await this.cleanupPendingTweet(pendingTweet.discordMessageId);
        // Notify about Rejection of Tweet
        try {
          const channel = await this.discordClientForApproval.channels.fetch(
            pendingTweet.channelId
          );
          if (channel instanceof TextChannel) {
            const originalMessage = await channel.messages.fetch(
              pendingTweet.discordMessageId
            );
            await originalMessage.reply("Tweet has been rejected! ❌");
          }
        } catch (error) {
          elizaLogger.error("Error sending rejection notification:", error);
        }
      }
    }
  }
}
