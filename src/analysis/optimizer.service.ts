import { Injectable } from '@nestjs/common';

export interface MonadOptimizationResult {
  score: number;
  deductions: Array<{ reason: string; points: number }>;
  suggestions: string[];
}

/** Loop-internal storage access pattern */
const LOOP_STORAGE_PATTERN =
  /(for|while)\s*\([^)]*\)\s*\{[^}]*(?:\.\w+|storage|SLOAD|SSTORE)[^}]*\}/gis;

/**
 * Monad Parallelism optimizer — rule-based scoring of Solidity code
 * for parallel execution efficiency. Ported from Vibe-Loom optimizer.ts.
 */
@Injectable()
export class OptimizerService {
  /**
   * Calculate Monad parallelism optimization score for Solidity code.
   * Returns score (0-100), deductions, and suggestions.
   * All 6 detection patterns from Vibe-Loom are preserved.
   */
  calculateScore(solidityCode: string): MonadOptimizationResult {
    const deductions: Array<{ reason: string; points: number }> = [];
    const suggestions: string[] = [];
    let baseScore = 100;

    // 1. Loop-internal storage access (State Conflict risk)
    const loopStorageMatches = solidityCode.match(LOOP_STORAGE_PATTERN);
    if (loopStorageMatches && loopStorageMatches.length > 0) {
      const penalty = Math.min(25, loopStorageMatches.length * 8);
      baseScore -= penalty;
      deductions.push({
        reason: `Storage access inside loop (${loopStorageMatches.length} occurrences) — State Conflict risk`,
        points: penalty,
      });
      suggestions.push(
        'Cache repeated storage access inside loops into memory variables to reduce reschedule risk during parallel execution.',
      );
    }

    // 2. Direct SLOAD/SSTORE usage (inline assembly)
    const sstoreCount = (solidityCode.match(/\bSSTORE\b/gi) || []).length;
    const sloadCount = (solidityCode.match(/\bSLOAD\b/gi) || []).length;
    const directStorageOps = sstoreCount + sloadCount;
    if (directStorageOps > 3) {
      const penalty = Math.min(15, directStorageOps * 3);
      baseScore -= penalty;
      deductions.push({
        reason: `Direct storage opcode usage (${directStorageOps} ops) — complex I/O tracking for parallel execution`,
        points: penalty,
      });
      suggestions.push(
        'Use Solidity state variables instead of inline assembly storage opcodes for better compiler optimization.',
      );
    }

    // 3. Repeated access to same mapping/variable
    const repeatedMappingAccess = solidityCode.match(
      /(\w+)\s*\[[^\]]+\]\s*[^;]*\1\s*\[/g,
    );
    if (repeatedMappingAccess && repeatedMappingAccess.length > 0) {
      const penalty = Math.min(20, repeatedMappingAccess.length * 5);
      baseScore -= penalty;
      deductions.push({
        reason: `Repeated access to same mapping slot (${repeatedMappingAccess.length} occurrences)`,
        points: penalty,
      });
      suggestions.push(
        'Cache repeated mapping accesses to local variables to reduce slot contention.',
      );
    }

    // 4. CEI pattern violation (external call followed by state change)
    const ceiViolation =
      /(?:\.call|\.transfer|\.send|external\s+\w+\s*\([^)]*\))[^;]*;[^}]*(\b(?:SSTORE|=\s*\w+\.\w+)\b)/gis;
    if (ceiViolation.test(solidityCode)) {
      baseScore -= 15;
      deductions.push({
        reason: 'CEI pattern violation — state change after external call (reentrancy risk)',
        points: 15,
      });
      suggestions.push(
        'Follow the Checks-Effects-Interactions pattern: complete all state changes before external calls.',
      );
    }

    // 5. Centralized storage (single global counter — all txs compete for same slot)
    const singleGlobalVar = /(uint256|uint)\s+public\s+(\w+)\s*;/i;
    const match = solidityCode.match(singleGlobalVar);
    if (match) {
      const varName = match[2];
      const updatePattern = new RegExp(
        `\\b${varName}\\s*\\+=\\s*1|\\b${varName}\\s*=\\s*\\w+\\s*\\+\\s*1`,
        'i',
      );
      if (
        updatePattern.test(solidityCode) &&
        !/mapping\s*\(/i.test(solidityCode)
      ) {
        baseScore -= 65;
        deductions.push({
          reason: 'Centralized storage — single slot update creates parallel processing bottleneck',
          points: 65,
        });
        suggestions.push(
          'Use mapping(address => uint256) to distribute state across slots and reduce State Conflict.',
        );
      }
    }

    // 6. Block/transaction property dependency
    if (
      /block\.(timestamp|number|prevrandao)|tx\.(origin|gasprice)/gi.test(
        solidityCode,
      )
    ) {
      baseScore -= 10;
      deductions.push({
        reason: 'Block/transaction property dependency — unpredictable in Monad parallel execution',
        points: 10,
      });
      suggestions.push(
        'Excessive dependence on block properties can cause non-deterministic behavior in parallel execution environments.',
      );
    }

    const finalScore = Math.max(0, Math.min(100, baseScore));

    // Add overall assessment as first suggestion
    if (finalScore >= 80) {
      suggestions.unshift(
        'Code structure is well-suited for Monad parallel execution.',
      );
    } else if (finalScore >= 60) {
      suggestions.unshift(
        'Some optimizations can improve parallel execution efficiency.',
      );
    } else {
      suggestions.unshift(
        'High risk of State Conflict and re-execution. Apply the suggestions above.',
      );
    }

    return {
      score: finalScore,
      deductions,
      suggestions,
    };
  }
}
