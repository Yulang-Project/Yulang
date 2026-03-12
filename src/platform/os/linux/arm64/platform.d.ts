import type { IPlatform } from "../../../IPlatform.js";
import { IRGenerator, type IRValue } from "../../../../generator/ir_generator.js";
export declare class ARM64LinuxPlatform implements IPlatform {
    constructor();
    getTargetTriple(): string;
    getDataLayout(): string;
    getPointerSizeInBits(): number;
    getPointerAlignmentInBytes(): number;
    getOsIdentifier(): string;
    getArchIdentifier(): string;
    emitSyscall(generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue;
    emitMemoryAllocate(generator: IRGenerator, size: IRValue): IRValue;
    emitMemoryFree(generator: IRGenerator, addr: IRValue, size: IRValue): void;
    emitLowLevelRuntime(generator: IRGenerator): void;
    emitGlobalDefinitions(generator: IRGenerator): void;
}
//# sourceMappingURL=platform.d.ts.map