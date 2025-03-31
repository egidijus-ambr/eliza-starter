import { ModelProviderName } from '@elizaos/core';
import { getTokenForProvider } from './src/config/index.ts';
import { VertexAI } from '@google-cloud/vertexai';
import fs from 'fs';

// Load the vertex character config
const characterPath = './characters/vertex-claude.character.json';
const character = JSON.parse(fs.readFileSync(characterPath, 'utf8'));

// Check if the ModelProviderName.VERTEX is defined
console.log('Available ModelProviderName values:', Object.values(ModelProviderName));

// We're adding a temporary VERTEX value for testing
// In a production environment, this would be defined in the @elizaos/core package
ModelProviderName.VERTEX = 'vertex';

console.log('ModelProvider in character:', character.modelProvider);
console.log('Is using VERTEX provider?', character.modelProvider === ModelProviderName.VERTEX);

// Get credentials
const credentials = getTokenForProvider(ModelProviderName.VERTEX, character);
console.log('Credentials path:', credentials);

// Initialize Vertex AI client
const projectId = process.env.VERTEX_AI_PROJECT_ID || 'furnisystems-deployments';
const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
const modelId = process.env.VERTEX_AI_MODEL || 'claude-3-7-sonnet@20250219';

async function testVertexProvider() {
  try {
    console.log('Initializing Vertex AI client...');
    console.log(`Project ID: ${projectId}`);
    console.log(`Location: ${location}`);
    console.log(`Model: ${modelId}`);

    // Initialize Vertex AI
    const vertexAI = new VertexAI({
      project: projectId,
      location: location,
    });

    // Get the generative model
    const generativeModel = vertexAI.getGenerativeModel({
      model: modelId,
    });

    // Define a simple chat message
    const chatMessages = [
      { role: 'system', parts: [{ text: character.system }] },
      { role: 'user', parts: [{ text: 'Hello, can you introduce yourself?' }] }
    ];
    
    console.log('\nSending chat message...');

    // Generate chat response
    const result = await generativeModel.generateContent({
      contents: chatMessages,
    });

    // Extract and display the response
    const response = result.response;
    console.log('\nResponse:');
    console.log(response.candidates[0].content.parts[0].text);

    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error during test:', error);
  }
}

testVertexProvider();
