// src/generator/builtins.ts
import { LLVMIRHelper } from './llvm_ir_helpers.js';
import { LangItems } from './lang_items.js';
import type { IRValue } from './ir_generator.js';

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
    public createMemcpy(dest: IRValue, src: IRValue, len: IRValue): string {
        // Call our internal inline memcpy
        return `call void @__memcpy_inline(i8* ${dest.value}, i8* ${src.value}, i64 ${len.value})`;
    }

    /**
     * Generates IR to create a string struct on the stack.
     * @param ptrValue The i8* pointer to the string data.
     * @param lenValue The i64 length of the string.
     * @returns An IRValue representing the pointer to the stack-allocated string struct.
     */
    public createString(ptrValue: string, lenValue: string): IRValue {
        const resultStructPtr = this.helpers.getNewTempVar();
        this.helpers.getGenerator().emit(`${resultStructPtr} = alloca ${LangItems.string.structName}, align 8`);

        const resPtrField = this.helpers.getNewTempVar();
        this.helpers.getGenerator().emit(`${resPtrField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.ptr.index}`);
        this.helpers.getGenerator().emit(`store i8* ${ptrValue}, i8** ${resPtrField}, align 8`);

        const resLenField = this.helpers.getNewTempVar();
        this.helpers.getGenerator().emit(`${resLenField} = getelementptr inbounds ${LangItems.string.structName}, ${LangItems.string.structName}* ${resultStructPtr}, i32 0, i32 ${LangItems.string.members.len.index}`);
        this.helpers.getGenerator().emit(`store i64 ${lenValue}, i64* ${resLenField}, align 8`);

        return { value: resultStructPtr, type: `${LangItems.string.structName}*` };
    }

    public createPanicOOB(): void {
        this.helpers.getGenerator().emit(`declare void @__panic_oob()`, false);
    }
}
