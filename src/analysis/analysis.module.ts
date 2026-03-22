import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { OptimizerService } from './optimizer.service';
import { AnalysisService } from './analysis.service';
import { AnalysisController } from './analysis.controller';

@Module({
  controllers: [AnalysisController],
  providers: [GeminiService, OptimizerService, AnalysisService],
  exports: [GeminiService, OptimizerService, AnalysisService],
})
export class AnalysisModule {}
