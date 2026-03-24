import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { DeployService } from '../src/contracts/deploy.service';
import { CompileService } from '../src/contracts/compile.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Mock ethers module before imports resolve
const mockGetAddress = jest.fn();
const mockDeploymentTransaction = jest.fn();
const mockWaitForDeployment = jest.fn();
const mockDeploy = jest.fn();

jest.mock('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
  Wallet: jest.fn().mockImplementation(() => ({})),
  ContractFactory: jest.fn().mockImplementation(() => ({
    deploy: mockDeploy,
  })),
}));

describe('DeployService', () => {
  let service: DeployService;
  let prismaService: PrismaService;
  let configService: ConfigService;
  let compileService: CompileService;

  const mockDeploymentRecord = {
    id: 'deploy-123',
    userId: 'user-1',
    contractName: 'FixedContract',
    contractSource: 'pragma solidity ^0.8.20;',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCompileResult = {
    contractName: 'FixedContract',
    abi: [{ type: 'function', name: 'getValue' }],
    bytecode: '0x6080604052',
  };

  beforeEach(async () => {
    // Reset mocks
    mockGetAddress.mockReset().mockResolvedValue('0xDeployedAddress123');
    mockDeploymentTransaction.mockReset().mockReturnValue({ hash: '0xTxHash456' });
    mockWaitForDeployment.mockReset().mockResolvedValue(undefined);
    mockDeploy.mockReset().mockResolvedValue({
      waitForDeployment: mockWaitForDeployment,
      getAddress: mockGetAddress,
      deploymentTransaction: mockDeploymentTransaction,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeployService,
        {
          provide: PrismaService,
          useValue: {
            deployment: {
              create: jest.fn().mockResolvedValue(mockDeploymentRecord),
              update: jest.fn().mockResolvedValue({ ...mockDeploymentRecord, status: 'deployed' }),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                'monad.privateKey': '0xTestPrivateKey',
                'monad.rpcUrl': 'https://testnet-rpc.monad.xyz',
              };
              return config[key];
            }),
          },
        },
        {
          provide: CompileService,
          useValue: {
            compile: jest.fn().mockReturnValue(mockCompileResult),
          },
        },
      ],
    }).compile();

    service = module.get<DeployService>(DeployService);
    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
    compileService = module.get<CompileService>(CompileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deploy - success path', () => {
    it('should create a pending deployment record before deploying', async () => {
      await service.deploy('pragma solidity ^0.8.20;', 'user-1');

      expect(prismaService.deployment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'pending',
          userId: 'user-1',
          contractName: 'FixedContract',
          contractSource: 'pragma solidity ^0.8.20;',
        }),
      });
    });

    it('should update deployment record to deployed with address and txHash', async () => {
      const result = await service.deploy('pragma solidity ^0.8.20;', 'user-1');

      expect(prismaService.deployment.update).toHaveBeenCalledWith({
        where: { id: 'deploy-123' },
        data: {
          status: 'deployed',
          address: '0xDeployedAddress123',
          txHash: '0xTxHash456',
        },
      });

      expect(result).toEqual({
        contractName: 'FixedContract',
        address: '0xDeployedAddress123',
        txHash: '0xTxHash456',
        deploymentId: 'deploy-123',
      });
    });

    it('should use null userId when not provided', async () => {
      await service.deploy('pragma solidity ^0.8.20;');

      expect(prismaService.deployment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: null,
        }),
      });
    });

    it('should call CompileService.compile with the source', async () => {
      const source = 'pragma solidity ^0.8.20; contract Foo {}';
      await service.deploy(source, 'user-1');

      expect(compileService.compile).toHaveBeenCalledWith(source);
    });
  });

  describe('deploy - failure path', () => {
    it('should update deployment to failed with errorMessage when deploy fails', async () => {
      mockDeploy.mockRejectedValue(new Error('Network error: cannot reach RPC'));

      await expect(
        service.deploy('pragma solidity ^0.8.20;', 'user-1'),
      ).rejects.toThrow('Network error: cannot reach RPC');

      expect(prismaService.deployment.update).toHaveBeenCalledWith({
        where: { id: 'deploy-123' },
        data: {
          status: 'failed',
          errorMessage: 'Network error: cannot reach RPC',
        },
      });
    });

    it('should update deployment to failed when waitForDeployment fails', async () => {
      mockWaitForDeployment.mockRejectedValue(new Error('Transaction reverted'));
      mockDeploy.mockResolvedValue({
        waitForDeployment: mockWaitForDeployment,
        getAddress: mockGetAddress,
        deploymentTransaction: mockDeploymentTransaction,
      });

      await expect(
        service.deploy('pragma solidity ^0.8.20;', 'user-1'),
      ).rejects.toThrow('Transaction reverted');

      expect(prismaService.deployment.update).toHaveBeenCalledWith({
        where: { id: 'deploy-123' },
        data: {
          status: 'failed',
          errorMessage: 'Transaction reverted',
        },
      });
    });
  });

  describe('deploy - missing private key', () => {
    it('should throw ServiceUnavailableException (503) when MONAD_PRIVATE_KEY is missing', async () => {
      // Override configService.get to return undefined for privateKey
      jest.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'monad.privateKey') return undefined;
        return 'https://testnet-rpc.monad.xyz';
      });

      await expect(
        service.deploy('pragma solidity ^0.8.20;', 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);

      await expect(
        service.deploy('pragma solidity ^0.8.20;', 'user-1'),
      ).rejects.toThrow('Server not configured for deployment');

      // Should not attempt to create a deployment record
      expect(prismaService.deployment.create).not.toHaveBeenCalled();
    });
  });

  describe('deploy - compile error propagation', () => {
    it('should propagate BadRequestException from CompileService', async () => {
      jest.spyOn(compileService, 'compile').mockImplementation(() => {
        throw new BadRequestException({
          message: 'Compilation failed',
          errors: ['ParserError: Expected ; but got }'],
        });
      });

      await expect(
        service.deploy('invalid solidity code', 'user-1'),
      ).rejects.toThrow(BadRequestException);

      // Should not create a deployment record if compilation fails
      expect(prismaService.deployment.create).not.toHaveBeenCalled();
    });
  });
});
