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
  });
});
