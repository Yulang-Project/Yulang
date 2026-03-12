// src/generator/builtins.ts
import { LLVMIRHelper } from './llvm_ir_helpers.js';
import { LangItems } from './lang_items.js';
import { LLVM } from '../llvm/index.js';
/**
 * Attempts to resolve a simple type name (like 'string') to its full LLVM type
 * if it's a special language item.
 * @returns The full LLVM type name as a string, or `false` if it's not a special lang item.
 */
export function resolveLangItemType(typeName) {
    if (typeName === LangItems.string.typeName) {
        return LangItems.string.structName;
    }
    // Future lang items like 'array' could be handled here
    return false;
}
export class BuiltinFunctions {
    helpers;
    constructor(helpers) {
        this.helpers = helpers;
    }
    /**
     * Generates an alloca instruction.
     */
    createAlloca(sizeValue, align = 16) {
        const generator = this.helpers.getGenerator();
        const context = this.helpers.getContext();
        return LLVM.BuildAlloca(generator.builder, LLVM.Int8TypeInContext(context), "");
    }
    /**
     * Generates a call to the llvm.memcpy intrinsic.
     */
    createMemcpy(dest, src, len) {
        const generator = this.helpers.getGenerator();
        const context = this.helpers.getContext();
        const module = generator.module;
        let memcpyFunc = LLVM.GetNamedFunction(module, "__memcpy_inline");
        if (!memcpyFunc) {
            const voidType = LLVM.VoidTypeInContext(context);
            const i8PtrType = LLVM.PointerType(LLVM.Int8TypeInContext(context), 0);
            const i64Type = LLVM.Int64TypeInContext(context);
            const paramTypes = [i8PtrType, i8PtrType, i64Type];
            const funcType = LLVM.FunctionType(voidType, paramTypes, 3, 0);
            memcpyFunc = LLVM.AddFunction(module, "__memcpy_inline", funcType);
        }
        const args = [dest.value, src.value, len.value];
        const funcType = LLVM.GetElementType(LLVM.TypeOf(memcpyFunc));
        return LLVM.BuildCall2(generator.builder, funcType, memcpyFunc, args, 3, "");
    }
    /**
     * Generates IR to create a string struct on the stack.
     */
    createString(ptrValue, lenValue) {
        const generator = this.helpers.getGenerator();
        const context = this.helpers.getContext();
        const structType = this.helpers.getLLVMTypeByName(LangItems.string.structName);
        const resultStructPtr = LLVM.BuildAlloca(generator.builder, structType, "");
        const zero = LLVM.ConstInt(LLVM.Int32TypeInContext(context), 0, 0);
        const ptrIdx = LLVM.ConstInt(LLVM.Int32TypeInContext(context), LangItems.string.members.ptr.index, 0);
        const lenIdx = LLVM.ConstInt(LLVM.Int32TypeInContext(context), LangItems.string.members.len.index, 0);
        const resPtrField = LLVM.BuildInBoundsGEP2(generator.builder, structType, resultStructPtr, [zero, ptrIdx], 2, "");
        LLVM.BuildStore(generator.builder, ptrValue, resPtrField);
        const resLenField = LLVM.BuildInBoundsGEP2(generator.builder, structType, resultStructPtr, [zero, lenIdx], 2, "");
        LLVM.BuildStore(generator.builder, lenValue, resLenField);
        return { value: resultStructPtr, type: LLVM.PointerType(structType, 0) };
    }
    createPanicOOB() {
        // no-op
    }
}
//# sourceMappingURL=builtins.js.map