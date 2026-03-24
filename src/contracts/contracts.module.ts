import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { CompileService } from './compile.service';
import { DeployService } from './deploy.service';
import { VerifyService } from './verify.service';
import { PaymasterModule } from '../paymaster/paymaster.module';

@Module({
  imports: [PaymasterModule],
  controllers: [ContractsController],
  providers: [CompileService, DeployService, VerifyService],
  exports: [CompileService],
})
export class ContractsModule {}
