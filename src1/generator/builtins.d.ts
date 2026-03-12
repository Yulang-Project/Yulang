import { LLVMIRHelper } from './llvm_ir_helpers.js';
import type { IRValue } from './ir_generator.js';
import type { LLVMValueRef } from '../llvm/index.js';
/**
 * Attempts to resolve a simple type name (like 'string') to its full LLVM type
 * if it's a special language item.
 * @returns The full LLVM type name as a string, or `false` if it's not a special lang item.
 */
export declare function resolveLangItemType(typeName: string): string | false;
export declare class BuiltinFunctions {
    private helpers;
    constructor(helpers: LLVMIRHelper);
    /**
     * Generates an alloca instruction.
     */
    createAlloca(sizeValue: LLVMValueRef, align?: number): LLVMValueRef;
    /**
     * Generates a call to the llvm.memcpy intrinsic.
     */
    createMemcpy(dest: IRValue, src: IRValue, len: IRValue): LLVMValueRef;
    /**
     * Generates IR to create a string struct on the stack.
     */
    createString(ptrValue: LLVMValueRef, lenValue: LLVMValueRef): IRValue;
    createPanicOOB(): void;
}
//# sourceMappingURL=builtins.d.ts.map