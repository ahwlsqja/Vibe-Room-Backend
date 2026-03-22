import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { PaymasterController } from '../src/paymaster/paymaster.controller';
import { PaymasterService } from '../src/paymaster/paymaster.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('PaymasterController', () => {
  let controller: PaymasterController;
  let paymasterService: PaymasterService;

  const mockPaymasterService = {
    getDeployStatus: jest.fn(),
    canUseRelay: jest.fn(),
    incrementDeployCount: jest.fn(),
    broadcastSignedTransaction: jest.fn(),
  };

  // Mock JwtAuthGuard to always allow and attach mock user
  const mockJwtAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const request = context.switchToHttp().getRequest();
      request.user = { id: 'test-user-id', githubId: '12345', username: 'testuser' };
      return true;
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymasterController],
      providers: [
        { provide: PaymasterService, useValue: mockPaymasterService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    controller = module.get<PaymasterController>(PaymasterController);
    paymasterService = module.get<PaymasterService>(PaymasterService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStatus', () => {
    it('should call service.getDeployStatus with userId from req.user', async () => {
      const mockStatus = {
        used: 1,
        max: 3,
        remaining: 2,
        canUseRelay: true,
      };
      mockPaymasterService.getDeployStatus.mockResolvedValue(mockStatus);

      const req = { user: { id: 'test-user-id' } };
      const result = await controller.getStatus(req);

      expect(result).toEqual(mockStatus);
      expect(mockPaymasterService.getDeployStatus).toHaveBeenCalledWith(
        'test-user-id',
      );
    });
  });

  describe('relaySigned', () => {
    it('should call service.broadcastSignedTransaction with signed tx hex', async () => {
      const mockResult = { txHash: '0xabc123' };
      mockPaymasterService.broadcastSignedTransaction.mockResolvedValue(
        mockResult,
      );

      const req = { user: { id: 'test-user-id' } };
      const dto = { signedTransaction: '0xdeadbeef' };
      const result = await controller.relaySigned(req, dto);

      expect(result).toEqual(mockResult);
      expect(
        mockPaymasterService.broadcastSignedTransaction,
      ).toHaveBeenCalledWith('0xdeadbeef');
    });
  });
});
