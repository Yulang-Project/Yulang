import { IRGenerator, type IRValue } from '../generator/ir_generator.js';
import { type PredefinedFunction } from './types.js';
import { LLVM } from '../llvm/index.js';
import { LangItems } from '../generator/lang_items.js';

const BUILTIN_FUNCTIONS: PredefinedFunction[] = [
    {
        name: '_builtin_string_to_ptr',
        handler: (generator, args) => {
            if (args.length !== 1) throw new Error("_builtin_string_to_ptr requires 1 argument.");
            const strVal = args[0]!;
            const context = generator.llvmHelper.getContext();
            const structType = generator.stringStructType;
            
            const stringPtr = strVal.address || strVal.value;
            const dataFieldPtr = LLVM.BuildStructGEP2(generator.builder, structType, stringPtr, 0, "str_ptr_gep");
            const i8PtrType = LLVM.PointerType(LLVM.Int8TypeInContext(context), 0);
            const ptr = LLVM.BuildLoad2(generator.builder, i8PtrType, dataFieldPtr, "str_ptr");
            
            return { value: ptr, type: i8PtrType };
        }
    },
    {
        name: '_builtin_string_get_len',
        handler: (generator, args) => {
            if (args.length !== 1) throw new Error("_builtin_string_get_len requires 1 argument.");
            const strVal = args[0]!;
            const context = generator.llvmHelper.getContext();
            const structType = generator.stringStructType;
            
            const stringPtr = strVal.address || strVal.value;
            const lenFieldPtr = LLVM.BuildStructGEP2(generator.builder, structType, stringPtr, 1, "str_len_gep");
            const i64Type = LLVM.Int64TypeInContext(context);
            const len = LLVM.BuildLoad2(generator.builder, i64Type, lenFieldPtr, "str_len");
            
            return { value: len, type: i64Type };
        }
    }
];

const PREDEFINED_FUNCTIONS: PredefinedFunction[] = [
    ...BUILTIN_FUNCTIONS,
];

export function findPredefinedFunction(name: string): PredefinedFunction | undefined {
    return PREDEFINED_FUNCTIONS.find(f => f.name === name);
}
