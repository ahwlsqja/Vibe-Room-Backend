import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { CompileService } from '../contracts/compile.service';
import { EngineService, CliOutput } from '../engine/engine.service';
import { OptimizerService } from '../analysis/optimizer.service';
import { PrismaService } from '../prisma/prisma.service';
import { VibeScoreResultDto } from './dto/vibe-score-result.dto';

/**
 * 8 sender addresses used for constructing test transaction blocks.
 * These match the pre-funded accounts in the monad-cli Rust binary
 * (0xE1..0xE8 range from the 16-account set 0xE1..0xF0).
 */
const SENDER_ADDRESSES: string[] = Array.from({ length: 8 }, (_, i) =>
  `0x${'0'.repeat(38)}${(0xe1 + i).toString(16)}`,
);

/**
 * VibeScoreService — orchestrator for the compile → block construction →
 * engine → scoring pipeline.
 *
 * Produces real EVM parallel execution-based vibe-scores when the engine
 * binary is available, falling back to heuristic scoring via OptimizerService
 * when it is not.
 *
 * Observability:
 * - Logs each pipeline phase (compile, block construction, engine, scoring)
 *   with timing
 * - Response includes `engineBased: boolean` to distinguish real vs heuristic
 * - DB records persist all scoring fields for inspection
 */
@Injectable()
export class VibeScoreService {
  private readonly logger = new Logger(VibeScoreService.name);

  constructor(
    private readonly compileService: CompileService,
    private readonly engineService: EngineService,
    private readonly optimizerService: OptimizerService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Analyze a Solidity contract for parallel execution efficiency.
   *
   * Pipeline:
   * 1. Compile source → ABI + bytecode
   * 2. Filter ABI for state-changing functions
   * 3. Construct deploy + call transaction block
   * 4. Execute through Rust engine (or fall back to heuristic)
   * 5. Calculate vibe-score from execution results
   * 6. Persist to database
   */
  async analyzeContract(
    source: string,
    userId?: string,
  ): Promise<VibeScoreResultDto> {
    const pipelineStart = Date.now();

    // ── Phase 1: Compile ──
    this.logger.log('Phase 1: Compiling contract source');
    const compileStart = Date.now();
    const compiled = this.compileService.compile(source);
    this.logger.log(
      `Phase 1 complete: ${compiled.contractName} compiled in ${Date.now() - compileStart}ms`,
    );

    // ── Phase 2: ABI analysis ──
    const stateChangingFns = this.getStateChangingFunctions(compiled.abi);
    if (stateChangingFns.length === 0) {
      this.logger.log(
        'No state-changing functions found — falling back to heuristic scoring',
      );
      return this.heuristicFallback(source, userId);
    }

    // ── Phase 3: Block construction ──
    this.logger.log(
      `Phase 3: Constructing transaction block (${stateChangingFns.length} state-changing functions)`,
    );
    const { transactions, blockEnv } = this.constructTransactionBlock(
      compiled.abi,
      compiled.bytecode,
      stateChangingFns,
    );

    // ── Phase 4: Engine execution ──
    this.logger.log(
      `Phase 4: Executing ${transactions.length} transactions through engine`,
    );
    const engineStart = Date.now();
    const engineResult = this.engineService.executeBlock(transactions, blockEnv);
    this.logger.log(
      `Phase 4 complete in ${Date.now() - engineStart}ms: ${engineResult ? 'engine result received' : 'engine unavailable'}`,
    );

    if (!engineResult) {
      this.logger.log(
        'Engine returned null — falling back to heuristic scoring',
      );
      return this.heuristicFallback(source, userId);
    }

    // ── Phase 5: Score calculation ──
    this.logger.log('Phase 5: Calculating vibe-score from engine results');
    const result = this.calculateScore(engineResult);

    // ── Phase 6: Persist to database ──
    await this.persistResult(source, result, userId);

    this.logger.log(
      `Pipeline complete in ${Date.now() - pipelineStart}ms: score=${result.vibeScore}, engineBased=${result.engineBased}`,
    );

    return result;
  }

  /**
   * Filter ABI for non-view, non-pure, non-constructor functions
   * (i.e., state-changing methods that benefit from parallel execution analysis).
   */
  getStateChangingFunctions(abi: any[]): any[] {
    return abi.filter(
      (entry) =>
        entry.type === 'function' &&
        entry.stateMutability !== 'view' &&
        entry.stateMutability !== 'pure',
    );
  }

  /**
   * Generate a default value for a Solidity ABI parameter type.
   */
  private getDefaultArg(type: string, senderAddress: string): any {
    if (type.startsWith('uint') || type.startsWith('int')) return 0;
    if (type === 'address') return senderAddress;
    if (type === 'bool') return false;
    if (type === 'string') return '';
    if (type === 'bytes') return '0x';
    if (type.endsWith('[]')) return [];
    // Fixed-size bytes (bytes1..bytes32)
    if (type.startsWith('bytes')) {
      const size = parseInt(type.slice(5), 10);
      return '0x' + '00'.repeat(size || 1);
    }
    // tuple (struct) — return empty object, ethers will fill defaults
    return 0;
  }

  /**
   * Construct a transaction block: 1 deploy tx + N call txs for state-changing
   * functions from different senders.
   */
  constructTransactionBlock(
    abi: any[],
    bytecode: string,
    stateChangingFns: any[],
  ): { transactions: any[]; blockEnv: any } {
    const deployer = SENDER_ADDRESSES[0];
    const deployAddress = ethers.getCreateAddress({ from: deployer, nonce: 0 });

    // Strip 0x prefix for the Rust engine (it expects raw hex)
    const rawBytecode = bytecode.startsWith('0x')
      ? bytecode.slice(2)
      : bytecode;

    const transactions: any[] = [];

    // tx0: deploy transaction
    transactions.push({
      sender: deployer,
      to: null,
      data: rawBytecode,
      value: '0',
      gas_limit: 2_000_000,
      nonce: 0,
      gas_price: '1000000000',
    });

    // Call txs: one per state-changing function from rotating senders
    const iface = new ethers.Interface(abi);
    for (let i = 0; i < stateChangingFns.length; i++) {
      const fn = stateChangingFns[i];
      const sender = SENDER_ADDRESSES[(i + 1) % SENDER_ADDRESSES.length];

      // Build default arguments for the function
      const args = (fn.inputs || []).map((input: any) =>
        this.getDefaultArg(input.type, sender),
      );

      let callData: string;
      try {
        callData = iface.encodeFunctionData(fn.name, args);
      } catch {
        // Skip functions we can't encode (e.g., complex tuple args)
        this.logger.warn(
          `Skipping function ${fn.name}: failed to encode arguments`,
        );
        continue;
      }

      // Strip 0x prefix for Rust engine
      const rawCallData = callData.startsWith('0x')
        ? callData.slice(2)
        : callData;

      transactions.push({
        sender,
        to: deployAddress,
        data: rawCallData,
        value: '0',
        gas_limit: 2_000_000,
        nonce: 0,
        gas_price: '1000000000',
      });
    }

    const blockEnv = {
      number: 1,
      coinbase: `0x${'0'.repeat(38)}C0`,
      timestamp: Math.floor(Date.now() / 1000),
      gas_limit: 30_000_000,
      base_fee: '0',
      difficulty: '0',
    };

    return { transactions, blockEnv };
  }

  /**
   * Calculate vibe-score from engine execution results.
   *
   * Score formula:
   * - Start at 100
   * - conflictPenalty: min(40, round(conflictRatio * 50))
   * - reExecPenalty: min(30, reExecutionCount * 5)
   * - failurePenalty: min(20, failedTxs * 10)
   * - vibeScore: max(0, min(100, 100 - penalties))
   */
  calculateScore(engineResult: CliOutput): VibeScoreResultDto {
    const { results, stats } = engineResult;
    const totalTxs = results.length;
    const conflictCount = stats.num_conflicts;
    const reExecutionCount = stats.num_re_executions;

    // Exclude deploy tx from conflict ratio calculation
    const conflictRatio = conflictCount / Math.max(totalTxs - 1, 1);
    const conflictPenalty = Math.min(40, Math.round(conflictRatio * 50));
    const reExecPenalty = Math.min(30, reExecutionCount * 5);

    const failedTxs = results.filter((r) => !r.success).length;
    const failurePenalty = Math.min(20, failedTxs * 10);

    const vibeScore = Math.max(
      0,
      Math.min(100, 100 - conflictPenalty - reExecPenalty - failurePenalty),
    );

    const gasEfficiency = Math.round(
      (1 - failedTxs / Math.max(totalTxs, 1)) * 100,
    );

    // Build suggestions based on score components
    const suggestions: string[] = [];
    if (conflictPenalty > 0) {
      suggestions.push(
        `${conflictCount} transaction conflict(s) detected. Consider using per-address storage patterns (mapping) instead of shared global state.`,
      );
    }
    if (reExecPenalty > 0) {
      suggestions.push(
        `${reExecutionCount} re-execution(s) due to state conflicts. Reduce write contention on shared storage slots.`,
      );
    }
    if (failurePenalty > 0) {
      suggestions.push(
        `${failedTxs} transaction(s) failed. Review function logic and access control for parallel execution compatibility.`,
      );
    }
    if (suggestions.length === 0) {
      suggestions.push(
        'Contract is well-suited for Monad parallel execution — no conflicts detected.',
      );
    }

    return {
      vibeScore,
      conflicts: conflictCount,
      reExecutions: reExecutionCount,
      gasEfficiency,
      engineBased: true,
      suggestions,
      traceResults: results,
    };
  }

  /**
   * Fall back to heuristic scoring via OptimizerService when the engine
   * binary is unavailable.
   */
  private async heuristicFallback(
    source: string,
    userId?: string,
  ): Promise<VibeScoreResultDto> {
    this.logger.log('Using heuristic scoring (OptimizerService)');
    const heuristic = this.optimizerService.calculateScore(source);

    const result: VibeScoreResultDto = {
      vibeScore: heuristic.score,
      conflicts: 0,
      reExecutions: 0,
      gasEfficiency: 100,
      engineBased: false,
      suggestions: heuristic.suggestions,
    };

    await this.persistResult(source, result, userId);
    return result;
  }

  /**
   * Persist a vibe-score result to the database.
   */
  private async persistResult(
    source: string,
    result: VibeScoreResultDto,
    userId?: string,
  ): Promise<void> {
    try {
      await this.prismaService.vibeScore.create({
        data: {
          userId: userId ?? null,
          contractSource: source,
          score: result.vibeScore,
          engineBased: result.engineBased,
          conflicts: String(result.conflicts),
          reExecutions: String(result.reExecutions),
          gasEfficiency: String(result.gasEfficiency),
          suggestions: result.suggestions,
        },
      });
      this.logger.log('Vibe-score result persisted to database');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to persist vibe-score: ${message}`);
      // Don't throw — scoring result is still valid even if DB write fails
    }
  }
}
