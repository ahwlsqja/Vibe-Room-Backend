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

    return { contractName, abi, bytecode, storageLayout: contract.storageLayout };
  }
}
