import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from '../src/user/user.controller';
import { UserService } from '../src/user/user.service';

describe('UserController', () => {
  let controller: UserController;
  let userService: UserService;

  const mockDeploymentsResponse = {
    deployments: [
      {
        id: 'dep-1',
        contractName: 'Counter',
        contractSource: 'pragma solidity ^0.8.0; contract Counter {}',
        address: '0x1234567890abcdef',
        txHash: '0xabcdef',
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
    ],
    total: 2,
    page: 1,
    limit: 20,
  };

  const mockStatsResponse = {
    totalDeployments: 5,
    successfulDeployments: 3,
    averageVibeScore: 72.5,
  };

  const mockUserService = {
    getDeployments: jest.fn().mockResolvedValue(mockDeploymentsResponse),
    getStats: jest.fn().mockResolvedValue(mockStatsResponse),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: mockUserService }],
    }).compile();

    controller = module.get<UserController>(UserController);
    userService = module.get<UserService>(UserService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /user/deployments', () => {
    it('should return paginated deployments (interceptor handles envelope)', async () => {
      const req = { user: { id: 'user-123' } };

      const result = await controller.getDeployments(req, 1, 20);

      expect(result).toEqual(mockDeploymentsResponse);
      expect(mockUserService.getDeployments).toHaveBeenCalledWith(
        'user-123',
        1,
        20,
      );
    });

    it('should pass custom page and limit to service', async () => {
      const req = { user: { id: 'user-456' } };

      await controller.getDeployments(req, 3, 10);

      expect(mockUserService.getDeployments).toHaveBeenCalledWith(
        'user-456',
        3,
        10,
      );
    });

    it('should extract userId from req.user.id', async () => {
      const req = { user: { id: 'specific-user-id' } };

      await controller.getDeployments(req, 1, 20);

      expect(mockUserService.getDeployments).toHaveBeenCalledWith(
        'specific-user-id',
        1,
        20,
      );
    });
  });

  describe('GET /user/stats', () => {
    it('should return stats (interceptor handles envelope)', async () => {
      const req = { user: { id: 'user-123' } };

      const result = await controller.getStats(req);

      expect(result).toEqual(mockStatsResponse);
      expect(mockUserService.getStats).toHaveBeenCalledWith('user-123');
    });

    it('should extract userId from req.user.id', async () => {
      const req = { user: { id: 'another-user' } };

      await controller.getStats(req);

      expect(mockUserService.getStats).toHaveBeenCalledWith('another-user');
    });
  });
});
