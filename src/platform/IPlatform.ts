import { IRGenerator, type IRValue } from "../generator/ir_generator.js";
import type { IArchitecture } from "./IArchitecture.js";

export interface IPlatform {
    // Associated architecture
    architecture: IArchitecture;

    // Emits the LLVM IR for performing a system call.
    // The platform implementation will typically use architecture.emitSyscallInlineASM().
    emitSyscall(generator: IRGenerator, callNum: IRValue, args: IRValue[]): IRValue;

    // Emits LLVM IR to perform a memory allocation (like brk/mmap based).
    emitMemoryAllocate(generator: IRGenerator, size: IRValue): IRValue;

    // Emits LLVM IR to perform memory deallocation (like munmap based).
    emitMemoryFree(generator: IRGenerator, addr: IRValue, size: IRValue): void;

    // Emits any platform-specific low-level runtime functions (e.g., __heap_init, __memcpy_inline).
    emitLowLevelRuntime(generator: IRGenerator): void;

    // Emits LLVM global definitions needed for the platform (e.g., __heap_base, __heap_brk).
    emitGlobalDefinitions(generator: IRGenerator): void;
}
