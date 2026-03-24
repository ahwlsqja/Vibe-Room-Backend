import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContractsController } from '../src/contracts/contracts.controller';
import { CompileService } from '../src/contracts/compile.service';
import { DeployService } from '../src/contracts/deploy.service';
import { VerifyService } from '../src/contracts/verify.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Publish & Community Endpoints', () => {
  let controller: ContractsController;
  let prismaService: PrismaService;

  const mockPublishedContract = {
    id: 'pub-123',
    userId: 'user-1',
    source: 'pragma solidity ^0.8.20; contract MyToken {}',
    name: 'MyToken',
    description: 'A simple ERC20 token',
    category: 'DeFi',
    vibeScore: 85,
    publishedAt: new Date('2026-03-20T10:00:00Z'),
    updatedAt: new Date('2026-03-20T10:00:00Z'),
  };

  const mockCommunityContracts = [
    {
      ...mockPublishedContract,
      user: { username: 'alice' },
    },
    {
      id: 'pub-456',
      userId: 'user-2',
      source: 'pragma solidity ^0.8.20; contract NFTMarket {}',
      name: 'NFTMarket',
      description: 'A marketplace for NFTs',
      category: 'NFT',
      vibeScore: 72,
      publishedAt: new Date('2026-03-19T10:00:00Z'),
      updatedAt: new Date('2026-03-19T10:00:00Z'),
      user: { username: 'bob' },
    },
  ];

  const mockPrismaService = {
    publishedContract: {
      create: jest.fn().mockResolvedValue(mockPublishedContract),
      findMany: jest.fn().mockResolvedValue(mockCommunityContracts),
      count: jest.fn().mockResolvedValue(2),
    },
  };

  beforeEach(async () => {
    // Reset mocks for each test
    mockPrismaService.publishedContract.create.mockResolvedValue(mockPublishedContract);
    mockPrismaService.publishedContract.findMany.mockResolvedValue(mockCommunityContracts);
    mockPrismaService.publishedContract.count.mockResolvedValue(2);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        {
          provide: CompileService,
          useValue: { compile: jest.fn() },
        },
        {
          provide: DeployService,
          useValue: { deploy: jest.fn() },
        },
        {
          provide: VerifyService,
          useValue: {
            submitVerification: jest.fn(),
            getVerificationStatus: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    controller = module.get<ContractsController>(ContractsController);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  // --- POST /api/contracts/publish ---

  describe('POST /api/contracts/publish', () => {
    it('should publish a contract and return id, name, publishedAt', async () => {
      const dto = {
        source: 'pragma solidity ^0.8.20; contract MyToken {}',
        name: 'MyToken',
        description: 'A simple ERC20 token',
        category: 'DeFi',
      };
      const req = { user: { id: 'user-1' } };

      const result = await controller.publish(dto, req);

      
      expect(result.id).toBe('pub-123');
      expect(result.name).toBe('MyToken');
      expect(result.publishedAt).toBe('2026-03-20T10:00:00.000Z');
      expect(mockPrismaService.publishedContract.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          source: dto.source,
          name: dto.name,
          description: dto.description,
          category: 'DeFi',
        },
      });
    });

    it('should default category to Utility when not provided', async () => {
      const dto = {
        source: 'pragma solidity ^0.8.20; contract Util {}',
        name: 'Util',
        description: 'A utility contract',
      };
      const req = { user: { id: 'user-1' } };

      await controller.publish(dto as any, req);

      expect(mockPrismaService.publishedContract.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: 'Utility',
        }),
      });
    });

    it('should propagate database errors from Prisma', async () => {
      mockPrismaService.publishedContract.create.mockRejectedValue(
        new Error('Unique constraint violation'),
      );

      const dto = {
        source: 'pragma solidity ^0.8.20; contract Dup {}',
        name: 'Dup',
        description: 'Duplicate test',
      };
      const req = { user: { id: 'user-1' } };

      await expect(controller.publish(dto as any, req)).rejects.toThrow(
        'Unique constraint violation',
      );
    });

    it('should use the authenticated user ID from request', async () => {
      const dto = {
        source: 'pragma solidity ^0.8.20; contract X {}',
        name: 'X',
        description: 'Test',
        category: 'NFT',
      };
      const req = { user: { id: 'user-42' } };

      await controller.publish(dto, req);

      expect(mockPrismaService.publishedContract.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-42' }),
      });
    });
  });

  // --- Publish validation (DTO level) ---

  describe('Publish DTO validation', () => {
    it('should reject missing name via class-validator', async () => {
      // Import and test class-validator directly
      const { validate } = require('class-validator');
      const { plainToInstance } = require('class-transformer');
      const { PublishRequestDto } = require('../src/contracts/dto/publish-request.dto');

      const dto = plainToInstance(PublishRequestDto, {
        source: 'pragma solidity ^0.8.20;',
        description: 'Some description',
        // name is missing
      });

      const errors = await validate(dto);
      const nameErrors = errors.filter((e: any) => e.property === 'name');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject source exceeding 50000 characters', async () => {
      const { validate } = require('class-validator');
      const { plainToInstance } = require('class-transformer');
      const { PublishRequestDto } = require('../src/contracts/dto/publish-request.dto');

      const dto = plainToInstance(PublishRequestDto, {
        source: 'x'.repeat(50001),
        name: 'TooLong',
        description: 'Test',
      });

      const errors = await validate(dto);
      const sourceErrors = errors.filter((e: any) => e.property === 'source');
      expect(sourceErrors.length).toBeGreaterThan(0);
    });

    it('should reject invalid category value', async () => {
      const { validate } = require('class-validator');
      const { plainToInstance } = require('class-transformer');
      const { PublishRequestDto } = require('../src/contracts/dto/publish-request.dto');

      const dto = plainToInstance(PublishRequestDto, {
        source: 'pragma solidity ^0.8.20;',
        name: 'Test',
        description: 'Test desc',
        category: 'InvalidCategory',
      });

      const errors = await validate(dto);
      const catErrors = errors.filter((e: any) => e.property === 'category');
      expect(catErrors.length).toBeGreaterThan(0);
    });

    it('should accept valid category values', async () => {
      const { validate } = require('class-validator');
      const { plainToInstance } = require('class-transformer');
      const { PublishRequestDto } = require('../src/contracts/dto/publish-request.dto');

      for (const category of ['DeFi', 'NFT', 'Utility', 'Monad-Optimized']) {
        const dto = plainToInstance(PublishRequestDto, {
          source: 'pragma solidity ^0.8.20;',
          name: 'Test',
          description: 'Test desc',
          category,
        });

        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      }
    });
  });

  // --- Publish auth guard presence ---

  describe('Publish auth requirement', () => {
    it('should have JwtAuthGuard on publish method', () => {
      const guards = Reflect.getMetadata('__guards__', controller.publish);
      expect(guards).toBeDefined();
      expect(guards.length).toBeGreaterThan(0);

      // Verify the guard is JwtAuthGuard (not OptionalJwtAuthGuard)
      const { JwtAuthGuard } = require('../src/auth/jwt-auth.guard');
      const hasJwtGuard = guards.some(
        (guard: any) => guard === JwtAuthGuard || guard.name === 'JwtAuthGuard',
      );
      expect(hasJwtGuard).toBe(true);
    });
  });

  // --- GET /api/contracts/community ---

  describe('GET /api/contracts/community', () => {
    it('should return paginated results with author username', async () => {
      const result = await controller.getCommunity('1', '20');

      
      expect(result.contracts).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);

      // Check author field is mapped from user.username
      expect(result.contracts[0].author).toBe('alice');
      expect(result.contracts[1].author).toBe('bob');

      // Check no nested user object
      expect((result.contracts[0] as any).user).toBeUndefined();
    });

    it('should pass category filter to Prisma query', async () => {
      await controller.getCommunity('1', '20', 'DeFi');

      expect(mockPrismaService.publishedContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { category: 'DeFi' },
        }),
      );
      expect(mockPrismaService.publishedContract.count).toHaveBeenCalledWith({
        where: { category: 'DeFi' },
      });
    });

    it('should not filter by category when not provided', async () => {
      await controller.getCommunity('1', '20');

      expect(mockPrismaService.publishedContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('should return empty list when no community contracts exist', async () => {
      mockPrismaService.publishedContract.findMany.mockResolvedValue([]);
      mockPrismaService.publishedContract.count.mockResolvedValue(0);

      const result = await controller.getCommunity('1', '20');

      
      expect(result.contracts).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should calculate correct skip/take for pagination', async () => {
      await controller.getCommunity('3', '10');

      expect(mockPrismaService.publishedContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });

    it('should default to page 1 and limit 20 when not provided', async () => {
      await controller.getCommunity();

      expect(mockPrismaService.publishedContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should clamp limit to max 100', async () => {
      await controller.getCommunity('1', '500');

      expect(mockPrismaService.publishedContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });

    it('should order by publishedAt descending', async () => {
      await controller.getCommunity('1', '20');

      expect(mockPrismaService.publishedContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { publishedAt: 'desc' },
        }),
      );
    });

    it('should include user username in Prisma query', async () => {
      await controller.getCommunity('1', '20');

      expect(mockPrismaService.publishedContract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { user: { select: { username: true } } },
        }),
      );
    });

    it('should serialize publishedAt as ISO string', async () => {
      const result = await controller.getCommunity('1', '20');

      expect(result.contracts[0].publishedAt).toBe('2026-03-20T10:00:00.000Z');
      expect(result.contracts[1].publishedAt).toBe('2026-03-19T10:00:00.000Z');
    });
  });
});
