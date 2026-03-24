import {
  Injectable,
  Logger,
  BadGatewayException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as solc from 'solc';
import { VerifyRequestDto } from './dto/verify-request.dto';
import { VerifyResultDto } from './dto/verify-result.dto';

/** Timeout for all Sourcify API fetch calls (ms) */
const FETCH_TIMEOUT_MS = 30_000;

@Injectable()
export class VerifyService {
  private readonly logger = new Logger(VerifyService.name);

  private readonly sourcifyBaseUrl: string;
  private readonly chainId: number;

  constructor(private readonly configService: ConfigService) {
    this.sourcifyBaseUrl = this.configService.get<string>(
      'sourcify.baseUrl',
      'https://sourcify-api-monad.blockvision.org',
    );
    this.chainId = this.configService.get<number>('monad.chainId', 10143);
  }

  /**
   * Get the normalized compiler version suitable for Sourcify.
   * Strips the `.Emscripten.clang` suffix and prefixes with `v`.
   *
   * solc.version() → "0.8.34+commit.80d5c536.Emscripten.clang"
   * → returns "v0.8.34+commit.80d5c536"
   */
  getCompilerVersion(): string {
    const raw: string = solc.version();
    const normalized = raw.replace(/\.Emscripten\.clang$/, '');
    return `v${normalized}`;
  }

  /**
   * Submit a contract verification request to Sourcify API v2.
   *
   * POST /v2/verify/{chainId}/{address}
   *
   * @returns VerifyResultDto with verificationId and status='pending'
   * @throws BadGatewayException when Sourcify API is unreachable or times out
   */
  async submitVerification(dto: VerifyRequestDto): Promise<VerifyResultDto> {
    const { source, contractName, address, txHash } = dto;
    const compilerVersion = this.getCompilerVersion();
    const url = `${this.sourcifyBaseUrl}/v2/verify/${this.chainId}/${address}`;

    const stdJsonInput = {
      language: 'Solidity',
      sources: {
        'Contract.sol': { content: source },
      },
      settings: {
        evmVersion: 'cancun',
        outputSelection: {
          '*': {
            '*': ['abi', 'evm.bytecode.object', 'storageLayout'],
          },
        },
      },
    };

    const body = {
      stdJsonInput,
      compilerVersion,
      contractIdentifier: `Contract.sol:${contractName}`,
      creationTransactionHash: txHash,
    };

    try {
      const response = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      const verificationId: string =
        data.verificationId ?? data.id ?? '';

      this.logger.log(
        `Verify submitted: address=${address}, verificationId=${verificationId}`,
      );

      return {
        verificationId,
        status: 'pending',
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Verify failed: address=${address}, error=${message}`,
      );
      throw new BadGatewayException('Sourcify API unreachable');
    }
  }

  /**
   * Poll verification status from Sourcify API v2.
   *
   * GET /v2/verify/{verificationId}
   *
   * @returns VerifyResultDto with current status
   * @throws BadGatewayException when Sourcify API is unreachable or times out
   */
  async getVerificationStatus(
    verificationId: string,
  ): Promise<VerifyResultDto> {
    const url = `${this.sourcifyBaseUrl}/v2/verify/${verificationId}`;

    try {
      const response = await this.fetchWithTimeout(url, { method: 'GET' });

      if (response.status === 404) {
        this.logger.log(
          `Verify poll: verificationId=${verificationId}, status=pending (404)`,
        );
        return {
          verificationId,
          status: 'pending',
        };
      }

      const data = await response.json();

      // Determine status from response
      const isVerified =
        data.status === 'verified' ||
        data.match === 'exact_match' ||
        data.match === 'match';

      const isFailed =
        data.status === 'failed' || data.error !== undefined;

      if (isVerified) {
        const address: string = data.address ?? '';
        const explorerUrl = address
          ? `https://testnet.monadexplorer.com/address/${address}`
          : undefined;

        this.logger.log(
          `Verify poll: verificationId=${verificationId}, status=verified, match=${data.match ?? 'unknown'}`,
        );

        return {
          verificationId,
          status: 'verified',
          match: data.match ?? 'exact_match',
          explorerUrl,
        };
      }

      if (isFailed) {
        const errorMsg: string =
          data.error ?? data.message ?? 'Verification failed';

        this.logger.warn(
          `Verify poll: verificationId=${verificationId}, status=failed, error=${errorMsg}`,
        );

        return {
          verificationId,
          status: 'failed',
          error: errorMsg,
        };
      }

      // Still pending
      this.logger.log(
        `Verify poll: verificationId=${verificationId}, status=pending`,
      );
      return {
        verificationId,
        status: 'pending',
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Verify failed: verificationId=${verificationId}, error=${message}`,
      );
      throw new BadGatewayException('Sourcify API unreachable');
    }
  }

  /**
   * Fetch wrapper with AbortController timeout.
   * Throws BadGatewayException on timeout or network error.
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'AbortError'
      ) {
        throw new BadGatewayException(
          'Sourcify API request timed out',
        );
      }
      throw new BadGatewayException('Sourcify API unreachable');
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
