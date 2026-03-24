import {
  decodeSlotToVariable,
  buildConflictAnalysis,
  generateSuggestion,
  buildMatrix,
} from '../src/vibe-score/storage-layout-decoder';
import { StorageLayout } from '../src/contracts/dto/compile-result.dto';
import { ConflictDetails } from '../src/engine/engine.service';
import { DecodedConflict } from '../src/vibe-score/dto/vibe-score-result.dto';

// ── Fixtures ──

const parallelConflictLayout: StorageLayout = {
  storage: [
    {
      astId: 1,
      contract: 'ParallelConflict',
      label: 'counter',
      offset: 0,
      slot: '0',
      type: 't_uint256',
    },
  ],
  types: {
    t_uint256: {
      encoding: 'inplace',
      label: 'uint256',
      numberOfBytes: '32',
    },
  },
};

const mappingLayout: StorageLayout = {
  storage: [
    {
      astId: 1,
      contract: 'MappingContract',
      label: 'counter',
      offset: 0,
      slot: '0',
      type: 't_uint256',
    },
    {
      astId: 2,
      contract: 'MappingContract',
      label: 'balances',
      offset: 0,
      slot: '1',
      type: 't_mapping',
    },
  ],
  types: {
    t_uint256: {
      encoding: 'inplace',
      label: 'uint256',
      numberOfBytes: '32',
    },
    t_mapping: {
      encoding: 'mapping',
      label: 'mapping(address => uint256)',
      numberOfBytes: '32',
      key: 't_address',
      value: 't_uint256',
    },
  },
};

const multiMappingLayout: StorageLayout = {
  storage: [
    {
      astId: 1,
      contract: 'Multi',
      label: 'balances',
      offset: 0,
      slot: '0',
      type: 't_mapping',
    },
    {
      astId: 2,
      contract: 'Multi',
      label: 'allowances',
      offset: 0,
      slot: '1',
      type: 't_mapping2',
    },
  ],
  types: {
    t_mapping: {
      encoding: 'mapping',
      label: 'mapping(address => uint256)',
      numberOfBytes: '32',
    },
    t_mapping2: {
      encoding: 'mapping',
      label: 'mapping(address => mapping(address => uint256))',
      numberOfBytes: '32',
    },
  },
};

const COINBASE_ADDRESS = '0x00000000000000000000000000000000000000C0';
const DEPLOYED_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

const makeTxFunctionMap = (...entries: [number, string][]): Map<number, string> =>
  new Map(entries);

// ── decodeSlotToVariable tests ──

describe('decodeSlotToVariable', () => {
  it('matches exact slot — hex "0x0" matches decimal entry slot "0" → "counter"', () => {
    const result = decodeSlotToVariable('0x0', parallelConflictLayout);

    expect(result.variableName).toBe('counter');
    expect(result.variableType).toBe('uint256');
    expect(result.slot).toBe('0x0');
  });

  it('matches exact slot with larger hex values', () => {
    const layout: StorageLayout = {
      storage: [
        { astId: 1, contract: 'C', label: 'a', offset: 0, slot: '0', type: 't_uint256' },
        { astId: 2, contract: 'C', label: 'b', offset: 0, slot: '7', type: 't_uint256' },
      ],
      types: {
        t_uint256: { encoding: 'inplace', label: 'uint256', numberOfBytes: '32' },
      },
    };

    const result = decodeSlotToVariable('0x7', layout);

    expect(result.variableName).toBe('b');
    expect(result.variableType).toBe('uint256');
  });

  it('attributes large runtime slot to single mapping variable via heuristic', () => {
    // A very large slot (keccak256-derived) should be attributed to the mapping
    const largeSlot = '0xabc123def456789012345678901234567890abcdef1234567890abcdef12345678';
    const result = decodeSlotToVariable(largeSlot, mappingLayout);

    expect(result.variableName).toBe('balances');
    expect(result.variableType).toBe('mapping(address => uint256)');
  });

  it('returns "unknown (possibly X or Y)" when multiple mappings exist', () => {
    const largeSlot = '0xfff123def456789012345678901234567890abcdef1234567890abcdef12345678';
    const result = decodeSlotToVariable(largeSlot, multiMappingLayout);

    expect(result.variableName).toContain('unknown (possibly');
    expect(result.variableName).toContain('balances');
    expect(result.variableName).toContain('allowances');
    expect(result.variableType).toBe('unknown');
  });

  it('returns "unknown_slot_0x..." when no match and no mapping heuristic applies', () => {
    // Slot 5 doesn't match any declared entry (only slot 0 exists), and
    // no mapping/dynamic_array types in layout, but slot is within declared range
    // Actually, slot 5 > max declared (0), but parallelConflictLayout has no mappings
    // So it falls through to the fallback
    const result = decodeSlotToVariable('0x5', parallelConflictLayout);

    expect(result.variableName).toBe('unknown_slot_0x5');
    expect(result.variableType).toBe('unknown');
    expect(result.slot).toBe('0x5');
  });
});

// ── generateSuggestion tests ──

describe('generateSuggestion', () => {
  it('generates mapping-specific suggestion with variable and function names', () => {
    const suggestion = generateSuggestion(
      'balances',
      'mapping(address => uint256)',
      ['transfer', 'approve'],
      '0x1',
    );

    expect(suggestion).toContain('balances');
    expect(suggestion).toContain('transfer');
    expect(suggestion).toContain('approve');
    expect(suggestion).toContain('mapping');
  });

  it('generates simple variable suggestion for uint256', () => {
    const suggestion = generateSuggestion(
      'counter',
      'uint256',
      ['increment', 'incrementBy'],
      '0x0',
    );

    expect(suggestion).toContain('counter');
    expect(suggestion).toContain('increment');
    expect(suggestion).toContain('incrementBy');
    expect(suggestion).toContain('variable');
  });

  it('generates unknown slot suggestion for unknown variables', () => {
    const suggestion = generateSuggestion(
      'unknown_slot_0xabc',
      'unknown',
      ['funcA', 'funcB'],
      '0xabc',
    );

    expect(suggestion).toContain('0xabc');
    expect(suggestion).toContain('storage layout');
  });

  it('generates array-specific suggestion for dynamic arrays', () => {
    const suggestion = generateSuggestion(
      'items',
      'uint256[]',
      ['addItem', 'removeItem'],
      '0x2',
    );

    expect(suggestion).toContain('items');
    expect(suggestion).toContain('array');
    expect(suggestion).toContain('mapping-based');
  });
});

// ── buildMatrix tests ──

describe('buildMatrix', () => {
  it('builds correct matrix dimensions (rows=unique funcs, cols=unique vars)', () => {
    const conflicts: DecodedConflict[] = [
      {
        variableName: 'counter',
        variableType: 'uint256',
        slot: '0x0',
        functions: ['increment', 'incrementBy'],
        conflictType: 'write-write',
        suggestion: '',
      },
      {
        variableName: 'total',
        variableType: 'uint256',
        slot: '0x1',
        functions: ['increment', 'reset'],
        conflictType: 'write-write',
        suggestion: '',
      },
    ];

    const matrix = buildMatrix(conflicts);

    // 3 unique functions: increment, incrementBy, reset
    expect(matrix.rows).toHaveLength(3);
    expect(matrix.rows).toContain('increment');
    expect(matrix.rows).toContain('incrementBy');
    expect(matrix.rows).toContain('reset');

    // 2 unique variables: counter, total
    expect(matrix.cols).toHaveLength(2);
    expect(matrix.cols).toContain('counter');
    expect(matrix.cols).toContain('total');

    // Cells: 3 rows × 2 cols
    expect(matrix.cells).toHaveLength(3);
    for (const row of matrix.cells) {
      expect(row).toHaveLength(2);
    }
  });

  it('counts conflict intersections correctly', () => {
    const conflicts: DecodedConflict[] = [
      {
        variableName: 'counter',
        variableType: 'uint256',
        slot: '0x0',
        functions: ['increment', 'decrement'],
        conflictType: 'write-write',
        suggestion: '',
      },
    ];

    const matrix = buildMatrix(conflicts);

    // increment and decrement both touch counter
    const incrementRow = matrix.rows.indexOf('increment');
    const decrementRow = matrix.rows.indexOf('decrement');
    const counterCol = matrix.cols.indexOf('counter');

    expect(matrix.cells[incrementRow][counterCol]).toBe(1);
    expect(matrix.cells[decrementRow][counterCol]).toBe(1);
  });

  it('returns empty matrix for no conflicts', () => {
    const matrix = buildMatrix([]);

    expect(matrix.rows).toHaveLength(0);
    expect(matrix.cols).toHaveLength(0);
    expect(matrix.cells).toHaveLength(0);
  });
});

// ── buildConflictAnalysis tests ──

describe('buildConflictAnalysis', () => {
  it('filters out coinbase address conflicts (case-insensitive)', () => {
    const conflictDetails: ConflictDetails = {
      per_tx: [],
      conflicts: [
        {
          location: { location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' },
          tx_a: 1,
          tx_b: 2,
          conflict_type: 'write-write',
        },
        {
          // Coinbase with mixed case — should be filtered
          location: { location_type: 'Balance', address: '0x00000000000000000000000000000000000000c0' },
          tx_a: 0,
          tx_b: 1,
          conflict_type: 'read-write',
        },
        {
          // Coinbase uppercase — should be filtered
          location: { location_type: 'Balance', address: COINBASE_ADDRESS },
          tx_a: 0,
          tx_b: 2,
          conflict_type: 'read-write',
        },
      ],
    };

    const txMap = makeTxFunctionMap([0, 'constructor'], [1, 'increment'], [2, 'incrementBy']);

    const result = buildConflictAnalysis(
      conflictDetails,
      parallelConflictLayout,
      [],
      txMap,
      COINBASE_ADDRESS,
    );

    // Only the Storage conflict on the deployed address should survive
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].variableName).toBe('counter');
  });

  it('skips non-Storage conflicts (Balance, Nonce, CodeHash)', () => {
    const conflictDetails: ConflictDetails = {
      per_tx: [],
      conflicts: [
        {
          location: { location_type: 'Balance', address: DEPLOYED_ADDRESS },
          tx_a: 1,
          tx_b: 2,
          conflict_type: 'read-write',
        },
        {
          location: { location_type: 'Nonce', address: DEPLOYED_ADDRESS },
          tx_a: 1,
          tx_b: 2,
          conflict_type: 'read-write',
        },
        {
          location: { location_type: 'CodeHash', address: DEPLOYED_ADDRESS },
          tx_a: 0,
          tx_b: 1,
          conflict_type: 'read-write',
        },
      ],
    };

    const txMap = makeTxFunctionMap([0, 'constructor'], [1, 'increment'], [2, 'incrementBy']);

    const result = buildConflictAnalysis(
      conflictDetails,
      parallelConflictLayout,
      [],
      txMap,
      COINBASE_ADDRESS,
    );

    // All conflicts are non-Storage → should be empty
    expect(result.conflicts).toHaveLength(0);
    expect(result.matrix.rows).toHaveLength(0);
    expect(result.matrix.cols).toHaveLength(0);
  });

  it('returns empty result when storageLayout is undefined', () => {
    const conflictDetails: ConflictDetails = {
      per_tx: [],
      conflicts: [
        {
          location: { location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' },
          tx_a: 1,
          tx_b: 2,
          conflict_type: 'write-write',
        },
      ],
    };

    const txMap = makeTxFunctionMap([1, 'increment'], [2, 'incrementBy']);

    const result = buildConflictAnalysis(
      conflictDetails,
      undefined,
      [],
      txMap,
      COINBASE_ADDRESS,
    );

    expect(result.conflicts).toHaveLength(0);
    expect(result.matrix.rows).toHaveLength(0);
    expect(result.matrix.cols).toHaveLength(0);
    expect(result.matrix.cells).toHaveLength(0);
  });

  it('produces full ParallelConflict-like decoded result with counter, increment/incrementBy', () => {
    const conflictDetails: ConflictDetails = {
      per_tx: [
        { tx_index: 0, reads: [], writes: [] },
        {
          tx_index: 1,
          reads: [{ location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' }],
          writes: [{ location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' }],
        },
        {
          tx_index: 2,
          reads: [{ location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' }],
          writes: [{ location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' }],
        },
      ],
      conflicts: [
        {
          location: { location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' },
          tx_a: 1,
          tx_b: 2,
          conflict_type: 'write-write',
        },
        // Coinbase Balance conflict — should be filtered
        {
          location: { location_type: 'Balance', address: COINBASE_ADDRESS },
          tx_a: 0,
          tx_b: 1,
          conflict_type: 'read-write',
        },
      ],
    };

    const txMap = makeTxFunctionMap(
      [0, 'constructor'],
      [1, 'increment'],
      [2, 'incrementBy'],
    );

    const result = buildConflictAnalysis(
      conflictDetails,
      parallelConflictLayout,
      [],
      txMap,
      COINBASE_ADDRESS,
    );

    // Should decode counter variable
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict.variableName).toBe('counter');
    expect(conflict.variableType).toBe('uint256');
    expect(conflict.slot).toBe('0x0');
    expect(conflict.functions).toContain('increment');
    expect(conflict.functions).toContain('incrementBy');
    expect(conflict.conflictType).toBe('write-write');

    // Suggestion should contain variable and function names
    expect(conflict.suggestion).toContain('counter');
    expect(conflict.suggestion).toContain('increment');
    expect(conflict.suggestion).toContain('incrementBy');

    // Matrix should have 2 functions × 1 variable
    expect(result.matrix.rows).toHaveLength(2);
    expect(result.matrix.cols).toEqual(['counter']);
    expect(result.matrix.cells).toHaveLength(2);
    // Each function has 1 conflict with counter
    for (const row of result.matrix.cells) {
      expect(row).toEqual([1]);
    }
  });

  it('resolves tx indices to function names using txFunctionMap', () => {
    const conflictDetails: ConflictDetails = {
      per_tx: [],
      conflicts: [
        {
          location: { location_type: 'Storage', address: DEPLOYED_ADDRESS, slot: '0x0' },
          tx_a: 1,
          tx_b: 3,
          conflict_type: 'write-write',
        },
      ],
    };

    // tx 1 = increment, tx 3 = unmapped → should become tx_3
    const txMap = makeTxFunctionMap([0, 'constructor'], [1, 'increment']);

    const result = buildConflictAnalysis(
      conflictDetails,
      parallelConflictLayout,
      [],
      txMap,
      COINBASE_ADDRESS,
    );

    expect(result.conflicts[0].functions).toContain('increment');
    expect(result.conflicts[0].functions).toContain('tx_3');
  });
});
