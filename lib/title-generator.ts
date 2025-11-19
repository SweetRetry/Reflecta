import { ChatAnthropic } from "@langchain/anthropic";
import { chatConfig } from "./chat-config";

/**
 * Generate a concise, descriptive title for a chat session based on the first exchange
 * @param userMessage - The user's first message
 * @param assistantMessage - The assistant's first response
 * @returns A concise title (max 50 characters)
 */
export async function generateSessionTitle(
  userMessage: string,
  assistantMessage: string
): Promise<string> {
  try {
    // Create a lightweight model instance for title generation
    // We explicitly disable streaming and thinking to ensure a simple text response
    const model = new ChatAnthropic({
      model: chatConfig.getModelConfig().model,
      apiKey: chatConfig.getApiKey(),
      temperature: 0.3, // Low temperature for consistent, concise output
      maxTokens: 50, // Short response for title only
      maxRetries: 1,
      streaming: false, // Disable streaming
      // model_kwargs: { thinking: undefined }, // Ensure thinking is disabled if supported
      ...(chatConfig.getBaseUrl() && {
        configuration: { baseURL: chatConfig.getBaseUrl() },
      }),
    });

    // Detect language from user message
    const hasChineseChars = /[\u4e00-\u9fa5]/.test(userMessage);
    const language = hasChineseChars ? "中文" : "English";

    // Craft a prompt for title generation
    const prompt = `Based on this conversation exchange, generate a concise, descriptive title.

User: ${userMessage.substring(0, 200)}
Assistant: ${assistantMessage.substring(0, 200)}

Requirements:
- Language: ${language}
- Length: Maximum 50 characters, about 3-8 words
- Format: No quotes, no punctuation at the end
- Style: Descriptive noun phrase (e.g., "Python数据分析教程" or "React Component Design")
- Focus: Capture the main topic or purpose of the conversation

Title:`;

    const response = await model.invoke(prompt);
    
    let titleText = "";
    if (typeof response.content === "string") {
      titleText = response.content;
    } else if (Array.isArray(response.content)) {
      titleText = response.content
        .map((block) => {
          if (typeof block === "string") return block;
          if (block.type === "text") return block.text;
          return "";
        })
        .join("");
    }
    
    const title = titleText.trim();

    // Clean up the title (remove quotes, trailing punctuation)
    const cleanedTitle = title
      .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "") // Remove surrounding quotes
      .replace(/[.!?;,]+$/, "") // Remove trailing punctuation
      .substring(0, 50); // Enforce max length

    return cleanedTitle || userMessage.substring(0, 50);
  } catch (error) {
    console.error("Failed to generate session title:", error);
    // Fallback to truncated user message
    return userMessage.substring(0, 50);
  }
}
