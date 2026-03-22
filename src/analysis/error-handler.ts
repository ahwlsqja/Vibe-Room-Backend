/**
 * Deployment error parser
 * Extracts structured info from provider/RPC errors and flags Monad-specific issues.
 * Ported from Vibe-Loom — pure functions, no DI needed.
 */

import {
  isLikelyMonadSpecificError,
  buildErrorAnalysisPrompt,
  type DeploymentErrorContext,
} from './prompt-templates';

/** Structured deployment error with Monad analysis flags */
export interface ParsedDeploymentError {
  message: string;
  code?: string | number;
  reason?: string;
  shortMessage?: string;
  transaction?: unknown;
  data?: unknown;
  stack?: string;
  isMonadSpecific: boolean;
  analysisPrompt?: string;
}

/**
 * Parse a raw provider/RPC error into structured DeploymentErrorContext
 */
export function parseProviderError(error: unknown): DeploymentErrorContext {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    return {
      message: String(err.message ?? err.error ?? 'Unknown error'),
      code: err.code as string | number | undefined,
      reason: err.reason as string | undefined,
      data: err.data,
      stack: err.stack as string | undefined,
      shortMessage: err.shortMessage as string | undefined,
      transaction: err.transaction ?? err.tx,
    };
  }
  return {
    message: String(error ?? 'Unknown error'),
  };
}

/**
 * Parse a deployment error and generate Monad-specific flags + AI analysis prompt
 */
export function handleDeploymentError(error: unknown): ParsedDeploymentError {
  const context = parseProviderError(error);
  const isMonadSpecific = isLikelyMonadSpecificError(context);
  const analysisPrompt = buildErrorAnalysisPrompt(context);

  return {
    message: context.message,
    code: context.code,
    reason: context.reason,
    shortMessage: context.shortMessage,
    transaction: context.transaction,
    data: context.data,
    stack: context.stack,
    isMonadSpecific,
    analysisPrompt,
  };
}
