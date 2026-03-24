import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { VibeScoreService } from '../src/vibe-score/vibe-score.service';
import { CompileService } from '../src/contracts/compile.service';
import { EngineService, CliOutput } from '../src/engine/engine.service';
import { OptimizerService } from '../src/analysis/optimizer.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Mock ethers for deterministic getCreateAddress
jest.mock('ethers', () => ({
  ethers: {
    getCreateAddress: jest.fn().mockReturnValue('0xDeployedAddr'),
    Interface: jest.fn().mockImplementation(() => ({
      encodeFunctionData: jest.fn().mockReturnValue('0xabcdef12'),
    })),
  },
}));

describe('VibeScoreService', () => {
  let service: VibeScoreService;
  let compileService: CompileService;
  let engineService: EngineService;
  let optimizerService: OptimizerService;
  let prismaService: PrismaService;

  const mockAbi = [
    {
      type: 'function',
      name: 'store',
      inputs: [{ type: 'uint256', name: '_value' }],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      type: 'function',
      name: 'retrieve',
      inputs: [],
      outputs: [{ type: 'uint256' }],
      stateMutability: 'view',
    },
  ];

  const mockCompileResult = {
    contractName: 'FixedContract',
    abi: mockAbi,
    bytecode: '0x6080604052',
  };

  const makeEngineResult = (
    overrides: Partial<CliOutput> = {},
  ): CliOutput => ({
    results: [
      { success: true, gas_used: 100000, output: '0x', error: null, logs_count: 0 },
      { success: true, gas_used: 50000, output: '0x', error: null, logs_count: 1 },
      { success: true, gas_used: 45000, output: '0x', error: null, logs_count: 0 },
      { success: true, gas_used: 48000, output: '0x', error: null, logs_count: 0 },
    ],
    incarnations: [0, 0, 0, 0],
    stats: {
      total_gas: 243000,
      num_transactions: 4,
      num_conflicts: 0,
      num_re_executions: 0,
    },
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VibeScoreService,
        {
          provide: CompileService,
          useValue: {
            compile: jest.fn().mockReturnValue(mockCompileResult),
          },
        },
        {
          provide: EngineService,
          useValue: {
            executeBlock: jest.fn().mockReturnValue(makeEngineResult()),
          },
        },
        {
          provide: OptimizerService,
          useValue: {
            calculateScore: jest.fn().mockReturnValue({
              score: 75,
              deductions: [],
              suggestions: ['Consider using events for state tracking'],
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            vibeScore: {
              create: jest.fn().mockResolvedValue({ id: 'vs-123' }),
            },
          },
        },
      ],
    }).compile();

    service = module.get<VibeScoreService>(VibeScoreService);
    compileService = module.get<CompileService>(CompileService);
    engineService = module.get<EngineService>(EngineService);
    optimizerService = module.get<OptimizerService>(OptimizerService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeContract — engine path', () => {
    it('returns engine-based score with engineBased=true when engine succeeds', async () => {
      const result = await service.analyzeContract('contract Test {}');

      expect(result.engineBased).toBe(true);
      expect(result.vibeScore).toBeGreaterThan(0);
      expect(result.vibeScore).toBeLessThanOrEqual(100);
      expect(result.conflicts).toBeDefined();
      expect(result.reExecutions).toBeDefined();
      expect(result.gasEfficiency).toBeDefined();
      expect(result.suggestions).toBeInstanceOf(Array);
    });

    it('returns high score (≥80) when no conflicts detected', async () => {
      // Default engine mock has 0 conflicts, 0 re-executions, all success
      const result = await service.analyzeContract('contract NoConflict {}');

      expect(result.vibeScore).toBeGreaterThanOrEqual(80);
      expect(result.conflicts).toBe(0);
      expect(result.reExecutions).toBe(0);
      expect(result.engineBased).toBe(true);
    });

    it('returns lower score when conflicts detected', async () => {
      // Get baseline score without conflicts
      const noConflictResult = await service.analyzeContract('contract A {}');
      const baseScore = noConflictResult.vibeScore;

      // Now mock conflicts
      jest.spyOn(engineService, 'executeBlock').mockReturnValue(
        makeEngineResult({
          incarnations: [0, 2, 1, 3],
          stats: {
            total_gas: 243000,
            num_transactions: 4,
            num_conflicts: 3,
            num_re_executions: 6,
          },
        }),
      );

      const conflictResult = await service.analyzeContract('contract B {}');

      expect(conflictResult.vibeScore).toBeLessThan(baseScore);
      expect(conflictResult.conflicts).toBe(3);
      expect(conflictResult.reExecutions).toBe(6);
      expect(conflictResult.engineBased).toBe(true);
    });

    it('calculates gasEfficiency correctly with failed transactions', async () => {
      jest.spyOn(engineService, 'executeBlock').mockReturnValue(
        makeEngineResult({
          results: [
            { success: true, gas_used: 100000, output: '0x', error: null, logs_count: 0 },
            { success: true, gas_used: 50000, output: '0x', error: null, logs_count: 0 },
            { success: true, gas_used: 45000, output: '0x', error: null, logs_count: 0 },
            { success: false, gas_used: 21000, output: '0x', error: 'reverted', logs_count: 0 },
          ],
        }),
      );

      const result = await service.analyzeContract('contract Failing {}');

      // 1 failed out of 4 = 75% gas efficiency
      expect(result.gasEfficiency).toBe(75);
    });
  });

  describe('analyzeContract — heuristic fallback', () => {
    it('falls back to heuristic when engine returns null', async () => {
      jest.spyOn(engineService, 'executeBlock').mockReturnValue(null);

      const result = await service.analyzeContract('contract Fallback {}');

      expect(result.engineBased).toBe(false);
      expect(result.vibeScore).toBe(75);
      expect(result.conflicts).toBe(0);
      expect(result.reExecutions).toBe(0);
      expect(result.gasEfficiency).toBe(100);
      expect(optimizerService.calculateScore).toHaveBeenCalledWith(
        'contract Fallback {}',
      );
    });

    it('falls back to heuristic when ABI has only view/pure functions', async () => {
      jest.spyOn(compileService, 'compile').mockReturnValue({
        contractName: 'ViewOnly',
        abi: [
          {
            type: 'function',
            name: 'getValue',
            inputs: [],
            outputs: [{ type: 'uint256' }],
            stateMutability: 'view',
          },
          {
            type: 'function',
            name: 'computeHash',
            inputs: [{ type: 'bytes' }],
            outputs: [{ type: 'bytes32' }],
            stateMutability: 'pure',
          },
        ],
        bytecode: '0x6080604052',
      });

      const result = await service.analyzeContract('contract ViewOnly {}');

      expect(result.engineBased).toBe(false);
      expect(optimizerService.calculateScore).toHaveBeenCalled();
    });
  });

  describe('analyzeContract — database persistence', () => {
    it('saves result to database', async () => {
      await service.analyzeContract('contract Save {}', 'user-1');

      expect(prismaService.vibeScore.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          contractSource: 'contract Save {}',
          engineBased: true,
          conflicts: expect.any(String),
          reExecutions: expect.any(String),
          gasEfficiency: expect.any(String),
          suggestions: expect.any(Array),
        }),
      });
    });

    it('does not throw when database write fails', async () => {
      jest
        .spyOn(prismaService.vibeScore, 'create')
        .mockRejectedValue(new Error('DB connection lost'));

      // Should not throw
      const result = await service.analyzeContract('contract DbFail {}');

      expect(result.engineBased).toBe(true);
      expect(result.vibeScore).toBeGreaterThan(0);
    });
  });

  describe('analyzeContract — error handling', () => {
    it('propagates compilation error', async () => {
      jest.spyOn(compileService, 'compile').mockImplementation(() => {
        throw new BadRequestException({
          message: 'Compilation failed',
          errors: ['ParserError: Expected ; but got }'],
        });
      });

      await expect(
        service.analyzeContract('invalid solidity'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStateChangingFunctions', () => {
    it('filters out view and pure functions', () => {
      const abi = [
        { type: 'function', name: 'store', stateMutability: 'nonpayable' },
        { type: 'function', name: 'getValue', stateMutability: 'view' },
        { type: 'function', name: 'computeHash', stateMutability: 'pure' },
        { type: 'function', name: 'deposit', stateMutability: 'payable' },
        { type: 'constructor', name: '', stateMutability: 'nonpayable' },
      ];

      const result = service.getStateChangingFunctions(abi);

      expect(result).toHaveLength(2);
      expect(result.map((f) => f.name)).toEqual(['store', 'deposit']);
    });
  });

  describe('calculateScore', () => {
    it('returns vibeScore=100 with no conflicts, no re-execs, all success', () => {
      const result = service.calculateScore(makeEngineResult());

      expect(result.vibeScore).toBe(100);
      expect(result.conflicts).toBe(0);
      expect(result.reExecutions).toBe(0);
      expect(result.gasEfficiency).toBe(100);
      expect(result.engineBased).toBe(true);
    });

    it('applies capped conflict penalty', () => {
      const result = service.calculateScore(
        makeEngineResult({
          stats: {
            total_gas: 200000,
            num_transactions: 4,
            num_conflicts: 100,
            num_re_executions: 0,
          },
        }),
      );

      // Conflict penalty is capped at 40
      expect(result.vibeScore).toBeGreaterThanOrEqual(60);
      expect(result.vibeScore).toBeLessThanOrEqual(100);
    });
  });

  describe('analyzeContract — conflict analysis wiring', () => {
    const mockStorageLayout = {
      storage: [
        { astId: 1, contract: 'ParallelConflict', label: 'counter', offset: 0, slot: '0', type: 't_uint256' },
      ],
      types: {
        t_uint256: { encoding: 'inplace', label: 'uint256', numberOfBytes: '32' },
      },
    };

    const mockConflictDetails = {
      per_tx: [],
      conflicts: [
        {
          location: {
            location_type: 'Storage',
            address: '0xDeployedAddr',
            slot: '0x0',
          },
          tx_a: 1,
          tx_b: 2,
          conflict_type: 'write-write',
        },
      ],
    };

    const parallelConflictAbi = [
      {
        type: 'function',
        name: 'increment',
        inputs: [],
        outputs: [],
        stateMutability: 'nonpayable',
      },
      {
        type: 'function',
        name: 'incrementBy',
        inputs: [{ type: 'uint256', name: 'amount' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
      {
        type: 'function',
        name: 'getCount',
        inputs: [],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
      },
    ];

    it('includes conflictAnalysis when conflict_details and storageLayout present', async () => {
      jest.spyOn(compileService, 'compile').mockReturnValue({
        contractName: 'ParallelConflict',
        abi: parallelConflictAbi,
        bytecode: '0x6080604052',
        storageLayout: mockStorageLayout,
      });

      jest.spyOn(engineService, 'executeBlock').mockReturnValue(
        makeEngineResult({
          stats: {
            total_gas: 200000,
            num_transactions: 3,
            num_conflicts: 1,
            num_re_executions: 1,
          },
          conflict_details: mockConflictDetails,
        }),
      );

      const result = await service.analyzeContract('contract ParallelConflict {}');

      expect(result.conflictAnalysis).toBeDefined();
      expect(result.conflictAnalysis!.conflicts.length).toBeGreaterThan(0);
      expect(result.conflictAnalysis!.conflicts[0].variableName).toBe('counter');
      expect(result.conflictAnalysis!.conflicts[0].functions).toContain('increment');
      expect(result.conflictAnalysis!.conflicts[0].functions).toContain('incrementBy');
      expect(result.conflictAnalysis!.conflicts[0].suggestion).toBeTruthy();
      expect(result.conflictAnalysis!.matrix.rows.length).toBeGreaterThan(0);
      // Existing fields still present
      expect(result.engineBased).toBe(true);
      expect(result.vibeScore).toBeDefined();
    });

    it('omits conflictAnalysis when no conflict_details (backward compat)', async () => {
      // Default mock has no conflict_details
      const result = await service.analyzeContract('contract NoConflictDetails {}');

      expect(result.conflictAnalysis).toBeUndefined();
      // Existing fields intact
      expect(result.engineBased).toBe(true);
      expect(result.vibeScore).toBeDefined();
      expect(result.conflicts).toBeDefined();
      expect(result.suggestions).toBeInstanceOf(Array);
    });

    it('omits conflictAnalysis when storageLayout is undefined', async () => {
      // No storageLayout, but conflict_details present
      jest.spyOn(compileService, 'compile').mockReturnValue({
        contractName: 'NoLayout',
        abi: parallelConflictAbi,
        bytecode: '0x6080604052',
        // storageLayout intentionally absent
      });

      jest.spyOn(engineService, 'executeBlock').mockReturnValue(
        makeEngineResult({
          stats: {
            total_gas: 200000,
            num_transactions: 3,
            num_conflicts: 1,
            num_re_executions: 1,
          },
          conflict_details: mockConflictDetails,
        }),
      );

      const result = await service.analyzeContract('contract NoLayout {}');

      expect(result.conflictAnalysis).toBeUndefined();
      // Existing fields still work
      expect(result.engineBased).toBe(true);
      expect(result.vibeScore).toBeDefined();
    });
  });
});
