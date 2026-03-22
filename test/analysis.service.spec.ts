import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from '../src/analysis/analysis.service';
import { GeminiService } from '../src/analysis/gemini.service';
import { OptimizerService } from '../src/analysis/optimizer.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AnalysisService', () => {
  let service: AnalysisService;
  let geminiService: GeminiService;

  const mockGeminiService = {
    generateContent: jest.fn(),
    generateContentStream: jest.fn(),
  };

  const mockPrismaService = {
    analysis: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        { provide: GeminiService, useValue: mockGeminiService },
        OptimizerService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
    geminiService = module.get<GeminiService>(GeminiService);
  });

  describe('analyzeError', () => {
    const sampleError = { message: 'execution reverted: test error' };
    const sampleContract = `
      pragma solidity ^0.8.19;
      contract Test {
        mapping(address => uint256) private values;
        function set(uint256 v) external {
          values[msg.sender] = v;
        }
      }
    `;

    it('should return AI analysis when Gemini succeeds', async () => {
      const aiResponse = JSON.stringify({
        fixedCode: 'contract Fixed { }',
        explanation: 'Fixed the revert issue',
        parallelismScore: 85,
      });
      mockGeminiService.generateContent.mockResolvedValue(aiResponse);

      const result = await service.analyzeError(sampleError, sampleContract);

      expect(result.analysis).toBeDefined();
      expect(result.analysis!.fixedCode).toBe('contract Fixed { }');
      expect(result.analysis!.explanation).toBe('Fixed the revert issue');
      expect(result.analysis!.parallelismScore).toBe(85);
      expect(result.optimization).toBeDefined();
      expect(result.optimization!.score).toBeGreaterThanOrEqual(0);
      expect(mockGeminiService.generateContent).toHaveBeenCalledTimes(1);
    });

    it('should fallback to heuristics when AI fails', async () => {
      mockGeminiService.generateContent.mockResolvedValue(null);

      const result = await service.analyzeError(sampleError, sampleContract);

      expect(result.analysis).toBeDefined();
      expect(result.analysis!.explanation).toBeDefined();
      expect(result.analysis!.fixedCode).toBeDefined();
      // Optimizer should still run
      expect(result.optimization).toBeDefined();
    });

    it('should detect gas error and provide gas-specific suggestion', async () => {
      mockGeminiService.generateContent.mockResolvedValue(null);
      const gasError = { message: 'insufficient funds for gas * price + value' };

      const result = await service.analyzeError(gasError, sampleContract);

      expect(result.analysis).toBeDefined();
      expect(result.analysis!.explanation!.toLowerCase()).toContain('gas');
      expect(result.analysis!.isMonadSpecific).toBe(true);
      expect(result.analysis!.category).toBe('gas_policy');
    });

    it('should include optimizer result with analysis', async () => {
      mockGeminiService.generateContent.mockResolvedValue(null);

      const result = await service.analyzeError(sampleError, sampleContract);

      expect(result.optimization).toBeDefined();
      expect(typeof result.optimization!.score).toBe('number');
      expect(Array.isArray(result.optimization!.deductions)).toBe(true);
      expect(Array.isArray(result.optimization!.suggestions)).toBe(true);
    });

    it('should handle AI returning markdown-wrapped JSON', async () => {
      const aiResponse = '```json\n{"fixedCode": "contract V2 { }", "explanation": "Upgraded"}\n```';
      mockGeminiService.generateContent.mockResolvedValue(aiResponse);

      const result = await service.analyzeError(sampleError, sampleContract);

      expect(result.analysis!.fixedCode).toBe('contract V2 { }');
      expect(result.analysis!.explanation).toBe('Upgraded');
    });

    it('should save to DB when userId is provided', async () => {
      mockGeminiService.generateContent.mockResolvedValue(null);
      mockPrismaService.analysis.create.mockResolvedValue({ id: 'analysis-1' });

      await service.analyzeError(sampleError, sampleContract, undefined, 'user-123');

      expect(mockPrismaService.analysis.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.analysis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            contractSource: sampleContract,
          }),
        }),
      );
    });
  });

  describe('loadRagContext', () => {
    it('should return a string (may be empty if path not found in test env)', async () => {
      const context = await service.loadRagContext();
      expect(typeof context).toBe('string');
    });
  });
});
