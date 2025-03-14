# Twitter Copy Feature

This feature allows your Twitter bot to copy tweets with media from other users and repost them as its own.

## Quick Start

### Automatic Mode

1. Configure the users to track in your character settings file:

```json
{
  "settings": {
    "twitter": {
      "trackUsers": ["elonmusk", "nasa", "natgeo", "bbcearth", "cnn"],
      "copyInterval": 120,
      "includeVideos": true,
      "maxPostsToCheck": 20,
      "avoidDuplicates": true
    }
  }
}
```

2. Start your Twitter bot - it will automatically copy tweets from the tracked users on the specified interval

### Manual Mode

1. Make sure your Twitter bot is running
2. Use one of the provided scripts to copy tweets:

```bash
# Copy a random tweet with media from a user
node scripts/twitter-tools.js copy-tweet elonmusk

# List tweets with media from a user
node scripts/twitter-tools.js list-tweets nasa 20
```

## Installation

The feature is already integrated into the Twitter client. No additional installation is required.

## Documentation

For detailed documentation, see [docs/twitter-copy-feature.md](docs/twitter-copy-feature.md).

## Features

- Search for tweets from specific users that contain media (images and videos)
- Download media from tweets
- Repost tweets with the downloaded media
- Randomly select tweets with media from a user
- Automatically copy tweets on a schedule
- Track copied tweets to avoid duplicates

## Command-Line Tools

### Twitter Tools Script

The `twitter-tools.js` script provides a comprehensive interface:

```bash
node scripts/twitter-tools.js <command> [options]
```

Available commands:

- `copy-tweet <username>` - Copy a random tweet with media from a user
- `list-tweets <username> [count]` - List tweets with media from a user
- `help` - Show help message

### Simple Copy Script

There's also a simpler script focused just on copying tweets:

```bash
node scripts/copy-tweet.js <username>
```

## Limitations

- Twitter API rate limits may restrict how many tweets you can fetch and how often
- Only images are currently supported (videos may not work correctly)
- Twitter may have policies against this type of reposting, so use responsibly
