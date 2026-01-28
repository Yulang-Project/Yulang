import { IRGenerator, type IRValue } from "../generator/ir_generator.js";

export interface IArchitecture {
    // LLVM target triple for this architecture (e.g., "x86_64-unknown-linux-gnu")
    getTargetTriple(): string;

    // LLVM datalayout string for this architecture
    getDataLayout(): string;

    // Emits the architecture-specific inline assembly for a syscall.
    // This method will be called by the platform implementation.
    emitSyscallInlineASM(generator: IRGenerator, callNum: string, args: string[]): string;

    // Gets the size of a pointer in bits (e.g., 64 for x86_64)
    getPointerSizeInBits(): number;

    // Gets the alignment of a pointer in bytes
    getPointerAlignmentInBytes(): number;
}