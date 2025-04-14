// Define Twitter settings interface
export interface TwitterSettings {
  trackUsers?: string[];
  includeVideos?: boolean;
  maxPostsToCheck?: number;
  avoidDuplicates?: boolean;
  includeVideosDescription?: string;
  maxPostsToCheckDescription?: string;
  avoidDuplicatesDescription?: string;

  // Auto-follower settings
  autoFollowEnabled?: boolean;
  autoFollowInterval?: number;
  autoFollowUsersPerRun?: number;
  autoFollowUnfollowAfterDays?: number;
  autoFollowMaxFollowerCount?: number;

  // Auto-follower description fields
  autoFollowEnabledDescription?: string;
  autoFollowIntervalDescription?: string;
  autoFollowUsersPerRunDescription?: string;
  autoFollowUnfollowAfterDaysDescription?: string;
  autoFollowMaxFollowerCountDescription?: string;

  // Auto-liker settings
  autoLikeEnabled?: boolean;
  autoLikeInterval?: number;
  autoLikeCommentsPerRun?: number;
  autoLikeMinCommentLength?: number;
  autoLikeMaxLikesPerDay?: number;

  // Auto-liker description fields
  autoLikeEnabledDescription?: string;
  autoLikeIntervalDescription?: string;
  autoLikeCommentsPerRunDescription?: string;
  autoLikeMinCommentLengthDescription?: string;
  autoLikeMaxLikesPerDayDescription?: string;

  // Rate limiting settings for different interaction types
  repliesPerHourLimit?: number; // Max replies per hour
  likesPerHourLimit?: number; // Max likes per hour
  retweetsPerHourLimit?: number; // Max retweets per hour
  quotesPerHourLimit?: number; // Max quote tweets per hour

  // Description fields for rate limiting
  repliesPerHourLimitDescription?: string;
  likesPerHourLimitDescription?: string;
  retweetsPerHourLimitDescription?: string;
  quotesPerHourLimitDescription?: string;

  // Disable specific interaction types
  disableRetweets?: boolean; // Completely disable retweets
  disableRetweetsDescription?: string;

  // Active hours settings
  activeHoursEnabled?: boolean;
  activeHoursStart?: number; // 0-23 hour format
  activeHoursEnd?: number; // 0-23 hour format
  timezone?: string; // e.g., "Europe/Vilnius"

  // Description fields for active hours
  activeHoursEnabledDescription?: string;
  activeHoursStartDescription?: string;
  activeHoursEndDescription?: string;
  timezoneDescription?: string;
}

// Helper function to extract Twitter settings from character
export function getTwitterSettings(character: any): TwitterSettings {
  return character?.settings?.twitter || {};
}
