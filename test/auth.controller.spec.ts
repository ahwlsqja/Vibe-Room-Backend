import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockUser = {
    id: 'user-123',
    githubId: '12345',
    username: 'testuser',
    email: 'test@example.com',
    avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
    deployCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAuthService = {
    validateOrCreateUser: jest.fn(),
    login: jest.fn().mockResolvedValue({
      accessToken: 'mock-jwt-token',
      user: mockUser,
    }),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('http://localhost:3001'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /auth/github/callback', () => {
    it('should call authService.login and redirect to frontend with token', async () => {
      const req = { user: mockUser };
      const res = { redirect: jest.fn() } as any;

      mockAuthService.login.mockResolvedValue({
        accessToken: 'mock-jwt-token',
        user: mockUser,
      });

      await controller.githubCallback(req, res);

      expect(mockAuthService.login).toHaveBeenCalledWith(mockUser);
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3001?token=mock-jwt-token',
      );
    });

    it('should use default frontend URL when config returns undefined', async () => {
      const req = { user: mockUser };
      const res = { redirect: jest.fn() } as any;

      mockConfigService.get.mockReturnValue(undefined);
      mockAuthService.login.mockResolvedValue({
        accessToken: 'test-token',
        user: mockUser,
      });

      await controller.githubCallback(req, res);

      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3001?token=test-token',
      );
    });
  });

  describe('GET /auth/me', () => {
    it('should return user profile when JWT is valid', () => {
      const req = { user: mockUser };

      const result = controller.getProfile(req);

      expect(result).toEqual({
        id: 'user-123',
        githubId: '12345',
        username: 'testuser',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        deployCount: 0,
      });
    });

    it('should return only safe profile fields (no email, no timestamps)', () => {
      const req = { user: mockUser };

      const result = controller.getProfile(req);

      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('createdAt');
      expect(result).not.toHaveProperty('updatedAt');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('githubId');
      expect(result).toHaveProperty('username');
      expect(result).toHaveProperty('avatarUrl');
      expect(result).toHaveProperty('deployCount');
    });
  });
});
