import {
  Controller,
  Post,
  Body,
  Query,
  Res,
  Logger,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { AnalysisService } from './analysis.service';
import { AnalysisRequestDto } from './dto/analysis-request.dto';

@Controller('analysis')
export class AnalysisController {
  private readonly logger = new Logger(AnalysisController.name);

  constructor(private readonly analysisService: AnalysisService) {}

  /**
   * POST /api/analysis/error
   * Analyze a deployment error with Gemini AI RAG and optimizer.
   *
   * Normal mode: returns JSON { analysis, optimization }
   * Stream mode (?stream=true): returns chunked text/plain response
   *
   * Uses @Res() for streaming to bypass TransformInterceptor.
   */
  @Post('error')
  @UsePipes(new ValidationPipe({ transform: true }))
  async analyzeError(
    @Body() dto: AnalysisRequestDto,
    @Query('stream') stream: string,
    @Res() res: Response,
  ) {
    const { error, contractSource, errorCode } = dto;

    if (stream === 'true') {
      // Streaming mode — bypass TransformInterceptor via @Res()
      this.logger.debug('Starting streaming error analysis');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');

      try {
        for await (const chunk of this.analysisService.analyzeErrorStream(
          error,
          contractSource,
          errorCode,
        )) {
          res.write(chunk);
        }
        res.end();
      } catch (err) {
        this.logger.error(
          `Streaming analysis error: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: 'Streaming analysis failed',
          });
        } else {
          res.end();
        }
      }
    } else {
      // Normal mode — return JSON (wrapped by TransformInterceptor via res.json)
      this.logger.debug('Starting non-streaming error analysis');
      try {
        const result = await this.analysisService.analyzeError(
          error,
          contractSource,
          errorCode,
        );
        // Use res.json to send response since we declared @Res()
        res.json({
          success: true,
          data: result,
        });
      } catch (err) {
        this.logger.error(
          `Analysis error: ${err instanceof Error ? err.message : String(err)}`,
        );
        res.status(500).json({
          success: false,
          error: 'Analysis failed',
        });
      }
    }
  }
}
