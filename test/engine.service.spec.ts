import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EngineService, CliOutput } from '../src/engine/engine.service';

// Mock child_process and fs modules
jest.mock('child_process');
jest.mock('fs');

import { spawnSync } from 'child_process';
import * as fs from 'fs';

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockedExistsSync = fs.existsSync as jest.MockedFunction<
  typeof fs.existsSync
>;

describe('EngineService', () => {
  let service: EngineService;
  let configService: ConfigService;

  const validCliOutput: CliOutput = {
    results: [
      {
        success: true,
        gas_used: 50000,
        output: '0x',
        error: null,
        logs_count: 1,
      },
      {
        success: true,
        gas_used: 45000,
        output: '0x',
        error: null,
        logs_count: 0,
      },
    ],
    incarnations: [0, 0],
    stats: {
      total_gas: 95000,
      num_transactions: 2,
      num_conflicts: 0,
      num_re_executions: 0,
    },
  };

  const sampleTransactions = [
    {
      sender: '0x' + '0'.repeat(38) + 'e1',
      to: null,
      data: '6080604052',
      value: '0',
      gas_limit: 2_000_000,
      nonce: 0,
      gas_price: '1000000000',
    },
  ];

  const sampleBlockEnv = {
    number: 1,
    coinbase: '0x' + '0'.repeat(38) + 'C0',
    timestamp: 1700000000,
    gas_limit: 30_000_000,
    base_fee: '0',
    difficulty: '0',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngineService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'engine.binaryPath') return '/usr/local/bin/monad-cli';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<EngineService>(EngineService);
    configService = module.get<ConfigService>(ConfigService);

    // Default: binary exists on disk
    mockedExistsSync.mockReturnValue(true);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeBlock', () => {
    it('returns parsed JSON on successful CLI execution', () => {
      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify(validCliOutput),
        stderr: '',
        pid: 1234,
        output: [],
        signal: null,
      } as any);

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).not.toBeNull();
      expect(result!.stats.num_transactions).toBe(2);
      expect(result!.stats.num_conflicts).toBe(0);
      expect(result!.results).toHaveLength(2);
      expect(result!.results[0].success).toBe(true);
      expect(result!.incarnations).toEqual([0, 0]);

      // Verify spawnSync was called with correct args
      expect(mockedSpawnSync).toHaveBeenCalledWith(
        '/usr/local/bin/monad-cli',
        [],
        expect.objectContaining({
          input: expect.any(String),
          encoding: 'utf-8',
          timeout: 30_000,
        }),
      );
    });

    it('returns null when binary path is empty', () => {
      jest.spyOn(configService, 'get').mockReturnValue('');

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).toBeNull();
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });

    it('returns null when binary path is undefined', () => {
      jest.spyOn(configService, 'get').mockReturnValue(undefined);

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).toBeNull();
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });

    it('returns null when binary file does not exist on disk', () => {
      mockedExistsSync.mockReturnValue(false);

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).toBeNull();
      expect(mockedSpawnSync).not.toHaveBeenCalled();
    });

    it('returns null when spawnSync times out (ETIMEDOUT)', () => {
      mockedSpawnSync.mockReturnValue({
        status: null,
        stdout: '',
        stderr: '',
        pid: 1234,
        output: [],
        signal: null,
        error: new Error('spawnSync ETIMEDOUT'),
      } as any);

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).toBeNull();
    });

    it('returns null when spawnSync throws an exception', () => {
      mockedSpawnSync.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).toBeNull();
    });

    it('returns null when CLI returns non-zero exit status', () => {
      mockedSpawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: '{"error":"parse failure"}',
        pid: 1234,
        output: [],
        signal: null,
      } as any);

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).toBeNull();
    });

    it('returns null when stdout is not valid JSON', () => {
      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'not valid json at all',
        stderr: '',
        pid: 1234,
        output: [],
        signal: null,
      } as any);

      const result = service.executeBlock(sampleTransactions, sampleBlockEnv);

      expect(result).toBeNull();
    });

    it('passes correct JSON input to the CLI binary', () => {
      mockedSpawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify(validCliOutput),
        stderr: '',
        pid: 1234,
        output: [],
        signal: null,
      } as any);

      service.executeBlock(sampleTransactions, sampleBlockEnv);

      const calledInput = mockedSpawnSync.mock.calls[0][2]?.input as string;
      const parsed = JSON.parse(calledInput as string);
      expect(parsed.transactions).toEqual(sampleTransactions);
      expect(parsed.block_env).toEqual(sampleBlockEnv);
    });
  });
});
