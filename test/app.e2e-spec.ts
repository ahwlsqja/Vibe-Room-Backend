import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EngineService } from '../src/engine/engine.service';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * E2E test suite for the full NestJS API surface.
 *
 * Boots a real NestJS app instance from AppModule with PrismaService
 * overridden to prevent database connections. External services
 * (Gemini AI, Engine CLI) gracefully degrade when unconfigured —
 * no mocks needed for them.
 *
 * Tests the actual HTTP layer: routing, guards, validation pipes,
 * exception filters, and interceptors.
 */
describe('App (E2E)', () => {
  let app: INestApplication;

  // Minimal valid Solidity contract for compile and vibe-score tests
  const SIMPLE_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Simple {
    uint256 public value;
    function setValue(uint256 v) public {
        value = v;
    }
}`;

  // Mock PrismaService to prevent real DB connections
  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
    deployment: {
      create: jest.fn().mockResolvedValue({
        id: 'mock-deployment-id',
        userId: 'anonymous',
        contractName: 'Simple',
        contractSource: '',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    vibeScore: {
      create: jest.fn().mockResolvedValue({
        id: 'mock-vibe-score-id',
        score: 80,
        engineBased: false,
        createdAt: new Date(),
      }),
    },
    analysis: {
      create: jest.fn().mockResolvedValue({
        id: 'mock-analysis-id',
        createdAt: new Date(),
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();

    // Replicate main.ts bootstrap config
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ── Health endpoints ──
  // Terminus @HealthCheck() wraps response in { status, info, details }
  // and TransformInterceptor wraps that in { success, data }

  describe('GET /api/health', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.status).toBe(200);
      // TransformInterceptor wraps Terminus output: { success, data: { status, info, details } }
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
    });
  });

  describe('GET /api/health/readiness', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/health/readiness',
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
    });
  });

  // ── Contracts endpoints ──

  describe('GET /api/contracts/source', () => {
    it('should return FixedContract source with pragma solidity', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/contracts/source?type=FixedContract',
      );
      expect(res.status).toBe(200);
      // TransformInterceptor wraps in { success, data }
      expect(res.body.success).toBe(true);
      expect(res.body.data.source).toContain('pragma solidity');
      expect(res.body.data.contractType).toBe('FixedContract');
    });

    it('should return 400 for invalid contract type', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/contracts/source?type=Invalid',
      );
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('POST /api/contracts/compile', () => {
    it('should compile valid Solidity and return bytecode + abi', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/contracts/compile')
        .send({ source: SIMPLE_CONTRACT });

      // NestJS @Post() defaults to 201 Created
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bytecode).toBeDefined();
      expect(res.body.data.bytecode).toMatch(/^0x[0-9a-fA-F]+$/);
      expect(res.body.data.abi).toBeInstanceOf(Array);
      expect(res.body.data.abi.length).toBeGreaterThan(0);
      expect(res.body.data.contractName).toBe('Simple');
    }, 30000);

    it('should return 400 for invalid Solidity source', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/contracts/compile')
        .send({ source: 'this is not valid solidity' });

      expect(res.status).toBe(400);
    }, 30000);

    it('should return 400 when source is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/contracts/compile')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── Vibe-score endpoint ──

  describe('POST /api/vibe-score', () => {
    it('should return a vibe score as a number (heuristic fallback)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/vibe-score')
        .send({ source: SIMPLE_CONTRACT });

      // NestJS @Post() defaults to 201 Created
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.vibeScore).toBe('number');
      expect(res.body.data.vibeScore).toBeGreaterThanOrEqual(0);
      expect(res.body.data.vibeScore).toBeLessThanOrEqual(100);
      // Without engine binary, should use heuristic
      expect(res.body.data.engineBased).toBe(false);
    }, 30000);

    it('should return 400 when source is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/vibe-score')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── Analysis endpoint ──
  // AnalysisController uses @Res() with explicit res.json() call
  // NestJS still sets default 201 for @Post() on the response object

  describe('POST /api/analysis/error', () => {
    it('should return analysis result for a revert error', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/analysis/error')
        .send({
          error: { message: 'execution reverted' },
          contractSource: SIMPLE_CONTRACT,
          errorCode: 'CALL_EXCEPTION',
        });

      // @Res() bypasses NestJS status override, but NestJS sets
      // default 201 for POST. Controller calls res.json() without
      // explicit status, so the NestJS default applies.
      expect(res.status).toBe(201);
      // AnalysisController manually wraps in { success, data }
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.analysis).toBeDefined();
      expect(res.body.data.analysis.summary).toBeDefined();
    }, 30000);

    it('should return 400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/analysis/error')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── Paymaster endpoint (JWT auth guard) ──

  describe('GET /api/paymaster/status', () => {
    it('should return 401 without Authorization header', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/paymaster/status',
      );
      expect(res.status).toBe(401);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Conflict Analysis E2E — Phase 5b pipeline integration test
//
// Boots a separate NestJS app instance with EngineService overridden to
// return conflict_details. CompileService is real (compiles actual Solidity
// and returns storageLayout from solc). This validates the full pipeline:
//   compile → storageLayout → slot decode → suggestion → conflictAnalysis
// at the HTTP layer.
// ──────────────────────────────────────────────────────────────────────

describe('Conflict Analysis E2E', () => {
  let app: INestApplication;
  let mockExecuteBlock: jest.Mock;

  // ParallelConflict Solidity source — same as contracts/test/ParallelConflict.sol
  const PARALLEL_CONFLICT_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ParallelConflict {
    uint256 public counter;

    event CounterIncremented(uint256 newValue);

    function increment() external {
        uint256 current = counter;
        counter = current + 1;
        emit CounterIncremented(counter);
    }

    function incrementBy(uint256 amount) external {
        uint256 current = counter;
        counter = current + amount;
        emit CounterIncremented(counter);
    }

    function getCounter() external view returns (uint256) {
        return counter;
    }
}`;

  // Simple contract with no parallel conflicts (backward compat test)
  const SIMPLE_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Simple {
    uint256 public value;
    function setValue(uint256 v) public {
        value = v;
    }
}`;

  // Mock conflict_details matching the ParallelConflict storage layout:
  // slot "0" → variable "counter" (uint256)
  // The address must NOT match coinbase (0x00...00C0) to avoid filtering.
  const mockConflictDetails = {
    per_tx: [],
    conflicts: [
      {
        location: {
          location_type: 'Storage',
          address: '0x1234567890abcdef1234567890abcdef12345678',
          slot: '0x0',
        },
        tx_a: 1,
        tx_b: 2,
        conflict_type: 'write-write',
      },
    ],
  };

  // Mock PrismaService to prevent real DB connections
  const mockPrismaService = {
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
    deployment: {
      create: jest.fn().mockResolvedValue({
        id: 'mock-deployment-id',
        userId: 'anonymous',
        contractName: 'Test',
        contractSource: '',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    vibeScore: {
      create: jest.fn().mockResolvedValue({
        id: 'mock-vibe-score-id',
        score: 80,
        engineBased: true,
        createdAt: new Date(),
      }),
    },
    analysis: {
      create: jest.fn().mockResolvedValue({
        id: 'mock-analysis-id',
        createdAt: new Date(),
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
  };

  beforeAll(async () => {
    // EngineService mock — returns conflict_details for conflict tests,
    // no conflict_details for backward compat tests
    mockExecuteBlock = jest.fn();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(EngineService)
      .useValue({ executeBlock: mockExecuteBlock })
      .compile();

    app = moduleFixture.createNestApplication();

    // Replicate main.ts bootstrap config
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ── Test 1: ParallelConflict → conflictAnalysis present ──

  it('should return conflictAnalysis with decoded conflicts for ParallelConflict source', async () => {
    // Configure mock: return engine result with conflict_details
    mockExecuteBlock.mockReturnValue({
      results: [
        { success: true, gas_used: 200000, output: '0x', error: null, logs_count: 0 },
        { success: true, gas_used: 50000, output: '0x', error: null, logs_count: 1 },
        { success: true, gas_used: 48000, output: '0x', error: null, logs_count: 1 },
      ],
      incarnations: [0, 1, 2],
      stats: {
        total_gas: 298000,
        num_transactions: 3,
        num_conflicts: 1,
        num_re_executions: 1,
      },
      conflict_details: mockConflictDetails,
    });

    const res = await request(app.getHttpServer())
      .post('/api/vibe-score')
      .send({ source: PARALLEL_CONFLICT_SOURCE });

    // Basic response shape
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.engineBased).toBe(true);
    expect(typeof res.body.data.vibeScore).toBe('number');
    expect(res.body.data.vibeScore).toBeGreaterThanOrEqual(0);
    expect(res.body.data.vibeScore).toBeLessThanOrEqual(100);
    expect(res.body.data.suggestions).toBeInstanceOf(Array);

    // Phase 5b: conflictAnalysis must be present
    expect(res.body.data.conflictAnalysis).toBeDefined();

    const ca = res.body.data.conflictAnalysis;

    // Decoded conflicts
    expect(ca.conflicts).toBeInstanceOf(Array);
    expect(ca.conflicts.length).toBeGreaterThan(0);
    expect(ca.conflicts[0].variableName).toBe('counter');
    expect(ca.conflicts[0].conflictType).toBe('write-write');
    expect(ca.conflicts[0].functions).toBeInstanceOf(Array);
    expect(ca.conflicts[0].functions.length).toBeGreaterThan(0);
    expect(ca.conflicts[0].suggestion).toBeTruthy();

    // Conflict matrix
    expect(ca.matrix).toBeDefined();
    expect(ca.matrix.rows.length).toBeGreaterThan(0);
    expect(ca.matrix.cols.length).toBeGreaterThan(0);
  }, 30000);

  // ── Test 2: Simple contract → no conflictAnalysis (backward compat) ──

  it('should omit conflictAnalysis for non-conflict contract (backward compat)', async () => {
    // Configure mock: return engine result WITHOUT conflict_details
    mockExecuteBlock.mockReturnValue({
      results: [
        { success: true, gas_used: 150000, output: '0x', error: null, logs_count: 0 },
        { success: true, gas_used: 45000, output: '0x', error: null, logs_count: 0 },
      ],
      incarnations: [0, 0],
      stats: {
        total_gas: 195000,
        num_transactions: 2,
        num_conflicts: 0,
        num_re_executions: 0,
      },
      // No conflict_details — simulating a clean contract
    });

    const res = await request(app.getHttpServer())
      .post('/api/vibe-score')
      .send({ source: SIMPLE_CONTRACT });

    // Basic response shape — backward compat
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // conflictAnalysis must be absent
    expect(res.body.data.conflictAnalysis).toBeUndefined();

    // Existing fields must still be present and valid
    expect(typeof res.body.data.vibeScore).toBe('number');
    expect(res.body.data.vibeScore).toBeGreaterThanOrEqual(0);
    expect(res.body.data.vibeScore).toBeLessThanOrEqual(100);
    expect(res.body.data.engineBased).toBe(true);
    expect(res.body.data.suggestions).toBeInstanceOf(Array);
  }, 30000);

  // ── Test 3: Diagnostic — verify EngineService mock isolation ──

  it('should only mock EngineService in this describe block (isolation check)', () => {
    // Confirm the mock is a jest.fn()
    expect(jest.isMockFunction(mockExecuteBlock)).toBe(true);
    // After the tests above, the mock should have been called
    expect(mockExecuteBlock).toHaveBeenCalled();
  });
});
