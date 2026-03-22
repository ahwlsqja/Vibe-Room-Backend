import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;

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

  const mockPrismaService = {
    user: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateOrCreateUser', () => {
    it('should create a new user from GitHub profile', async () => {
      mockPrismaService.user.upsert.mockResolvedValue(mockUser);

      const githubProfile = {
        id: '12345',
        username: 'testuser',
        emails: [{ value: 'test@example.com' }],
        photos: [{ value: 'https://avatars.githubusercontent.com/u/12345' }],
      };

      const result = await service.validateOrCreateUser(githubProfile);

      expect(mockPrismaService.user.upsert).toHaveBeenCalledWith({
        where: { githubId: '12345' },
        update: {
          username: 'testuser',
          email: 'test@example.com',
          avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
        },
        create: {
          githubId: '12345',
          username: 'testuser',
          email: 'test@example.com',
          avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
          deployCount: 0,
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should update an existing user on re-login', async () => {
      const updatedUser = { ...mockUser, username: 'newname' };
      mockPrismaService.user.upsert.mockResolvedValue(updatedUser);

      const githubProfile = {
        id: '12345',
        username: 'newname',
        emails: [{ value: 'test@example.com' }],
        photos: [{ value: 'https://avatars.githubusercontent.com/u/12345' }],
      };

      const result = await service.validateOrCreateUser(githubProfile);

      expect(mockPrismaService.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { githubId: '12345' },
          update: expect.objectContaining({ username: 'newname' }),
        }),
      );
      expect(result.username).toBe('newname');
    });

    it('should handle missing email and avatar gracefully', async () => {
      mockPrismaService.user.upsert.mockResolvedValue({
        ...mockUser,
        email: null,
        avatarUrl: null,
      });

      const githubProfile = {
        id: '12345',
        username: 'testuser',
        // no emails or photos
      };

      const result = await service.validateOrCreateUser(githubProfile);

      expect(mockPrismaService.user.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: null,
            avatarUrl: null,
          }),
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('login', () => {
    it('should return a valid JWT structure with accessToken and user', () => {
      const result = service.login({
        id: 'user-123',
        githubId: '12345',
        username: 'testuser',
      });

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: 'user-123',
        githubId: '12345',
        username: 'testuser',
      });
      expect(result).toEqual({
        accessToken: 'mock-jwt-token',
        user: {
          id: 'user-123',
          githubId: '12345',
          username: 'testuser',
        },
      });
    });
  });
});
