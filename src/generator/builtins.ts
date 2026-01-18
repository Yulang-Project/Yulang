// src/generator/builtins.ts
import { LLVMIRHelper } from './llvm_ir_helpers.js';
import { LangItems } from './lang_items.js';

/**
 * Attempts to resolve a simple type name (like 'string') to its full LLVM type
 * if it's a special language item.
 * @returns The full LLVM type name as a string, or `false` if it's not a special lang item.
 */
export function resolveLangItemType(typeName: string): string | false {
    if (typeName === LangItems.string.typeName) {
        return LangItems.string.structName;
    }
    // Future lang items like 'array' could be handled here
    return false;
}

export class BuiltinFunctions {
    private helpers: LLVMIRHelper;

    constructor(helpers: LLVMIRHelper) {
        this.helpers = helpers;
    }

    /**
     * Generates an alloca instruction.
     */
    public createAlloca(sizeValue: string, align: number = 16): string {
        const resultVar = this.helpers.getNewTempVar();
        return `${resultVar} = alloca i8, i32 ${sizeValue}, align ${align}`;
    }

    /**
     * Generates a call to the llvm.memcpy intrinsic.
     */
    public createMemcpy(dest: string, src: string, len: string): string {
        // Call our internal inline memcpy
        return `call void @__memcpy_inline(i8* ${dest}, i8* ${src}, i64 ${len})`;
    }
}
