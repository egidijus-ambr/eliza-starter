import { VertexAI } from "@google-cloud/vertexai";
import { ModelProviderName, settings } from "@elizaos/core";

// Define interfaces needed for Vertex provider
interface ChatContent {
  text: string;
  [key: string]: any;
}

interface ChatMessage {
  user: string;
  content: ChatContent;
}

interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  systemUserId?: string;
  userIds?: string[];
}

interface ModelProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
  get(model: string, options?: any): any;
}

// Extend the ModelProviderName enum with VERTEX
declare module "@elizaos/core" {
  export enum ModelProviderName {
    VERTEX = "vertex",
  }
}

// Make TypeScript recognize VERTEX as a value of ModelProviderName
(ModelProviderName as any).VERTEX = "google";

export class VertexProvider implements ModelProvider {
  private vertexAI: VertexAI;
  private projectId: string;
  private location: string;
  private modelId: string;
  private models: Record<string, any> = {};

  constructor() {
    // Get configuration from environment variables
    this.projectId =
      process.env.VERTEX_AI_PROJECT_ID ||
      settings.VERTEX_AI_PROJECT_ID ||
      "furnisystems-deployments";
    this.location =
      process.env.VERTEX_AI_LOCATION ||
      settings.VERTEX_AI_LOCATION ||
      "us-central1";
    this.modelId =
      process.env.VERTEX_AI_MODEL ||
      settings.VERTEX_AI_MODEL ||
      "claude-3-7-sonnet@20250219";

    // Initialize Vertex AI client
    this.vertexAI = new VertexAI({
      project: this.projectId,
      location: this.location,
    });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    try {
      // Convert Eliza ChatMessage format to Vertex AI format
      const vertexMessages = messages.map((msg) => {
        // Determine role
        let role =
          msg.user === options?.systemUserId
            ? "system"
            : msg.user === options?.userIds?.[0]
            ? "user"
            : "assistant";

        // Create Vertex AI message
        return {
          role: role,
          parts: [{ text: msg.content.text }],
        };
      });

      // Get generative model
      const generativeModel = this.vertexAI.getGenerativeModel({
        model: this.modelId,
      });

      // Generate content
      const result = await generativeModel.generateContent({
        contents: vertexMessages,
        generationConfig: {
          temperature: options?.temperature || 0.7,
          maxOutputTokens: options?.maxTokens || 2048,
          topP: options?.topP || 0.95,
        },
      });

      // Extract response text
      const response = result.response;
      return response.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error("Error in Vertex AI chat:", error);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Get generative model
      const generativeModel = this.vertexAI.getGenerativeModel({
        model: this.modelId,
      });

      // Simple test to check if the model is available
      const testResult = await generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: "test" }] }],
      });

      return !!testResult.response;
    } catch (error) {
      console.error("Vertex AI is not available:", error);
      return false;
    }
  }

  /**
   * Get a model configuration for the specified model
   * @param model The model name or identifier
   * @param options Additional options
   * @returns A model configuration object
   */
  get(model: string, options?: any): any {
    // Use the specified model or fall back to the default
    const modelId = model || this.modelId;

    // Return cached model if available
    if (this.models[modelId]) {
      return this.models[modelId];
    }

    // Create and cache model configuration
    const modelConfig = {
      id: modelId,
      vertexAI: this.vertexAI,
      endpoint: {
        baseURL: `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/${this.location}/publishers/google/models/${modelId}:predict`,
        timeout: 30000,
        headers: {
          "Content-Type": "application/json",
        },
      },
      generationConfig: {
        temperature: options?.temperature || 0.7,
        maxOutputTokens: options?.maxTokens || 2048,
        topP: options?.topP || 0.95,
      },
      // Add a generate method that the system can call
      generate: async (prompt: string, genOptions?: any) => {
        try {
          const generativeModel = this.vertexAI.getGenerativeModel({
            model: modelId,
          });

          const result = await generativeModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              ...this.models[modelId].generationConfig,
              ...(genOptions || {}),
            },
          });

          return result.response.candidates[0].content.parts[0].text;
        } catch (error) {
          console.error(`Error generating with model ${modelId}:`, error);
          throw error;
        }
      },
    };

    // Cache the model configuration
    this.models[modelId] = modelConfig;

    return modelConfig;
  }
}

/**
 * Factory function to create a VertexProvider instance
 */
export function createVertexProvider(): ModelProvider {
  return new VertexProvider();
}
