import { IRGenerator, type IRValue } from "../generator/ir_generator.js";
export interface IPlatform {
    emitSyscall(generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue;
    emitMemoryAllocate(generator: IRGenerator, size: IRValue): IRValue;
    emitMemoryFree(generator: IRGenerator, addr: IRValue, size: IRValue): void;
    emitLowLevelRuntime(generator: IRGenerator): void;
    emitGlobalDefinitions(generator: IRGenerator): void;
    getOsIdentifier(): string;
    getArchIdentifier(): string;
    getTargetTriple(): string;
    getDataLayout(): string;
    getPointerSizeInBits(): number;
}
//# sourceMappingURL=IPlatform.d.ts.map