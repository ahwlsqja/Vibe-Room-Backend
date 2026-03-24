import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CompileService } from '../src/contracts/compile.service';

// solc compilation is CPU-intensive
jest.setTimeout(30_000);

describe('CompileService', () => {
  let service: CompileService;

  const contractsDir = path.resolve(__dirname, '..', 'contracts');

  const readContract = (relativePath: string): string =>
    fs.readFileSync(path.join(contractsDir, relativePath), 'utf-8');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompileService],
    }).compile();

    service = module.get<CompileService>(CompileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('compile FixedContract.sol', () => {
    it('should return non-empty ABI array and hex bytecode', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      expect(result.abi).toBeInstanceOf(Array);
      expect(result.abi.length).toBeGreaterThan(0);
      expect(result.bytecode).toMatch(/^0x[0-9a-fA-F]+$/);
    });

    it('should extract contractName as "FixedContract"', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      expect(result.contractName).toBe('FixedContract');
    });
  });

  describe('compile invalid source', () => {
    it('should throw BadRequestException for syntax errors', () => {
      const invalidSource = 'this is not valid solidity code at all;';

      expect(() => service.compile(invalidSource)).toThrow(
        BadRequestException,
      );
    });

    it('should include error details in the exception', () => {
      const invalidSource =
        'pragma solidity ^0.8.24; contract Broken { function f() { unknown_type x; } }';

      try {
        service.compile(invalidSource);
        fail('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toHaveProperty('errors');
      }
    });
  });

  describe('compile PectraTest.sol (TSTORE/TLOAD)', () => {
    it('should succeed with cancun EVM version', () => {
      const source = readContract('test/PectraTest.sol');
      const result = service.compile(source);

      expect(result.contractName).toBe('PectraTest');
      expect(result.abi).toBeInstanceOf(Array);
      expect(result.bytecode).toMatch(/^0x[0-9a-fA-F]+$/);
    });
  });

  describe('compile test contracts', () => {
    it('should compile FailingContract.sol successfully', () => {
      const source = readContract('test/FailingContract.sol');
      const result = service.compile(source);

      expect(result.contractName).toBe('FailingContract');
      expect(result.abi).toBeInstanceOf(Array);
      expect(result.bytecode).toMatch(/^0x[0-9a-fA-F]+$/);
    });

    it('should compile ParallelConflict.sol successfully', () => {
      const source = readContract('test/ParallelConflict.sol');
      const result = service.compile(source);

      expect(result.contractName).toBe('ParallelConflict');
      expect(result.abi).toBeInstanceOf(Array);
      expect(result.bytecode).toMatch(/^0x[0-9a-fA-F]+$/);
    });

    it('should include storageLayout with counter variable for ParallelConflict.sol', () => {
      const source = readContract('test/ParallelConflict.sol');
      const result = service.compile(source);

      expect(result.storageLayout).toBeDefined();
      expect(result.storageLayout!.storage).toBeInstanceOf(Array);
      expect(result.storageLayout!.storage.length).toBeGreaterThan(0);

      const counterEntry = result.storageLayout!.storage.find(
        (entry) => entry.label === 'counter',
      );
      expect(counterEntry).toBeDefined();
      expect(counterEntry!.slot).toBe('0');
      expect(counterEntry!.offset).toBe(0);

      // types map should be populated
      expect(result.storageLayout!.types).toBeDefined();
      expect(Object.keys(result.storageLayout!.types).length).toBeGreaterThan(0);
    });

    it('should include storageLayout for FixedContract.sol', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      expect(result.storageLayout).toBeDefined();
      expect(result.storageLayout!.storage).toBeInstanceOf(Array);
    });
  });

  describe('gasOptimizationHints', () => {
    it('should include gasOptimizationHints in compile result', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      expect(result.gasOptimizationHints).toBeDefined();
      expect(result.gasOptimizationHints).toBeInstanceOf(Array);
      expect(result.gasOptimizationHints!.length).toBeGreaterThan(0);
    });

    it('should include optimizer hint (optimizer not enabled)', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      const optimizerHint = result.gasOptimizationHints!.find((h) =>
        h.includes('optimizer'),
      );
      expect(optimizerHint).toBeDefined();
      expect(optimizerHint).toContain('Enable Solidity optimizer');
    });

    it('should include via_ir hint', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      const viaIrHint = result.gasOptimizationHints!.find((h) =>
        h.includes('via_ir'),
      );
      expect(viaIrHint).toBeDefined();
      expect(viaIrHint).toContain('Yul IR pipeline');
    });

    it('should include positive cancun EVM hint', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      const cancunHint = result.gasOptimizationHints!.find((h) =>
        h.includes('cancun'),
      );
      expect(cancunHint).toBeDefined();
      expect(cancunHint).toContain('TSTORE/TLOAD');
    });

    it('should include runs tuning hint', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      const runsHint = result.gasOptimizationHints!.find((h) =>
        h.includes('Tune optimizer'),
      );
      expect(runsHint).toBeDefined();
      expect(runsHint).toContain('lower values (200)');
    });

    it('should return exactly 4 hints for default settings (small contract)', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      // Default settings: no optimizer, no via_ir, cancun EVM, runs tuning = 4 hints
      // Bytecode should be well under 24KB, so no size warning
      expect(result.gasOptimizationHints!.length).toBe(4);
    });

    it('should NOT include bytecode size warning for small contracts', () => {
      const source = readContract('FixedContract.sol');
      const result = service.compile(source);

      const sizeHint = result.gasOptimizationHints!.find((h) =>
        h.includes('24KB'),
      );
      expect(sizeHint).toBeUndefined();
    });
  });
});
