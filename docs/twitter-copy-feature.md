# Twitter Copy Feature

This feature allows the Twitter bot to copy tweets with media from other users and repost them as its own.

## Features

- Search for tweets from specific users that contain media (images and videos)
- Download media from tweets
- Repost tweets with the downloaded media
- Randomly select tweets with media from a user
- Automatically copy tweets on a schedule
- Track copied tweets to avoid duplicates

## Usage

### Using the Command-Line Tools

The easiest way to use this feature is with the provided command-line tools:

#### Twitter Tools Script

The `twitter-tools.js` script provides a comprehensive interface for working with the Twitter client:

```bash
node scripts/twitter-tools.js <command> [options]
```

Available commands:

- `copy-tweet <username>` - Copy a random tweet with media from a user
- `list-tweets <username> [count]` - List tweets with media from a user
- `help` - Show help message

Examples:

```bash
# Copy a random tweet with media from Elon Musk
node scripts/twitter-tools.js copy-tweet elonmusk

# List 20 tweets with media from NASA
node scripts/twitter-tools.js list-tweets nasa 20
```

#### Simple Copy Script

There's also a simpler script focused just on copying tweets:

```bash
node scripts/copy-tweet.js <username>
```

For example:

```bash
node scripts/copy-tweet.js elonmusk
```

Both scripts will:

1. Find tweets with media from the specified user
2. Select a random tweet with media
3. Copy the tweet text and media
4. Post it as a new tweet from your bot's account

### Automatic Tweet Copying

The bot can automatically copy tweets from specified users on a schedule. This is configured in the character settings file:

```json
{
  "settings": {
    "twitter": {
      "trackUsers": [
        "elonmusk",
        "nasa",
        "natgeo",
        "bbcearth",
        "cnn"
      ],
      "includeVideos": true,
      "maxPostsToCheck": 20,
      "avoidDuplicates": true
    }
  }
}
```

Configuration options:

- `trackUsers`: Array of Twitter usernames to track and copy from
- `includeVideos`: Whether to include videos in addition to images (default: true)
- `maxPostsToCheck`: Maximum number of posts to check per user (default: 20)
- `avoidDuplicates`: Avoid copying posts that have already been copied (default: true)

When the bot starts, it will automatically:

1. Select a random user from the `trackUsers` list
2. Find tweets with media from that user
3. Select a random tweet with media
4. Copy the tweet text and media
5. Wait for the specified interval
6. Repeat the process

### Programmatic Usage

You can also use the feature programmatically in your code:

```javascript
// Get the Twitter client
const twitterClient = runtime.clients.find(client =>
  client.constructor.name.toLowerCase().includes('twitter')
);

// Find tweets with media from a specific user
const tweetsWithMedia = await twitterClient.findTweetsWithMedia('username', 10);

// Copy a specific tweet with its media
await twitterClient.copyTweetWithMedia(tweetsWithMedia[0]);

// Or find and copy a random tweet with media
await twitterClient.findAndCopyRandomTweet('username', 20);

// Access the auto-copy feature
const autoCopy = twitterClient.autoCopy;

// Stop the automatic copying
autoCopy.stop();

// Restart the automatic copying (useful after config changes)
autoCopy.restart();
```

## API Reference

### `findTweetsWithMedia(username, count)`

Finds tweets from a specific user that contain media.

- `username`: The Twitter username to search for (without the @ symbol)
- `count`: Maximum number of tweets to search through (default: 10)
- Returns: An array of tweets that contain media

### `copyTweetWithMedia(tweet)`

Copies a tweet with its media.

- `tweet`: The tweet object to copy (must have a `photos` property)
- Returns: The result of the tweet creation

### `findAndCopyRandomTweet(username, count)`

Finds and copies a random tweet with media from a specific user.

- `username`: The Twitter username to search for (without the @ symbol)
- `count`: Maximum number of tweets to search through (default: 20)
- Returns: The result of the tweet creation

## Implementation Details

The feature works by:

1. Using the Twitter API to search for tweets from specific users
2. Filtering tweets to find those that contain media
3. Downloading the media files
4. Creating a new tweet with the same text and downloaded media

## Limitations

- Twitter API rate limits may restrict how many tweets you can fetch and how often
- Only images are currently supported (videos may not work correctly)
- Twitter may have policies against this type of reposting, so use responsibly
