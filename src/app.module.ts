import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { ContractsModule } from './contracts/contracts.module';
import { AuthModule } from './auth/auth.module';
import { AnalysisModule } from './analysis/analysis.module';
import { PaymasterModule } from './paymaster/paymaster.module';
import { EngineModule } from './engine/engine.module';
import { VibeScoreModule } from './vibe-score/vibe-score.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PrismaModule,
    HealthModule,
    ContractsModule,
    AuthModule,
    AnalysisModule,
    PaymasterModule,
    EngineModule,
    VibeScoreModule,
    UserModule,
  ],
})
export class AppModule {}
