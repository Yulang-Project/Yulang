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
            const structType = generator.llvmHelper.getLLVMTypeByName(LangItems.string.structName);
            
            // If it's already a pointer to struct, use it directly, otherwise we'd need its address
            const arrayPtr = strVal.address || strVal.value;
            const dataFieldPtr = LLVM.BuildStructGEP2(generator.builder, structType, arrayPtr, 0, "");
            const ptr = LLVM.BuildLoad2(generator.builder, LLVM.PointerType(LLVM.Int8TypeInContext(context), 0), dataFieldPtr, "");
            
            return { value: ptr, type: LLVM.PointerType(LLVM.Int8TypeInContext(context), 0) };
        }
    },
    {
        name: '_builtin_string_get_len',
        handler: (generator, args) => {
            if (args.length !== 1) throw new Error("_builtin_string_get_len requires 1 argument.");
            const strVal = args[0]!;
            const structType = generator.llvmHelper.getLLVMTypeByName(LangItems.string.structName);
            
            const arrayPtr = strVal.address || strVal.value;
            const lenFieldPtr = LLVM.BuildStructGEP2(generator.builder, structType, arrayPtr, 1, "");
            const len = LLVM.BuildLoad2(generator.builder, LLVM.Int64TypeInContext(generator.llvmHelper.getContext()), lenFieldPtr, "");
            
            return { value: len, type: LLVM.Int64TypeInContext(generator.llvmHelper.getContext()) };
        }
    }
];

const PREDEFINED_FUNCTIONS: PredefinedFunction[] = [
    ...BUILTIN_FUNCTIONS,
];

export function findPredefinedFunction(name: string): PredefinedFunction | undefined {
    return PREDEFINED_FUNCTIONS.find(f => f.name === name);
}
