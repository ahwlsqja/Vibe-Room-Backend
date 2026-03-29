import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawnSync } from 'child_process';
import * as fs from 'fs';

// ── CLI output interfaces (matching C++ monad-vibe-cli JSON output) ──

export interface TxResult {
  success: boolean;
  gas_used: number;
  output: string;
  error: string | null;
  logs_count: number | undefined; // C++ engine may emit null
}

export interface CliStats {
  total_gas: number;
  num_transactions: number;
  num_conflicts: number;
  num_re_executions: number;
  per_tx_exec_time_us?: number[]; // C++ engine per-tx execution timing
}

export interface CliOutput {
  results: TxResult[];
  incarnations: number[];
  stats: CliStats;
  conflict_details: ConflictDetails; // C++ engine always emits this field
}

// ── S01 conflict_details schema — matches Rust CLI output exactly ──

export interface LocationInfo {
  location_type: string; // "Storage", "Balance", "Nonce", "CodeHash"
  address: string; // lowercase hex with 0x prefix
  slot?: string; // hex with 0x prefix, only for Storage type
}

export interface ConflictPair {
  location: LocationInfo;
  tx_a: number;
  tx_b: number;
  conflict_type: string; // "write-write" | "read-write"
}

export interface TxAccessSummary {
  tx_index: number;
  reads: LocationInfo[];
  writes: LocationInfo[];
  incarnation_count?: number; // C++ engine per-tx incarnation count
  exec_time_us?: number; // C++ engine per-tx execution time in microseconds
}

export interface ConflictDetails {
  per_tx: TxAccessSummary[];
  conflicts: ConflictPair[];
}

/**
 * EngineService — subprocess bridge to the monad-vibe-cli C++ binary.
 *
 * Spawns the CLI binary with JSON piped to stdin and parses JSON from stdout.
 * Returns null on any failure (missing binary, timeout, parse error) so
 * callers can gracefully fall back to heuristic scoring.
 *
 * Observability:
 * - Logs CLI spawn/completion/timeout/error with duration
 * - Logs CLI stderr content on failure
 */
@Injectable()
export class EngineService {
  private readonly logger = new Logger(EngineService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Execute a block of transactions through the parallel execution engine.
   *
   * @param transactions - Array of transaction objects matching CLI input format
   * @param blockEnv - Block environment (number, coinbase, timestamp, etc.)
   * @returns Parsed CLI output or null if engine is unavailable/fails
   */
  executeBlock(transactions: any[], blockEnv: any): CliOutput | null {
    const binaryPath = this.configService.get<string>('engine.binaryPath');

    if (!binaryPath) {
      this.logger.warn(
        'Engine binary path not configured (ENGINE_BINARY_PATH is empty)',
      );
      return null;
    }

    if (!fs.existsSync(binaryPath)) {
      this.logger.warn(
        `Engine binary not found at path: ${binaryPath}`,
      );
      return null;
    }

    const input = JSON.stringify({ transactions, block_env: blockEnv });
    const startTime = Date.now();

    this.logger.log(
      `Spawning engine CLI: ${binaryPath} (${transactions.length} transactions)`,
    );

    let result;
    try {
      result = spawnSync(binaryPath, [], {
        input,
        encoding: 'utf-8',
        timeout: 30_000,
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Engine CLI spawn failed after ${duration}ms: ${message}`,
      );
      return null;
    }

    const duration = Date.now() - startTime;

    if (result.error) {
      if (result.error.message?.includes('ETIMEDOUT')) {
        this.logger.error(
          `Engine CLI timed out after ${duration}ms`,
        );
      } else {
        this.logger.error(
          `Engine CLI error after ${duration}ms: ${result.error.message}`,
        );
      }
      return null;
    }

    if (result.status !== 0) {
      this.logger.error(
        `Engine CLI exited with code ${result.status} after ${duration}ms. stderr: ${result.stderr || '(empty)'}`,
      );
      return null;
    }

    if (result.stderr) {
      this.logger.warn(`Engine CLI stderr: ${result.stderr}`);
    }

    try {
      const output: CliOutput = JSON.parse(result.stdout);
      this.logger.log(
        `Engine CLI completed in ${duration}ms: ${output.stats.num_transactions} txs, ${output.stats.num_conflicts} conflicts`,
      );
      return output;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to parse engine CLI output after ${duration}ms: ${message}. stdout: ${result.stdout?.substring(0, 200)}`,
      );
      return null;
    }
  }
}
