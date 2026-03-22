import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { EngineModule } from '../engine/engine.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { VibeScoreService } from './vibe-score.service';
import { VibeScoreController } from './vibe-score.controller';

@Module({
  imports: [ContractsModule, EngineModule, AnalysisModule],
  controllers: [VibeScoreController],
  providers: [VibeScoreService],
  exports: [VibeScoreService],
})
export class VibeScoreModule {}
