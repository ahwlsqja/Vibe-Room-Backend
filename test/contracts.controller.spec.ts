import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContractsController } from '../src/contracts/contracts.controller';
import { CompileService } from '../src/contracts/compile.service';
import { DeployService } from '../src/contracts/deploy.service';
import { VerifyService } from '../src/contracts/verify.service';
import { PrismaService } from '../src/prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

describe('ContractsController', () => {
  let controller: ContractsController;
  let compileService: CompileService;
  let deployService: DeployService;
  let verifyService: VerifyService;

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

  const mockVerifyResult = {
    verificationId: 'uuid-123',
    status: 'pending' as const,
  };

  const mockVerifyStatusResult = {
    verificationId: 'uuid-123',
    status: 'verified' as const,
    match: 'exact_match' as const,
    explorerUrl: 'https://testnet.monadexplorer.com/address/0x1234567890abcdef1234567890abcdef12345678',
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
        {
          provide: VerifyService,
          useValue: {
            submitVerification: jest.fn().mockResolvedValue(mockVerifyResult),
            getVerificationStatus: jest.fn().mockResolvedValue(mockVerifyStatusResult),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            publishedContract: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    controller = module.get<ContractsController>(ContractsController);
    compileService = module.get<CompileService>(CompileService);
    deployService = module.get<DeployService>(DeployService);
    verifyService = module.get<VerifyService>(VerifyService);
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

  // --- GET /templates ---

  describe('getTemplates', () => {
    it('should return an object with templates array', () => {
      const result = controller.getTemplates();

      expect(result).toHaveProperty('templates');
      expect(Array.isArray(result.templates)).toBe(true);
    });

    it('should return at least 3 template entries', () => {
      const result = controller.getTemplates();

      expect(result.templates.length).toBeGreaterThanOrEqual(3);
    });

    it('each template should have required fields', () => {
      const result = controller.getTemplates();

      for (const template of result.templates) {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('category');
        expect(template).toHaveProperty('tags');
        expect(template).toHaveProperty('difficulty');
        expect(template).toHaveProperty('fileName');
        expect(typeof template.id).toBe('string');
        expect(typeof template.name).toBe('string');
        expect(typeof template.category).toBe('string');
        expect(typeof template.fileName).toBe('string');
        expect(Array.isArray(template.tags)).toBe(true);
      }
    });

    it('should include the monad-erc20 seed template', () => {
      const result = controller.getTemplates();
      const erc20 = result.templates.find(
        (t: { id: string }) => t.id === 'monad-erc20',
      );

      expect(erc20).toBeDefined();
      expect(erc20.name).toBe('Monad ERC20 Token');
      expect(erc20.category).toBe('DeFi');
    });
  });

  // --- GET /source — template resolution ---

  describe('getSource — template resolution', () => {
    it('should resolve monad-erc20 template from manifest', () => {
      const result = controller.getSource('monad-erc20');

      expect(result.contractType).toBe('monad-erc20');
      expect(result.source).toContain('pragma solidity');
      expect(result.source).toContain('MonadERC20');
    });

    it('should resolve simple-amm template from manifest', () => {
      const result = controller.getSource('simple-amm');

      expect(result.contractType).toBe('simple-amm');
      expect(result.source).toContain('pragma solidity');
      expect(result.source).toContain('SimpleAMM');
    });

    it('should resolve parallel-safe-vault template from manifest', () => {
      const result = controller.getSource('parallel-safe-vault');

      expect(result.contractType).toBe('parallel-safe-vault');
      expect(result.source).toContain('pragma solidity');
      expect(result.source).toContain('ParallelSafeVault');
    });

    it('should still throw for truly invalid type', () => {
      expect(() => controller.getSource('nonexistent-template')).toThrow(
        BadRequestException,
      );
      expect(() => controller.getSource('nonexistent-template')).toThrow(
        'Invalid contract type',
      );
    });
  });

  // --- GET /source — backward compat ---

  describe('getSource — backward compat', () => {
    it('should still return FixedContract (regression check)', () => {
      const result = controller.getSource('FixedContract');

      expect(result.contractType).toBe('FixedContract');
      expect(result.source).toContain('pragma solidity');
      expect(result.source).toContain('FixedContract');
    });

    it('should still return FailingContract (regression check)', () => {
      const result = controller.getSource('FailingContract');

      expect(result.contractType).toBe('FailingContract');
      expect(result.source).toContain('pragma solidity');
    });

    it('should still return ParallelConflict (regression check)', () => {
      const result = controller.getSource('ParallelConflict');

      expect(result.contractType).toBe('ParallelConflict');
      expect(result.source).toContain('pragma solidity');
    });

    it('should still return PectraTest (regression check)', () => {
      const result = controller.getSource('PectraTest');

      expect(result.contractType).toBe('PectraTest');
      expect(result.source).toContain('pragma solidity');
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
      const req = { user: { id: 'user-123' } };

      const result = await controller.deploy(dto, req);

      expect(deployService.deploy).toHaveBeenCalledWith(dto.source, 'user-123');
      expect(result).toEqual(mockDeployResult);
    });

    it('should propagate errors from DeployService', async () => {
      jest
        .spyOn(deployService, 'deploy')
        .mockRejectedValue(new Error('Deploy failed'));

      await expect(
        controller.deploy({ source: 'some source' }, { user: null }),
      ).rejects.toThrow('Deploy failed');
    });

    it('should pass undefined userId when no user on request', async () => {
      const dto = { source: 'pragma solidity ^0.8.20; contract Foo {}' };
      const req = { user: null };

      await controller.deploy(dto, req);

      expect(deployService.deploy).toHaveBeenCalledWith(dto.source, undefined);
    });
  });

  // --- POST /verify ---

  describe('verify', () => {
    it('should call verifyService.submitVerification and return result', async () => {
      const dto = {
        source: 'pragma solidity ^0.8.20; contract Foo {}',
        contractName: 'Foo',
        address: '0x1234567890abcdef1234567890abcdef12345678',
        txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      };

      const result = await controller.verify(dto);

      expect(verifyService.submitVerification).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockVerifyResult);
      expect(result.verificationId).toBe('uuid-123');
      expect(result.status).toBe('pending');
    });

    it('should propagate BadGatewayException from VerifyService', async () => {
      const { BadGatewayException } = require('@nestjs/common');
      jest
        .spyOn(verifyService, 'submitVerification')
        .mockRejectedValue(new BadGatewayException('Sourcify API unreachable'));

      const dto = {
        source: 'pragma solidity ^0.8.20; contract Foo {}',
        contractName: 'Foo',
        address: '0x1234567890abcdef1234567890abcdef12345678',
        txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      };

      await expect(controller.verify(dto)).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  // --- GET /verify/status/:jobId ---

  describe('getVerifyStatus', () => {
    it('should call verifyService.getVerificationStatus and return result', async () => {
      const result = await controller.getVerifyStatus('uuid-123');

      expect(verifyService.getVerificationStatus).toHaveBeenCalledWith('uuid-123');
      expect(result).toEqual(mockVerifyStatusResult);
      expect(result.status).toBe('verified');
      expect(result.explorerUrl).toContain('monadexplorer.com');
    });

    it('should propagate errors from VerifyService', async () => {
      const { BadGatewayException } = require('@nestjs/common');
      jest
        .spyOn(verifyService, 'getVerificationStatus')
        .mockRejectedValue(new BadGatewayException('Sourcify API unreachable'));

      await expect(
        controller.getVerifyStatus('uuid-error'),
      ).rejects.toThrow(BadGatewayException);
    });
  });
});
