# Twitter Time-Based Scheduling

This document explains how to configure time-based scheduling for Twitter action processing in the Eliza framework.

## Overview

The Twitter client now supports time-based scheduling that allows you to specify when the `processTweetActions` function should be active during the day. This is useful for:

- Limiting bot activity to business hours
- Avoiding activity during specific time periods
- Respecting different timezones
- Creating more natural interaction patterns

## Configuration

Add these environment variables to configure time-based scheduling:

### Environment Variables

| Variable            | Type          | Description                              | Example            |
| ------------------- | ------------- | ---------------------------------------- | ------------------ |
| `ACTION_START_HOUR` | Number (0-23) | Hour when action processing should start | `13` (1 PM)        |
| `ACTION_END_HOUR`   | Number (0-23) | Hour when action processing should stop  | `23` (11 PM)       |
| `ACTION_TIMEZONE`   | String        | Timezone for the schedule (optional)     | `America/New_York` |

### Example Configurations

#### Basic Example (1 PM to 11 PM local time)

```bash
ACTION_START_HOUR=13
ACTION_END_HOUR=23
```

#### With Timezone (9 AM to 5 PM EST)

```bash
ACTION_START_HOUR=9
ACTION_END_HOUR=17
ACTION_TIMEZONE=America/New_York
```

#### 24/7 Operation (default)

```bash
# Don't set ACTION_START_HOUR and ACTION_END_HOUR
# OR comment them out to disable time restrictions
```

#### Overnight Schedule (11 PM to 6 AM)

```bash
ACTION_START_HOUR=23
ACTION_END_HOUR=6
ACTION_TIMEZONE=Europe/London
```

## How It Works

1. **Active Hours Check**: Before processing tweets, the system checks if the current time falls within the configured active hours.

2. **Smart Waiting**: When outside active hours, the system calculates how long to wait until the next active period and sleeps accordingly.

3. **Timezone Support**: If `ACTION_TIMEZONE` is specified, all time calculations are done in that timezone. Otherwise, the system uses the local server timezone.

4. **Logging**: The system provides clear logging about:
   - Whether time-based scheduling is enabled
   - Current active time window
   - When entering/exiting active periods
   - Time remaining until next active period

## Sample Log Output

### With Time Scheduling Enabled

```
Twitter Client Configuration:
- Username: mybot
- Action Processing: enabled
- Action Interval: 5 minutes
- Action Time Window: 13:00 - 23:00 (America/New_York timezone)

Time-based scheduling enabled: 13:00 - 23:00 (America/New_York timezone)
Processing tweet actions
Processed 3 tweets
Next action processing scheduled in 5 minutes

Outside active hours (13:00 - 23:00). Sleeping for 8h 25m 30s until next active period
```

### Without Time Scheduling (24/7)

```
Twitter Client Configuration:
- Username: mybot
- Action Processing: enabled
- Action Interval: 5 minutes
- Action Time Window: 24/7 (no restrictions)

Time-based scheduling disabled - running 24/7
Processing tweet actions
Processed 2 tweets
Next action processing scheduled in 5 minutes
```

## Technical Details

### Time Validation

- Hours must be between 0-23 (24-hour format)
- Invalid hours are ignored and the system falls back to 24/7 operation
- If only one of `ACTION_START_HOUR` or `ACTION_END_HOUR` is set, time scheduling is disabled

### Timezone Handling

- Uses standard timezone identifiers (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`)
- Falls back to local server timezone if not specified or invalid
- Time calculations are performed in the specified timezone

### Edge Cases

- **Overnight schedules**: When `ACTION_START_HOUR > ACTION_END_HOUR`, the system handles overnight periods correctly
- **Minimum check interval**: Even when sleeping, the system checks at least every 5 minutes to handle configuration changes
- **Error recovery**: If there are errors in time calculations, the system falls back to normal operation

## Character-Specific Configuration

You can set different schedules for different characters by prefixing with the character name:

```bash
# Global default
ACTION_START_HOUR=9
ACTION_END_HOUR=17

# Character-specific override
alice.ACTION_START_HOUR=13
alice.ACTION_END_HOUR=23

# Bob will use the global default (9-17)
# Alice will use her specific schedule (13-23)
```

## Integration with Existing Features

Time-based scheduling works seamlessly with all existing Twitter features:

- ✅ Action processing (likes, replies, etc.)
- ✅ Dry run mode
- ✅ Action intervals
- ✅ Maximum actions per cycle
- ✅ Tweet approval workflows

The time restrictions only apply to `processTweetActions` - other functions like tweet generation continue to work normally.
