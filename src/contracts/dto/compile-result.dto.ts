export interface StorageEntry {
  astId: number;
  contract: string;
  label: string;
  offset: number;
  slot: string; // decimal string, e.g. "0", "1"
  type: string; // typeId reference into types map
}

export interface StorageTypeInfo {
  encoding: string; // "inplace", "mapping", "dynamic_array"
  label: string; // e.g. "uint256", "mapping(address => uint256)"
  numberOfBytes: string;
  key?: string; // typeId for mapping key type
  value?: string; // typeId for mapping value type
  base?: string; // typeId for dynamic array base type
  members?: any[]; // for struct types
}

export interface StorageLayout {
  storage: StorageEntry[];
  types: Record<string, StorageTypeInfo>;
}

export interface CompileResultDto {
  contractName: string;
  abi: any[];
  bytecode: string;
  storageLayout?: StorageLayout;
}
