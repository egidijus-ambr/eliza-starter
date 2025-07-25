import {
  parseBooleanFromText,
  type IAgentRuntime,
  ActionTimelineType,
} from "@elizaos/core";
import { z, ZodError } from "zod";

export const DEFAULT_MAX_TWEET_LENGTH = 280;

const twitterUsernameSchema = z
  .string()
  .min(1, "An X/Twitter Username must be at least 1 character long")
  .max(15, "An X/Twitter Username cannot exceed 15 characters")
  .refine((username) => {
    // Allow wildcard '*' as a special case
    if (username === "*") return true;

    // Twitter usernames can:
    // - Start with digits now
    // - Contain letters, numbers, underscores
    // - Must not be empty
    return /^[A-Za-z0-9_]+$/.test(username);
  }, "An X Username can only contain letters, numbers, and underscores");

/**
 * This schema defines all required/optional environment settings.
 */
export const twitterEnvSchema = z.object({
  TWITTER_DRY_RUN: z.boolean(),
  TWITTER_USERNAME: z.string().min(1, "X/Twitter username is required"),
  TWITTER_PASSWORD: z.string().min(1, "X/Twitter password is required"),
  TWITTER_EMAIL: z.string().email("Valid X/Twitter email is required"),
  MAX_TWEET_LENGTH: z.number().int().default(DEFAULT_MAX_TWEET_LENGTH),
  TWITTER_SEARCH_ENABLE: z.boolean().default(false),
  TWITTER_2FA_SECRET: z.string(),
  TWITTER_RETRY_LIMIT: z.number().int(),
  TWITTER_POLL_INTERVAL: z.number().int(),
  TWITTER_TARGET_USERS: z.array(twitterUsernameSchema).default([]),

  // Airtable integration settings
  AIRTABLE_API_KEY: z.string().optional(),
  AIRTABLE_BASE_ID: z.string().optional().default("appbC1uGsbdCIGFtV"),
  AIRTABLE_TABLE_ID: z.string().optional().default("tblWM3QmX5mCisCdG"),
  AIRTABLE_POLL_INTERVAL: z.number().int().optional().default(300000), // 5 minutes in milliseconds
  // I guess it's possible to do the transformation with zod
  // not sure it's preferable, maybe a readability issue
  // since more people will know js/ts than zod
  /*
        z
        .string()
        .transform((val) => val.trim())
        .pipe(
            z.string()
                .transform((val) =>
                    val ? val.split(',').map((u) => u.trim()).filter(Boolean) : []
                )
                .pipe(
                    z.array(
                        z.string()
                            .min(1)
                            .max(15)
                            .regex(
                                /^[A-Za-z][A-Za-z0-9_]*[A-Za-z0-9]$|^[A-Za-z]$/,
                                'Invalid Twitter username format'
                            )
                    )
                )
                .transform((users) => users.join(','))
        )
        .optional()
        .default(''),
    */
  ENABLE_TWITTER_POST_GENERATION: z.boolean(),
  POST_INTERVAL_MIN: z.number().int(),
  POST_INTERVAL_MAX: z.number().int(),
  ENABLE_ACTION_PROCESSING: z.boolean(),
  ACTION_INTERVAL: z.number().int(),
  ACTION_START_HOUR: z.number().int().min(0).max(23).optional(),
  ACTION_END_HOUR: z.number().int().min(0).max(23).optional(),
  ACTION_TIMEZONE: z.string().optional(),
  POST_IMMEDIATELY: z.boolean(),
  MAX_ACTIONS_PROCESSING: z.number().int(),
  ACTION_TIMELINE_TYPE: z
    .nativeEnum(ActionTimelineType)
    .default(ActionTimelineType.ForYou),
});

export type TwitterConfig = z.infer<typeof twitterEnvSchema>;

/**
 * Helper to parse a comma-separated list of Twitter usernames
 * (already present in your code).
 */
function parseTargetUsers(targetUsersStr?: string | null): string[] {
  if (!targetUsersStr?.trim()) {
    return [];
  }
  return targetUsersStr
    .split(",")
    .map((user) => user.trim())
    .filter(Boolean);
}

function safeParseInt(
  value: string | undefined | null,
  defaultValue: number
): number {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : Math.max(1, parsed);
}

/**
 * Validates or constructs a TwitterConfig object using zod,
 * taking values from the IAgentRuntime or process.env as needed.
 */
// This also is organized to serve as a point of documentation for the client
// most of the inputs from the framework (env/character)

// we also do a lot of typing/parsing here
// so we can do it once and only once per character
export async function validateTwitterConfig(
  runtime: IAgentRuntime
): Promise<TwitterConfig> {
  console.log("runtime.getSetting", runtime.character.name);
  const name = runtime.character.name + ".";
  try {
    const twitterConfig = {
      TWITTER_DRY_RUN:
        parseBooleanFromText(
          runtime.getSetting("TWITTER_DRY_RUN") || process.env.TWITTER_DRY_RUN
        ) ?? false, // parseBooleanFromText return null if "", map "" to false

      TWITTER_USERNAME:
        runtime.getSetting("TWITTER_USERNAME") ||
        process.env[name + "TWITTER_USERNAME"] ||
        process.env.TWITTER_USERNAME,

      TWITTER_PASSWORD:
        runtime.getSetting("TWITTER_PASSWORD") ||
        process.env[name + "TWITTER_PASSWORD"] ||
        process.env.TWITTER_PASSWORD,

      TWITTER_EMAIL:
        runtime.getSetting("TWITTER_EMAIL") ||
        process.env[name + "TWITTER_EMAIL"] ||
        process.env.TWITTER_EMAIL,

      // number as string?
      MAX_TWEET_LENGTH: safeParseInt(
        runtime.getSetting("MAX_TWEET_LENGTH") || process.env.MAX_TWEET_LENGTH,
        DEFAULT_MAX_TWEET_LENGTH
      ),

      TWITTER_SEARCH_ENABLE:
        parseBooleanFromText(
          runtime.getSetting("TWITTER_SEARCH_ENABLE") ||
            process.env.TWITTER_SEARCH_ENABLE
        ) ?? false,

      // string passthru
      TWITTER_2FA_SECRET:
        runtime.getSetting("TWITTER_2FA_SECRET") ||
        process.env.TWITTER_2FA_SECRET ||
        "",

      // int
      TWITTER_RETRY_LIMIT: safeParseInt(
        runtime.getSetting("TWITTER_RETRY_LIMIT") ||
          process.env.TWITTER_RETRY_LIMIT,
        5
      ),

      // int in seconds
      TWITTER_POLL_INTERVAL: safeParseInt(
        runtime.getSetting("TWITTER_POLL_INTERVAL") ||
          process.env.TWITTER_POLL_INTERVAL,
        120 // 2m
      ),

      // comma separated string
      TWITTER_TARGET_USERS: parseTargetUsers(
        runtime.getSetting("TWITTER_TARGET_USERS") ||
          process.env.TWITTER_TARGET_USERS
      ),

      // bool
      ENABLE_TWITTER_POST_GENERATION:
        parseBooleanFromText(
          runtime.getSetting("ENABLE_TWITTER_POST_GENERATION") ||
            process.env[name + "ENABLE_TWITTER_POST_GENERATION"] ||
            process.env.ENABLE_TWITTER_POST_GENERATION
        ) ?? true,

      // int in minutes
      POST_INTERVAL_MIN: safeParseInt(
        runtime.getSetting("POST_INTERVAL_MIN") ||
          process.env.POST_INTERVAL_MIN,
        90 // 1.5 hours
      ),

      // int in minutes
      POST_INTERVAL_MAX: safeParseInt(
        runtime.getSetting("POST_INTERVAL_MAX") ||
          process.env.POST_INTERVAL_MAX,
        180 // 3 hours
      ),

      // bool
      ENABLE_ACTION_PROCESSING:
        parseBooleanFromText(
          runtime.getSetting("ENABLE_ACTION_PROCESSING") ||
            process.env.ENABLE_ACTION_PROCESSING
        ) ?? false,

      // init in minutes (min 1m)
      ACTION_INTERVAL: safeParseInt(
        runtime.getSetting("ACTION_INTERVAL") || process.env.ACTION_INTERVAL,
        5 // 5 minutes
      ),

      // Action time window settings (optional)
      ACTION_START_HOUR: (() => {
        const value =
          runtime.getSetting("ACTION_START_HOUR") ||
          process.env[name + "ACTION_START_HOUR"] ||
          process.env.ACTION_START_HOUR;
        if (!value) return undefined;
        const parsed = Number.parseInt(value, 10);
        return isNaN(parsed) || parsed < 0 || parsed > 23 ? undefined : parsed;
      })(),

      ACTION_END_HOUR: (() => {
        const value =
          runtime.getSetting("ACTION_END_HOUR") ||
          process.env[name + "ACTION_END_HOUR"] ||
          process.env.ACTION_END_HOUR;
        if (!value) return undefined;
        const parsed = Number.parseInt(value, 10);
        return isNaN(parsed) || parsed < 0 || parsed > 23 ? undefined : parsed;
      })(),

      ACTION_TIMEZONE:
        runtime.getSetting("ACTION_TIMEZONE") ||
        process.env[name + "ACTION_TIMEZONE"] ||
        process.env.ACTION_TIMEZONE ||
        undefined,

      // bool
      POST_IMMEDIATELY:
        parseBooleanFromText(
          runtime.getSetting("POST_IMMEDIATELY") || process.env.POST_IMMEDIATELY
        ) ?? false,

      MAX_ACTIONS_PROCESSING: safeParseInt(
        runtime.getSetting("MAX_ACTIONS_PROCESSING") ||
          process.env.MAX_ACTIONS_PROCESSING,
        1
      ),

      ACTION_TIMELINE_TYPE:
        runtime.getSetting("ACTION_TIMELINE_TYPE") ||
        process.env.ACTION_TIMELINE_TYPE,

      // Airtable integration settings
      AIRTABLE_API_KEY:
        runtime.getSetting("AIRTABLE_API_KEY") || process.env.AIRTABLE_API_KEY,

      AIRTABLE_BASE_ID:
        runtime.getSetting("AIRTABLE_BASE_ID") ||
        process.env.AIRTABLE_BASE_ID ||
        "appbC1uGsbdCIGFtV",

      AIRTABLE_TABLE_ID:
        runtime.getSetting("AIRTABLE_TABLE_ID") ||
        process.env.AIRTABLE_TABLE_ID ||
        "tblWM3QmX5mCisCdG",

      AIRTABLE_POLL_INTERVAL: safeParseInt(
        runtime.getSetting("AIRTABLE_POLL_INTERVAL") ||
          process.env.AIRTABLE_POLL_INTERVAL,
        300000 // 5 minutes
      ),
    };

    return twitterEnvSchema.parse(twitterConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join(".")}: ${err.message}`)
        .join("\n");
      throw new Error(
        `X/Twitter configuration validation failed:\n${errorMessages}`
      );
    }
    throw error;
  }
}
