import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CompileService } from './compile.service';
import { DeployService } from './deploy.service';
import { CompileRequestDto } from './dto/compile-request.dto';
import { DeployRequestDto } from './dto/deploy-request.dto';

const VALID_CONTRACT_TYPES = [
  'FixedContract',
  'FailingContract',
  'ParallelConflict',
  'PectraTest',
] as const;

type ContractType = (typeof VALID_CONTRACT_TYPES)[number];

@Controller('contracts')
export class ContractsController {
  private readonly logger = new Logger(ContractsController.name);

  constructor(
    private readonly compileService: CompileService,
    private readonly deployService: DeployService,
  ) {}

  /**
   * GET /api/contracts/source?type=FixedContract
   *
   * Returns the raw Solidity source for a known contract type.
   * Valid types: FixedContract, FailingContract, ParallelConflict, PectraTest.
   */
  @Get('source')
  getSource(@Query('type') type: string) {
    if (
      !type ||
      !VALID_CONTRACT_TYPES.includes(type as ContractType)
    ) {
      throw new BadRequestException('Invalid contract type');
    }

    const filePath =
      type === 'FixedContract'
        ? path.join(process.cwd(), 'contracts', 'FixedContract.sol')
        : path.join(process.cwd(), 'contracts', 'test', `${type}.sol`);

    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      this.logger.log(`Source retrieved: type=${type}`);
      return { contractType: type, source };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to read contract source: type=${type}, error=${message}`);
      throw new BadRequestException(`Contract source not found: ${type}`);
    }
  }

  /**
   * POST /api/contracts/compile
   *
   * Compiles Solidity source and returns ABI + bytecode.
   */
  @Post('compile')
  compile(@Body() dto: CompileRequestDto) {
    return this.compileService.compile(dto.source);
  }

  /**
   * POST /api/contracts/deploy
   *
   * Compiles and deploys Solidity source to Monad testnet.
   * Returns { contractName, address, txHash, deploymentId }.
   */
  @Post('deploy')
  async deploy(@Body() dto: DeployRequestDto) {
    return this.deployService.deploy(dto.source);
  }
}
