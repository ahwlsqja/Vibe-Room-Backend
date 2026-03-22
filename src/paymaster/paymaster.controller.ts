import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymasterService } from './paymaster.service';
import { RelaySignedDto } from './dto/relay-signed.dto';
import { DeployStatusDto } from './dto/deploy-status.dto';

@Controller('paymaster')
export class PaymasterController {
  private readonly logger = new Logger(PaymasterController.name);

  constructor(private readonly paymasterService: PaymasterService) {}

  /**
   * GET /api/paymaster/status
   * Returns the current deploy count status for the authenticated user.
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Req() req: any): Promise<DeployStatusDto> {
    const userId = req.user.id;
    this.logger.log(`Deploy status requested by user ${userId}`);
    return this.paymasterService.getDeployStatus(userId);
  }

  /**
   * POST /api/paymaster/relay-signed
   * Broadcasts a pre-signed transaction to the Monad testnet.
   * Requires JWT authentication.
   */
  @Post('relay-signed')
  @UseGuards(JwtAuthGuard)
  async relaySigned(
    @Req() req: any,
    @Body() dto: RelaySignedDto,
  ): Promise<{ txHash: string }> {
    const userId = req.user.id;
    this.logger.log(`Relay-signed request from user ${userId}`);
    return this.paymasterService.broadcastSignedTransaction(
      dto.signedTransaction,
    );
  }
}
