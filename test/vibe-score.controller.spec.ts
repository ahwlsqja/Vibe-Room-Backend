import { Test, TestingModule } from '@nestjs/testing';
import { VibeScoreController } from '../src/vibe-score/vibe-score.controller';
import { VibeScoreService } from '../src/vibe-score/vibe-score.service';
import { VibeScoreResultDto } from '../src/vibe-score/dto/vibe-score-result.dto';
import { BadRequestException } from '@nestjs/common';

describe('VibeScoreController', () => {
  let controller: VibeScoreController;
  let vibeScoreService: VibeScoreService;

  const mockResult: VibeScoreResultDto = {
    vibeScore: 92,
    conflicts: 0,
    reExecutions: 0,
    gasEfficiency: 100,
    engineBased: true,
    suggestions: ['Contract is well-suited for Monad parallel execution — no conflicts detected.'],
    traceResults: [
      { success: true, gas_used: 50000, output: '0x', error: null, logs_count: 1 },
    ],
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VibeScoreController],
      providers: [
        {
          provide: VibeScoreService,
          useValue: {
            analyzeContract: jest.fn().mockResolvedValue(mockResult),
          },
        },
      ],
    }).compile();

    controller = module.get<VibeScoreController>(VibeScoreController);
    vibeScoreService = module.get<VibeScoreService>(VibeScoreService);
  });

  it('controller is defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /api/vibe-score', () => {
    it('calls analyzeContract with source from DTO', async () => {
      const source = 'contract Counter { uint256 public count; }';
      await controller.analyzeContract({ source });

      expect(vibeScoreService.analyzeContract).toHaveBeenCalledWith(source);
    });

    it('returns VibeScoreResultDto shape', async () => {
      const result = await controller.analyzeContract({
        source: 'contract Test {}',
      });

      expect(result).toEqual(mockResult);
      expect(result.vibeScore).toBe(92);
      expect(result.conflicts).toBe(0);
      expect(result.reExecutions).toBe(0);
      expect(result.gasEfficiency).toBe(100);
      expect(result.engineBased).toBe(true);
      expect(result.suggestions).toBeInstanceOf(Array);
      expect(result.traceResults).toBeInstanceOf(Array);
    });

    it('propagates service errors', async () => {
      jest
        .spyOn(vibeScoreService, 'analyzeContract')
        .mockRejectedValue(
          new BadRequestException('Compilation failed'),
        );

      await expect(
        controller.analyzeContract({ source: 'invalid code' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes only source (not userId) to service', async () => {
      const source = 'pragma solidity ^0.8.20; contract Foo {}';
      await controller.analyzeContract({ source });

      // Controller only passes source, not userId
      expect(vibeScoreService.analyzeContract).toHaveBeenCalledTimes(1);
      expect(vibeScoreService.analyzeContract).toHaveBeenCalledWith(source);
    });
  });
});
