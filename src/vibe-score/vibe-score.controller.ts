import { Controller, Post, Body, Logger } from '@nestjs/common';
import { VibeScoreService } from './vibe-score.service';
import { VibeScoreRequestDto } from './dto/vibe-score-request.dto';
import { VibeScoreResultDto } from './dto/vibe-score-result.dto';

/**
 * VibeScoreController — POST /api/vibe-score
 *
 * Accepts Solidity source code and returns a parallel execution
 * efficiency score based on real EVM execution through the Rust engine,
 * or heuristic analysis when the engine is unavailable.
 */
@Controller('vibe-score')
export class VibeScoreController {
  private readonly logger = new Logger(VibeScoreController.name);

  constructor(private readonly vibeScoreService: VibeScoreService) {}

  /**
   * Analyze a Solidity contract for Monad parallel execution efficiency.
   *
   * @param dto - Request containing Solidity source code
   * @returns VibeScoreResultDto with score, conflict data, and suggestions
   */
  @Post()
  async analyzeContract(
    @Body() dto: VibeScoreRequestDto,
  ): Promise<VibeScoreResultDto> {
    this.logger.log(
      `POST /api/vibe-score received (source length: ${dto.source.length} chars)`,
    );
    return this.vibeScoreService.analyzeContract(dto.source);
  }
}
