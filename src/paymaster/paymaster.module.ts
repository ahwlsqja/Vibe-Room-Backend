import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymasterService } from './paymaster.service';
import { PaymasterController } from './paymaster.controller';

@Module({
  imports: [AuthModule],
  controllers: [PaymasterController],
  providers: [PaymasterService],
  exports: [PaymasterService],
})
export class PaymasterModule {}
