import { VertexAI, VertexAIModel } from '@google-cloud/vertexai';

// Initialize Vertex AI with project and location
const projectId = process.env.VERTEX_AI_PROJECT_ID || 'furnisystems-deployments';
const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
const modelId = process.env.VERTEX_AI_MODEL || 'claude-3-7-sonnet@20250219';

async function main() {
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

    // Define the prompt
    const prompt = "What can you tell me about Google Cloud Vertex AI?";
    console.log(`\nSending prompt: "${prompt}"`);

    // Generate content
    const result = await generativeModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
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

main();
