import { elizaLogger } from "@elizaos/core";

// Set the log level to 'trace' to see all log messages including elizaLogger.log
elizaLogger.level = "debug";

console.log("Log level set to:", elizaLogger.level);
console.log("Now elizaLogger.log messages will be visible in the terminal.");
