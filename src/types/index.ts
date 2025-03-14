// Define Twitter settings interface
export interface TwitterSettings {
  trackUsers?: string[];
  copyInterval?: number;
  includeVideos?: boolean;
  maxPostsToCheck?: number;
  avoidDuplicates?: boolean;
  copyIntervalDescription?: string;
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
}

// Helper function to extract Twitter settings from character
export function getTwitterSettings(character: any): TwitterSettings {
  return character?.settings?.twitter || {};
}
