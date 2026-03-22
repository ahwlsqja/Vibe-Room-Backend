import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { CompileService } from './compile.service';
import { DeployService } from './deploy.service';

@Module({
  controllers: [ContractsController],
  providers: [CompileService, DeployService],
  exports: [CompileService],
})
export class ContractsModule {}
