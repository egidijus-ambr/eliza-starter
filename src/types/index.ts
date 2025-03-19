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
}

// Helper function to extract Twitter settings from character
export function getTwitterSettings(character: any): TwitterSettings {
  return character?.settings?.twitter || {};
}
