/**
 * Monad deployment error analysis prompt templates
 * Ported from Vibe-Loom — pure functions, no DI needed.
 */

/** Provider/RPC error context extracted from raw errors */
export interface DeploymentErrorContext {
  message: string;
  code?: string | number;
  reason?: string;
  data?: unknown;
  stack?: string;
  shortMessage?: string;
  transaction?: unknown;
}

/** Monad parallel execution keywords */
export const MONAD_PARALLELISM_KEYWORDS = [
  'parallel',
  'optimistic',
  're-execution',
  'reschedule',
  'conflict',
  'state conflict',
  'merge',
  'input',
  'output',
  'SLOAD',
  'SSTORE',
  'concurrent',
  'nonce',
  'revert',
  'execution order',
];

/** Monad gas/policy keywords */
export const MONAD_GAS_POLICY_KEYWORDS = [
  'gas_limit',
  'gas limit',
  'gasLimit',
  'gas used',
  'insufficient funds',
  'exceeds block gas limit',
  'out of gas',
  'intrinsic gas',
  'gas_price',
  'base fee',
  'priority fee',
  'EIP-1559',
  'reserve balance',
];

/** Pectra fork / EVM compatibility keywords */
export const PECTRA_FORK_KEYWORDS = [
  'opcode',
  'precompile',
  'TSTORE',
  'TLOAD',
  'MCOPY',
  'EIP-',
  'Pectra',
  'bytecode',
  'contract size',
  '24.5',
  '128',
  'kb',
];

/** System prompt for deployment error analysis */
export const DEPLOYMENT_ERROR_ANALYSIS_PROMPT = `You are a Monad network expert developer.
Analyze the following deployment/transaction error, classify the cause, and suggest a fix.

## Monad Specifics
1. **Parallel Execution (Optimistic Execution)**: Monad executes transactions in parallel.
   - Concurrent access to the same account/storage slot can cause re-execution.
   - For nonce conflicts or state conflicts, review transaction ordering or retry logic.

2. **Gas Policy**: Monad deducts gas based on gas_limit (not gas_used).
   - "insufficient funds" may mean the balance doesn't cover gas_limit * gas_price.
   - The Reserve Balance system requires sufficient balance at consensus time.

3. **Pectra Fork**: EVM bytecode follows the Pectra fork.
   - Max contract size: 128kb (vs Ethereum's 24.5kb).
   - Unsupported opcodes or precompiles will cause errors.

4. **RPC Differences**: Monad RPC is mostly Ethereum-compatible but may differ in some areas.

## Error Information
\`\`\`
{errorMessage}
\`\`\`

## Additional Context
- Error code: {errorCode}
- Error reason: {errorReason}
- Transaction/deployment data: {errorData}

## Output Format (JSON)
\`\`\`json
{
  "category": "parallelism|gas_policy|pectra_fork|rpc|general|unknown",
  "isMonadSpecific": true|false,
  "summary": "One-line summary",
  "suggestedFix": "Fixed Solidity/code snippet or action description",
  "originalCodeSnippet": "Original code (error location)",
  "fixedCodeSnippet": "Fixed code (suggestion)"
}
\`\`\`

Output only the analysis result.`;

/** RAG-augmented fix request prompt */
export const RAG_FIX_REQUEST_PROMPT = `You are a Monad ecosystem expert AI builder. A deployment error has occurred.

## Instructions
1. Remove any constructor reverts.
2. Analyze the full code for single-slot bottlenecks (State Conflict) that reduce Monad's parallel execution efficiency, and rewrite using mappings or distributed structures.
3. Replace any Pectra-unsupported opcodes (TSTORE, etc.) with regular storage/mapping.

## [Context]
{context}

## [ErrorCode]
{errorCode}

## [ContractCode]
\`\`\`solidity
{contractCode}
\`\`\`

Respond ONLY in JSON format. No other explanation.
\`\`\`json
{
  "fixedCode": "Full fixed Solidity code (string, use escaped newlines \\n)",
  "explanation": "Summary of the fix applied",
  "parallelismScore": 0-100 (Monad parallel execution optimization score)
}
\`\`\``;

/**
 * Check if an error message is likely Monad-specific
 */
export function isLikelyMonadSpecificError(
  error: DeploymentErrorContext,
): boolean {
  const text = [
    error.message,
    error.reason,
    error.shortMessage,
    String(error.stack ?? ''),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const allKeywords = [
    ...MONAD_PARALLELISM_KEYWORDS,
    ...MONAD_GAS_POLICY_KEYWORDS,
    ...PECTRA_FORK_KEYWORDS,
  ];

  return allKeywords.some((kw) => text.includes(kw.toLowerCase()));
}

/**
 * Build the error analysis prompt with context filled in
 */
export function buildErrorAnalysisPrompt(
  error: DeploymentErrorContext,
): string {
  return DEPLOYMENT_ERROR_ANALYSIS_PROMPT.replace(
    '{errorMessage}',
    error.message,
  )
    .replace('{errorCode}', String(error.code ?? 'N/A'))
    .replace('{errorReason}', String(error.reason ?? 'N/A'))
    .replace(
      '{errorData}',
      JSON.stringify(error.data ?? error.transaction ?? 'N/A', null, 2),
    );
}

/**
 * Build RAG-augmented fix request prompt
 */
export function buildRagFixPrompt(
  context: string,
  errorCode: string,
  contractCode: string,
): string {
  return RAG_FIX_REQUEST_PROMPT.replace('{context}', context)
    .replace('{errorCode}', errorCode)
    .replace('{contractCode}', contractCode);
}
