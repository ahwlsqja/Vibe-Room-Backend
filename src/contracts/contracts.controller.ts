import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Param,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CompileService } from './compile.service';
import { DeployService } from './deploy.service';
import { VerifyService } from './verify.service';
import { CompileRequestDto } from './dto/compile-request.dto';
import { DeployRequestDto } from './dto/deploy-request.dto';
import { VerifyRequestDto } from './dto/verify-request.dto';

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
    private readonly verifyService: VerifyService,
  ) {}

  /**
   * GET /api/contracts/templates
   *
   * Returns the full list of template metadata from the manifest file.
   * Each entry includes: id, name, description, category, tags, difficulty, fileName, vibeScore.
   */
  @Get('templates')
  getTemplates() {
    const manifestPath = path.join(process.cwd(), 'contracts', 'templates', 'manifest.json');
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);
      this.logger.log(`Templates manifest loaded: ${manifest.templates.length} entries`);
      return { templates: manifest.templates };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to read template manifest: ${message}`);
      throw new BadRequestException('Template manifest not found');
    }
  }

  /**
   * GET /api/contracts/source?type=FixedContract
   *
   * Returns the raw Solidity source for a known contract type.
   * Valid types: FixedContract, FailingContract, ParallelConflict, PectraTest.
   * Also resolves template IDs from the manifest (e.g., type=monad-erc20).
   */
  @Get('source')
  getSource(@Query('type') type: string) {
    if (!type) {
      throw new BadRequestException('Invalid contract type');
    }

    // Fast path: check hardcoded valid types first (backward compat)
    if (VALID_CONTRACT_TYPES.includes(type as ContractType)) {
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

    // Slow path: resolve template ID from manifest
    try {
      const manifestPath = path.join(process.cwd(), 'contracts', 'templates', 'manifest.json');
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);
      const template = manifest.templates.find(
        (t: { id: string }) => t.id === type,
      );

      if (template) {
        const templatePath = path.join(
          process.cwd(),
          'contracts',
          'templates',
          template.fileName,
        );
        const source = fs.readFileSync(templatePath, 'utf-8');
        this.logger.log(`Template source retrieved: id=${type}, file=${template.fileName}`);
        return { contractType: type, source };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to resolve template: type=${type}, error=${message}`);
    }

    throw new BadRequestException('Invalid contract type');
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

  /**
   * POST /api/contracts/verify
   *
   * Submits a contract verification request to Sourcify API v2.
   * Returns { verificationId, status: 'pending' }.
   */
  @Post('verify')
  @HttpCode(HttpStatus.ACCEPTED)
  async verify(@Body() dto: VerifyRequestDto) {
    return this.verifyService.submitVerification(dto);
  }

  /**
   * GET /api/contracts/verify/status/:jobId
   *
   * Polls the verification status for a given job ID.
   * Returns { verificationId, status, match?, explorerUrl?, error? }.
   */
  @Get('verify/status/:jobId')
  async getVerifyStatus(@Param('jobId') jobId: string) {
    return this.verifyService.getVerificationStatus(jobId);
  }
}
