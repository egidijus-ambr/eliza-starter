import { VertexAI } from '@google-cloud/vertexai';

// Initialize Vertex AI with project and location
const projectId = process.env.VERTEX_AI_PROJECT_ID || 'furnisystems-deployments';
const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
const claudeModelId = process.env.VERTEX_AI_MODEL || 'claude-3-7-sonnet@20250219';

async function testClaudeOnVertex() {
  try {
    console.log('Testing Claude 3.7 Sonnet on Vertex AI');
    console.log(`Project ID: ${projectId}`);
    console.log(`Location: ${location}`);
    console.log(`Model: ${claudeModelId}`);

    // Initialize Vertex AI
    const vertexAI = new VertexAI({
      project: projectId,
      location: location,
    });

    // Get the Claude model
    const generativeModel = vertexAI.getGenerativeModel({
      model: claudeModelId,
    });

    // Define a conversation with system prompt and user message
    const conversation = [
      {
        role: 'system',
        parts: [{ text: 'You are Claude, a helpful AI assistant created by Anthropic and running on Google Cloud Vertex AI.' }]
      },
      {
        role: 'user',
        parts: [{ text: 'Please introduce yourself and explain how you\'re running on Vertex AI.' }]
      }
    ];
    
    console.log('\nSending conversation to Claude on Vertex AI...');

    // Generate response
    const result = await generativeModel.generateContent({
      contents: conversation,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        topP: 0.95,
      },
    });

    // Extract and display the response
    const response = result.response;
    console.log('\nClaude\'s Response:');
    console.log(response.candidates[0].content.parts[0].text);

    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error during Claude on Vertex AI test:', error);
  }
}

// Run the test
testClaudeOnVertex();
