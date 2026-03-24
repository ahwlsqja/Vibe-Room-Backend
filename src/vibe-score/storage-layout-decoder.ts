/**
 * storage-layout-decoder.ts
 *
 * Pure-function module for decoding EVM storage slot conflicts into
 * human-readable variable names and generating actionable suggestions.
 *
 * No NestJS DI dependency — all functions are stateless and exported
 * for direct unit testing.
 *
 * Key domain complexity:
 * - solc storageLayout slots are decimal strings ("0", "1")
 * - CLI conflict_details slots are hex with 0x prefix ("0x0", "0x7")
 * - Runtime mapping/dynamic_array slots are keccak256-derived 256-bit numbers
 *   that cannot be reversed — heuristic: slot > max declared → mapping/array
 */

import {
  StorageLayout,
  StorageEntry,
} from '../contracts/dto/compile-result.dto';
import {
  ConflictDetails,
  ConflictPair,
} from '../engine/engine.service';
import {
  DecodedConflict,
  ConflictMatrix,
  ConflictAnalysis,
} from './dto/vibe-score-result.dto';

// ── Internal types ──

interface SlotDecodeResult {
  variableName: string;
  variableType: string;
  slot: string;
}

// ── Slot decoding ──

/**
 * Decode a hex storage slot to a variable name using the solc storageLayout.
 *
 * Algorithm:
 * 1. Exact match: convert both hex slot and decimal layout slot to BigInt
 * 2. Heuristic: if slot > max declared slot, attribute to mapping/dynamic_array
 * 3. Fallback: "unknown_slot_0xNNN"
 */
export function decodeSlotToVariable(
  slot: string,
  storageLayout: StorageLayout,
): SlotDecodeResult {
  const slotBigInt = BigInt(slot);

  // Step 1: Exact match against declared storage entries
  for (const entry of storageLayout.storage) {
    const entrySlotBigInt = BigInt(entry.slot);
    if (slotBigInt === entrySlotBigInt) {
      return {
        variableName: entry.label,
        variableType: storageLayout.types[entry.type]?.label ?? 'unknown',
        slot,
      };
    }
  }

  // Step 2: Heuristic for mapping/dynamic_array runtime slots
  // Runtime slots from keccak256 are much larger than declared slots
  const maxDeclaredSlot = storageLayout.storage.reduce(
    (max, entry) => {
      const s = BigInt(entry.slot);
      return s > max ? s : max;
    },
    BigInt(0),
  );

  if (slotBigInt > maxDeclaredSlot) {
    // Find all mapping or dynamic_array variables in the layout
    const dynamicVars = storageLayout.storage.filter((entry) => {
      const typeInfo = storageLayout.types[entry.type];
      return (
        typeInfo &&
        (typeInfo.encoding === 'mapping' || typeInfo.encoding === 'dynamic_array')
      );
    });

    if (dynamicVars.length === 1) {
      const entry = dynamicVars[0];
      return {
        variableName: entry.label,
        variableType: storageLayout.types[entry.type]?.label ?? 'unknown',
        slot,
      };
    } else if (dynamicVars.length > 1) {
      const names = dynamicVars.map((v) => v.label).join(' or ');
      return {
        variableName: `unknown (possibly ${names})`,
        variableType: 'unknown',
        slot,
      };
    }
  }

  // Step 3: Fallback
  return {
    variableName: `unknown_slot_${slot}`,
    variableType: 'unknown',
    slot,
  };
}

// ── Suggestion generation ──

/**
 * Generate an actionable English suggestion based on variable type and
 * conflicting function names.
 */
export function generateSuggestion(
  variableName: string,
  variableType: string,
  functions: string[],
  slot: string,
): string {
  const funcList = functions.join(' and ');

  if (variableType.startsWith('mapping')) {
    return `Conflict on mapping '${variableName}' between ${funcList} — consider separating key ranges or using separate mappings.`;
  }

  if (variableType === 'unknown' && variableName.startsWith('unknown_slot_')) {
    return `Conflict on slot ${slot} — verify the storage layout for this contract.`;
  }

  if (variableType.includes('[]') || variableType === 'dynamic_array') {
    return `Conflict on array '${variableName}' between ${funcList} — consider replacing push-based arrays with mapping-based structures.`;
  }

  // Simple value types: uint256, int256, bool, address, bytes32, etc.
  return `Conflict on variable '${variableName}' between ${funcList} — consider splitting into per-function variables or using an accumulation pattern.`;
}

// ── Matrix builder ──

/**
 * Build a function × variable conflict count matrix.
 *
 * rows = unique function names
 * cols = unique variable names
 * cells[r][c] = number of conflicts involving function rows[r] and variable cols[c]
 */
export function buildMatrix(decodedConflicts: DecodedConflict[]): ConflictMatrix {
  const rowSet = new Set<string>();
  const colSet = new Set<string>();

  for (const conflict of decodedConflicts) {
    for (const fn of conflict.functions) {
      rowSet.add(fn);
    }
    colSet.add(conflict.variableName);
  }

  const rows = Array.from(rowSet);
  const cols = Array.from(colSet);

  // Initialize 2D cells with zeros
  const cells: number[][] = rows.map(() => cols.map(() => 0));

  for (const conflict of decodedConflicts) {
    const colIdx = cols.indexOf(conflict.variableName);
    if (colIdx === -1) continue;

    for (const fn of conflict.functions) {
      const rowIdx = rows.indexOf(fn);
      if (rowIdx === -1) continue;
      cells[rowIdx][colIdx] += 1;
    }
  }

  return { rows, cols, cells };
}

// ── Main orchestrator ──

/**
 * Build a complete conflict analysis from CLI conflict_details and solc storageLayout.
 *
 * Steps:
 * A. Filter out coinbase address conflicts (EVM-intrinsic, not actionable)
 * B. Keep only Storage-type conflicts (Balance/Nonce/CodeHash can't be decoded)
 * C. Decode each slot to a variable name
 * D. Map tx indices to function names
 * E. Group by variable, attach suggestions
 * F. Build the function × variable matrix
 *
 * Returns empty analysis when storageLayout is undefined (graceful degradation).
 */
export function buildConflictAnalysis(
  conflictDetails: ConflictDetails,
  storageLayout: StorageLayout | undefined,
  _abi: any[],
  txFunctionMap: Map<number, string>,
  coinbaseAddress: string,
): ConflictAnalysis {
  const emptyResult: ConflictAnalysis = {
    conflicts: [],
    matrix: { rows: [], cols: [], cells: [] },
  };

  // Graceful degradation when storageLayout is unavailable
  if (!storageLayout) {
    return emptyResult;
  }

  // Step A: Filter out coinbase address conflicts
  const nonCoinbaseConflicts = conflictDetails.conflicts.filter(
    (c) => c.location.address.toLowerCase() !== coinbaseAddress.toLowerCase(),
  );

  // Step B: Keep only Storage-type conflicts with a slot field
  const storageConflicts = nonCoinbaseConflicts.filter(
    (c) => c.location.location_type === 'Storage' && c.location.slot,
  );

  if (storageConflicts.length === 0) {
    return emptyResult;
  }

  // Step C & D: Decode slots and resolve function names
  // Group conflicts by variable name for deduplication
  const variableGroupMap = new Map<
    string,
    {
      decoded: SlotDecodeResult;
      functions: Set<string>;
      conflictType: string;
    }
  >();

  for (const conflict of storageConflicts) {
    const decoded = decodeSlotToVariable(conflict.location.slot!, storageLayout);

    const funcA = txFunctionMap.get(conflict.tx_a) ?? `tx_${conflict.tx_a}`;
    const funcB = txFunctionMap.get(conflict.tx_b) ?? `tx_${conflict.tx_b}`;

    const key = decoded.variableName;
    const existing = variableGroupMap.get(key);
    if (existing) {
      existing.functions.add(funcA);
      existing.functions.add(funcB);
      // Upgrade to write-write if any conflict is write-write
      if (conflict.conflict_type === 'write-write') {
        existing.conflictType = 'write-write';
      }
    } else {
      variableGroupMap.set(key, {
        decoded,
        functions: new Set([funcA, funcB]),
        conflictType: conflict.conflict_type,
      });
    }
  }

  // Step E & F: Build DecodedConflict array with suggestions
  const decodedConflicts: DecodedConflict[] = [];

  for (const [, group] of variableGroupMap) {
    const functions = Array.from(group.functions);
    const suggestion = generateSuggestion(
      group.decoded.variableName,
      group.decoded.variableType,
      functions,
      group.decoded.slot,
    );

    decodedConflicts.push({
      variableName: group.decoded.variableName,
      variableType: group.decoded.variableType,
      slot: group.decoded.slot,
      functions,
      conflictType: group.conflictType,
      suggestion,
    });
  }

  // Step G: Build matrix
  const matrix = buildMatrix(decodedConflicts);

  return {
    conflicts: decodedConflicts,
    matrix,
  };
}
