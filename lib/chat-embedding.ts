import { FeatureExtractionPipeline } from "@xenova/transformers";
import { chatConfig } from "./chat-config";

export class LocalEmbeddingService {
  private static instance: LocalEmbeddingService;
  private modelLoaded = false;
  private pipeline: FeatureExtractionPipeline | null = null;

  private constructor() {}

  static getInstance(): LocalEmbeddingService {
    if (!LocalEmbeddingService.instance) {
      LocalEmbeddingService.instance = new LocalEmbeddingService();
    }
    return LocalEmbeddingService.instance;
  }

  private async ensureModelLoaded() {
    if (this.modelLoaded && this.pipeline) return;
    const modelName = chatConfig.getEmbeddingConfig().model || "Xenova/multilingual-e5-small";
    const { pipeline } = await import("@xenova/transformers");
    this.pipeline = await pipeline("feature-extraction", modelName);
    this.modelLoaded = true;
  }

  async embedText(text: string): Promise<number[]> {
    if (!text.trim()) return [];
    await this.ensureModelLoaded();
    if (!this.pipeline) return [];
    const output = await this.pipeline(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }
}
