import { elizaLogger } from "@elizaos/core";

// Set the log level to 'debug' to see debug messages and above
console.log("Current log level:", elizaLogger.level);
elizaLogger.level = "debug";
console.log("Log level set to:", elizaLogger.level);
console.log("Now elizaLogger.debug messages will be visible in the terminal.");

// Test logging at different levels to verify
elizaLogger.trace("This is a trace message (should not be visible)");
elizaLogger.debug("This is a debug message (should be visible)");
elizaLogger.info("This is an info message (should be visible)");
elizaLogger.log("This is a log message (should be visible)");
elizaLogger.warn("This is a warn message (should be visible)");
elizaLogger.error("This is an error message (should be visible)");
