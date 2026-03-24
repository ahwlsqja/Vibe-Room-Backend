import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadGatewayException } from '@nestjs/common';
import { VerifyService } from '../src/contracts/verify.service';

// Save original fetch so we can restore it
const originalFetch = global.fetch;

describe('VerifyService', () => {
  let service: VerifyService;
  let mockFetch: jest.Mock;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        'sourcify.baseUrl': 'https://sourcify-api-monad.blockvision.org',
        'monad.chainId': 10143,
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerifyService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<VerifyService>(VerifyService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── getCompilerVersion ──

  describe('getCompilerVersion', () => {
    it('should strip .Emscripten.clang suffix and prefix with v', () => {
      const version = service.getCompilerVersion();
      // solc.version() returns "0.8.34+commit.80d5c536.Emscripten.clang"
      expect(version).toMatch(/^v\d+\.\d+\.\d+\+commit\.[0-9a-f]+$/);
      expect(version).not.toContain('Emscripten');
      expect(version).not.toContain('clang');
      expect(version).toMatch(/^v/);
    });
  });

  // ── submitVerification ──

  describe('submitVerification', () => {
    const validDto = {
      source: 'pragma solidity ^0.8.20; contract Foo {}',
      contractName: 'Foo',
      address: '0x1234567890abcdef1234567890abcdef12345678',
      txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    };

    it('should POST to correct Sourcify v2 URL and return verificationId', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ verificationId: 'uuid-123' }),
      });

      const result = await service.submitVerification(validDto);

      expect(result.verificationId).toBe('uuid-123');
      expect(result.status).toBe('pending');

      // Verify URL format
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(
        'https://sourcify-api-monad.blockvision.org/v2/verify/10143/0x1234567890abcdef1234567890abcdef12345678',
      );
      expect(options.method).toBe('POST');

      // Verify request body contains stdJsonInput matching compile.service.ts settings
      const body = JSON.parse(options.body);
      expect(body.stdJsonInput).toBeDefined();
      expect(body.stdJsonInput.language).toBe('Solidity');
      expect(body.stdJsonInput.settings.evmVersion).toBe('cancun');
      expect(body.stdJsonInput.settings.outputSelection).toEqual({
        '*': { '*': ['abi', 'evm.bytecode.object', 'storageLayout'] },
      });
      // No optimizer in settings (matching compile.service.ts)
      expect(body.stdJsonInput.settings.optimizer).toBeUndefined();

      // Verify compilerVersion is normalized
      expect(body.compilerVersion).toMatch(/^v\d+\.\d+\.\d+\+commit\.[0-9a-f]+$/);
      expect(body.compilerVersion).not.toContain('Emscripten');

      // Verify contractIdentifier format
      expect(body.contractIdentifier).toBe('Contract.sol:Foo');

      // Verify creationTransactionHash
      expect(body.creationTransactionHash).toBe(validDto.txHash);
    });

    it('should throw BadGatewayException on network error', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      await expect(service.submitVerification(validDto)).rejects.toThrow(
        BadGatewayException,
      );
      await expect(service.submitVerification(validDto)).rejects.toThrow(
        'Sourcify API unreachable',
      );
    });

    it('should throw BadGatewayException on timeout (AbortError)', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      await expect(service.submitVerification(validDto)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('should use AbortController signal in fetch call', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ verificationId: 'uuid-456' }),
      });

      await service.submitVerification(validDto);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ── getVerificationStatus ──

  describe('getVerificationStatus', () => {
    it('should return verified status with explorerUrl', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'verified',
          match: 'exact_match',
          address: '0x1234567890abcdef1234567890abcdef12345678',
        }),
      });

      const result = await service.getVerificationStatus('uuid-123');

      expect(result.verificationId).toBe('uuid-123');
      expect(result.status).toBe('verified');
      expect(result.match).toBe('exact_match');
      expect(result.explorerUrl).toBe(
        'https://testnet.monadexplorer.com/address/0x1234567890abcdef1234567890abcdef12345678',
      );
    });

    it('should return pending when API returns 404', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      });

      const result = await service.getVerificationStatus('uuid-pending');

      expect(result.verificationId).toBe('uuid-pending');
      expect(result.status).toBe('pending');
    });

    it('should return failed status with error message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'failed',
          error: 'Bytecode mismatch',
        }),
      });

      const result = await service.getVerificationStatus('uuid-fail');

      expect(result.verificationId).toBe('uuid-fail');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Bytecode mismatch');
    });

    it('should throw BadGatewayException on network error', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      await expect(
        service.getVerificationStatus('uuid-net-error'),
      ).rejects.toThrow(BadGatewayException);
    });

    it('should throw BadGatewayException on timeout', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      await expect(
        service.getVerificationStatus('uuid-timeout'),
      ).rejects.toThrow(BadGatewayException);
    });

    it('should return pending for unknown/in-progress status', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'processing',
        }),
      });

      const result = await service.getVerificationStatus('uuid-processing');

      expect(result.verificationId).toBe('uuid-processing');
      expect(result.status).toBe('pending');
    });

    it('should detect verification via match field (no explicit status)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          match: 'match',
          address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        }),
      });

      const result = await service.getVerificationStatus('uuid-match');

      expect(result.status).toBe('verified');
      expect(result.match).toBe('match');
      expect(result.explorerUrl).toBe(
        'https://testnet.monadexplorer.com/address/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      );
    });
  });
});
