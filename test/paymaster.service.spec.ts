import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymasterService,
  MAX_FREE_DEPLOYMENTS,
} from '../src/paymaster/paymaster.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PaymasterService', () => {
  let service: PaymasterService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'monad.rpcUrl') return 'https://testnet-rpc.monad.xyz';
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymasterService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PaymasterService>(PaymasterService);
    prismaService = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('getDeployStatus', () => {
    it('should return correct remaining count when user has 1 deploy', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deployCount: 1,
      });

      const result = await service.getDeployStatus('user-1');

      expect(result).toEqual({
        used: 1,
        max: 3,
        remaining: 2,
        canUseRelay: true,
      });
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('should return remaining=0 and canUseRelay=false when at max deploys', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-2',
        deployCount: 3,
      });

      const result = await service.getDeployStatus('user-2');

      expect(result).toEqual({
        used: 3,
        max: 3,
        remaining: 0,
        canUseRelay: false,
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getDeployStatus('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('canUseRelay', () => {
    it('should return true when deployCount < 3', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deployCount: 2,
      });

      const result = await service.canUseRelay('user-1');
      expect(result).toBe(true);
    });

    it('should return false when deployCount >= 3', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        deployCount: 3,
      });

      const result = await service.canUseRelay('user-1');
      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.canUseRelay('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('incrementDeployCount', () => {
    it('should call Prisma update with increment and return new count', async () => {
      mockPrismaService.user.update.mockResolvedValue({
        id: 'user-1',
        deployCount: 2,
      });

      const result = await service.incrementDeployCount('user-1');

      expect(result).toBe(2);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { deployCount: { increment: 1 } },
      });
    });
  });

  describe('broadcastSignedTransaction', () => {
    it('should throw BadRequestException on broadcast failure', async () => {
      // broadcastTransaction will fail because we're not connecting to a real provider
      // The JsonRpcProvider constructor won't throw, but broadcastTransaction will
      await expect(
        service.broadcastSignedTransaction('0xinvalid'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('constants', () => {
    it('should have MAX_FREE_DEPLOYMENTS set to 3', () => {
      expect(MAX_FREE_DEPLOYMENTS).toBe(3);
    });
  });
});
