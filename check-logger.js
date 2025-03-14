import { elizaLogger } from "@elizaos/core";

// Print the current log level
console.log("Current log level:", elizaLogger.level);

// Print available log levels
console.log("Available log levels:", Object.keys(elizaLogger.levels));

// Try logging at different levels
elizaLogger.trace("This is a trace message");
elizaLogger.debug("This is a debug message");
elizaLogger.info("This is an info message");
elizaLogger.log("This is a log message");
elizaLogger.warn("This is a warn message");
elizaLogger.error("This is an error message");
elizaLogger.fatal("This is a fatal message");

// Try setting the log level to trace (lowest level)
elizaLogger.level = "trace";
console.log("New log level:", elizaLogger.level);

// Try logging again
elizaLogger.trace("This is a trace message after level change");
elizaLogger.debug("This is a debug message after level change");
elizaLogger.info("This is an info message after level change");
elizaLogger.log("This is a log message after level change");
elizaLogger.warn("This is a warn message after level change");
elizaLogger.error("This is an error message after level change");
elizaLogger.fatal("This is a fatal message after level change");
