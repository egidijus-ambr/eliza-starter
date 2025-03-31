import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { DirectClient } from "@elizaos/client-direct";
import { AgentRuntime, elizaLogger, settings, stringToUuid } from "@elizaos/core";
import { createVertexProvider } from "./src/vertex-provider.js";
import { getTokenForProvider } from "./src/config/index.js";
import { initializeDbCache } from "./src/cache/index.js";
import { initializeDatabase } from "./src/database/index.js";
import { createNodePlugin } from "@elizaos/plugin-node";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { solanaPlugin } from "@elizaos/plugin-solana";

// Set up logger
elizaLogger.level = "debug";
console.log("Log level set to:", elizaLogger.level);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  try {
    // Load vertex-claude character
    const characterPath = './characters/vertex-claude.character.json';
    const character = JSON.parse(fs.readFileSync(characterPath, 'utf8'));
    console.log(`Loaded character: ${character.name}`);
    
    // Initialize DirectClient
    const directClient = new DirectClient();
    
    // Prepare character
    character.id ??= stringToUuid(character.name);
    character.username ??= character.name;
    
    // Configure vertex provider manually if needed
    (ModelProviderName ?? {}).VERTEX = 'vertex';
    
    // Get token for Vertex provider
    const token = getTokenForProvider('vertex', character);
    console.log(`Credential path: ${token}`);
    
    // Set up database
    const dataDir = path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const db = initializeDatabase(dataDir);
    await db.init();
    
    // Create cache
    const cache = initializeDbCache(character, db);
    
    // Create agent
    console.log("Creating agent runtime...");
    const nodePlugin = createNodePlugin();
    
    const runtime = new AgentRuntime({
      databaseAdapter: db,
      token,
      modelProvider: character.modelProvider,
      evaluators: [],
      character,
      plugins: [
        bootstrapPlugin,
        nodePlugin,
        character.settings?.secrets?.WALLET_PUBLIC_KEY ? solanaPlugin : null,
      ].filter(Boolean),
      providers: [createVertexProvider()],
      actions: [],
      services: [],
      managers: [],
      cacheManager: cache,
    });
    
    // Initialize and register agent
    await runtime.initialize();
    directClient.registerAgent(runtime);
    
    // Test a simple chat interaction
    console.log("\nTesting chat interaction with Vertex-powered Claude...");
    const response = await runtime.chat([
      {
        user: "system",
        content: { text: character.system }
      },
      {
        user: "user1",
        content: { text: "Hello, can you introduce yourself?" }
      }
    ], {
      systemUserId: "system",
      userIds: ["user1"]
    });
    
    console.log("\nResponse from Claude on Vertex AI:");
    console.log(response);
    
    console.log("\nTest completed successfully!");
  } catch (error) {
    console.error("Error running test:", error);
  }
}

main();
