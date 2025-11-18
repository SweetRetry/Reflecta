/**
 * Web Search Tool Integration
 * Supports multiple search providers: Tavily, SerpAPI
 */

import { ChatValidator } from "../chat-validator";

export type SearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

export type SearchResponse = {
  results: SearchResult[];
  query: string;
  provider: string;
};

/**
 * Tavily Search API Integration
 * https://tavily.com
 */
async function searchWithTavily(query: string): Promise<SearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic", // or "advanced" for more comprehensive results
        include_answer: false,
        include_raw_content: false,
        max_results: 5,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const results: SearchResult[] = (data.results || []).map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      content: r.content || "",
      score: r.score,
    }));

    return {
      results,
      query,
      provider: "Tavily",
    };
  } catch (error) {
    console.error("Tavily search error:", error);
    throw error;
  }
}

/**
 * SerpAPI Integration (Google Search)
 * https://serpapi.com
 */
async function searchWithSerpAPI(query: string): Promise<SearchResponse> {
  const apiKey = process.env.SERP_API_KEY;

  if (!apiKey) {
    throw new Error("SERP_API_KEY not configured");
  }

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      q: query,
      engine: "google",
      num: "5", // Number of results
    });

    const response = await fetch(`https://serpapi.com/search?${params}`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`SerpAPI error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    const results: SearchResult[] = (data.organic_results || []).map((r: any) => ({
      title: r.title || "",
      url: r.link || "",
      content: r.snippet || "",
    }));

    return {
      results,
      query,
      provider: "SerpAPI",
    };
  } catch (error) {
    console.error("SerpAPI search error:", error);
    throw error;
  }
}

/**
 * Main search function that automatically selects the best available provider
 *
 * @param query - Search query string
 * @returns SearchResponse with results from the selected provider
 */
export async function performWebSearch(query: string): Promise<SearchResponse> {
  // Sanitize query
  const sanitizedQuery = ChatValidator.sanitizeMessage(query).substring(0, 500);

  if (!sanitizedQuery.trim()) {
    throw new Error("Invalid search query");
  }

  // Try providers in order of preference
  const providers = [
    { name: "Tavily", key: process.env.TAVILY_API_KEY, fn: searchWithTavily },
    { name: "SerpAPI", key: process.env.SERP_API_KEY, fn: searchWithSerpAPI },
  ];

  const availableProvider = providers.find((p) => p.key);

  if (!availableProvider) {
    throw new Error(
      "No search API configured. Please set TAVILY_API_KEY or SERP_API_KEY in environment variables."
    );
  }

  console.log(`Using ${availableProvider.name} for search: "${sanitizedQuery}"`);

  try {
    return await availableProvider.fn(sanitizedQuery);
  } catch (error) {
    console.error(`${availableProvider.name} search failed:`, error);
    throw new Error(
      `Search failed with ${availableProvider.name}: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Formats search results into a readable text summary for LLM consumption
 *
 * @param response - SearchResponse object
 * @returns Formatted string with search results
 */
export function formatSearchResults(response: SearchResponse): string {
  const { results, query, provider } = response;

  if (results.length === 0) {
    return `No search results found for "${query}".`;
  }

  let formatted = `Search results for "${query}" (via ${provider}):\n\n`;

  results.forEach((result, index) => {
    formatted += `${index + 1}. **${result.title}**\n`;
    formatted += `   ${result.content}\n`;
    formatted += `   Source: ${result.url}\n\n`;
  });

  return formatted;
}

/**
 * Quick check if any search API is configured
 */
export function isSearchAvailable(): boolean {
  return !!(process.env.TAVILY_API_KEY || process.env.SERP_API_KEY);
}
