import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContractsController } from '../src/contracts/contracts.controller';
import { CompileService } from '../src/contracts/compile.service';
import { DeployService } from '../src/contracts/deploy.service';
import * as fs from 'fs';
import * as path from 'path';

describe('ContractsController', () => {
  let controller: ContractsController;
  let compileService: CompileService;
  let deployService: DeployService;

  const mockCompileResult = {
    contractName: 'FixedContract',
    abi: [{ type: 'function', name: 'getValue' }],
    bytecode: '0x6080604052',
  };

  const mockDeployResult = {
    contractName: 'FixedContract',
    address: '0xDeployedAddress123',
    txHash: '0xTxHash456',
    deploymentId: 'deploy-123',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: CompileService,
          useValue: {
            compile: jest.fn().mockReturnValue(mockCompileResult),
          },
        },
        {
          provide: DeployService,
          useValue: {
            deploy: jest.fn().mockResolvedValue(mockDeployResult),
          },
        },
      ],
    }).compile();

    controller = module.get<ContractsController>(ContractsController);
    compileService = module.get<CompileService>(CompileService);
    deployService = module.get<DeployService>(DeployService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // --- GET /source ---

  describe('getSource', () => {
    it('should return source for FixedContract', () => {
      const fixedContractPath = path.join(
        process.cwd(),
        'contracts',
        'FixedContract.sol',
      );
      // Read the actual file from disk (created in T01)
      const expectedSource = fs.readFileSync(fixedContractPath, 'utf-8');

      const result = controller.getSource('FixedContract');

      expect(result.contractType).toBe('FixedContract');
      expect(result.source).toBe(expectedSource);
      expect(result.source).toContain('pragma solidity');
    });

    it('should return source for test contracts (FailingContract)', () => {
      const result = controller.getSource('FailingContract');

      expect(result.contractType).toBe('FailingContract');
      expect(result.source).toContain('pragma solidity');
    });

    it('should return source for ParallelConflict', () => {
      const result = controller.getSource('ParallelConflict');

      expect(result.contractType).toBe('ParallelConflict');
      expect(result.source).toContain('pragma solidity');
    });

    it('should return source for PectraTest', () => {
      const result = controller.getSource('PectraTest');

      expect(result.contractType).toBe('PectraTest');
      expect(result.source).toContain('pragma solidity');
    });

    it('should throw BadRequestException for invalid contract type', () => {
      expect(() => controller.getSource('InvalidType')).toThrow(
        BadRequestException,
      );
      expect(() => controller.getSource('InvalidType')).toThrow(
        'Invalid contract type',
      );
    });

    it('should throw BadRequestException when type is missing/undefined', () => {
      expect(() => controller.getSource(undefined as any)).toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for empty string type', () => {
      expect(() => controller.getSource('')).toThrow(BadRequestException);
    });
  });

  // --- POST /compile ---

  describe('compile', () => {
    it('should call compileService.compile and return result', () => {
      const dto = { source: 'pragma solidity ^0.8.20; contract Foo {}' };

      const result = controller.compile(dto);

      expect(compileService.compile).toHaveBeenCalledWith(dto.source);
      expect(result).toEqual(mockCompileResult);
    });

    it('should propagate BadRequestException from CompileService', () => {
      jest.spyOn(compileService, 'compile').mockImplementation(() => {
        throw new BadRequestException({
          message: 'Compilation failed',
          errors: ['ParserError: Expected ; but got }'],
        });
      });

      expect(() =>
        controller.compile({ source: 'invalid code' }),
      ).toThrow(BadRequestException);
    });
  });

  // --- POST /deploy ---

  describe('deploy', () => {
    it('should call deployService.deploy and return result', async () => {
      const dto = { source: 'pragma solidity ^0.8.20; contract Foo {}' };

      const result = await controller.deploy(dto);

      expect(deployService.deploy).toHaveBeenCalledWith(dto.source);
      expect(result).toEqual(mockDeployResult);
    });

    it('should propagate errors from DeployService', async () => {
      jest
        .spyOn(deployService, 'deploy')
        .mockRejectedValue(new Error('Deploy failed'));

      await expect(
        controller.deploy({ source: 'some source' }),
      ).rejects.toThrow('Deploy failed');
    });
  });
});
