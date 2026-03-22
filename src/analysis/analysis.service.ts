import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { GeminiService } from './gemini.service';
import { OptimizerService } from './optimizer.service';
import { PrismaService } from '../prisma/prisma.service';
import { handleDeploymentError } from './error-handler';
import { buildRagFixPrompt } from './prompt-templates';
import { AnalysisResult } from './dto/analysis-response.dto';

/** Parse AI JSON response (handles markdown code blocks) */
function parseAIJsonResponse(
  text: string,
): {
  fixedCode: string;
  explanation: string;
  parallelismScore?: number;
} | null {
  try {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();
    const parsed = JSON.parse(raw) as {
      fixedCode?: string;
      explanation?: string;
      parallelismScore?: number;
    };
    if (parsed.fixedCode != null && parsed.explanation != null) {
      const score =
        typeof parsed.parallelismScore === 'number'
          ? Math.max(0, Math.min(100, parsed.parallelismScore))
          : undefined;
      return {
        fixedCode: String(parsed.fixedCode).replace(/\\n/g, '\n'),
        explanation: String(parsed.explanation),
        parallelismScore: score,
      };
    }
  } catch {
    // Try fallback regex extraction
    const objMatch = text.match(
      /\{\s*"fixedCode"\s*:\s*"([\s\S]*?)"\s*,\s*"explanation"\s*:\s*"([\s\S]*?)"\s*\}/,
    );
    if (objMatch) {
      return {
        fixedCode: objMatch[1].replace(/\\n/g, '\n'),
        explanation: objMatch[2].replace(/\\n/g, '\n'),
      };
    }
  }
  return null;
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly monadDocsDir: string;

  constructor(
    private readonly geminiService: GeminiService,
    private readonly optimizerService: OptimizerService,
    private readonly prismaService: PrismaService,
  ) {
    // Resolve monad-docs path relative to the backend project root
    this.monadDocsDir = path.join(
      process.cwd(),
      'data',
      'monad-docs',
    );
  }

  /**
   * Load all monad-docs RAG context files from disk
   */
  async loadRagContext(): Promise<string> {
    try {
      const files = await fs.readdir(this.monadDocsDir);
      const mdFiles = files.filter((f) => f.endsWith('.md')).sort();
      const contents: string[] = [];

      for (const file of mdFiles) {
        const filePath = path.join(this.monadDocsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        contents.push(`## ${file}\n${content}`);
      }

      this.logger.debug(
        `Loaded ${mdFiles.length} RAG context files from monad-docs`,
      );
      return contents.join('\n\n---\n\n');
    } catch (error) {
      this.logger.warn(
        `Failed to load monad-docs RAG context: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  /**
   * Full error analysis pipeline:
   * 1. Parse error → extract context
   * 2. Load RAG context (monad-docs)
   * 3. Build prompt → call Gemini AI
   * 4. Parse JSON response
   * 5. Fallback to rule-based heuristics if AI fails
   * 6. Run optimizer on contract source
   * 7. Optionally persist to Analysis table
   */
  async analyzeError(
    error: Record<string, unknown>,
    contractSource: string,
    errorCode?: string,
    userId?: string,
  ): Promise<AnalysisResult> {
    // 1. Parse the error
    const parsed = handleDeploymentError(error);

    // 2. Run optimizer regardless of error analysis
    const optimization = contractSource
      ? this.optimizerService.calculateScore(contractSource)
      : null;

    // Build the error code string for AI prompt
    const errorCodeForAI =
      errorCode ??
      [
        parsed.message,
        parsed.reason,
        parsed.shortMessage,
        parsed.code != null ? `code: ${parsed.code}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    // 3. Load RAG context
    const context = await this.loadRagContext();

    // 4. Try AI analysis
    let fixedCode: string | null = null;
    let explanation: string | null = null;
    let aiParallelismScore: number | undefined;
    let category: string | undefined;

    if (contractSource) {
      const prompt = buildRagFixPrompt(context, errorCodeForAI, contractSource);

      try {
        const aiResponse = await this.geminiService.generateContent(prompt);
        if (aiResponse) {
          const parsedAI = parseAIJsonResponse(aiResponse);
          if (parsedAI) {
            fixedCode = parsedAI.fixedCode;
            explanation = parsedAI.explanation;
            aiParallelismScore = parsedAI.parallelismScore;
            this.logger.log('AI analysis completed successfully');
          }
        }
      } catch (aiErr) {
        this.logger.error(
          `AI analysis failed, falling back to heuristics: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`,
        );
      }
    }

    // 5. Fallback heuristics if AI didn't produce a result
    if (!fixedCode) {
      const msg = parsed.message.toLowerCase();
      let summary =
        'An error occurred. Please check network status and gas settings.';

      if (
        msg.includes('gas') ||
        msg.includes('insufficient') ||
        msg.includes('funds')
      ) {
        summary =
          'Gas or balance insufficient. Monad deducts based on gas_limit, not gas_used.';
        fixedCode = `// Increase gasLimit (e.g. 500000n -> 800000n)\n// Or check MON balance on deployer account\n${contractSource}`;
      } else if (msg.includes('nonce') || msg.includes('replacement')) {
        summary =
          'Nonce conflict. In Monad parallel execution, retry with delay.';
        fixedCode = `// Add delay before retrying transaction\n// await new Promise(r => setTimeout(r, 2000));\n${contractSource}`;
      } else if (
        msg.includes('revert') ||
        msg.includes('execution reverted')
      ) {
        summary =
          'Contract execution reverted. Check require/assert conditions or state dependencies.';
        fixedCode = contractSource;
      } else if (
        msg.includes('opcode') ||
        msg.includes('invalid') ||
        msg.includes('pectra')
      ) {
        summary =
          'Pectra unsupported opcode or bytecode compatibility issue. Check inline assembly or deprecated opcodes.';
        fixedCode = contractSource;
      } else if (parsed.isMonadSpecific) {
        summary =
          'Possible Monad-specific issue (parallel execution/gas policy). Detailed analysis recommended.';
        fixedCode = contractSource;
      } else {
        fixedCode = contractSource;
      }

      explanation = summary;
      this.logger.log('Used heuristic fallback for error analysis');
    }

    // Determine category from parsed error
    const msg = parsed.message.toLowerCase();
    if (
      msg.includes('gas') ||
      msg.includes('insufficient') ||
      msg.includes('funds')
    ) {
      category = 'gas_policy';
    } else if (msg.includes('nonce') || msg.includes('parallel')) {
      category = 'parallelism';
    } else if (msg.includes('opcode') || msg.includes('pectra')) {
      category = 'pectra_fork';
    } else if (parsed.isMonadSpecific) {
      category = 'monad_specific';
    } else {
      category = 'general';
    }

    const result: AnalysisResult = {
      analysis: {
        summary: explanation ?? 'Analysis complete',
        fixedCode,
        explanation: explanation ?? 'No explanation available',
        isMonadSpecific: parsed.isMonadSpecific,
        category,
        parallelismScore: aiParallelismScore,
      },
      optimization,
    };

    // 7. Optionally persist to DB
    if (userId) {
      try {
        await this.prismaService.analysis.create({
          data: {
            userId,
            contractSource,
            errorMessage: parsed.message,
            fixedCode: fixedCode ?? undefined,
            explanation: explanation ?? undefined,
            category,
            isMonadSpecific: parsed.isMonadSpecific,
          },
        });
        this.logger.debug(`Analysis result saved for user ${userId}`);
      } catch (dbErr) {
        this.logger.warn(
          `Failed to save analysis result: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        );
      }
    }

    return result;
  }

  /**
   * Streaming version of analyzeError — yields AI response chunks in real time.
   * Falls back to a single JSON chunk if AI streaming fails.
   */
  async *analyzeErrorStream(
    error: Record<string, unknown>,
    contractSource: string,
    errorCode?: string,
  ): AsyncGenerator<string> {
    const parsed = handleDeploymentError(error);

    const errorCodeForAI =
      errorCode ??
      [
        parsed.message,
        parsed.reason,
        parsed.shortMessage,
        parsed.code != null ? `code: ${parsed.code}` : '',
      ]
        .filter(Boolean)
        .join('\n');

    const context = await this.loadRagContext();

    if (contractSource) {
      const prompt = buildRagFixPrompt(context, errorCodeForAI, contractSource);

      try {
        let hasChunks = false;
        for await (const chunk of this.geminiService.generateContentStream(
          prompt,
        )) {
          hasChunks = true;
          yield chunk;
        }
        if (hasChunks) return;
      } catch (streamErr) {
        this.logger.warn(
          `Streaming analysis failed, falling back to non-streaming: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
        );
      }
    }

    // Fallback: return the non-streaming result as a single chunk
    const result = await this.analyzeError(
      error,
      contractSource,
      errorCode,
    );
    yield JSON.stringify(result);
  }
}
