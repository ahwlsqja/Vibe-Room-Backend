import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as solc from 'solc';
import { CompileResultDto } from './dto/compile-result.dto';

interface SolcError {
  severity: string;
  formattedMessage: string;
  message: string;
}

interface SolcOutput {
  errors?: SolcError[];
  contracts?: Record<string, Record<string, {
    abi: any[];
    evm: { bytecode: { object: string } };
    storageLayout?: { storage: any[]; types: Record<string, any> };
  }>>;
}

@Injectable()
export class CompileService {
  private readonly logger = new Logger(CompileService.name);

  /**
   * Compile Solidity source code using the solc Standard JSON Input/Output API.
   *
   * @param source - Raw Solidity source code
   * @returns CompileResultDto with contractName, ABI, and hex bytecode
   * @throws BadRequestException if compilation produces errors
   */
  compile(source: string): CompileResultDto {
    const input = {
      language: 'Solidity',
      sources: {
        'Contract.sol': { content: source },
      },
      settings: {
        evmVersion: 'cancun',
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode.object', 'storageLayout'],
          },
        },
      },
    };

    let output: SolcOutput;
    try {
      output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`solc compilation crashed: ${message}`);
      throw new BadRequestException(`Compilation failed: ${message}`);
    }

    // Check for severity='error' entries in the output
    const errors = (output.errors ?? []).filter(
      (e) => e.severity === 'error',
    );
    if (errors.length > 0) {
      const messages = errors.map((e) => e.formattedMessage || e.message);
      this.logger.warn(
        `Compilation errors: ${messages.join('; ')}`,
      );
      throw new BadRequestException({
        message: 'Compilation failed',
        errors: messages,
      });
    }

    // Extract the first contract from the output
    const sourceContracts = output.contracts?.['Contract.sol'];
    if (!sourceContracts || Object.keys(sourceContracts).length === 0) {
      this.logger.error('No contracts found in compilation output');
      throw new BadRequestException('No contracts found in compilation output');
    }

    const contractName = Object.keys(sourceContracts)[0];
    const contract = sourceContracts[contractName];
    const abi = contract.abi;
    const rawBytecode = contract.evm.bytecode.object;
    const bytecode = rawBytecode.startsWith('0x')
      ? rawBytecode
      : `0x${rawBytecode}`;

    this.logger.log(
      `Compilation successful: ${contractName} (ABI: ${abi.length} entries, bytecode: ${bytecode.length} chars)`,
    );

    const gasOptimizationHints = this.generateGasHints(
      input.settings,
      bytecode,
    );

    return {
      contractName,
      abi,
      bytecode,
      storageLayout: contract.storageLayout,
      gasOptimizationHints,
    };
  }

  /**
   * Generate advisory gas-optimization hints based on current compile settings
   * and bytecode size. These hints do NOT modify compilation — they are purely
   * informational suggestions for the developer.
   */
  private generateGasHints(
    settings: Record<string, any>,
    bytecodeHex: string,
  ): string[] {
    const hints: string[] = [];

    // 1. Check optimizer
    if (!settings.optimizer?.enabled) {
      hints.push(
        'Enable Solidity optimizer (`optimizer: { enabled: true, runs: 200 }`) to reduce deployed bytecode size and gas costs.',
      );
    }

    // 2. Check via_ir
    if (!settings.viaIR) {
      hints.push(
        'Enable `via_ir: true` for the Yul IR pipeline — generates more efficient bytecode, especially for complex contracts on Monad.',
      );
    }

    // 3. EVM version positive note
    if (settings.evmVersion === 'cancun') {
      hints.push(
        'EVM target is `cancun` — TSTORE/TLOAD transient storage opcodes are available for gas-efficient patterns on Monad.',
      );
    }

    // 4. Optimizer runs tuning (always relevant)
    hints.push(
      'Tune optimizer `runs` parameter: lower values (200) optimize for deployment cost, higher values (10000) optimize for runtime gas of frequently-called functions.',
    );

    // 5. Bytecode size check (24KB = 24576 bytes = 49152 hex chars without 0x prefix)
    const cleanHex = bytecodeHex.startsWith('0x')
      ? bytecodeHex.slice(2)
      : bytecodeHex;
    if (cleanHex.length > 49152) {
      hints.push(
        '⚠️ Bytecode exceeds 24KB Spurious Dragon limit. Enable optimizer or split into smaller contracts.',
      );
    }

    return hints;
  }
}
