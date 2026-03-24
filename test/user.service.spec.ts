import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from '../src/user/user.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('UserService', () => {
  let service: UserService;
  let prisma: PrismaService;

  const mockDeployments = [
    {
      id: 'dep-1',
      contractName: 'Counter',
      contractSource: 'pragma solidity ^0.8.0; contract Counter {}',
      address: '0x1234',
      txHash: '0xabc',
      status: 'deployed',
      createdAt: new Date('2025-01-01'),
    },
    {
      id: 'dep-2',
      contractName: 'Token',
      contractSource: 'pragma solidity ^0.8.0; contract Token {}',
      address: null,
      txHash: null,
      status: 'failed',
      createdAt: new Date('2025-01-02'),
    },
  ];

  const mockPrismaService = {
    deployment: {
      findMany: jest.fn().mockResolvedValue(mockDeployments),
      count: jest.fn().mockResolvedValue(5),
    },
    vibeScore: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _avg: { score: 72.5 } }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
    // Re-set default mocks after clearAllMocks
    mockPrismaService.deployment.findMany.mockResolvedValue(mockDeployments);
    mockPrismaService.deployment.count.mockResolvedValue(5);
    mockPrismaService.vibeScore.aggregate.mockResolvedValue({
      _avg: { score: 72.5 },
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDeployments', () => {
    it('should return paginated deployments with correct structure', async () => {
      const result = await service.getDeployments('user-123', 1, 20);

      expect(result).toEqual({
        deployments: mockDeployments,
        total: 5,
        page: 1,
        limit: 20,
      });
    });

    it('should calculate correct skip for page 1', async () => {
      await service.getDeployments('user-123', 1, 20);

      expect(mockPrismaService.deployment.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
        select: {
          id: true,
          contractName: true,
          contractSource: true,
          address: true,
          txHash: true,
          status: true,
          createdAt: true,
        },
      });
    });

    it('should calculate correct skip for page 3 with limit 10', async () => {
      await service.getDeployments('user-123', 3, 10);

      expect(mockPrismaService.deployment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });

    it('should count deployments for the same userId', async () => {
      await service.getDeployments('user-abc', 1, 20);

      expect(mockPrismaService.deployment.count).toHaveBeenCalledWith({
        where: { userId: 'user-abc' },
      });
    });

    it('should return empty array when user has no deployments', async () => {
      mockPrismaService.deployment.findMany.mockResolvedValue([]);
      mockPrismaService.deployment.count.mockResolvedValue(0);

      const result = await service.getDeployments('no-deploy-user', 1, 20);

      expect(result).toEqual({
        deployments: [],
        total: 0,
        page: 1,
        limit: 20,
      });
    });
  });

  describe('getStats', () => {
    it('should return aggregated statistics', async () => {
      // First count call → total, second count call → successful
      mockPrismaService.deployment.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7);

      const result = await service.getStats('user-123');

      expect(result).toEqual({
        totalDeployments: 10,
        successfulDeployments: 7,
        averageVibeScore: 72.5,
      });
    });

    it('should query total deployments without status filter', async () => {
      mockPrismaService.deployment.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3);

      await service.getStats('user-123');

      expect(mockPrismaService.deployment.count).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('should query successful deployments with status=deployed', async () => {
      mockPrismaService.deployment.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3);

      await service.getStats('user-123');

      expect(mockPrismaService.deployment.count).toHaveBeenCalledWith({
        where: { userId: 'user-123', status: 'deployed' },
      });
    });

    it('should query vibe score aggregate for the user', async () => {
      mockPrismaService.deployment.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3);

      await service.getStats('user-123');

      expect(mockPrismaService.vibeScore.aggregate).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        _avg: { score: true },
      });
    });

    it('should return null averageVibeScore when no scores exist', async () => {
      mockPrismaService.deployment.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      mockPrismaService.vibeScore.aggregate.mockResolvedValue({
        _avg: { score: null },
      });

      const result = await service.getStats('new-user');

      expect(result).toEqual({
        totalDeployments: 2,
        successfulDeployments: 1,
        averageVibeScore: null,
      });
    });

    it('should return zero stats for user with no history', async () => {
      mockPrismaService.deployment.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockPrismaService.vibeScore.aggregate.mockResolvedValue({
        _avg: { score: null },
      });

      const result = await service.getStats('empty-user');

      expect(result).toEqual({
        totalDeployments: 0,
        successfulDeployments: 0,
        averageVibeScore: null,
      });
    });
  });
});
