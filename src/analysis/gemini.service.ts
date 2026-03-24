import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

/** Default model (latest Flash) */
const DEFAULT_MODEL = 'gemini-2.5-flash';
/** Fallback model (stable general-purpose) */
const FALLBACK_MODEL = 'gemini-2.0-flash';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: GoogleGenerativeAI | null = null;
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('gemini.apiKey');
    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY not configured — AI analysis will be disabled',
      );
    }
  }

  /** Lazy-initialize the GoogleGenerativeAI client */
  private getClient(): GoogleGenerativeAI | null {
    if (this.client) return this.client;
    if (!this.apiKey) return null;
    this.client = new GoogleGenerativeAI(this.apiKey);
    return this.client;
  }

  /** Get the primary model instance */
  private getModel(): GenerativeModel | null {
    const client = this.getClient();
    if (!client) return null;
    const modelId =
      this.configService.get<string>('gemini.model') || DEFAULT_MODEL;
    this.logger.debug(`Using Gemini model: ${modelId}`);
    return client.getGenerativeModel({ model: modelId });
  }

  /** Get the fallback model instance */
  private getFallbackModel(): GenerativeModel | null {
    const client = this.getClient();
    if (!client) return null;
    this.logger.debug(`Using fallback Gemini model: ${FALLBACK_MODEL}`);
    return client.getGenerativeModel({ model: FALLBACK_MODEL });
  }

  /**
   * Generate content using Gemini AI.
   * Returns the text response, or null if API key not configured or both models fail.
   */
  async generateContent(prompt: string): Promise<string | null> {
    const model = this.getModel();
    if (!model) return null;

    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (primaryError) {
      this.logger.warn(
        `Primary model failed, trying fallback: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
      );

      const fallback = this.getFallbackModel();
      if (!fallback) return null;

      try {
        const result = await fallback.generateContent(prompt);
        return result.response.text();
      } catch (fallbackError) {
        this.logger.error(
          `Fallback model also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
        return null;
      }
    }
  }

  /**
   * Generate content using Gemini AI with streaming.
   * Yields text chunks as they arrive.
   * Returns empty generator if API key not configured.
   */
  async *generateContentStream(prompt: string): AsyncGenerator<string> {
    const model = this.getModel();
    if (!model) return;

    try {
      const streamResult = await model.generateContentStream(prompt);
      for await (const chunk of streamResult.stream) {
        const text = chunk.text();
        if (text) yield text;
      }
    } catch (primaryError) {
      this.logger.warn(
        `Primary model streaming failed, trying fallback: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`,
      );

      const fallback = this.getFallbackModel();
      if (!fallback) return;

      try {
        const streamResult = await fallback.generateContentStream(prompt);
        for await (const chunk of streamResult.stream) {
          const text = chunk.text();
          if (text) yield text;
        }
      } catch (fallbackError) {
        this.logger.error(
          `Fallback model streaming also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
        );
      }
    }
  }
}
